import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  githubGetAuthenticatedUser,
  githubCreateRepo,
  githubDeleteRepo,
  githubListRepos,
  githubCreateIssue,
  githubListIssues,
  githubCreatePullRequest,
  githubListPullRequests,
  githubAddComment,
  githubGetRepo,
  githubGetIssue,
  githubUpdateIssue,
  githubGetPullRequest,
  githubUpdatePullRequest,
  githubMergePullRequest,
  githubGetPullRequestFiles,
  githubGetPullRequestDiff,
  githubGetPullRequestComments,
  githubGetPullRequestReviews,
  githubGetBranch,
  githubListBranches,
  githubListWorkflows,
  githubListWorkflowRuns,
  githubGetWorkflowRun,
  githubGetWorkflowRunJobs,
  githubGetJobLogs,
  githubRerunWorkflow,
} from "../tools/githubOps.js";

const jsonRes = (data, ok = true, status = 200) => ({
  ok,
  status,
  statusText: "Error",
  text: () => Promise.resolve(JSON.stringify(data)),
});
const textRes = (text, ok = true, status = 200) => ({
  ok,
  status,
  statusText: "Error",
  text: () => Promise.resolve(text),
});

beforeEach(() => {
  process.env.GITHUB_TOKEN = "gh_test_token";
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GITHUB_TOKEN;
});

describe("githubOps — auth & error handling", () => {
  it("throws if GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(githubGetAuthenticatedUser()).rejects.toThrow(/GITHUB_TOKEN not set/);
  });

  it("throws a formatted error including the API message on failure", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ message: "Bad credentials" }, false, 401));
    await expect(githubGetAuthenticatedUser()).rejects.toThrow(/GitHub API error \(401\): Bad credentials/);
  });

  it("sends bearer auth and required GitHub headers", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ login: "kumar", name: "Kumar", public_repos: 5 }));
    await githubGetAuthenticatedUser();
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/user");
    expect(opts.headers.Authorization).toBe("Bearer gh_test_token");
    expect(opts.headers.Accept).toBe("application/vnd.github+json");
    expect(opts.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("getAuthenticatedUser returns simplified fields", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ login: "kumar", name: "Kumar", public_repos: 5, extra: "x" }));
    const result = await githubGetAuthenticatedUser();
    expect(result).toEqual({ login: "kumar", name: "Kumar", public_repos: 5 });
  });
});

describe("githubOps — repos", () => {
  it("createRepo sends the payload and returns simplified fields", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({ name: "infra", full_name: "acme/infra", html_url: "u", clone_url: "c" })
    );
    const result = await githubCreateRepo({ name: "infra", description: "infra repo", private: true });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ name: "infra", description: "infra repo", private: true, auto_init: true });
    expect(result).toEqual({ name: "infra", full_name: "acme/infra", html_url: "u", clone_url: "c" });
  });

  it("deleteRepo issues a DELETE and confirms", async () => {
    global.fetch.mockReturnValueOnce({ ok: true, status: 204, statusText: "", text: () => Promise.resolve("") });
    const result = await githubDeleteRepo({ owner: "acme", repo: "infra" });
    expect(global.fetch.mock.calls[0][1].method).toBe("DELETE");
    expect(result).toEqual({ owner: "acme", repo: "infra", deleted: true });
  });

  it("listRepos maps to simplified fields", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes([{ name: "a", full_name: "acme/a", private: false, html_url: "u1", extra: "x" }])
    );
    const result = await githubListRepos({});
    expect(result.repos).toEqual([{ name: "a", full_name: "acme/a", private: false, html_url: "u1" }]);
  });

  it("getRepo returns full simplified detail set", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        name: "infra",
        full_name: "acme/infra",
        private: false,
        default_branch: "main",
        html_url: "u",
        description: "d",
        open_issues_count: 3,
        language: "JavaScript",
      })
    );
    const result = await githubGetRepo({ owner: "acme", repo: "infra" });
    expect(result.default_branch).toBe("main");
    expect(result.open_issues_count).toBe(3);
  });
});

describe("githubOps — issues", () => {
  it("createIssue sends payload and returns simplified fields", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ number: 1, html_url: "u", title: "Bug" }));
    const result = await githubCreateIssue({ owner: "acme", repo: "infra", title: "Bug", labels: ["bug"] });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ title: "Bug", body: "", labels: ["bug"] });
    expect(result).toEqual({ number: 1, html_url: "u", title: "Bug" });
  });

  it("listIssues filters out pull requests (GitHub's issues endpoint includes them)", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes([
        { number: 1, title: "Real issue", state: "open", html_url: "u1" },
        { number: 2, title: "A PR", state: "open", html_url: "u2", pull_request: {} },
      ])
    );
    const result = await githubListIssues({ owner: "acme", repo: "infra" });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].number).toBe(1);
  });

  it("getIssue extracts label names", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        number: 1,
        title: "Bug",
        state: "open",
        body: "desc",
        labels: [{ name: "bug" }, { name: "p1" }],
        html_url: "u",
      })
    );
    const result = await githubGetIssue({ owner: "acme", repo: "infra", issue_number: 1 });
    expect(result.labels).toEqual(["bug", "p1"]);
  });

  it("updateIssue only sends fields explicitly provided", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ number: 1, title: "New title", state: "open", html_url: "u" }));
    await githubUpdateIssue({ owner: "acme", repo: "infra", issue_number: 1, title: "New title" });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ title: "New title" });
    expect(global.fetch.mock.calls[0][1].method).toBe("PATCH");
  });

  it("addComment posts a comment and returns id/url", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ id: 99, html_url: "u" }));
    const result = await githubAddComment({ owner: "acme", repo: "infra", issue_number: 1, body: "LGTM" });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ body: "LGTM" });
    expect(result).toEqual({ id: 99, html_url: "u" });
  });
});

describe("githubOps — pull requests", () => {
  it("createPullRequest defaults base to main", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ number: 5, html_url: "u", title: "Feature", state: "open" }));
    await githubCreatePullRequest({ owner: "acme", repo: "infra", title: "Feature", head: "feat/x" });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.base).toBe("main");
  });

  it("listPullRequests maps to simplified fields", async () => {
    global.fetch.mockReturnValueOnce(jsonRes([{ number: 5, title: "Feature", state: "open", html_url: "u" }]));
    const result = await githubListPullRequests({ owner: "acme", repo: "infra" });
    expect(result.pull_requests).toEqual([{ number: 5, title: "Feature", state: "open", html_url: "u" }]);
  });

  it("getPullRequest extracts head/base ref names", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        number: 5,
        title: "Feature",
        state: "open",
        body: "desc",
        head: { ref: "feat/x" },
        base: { ref: "main" },
        mergeable: true,
        merged: false,
        html_url: "u",
      })
    );
    const result = await githubGetPullRequest({ owner: "acme", repo: "infra", pull_number: 5 });
    expect(result.head).toBe("feat/x");
    expect(result.base).toBe("main");
  });

  it("updatePullRequest only sends explicitly provided fields", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ number: 5, title: "T", state: "closed", html_url: "u" }));
    await githubUpdatePullRequest({ owner: "acme", repo: "infra", pull_number: 5, state: "closed" });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ state: "closed" });
  });

  it("mergePullRequest defaults merge_method to 'merge'", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ merged: true, sha: "abc", message: "ok" }));
    const result = await githubMergePullRequest({ owner: "acme", repo: "infra", pull_number: 5 });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.merge_method).toBe("merge");
    expect(global.fetch.mock.calls[0][1].method).toBe("PUT");
    expect(result.merged).toBe(true);
  });

  it("mergePullRequest includes commit_title/message only when given", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ merged: true, sha: "abc", message: "ok" }));
    await githubMergePullRequest({
      owner: "acme",
      repo: "infra",
      pull_number: 5,
      commit_title: "Merge feat/x",
    });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.commit_title).toBe("Merge feat/x");
    expect(body.commit_message).toBeUndefined();
  });

  it("getPullRequestFiles maps additions/deletions/changes", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes([{ filename: "a.js", status: "modified", additions: 3, deletions: 1, changes: 4 }])
    );
    const result = await githubGetPullRequestFiles({ owner: "acme", repo: "infra", pull_number: 5 });
    expect(result.files[0]).toEqual({ filename: "a.js", status: "modified", additions: 3, deletions: 1, changes: 4 });
  });

  it("getPullRequestDiff requests the diff media type and returns raw text", async () => {
    global.fetch.mockReturnValueOnce(textRes("diff --git a/a.js b/a.js\n..."));
    const result = await githubGetPullRequestDiff({ owner: "acme", repo: "infra", pull_number: 5 });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Accept).toBe("application/vnd.github.v3.diff");
    expect(result.diff).toContain("diff --git");
  });

  it("getPullRequestDiff throws on a failed response", async () => {
    global.fetch.mockReturnValueOnce(textRes("", false, 404));
    await expect(githubGetPullRequestDiff({ owner: "acme", repo: "infra", pull_number: 5 })).rejects.toThrow(
      /GitHub API error \(404\)/
    );
  });

  it("getPullRequestComments maps user login", async () => {
    global.fetch.mockReturnValueOnce(jsonRes([{ id: 1, user: { login: "kumar" }, body: "nice", html_url: "u" }]));
    const result = await githubGetPullRequestComments({ owner: "acme", repo: "infra", pull_number: 5 });
    expect(result.comments[0].user).toBe("kumar");
  });

  it("getPullRequestReviews maps review state", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes([{ id: 1, user: { login: "kumar" }, state: "APPROVED", body: "" }])
    );
    const result = await githubGetPullRequestReviews({ owner: "acme", repo: "infra", pull_number: 5 });
    expect(result.reviews[0].state).toBe("APPROVED");
  });
});

describe("githubOps — branches", () => {
  it("getBranch extracts commit sha", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ name: "main", protected: true, commit: { sha: "abc123" } }));
    const result = await githubGetBranch({ owner: "acme", repo: "infra", branch: "main" });
    expect(result.sha).toBe("abc123");
  });

  it("listBranches maps name/protected", async () => {
    global.fetch.mockReturnValueOnce(jsonRes([{ name: "main", protected: true }, { name: "dev", protected: false }]));
    const result = await githubListBranches({ owner: "acme", repo: "infra" });
    expect(result.branches).toHaveLength(2);
  });
});

describe("githubOps — workflows", () => {
  it("listWorkflows maps workflow fields", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({ workflows: [{ id: 1, name: "CI", path: ".github/workflows/ci.yml", state: "active" }] })
    );
    const result = await githubListWorkflows({ owner: "acme", repo: "infra" });
    expect(result.workflows).toEqual([{ id: 1, name: "CI", path: ".github/workflows/ci.yml", state: "active" }]);
  });

  it("listWorkflowRuns applies branch and status query params", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ workflow_runs: [] }));
    await githubListWorkflowRuns({ owner: "acme", repo: "infra", branch: "main", status: "failure" });
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain("branch=main");
    expect(url).toContain("status=failure");
  });

  it("listWorkflowRuns omits branch/status when not given", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ workflow_runs: [] }));
    await githubListWorkflowRuns({ owner: "acme", repo: "infra" });
    const url = global.fetch.mock.calls[0][0];
    expect(url).not.toContain("branch=");
    expect(url).not.toContain("status=");
  });

  it("getWorkflowRun maps run detail fields", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        id: 1,
        name: "CI",
        status: "completed",
        conclusion: "success",
        head_branch: "main",
        event: "push",
        html_url: "u",
        created_at: "t1",
        updated_at: "t2",
      })
    );
    const result = await githubGetWorkflowRun({ owner: "acme", repo: "infra", run_id: 1 });
    expect(result.conclusion).toBe("success");
    expect(result.branch).toBe("main");
  });

  it("getWorkflowRunJobs maps nested step details", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        jobs: [
          {
            id: 1,
            name: "build",
            status: "completed",
            conclusion: "failure",
            html_url: "u",
            steps: [{ name: "Run tests", status: "completed", conclusion: "failure" }],
          },
        ],
      })
    );
    const result = await githubGetWorkflowRunJobs({ owner: "acme", repo: "infra", run_id: 1 });
    expect(result.jobs[0].steps).toEqual([{ name: "Run tests", status: "completed", conclusion: "failure" }]);
  });

  it("getJobLogs follows redirects and returns raw log text", async () => {
    global.fetch.mockReturnValueOnce(textRes("log line 1\nlog line 2"));
    const result = await githubGetJobLogs({ owner: "acme", repo: "infra", job_id: 1 });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.redirect).toBe("follow");
    expect(result.logs).toBe("log line 1\nlog line 2");
  });

  it("rerunWorkflow targets the failed-jobs endpoint when failed_only is true", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({}));
    const result = await githubRerunWorkflow({ owner: "acme", repo: "infra", run_id: 1, failed_only: true });
    expect(global.fetch.mock.calls[0][0]).toContain("/rerun-failed-jobs");
    expect(result.requeued).toBe(true);
  });

  it("rerunWorkflow targets the plain rerun endpoint by default", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({}));
    await githubRerunWorkflow({ owner: "acme", repo: "infra", run_id: 1 });
    expect(global.fetch.mock.calls[0][0]).toContain("/rerun");
    expect(global.fetch.mock.calls[0][0]).not.toContain("/rerun-failed-jobs");
  });
});
