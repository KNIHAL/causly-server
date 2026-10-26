// Plain-JS "custom agent" smoke test: any MCP client can drive causly-server like this.
// Usage: node scripts/agent-smoke.mjs [repo_path]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = process.argv[2] || root;

const client = new Client({ name: "custom-agent-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "index.js")],
  cwd: root,
});

const text = (r) => (r.content || []).map((c) => c.text ?? "").join("\n");
let failed = 0;
const check = (name, ok, info = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  " + info : ""}`);
  if (!ok) failed++;
};

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  check("listTools", names.length > 0, `${names.length} tools`);
  check("meta tools present", ["search_tools", "load_toolset", "use_tool"].every((n) => names.includes(n)));

  const found = await client.callTool({ name: "search_tools", arguments: { query: "git status" } });
  check("search_tools finds git_status", !found.isError && /git_status/.test(text(found)));

  const status = await client.callTool({
    name: "use_tool",
    arguments: { tool: "git_status", arguments: { repo_path: repoPath } },
  });
  let branch = "";
  try { branch = JSON.parse(text(status)).status.current; } catch {}
  check("use_tool -> git_status", !status.isError && !!branch, `branch=${branch}`);

  const bad = await client.callTool({ name: "use_tool", arguments: { tool: "no_such_tool", arguments: {} } });
  check("unknown tool fails cleanly", bad.isError === true || /unknown|not found/i.test(text(bad)));
} catch (e) {
  check("agent run", false, e.message);
} finally {
  await client.close().catch(() => {});
}
process.exit(failed ? 1 : 0);
