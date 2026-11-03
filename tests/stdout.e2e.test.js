import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";

// P0-09: stdout carries only JSON-RPC messages. Anything else (a stray console.log, a banner) would
// corrupt the stdio protocol, so log lines must go to stderr.
function runSession(messages, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["index.js"], {
      cwd: process.cwd(),
      env: { ...process.env, CAUSLY_TOOLSETS: "all", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.stderr.resume();
    const expectedResponses = messages.filter((m) => m.id !== undefined).length;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out; stdout so far: ${out.slice(0, 500)}`));
    }, 40000);
    const check = setInterval(() => {
      const n = out.split("\n").filter((l) => l.trim().startsWith("{") && /"id"/.test(l)).length;
      if (n >= expectedResponses) {
        clearInterval(check);
        clearTimeout(timer);
        child.stdin.end();
        setTimeout(() => {
          child.kill();
          resolve(out);
        }, 300);
      }
    }, 100);
    for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
  });
}

describe("stdout hygiene (stdio)", () => {
  it("prints only valid JSON-RPC lines, including after a tool error", async () => {
    const out = await runSession([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stdout-test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_file", arguments: { path: "Z:\\definitely\\missing\\file.txt" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
    ]);
    const lines = out.split(/\r?\n/).filter((l) => l.trim() !== "");
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const line of lines) {
      let msg;
      expect(() => (msg = JSON.parse(line)), `not JSON: ${line.slice(0, 120)}`).not.toThrow();
      expect(msg.jsonrpc).toBe("2.0");
    }
  }, 60000);
});
