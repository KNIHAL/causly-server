import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["index.js"],
    cwd: process.cwd(),
    env: { CAUSLY_TOOLSETS: "", ...env },
    stderr: "ignore",
  });
  const client = new Client({ name: "use-tool-test", version: "0.0.0" });
  await client.connect(transport);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: r.content?.[0]?.text ?? "", isError: Boolean(r.isError) };
  };
  return { client, call };
}

describe("use_tool (clients that do not refresh their tool list)", () => {
  it("runs a tool from an unloaded toolset and loads it on the way", async () => {
    const { client, call } = await connect();
    try {
      const names = async () => (await client.listTools()).tools.map((t) => t.name);
      expect(await names()).not.toContain("git_status");
      const r = await call("use_tool", { tool: "git_status", arguments: { repo_path: process.cwd() } });
      expect(r.isError).toBe(false);
      expect(await names()).toContain("git_status"); // loaded by the call
    } finally {
      await client.close();
    }
  }, 30000);

  it("describe shows parameters without running the tool", async () => {
    const { client, call } = await connect();
    try {
      const r = await call("use_tool", { tool: "read_file", describe: true });
      expect(r.text).toMatch(/Parameters:/);
      expect(r.text).toMatch(/- path \(string, required\)/);
    } finally {
      await client.close();
    }
  }, 30000);

  it("explains unknown tools and wrong arguments", async () => {
    const { client, call } = await connect();
    try {
      const unknown = await call("use_tool", { tool: "nope_tool" });
      expect(unknown.isError).toBe(true);
      expect(unknown.text).toMatch(/search_tools/);

      const bad = await call("use_tool", { tool: "read_file", arguments: {} });
      expect(bad.isError).toBe(true);
      expect(bad.text).toMatch(/Invalid arguments for read_file/);
      expect(bad.text).toMatch(/path/);
    } finally {
      await client.close();
    }
  }, 30000);

  it("still applies the workspace jail of the tool it calls", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-usetool-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "causly-outside-"));
    fs.writeFileSync(path.join(dir, "a.txt"), "inside");
    fs.writeFileSync(path.join(outside, "b.txt"), "outside");
    const { client, call } = await connect({ CAUSLY_WORKSPACE: dir });
    try {
      const ok = await call("use_tool", { tool: "read_file", arguments: { path: path.join(dir, "a.txt") } });
      expect(ok.isError).toBe(false);
      const blocked = await call("use_tool", { tool: "read_file", arguments: { path: path.join(outside, "b.txt") } });
      expect(blocked.isError).toBe(true);
      expect(blocked.text).toMatch(/Blocked/);
    } finally {
      await client.close();
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  }, 30000);

  it("still asks for approval on risky tools", async () => {
    const { client, call } = await connect();
    try {
      const r = await call("use_tool", { tool: "delete_file", arguments: { path: path.join(os.tmpdir(), "causly-never-exists.txt") } });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/Blocked|confirm/i);
    } finally {
      await client.close();
    }
  }, 30000);
});
