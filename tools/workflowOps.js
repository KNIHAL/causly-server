import * as gitOps from "./gitOps.js";
import * as githubOps from "./githubOps.js";
import * as projectOps from "./projectOps.js";

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
