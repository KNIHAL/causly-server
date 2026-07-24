const VERCEL_API = "https://api.vercel.com";

function getToken() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new Error(
      "VERCEL_TOKEN not set. Add it to your .env file in the server root: VERCEL_TOKEN=..."
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
 * Trigger a new deployment for a git-connected project by redeploying
 * from a given git ref (branch/commit). The project must already be
 * linked to a git repo in Vercel.
 */
export async function vercelCreateDeployment({ name, project, git_source_repo, git_source_ref = "main", git_source_type = "github" }) {
  const data = await vercelFetch("/v13/deployments", {
    method: "POST",
    body: JSON.stringify({
      name,
      project,
      gitSource: {
        type: git_source_type,
        repo: git_source_repo,
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
