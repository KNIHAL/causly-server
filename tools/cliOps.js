// Logic behind the `causly-server` command: init, remove, doctor.
// bin/causly.js is a thin wrapper so all of this can be tested with temp folders.
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { PACKAGE_ROOT, causlyHome, envFiles } from "./paths.js";

export const SERVER_NAME = "causly-server";
export const CLIENTS = ["claude", "cursor", "windsurf"];

const CLIENT_LABEL = { claude: "Claude Desktop", cursor: "Cursor", windsurf: "Windsurf" };

/** Config file of each editor/app that speaks MCP. */
export function clientConfigPath(client, { platform = os.platform(), home = os.homedir(), env = process.env } = {}) {
  switch (client) {
    case "claude":
      if (platform === "win32") return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
      if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      return path.join(home, ".config", "Claude", "claude_desktop_config.json");
    case "cursor":
      return path.join(home, ".cursor", "mcp.json");
    case "windsurf":
      return path.join(home, ".codeium", "windsurf", "mcp_config.json");
    default:
      throw new Error(`Unknown client "${client}". Use one of: ${CLIENTS.join(", ")}, all.`);
  }
}

/** A client counts as installed when its config folder exists (Claude Desktop, Cursor, Windsurf create it on first run). */
export function detectClients(opts = {}) {
  return CLIENTS.filter((c) => fs.existsSync(path.dirname(clientConfigPath(c, opts))));
}

/**
 * What the client should run. From a global install or a git checkout that is
 * `node <path>/index.js` with the absolute node path (GUI apps often lack node on PATH).
 * From the temporary npx cache that path would disappear, so use `npx -y causly-server`.
 */
export function serverEntry({ root = PACKAGE_ROOT, platform = os.platform(), execPath = process.execPath, workspace, toolsets } = {}) {
  const fromNpxCache = root.split(/[\\/]/).includes("_npx");
  const entry = fromNpxCache
    ? platform === "win32"
      ? { command: "cmd", args: ["/c", "npx", "-y", SERVER_NAME] }
      : { command: "npx", args: ["-y", SERVER_NAME] }
    : { command: execPath, args: [path.join(root, "index.js")] };
  const env = {};
  if (workspace) env.CAUSLY_WORKSPACE = path.resolve(workspace);
  if (toolsets) env.CAUSLY_TOOLSETS = toolsets;
  if (Object.keys(env).length) entry.env = env;
  return entry;
}

export function readJson(file) {
  if (!fs.existsSync(file)) return { config: {}, existed: false, broken: false };
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return { config: {}, existed: true, broken: false };
  try {
    const config = JSON.parse(raw);
    if (config && typeof config === "object" && !Array.isArray(config)) return { config, existed: true, broken: false };
  } catch {
    // fall through
  }
  return { config: {}, existed: true, broken: true };
}

export function backup(file) {
  const copy = `${file}.backup-${Date.now()}`;
  fs.copyFileSync(file, copy);
  return copy;
}

/** Add or update our entry, keeping every other server and setting in the file. */
export function upsertServerEntry(file, entry) {
  const { config, existed, broken } = readJson(file);
  let backedUp;
  if (existed) backedUp = backup(file);
  if (!config.mcpServers || typeof config.mcpServers !== "object") config.mcpServers = {};
  const had = SERVER_NAME in config.mcpServers;
  config.mcpServers[SERVER_NAME] = entry;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { updated: had, created: !had, backup: backedUp, replacedBrokenFile: broken };
}

export function removeServerEntry(file) {
  const { config, existed, broken } = readJson(file);
  if (!existed || broken || !config.mcpServers || !(SERVER_NAME in config.mcpServers)) return { removed: false };
  const copy = backup(file);
  delete config.mcpServers[SERVER_NAME];
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { removed: true, backup: copy };
}

export function pickClients(client, opts) {
  if (!client || client === "auto") {
    const found = detectClients(opts);
    return found.length ? found : ["claude"];
  }
  if (client === "all") return [...CLIENTS];
  return String(client)
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      if (!CLIENTS.includes(c)) throw new Error(`Unknown client "${c}". Use one of: ${CLIENTS.join(", ")}, all.`);
      return c;
    });
}

/**
 * Set the server up for the user's editors. Creates ~/.causly/.env from the template
 * (unless a checkout already has a .env) and registers the server with each client.
 */
// Claude Desktop and others do not refresh tools mid-chat, so everyday packs load at startup.
export const DEFAULT_TOOLSETS = "research,leads,seo,pipeline,reminders,meetings";

export function runInit({ client, workspace, toolsets, platform, home, env, root = PACKAGE_ROOT } = {}) {
  const where = { platform, home, env };
  const clients = pickClients(client, where);
  const lines = [];

  if (workspace && !fs.existsSync(workspace)) throw new Error(`The workspace folder does not exist: ${workspace}`);

  const envFile = path.join(causlyHome(), ".env");
  const template = path.join(root, ".env.example");
  const checkoutEnv = path.join(root, ".env");
  let envPath = fs.existsSync(checkoutEnv) ? checkoutEnv : envFile;
  if (!fs.existsSync(envPath)) {
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    if (fs.existsSync(template)) fs.copyFileSync(template, envFile);
    else fs.writeFileSync(envFile, "# causly-server settings: KEY=value, one per line\n");
    lines.push(`Created ${envFile} (add your API keys there)`);
  } else {
    lines.push(`Using existing ${envPath}`);
  }

  const entry = serverEntry({ root, platform, workspace, toolsets: toolsets ?? DEFAULT_TOOLSETS });
  const results = [];
  for (const c of clients) {
    const file = clientConfigPath(c, where);
    const r = upsertServerEntry(file, entry);
    results.push({ client: c, file, ...r });
    lines.push(`${r.updated ? "Updated" : "Added"} ${CLIENT_LABEL[c]}: ${file}${r.replacedBrokenFile ? " (the old file was not valid JSON; kept a backup)" : ""}`);
  }
  lines.push(`Restart ${clients.map((c) => CLIENT_LABEL[c]).join(" and ")} to load it.`);
  lines.push(`Claude Code: claude mcp add ${SERVER_NAME} -- ${[entry.command, ...entry.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
  if (!workspace) lines.push("Tip: limit file access to one folder with --workspace <folder> (re-run init).");
  return { env_file: envPath, entry, clients: results, lines };
}

export function runRemove({ client, platform, home, env } = {}) {
  const where = { platform, home, env };
  const clients = client ? pickClients(client, where) : [...CLIENTS];
  const lines = [];
  const results = clients.map((c) => {
    const file = clientConfigPath(c, where);
    const r = removeServerEntry(file);
    if (r.removed) lines.push(`Removed from ${CLIENT_LABEL[c]}: ${file}`);
    return { client: c, file, ...r };
  });
  if (!lines.length) lines.push("Nothing to remove: causly-server is not set up in any client.");
  else lines.push(`Your settings in ${causlyHome()} were left alone; delete that folder to remove them too.`);
  return { clients: results, lines };
}

// ---------------------------------------------------------------- doctor

const SERVICES = [
  ["GitHub", ["GITHUB_TOKEN"]],
  ["Slack", ["SLACK_BOT_TOKEN"]],
  ["Gmail", ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]],
  ["Google Calendar", ["CALENDAR_REFRESH_TOKEN"]],
  ["Telegram", ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]],
  ["Linear", ["LINEAR_API_KEY"]],
  ["Stripe", ["STRIPE_API_KEY"]],
  ["Discord", ["DISCORD_BOT_TOKEN"]],
  ["Groq (meeting transcription)", ["GROQ_API_KEY"]],
  ["Notion", ["NOTION_API_KEY"]],
  ["Sentry", ["SENTRY_AUTH_TOKEN"]],
];

const versionAtLeast = (v, [maj, min]) => {
  const [a, b] = String(v).replace(/^v/, "").split(".").map(Number);
  return a > maj || (a === maj && b >= min);
};

function probe(exec, cmd, args) {
  return new Promise((resolve) => exec(cmd, args, { timeout: 8000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).split("\n")[0].trim())));
}

export async function runDoctor({ env = process.env, exec = execFile, nodeVersion = process.versions.node, platform, home } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add("Node.js", versionAtLeast(nodeVersion, [20, 0]), `${nodeVersion}${versionAtLeast(nodeVersion, [22, 13]) ? "" : " (22.13+ is needed for pipeline, meetings and reminders)"}`);

  const files = envFiles().filter((f) => fs.existsSync(f));
  add("Settings file", files.length > 0, files.length ? files.join(", ") : `none found; run "causly-server init" or create ${path.join(causlyHome(), ".env")}`);

  const loaded = (keys) => keys.every((k) => env[k]);
  const configured = SERVICES.filter(([, keys]) => loaded(keys)).map(([n]) => n);
  const missing = SERVICES.filter(([, keys]) => !loaded(keys)).map(([n]) => n);
  add("Integrations configured", configured.length > 0, configured.length ? configured.join(", ") : "none yet (add keys to the settings file)");

  const ff = await probe(exec, "ffmpeg", ["-version"]);
  add("ffmpeg (large recordings)", Boolean(ff), ff ? ff.slice(0, 40) : "not found; only needed for recordings over 25 MB");

  add("Workspace limit", Boolean(env.CAUSLY_WORKSPACE), env.CAUSLY_WORKSPACE || "off: file tools can reach any folder (set with: causly-server init --workspace <folder>)");

  const where = { platform, home, env };
  const registered = CLIENTS.filter((c) => {
    const { config } = readJson(clientConfigPath(c, where));
    return config.mcpServers && SERVER_NAME in config.mcpServers;
  });
  add("Set up in", registered.length > 0, registered.length ? registered.map((c) => CLIENT_LABEL[c]).join(", ") : 'no editor yet; run "causly-server init"');

  return { ok: checks.filter((c) => c.name === "Node.js" || c.name === "Settings file").every((c) => c.ok), checks, not_configured: missing };
}
