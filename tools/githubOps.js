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
