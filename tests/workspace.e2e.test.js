import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let base, root;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "causly-ws-e2e-"));
  root = path.join(base, "project");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "inside.txt"), "hello from inside");
  fs.writeFileSync(path.join(base, "outside.txt"), "should not be readable");
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("workspace jail (stdio)", () => {
  it("blocks paths outside CAUSLY_WORKSPACE and allows paths inside", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["index.js"],
      cwd: process.cwd(),
      env: { CAUSLY_TOOLSETS: "", CAUSLY_WORKSPACE: root },
      stderr: "ignore",
    });
    const client = new Client({ name: "workspace-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const inside = await client.callTool({ name: "read_file", arguments: { path: path.join(root, "inside.txt") } });
      expect(inside.isError).toBeFalsy();
      expect(inside.content[0].text).toContain("hello from inside");

      const outside = await client.callTool({ name: "read_file", arguments: { path: path.join(base, "outside.txt") } });
      expect(outside.isError).toBe(true);
      expect(outside.content[0].text).toContain("outside the allowed workspace");
      expect(outside.content[0].text).not.toContain("should not be readable");
    } finally {
      await client.close();
    }
  }, 30000);
});
