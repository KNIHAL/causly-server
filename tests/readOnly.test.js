import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readOnlyMode, allowedInReadOnly } from "../tools/readOnly.js";
import { PERMISSION_LEVELS } from "../tools/security.js";
import { resolveApproval } from "../tools/operatorApproval.js";

const saved = process.env.CAUSLY_READ_ONLY;
afterEach(() => {
  if (saved === undefined) delete process.env.CAUSLY_READ_ONLY;
  else process.env.CAUSLY_READ_ONLY = saved;
});

describe("CAUSLY_READ_ONLY", () => {
  it("only true-ish values turn it on", () => {
    for (const v of ["false", "0", "", "nope"]) expect(readOnlyMode({ CAUSLY_READ_ONLY: v })).toBe(false);
    for (const v of ["true", "1", "YES", "on"]) expect(readOnlyMode({ CAUSLY_READ_ONLY: v })).toBe(true);
    expect(readOnlyMode({})).toBe(false);
  });

  it("allows exactly the READ tools plus load_toolset", () => {
    for (const [name, level] of Object.entries(PERMISSION_LEVELS)) {
      expect(allowedInReadOnly(name), name).toBe(level === "READ" || name === "load_toolset");
    }
    expect(allowedInReadOnly("some_new_tool_without_a_level")).toBe(false);
  });

  it("the approval gate refuses every non-READ tool, even with confirm: true", async () => {
    process.env.CAUSLY_READ_ONLY = "true";
    for (const [name, level] of Object.entries(PERMISSION_LEVELS)) {
      if (level === "READ" || name === "load_toolset") continue;
      const r = await resolveApproval(name, { confirm: true });
      expect(r.allowed, name).toBe(false);
      expect(r.reason).toMatch(/read-only mode/);
    }
  });

  it("READ tools still pass the gate", async () => {
    process.env.CAUSLY_READ_ONLY = "true";
    expect((await resolveApproval("read_file", {})).allowed).toBe(true);
    expect((await resolveApproval("load_toolset", {})).allowed).toBe(true);
  });

  it("off by default: nothing changes", async () => {
    delete process.env.CAUSLY_READ_ONLY;
    expect((await resolveApproval("write_file", {})).allowed).toBe(true);
  });
});

async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["index.js"],
    cwd: process.cwd(),
    env: { CAUSLY_TOOLSETS: "all", CAUSLY_READ_ONLY: "true", ...env },
    stderr: "ignore",
  });
  const client = new Client({ name: "read-only-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("read-only mode end to end", () => {
  it("lists only READ tools, hides the rest from search_tools and refuses use_tool", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-readonly-"));
    const client = await connect({ CAUSLY_WORKSPACE: dir });
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("read_file");
      expect(names).toContain("load_toolset");
      for (const n of names) expect(allowedInReadOnly(n), n).toBe(true);
      for (const n of ["write_file", "run_command", "delete_file", "git_push"]) expect(names).not.toContain(n);

      const search = await client.callTool({ name: "search_tools", arguments: { query: "file" } });
      const found = JSON.parse(search.content[0].text).matches.map((m) => m.tool);
      expect(found).toContain("read_file");
      expect(found).not.toContain("write_file");

      const target = path.join(dir, "x.txt");
      const r = await client.callTool({ name: "use_tool", arguments: { tool: "write_file", arguments: { path: target, content: "no" } } });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/read-only mode/);
      expect(fs.existsSync(target)).toBe(false);
    } finally {
      await client.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
