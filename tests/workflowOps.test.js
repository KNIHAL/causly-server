import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../tools/gitOps.js", () => ({
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitChangedFiles: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitCheckout: vi.fn(),
  gitRemote: vi.fn(),
}));
vi.mock("../tools/githubOps.js", () => ({
  githubGetWorkflowRun: vi.fn(),
  githubListWorkflowRuns: vi.fn(),
  githubGetWorkflowRunJobs: vi.fn(),
  githubGetJobLogs: vi.fn(),
  githubCreatePullRequest: vi.fn(),
}));
vi.mock("../tools/projectOps.js", () => ({
  runTests: vi.fn(),
  runLint: vi.fn(),
  runTypecheck: vi.fn(),
  runBuild: vi.fn(),
  projectHealth: vi.fn(),
}));
vi.mock("../tools/vercelOps.js", () => ({
  vercelCreateDeployment: vi.fn(),
  vercelGetDeploymentEvents: vi.fn(),
  vercelGetDeploymentLogs: vi.fn(),
  httpCheck: vi.fn(),
}));

const gitOps = await import("../tools/gitOps.js");
const githubOps = await import("../tools/githubOps.js");
const projectOps = await import("../tools/projectOps.js");
const vercelOps = await import("../tools/vercelOps.js");
const { fixCi, verifyCiFix, shipChange, deployProject } = await import("../tools/workflowOps.js");

beforeEach(() => {
  [gitOps, githubOps, projectOps, vercelOps].forEach((mod) => {
    Object.values(mod).forEach((fn) => fn.mockReset());
  });
  // Collapse the real polling delays to keep tests instant, without
  // changing the orchestration logic under test.
  vi.stubGlobal("setTimeout", (fn) => fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const okCheck = { ran: true, exit_code: 0, stdout: "", stderr: "" };
const failCheck = (exit_code = 1) => ({ ran: true, exit_code, stdout: "", stderr: "error" });
const skippedCheck = { ran: false, reason: "no script" };

describe("fixCi", () => {
  it("fails with a clear reason when no failing runs exist and no run_id given", async () => {
    githubOps.githubListWorkflowRuns.mockResolvedValueOnce({ runs: [] });
    const result = await fixCi({ owner: "acme", repo: "infra", branch: "main" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/No failing workflow runs found on branch 'main'/);
  });

  it("uses the most recent failing run when no run_id is given", async () => {
    githubOps.githubListWorkflowRuns.mockResolvedValueOnce({
      runs: [{ id: 42, conclusion: "failure", status: "completed" }],
    });
    githubOps.githubGetWorkflowRunJobs.mockResolvedValueOnce({
      jobs: [{ id: 1, name: "build", conclusion: "failure", steps: [{ name: "Run tests", conclusion: "failure" }] }],
    });
    githubOps.githubGetJobLogs.mockResolvedValueOnce({ logs: "some failure output" });

    const result = await fixCi({ owner: "acme", repo: "infra" });
    expect(result.ok).toBe(true);
    expect(result.run.id).toBe(42);
    expect(result.failed_jobs[0].failed_steps).toEqual(["Run tests"]);
  });

  it("fetches a specific run directly when run_id is given", async () => {
    githubOps.githubGetWorkflowRun.mockResolvedValueOnce({ id: 99, conclusion: "failure", status: "completed" });
    githubOps.githubGetWorkflowRunJobs.mockResolvedValueOnce({
      jobs: [{ id: 1, name: "test", conclusion: "failure", steps: [] }],
    });
    githubOps.githubGetJobLogs.mockResolvedValueOnce({ logs: "log text" });

    const result = await fixCi({ owner: "acme", repo: "infra", run_id: 99 });
    expect(githubOps.githubListWorkflowRuns).not.toHaveBeenCalled();
    expect(result.run.id).toBe(99);
  });

  it("fails when the resolved run is not actually failing", async () => {
    githubOps.githubGetWorkflowRun.mockResolvedValueOnce({ id: 99, conclusion: "success", status: "completed" });
    const result = await fixCi({ owner: "acme", repo: "infra", run_id: 99 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not currently failing/);
  });

  it("fails when there are no failed jobs in an otherwise-failing run", async () => {
    githubOps.githubGetWorkflowRun.mockResolvedValueOnce({ id: 99, conclusion: "failure", status: "completed" });
    githubOps.githubGetWorkflowRunJobs.mockResolvedValueOnce({ jobs: [{ id: 1, name: "test", conclusion: "success" }] });
    const result = await fixCi({ owner: "acme", repo: "infra", run_id: 99 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/No failed jobs found/);
  });

  it("records a per-job error instead of throwing when log fetching fails", async () => {
    githubOps.githubGetWorkflowRun.mockResolvedValueOnce({ id: 99, conclusion: "failure", status: "completed" });
    githubOps.githubGetWorkflowRunJobs.mockResolvedValueOnce({
      jobs: [{ id: 1, name: "build", conclusion: "failure", steps: [] }],
    });
    githubOps.githubGetJobLogs.mockRejectedValueOnce(new Error("logs expired"));
    const result = await fixCi({ owner: "acme", repo: "infra", run_id: 99 });
    expect(result.ok).toBe(true);
    expect(result.failed_jobs[0].error).toMatch(/Could not fetch logs: logs expired/);
  });

  it("truncates job logs to the last 8000 characters", async () => {
    githubOps.githubGetWorkflowRun.mockResolvedValueOnce({ id: 99, conclusion: "failure", status: "completed" });
    githubOps.githubGetWorkflowRunJobs.mockResolvedValueOnce({
      jobs: [{ id: 1, name: "build", conclusion: "failure", steps: [] }],
    });
    const longLog = "x".repeat(9000) + "TAIL_MARKER";
    githubOps.githubGetJobLogs.mockResolvedValueOnce({ logs: longLog });
    const result = await fixCi({ owner: "acme", repo: "infra", run_id: 99 });
    expect(result.failed_jobs[0].logs_tail.length).toBe(8000);
    expect(result.failed_jobs[0].logs_tail).toContain("TAIL_MARKER");
  });
});

describe("verifyCiFix", () => {
  it("fails at the commit step when gitCommit throws", async () => {
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockRejectedValueOnce(new Error("nothing to commit"));
    const result = await verifyCiFix({ repo_path: "/repo", owner: "acme", repo: "infra", commit_message: "fix" });
    expect(result).toEqual({ ok: false, failed_step: "commit", reason: "nothing to commit", steps: [] });
  });

  it("fails at the push step when gitPush throws", async () => {
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: { commit: "abc" } });
    gitOps.gitPush.mockRejectedValueOnce(new Error("rejected non-fast-forward"));
    const result = await verifyCiFix({ repo_path: "/repo", owner: "acme", repo: "infra", commit_message: "fix" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("push");
  });

  it("reports success once the polled run completes with conclusion success", async () => {
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    githubOps.githubListWorkflowRuns.mockResolvedValueOnce({
      runs: [{ id: 5, status: "completed", conclusion: "success" }],
    });
    const result = await verifyCiFix({ repo_path: "/repo", owner: "acme", repo: "infra", branch: "main", commit_message: "fix", max_polls: 3 });
    expect(result.ok).toBe(true);
    expect(result.run.id).toBe(5);
  });

  it("reports failure when the polled run completes with conclusion failure", async () => {
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    githubOps.githubListWorkflowRuns.mockResolvedValueOnce({
      runs: [{ id: 5, status: "completed", conclusion: "failure" }],
    });
    const result = await verifyCiFix({ repo_path: "/repo", owner: "acme", repo: "infra", commit_message: "fix" });
    expect(result.ok).toBe(false);
    expect(result.run.conclusion).toBe("failure");
  });

  it("returns ok:null when the run is still in progress after max_polls", async () => {
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    githubOps.githubListWorkflowRuns.mockResolvedValue({ runs: [{ id: 5, status: "in_progress", conclusion: null }] });
    const result = await verifyCiFix({ repo_path: "/repo", owner: "acme", repo: "infra", commit_message: "fix", max_polls: 2 });
    expect(result.ok).toBeNull();
    expect(result.reason).toMatch(/still in progress/);
    expect(githubOps.githubListWorkflowRuns).toHaveBeenCalledTimes(2);
  });

  it("fails when no run appears at all after push", async () => {
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    githubOps.githubListWorkflowRuns.mockResolvedValue({ runs: [] });
    const result = await verifyCiFix({ repo_path: "/repo", owner: "acme", repo: "infra", commit_message: "fix", max_polls: 1 });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("poll_workflow_run");
  });
});

describe("shipChange", () => {
  function mockAllChecksOk() {
    projectOps.runTests.mockResolvedValue(okCheck);
    projectOps.runLint.mockResolvedValue(okCheck);
    projectOps.runTypecheck.mockResolvedValue(okCheck);
    projectOps.runBuild.mockResolvedValue(okCheck);
  }

  it("skips shipping when there are no changes and skip_if_no_changes is true", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [] });
    const result = await shipChange({ repo_path: "/repo", branch_name: "feat/x", commit_message: "fix" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("inspect_changes");
    expect(gitOps.gitCreateBranch).not.toHaveBeenCalled();
  });

  it("ships successfully end to end when owner/repo are given explicitly", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockResolvedValueOnce({ checked_out: true });
    mockAllChecksOk();
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    githubOps.githubCreatePullRequest.mockResolvedValueOnce({ number: 7, html_url: "u" });

    const result = await shipChange({
      repo_path: "/repo",
      branch_name: "feat/x",
      commit_message: "add feature",
      owner: "acme",
      repo: "infra",
    });

    expect(result.ok).toBe(true);
    expect(result.pull_request.number).toBe(7);
    expect(gitOps.gitRemote).not.toHaveBeenCalled();
  });

  it("falls back to checking out an existing branch when creation says it already exists", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockRejectedValueOnce(new Error("branch 'feat/x' already exists"));
    gitOps.gitCheckout.mockResolvedValueOnce({ checked_out: "feat/x" });
    mockAllChecksOk();
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    githubOps.githubCreatePullRequest.mockResolvedValueOnce({ number: 8, html_url: "u" });

    const result = await shipChange({
      repo_path: "/repo",
      branch_name: "feat/x",
      commit_message: "add feature",
      owner: "acme",
      repo: "infra",
    });
    expect(gitOps.gitCheckout).toHaveBeenCalledWith({ repo_path: "/repo", branch: "feat/x" });
    expect(result.ok).toBe(true);
  });

  it("fails at create_branch for a non-'already exists' git error", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockRejectedValueOnce(new Error("permission denied"));
    const result = await shipChange({ repo_path: "/repo", branch_name: "feat/x", commit_message: "fix" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("create_branch");
  });

  it("stops and reports failure when a check fails, without committing or pushing", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockResolvedValueOnce({ checked_out: true });
    projectOps.runTests.mockResolvedValueOnce(okCheck);
    projectOps.runLint.mockResolvedValueOnce(failCheck(1));

    const result = await shipChange({
      repo_path: "/repo",
      branch_name: "feat/x",
      commit_message: "fix",
      owner: "acme",
      repo: "infra",
    });

    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("check_lint");
    expect(gitOps.gitCommit).not.toHaveBeenCalled();
    expect(gitOps.gitPush).not.toHaveBeenCalled();
  });

  it("treats a skipped check (ran:false) as passing and continues", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockResolvedValueOnce({ checked_out: true });
    projectOps.runTests.mockResolvedValueOnce(skippedCheck);
    projectOps.runLint.mockResolvedValueOnce(skippedCheck);
    projectOps.runTypecheck.mockResolvedValueOnce(skippedCheck);
    projectOps.runBuild.mockResolvedValueOnce(skippedCheck);
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    githubOps.githubCreatePullRequest.mockResolvedValueOnce({ number: 9, html_url: "u" });

    const result = await shipChange({
      repo_path: "/repo",
      branch_name: "feat/x",
      commit_message: "fix",
      owner: "acme",
      repo: "infra",
    });
    expect(result.ok).toBe(true);
  });

  it("skips checks entirely when run_checks is false", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockResolvedValueOnce({ checked_out: true });
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    githubOps.githubCreatePullRequest.mockResolvedValueOnce({ number: 10, html_url: "u" });

    const result = await shipChange({
      repo_path: "/repo",
      branch_name: "feat/x",
      commit_message: "fix",
      owner: "acme",
      repo: "infra",
      run_checks: false,
    });
    expect(projectOps.runTests).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("resolves owner/repo from the origin remote URL when not given explicitly", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockResolvedValueOnce({ checked_out: true });
    mockAllChecksOk();
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    gitOps.gitRemote.mockResolvedValueOnce({
      result: [{ name: "origin", refs: { fetch: "https://github.com/acme/infra.git" } }],
    });
    githubOps.githubCreatePullRequest.mockResolvedValueOnce({ number: 11, html_url: "u" });

    const result = await shipChange({ repo_path: "/repo", branch_name: "feat/x", commit_message: "fix" });
    expect(githubOps.githubCreatePullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "acme", repo: "infra" })
    );
    expect(result.ok).toBe(true);
  });

  it("fails at create_pull_request when owner/repo cannot be resolved at all", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockResolvedValueOnce({ checked_out: true });
    mockAllChecksOk();
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    gitOps.gitRemote.mockResolvedValueOnce({ result: [{ name: "origin", refs: { fetch: "git@bitbucket.org:acme/infra.git" } }] });

    const result = await shipChange({ repo_path: "/repo", branch_name: "feat/x", commit_message: "fix" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("create_pull_request");
    expect(result.reason).toMatch(/Could not resolve owner\/repo/);
  });

  it("fails at commit when gitCommit throws", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockResolvedValueOnce({ checked_out: true });
    mockAllChecksOk();
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockRejectedValueOnce(new Error("commit failed"));
    const result = await shipChange({ repo_path: "/repo", branch_name: "feat/x", commit_message: "fix", owner: "acme", repo: "infra" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("commit");
  });

  it("fails at push when gitPush throws", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockResolvedValueOnce({ checked_out: true });
    mockAllChecksOk();
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockRejectedValueOnce(new Error("push rejected"));
    const result = await shipChange({ repo_path: "/repo", branch_name: "feat/x", commit_message: "fix", owner: "acme", repo: "infra" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("push");
  });

  it("fails at create_pull_request when githubCreatePullRequest throws", async () => {
    gitOps.gitChangedFiles.mockResolvedValueOnce({ changed_files: [{ file: "a.js", type: "modified" }] });
    gitOps.gitCreateBranch.mockResolvedValueOnce({ checked_out: true });
    mockAllChecksOk();
    gitOps.gitAdd.mockResolvedValueOnce({});
    gitOps.gitCommit.mockResolvedValueOnce({ commit: {} });
    gitOps.gitPush.mockResolvedValueOnce({});
    githubOps.githubCreatePullRequest.mockRejectedValueOnce(new Error("PR already exists"));
    const result = await shipChange({ repo_path: "/repo", branch_name: "feat/x", commit_message: "fix", owner: "acme", repo: "infra" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("create_pull_request");
    expect(result.reason).toBe("PR already exists");
  });
});

describe("deployProject", () => {
  it("aborts when the working tree has uncommitted changes", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: false } });
    const result = await deployProject({ repo_path: "/repo", project: "site" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("project_health");
    expect(vercelOps.vercelCreateDeployment).not.toHaveBeenCalled();
  });

  it("aborts deployment when tests fail", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: true } });
    projectOps.runTests.mockResolvedValueOnce(failCheck(1));
    const result = await deployProject({ repo_path: "/repo", project: "site" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("check_tests");
    expect(vercelOps.vercelCreateDeployment).not.toHaveBeenCalled();
  });

  it("aborts deployment when build fails", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: true } });
    projectOps.runTests.mockResolvedValueOnce(okCheck);
    projectOps.runBuild.mockResolvedValueOnce(failCheck(2));
    const result = await deployProject({ repo_path: "/repo", project: "site" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("check_build");
  });

  it("skips checks when run_checks is false", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: true } });
    vercelOps.vercelCreateDeployment.mockResolvedValueOnce({ uid: "d1", url: "site.vercel.app" });
    vercelOps.vercelGetDeploymentEvents.mockResolvedValueOnce({ state: "READY" });
    vercelOps.httpCheck.mockResolvedValueOnce({ healthy: true, status: 200 });

    const result = await deployProject({ repo_path: "/repo", project: "site", run_checks: false });
    expect(projectOps.runTests).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("returns ok:true after a successful deployment and healthy HTTP check", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: true } });
    projectOps.runTests.mockResolvedValueOnce(okCheck);
    projectOps.runBuild.mockResolvedValueOnce(okCheck);
    vercelOps.vercelCreateDeployment.mockResolvedValueOnce({ uid: "d1", url: "site.vercel.app" });
    vercelOps.vercelGetDeploymentEvents.mockResolvedValueOnce({ state: "READY" });
    vercelOps.httpCheck.mockResolvedValueOnce({ healthy: true, status: 200 });

    const result = await deployProject({ repo_path: "/repo", project: "site" });
    expect(result.ok).toBe(true);
    expect(vercelOps.httpCheck).toHaveBeenCalledWith({ url: "https://site.vercel.app" });
  });

  it("uses an explicit health_check_url instead of the deployment URL when given", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: true } });
    projectOps.runTests.mockResolvedValueOnce(okCheck);
    projectOps.runBuild.mockResolvedValueOnce(okCheck);
    vercelOps.vercelCreateDeployment.mockResolvedValueOnce({ uid: "d1", url: "site.vercel.app" });
    vercelOps.vercelGetDeploymentEvents.mockResolvedValueOnce({ state: "READY" });
    vercelOps.httpCheck.mockResolvedValueOnce({ healthy: true, status: 200 });

    await deployProject({ repo_path: "/repo", project: "site", health_check_url: "https://custom.example.com/health" });
    expect(vercelOps.httpCheck).toHaveBeenCalledWith({ url: "https://custom.example.com/health" });
  });

  it("returns ok:false with build_errors and logs when the deployment errors out", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: true } });
    projectOps.runTests.mockResolvedValueOnce(okCheck);
    projectOps.runBuild.mockResolvedValueOnce(okCheck);
    vercelOps.vercelCreateDeployment.mockResolvedValueOnce({ uid: "d1", url: "site.vercel.app" });
    vercelOps.vercelGetDeploymentEvents.mockResolvedValueOnce({
      state: "ERROR",
      build_errors: { message: "Build failed", code: "BUILD_FAILED" },
    });
    vercelOps.vercelGetDeploymentLogs.mockResolvedValueOnce({ logs: [{ type: "stderr", text: "Module not found" }] });

    const result = await deployProject({ repo_path: "/repo", project: "site" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("poll_deployment");
    expect(result.build_errors).toEqual({ message: "Build failed", code: "BUILD_FAILED" });
    expect(result.logs.logs[0].text).toBe("Module not found");
  });

  it("still returns a failure report (with logs: null) if fetching deployment logs itself throws", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: true } });
    projectOps.runTests.mockResolvedValueOnce(okCheck);
    projectOps.runBuild.mockResolvedValueOnce(okCheck);
    vercelOps.vercelCreateDeployment.mockResolvedValueOnce({ uid: "d1", url: "site.vercel.app" });
    vercelOps.vercelGetDeploymentEvents.mockResolvedValueOnce({ state: "ERROR" });
    vercelOps.vercelGetDeploymentLogs.mockRejectedValueOnce(new Error("logs unavailable"));

    const result = await deployProject({ repo_path: "/repo", project: "site" });
    expect(result.ok).toBe(false);
    expect(result.logs).toBeNull();
  });

  it("fails with an 'unknown' state reason when polling never reaches a terminal state", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: true } });
    projectOps.runTests.mockResolvedValueOnce(okCheck);
    projectOps.runBuild.mockResolvedValueOnce(okCheck);
    vercelOps.vercelCreateDeployment.mockResolvedValueOnce({ uid: "d1", url: "site.vercel.app" });
    vercelOps.vercelGetDeploymentEvents.mockResolvedValue({ state: "BUILDING" });

    const result = await deployProject({ repo_path: "/repo", project: "site", max_polls: 2 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/state: BUILDING/);
    expect(vercelOps.vercelGetDeploymentEvents).toHaveBeenCalledTimes(2);
  });

  it("aborts at trigger_deployment when vercelCreateDeployment throws", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: true } });
    projectOps.runTests.mockResolvedValueOnce(okCheck);
    projectOps.runBuild.mockResolvedValueOnce(okCheck);
    vercelOps.vercelCreateDeployment.mockRejectedValueOnce(new Error("could not resolve GitHub repo"));

    const result = await deployProject({ repo_path: "/repo", project: "site" });
    expect(result.ok).toBe(false);
    expect(result.failed_step).toBe("trigger_deployment");
  });

  it("returns ok:false when the health check on the live URL fails", async () => {
    projectOps.projectHealth.mockResolvedValueOnce({ git_status: { is_clean: true } });
    projectOps.runTests.mockResolvedValueOnce(okCheck);
    projectOps.runBuild.mockResolvedValueOnce(okCheck);
    vercelOps.vercelCreateDeployment.mockResolvedValueOnce({ uid: "d1", url: "site.vercel.app" });
    vercelOps.vercelGetDeploymentEvents.mockResolvedValueOnce({ state: "READY" });
    vercelOps.httpCheck.mockResolvedValueOnce({ healthy: false, status: 503 });

    const result = await deployProject({ repo_path: "/repo", project: "site" });
    expect(result.ok).toBe(false);
    expect(result.http_check.status).toBe(503);
  });
});
