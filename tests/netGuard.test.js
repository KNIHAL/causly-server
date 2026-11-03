import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPublicAddress } from "../tools/netGuard.js";
import { httpCheck } from "../tools/vercelOps.js";

// P0-05 follow-up: IPv6 transition forms that carry an IPv4 address must be judged by that address.
describe("isPublicAddress: IPv6 forms that embed IPv4", () => {
  it.each([
    ["6to4 of 127.0.0.1", "2002:7f00:1::1"],
    ["6to4 of 10.0.0.1", "2002:0a00:0001::"],
    ["6to4 of 192.168.1.1", "2002:c0a8:0101::1"],
    ["6to4 of 169.254.169.254", "2002:a9fe:a9fe::"],
    ["6to4 of 172.16.0.1", "2002:ac10:1::"],
    ["Teredo", "2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["Teredo short", "2001::1"],
    ["ISATAP of 127.0.0.1", "2a00:1450::5efe:7f00:1"],
    ["ISATAP of 10.0.0.1 (dotted)", "2a00:1450::5efe:10.0.0.1"],
    ["ISATAP local flag, 192.168.0.1", "2a00:1450::200:5efe:c0a8:1"],
    ["IPv4-compatible", "::7f00:1"],
    ["NAT64 of 127.0.0.1", "64:ff9b::7f00:1"],
  ])("blocks %s (%s)", (_name, ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    ["6to4 of 8.8.8.8", "2002:0808:0808::1"],
    ["ISATAP of 8.8.8.8", "2a00:1450::5efe:808:808"],
    ["ordinary global address", "2606:4700:4700::1111"],
    ["google v6", "2a00:1450:4009:81f::200e"],
  ])("still allows %s (%s)", (_name, ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it("treats malformed IPv6 as not public", () => {
    expect(isPublicAddress("2002:::1")).toBe(false);
    expect(isPublicAddress("not-an-ip")).toBe(false);
  });
});

describe("http_check refuses IPv6 transition addresses without connecting", () => {
  let server;
  let hits = 0;
  let port;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits += 1;
      res.end("ok");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  });

  it.each(["[2002:7f00:1::]", "[2002:0a00:0001::1]", "[2001:0:4136:e378:8000:63bf:3fff:fdd2]", "[2a00:1450::5efe:7f00:1]"])(
    "%s",
    async (host) => {
      const result = await httpCheck({ url: `http://${host}:${port}/`, timeout_ms: 1500 });
      expect(result.healthy).toBe(false);
      expect(result.error).toMatch(/Blocked/);
      expect(hits).toBe(0);
    }
  );
});
