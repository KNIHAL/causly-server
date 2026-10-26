import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const hasSqlite = await import("node:sqlite").then(
  () => true,
  () => false
);

describe.skipIf(!hasSqlite)("reminders pack (stdio)", () => {
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-reminders-e2e-"));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads on demand and keeps reminders in the local database", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["index.js"],
      cwd: process.cwd(),
      env: { CAUSLY_TOOLSETS: "", CAUSLY_DB_PATH: path.join(dir, "e2e.db") },
      stderr: "ignore",
    });
    const client = new Client({ name: "reminders-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const before = (await client.listTools()).tools.map((t) => t.name);
      expect(before).not.toContain("reminder_create");

      await client.callTool({ name: "load_toolset", arguments: { toolsets: ["reminders"] } });
      const after = (await client.listTools()).tools.map((t) => t.name);
      expect(after).toEqual(expect.arrayContaining(["reminder_create", "reminder_list", "reminder_update"]));

      const created = await client.callTool({
        name: "reminder_create",
        arguments: { title: "Follow up with Acme", in_hours: 48 },
      });
      expect(created.isError).toBeFalsy();
      expect(JSON.parse(created.content[0].text).title).toBe("Follow up with Acme");

      const listed = await client.callTool({ name: "reminder_list", arguments: {} });
      expect(JSON.parse(listed.content[0].text).count).toBe(1);
    } finally {
      await client.close();
    }
    expect(fs.existsSync(path.join(dir, "e2e.db"))).toBe(true);
  }, 30000);
});
