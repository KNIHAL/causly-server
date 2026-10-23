import { describe, it, expect, beforeEach } from "vitest";
import * as lin from "../tools/linearOps.js";

const KEY = "lin_api_SECRETKEY123";

/** fetch stub: each call gets { query, variables }; the handler returns the GraphQL `data`. */
function stub(handler, { status = 200, errors } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, ...body });
    if (status !== 200) return { ok: false, status, json: async () => ({ errors }) };
    if (errors) return { ok: true, status: 200, json: async () => ({ errors }) };
    const data = await handler(body);
    if (data instanceof Error) throw data;
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  return { deps: { fetch }, calls };
}

const TEAMS = {
  teams: {
    nodes: [
      {
        id: "team-eng",
        key: "ENG",
        name: "Engineering",
        states: { nodes: [{ id: "s-todo", name: "Todo", type: "unstarted" }, { id: "s-prog", name: "In Progress", type: "started" }, { id: "s-done", name: "Done", type: "completed" }] },
      },
    ],
  },
};
const LABELS = { issueLabels: { nodes: [{ id: "l-bug", name: "Bug", team: null }, { id: "l-lead", name: "Lead", team: { id: "team-eng", key: "ENG" } }, { id: "l-other", name: "Other", team: { id: "team-x", key: "X" } }] } };
const issue = (extra = {}) => ({
  id: "uuid-1",
  identifier: "ENG-1",
  title: "Fix login",
  priority: 2,
  priorityLabel: "High",
  state: { name: "Todo", type: "unstarted" },
  assignee: { name: "Kumar", email: "k@x.com" },
  labels: { nodes: [{ name: "Bug" }] },
  team: { key: "ENG", name: "Engineering" },
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  url: "https://linear.app/x/issue/ENG-1",
  ...extra,
});

beforeEach(() => {
  process.env.LINEAR_API_KEY = KEY;
});

describe("linearOps — setup and errors", () => {
  it("explains a missing key", async () => {
    delete process.env.LINEAR_API_KEY;
    await expect(lin.getViewer({}, stub(() => ({})).deps)).rejects.toThrow(/LINEAR_API_KEY/);
  });

  it("sends a personal key as-is and an OAuth token as Bearer", async () => {
    const a = stub(() => ({ viewer: { id: "u", name: "K", email: "k@x.com" }, organization: { name: "Causly", urlKey: "causly" } }));
    const me = await lin.getViewer({}, a.deps);
    expect(a.calls[0].url).toBe("https://api.linear.app/graphql");
    expect(a.calls[0].headers.authorization).toBe(KEY);
    expect(me).toEqual({ id: "u", name: "K", email: "k@x.com", workspace: "Causly", workspace_key: "causly" });

    process.env.LINEAR_API_KEY = "lin_oauth_abc";
    const b = stub(() => ({ viewer: {}, organization: {} }));
    await lin.getViewer({}, b.deps);
    expect(b.calls[0].headers.authorization).toBe("Bearer lin_oauth_abc");
  });

  it("maps auth and rate-limit failures", async () => {
    await expect(lin.getViewer({}, stub(null, { status: 401, errors: [{ message: "x" }] }).deps)).rejects.toThrow(/rejected the API key/);
    await expect(lin.getViewer({}, stub(null, { status: 429, errors: [{ message: "x" }] }).deps)).rejects.toThrow(/rate limit/);
    await expect(lin.getViewer({}, stub(null, { errors: [{ message: "x", extensions: { code: "RATELIMITED" } }] }).deps)).rejects.toThrow(/rate limit/);
  });

  it("surfaces GraphQL errors and never leaks the key", async () => {
    await expect(lin.getViewer({}, stub(null, { errors: [{ message: "Argument Validation Error" }] }).deps)).rejects.toThrow(/Linear error: Argument Validation Error/);
    const leak = stub(() => new Error(`boom ${KEY}`));
    await expect(lin.getViewer({}, leak.deps)).rejects.toThrow(/Could not reach Linear/);
    await lin.getViewer({}, leak.deps).catch((e) => expect(e.message).not.toContain("SECRETKEY"));
  });
});

describe("linearOps — priority and refs", () => {
  it("parses priorities by name or number", () => {
    expect(lin.parsePriority("Urgent")).toBe(1);
    expect(lin.parsePriority("low")).toBe(4);
    expect(lin.parsePriority(0)).toBe(0);
    expect(lin.parsePriority("3")).toBe(3);
    expect(lin.parsePriority(undefined)).toBeUndefined();
    expect(() => lin.parsePriority("asap")).toThrow(/priority must be/);
    expect(() => lin.parsePriority(9)).toThrow(/priority must be/);
  });

  it("rejects a malformed issue reference before any call", async () => {
    const { deps, calls } = stub(() => ({}));
    await expect(lin.getIssue({ issue: "login bug" }, deps)).rejects.toThrow(/identifier like ENG-123/);
    expect(calls).toHaveLength(0);
  });
});

describe("linearOps — reading", () => {
  it("lists teams with their states and the labels usable in each", async () => {
    const { deps } = stub((b) => (b.query.includes("issueLabels") ? LABELS : TEAMS));
    const r = await lin.listTeams({}, deps);
    expect(r.teams[0]).toEqual({
      key: "ENG",
      name: "Engineering",
      states: [{ name: "Todo", type: "unstarted" }, { name: "In Progress", type: "started" }, { name: "Done", type: "completed" }],
      labels: ["Bug", "Lead"],
    });
  });

  it("hides closed issues by default", async () => {
    const { deps, calls } = stub(() => ({ issues: { nodes: [issue()] } }));
    const r = await lin.listIssues({ team: "eng" }, deps);
    expect(calls[0].variables.filter).toEqual({ team: { key: { eqIgnoreCase: "eng" } }, state: { type: { nin: ["completed", "canceled"] } } });
    expect(calls[0].variables.first).toBe(25);
    expect(r.note).toMatch(/hidden/);
    expect(r.issues[0]).toMatchObject({ identifier: "ENG-1", state: "Todo", priority: "High", assignee: "Kumar", labels: ["Bug"], team: "ENG" });
  });

  it("builds filters for assignee, state type, state name, label, priority, text", async () => {
    const { deps, calls } = stub(() => ({ issues: { nodes: [] } }));
    await lin.listIssues({ assignee: "me", state: "started", label: "Bug", priority: "urgent", query: "login", limit: 500 }, deps);
    const f = calls[0].variables.filter;
    expect(f.assignee).toEqual({ isMe: { eq: true } });
    expect(f.state).toEqual({ type: { eq: "started" } });
    expect(f.labels).toEqual({ name: { eqIgnoreCase: "Bug" } });
    expect(f.priority).toEqual({ eq: 1 });
    expect(f.or).toEqual([{ title: { containsIgnoreCase: "login" } }, { description: { containsIgnoreCase: "login" } }]);
    expect(calls[0].variables.first).toBe(100);

    await lin.listIssues({ state: "In Progress", assignee: "unassigned", include_closed: true }, deps);
    expect(calls[1].variables.filter.state).toEqual({ name: { eqIgnoreCase: "In Progress" } });
    expect(calls[1].variables.filter.assignee).toEqual({ null: true });
  });

  it("resolves an assignee by email and refuses ambiguous names", async () => {
    const { deps, calls } = stub((b) =>
      b.query.includes("users(") ? { users: { nodes: [{ id: "u1", name: "Asha Rao", email: "asha@x.com", active: true }] } } : { issues: { nodes: [] } }
    );
    await lin.listIssues({ assignee: "asha@x.com" }, deps);
    expect(calls[1].variables.filter.assignee).toEqual({ id: { eq: "u1" } });

    const many = stub(() => ({ users: { nodes: [{ id: "a", name: "Sam A", email: "a@x.com", active: true }, { id: "b", name: "Sam B", email: "b@x.com", active: true }] } }));
    await expect(lin.listIssues({ assignee: "Sam" }, many.deps)).rejects.toThrow(/matches several people/);
    const none = stub(() => ({ users: { nodes: [] } }));
    await expect(lin.listIssues({ assignee: "ghost" }, none.deps)).rejects.toThrow(/No Linear user/);
  });

  it("gets one issue with its comments", async () => {
    const { deps, calls } = stub(() => ({
      issue: issue({ description: "Steps to reproduce", comments: { nodes: [{ body: "On it", createdAt: "2026-10-03T00:00:00Z", user: { name: "Kumar" } }, { body: "bot note", createdAt: "2026-10-04T00:00:00Z", user: null }] } }),
    }));
    const r = await lin.getIssue({ issue: "ENG-1" }, deps);
    expect(calls[0].variables).toEqual({ id: "ENG-1" });
    expect(r.issue.description).toBe("Steps to reproduce");
    expect(r.comments).toEqual([{ by: "Kumar", at: "2026-10-03T00:00:00Z", text: "On it" }, { by: "unknown", at: "2026-10-04T00:00:00Z", text: "bot note" }]);
    expect(r.notice).toBeTruthy();
  });

  it("reports a missing issue", async () => {
    await expect(lin.getIssue({ issue: "ENG-99" }, stub(() => ({ issue: null })).deps)).rejects.toThrow(/No issue ENG-99/);
  });
});

describe("linearOps — create", () => {
  const route = (b) => {
    if (b.query.includes("teams(")) return TEAMS;
    if (b.query.includes("issueLabels")) return LABELS;
    if (b.query.includes("viewer")) return { viewer: { id: "me-id" } };
    if (b.query.includes("issueCreate")) return { issueCreate: { success: true, issue: issue({ identifier: "ENG-2", title: "New thing" }) } };
    return {};
  };

  it("resolves team, state, labels and assignee by name", async () => {
    const { deps, calls } = stub(route);
    const r = await lin.createIssue(
      { team: "eng", title: "  New thing ", description: "Details", priority: "high", assignee: "me", state: "in progress", labels: ["bug", "Lead", "bug"], due_date: "2026-10-31" },
      deps
    );
    const create = calls.find((c) => c.query.includes("issueCreate"));
    expect(create.variables.input).toEqual({
      teamId: "team-eng",
      title: "New thing",
      description: "Details",
      priority: 2,
      dueDate: "2026-10-31",
      stateId: "s-prog",
      assigneeId: "me-id",
      labelIds: ["l-bug", "l-lead"],
    });
    expect(r).toMatchObject({ created: true, issue: { identifier: "ENG-2" } });
  });

  it("keeps it minimal when only title and team are given", async () => {
    const { deps, calls } = stub(route);
    await lin.createIssue({ team: "ENG", title: "Bare" }, deps);
    expect(calls.find((c) => c.query.includes("issueCreate")).variables.input).toEqual({ teamId: "team-eng", title: "Bare" });
  });

  it("lists valid names when one is wrong, and creates nothing", async () => {
    const { deps, calls } = stub(route);
    await expect(lin.createIssue({ team: "OPS", title: "x" }, deps)).rejects.toThrow(/Teams: ENG/);
    await expect(lin.createIssue({ team: "ENG", title: "x", state: "Blocked" }, deps)).rejects.toThrow(/States: Todo, In Progress, Done/);
    await expect(lin.createIssue({ team: "ENG", title: "x", labels: ["Other"] }, deps)).rejects.toThrow(/No label "Other".*Labels: Bug, Lead/);
    expect(calls.some((c) => c.query.includes("issueCreate"))).toBe(false);
  });

  it("validates title, priority and due date up front", async () => {
    const { deps, calls } = stub(route);
    await expect(lin.createIssue({ team: "ENG" }, deps)).rejects.toThrow(/title is required/);
    await expect(lin.createIssue({ team: "ENG", title: "x", priority: "asap" }, deps)).rejects.toThrow(/priority must be/);
    await expect(lin.createIssue({ team: "ENG", title: "x", due_date: "31/10/2026" }, deps)).rejects.toThrow(/due_date/);
    expect(calls).toHaveLength(0);
  });

  it("fails clearly when Linear reports no success", async () => {
    const { deps } = stub((b) => (b.query.includes("teams(") ? TEAMS : { issueCreate: { success: false } }));
    await expect(lin.createIssue({ team: "ENG", title: "x" }, deps)).rejects.toThrow(/did not create/);
  });
});

describe("linearOps — update and comment", () => {
  const current = { issue: { id: "uuid-1", identifier: "ENG-1", team: { id: "team-eng", key: "ENG", states: TEAMS.teams.nodes[0].states }, labels: { nodes: [{ id: "l-bug", name: "Bug" }] } } };
  const route = (b) => {
    if (b.query.includes("issueUpdate")) return { issueUpdate: { success: true, issue: issue({ state: { name: "Done", type: "completed" } }) } };
    if (b.query.includes("issueLabels")) return LABELS;
    if (b.query.includes("viewer")) return { viewer: { id: "me-id" } };
    return current;
  };

  it("moves state and sends only what changed, using the issue uuid", async () => {
    const { deps, calls } = stub(route);
    const r = await lin.updateIssue({ issue: "ENG-1", state: "done" }, deps);
    const up = calls.find((c) => c.query.includes("issueUpdate"));
    expect(up.variables).toEqual({ id: "uuid-1", input: { stateId: "s-done" } });
    expect(r.issue.state).toBe("Done");
  });

  it("adds and removes labels without touching the others", async () => {
    const { deps, calls } = stub(route);
    await lin.updateIssue({ issue: "ENG-1", add_labels: ["Lead"], remove_labels: ["bug"] }, deps);
    expect(calls.find((c) => c.query.includes("issueUpdate")).variables.input.labelIds).toEqual(["l-lead"]);
  });

  it("assigns to me, unassigns, and clears the due date", async () => {
    const { deps, calls } = stub(route);
    await lin.updateIssue({ issue: "ENG-1", assignee: "me", priority: "low", due_date: "" }, deps);
    expect(calls.find((c) => c.query.includes("issueUpdate")).variables.input).toEqual({ assigneeId: "me-id", priority: 4, dueDate: null });
    await lin.updateIssue({ issue: "ENG-1", assignee: "unassigned" }, deps);
    const last = calls.filter((c) => c.query.includes("issueUpdate")).pop();
    expect(last.variables.input).toEqual({ assigneeId: null });
  });

  it("errors on an unknown state, a missing issue, or no change", async () => {
    await expect(lin.updateIssue({ issue: "ENG-1", state: "Blocked" }, stub(route).deps)).rejects.toThrow(/has no state "Blocked"/);
    await expect(lin.updateIssue({ issue: "ENG-9", title: "x" }, stub(() => ({ issue: null })).deps)).rejects.toThrow(/No issue ENG-9/);
    await expect(lin.updateIssue({ issue: "ENG-1" }, stub(route).deps)).rejects.toThrow(/Nothing to change/);
  });

  it("comments on an issue by identifier", async () => {
    const { deps, calls } = stub((b) => (b.query.includes("commentCreate") ? { commentCreate: { success: true, comment: { id: "c1", url: "https://linear.app/c1" } } } : { issue: { id: "uuid-1", identifier: "ENG-1" } }));
    const r = await lin.addComment({ issue: "ENG-1", body: "Shipped in v1.2" }, deps);
    expect(calls[1].variables.input).toEqual({ issueId: "uuid-1", body: "Shipped in v1.2" });
    expect(r).toEqual({ commented: true, issue: "ENG-1", url: "https://linear.app/c1" });
    await expect(lin.addComment({ issue: "ENG-1", body: "  " }, deps)).rejects.toThrow(/body is required/);
  });
});
