import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PERMISSION_LEVELS, ACTION_LEVELS } from "../tools/security.js";

// P0-09: every tool carries the four MCP annotations, derived from the permission table, and has a
// description and a valid input schema.
async function listAllTools() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["index.js"],
    cwd: process.cwd(),
    env: { CAUSLY_TOOLSETS: "all" },
    stderr: "ignore",
  });
  const client = new Client({ name: "annotations-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

describe("MCP tool annotations (stdio, all toolsets)", () => {
  it("every tool has all four annotations, a description and an object schema", async () => {
    const tools = await listAllTools();
    expect(tools.length).toBeGreaterThan(200);
    const problems = [];
    for (const t of tools) {
      const a = t.annotations ?? {};
      for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        if (typeof a[key] !== "boolean") problems.push(`${t.name}: ${key} missing`);
      }
      if (!t.description || !t.description.trim()) problems.push(`${t.name}: empty description`);
      if (t.inputSchema?.type !== "object") problems.push(`${t.name}: inputSchema is not an object schema`);
    }
    expect(problems).toEqual([]);
  }, 60000);

  it("READ tools are read-only and never destructive; the rest are not read-only", async () => {
    const tools = await listAllTools();
    const problems = [];
    for (const t of tools) {
      const level = PERMISSION_LEVELS[t.name];
      const a = t.annotations;
      if (t.name === "use_tool") {
        if (a.readOnlyHint) problems.push("use_tool must not be read-only");
        continue;
      }
      if (level === "READ") {
        if (!a.readOnlyHint) problems.push(`${t.name}: READ but not readOnlyHint`);
        if (a.destructiveHint) problems.push(`${t.name}: READ but destructiveHint`);
      } else if (a.readOnlyHint) {
        problems.push(`${t.name}: ${level} but readOnlyHint`);
      }
      if (level === "DESTRUCTIVE" && !a.destructiveHint) problems.push(`${t.name}: DESTRUCTIVE but not destructiveHint`);
      if (Object.hasOwn(ACTION_LEVELS, t.name) && !a.destructiveHint) problems.push(`${t.name}: has destructive actions`);
    }
    expect(problems).toEqual([]);
  }, 60000);

  it("spot checks: local vs network tools", async () => {
    const byName = Object.fromEntries((await listAllTools()).map((t) => [t.name, t.annotations]));
    expect(byName.read_file).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(byName.delete_file).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.git_status).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.git_push.openWorldHint).toBe(true);
    expect(byName.http_check).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(byName.github_list_issues.openWorldHint).toBe(true);
    expect(byName.pipeline_list.openWorldHint).toBe(false);
    expect(byName.search_tools).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(byName.use_tool).toMatchObject({ readOnlyHint: false, openWorldHint: true });
  }, 60000);
});
