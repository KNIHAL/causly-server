// `causly-server status`: one screen with what is set up and what is waiting.
import fs from "fs";
import { SERVICES, serviceState } from "./services.js";
import { CLIENTS, SERVER_NAME, clientConfigPath, readJson } from "./cliOps.js";
import { dbPath } from "./store.js";
import { latestBackup } from "./backupOps.js";
import { checkForUpdate, updateMessage } from "./updateCheck.js";
import { PACKS } from "../packs/registry.js";

const CLIENT_LABEL = { claude: "Claude Desktop", cursor: "Cursor", windsurf: "Windsurf" };

async function readData(dbFile, now) {
  if (!fs.existsSync(dbFile)) return null;
  let sqlite;
  try {
    sqlite = await import("node:sqlite");
  } catch {
    return { unavailable: true };
  }
  let db;
  try {
    db = new sqlite.DatabaseSync(dbFile, { readOnly: true });
  } catch {
    return { unavailable: true };
  }
  const one = (sql, ...args) => {
    try {
      return db.prepare(sql).get(...args);
    } catch {
      return null; // that pack has never been used, so its table does not exist yet
    }
  };
  try {
    const today = now.toISOString().slice(0, 10);
    return {
      companies: one("SELECT COUNT(*) AS n FROM companies")?.n ?? 0,
      open_deals: one("SELECT COUNT(*) AS n FROM deals WHERE closed_at IS NULL")?.n ?? 0,
      meetings: one("SELECT COUNT(*) AS n FROM meetings")?.n ?? 0,
      open_actions: one("SELECT COUNT(*) AS n FROM action_items WHERE status = 'open'")?.n ?? 0,
      overdue_actions: one("SELECT COUNT(*) AS n FROM action_items WHERE status = 'open' AND due_date IS NOT NULL AND due_date < ?", today)?.n ?? 0,
      pending_reminders: one("SELECT COUNT(*) AS n FROM reminders WHERE status = 'pending'")?.n ?? 0,
      overdue_reminders: one("SELECT COUNT(*) AS n FROM reminders WHERE status = 'pending' AND due_at <= ?", now.toISOString())?.n ?? 0,
      next_reminder: one("SELECT title, due_at FROM reminders WHERE status = 'pending' ORDER BY due_at LIMIT 1") ?? null,
    };
  } finally {
    db.close();
  }
}

const ago = (ms, now) => {
  const days = Math.floor((now - ms) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

export async function runStatus({ env = process.env, version, platform, home, dbFile = dbPath(), now = new Date(), fetch: fetchFn, checkUpdate = true } = {}) {
  const where = { platform, home, env };
  const lines = [`causly-server ${version}`, ""];

  // editors
  const editors = CLIENTS.map((c) => {
    const { config } = readJson(clientConfigPath(c, where));
    const entry = config.mcpServers?.[SERVER_NAME];
    return entry ? { client: c, entry } : null;
  }).filter(Boolean);
  if (!editors.length) lines.push('Editors:   none yet. Run "causly-server init".');
  for (const { client, entry } of editors) {
    const requested = String(entry.env?.CAUSLY_TOOLSETS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const core = Object.keys(PACKS).filter((n) => PACKS[n].core);
    const packs = requested.includes("all") ? Object.keys(PACKS).length : new Set([...core, ...requested.filter((n) => PACKS[n])]).size;
    const workspace = entry.env?.CAUSLY_WORKSPACE ? `files limited to ${entry.env.CAUSLY_WORKSPACE}` : "file access not limited to a folder";
    lines.push(`Editors:   ${CLIENT_LABEL[client]} (${packs} tool packs at startup; ${workspace})`);
  }

  // keys
  const ready = SERVICES.filter((s) => serviceState(s, env).configured).map((s) => s.name);
  const partial = SERVICES.filter((s) => serviceState(s, env).incomplete).map((s) => s.name);
  lines.push(`Keys:      ${ready.length ? `${ready.length} ready (${ready.join(", ")})` : "none yet"}`);
  if (partial.length) lines.push(`           incomplete: ${partial.join(", ")}`);
  lines.push('           add or fix with "causly-server setup", test with "causly-server doctor --test"');

  // data
  const data = await readData(dbFile, now);
  lines.push("");
  if (!data) lines.push("Data:      nothing saved yet (pipeline, meetings and reminders appear here once used)");
  else if (data.unavailable) lines.push("Data:      cannot be read here (needs Node 22.13 or newer)");
  else {
    lines.push(`Pipeline:  ${data.open_deals} open deal(s), ${data.companies} companies`);
    lines.push(`Meetings:  ${data.meetings} saved; ${data.open_actions} open action item(s)${data.overdue_actions ? `, ${data.overdue_actions} overdue` : ""}`);
    const next = data.next_reminder ? `; next: "${data.next_reminder.title}" at ${new Date(data.next_reminder.due_at).toLocaleString()}` : "";
    lines.push(`Reminders: ${data.pending_reminders} pending${data.overdue_reminders ? ` (${data.overdue_reminders} due now)` : ""}${next}`);
  }

  const backup = data && !data.unavailable ? latestBackup() : null;
  if (data && !data.unavailable) {
    lines.push(backup ? `Backup:    last one ${ago(backup.mtime, now.getTime())}` : 'Backup:    none yet. Make one with "causly-server backup"');
  }

  // update
  if (checkUpdate) {
    const msg = updateMessage(await checkForUpdate({ current: version, fetch: fetchFn, env }));
    if (msg) lines.push("", msg);
  }
  return { lines, editors: editors.map((e) => e.client), ready, partial, data, backup };
}
