import { describe, it, expect } from "vitest";
import fs from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

async function connect(toolsets) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["index.js"],
    cwd: process.cwd(),
    env: { CAUSLY_TOOLSETS: toolsets },
    stderr: "ignore",
  });
  const client = new Client({ name: "lazy-loading-test", version: "0.0.0" });
  let changed = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    changed++;
  });
  await client.connect(transport);
  const names = async () => (await client.listTools()).tools.map((t) => t.name);
  return { client, names, changes: () => changed };
}

describe("lazy tool loading (stdio)", () => {
  it("starts with the core set and loads more on demand", async () => {
    const { client, names, changes } = await connect("");
    try {
      const before = await names();
      expect(before).toContain("search_tools");
      expect(before).toContain("load_toolset");
      expect(before).toContain("read_file");
      expect(before).not.toContain("git_status");
      expect(before.length).toBeLessThanOrEqual(30);

      await client.callTool({ name: "load_toolset", arguments: { toolsets: ["git"] } });
      const after = await names();
      expect(after).toContain("git_status");
      expect(after.length).toBeGreaterThan(before.length);
      expect(changes()).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  }, 30000);

  it("CAUSLY_TOOLSETS=all exposes every tool", async () => {
    const { client, names } = await connect("all");
    try {
      const manifest = JSON.parse(fs.readFileSync(new URL("../packs/manifest.json", import.meta.url), "utf8"));
      const total = Object.values(manifest.packs).reduce((n, p) => n + p.tools.length, 0);
      expect((await names()).length).toBe(total + 2); // + search_tools, load_toolset
    } finally {
      await client.close();
    }
  }, 30000);
});
