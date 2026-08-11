const VERCEL_API = "https://api.vercel.com";

function getToken() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new Error(
      "VERCEL_TOKEN not set. Run `npm run setup` to configure it, or add it manually to your .env file: VERCEL_TOKEN=..."
    );
  }
  return token;
}

async function vercelFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${VERCEL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
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
    const message = data?.error?.message || res.statusText;
    throw new Error(`Vercel API error (${res.status}): ${message}`);
  }

  return data;
}

/** Get the authenticated Vercel user/team — connectivity/auth check. */
export async function vercelGetAuthenticatedUser() {
  const data = await vercelFetch("/v2/user");
  return { id: data.user.id, username: data.user.username, email: data.user.email };
}

/** List projects for the authenticated user/team. */
export async function vercelListProjects({ limit = 20 }) {
  const data = await vercelFetch(`/v9/projects?limit=${limit}`);
  return {
    projects: data.projects.map((p) => ({
      id: p.id,
      name: p.name,
      framework: p.framework,
      latest_url: p.targets?.production?.url || null,
    })),
  };
}

/** Get details of a single project by name or ID. */
export async function vercelGetProject({ project }) {
  const data = await vercelFetch(`/v9/projects/${project}`);
  return {
    id: data.id,
    name: data.name,
    framework: data.framework,
    link: data.link ? { type: data.link.type, repo: `${data.link.org}/${data.link.repo}` } : null,
  };
}

/** List recent deployments, optionally scoped to a project. */
export async function vercelListDeployments({ project, limit = 10 }) {
  const query = project ? `?projectId=${project}&limit=${limit}` : `?limit=${limit}`;
  const data = await vercelFetch(`/v6/deployments${query}`);
  return {
    deployments: data.deployments.map((d) => ({
      uid: d.uid,
      name: d.name,
      url: d.url,
      state: d.state,
      created: new Date(d.created).toISOString(),
    })),
  };
}

/** Get the status/details of a specific deployment. */
export async function vercelGetDeployment({ deployment_id }) {
  const data = await vercelFetch(`/v13/deployments/${deployment_id}`);
  return {
    uid: data.id,
    name: data.name,
    url: data.url,
    state: data.readyState,
    created: new Date(data.createdAt).toISOString(),
  };
}

/**
 * Resolve a GitHub "owner/repo" string to the numeric repo ID Vercel's
 * gitSource requires. Uses GITHUB_TOKEN if set; falls back to an
 * unauthenticated call for public repos if it isn't.
 */
async function resolveGithubRepoId(ownerSlashRepo) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "causly-server" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await fetch(`https://api.github.com/repos/${ownerSlashRepo}`, { headers });
  if (!res.ok) {
    throw new Error(
      `Could not resolve GitHub repo "${ownerSlashRepo}" to an ID (${res.status}). Check the owner/repo is correct and accessible.`
    );
  }
  const data = await res.json();
  return data.id;
}

/**
 * Trigger a new deployment for a git-connected project by redeploying
 * from a given git ref (branch/commit). Vercel's API needs the numeric
 * GitHub repo ID (not just "owner/repo"), so this resolves it via the
 * GitHub API automatically.
 */
export async function vercelCreateDeployment({ name, project, git_source_repo, git_source_ref = "main", git_source_type = "github" }) {
  const repoId = await resolveGithubRepoId(git_source_repo);

  const data = await vercelFetch("/v13/deployments", {
    method: "POST",
    body: JSON.stringify({
      name,
      project,
      gitSource: {
        type: git_source_type,
        repoId,
        ref: git_source_ref,
      },
    }),
  });
  return { uid: data.id, url: data.url, state: data.readyState };
}

/** Delete a project. */
export async function vercelDeleteProject({ project }) {
  await vercelFetch(`/v9/projects/${project}`, { method: "DELETE" });
  return { project, deleted: true };
}

/** Get build/runtime logs for a deployment. */
export async function vercelGetDeploymentLogs({ deployment_id, limit = 200 }) {
  const data = await vercelFetch(`/v3/deployments/${deployment_id}/events?limit=${limit}`);
  const events = Array.isArray(data) ? data : data.events || [];
  return {
    deployment_id,
    logs: events.map((e) => ({ type: e.type, text: e.text ?? e.payload?.text, created: e.created })),
  };
}

/** Get deployment build/progress events (separate from raw logs — includes build step states). */
export async function vercelGetDeploymentEvents({ deployment_id }) {
  const data = await vercelFetch(`/v13/deployments/${deployment_id}`);
  return {
    deployment_id,
    state: data.readyState,
    ready_substate: data.readySubstate,
    checks_state: data.checksState,
    build_errors: data.errorMessage ? { message: data.errorMessage, code: data.errorCode } : null,
  };
}

/** Cancel a currently building/queued deployment. */
export async function vercelCancelDeployment({ deployment_id }) {
  const data = await vercelFetch(`/v12/deployments/${deployment_id}/cancel`, { method: "PATCH" });
  return { deployment_id, state: data.readyState };
}

/** Hit a URL and report status/response time — used to verify a deployment is actually healthy after it goes live. */
export async function httpCheck({ url, timeout_ms = 10_000 }) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout_ms);
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    clearTimeout(timer);
    const response_time_ms = Date.now() - start;
    return {
      url,
      status: res.status,
      healthy: res.status >= 200 && res.status < 400,
      response_time_ms,
    };
  } catch (err) {
    return {
      url,
      status: null,
      healthy: false,
      response_time_ms: Date.now() - start,
      error: err.name === "AbortError" ? "timeout" : err.message,
    };
  }
}
