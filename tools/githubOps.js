const GITHUB_API = "https://api.github.com";

function getToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN not set. Run `npm run setup` to configure it, or add it manually to your .env file: GITHUB_TOKEN=github_pat_..."
    );
  }
  return token;
}

async function githubFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "causly-server",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message = data?.message || res.statusText;
    throw new Error(`GitHub API error (${res.status}): ${message}`);
  }

  return data;
}

/** Get the authenticated user's profile — useful as a connectivity/auth check. */
export async function githubGetAuthenticatedUser() {
  const data = await githubFetch("/user");
  return { login: data.login, name: data.name, public_repos: data.public_repos };
}

/** Create a new repository for the authenticated user. */
export async function githubCreateRepo({ name, description = "", private: isPrivate = false, auto_init = true }) {
  const data = await githubFetch("/user/repos", {
    method: "POST",
    body: JSON.stringify({ name, description, private: isPrivate, auto_init }),
  });
  return { name: data.name, full_name: data.full_name, html_url: data.html_url, clone_url: data.clone_url };
}

/** Delete a repository. Requires Administration: write on the token. */
export async function githubDeleteRepo({ owner, repo }) {
  await githubFetch(`/repos/${owner}/${repo}`, { method: "DELETE" });
  return { owner, repo, deleted: true };
}

/** List repositories for the authenticated user. */
export async function githubListRepos({ per_page = 30, sort = "updated" }) {
  const data = await githubFetch(`/user/repos?per_page=${per_page}&sort=${sort}`);
  return {
    repos: data.map((r) => ({ name: r.name, full_name: r.full_name, private: r.private, html_url: r.html_url })),
  };
}

/** Create an issue on a repository. */
export async function githubCreateIssue({ owner, repo, title, body = "", labels = [] }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels }),
  });
  return { number: data.number, html_url: data.html_url, title: data.title };
}

/** List issues on a repository. */
export async function githubListIssues({ owner, repo, state = "open", per_page = 30 }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/issues?state=${state}&per_page=${per_page}`);
  return {
    issues: data
      .filter((i) => !i.pull_request) // GitHub's issues endpoint also returns PRs
      .map((i) => ({ number: i.number, title: i.title, state: i.state, html_url: i.html_url })),
  };
}

/** Create a pull request. */
export async function githubCreatePullRequest({ owner, repo, title, head, base = "main", body = "" }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, head, base, body }),
  });
  return { number: data.number, html_url: data.html_url, title: data.title, state: data.state };
}

/** List pull requests on a repository. */
export async function githubListPullRequests({ owner, repo, state = "open", per_page = 30 }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${per_page}`);
  return {
    pull_requests: data.map((p) => ({ number: p.number, title: p.title, state: p.state, html_url: p.html_url })),
  };
}

/** Add a comment to an issue or pull request (both share the same comments endpoint). */
export async function githubAddComment({ owner, repo, issue_number, body }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/issues/${issue_number}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  return { id: data.id, html_url: data.html_url };
}

/** Get a repository's details. */
export async function githubGetRepo({ owner, repo }) {
  const data = await githubFetch(`/repos/${owner}/${repo}`);
  return {
    name: data.name,
    full_name: data.full_name,
    private: data.private,
    default_branch: data.default_branch,
    html_url: data.html_url,
    description: data.description,
    open_issues_count: data.open_issues_count,
    language: data.language,
  };
}

/** Get a single issue. */
export async function githubGetIssue({ owner, repo, issue_number }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/issues/${issue_number}`);
  return {
    number: data.number,
    title: data.title,
    state: data.state,
    body: data.body,
    labels: data.labels?.map((l) => l.name),
    html_url: data.html_url,
  };
}

/** Update an issue (title, body, state, labels). */
export async function githubUpdateIssue({ owner, repo, issue_number, title, body, state, labels }) {
  const payload = {};
  if (title !== undefined) payload.title = title;
  if (body !== undefined) payload.body = body;
  if (state !== undefined) payload.state = state;
  if (labels !== undefined) payload.labels = labels;
  const data = await githubFetch(`/repos/${owner}/${repo}/issues/${issue_number}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return { number: data.number, title: data.title, state: data.state, html_url: data.html_url };
}

/** Get a single pull request. */
export async function githubGetPullRequest({ owner, repo, pull_number }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/pulls/${pull_number}`);
  return {
    number: data.number,
    title: data.title,
    state: data.state,
    body: data.body,
    head: data.head?.ref,
    base: data.base?.ref,
    mergeable: data.mergeable,
    merged: data.merged,
    html_url: data.html_url,
  };
}

/** Update a pull request (title, body, state, base). */
export async function githubUpdatePullRequest({ owner, repo, pull_number, title, body, state, base }) {
  const payload = {};
  if (title !== undefined) payload.title = title;
  if (body !== undefined) payload.body = body;
  if (state !== undefined) payload.state = state;
  if (base !== undefined) payload.base = base;
  const data = await githubFetch(`/repos/${owner}/${repo}/pulls/${pull_number}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return { number: data.number, title: data.title, state: data.state, html_url: data.html_url };
}

/** Merge a pull request. */
export async function githubMergePullRequest({ owner, repo, pull_number, merge_method = "merge", commit_title, commit_message }) {
  const payload = { merge_method };
  if (commit_title) payload.commit_title = commit_title;
  if (commit_message) payload.commit_message = commit_message;
  const data = await githubFetch(`/repos/${owner}/${repo}/pulls/${pull_number}/merge`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return { merged: data.merged, sha: data.sha, message: data.message };
}

/** List files changed in a pull request. */
export async function githubGetPullRequestFiles({ owner, repo, pull_number, per_page = 30 }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/pulls/${pull_number}/files?per_page=${per_page}`);
  return {
    files: data.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
    })),
  };
}

/** Get the raw diff of a pull request. */
export async function githubGetPullRequestDiff({ owner, repo, pull_number }) {
  const token = getToken();
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pull_number}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3.diff",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "causly-server",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error (${res.status}): ${res.statusText}`);
  }
  const diff = await res.text();
  return { owner, repo, pull_number, diff };
}

/** List comments on a pull request (issue-style conversation comments). */
export async function githubGetPullRequestComments({ owner, repo, pull_number, per_page = 30 }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/issues/${pull_number}/comments?per_page=${per_page}`);
  return {
    comments: data.map((c) => ({ id: c.id, user: c.user?.login, body: c.body, html_url: c.html_url })),
  };
}

/** List reviews on a pull request. */
export async function githubGetPullRequestReviews({ owner, repo, pull_number, per_page = 30 }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/pulls/${pull_number}/reviews?per_page=${per_page}`);
  return {
    reviews: data.map((r) => ({ id: r.id, user: r.user?.login, state: r.state, body: r.body })),
  };
}

/** Get details of a single branch. */
export async function githubGetBranch({ owner, repo, branch }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/branches/${branch}`);
  return {
    name: data.name,
    protected: data.protected,
    sha: data.commit?.sha,
  };
}

/** List branches on a repository. */
export async function githubListBranches({ owner, repo, per_page = 30 }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/branches?per_page=${per_page}`);
  return {
    branches: data.map((b) => ({ name: b.name, protected: b.protected })),
  };
}

/** List workflows defined in a repository. */
export async function githubListWorkflows({ owner, repo }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/actions/workflows`);
  return {
    workflows: data.workflows?.map((w) => ({
      id: w.id,
      name: w.name,
      path: w.path,
      state: w.state,
    })),
  };
}

/** List recent workflow runs, optionally filtered by branch or status. */
export async function githubListWorkflowRuns({ owner, repo, branch, status, per_page = 20 }) {
  const params = new URLSearchParams({ per_page: String(per_page) });
  if (branch) params.set("branch", branch);
  if (status) params.set("status", status);
  const data = await githubFetch(`/repos/${owner}/${repo}/actions/runs?${params.toString()}`);
  return {
    runs: data.workflow_runs?.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      branch: r.head_branch,
      event: r.event,
      html_url: r.html_url,
      created_at: r.created_at,
    })),
  };
}

/** Get details of a single workflow run. */
export async function githubGetWorkflowRun({ owner, repo, run_id }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/actions/runs/${run_id}`);
  return {
    id: data.id,
    name: data.name,
    status: data.status,
    conclusion: data.conclusion,
    branch: data.head_branch,
    event: data.event,
    html_url: data.html_url,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

/** List jobs for a workflow run, with per-job status/conclusion. */
export async function githubGetWorkflowRunJobs({ owner, repo, run_id }) {
  const data = await githubFetch(`/repos/${owner}/${repo}/actions/runs/${run_id}/jobs`);
  return {
    jobs: data.jobs?.map((j) => ({
      id: j.id,
      name: j.name,
      status: j.status,
      conclusion: j.conclusion,
      html_url: j.html_url,
      steps: j.steps?.map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion })),
    })),
  };
}

/** Get the raw log text for a job. */
export async function githubGetJobLogs({ owner, repo, job_id }) {
  const token = getToken();
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/jobs/${job_id}/logs`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "causly-server",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`GitHub API error (${res.status}): ${res.statusText}`);
  }
  const logs = await res.text();
  return { owner, repo, job_id, logs };
}

/** Re-run a workflow run (all jobs, or only failed jobs). */
export async function githubRerunWorkflow({ owner, repo, run_id, failed_only = false }) {
  const path = failed_only
    ? `/repos/${owner}/${repo}/actions/runs/${run_id}/rerun-failed-jobs`
    : `/repos/${owner}/${repo}/actions/runs/${run_id}/rerun`;
  await githubFetch(path, { method: "POST" });
  return { owner, repo, run_id, failed_only, requeued: true };
}
