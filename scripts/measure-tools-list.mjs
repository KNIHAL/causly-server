// Measures what `tools/list` costs a session for the default packs (and optionally others).
// Usage: node scripts/measure-tools-list.mjs [toolsets]   e.g. "" (default) or "git,docker"
// Prints tool count, JSON bytes and an estimate of tokens (bytes / 4, a rough rule for English+JSON).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const toolsets = process.argv[2] ?? "";
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["index.js"],
  cwd: process.cwd(),
  env: { CAUSLY_TOOLSETS: toolsets, PATH: process.env.PATH ?? process.env.Path ?? "" },
  stderr: "ignore",
});
const client = new Client({ name: "measure", version: "0.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
await client.close();

const bytes = Buffer.byteLength(JSON.stringify(tools));
const rows = tools
  .map((t) => ({ name: t.name, bytes: Buffer.byteLength(JSON.stringify(t)) }))
  .sort((a, b) => b.bytes - a.bytes);
console.log(JSON.stringify({ toolsets: toolsets || "(default)", tools: tools.length, bytes, approx_tokens: Math.round(bytes / 4), largest: rows.slice(0, 5) }, null, 2));
