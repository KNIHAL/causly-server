import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Sample arguments for every prompt that takes them.
const ARGS = {
  "ship-feature": { repo_path: "/tmp/r", description: "add x" },
  "fix-ci": { repo_path: "/tmp/r", owner: "o", repo: "r" },
  "deploy-project": { repo_path: "/tmp/r", project: "p", git_source_repo: "o/r" },
  "review-changes": { owner: "o", repo: "r", pull_number: "1" },
};

describe("MCP prompts (stdio)", () => {
  it("serves the co-founder prompt and playbooks, and every prompt tells the agent to load toolsets", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["index.js"],
      cwd: process.cwd(),
      env: { CAUSLY_TOOLSETS: "" },
      stderr: "ignore",
    });
    const client = new Client({ name: "prompts-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name);
      expect(names).toEqual(
        expect.arrayContaining(["cofounder", "follow-up-review", "ship-feature", "fix-ci", "deploy-project", "review-changes"])
      );

      for (const name of names) {
        const res = await client.getPrompt({ name, arguments: ARGS[name] ?? {} });
        const text = res.messages[0].content.text;
        // Only a small core set is loaded by default, so each prompt must say how to get the rest.
        expect(text, `${name} should mention load_toolset`).toContain("load_toolset");
      }

      const withFocus = await client.getPrompt({ name: "cofounder", arguments: { focus: "launch the blog" } });
      const text = withFocus.messages[0].content.text;
      expect(text).toContain("confirm: true");
      expect(text).toContain("search_tools");
      expect(text).toContain("Current focus: launch the blog");
    } finally {
      await client.close();
    }
  }, 30000);
});
