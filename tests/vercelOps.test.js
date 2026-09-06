import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  vercelGetAuthenticatedUser,
  vercelListProjects,
  vercelGetProject,
  vercelListDeployments,
  vercelGetDeployment,
  vercelCreateDeployment,
  vercelDeleteProject,
  vercelGetDeploymentLogs,
  vercelGetDeploymentEvents,
  vercelCancelDeployment,
  httpCheck,
} from "../tools/vercelOps.js";

const jsonRes = (data, ok = true, status = 200) => ({
  ok,
  status,
  statusText: "Error",
  text: () => Promise.resolve(JSON.stringify(data)),
});

beforeEach(() => {
  process.env.VERCEL_TOKEN = "vercel_test_token";
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VERCEL_TOKEN;
  delete process.env.GITHUB_TOKEN;
});

describe("vercelOps — auth & error handling", () => {
  it("throws if VERCEL_TOKEN is missing", async () => {
    delete process.env.VERCEL_TOKEN;
    await expect(vercelGetAuthenticatedUser()).rejects.toThrow(/VERCEL_TOKEN not set/);
  });

  it("throws a formatted error using error.message from the response body", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ error: { message: "Invalid token" } }, false, 403));
    await expect(vercelGetAuthenticatedUser()).rejects.toThrow(/Vercel API error \(403\): Invalid token/);
  });

  it("falls back to statusText when no error message is present", async () => {
    global.fetch.mockReturnValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
    });
    await expect(vercelGetAuthenticatedUser()).rejects.toThrow(/Vercel API error \(500\): Internal Server Error/);
  });

  it("sends bearer auth header", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ user: { id: "u1", username: "kumar", email: "k@x.com" } }));
    await vercelGetAuthenticatedUser();
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer vercel_test_token");
  });
});

describe("vercelOps — projects & deployments (read)", () => {
  it("getAuthenticatedUser returns simplified fields", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ user: { id: "u1", username: "kumar", email: "k@x.com" } }));
    const result = await vercelGetAuthenticatedUser();
    expect(result).toEqual({ id: "u1", username: "kumar", email: "k@x.com" });
  });

  it("listProjects maps latest_url from targets.production, with null fallback", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        projects: [
          { id: "p1", name: "site", framework: "nextjs", targets: { production: { url: "site.vercel.app" } } },
          { id: "p2", name: "api", framework: null },
        ],
      })
    );
    const result = await vercelListProjects({});
    expect(result.projects[0].latest_url).toBe("site.vercel.app");
    expect(result.projects[1].latest_url).toBeNull();
  });

  it("getProject maps link as org/repo, null when no link", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({ id: "p1", name: "site", framework: "nextjs", link: { type: "github", org: "acme", repo: "site" } })
    );
    const result = await vercelGetProject({ project: "site" });
    expect(result.link).toEqual({ type: "github", repo: "acme/site" });

    global.fetch.mockReturnValueOnce(jsonRes({ id: "p2", name: "api", framework: null, link: null }));
    const result2 = await vercelGetProject({ project: "api" });
    expect(result2.link).toBeNull();
  });

  it("listDeployments builds query with projectId and limit, formats created as ISO", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        deployments: [{ uid: "d1", name: "site", url: "u", state: "READY", created: 1700000000000 }],
      })
    );
    const result = await vercelListDeployments({ project: "p1", limit: 5 });
    expect(global.fetch.mock.calls[0][0]).toContain("projectId=p1");
    expect(global.fetch.mock.calls[0][0]).toContain("limit=5");
    expect(result.deployments[0].created).toBe(new Date(1700000000000).toISOString());
  });

  it("listDeployments omits projectId when no project given", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ deployments: [] }));
    await vercelListDeployments({});
    expect(global.fetch.mock.calls[0][0]).not.toContain("projectId");
  });

  it("getDeployment maps readyState to state and formats createdAt", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({ id: "d1", name: "site", url: "u", readyState: "READY", createdAt: 1700000000000 })
    );
    const result = await vercelGetDeployment({ deployment_id: "d1" });
    expect(result.state).toBe("READY");
    expect(result.created).toBe(new Date(1700000000000).toISOString());
  });
});

describe("vercelOps — deployment creation (resolves GitHub repo ID first)", () => {
  it("resolves the GitHub repo to a numeric ID then creates the deployment", async () => {
    global.fetch
      .mockReturnValueOnce({ ok: true, json: () => Promise.resolve({ id: 123456 }) }) // GitHub repo lookup
      .mockReturnValueOnce(jsonRes({ id: "d1", url: "u", readyState: "BUILDING" })); // Vercel deployment create

    const result = await vercelCreateDeployment({
      name: "site",
      project: "p1",
      git_source_repo: "acme/site",
    });

    expect(global.fetch.mock.calls[0][0]).toBe("https://api.github.com/repos/acme/site");
    const vercelBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(vercelBody.gitSource).toEqual({ type: "github", repoId: 123456, ref: "main" });
    expect(result).toEqual({ uid: "d1", url: "u", state: "BUILDING" });
  });

  it("includes GITHUB_TOKEN auth header when set", async () => {
    process.env.GITHUB_TOKEN = "gh_tok";
    global.fetch
      .mockReturnValueOnce({ ok: true, json: () => Promise.resolve({ id: 1 }) })
      .mockReturnValueOnce(jsonRes({ id: "d1", url: "u", readyState: "BUILDING" }));
    await vercelCreateDeployment({ name: "site", project: "p1", git_source_repo: "acme/site" });
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer gh_tok");
  });

  it("omits GitHub auth header when GITHUB_TOKEN is not set", async () => {
    global.fetch
      .mockReturnValueOnce({ ok: true, json: () => Promise.resolve({ id: 1 }) })
      .mockReturnValueOnce(jsonRes({ id: "d1", url: "u", readyState: "BUILDING" }));
    await vercelCreateDeployment({ name: "site", project: "p1", git_source_repo: "acme/site" });
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("throws a clear error when the GitHub repo can't be resolved", async () => {
    global.fetch.mockReturnValueOnce({ ok: false, status: 404 });
    await expect(
      vercelCreateDeployment({ name: "site", project: "p1", git_source_repo: "acme/missing" })
    ).rejects.toThrow(/Could not resolve GitHub repo "acme\/missing"/);
  });
});

describe("vercelOps — mutations & misc", () => {
  it("deleteProject DELETEs and confirms", async () => {
    global.fetch.mockReturnValueOnce({ ok: true, status: 204, text: () => Promise.resolve("") });
    const result = await vercelDeleteProject({ project: "p1" });
    expect(global.fetch.mock.calls[0][1].method).toBe("DELETE");
    expect(result).toEqual({ project: "p1", deleted: true });
  });

  it("getDeploymentLogs handles a bare array response", async () => {
    global.fetch.mockReturnValueOnce(jsonRes([{ type: "stdout", text: "building...", created: 1 }]));
    const result = await vercelGetDeploymentLogs({ deployment_id: "d1" });
    expect(result.logs).toEqual([{ type: "stdout", text: "building...", created: 1 }]);
  });

  it("getDeploymentLogs handles a {events: [...]} response and falls back to payload.text", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({ events: [{ type: "stdout", payload: { text: "from payload" }, created: 1 }] })
    );
    const result = await vercelGetDeploymentLogs({ deployment_id: "d1" });
    expect(result.logs[0].text).toBe("from payload");
  });

  it("getDeploymentEvents reports build_errors null when there is no error", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ readyState: "READY", readySubstate: "PROMOTED", checksState: "PASSED" }));
    const result = await vercelGetDeploymentEvents({ deployment_id: "d1" });
    expect(result.build_errors).toBeNull();
  });

  it("getDeploymentEvents surfaces build_errors when present", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({ readyState: "ERROR", errorMessage: "Build failed", errorCode: "BUILD_FAILED" })
    );
    const result = await vercelGetDeploymentEvents({ deployment_id: "d1" });
    expect(result.build_errors).toEqual({ message: "Build failed", code: "BUILD_FAILED" });
  });

  it("cancelDeployment PATCHes and returns the new state", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ readyState: "CANCELED" }));
    const result = await vercelCancelDeployment({ deployment_id: "d1" });
    expect(global.fetch.mock.calls[0][1].method).toBe("PATCH");
    expect(result).toEqual({ deployment_id: "d1", state: "CANCELED" });
  });
});

describe("httpCheck", () => {
  it("reports healthy: true for a 2xx response", async () => {
    global.fetch.mockResolvedValueOnce({ status: 200 });
    const result = await httpCheck({ url: "https://example.com" });
    expect(result.healthy).toBe(true);
    expect(result.status).toBe(200);
    expect(typeof result.response_time_ms).toBe("number");
  });

  it("reports healthy: false for a 5xx response", async () => {
    global.fetch.mockResolvedValueOnce({ status: 503 });
    const result = await httpCheck({ url: "https://example.com" });
    expect(result.healthy).toBe(false);
    expect(result.status).toBe(503);
  });

  it("reports healthy: true for a 3xx redirect (still < 400)", async () => {
    global.fetch.mockResolvedValueOnce({ status: 301 });
    const result = await httpCheck({ url: "https://example.com" });
    expect(result.healthy).toBe(true);
  });

  it("reports a network error via err.message", async () => {
    global.fetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));
    const result = await httpCheck({ url: "https://nowhere.invalid" });
    expect(result.healthy).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toBe("getaddrinfo ENOTFOUND");
  });

  it("reports 'timeout' on an AbortError", async () => {
    const abortErr = new Error("The operation was aborted");
    abortErr.name = "AbortError";
    global.fetch.mockRejectedValueOnce(abortErr);
    const result = await httpCheck({ url: "https://example.com", timeout_ms: 5000 });
    expect(result.error).toBe("timeout");
    expect(result.healthy).toBe(false);
  });
});
