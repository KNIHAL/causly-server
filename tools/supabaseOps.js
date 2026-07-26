const SUPABASE_API = "https://api.supabase.com/v1";

function getToken() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN not set. Run `npm run setup` to configure it, or add it manually to your .env file: SUPABASE_ACCESS_TOKEN=sbp_..."
    );
  }
  return token;
}

async function supabaseFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${SUPABASE_API}${path}`, {
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
    const message = data?.message || res.statusText;
    throw new Error(`Supabase API error (${res.status}): ${message}`);
  }

  return data;
}

/** List organizations the authenticated account belongs to. Needed to create a new project. */
export async function supabaseListOrganizations() {
  const data = await supabaseFetch("/organizations");
  return { organizations: data.map((o) => ({ id: o.id, name: o.name })) };
}

/** List projects for the authenticated account. */
export async function supabaseListProjects() {
  const data = await supabaseFetch("/projects");
  return {
    projects: data.map((p) => ({
      id: p.id,
      name: p.name,
      region: p.region,
      status: p.status,
      organization_id: p.organization_id,
    })),
  };
}

/** Get details of a single project by its ref/ID. */
export async function supabaseGetProject({ project_ref }) {
  const data = await supabaseFetch(`/projects/${project_ref}`);
  return { id: data.id, name: data.name, region: data.region, status: data.status };
}

/**
 * Create a new Supabase project. Requires an organization_id
 * (use supabase_list_organizations to find it) and a database password.
 */
export async function supabaseCreateProject({ name, organization_id, db_pass, region = "ap-south-1", plan = "free" }) {
  const data = await supabaseFetch("/projects", {
    method: "POST",
    body: JSON.stringify({ name, organization_id, db_pass, region, plan }),
  });
  return { id: data.id, name: data.name, region: data.region, status: data.status };
}

/** Delete a Supabase project. */
export async function supabaseDeleteProject({ project_ref }) {
  await supabaseFetch(`/projects/${project_ref}`, { method: "DELETE" });
  return { project_ref, deleted: true };
}

/**
 * Run raw SQL against a project's database — the way to create tables,
 * alter schema, seed data, or run arbitrary queries.
 */
export async function supabaseRunSql({ project_ref, query }) {
  const data = await supabaseFetch(`/projects/${project_ref}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query }),
  });
  return { project_ref, result: data };
}
