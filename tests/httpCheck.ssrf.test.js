import dns from "node:dns";
import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { httpCheck } from "../tools/vercelOps.js";
import * as webOps from "../tools/webOps.js";
import * as netGuard from "../tools/netGuard.js";

// P0-05: http_check must refuse private, loopback and link-local targets, on every redirect hop,
// and must connect only to the address it checked.
let server;
let port;
let hits = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits += 1;
    if (req.url === "/redirect") {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` });
      res.end();
    } else if (req.url === "/slow") {
      // never answers
    } else if (req.url === "/down") {
      res.writeHead(503);
      res.end("down");
    } else if (req.url === "/moved") {
      res.writeHead(301);
      res.end();
    } else {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  hits = 0;
});

describe("http_check blocks internal targets", () => {
  const targets = () => [
    `http://127.0.0.1:${port}/`,
    `http://localhost:${port}/`,
    `http://[::1]:${port}/`,
    `http://[::ffff:127.0.0.1]:${port}/`,
    `http://[::ffff:7f00:1]:${port}/`,
    `http://2130706433:${port}/`, // decimal
    `http://0177.0.0.1:${port}/`, // octal
    `http://0x7f000001:${port}/`, // hex
    `http://127.1:${port}/`, // short form
    `http://0.0.0.0:${port}/`,
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://100.64.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
  ];

  it.each(targets().map((_, i) => i))("target #%i is refused and never contacted", async (i) => {
    const url = targets()[i];
    const result = await httpCheck({ url, timeout_ms: 1500 });
    expect(result.healthy).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toMatch(/Blocked/);
    expect(hits).toBe(0);
  });

  it("refuses a DNS name that resolves to a private address", async () => {
    vi.spyOn(dns, "lookup").mockImplementation((host, opts, cb) => cb(null, [{ address: "10.0.0.5", family: 4 }]));
    const result = await httpCheck({ url: "http://evil.example.test/", timeout_ms: 1500 });
    expect(result.healthy).toBe(false);
    expect(result.error).toMatch(/resolves to a private or reserved address/);
  });

  it("refuses a name when ANY of its addresses is private", async () => {
    vi.spyOn(dns, "lookup").mockImplementation((host, opts, cb) =>
      cb(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ])
    );
    const result = await httpCheck({ url: "http://mixed.example.test/", timeout_ms: 1500 });
    expect(result.error).toMatch(/Blocked/);
  });

  it("refuses non-http schemes and embedded credentials", async () => {
    expect((await httpCheck({ url: "file:///etc/passwd" })).error).toMatch(/http and https/);
    expect((await httpCheck({ url: "ftp://example.com/" })).error).toMatch(/http and https/);
    expect((await httpCheck({ url: "http://user:pw@example.com/" })).error).toMatch(/credentials/);
  });

  it("refuses a public URL that redirects to a private address", async () => {
    const calls = [];
    const requestOnce = async (url) => {
      calls.push(url.toString());
      return { statusCode: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" }, resume() {} };
    };
    await expect(netGuard.guardedRequest("http://93.184.216.34/start", { requestOnce })).rejects.toThrow(/Blocked/);
    expect(calls).toEqual(["http://93.184.216.34/start"]);
  });

  it("stops after too many redirects", async () => {
    const requestOnce = async () => ({ statusCode: 302, headers: { location: "http://93.184.216.34/again" }, resume() {} });
    await expect(netGuard.guardedRequest("http://93.184.216.34/", { requestOnce })).rejects.toThrow(/Too many redirects/);
  });
});

describe("http_check still works for real targets", () => {
  it("reports healthy for 2xx, unhealthy for 5xx, healthy for a bare 3xx", async () => {
    vi.stubEnv("CAUSLY_ALLOW_PRIVATE_HOSTS", "true");
    const ok = await httpCheck({ url: `http://127.0.0.1:${port}/` });
    expect(ok).toMatchObject({ healthy: true, status: 200 });
    expect(typeof ok.response_time_ms).toBe("number");
    expect(await httpCheck({ url: `http://127.0.0.1:${port}/down` })).toMatchObject({ healthy: false, status: 503 });
    expect(await httpCheck({ url: `http://127.0.0.1:${port}/moved` })).toMatchObject({ healthy: true, status: 301 });
  });

  it("follows redirects", async () => {
    vi.stubEnv("CAUSLY_ALLOW_PRIVATE_HOSTS", "true");
    expect(await httpCheck({ url: `http://127.0.0.1:${port}/redirect` })).toMatchObject({ healthy: true, status: 200 });
  });

  it("reports a connection error as data", async () => {
    vi.stubEnv("CAUSLY_ALLOW_PRIVATE_HOSTS", "true");
    const result = await httpCheck({ url: "http://127.0.0.1:1/", timeout_ms: 2000 });
    expect(result).toMatchObject({ healthy: false, status: null });
    expect(result.error).toBeTruthy();
  });

  it("reports 'timeout' when the server never answers", async () => {
    vi.stubEnv("CAUSLY_ALLOW_PRIVATE_HOSTS", "true");
    const result = await httpCheck({ url: `http://127.0.0.1:${port}/slow`, timeout_ms: 300 });
    expect(result).toMatchObject({ healthy: false, status: null, error: "timeout" });
  });
});

describe("one shared guard", () => {
  it("web_fetch and http_check use the same address check", () => {
    expect(webOps.isPublicAddress).toBe(netGuard.isPublicAddress);
    expect(webOps.parseHttpUrl).toBe(netGuard.parseHttpUrl);
  });
});
