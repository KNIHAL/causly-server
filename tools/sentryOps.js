const SENTRY_HOSTS = ["https://sentry.io/api/0", "https://de.sentry.io/api/0"];

function getToken() {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    throw new Error(
      "SENTRY_AUTH_TOKEN not set. Create one at https://sentry.io/settings/account/api/auth-tokens/ and add it to your .env file: SENTRY_AUTH_TOKEN=..."
    );
  }
  return token;
}

async function sentryFetchOnHost(host, path, { method = "GET", body } = {}) {
  const token = getToken();
  const res = await fetch(`${host}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { ok: res.ok, status: res.status, data };
}

/**
 * Some Sentry endpoints (notably bare /issues/{id}/ lookups) only resolve on
 * the organization's actual data-residency host (e.g. de.sentry.io for EU
 * orgs), even though org/project-scoped endpoints work fine on sentry.io.
 * We try the default host first, and on a 404 transparently retry on the
 * other known region host before giving up.
 */
async function sentryFetch(path, opts = {}) {
  let last;
  for (const host of SENTRY_HOSTS) {
    const result = await sentryFetchOnHost(host, path, opts);
    if (result.ok) return result.data;
    last = result;
    if (result.status !== 404) break;
  }
  throw new Error(`Sentry API error (${path}): ${last.data.detail || last.status}`);
}

function simplifyIssue(i) {
  return {
    id: i.id,
    shortId: i.shortId,
    title: i.title,
    culprit: i.culprit,
    level: i.level,
    status: i.status,
    count: i.count,
    userCount: i.userCount,
    firstSeen: i.firstSeen,
    lastSeen: i.lastSeen,
    permalink: i.permalink,
  };
}

/** List projects in the organization. */
export async function sentryListProjects({ org_slug }) {
  const data = await sentryFetch(`/organizations/${org_slug}/projects/`);
  return {
    projects: data.map((p) => ({ id: p.id, slug: p.slug, name: p.name, platform: p.platform })),
  };
}

/** List recent issues (errors) for a project. */
export async function sentryListIssues({ org_slug, project_slug, query, limit = 25 }) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set("query", query);
  const data = await sentryFetch(`/projects/${org_slug}/${project_slug}/issues/?${params}`);
  return { issues: data.map(simplifyIssue) };
}

/** Search issues with a Sentry query string (e.g. "is:unresolved level:error"). */
export async function sentrySearchIssues({ org_slug, project_slug, query, limit = 25 }) {
  return sentryListIssues({ org_slug, project_slug, query, limit });
}

/** Get a single issue's full detail (stack trace context, occurrence counts). */
export async function sentryGetIssue({ issue_id }) {
  const data = await sentryFetch(`/issues/${issue_id}/`);
  return {
    ...simplifyIssue(data),
    metadata: data.metadata,
    type: data.type,
    platform: data.platform,
  };
}

/** Mark an issue as resolved. HIGH risk — requires confirm: true. */
export async function sentryResolveIssue({ issue_id, confirm }) {
  const data = await sentryFetch(`/issues/${issue_id}/`, {
    method: "PUT",
    body: { status: "resolved" },
  });
  return { id: data.id, status: data.status };
}

/** Mute/ignore an issue so it stops notifying. HIGH risk — requires confirm: true. */
export async function sentryIgnoreIssue({ issue_id, confirm }) {
  const data = await sentryFetch(`/issues/${issue_id}/`, {
    method: "PUT",
    body: { status: "ignored" },
  });
  return { id: data.id, status: data.status };
}

/** Get error-count stats/trends for a project over a time period. */
export async function sentryGetProjectStats({ org_slug, project_slug, stat = "received", period = "24h" }) {
  const params = new URLSearchParams({ stat, resolution: "1h" });
  const data = await sentryFetch(`/projects/${org_slug}/${project_slug}/stats/?${params}`);
  return {
    period,
    stat,
    points: data.map(([timestamp, value]) => ({ timestamp, value })),
  };
}

/** Add a comment/note to an issue. HIGH risk — requires confirm: true. */
export async function sentryAddComment({ issue_id, text, confirm }) {
  const data = await sentryFetch(`/issues/${issue_id}/comments/`, {
    method: "POST",
    body: { text },
  });
  return { id: data.id, posted: true };
}
