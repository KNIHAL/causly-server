import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { githubListIssues } from "../tools/githubOps.js";

// P0-13: GitHub's issues endpoint also returns pull requests and counts them in the page size. A repo
// whose latest items are all PRs used to give an empty list for state "all" even with an open issue.
const jsonRes = (data) => ({ ok: true, status: 200, statusText: "OK", text: () => Promise.resolve(JSON.stringify(data)) });
const pr = (n) => ({ number: n, title: `PR ${n}`, state: "closed", html_url: `u${n}`, pull_request: {} });
const issue = (n, state = "open") => ({ number: n, title: `Issue ${n}`, state, html_url: `u${n}` });

beforeEach(() => {
  process.env.GITHUB_TOKEN = "gh_test_token";
  global.fetch = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GITHUB_TOKEN;
});

describe("githubListIssues state and paging", () => {
  it("passes state=all through to the API", async () => {
    global.fetch.mockResolvedValueOnce(jsonRes([issue(1), issue(2, "closed")]));
    const r = await githubListIssues({ owner: "o", repo: "r", state: "all" });
    expect(global.fetch.mock.calls[0][0]).toContain("state=all");
    expect(r.issues.map((i) => i.number)).toEqual([1, 2]);
  });

  it("finds an issue that sits behind a full page of pull requests", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => pr(200 - i));
    global.fetch.mockResolvedValueOnce(jsonRes(firstPage)).mockResolvedValueOnce(jsonRes([issue(2), issue(1, "closed")]));
    const r = await githubListIssues({ owner: "o", repo: "r", state: "all" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toContain("page=2");
    expect(r.issues.map((i) => i.number)).toEqual([2, 1]);
    expect(r.issues.map((i) => i.state)).toEqual(["open", "closed"]);
  });

  it("stops once per_page issues are collected", async () => {
    const page = Array.from({ length: 100 }, (_, i) => issue(i + 1));
    global.fetch.mockResolvedValueOnce(jsonRes(page));
    const r = await githubListIssues({ owner: "o", repo: "r", per_page: 5 });
    expect(r.issues).toHaveLength(5);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
