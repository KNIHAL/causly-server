import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  sentryListProjects,
  sentryListIssues,
  sentrySearchIssues,
  sentryGetIssue,
  sentryResolveIssue,
  sentryIgnoreIssue,
  sentryGetProjectStats,
  sentryAddComment,
} from "../tools/sentryOps.js";

const OK = (data, status = 200) =>
  Promise.resolve({ ok: true, status, text: () => Promise.resolve(JSON.stringify(data)) });
const NOT_FOUND = (detail = "not found") =>
  Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(JSON.stringify({ detail })) });
const FAIL = (status, detail) =>
  Promise.resolve({ ok: false, status, text: () => Promise.resolve(JSON.stringify({ detail })) });

beforeEach(() => {
  process.env.SENTRY_AUTH_TOKEN = "test-token";
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SENTRY_AUTH_TOKEN;
});

describe("sentryOps", () => {
  it("throws if SENTRY_AUTH_TOKEN is missing", async () => {
    delete process.env.SENTRY_AUTH_TOKEN;
    await expect(sentryListProjects({ org_slug: "acme" })).rejects.toThrow(/SENTRY_AUTH_TOKEN not set/);
  });

  it("lists projects, simplified", async () => {
    global.fetch.mockReturnValueOnce(
      OK([{ id: "1", slug: "web", name: "Web", platform: "javascript", extra: "dropped" }])
    );
    const result = await sentryListProjects({ org_slug: "acme" });
    expect(result.projects).toEqual([{ id: "1", slug: "web", name: "Web", platform: "javascript" }]);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://sentry.io/api/0/organizations/acme/projects/",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("falls back to de.sentry.io on a 404 from sentry.io", async () => {
    global.fetch.mockReturnValueOnce(NOT_FOUND()).mockReturnValueOnce(OK({ id: "42", shortId: "ABC-1" }));
    const result = await sentryGetIssue({ issue_id: "42" });
    expect(result.id).toBe("42");
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain("https://sentry.io/api/0");
    expect(global.fetch.mock.calls[1][0]).toContain("https://de.sentry.io/api/0");
  });

  it("does not fall back on non-404 errors", async () => {
    global.fetch.mockReturnValueOnce(FAIL(500, "server error"));
    await expect(sentryGetIssue({ issue_id: "42" })).rejects.toThrow(/server error/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws with detail message when both hosts fail", async () => {
    global.fetch.mockReturnValueOnce(NOT_FOUND("gone")).mockReturnValueOnce(NOT_FOUND("gone"));
    await expect(sentryGetIssue({ issue_id: "99" })).rejects.toThrow(/gone/);
  });

  it("lists issues with query params and simplifies fields", async () => {
    global.fetch.mockReturnValueOnce(
      OK([
        {
          id: "1",
          shortId: "X-1",
          title: "TypeError",
          culprit: "app.js",
          level: "error",
          status: "unresolved",
          count: 5,
          userCount: 2,
          firstSeen: "t1",
          lastSeen: "t2",
          permalink: "link",
          noise: "drop me",
        },
      ])
    );
    const result = await sentryListIssues({ org_slug: "acme", project_slug: "web", query: "is:unresolved" });
    expect(result.issues[0]).not.toHaveProperty("noise");
    expect(result.issues[0].title).toBe("TypeError");
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain("/projects/acme/web/issues/");
    expect(calledUrl).toContain("query=is%3Aunresolved");
  });

  it("searchIssues delegates to listIssues with the same args", async () => {
    global.fetch.mockReturnValueOnce(OK([]));
    const result = await sentrySearchIssues({ org_slug: "acme", project_slug: "web", query: "level:error" });
    expect(result.issues).toEqual([]);
    expect(global.fetch.mock.calls[0][0]).toContain("query=level%3Aerror");
  });

  it("resolves an issue via PUT", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "1", status: "resolved" }));
    const result = await sentryResolveIssue({ issue_id: "1", confirm: true });
    expect(result).toEqual({ id: "1", status: "resolved" });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({ status: "resolved" });
  });

  it("ignores an issue via PUT", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "1", status: "ignored" }));
    const result = await sentryIgnoreIssue({ issue_id: "1", confirm: true });
    expect(result).toEqual({ id: "1", status: "ignored" });
  });

  it("adds a comment via POST", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "c1" }));
    const result = await sentryAddComment({ issue_id: "1", text: "looking into it", confirm: true });
    expect(result).toEqual({ id: "c1", posted: true });
    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ text: "looking into it" });
  });

  it("gets project stats as timestamp/value points", async () => {
    global.fetch.mockReturnValueOnce(
      OK([
        [1000, 5],
        [2000, 8],
      ])
    );
    const result = await sentryGetProjectStats({ org_slug: "acme", project_slug: "web" });
    expect(result.points).toEqual([
      { timestamp: 1000, value: 5 },
      { timestamp: 2000, value: 8 },
    ]);
    expect(result.stat).toBe("received");
    expect(result.period).toBe("24h");
  });

  it("sends bearer token in Authorization header", async () => {
    global.fetch.mockReturnValueOnce(OK([]));
    await sentryListProjects({ org_slug: "acme" });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer test-token");
  });
});
