import * as gitOps from "./gitOps.js";
import * as githubOps from "./githubOps.js";
import * as projectOps from "./projectOps.js";
import * as vercelOps from "./vercelOps.js";

/**
 * Extract "owner" and "repo" from a git remote URL like
 * https://github.com/owner/repo.git or git@github.com:owner/repo.git
 */
function parseOwnerRepoFromRemoteUrl(url) {
  if (!url) return null;
  const httpsMatch = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  return null;
}

/**
 * fix_ci — investigate a failed GitHub Actions run and prepare the fix loop.
 *
 * This does NOT write code fixes itself (that requires the AI's own
 * reasoning + file tools). Instead it does the mechanical investigation
 * work end-to-end — find the failing run, find the failing job(s), pull
 * the actual log text — so the AI can read the logs, make the fix with
 * file tools, then call `verify_ci_fix` (below) to commit/push and confirm
 * the run goes green.
 *
 * Flow:
 *   find latest failing run on branch -> list its jobs -> find failed jobs
 *   -> pull logs for each failed job -> return structured diagnosis
 */
export async function fixCi({ owner, repo, branch, run_id }) {
  const steps = [];

  // 1. Resolve the run to investigate
  let run;
  if (run_id) {
    run = await githubOps.githubGetWorkflowRun({ owner, repo, run_id });
    steps.push({ step: "get_workflow_run", run });
  } else {
    const runs = await githubOps.githubListWorkflowRuns({ owner, repo, branch, status: "failure", per_page: 5 });
    steps.push({ step: "list_workflow_runs", found: runs.runs?.length || 0 });
    if (!runs.runs || runs.runs.length === 0) {
      return { ok: false, reason: `No failing workflow runs found${branch ? ` on branch '${branch}'` : ""}.`, steps };
    }
    run = runs.runs[0]; // most recent
  }

  if (run.conclusion && run.conclusion !== "failure" && run.status !== "in_progress") {
    return { ok: false, reason: `Run ${run.id} is not currently failing (conclusion: ${run.conclusion}).`, steps, run };
  }

  // 2. Get jobs for that run
  const jobsResult = await githubOps.githubGetWorkflowRunJobs({ owner, repo, run_id: run.id });
  steps.push({ step: "get_workflow_run_jobs", job_count: jobsResult.jobs?.length || 0 });

  const failedJobs = (jobsResult.jobs || []).filter((j) => j.conclusion === "failure");
  if (failedJobs.length === 0) {
    return { ok: false, reason: `No failed jobs found in run ${run.id} — it may still be in progress.`, steps, run, jobs: jobsResult.jobs };
  }

  // 3. Pull logs for each failed job
  const diagnosis = [];
  for (const job of failedJobs) {
    try {
      const logResult = await githubOps.githubGetJobLogs({ owner, repo, job_id: job.id });
      const failedSteps = (job.steps || []).filter((s) => s.conclusion === "failure");
      diagnosis.push({
        job_id: job.id,
        job_name: job.name,
        failed_steps: failedSteps.map((s) => s.name),
        html_url: job.html_url,
        // Trim to the tail — that's where the actual error usually is, and
        // full CI logs can be enormous.
        logs_tail: logResult.logs.slice(-8000),
      });
    } catch (err) {
      diagnosis.push({ job_id: job.id, job_name: job.name, error: `Could not fetch logs: ${err.message}` });
    }
  }
  steps.push({ step: "fetch_job_logs", jobs_diagnosed: diagnosis.length });

  return {
    ok: true,
    run: { id: run.id, branch: run.branch || run.head_branch, html_url: run.html_url },
    failed_jobs: diagnosis,
    steps,
    next_step:
      "Read logs_tail for each failed job, fix the code with file tools, then call verify_ci_fix to commit, push, and confirm CI passes.",
  };
}

/**
 * verify_ci_fix — after the AI has made a code fix on disk, commit + push
 * it and poll the new workflow run until it finishes, reporting the result.
 *
 * Flow:
 *   commit -> push -> poll new run on branch until complete -> report pass/fail
 */
export async function verifyCiFix({
  repo_path,
  owner,
  repo,
  branch,
  commit_message,
  poll_interval_ms = 15_000,
  max_polls = 20,
}) {
  const steps = [];

  try {
    await gitOps.gitAdd({ repo_path, files: "." });
    const commitResult = await gitOps.gitCommit({ repo_path, message: commit_message });
    steps.push({ step: "commit", ...commitResult });
  } catch (err) {
    return { ok: false, failed_step: "commit", reason: err.message, steps };
  }

  try {
    const pushResult = await gitOps.gitPush({ repo_path, branch });
    steps.push({ step: "push", ...pushResult });
  } catch (err) {
    return { ok: false, failed_step: "push", reason: err.message, steps };
  }

  // Poll for the new run to appear and finish
  let latestRun = null;
  for (let i = 0; i < max_polls; i++) {
    await new Promise((resolve) => setTimeout(resolve, poll_interval_ms));
    const runs = await githubOps.githubListWorkflowRuns({ owner, repo, branch, per_page: 1 });
    latestRun = runs.runs?.[0] || null;
    if (latestRun && latestRun.status === "completed") break;
  }
  steps.push({ step: "poll_workflow_run", final_status: latestRun?.status, conclusion: latestRun?.conclusion });

  if (!latestRun) {
    return { ok: false, failed_step: "poll_workflow_run", reason: "No workflow run found after push.", steps };
  }
  if (latestRun.status !== "completed") {
    return { ok: null, reason: "Run still in progress after max_polls — check back later.", run: latestRun, steps };
  }

  return {
    ok: latestRun.conclusion === "success",
    run: latestRun,
    steps,
  };
}

/**
 * ship_change — take a set of already-made file edits from request to PR.
 *
 * Assumes the caller (the AI, using file/directory tools) has already made
 * the code changes on disk. This workflow does NOT edit files; it takes the
 * project from "dirty working tree" to "open pull request", running checks
 * along the way and stopping early if anything fails.
 *
 * Flow:
 *   inspect changes -> create branch -> run checks -> commit -> push -> open PR
 */
export async function shipChange({
  repo_path,
  branch_name,
  commit_message,
  pr_title,
  pr_body = "",
  base = "main",
  owner,
  repo,
  run_checks = true,
  skip_if_no_changes = true,
}) {
  const steps = [];
  const fail = (step, reason, extra = {}) => ({
    ok: false,
    failed_step: step,
    reason,
    steps,
    ...extra,
  });

  // 1. Inspect current changes
  const changed = await gitOps.gitChangedFiles({ repo_path });
  steps.push({ step: "inspect_changes", changed_files: changed.changed_files });
  if (skip_if_no_changes && changed.changed_files.length === 0) {
    return fail("inspect_changes", "No changes detected in the working tree — nothing to ship.");
  }

  // 2. Create + checkout branch
  try {
    const branchResult = await gitOps.gitCreateBranch({ repo_path, branch_name, checkout: true });
    steps.push({ step: "create_branch", ...branchResult });
  } catch (err) {
    return fail("create_branch", err.message);
  }

  // 3. Run checks (tests/lint/typecheck/build) — best-effort, non-fatal per check
  const checks = {};
  if (run_checks) {
    for (const [name, fn] of Object.entries({
      tests: projectOps.runTests,
      lint: projectOps.runLint,
      typecheck: projectOps.runTypecheck,
      build: projectOps.runBuild,
    })) {
      const result = await fn({ repo_path });
      checks[name] = result;
      if (result.ran && result.exit_code !== 0) {
        steps.push({ step: `check_${name}`, ...result });
        return fail(`check_${name}`, `${name} failed (exit code ${result.exit_code}). Fix the issue and retry.`, { checks });
      }
    }
    steps.push({ step: "run_checks", checks });
  }

  // 4. Stage + commit
  try {
    await gitOps.gitAdd({ repo_path, files: "." });
    const commitResult = await gitOps.gitCommit({ repo_path, message: commit_message });
    steps.push({ step: "commit", ...commitResult });
  } catch (err) {
    return fail("commit", err.message);
  }

  // 5. Push
  try {
    const pushResult = await gitOps.gitPush({ repo_path, branch: branch_name });
    steps.push({ step: "push", ...pushResult });
  } catch (err) {
    return fail("push", err.message);
  }

  // 6. Resolve owner/repo if not given, from the git remote
  let resolvedOwner = owner;
  let resolvedRepo = repo;
  if (!resolvedOwner || !resolvedRepo) {
    const remotes = await gitOps.gitRemote({ repo_path, action: "list" });
    const origin = remotes.result?.find((r) => r.name === "origin");
    const parsed = parseOwnerRepoFromRemoteUrl(origin?.refs?.fetch);
    if (parsed) {
      resolvedOwner = resolvedOwner || parsed.owner;
      resolvedRepo = resolvedRepo || parsed.repo;
    }
  }
  if (!resolvedOwner || !resolvedRepo) {
    return fail("create_pull_request", "Could not resolve owner/repo — pass them explicitly.", { checks });
  }

  // 7. Open PR
  try {
    const pr = await githubOps.githubCreatePullRequest({
      owner: resolvedOwner,
      repo: resolvedRepo,
      title: pr_title || commit_message,
      head: branch_name,
      base,
      body: pr_body,
    });
    steps.push({ step: "create_pull_request", ...pr });
    return { ok: true, pull_request: pr, checks, steps };
  } catch (err) {
    return fail("create_pull_request", err.message, { checks });
  }
}

/**
 * deploy_project — safely deploy a project and verify it actually works.
 *
 * Flow:
 *   project health -> tests -> build -> trigger deployment -> poll until
 *   ready -> if ready, HTTP health check the live URL -> verified result
 *
 * Stops early (without deploying) if health/tests/build fail, so broken
 * code never reaches a deployment.
 */
export async function deployProject({
  repo_path,
  project,
  git_source_repo,
  git_source_ref = "main",
  deployment_name,
  health_check_url,
  run_checks = true,
  poll_interval_ms = 10_000,
  max_polls = 30,
}) {
  const steps = [];
  const fail = (step, reason, extra = {}) => ({ ok: false, failed_step: step, reason, steps, ...extra });

  // 1. Project health
  const health = await projectOps.projectHealth({ repo_path });
  steps.push({ step: "project_health", ...health });
  if (health.git_status && health.git_status.is_clean === false) {
    return fail("project_health", "Working tree has uncommitted changes — commit or stash before deploying.", { health });
  }

  // 2. Tests + build (best-effort skip if project has no such script)
  const checks = {};
  if (run_checks) {
    for (const [name, fn] of Object.entries({ tests: projectOps.runTests, build: projectOps.runBuild })) {
      const result = await fn({ repo_path });
      checks[name] = result;
      if (result.ran && result.exit_code !== 0) {
        steps.push({ step: `check_${name}`, ...result });
        return fail(`check_${name}`, `${name} failed (exit code ${result.exit_code}) — deployment aborted.`, { checks });
      }
    }
    steps.push({ step: "run_checks", checks });
  }

  // 3. Trigger deployment
  let deployment;
  try {
    deployment = await vercelOps.vercelCreateDeployment({
      name: deployment_name || project,
      project,
      git_source_repo,
      git_source_ref,
    });
    steps.push({ step: "trigger_deployment", ...deployment });
  } catch (err) {
    return fail("trigger_deployment", err.message, { checks });
  }

  // 4. Poll until ready or errored
  let finalState = null;
  for (let i = 0; i < max_polls; i++) {
    await new Promise((resolve) => setTimeout(resolve, poll_interval_ms));
    const events = await vercelOps.vercelGetDeploymentEvents({ deployment_id: deployment.uid });
    finalState = events;
    if (events.state === "READY" || events.state === "ERROR" || events.state === "CANCELED") break;
  }
  steps.push({ step: "poll_deployment", final_state: finalState?.state });

  if (!finalState || finalState.state !== "READY") {
    // Pull build logs to help diagnose the failure
    let logs = null;
    try {
      logs = await vercelOps.vercelGetDeploymentLogs({ deployment_id: deployment.uid, limit: 200 });
    } catch {
      // best-effort — logs are a bonus, not required for the failure report
    }
    return fail("poll_deployment", `Deployment did not become ready (state: ${finalState?.state || "unknown"}).`, {
      checks,
      deployment,
      build_errors: finalState?.build_errors,
      logs,
    });
  }

  // 5. HTTP health check the live URL
  const url = health_check_url || `https://${deployment.url}`;
  const httpResult = await vercelOps.httpCheck({ url });
  steps.push({ step: "http_check", ...httpResult });

  return {
    ok: httpResult.healthy,
    deployment,
    checks,
    http_check: httpResult,
    steps,
  };
}
