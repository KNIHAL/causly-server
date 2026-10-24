// Linear tools over the GraphQL API. No new dependencies; an API key is all that is needed.
//
//   linear_get_viewer    check the key, show who it belongs to
//   linear_list_teams    teams with their workflow states and labels (names the other tools accept)
//   linear_list_issues   find issues by team, assignee, state, label, priority, text
//   linear_get_issue     one issue in full, with recent comments
//   linear_create_issue  create an issue
//   linear_update_issue  change state, assignee, priority, labels, title, description, due date
//   linear_add_comment   comment on an issue
//
// Credentials: LINEAR_API_KEY (Linear > Settings > Account > Security & access > Personal API keys).
// There is deliberately no delete tool: close an issue by moving it to a Canceled state.
import { UNTRUSTED_NOTICE } from "./webOps.js";

const API = "https://api.linear.app/graphql";
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];
const PRIORITIES = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };

// ---------------------------------------------------------------- client

function client(deps = {}) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("Linear is not set up. Missing: LINEAR_API_KEY (create a personal API key in Linear settings and add it to .env).");
  const scrub = (text) => String(text).split(apiKey).join("[REDACTED]");
  return async function gql(query, variables = {}) {
    let res;
    try {
      res = await fetchFn(API, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: apiKey.startsWith("lin_oauth_") ? `Bearer ${apiKey}` : apiKey },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new Error(`Could not reach Linear: ${scrub(err.message)}`);
    }
    const data = await res.json().catch(() => ({}));
    const err = data.errors?.[0];
    if (res.status === 401 || res.status === 403 || err?.extensions?.type === "authentication error") {
      throw new Error("Linear rejected the API key. Check LINEAR_API_KEY.");
    }
    if (res.status === 429 || err?.extensions?.code === "RATELIMITED") throw new Error("Linear rate limit hit. Wait a minute and try again.");
    if (!res.ok || err) {
      const msg = err?.extensions?.userPresentableMessage || err?.message || `HTTP ${res.status}`;
      throw new Error(`Linear error: ${scrub(msg)}`);
    }
    return data.data;
  };
}

// ---------------------------------------------------------------- shaping

const ISSUE_FIELDS = `id identifier title priority priorityLabel dueDate estimate createdAt updatedAt url
  state { name type } assignee { name email } labels { nodes { name } } team { key name } project { name }`;

function simplify(i, { description = false } = {}) {
  return {
    identifier: i.identifier,
    title: i.title,
    state: i.state?.name,
    state_type: i.state?.type,
    priority: i.priorityLabel,
    assignee: i.assignee ? i.assignee.name : null,
    ...(i.assignee?.email ? { assignee_email: i.assignee.email } : {}),
    labels: (i.labels?.nodes || []).map((l) => l.name),
    team: i.team?.key,
    ...(i.project ? { project: i.project.name } : {}),
    ...(i.dueDate ? { due_date: i.dueDate } : {}),
    ...(i.estimate != null ? { estimate: i.estimate } : {}),
    ...(description && i.description ? { description: String(i.description).slice(0, 4000) } : {}),
    created: i.createdAt,
    updated: i.updatedAt,
    url: i.url,
  };
}

export function parsePriority(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const key = String(v).trim().toLowerCase();
  if (key in PRIORITIES) return PRIORITIES[key];
  const n = Number(key);
  if (Number.isInteger(n) && n >= 0 && n <= 4) return n;
  throw new Error("priority must be urgent, high, medium, low or none (or 0-4, where 1 is urgent).");
}

function checkDueDate(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error("due_date must look like 2026-10-31.");
  return s;
}

function checkIssueRef(ref) {
  const s = String(ref ?? "").trim();
  if (!IDENT.test(s) && !UUID.test(s)) throw new Error("issue must be an identifier like ENG-123 (or an issue id).");
  return s;
}

const teamFilter = (team) => (UUID.test(team) ? { id: { eq: team } } : { key: { eqIgnoreCase: String(team).trim() } });

// ---------------------------------------------------------------- resolvers (names -> ids)

async function resolveUser(gql, who) {
  const s = String(who).trim();
  if (s.toLowerCase() === "me") return (await gql("query { viewer { id } }")).viewer.id;
  const data = await gql(
    `query($f: UserFilter) { users(first: 10, filter: $f) { nodes { id name email active } } }`,
    { f: { or: [{ email: { eqIgnoreCase: s } }, { name: { containsIgnoreCase: s } }, { displayName: { containsIgnoreCase: s } }] } }
  );
  const found = (data.users.nodes || []).filter((u) => u.active !== false);
  const exact = found.filter((u) => u.email?.toLowerCase() === s.toLowerCase());
  const pick = exact.length === 1 ? exact : found;
  if (pick.length === 1) return pick[0].id;
  if (!pick.length) throw new Error(`No Linear user matches "${s}". Use their email address or "me".`);
  throw new Error(`"${s}" matches several people (${pick.map((u) => `${u.name} <${u.email}>`).join(", ")}). Use an email address.`);
}

async function loadTeams(gql) {
  const data = await gql(`query { teams(first: 50) { nodes { id key name states(first: 30) { nodes { id name type } } } } }`);
  return data.teams.nodes;
}

function findTeam(teams, ref) {
  const s = String(ref ?? "").trim();
  if (!s) throw new Error("team is required (the team key, like ENG).");
  const hit = teams.find((t) => t.key.toLowerCase() === s.toLowerCase() || t.name.toLowerCase() === s.toLowerCase() || t.id === s);
  if (!hit) throw new Error(`No team "${s}". Teams: ${teams.map((t) => t.key).join(", ")}.`);
  return hit;
}

function findState(team, name) {
  const s = String(name).trim().toLowerCase();
  const states = team.states.nodes;
  const hit = states.find((x) => x.name.toLowerCase() === s);
  if (!hit) throw new Error(`Team ${team.key} has no state "${name}". States: ${states.map((x) => x.name).join(", ")}.`);
  return hit.id;
}

/** Label names -> ids. Workspace labels and the team's own labels are both allowed. */
async function resolveLabels(gql, teamId, names) {
  const data = await gql(`query { issueLabels(first: 250) { nodes { id name team { id } } } }`);
  const usable = data.issueLabels.nodes.filter((l) => !l.team || l.team.id === teamId);
  return names.map((n) => {
    const hit = usable.find((l) => l.name.toLowerCase() === String(n).trim().toLowerCase());
    if (!hit) throw new Error(`No label "${n}" for this team. Labels: ${usable.map((l) => l.name).join(", ") || "(none)"}.`);
    return hit.id;
  });
}

const stringList = (v, label) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error(`${label} must be a list of names.`);
  return [...new Set(v.map((x) => String(x).trim()).filter(Boolean))];
};

// ---------------------------------------------------------------- tools

export async function getViewer(_input = {}, deps = {}) {
  const gql = client(deps);
  const { viewer, organization } = await gql(`query { viewer { id name email } organization { name urlKey } }`);
  return { id: viewer.id, name: viewer.name, email: viewer.email, workspace: organization?.name, workspace_key: organization?.urlKey };
}

export async function listTeams(_input = {}, deps = {}) {
  const gql = client(deps);
  const [teams, labels] = await Promise.all([
    loadTeams(gql),
    gql(`query { issueLabels(first: 250) { nodes { name team { key } } } }`),
  ]);
  return {
    count: teams.length,
    teams: teams.map((t) => ({
      key: t.key,
      name: t.name,
      states: t.states.nodes.map((s) => ({ name: s.name, type: s.type })),
      labels: labels.issueLabels.nodes.filter((l) => !l.team || l.team.key === t.key).map((l) => l.name),
    })),
  };
}

export async function listIssues({ team, assignee, state, label, priority, query, project, include_closed = false, limit = 25 } = {}, deps = {}) {
  const gql = client(deps);
  const filter = {};
  if (team) filter.team = teamFilter(String(team));
  if (assignee) {
    const a = String(assignee).trim();
    filter.assignee = a.toLowerCase() === "me" ? { isMe: { eq: true } } : a.toLowerCase() === "unassigned" ? { null: true } : { id: { eq: await resolveUser(gql, a) } };
  }
  if (state) {
    const s = String(state).trim().toLowerCase();
    filter.state = STATE_TYPES.includes(s) ? { type: { eq: s } } : { name: { eqIgnoreCase: String(state).trim() } };
  } else if (!include_closed) {
    filter.state = { type: { nin: ["completed", "canceled"] } };
  }
  if (label) filter.labels = { name: { eqIgnoreCase: String(label).trim() } };
  const p = parsePriority(priority);
  if (p !== undefined) filter.priority = { eq: p };
  if (project) filter.project = { name: { containsIgnoreCase: String(project).trim() } };
  if (query && String(query).trim()) {
    const q = String(query).trim();
    filter.or = [{ title: { containsIgnoreCase: q } }, { description: { containsIgnoreCase: q } }];
  }
  const max = clamp(Math.trunc(Number(limit)) || 25, 1, 100);
  const data = await gql(
    `query($filter: IssueFilter, $first: Int) { issues(first: $first, filter: $filter, orderBy: updatedAt) { nodes { ${ISSUE_FIELDS} } } }`,
    { filter, first: max }
  );
  const issues = data.issues.nodes.map((i) => simplify(i));
  return {
    count: issues.length,
    ...(include_closed || state ? {} : { note: "Completed and canceled issues are hidden. Pass include_closed: true or a state to see them." }),
    issues,
    notice: UNTRUSTED_NOTICE,
  };
}

export async function getIssue({ issue } = {}, deps = {}) {
  const ref = checkIssueRef(issue);
  const gql = client(deps);
  const data = await gql(
    `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} description comments(first: 20) { nodes { body createdAt user { name } } } } }`,
    { id: ref }
  );
  if (!data.issue) throw new Error(`No issue ${ref}.`);
  return {
    issue: simplify(data.issue, { description: true }),
    comments: (data.issue.comments?.nodes || []).map((c) => ({ by: c.user?.name ?? "unknown", at: c.createdAt, text: String(c.body).slice(0, 1500) })),
    notice: UNTRUSTED_NOTICE,
  };
}

export async function createIssue({ team, title, description, priority, assignee, state, labels, due_date } = {}, deps = {}) {
  if (!title || !String(title).trim()) throw new Error("title is required.");
  const prio = parsePriority(priority);
  const due = checkDueDate(due_date);
  const labelNames = stringList(labels, "labels");
  const gql = client(deps);

  const t = findTeam(await loadTeams(gql), team);
  const input = { teamId: t.id, title: String(title).trim() };
  if (description) input.description = String(description);
  if (prio !== undefined) input.priority = prio;
  if (due) input.dueDate = due;
  if (state) input.stateId = findState(t, state);
  if (assignee) input.assigneeId = await resolveUser(gql, assignee);
  if (labelNames.length) input.labelIds = await resolveLabels(gql, t.id, labelNames);

  const data = await gql(`mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } } }`, { input });
  if (!data.issueCreate?.success) throw new Error("Linear did not create the issue.");
  return { created: true, issue: simplify(data.issueCreate.issue) };
}

export async function updateIssue({ issue, title, description, priority, assignee, state, add_labels, remove_labels, due_date } = {}, deps = {}) {
  const ref = checkIssueRef(issue);
  const prio = parsePriority(priority);
  const due = due_date === null || due_date === "" ? null : checkDueDate(due_date);
  const add = stringList(add_labels, "add_labels");
  const remove = stringList(remove_labels, "remove_labels");
  const gql = client(deps);

  const current = await gql(
    `query($id: String!) { issue(id: $id) { id identifier team { id key states(first: 100) { nodes { id name type } } } labels { nodes { id name } } } }`,
    { id: ref }
  );
  if (!current.issue) throw new Error(`No issue ${ref}.`);
  const cur = current.issue;

  const input = {};
  if (title !== undefined) input.title = String(title);
  if (description !== undefined) input.description = String(description);
  if (prio !== undefined) input.priority = prio;
  if (due !== undefined) input.dueDate = due;
  if (state) input.stateId = findState(cur.team, state);
  if (assignee !== undefined) {
    input.assigneeId = String(assignee).trim().toLowerCase() === "unassigned" ? null : await resolveUser(gql, assignee);
  }
  if (add.length || remove.length) {
    const removeIds = new Set(cur.labels.nodes.filter((l) => remove.some((n) => n.toLowerCase() === l.name.toLowerCase())).map((l) => l.id));
    const addIds = add.length ? await resolveLabels(gql, cur.team.id, add) : [];
    input.labelIds = [...new Set([...cur.labels.nodes.map((l) => l.id).filter((id) => !removeIds.has(id)), ...addIds])];
  }
  if (!Object.keys(input).length) throw new Error("Nothing to change. Pass title, description, priority, assignee, state, add_labels, remove_labels or due_date.");

  const data = await gql(`mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`, { id: cur.id, input });
  if (!data.issueUpdate?.success) throw new Error("Linear did not update the issue.");
  return { updated: true, issue: simplify(data.issueUpdate.issue) };
}

export async function addComment({ issue, body } = {}, deps = {}) {
  const ref = checkIssueRef(issue);
  if (!body || !String(body).trim()) throw new Error("body is required.");
  const gql = client(deps);
  const found = await gql(`query($id: String!) { issue(id: $id) { id identifier } }`, { id: ref });
  if (!found.issue) throw new Error(`No issue ${ref}.`);
  const data = await gql(`mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }`, {
    input: { issueId: found.issue.id, body: String(body) },
  });
  if (!data.commentCreate?.success) throw new Error("Linear did not add the comment.");
  return { commented: true, issue: found.issue.identifier, url: data.commentCreate.comment?.url };
}
