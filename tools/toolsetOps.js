// `causly-server toolsets`: choose which packs load at startup in the user's editors.
// Clients like Claude Desktop do not refresh their tool list mid-chat, so what is
// switched on here is what the agent can use from the first message.
import fs from "fs";
import { PACKS } from "../packs/registry.js";
import {
  DEFAULT_TOOLSETS,
  SERVER_NAME,
  clientConfigPath,
  pickClients,
  readJson,
  backup,
} from "./cliOps.js";

const CLIENT_LABEL = { claude: "Claude Desktop", cursor: "Cursor", windsurf: "Windsurf" };
const ACTIONS = ["list", "add", "remove", "reset"];

const parse = (v) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const coreNames = () => Object.keys(PACKS).filter((n) => PACKS[n].core);
const optionalNames = () => Object.keys(PACKS).filter((n) => !PACKS[n].core);

function toolCounts() {
  try {
    const m = JSON.parse(fs.readFileSync(new URL("../packs/manifest.json", import.meta.url), "utf8"));
    return Object.fromEntries(Object.entries(m.packs || {}).map(([n, p]) => [n, p.tools?.length ?? null]));
  } catch {
    return {};
  }
}

/** "all" is expanded so a single pack can be removed from it. */
const expand = (list) => (list.includes("all") ? [...new Set([...list.filter((n) => n !== "all"), ...optionalNames()])] : list);

export function toolsetRows(list) {
  const on = new Set(expand(list));
  const counts = toolCounts();
  return Object.entries(PACKS).map(([name, pack]) => ({
    name,
    description: pack.description,
    core: Boolean(pack.core),
    on: Boolean(pack.core) || on.has(name),
    tools: counts[name] ?? null,
  }));
}

export function formatToolsets(rows) {
  const width = Math.max(...rows.map((r) => r.name.length));
  const line = (r) =>
    `  ${r.on ? "on " : "off"}  ${r.name.padEnd(width)}  ${String(r.tools ?? "?").padStart(2)} tools  ${r.description}`;
  const on = rows.filter((r) => r.on);
  const off = rows.filter((r) => !r.on);
  const out = [`Loaded at startup (${on.length}):`, ...on.map(line)];
  if (off.length) out.push("", `Not loaded (${off.length}); the agent can still load these in clients that refresh their tool list:`, ...off.map(line));
  out.push("", "Change with: causly-server toolsets add <name,...> | remove <name,...> | reset");
  return out;
}

function writeToolsets(file, list) {
  const { config } = readJson(file);
  const entry = config.mcpServers[SERVER_NAME];
  const env = { ...(entry.env || {}) };
  if (list.length) env.CAUSLY_TOOLSETS = list.join(",");
  else delete env.CAUSLY_TOOLSETS;
  if (Object.keys(env).length) entry.env = env;
  else delete entry.env;
  backup(file);
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

export function runToolsets({ action = "list", names = [], client, platform, home, env } = {}) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown toolsets command "${action}". Use: ${ACTIONS.join(", ")}.`);
  const where = { platform, home, env };
  const targets = pickClients(client || "all", where)
    .map((c) => ({ client: c, file: clientConfigPath(c, where) }))
    .filter((t) => {
      const { config } = readJson(t.file);
      return config.mcpServers && SERVER_NAME in config.mcpServers;
    });
  if (!targets.length) throw new Error('causly-server is not set up in any editor yet. Run "causly-server init" first.');

  const requested = [...new Set(names.map((n) => String(n).trim().toLowerCase()).filter(Boolean))];
  const current = (t) => parse(readJson(t.file).config.mcpServers[SERVER_NAME].env?.CAUSLY_TOOLSETS);
  const notes = [];
  let changed = false;

  if (action === "add" || action === "remove") {
    if (!requested.length) throw new Error(`Name at least one toolset, for example: causly-server toolsets ${action} github`);
    const unknown = requested.filter((n) => !PACKS[n] && n !== "all");
    if (unknown.length) throw new Error(`Unknown toolset: ${unknown.join(", ")}. Available: ${optionalNames().join(", ")}.`);
  }

  for (const t of targets) {
    const before = current(t);
    let after = before;
    if (action === "reset") after = parse(DEFAULT_TOOLSETS);
    else if (action === "add") after = [...new Set([...expand(before), ...requested.filter((n) => !PACKS[n]?.core)])];
    else if (action === "remove") after = expand(before).filter((n) => !requested.includes(n));
    if (action === "add" && requested.includes("all")) after = ["all"];
    if (action !== "list" && after.join(",") !== before.join(",")) {
      writeToolsets(t.file, after);
      changed = true;
    }
    t.after = after;
  }
  for (const n of requested) if (PACKS[n]?.core) notes.push(`${n} is a core toolset and is always on.`);

  const rows = toolsetRows(targets[0].after ?? current(targets[0]));
  const lines = formatToolsets(rows);
  if (action !== "list") {
    const labels = targets.map((t) => CLIENT_LABEL[t.client]).join(" and ");
    lines.unshift(
      changed ? `Updated ${labels}. Restart ${labels} to apply.` : "Nothing changed.",
      ...notes,
      ""
    );
  }
  return { changed, clients: targets.map((t) => t.client), rows, lines };
}
