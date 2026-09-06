import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  supabaseListOrganizations,
  supabaseListProjects,
  supabaseGetProject,
  supabaseCreateProject,
  supabaseDeleteProject,
  supabaseRunSql,
} from "../tools/supabaseOps.js";

const jsonRes = (data, ok = true, status = 200) => ({
  ok,
  status,
  statusText: "Error",
  text: () => Promise.resolve(JSON.stringify(data)),
});

beforeEach(() => {
  process.env.SUPABASE_ACCESS_TOKEN = "sbp_test_token";
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SUPABASE_ACCESS_TOKEN;
});

describe("supabaseOps — auth & error handling", () => {
  it("throws if SUPABASE_ACCESS_TOKEN is missing", async () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;
    await expect(supabaseListOrganizations()).rejects.toThrow(/SUPABASE_ACCESS_TOKEN not set/);
  });

  it("throws a formatted error using the message field on failure", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ message: "Invalid token" }, false, 401));
    await expect(supabaseListOrganizations()).rejects.toThrow(/Supabase API error \(401\): Invalid token/);
  });

  it("falls back to statusText when no message field is present", async () => {
    global.fetch.mockReturnValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
    });
    await expect(supabaseListOrganizations()).rejects.toThrow(/Supabase API error \(500\): Internal Server Error/);
  });

  it("sends bearer auth header", async () => {
    global.fetch.mockReturnValueOnce(jsonRes([]));
    await supabaseListOrganizations();
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer sbp_test_token");
  });
});

describe("supabaseOps — reads", () => {
  it("listOrganizations maps id/name", async () => {
    global.fetch.mockReturnValueOnce(jsonRes([{ id: "org1", name: "Acme", extra: "x" }]));
    const result = await supabaseListOrganizations();
    expect(result.organizations).toEqual([{ id: "org1", name: "Acme" }]);
  });

  it("listProjects maps expected fields", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes([{ id: "p1", name: "prod-db", region: "ap-south-1", status: "ACTIVE_HEALTHY", organization_id: "org1" }])
    );
    const result = await supabaseListProjects();
    expect(result.projects).toEqual([
      { id: "p1", name: "prod-db", region: "ap-south-1", status: "ACTIVE_HEALTHY", organization_id: "org1" },
    ]);
  });

  it("getProject fetches by ref and returns simplified fields", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ id: "p1", name: "prod-db", region: "ap-south-1", status: "ACTIVE_HEALTHY" }));
    const result = await supabaseGetProject({ project_ref: "p1" });
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.supabase.com/v1/projects/p1");
    expect(result).toEqual({ id: "p1", name: "prod-db", region: "ap-south-1", status: "ACTIVE_HEALTHY" });
  });
});

describe("supabaseOps — mutations", () => {
  it("createProject defaults region and plan, sends full payload", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ id: "p2", name: "new-db", region: "ap-south-1", status: "COMING_UP" }));
    const result = await supabaseCreateProject({ name: "new-db", organization_id: "org1", db_pass: "hunter2" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.supabase.com/v1/projects");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      name: "new-db",
      organization_id: "org1",
      db_pass: "hunter2",
      region: "ap-south-1",
      plan: "free",
    });
    expect(result.status).toBe("COMING_UP");
  });

  it("createProject respects explicit region and plan overrides", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ id: "p3", name: "eu-db", region: "eu-west-1", status: "COMING_UP" }));
    await supabaseCreateProject({
      name: "eu-db",
      organization_id: "org1",
      db_pass: "hunter2",
      region: "eu-west-1",
      plan: "pro",
    });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.region).toBe("eu-west-1");
    expect(body.plan).toBe("pro");
  });

  it("deleteProject DELETEs and confirms", async () => {
    global.fetch.mockReturnValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
    const result = await supabaseDeleteProject({ project_ref: "p1" });
    expect(global.fetch.mock.calls[0][1].method).toBe("DELETE");
    expect(result).toEqual({ project_ref: "p1", deleted: true });
  });

  it("runSql POSTs the query and wraps the raw result", async () => {
    global.fetch.mockReturnValueOnce(jsonRes([{ count: 5 }]));
    const result = await supabaseRunSql({ project_ref: "p1", query: "SELECT COUNT(*) FROM users" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.supabase.com/v1/projects/p1/database/query");
    expect(JSON.parse(opts.body)).toEqual({ query: "SELECT COUNT(*) FROM users" });
    expect(result).toEqual({ project_ref: "p1", result: [{ count: 5 }] });
  });

  it("runSql surfaces a Supabase API error on invalid SQL", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ message: "syntax error at or near SELCT" }, false, 400));
    await expect(supabaseRunSql({ project_ref: "p1", query: "SELCT 1" })).rejects.toThrow(
      /syntax error at or near SELCT/
    );
  });
});
