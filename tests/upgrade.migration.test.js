import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, closeDb } from "../tools/store.js";
import { listDeals, getDeal, addLead } from "../tools/pipelineOps.js";
import { listMeetings, listActions } from "../tools/meetingOps.js";
import { reminderList } from "../tools/reminderOps.js";
import { secretsGet, secretsSet } from "../tools/secretsOps.js";
import { readEnvValues } from "../tools/envFile.js";
import { loadEnv } from "../tools/envLoader.js";
import { upsertServerEntry, readJson } from "../tools/cliOps.js";

// P0-11: upgrade from 1.5.0 and corrupt local files. The fixture database was written by the real
// causly-server 1.5.0 (pipeline deal, meeting with an action item, reminder). Never edit it: add a
// new fixture for a new release instead.
const FIXTURE = new URL("./fixtures/db-1.5.0/causly-1.5.0.db", import.meta.url);
const hasSqlite = await import("node:sqlite").then(() => true, () => false);

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-upgrade-"));
});
afterEach(() => {
  closeDb();
  delete process.env.CAUSLY_DB_PATH;
  delete process.env.CAUSLY_HOME;
  delete process.env.SECRETS_MASTER_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

function tableCounts(file) {
  const { DatabaseSync } = require_sqlite();
  const h = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = h.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    return Object.fromEntries(tables.map((t) => [t, h.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
  } finally {
    h.close();
  }
}
let sqliteModule;
const require_sqlite = () => sqliteModule;
if (hasSqlite) sqliteModule = await import("node:sqlite");

describe.skipIf(!hasSqlite)("upgrade from 1.5.0", () => {
  it("keeps pipeline, meetings, actions and reminders intact and keeps working", async () => {
    const file = path.join(dir, "causly.db");
    fs.copyFileSync(FIXTURE, file);
    const before = tableCounts(file);
    expect(before.deals).toBeGreaterThanOrEqual(1);
    process.env.CAUSLY_DB_PATH = file;

    const deals = await listDeals({});
    expect(JSON.stringify(deals)).toContain("Fixture deal");
    const first = deals.deals?.[0] ?? deals[0];
    const deal = await getDeal({ deal_id: first.id });
    expect(JSON.stringify(deal)).toContain("Acme Fixture Ltd");
    expect(JSON.stringify(deal)).toContain("proposal");

    expect(JSON.stringify(await listMeetings({}))).toContain("Kickoff 1.5.0");
    expect(JSON.stringify(await listActions({}))).toContain("Send contract");
    expect(JSON.stringify(await reminderList({}))).toContain("Follow up with Acme");

    // New code can write next to the old data.
    await addLead({ company: "New Co", deal_title: "After upgrade" });
    expect(JSON.stringify(await listDeals({}))).toContain("After upgrade");
    closeDb();

    const after = tableCounts(file);
    for (const [table, n] of Object.entries(before)) expect(after[table], `table ${table} lost rows`).toBeGreaterThanOrEqual(n);
  });

  it("does not re-run migrations that 1.5.0 already applied", async () => {
    const file = path.join(dir, "causly.db");
    fs.copyFileSync(FIXTURE, file);
    const read = () => {
      const h = new sqliteModule.DatabaseSync(file, { readOnly: true });
      try {
        return h.prepare("SELECT namespace, version, applied_at FROM schema_migrations ORDER BY namespace, version").all().map((r) => ({ ...r }));
      } finally {
        h.close();
      }
    };
    const old = read();
    process.env.CAUSLY_DB_PATH = file;
    await getDb();
    closeDb();
    const now = read();
    for (const row of old) expect(now).toContainEqual(row);
  });
});

describe.skipIf(!hasSqlite)("corrupt files give a clear error, not a crash", () => {
  it("a corrupt database", async () => {
    const file = path.join(dir, "causly.db");
    fs.writeFileSync(file, "this is not a sqlite database ".repeat(200));
    process.env.CAUSLY_DB_PATH = file;
    const err = await getDb().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain(file);
    expect(err.message).toMatch(/not a valid|corrupt|damaged/i);
    expect(err.message).toMatch(/restore|move|delete|backup/i);
  });

  it("a corrupt .env is read without throwing", () => {
    process.env.CAUSLY_HOME = dir;
    const garbage = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x80]), Buffer.from('\nKEY="unterminated\n=novalue\n\u0000\nOK=1\n')]);
    fs.writeFileSync(path.join(dir, ".env"), garbage);
    expect(() => readEnvValues(path.join(dir, ".env"))).not.toThrow();
    expect(() => loadEnv()).not.toThrow();
  });

  it("a corrupt secrets file", async () => {
    process.env.SECRETS_MASTER_KEY = "a".repeat(64);
    const store = path.join(dir, "secrets.enc");
    fs.writeFileSync(store, "garbage, not an encrypted store");
    const err = await secretsGet({ name: "X", store_path: store }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message.length).toBeGreaterThan(10);
    await expect(secretsSet({ name: "X", value: "y", store_path: store, confirm: true })).rejects.toBeInstanceOf(Error);
    // The damaged file is left for the user to inspect, not silently replaced.
    expect(fs.readFileSync(store, "utf8")).toBe("garbage, not an encrypted store");
  });
});

describe("client config (Claude Desktop, Cursor, Windsurf)", () => {
  const entry = { command: "node", args: ["index.js"] };

  it("adds the server and keeps the other servers", () => {
    const file = path.join(dir, "claude_desktop_config.json");
    fs.writeFileSync(file, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } }, null, 2));
    upsertServerEntry(file, entry);
    const json = readJson(file).config;
    expect(json.theme).toBe("dark");
    expect(json.mcpServers.other).toEqual({ command: "x" });
    expect(json.mcpServers["causly-server"] ?? Object.values(json.mcpServers).find((s) => s.args?.[0] === "index.js")).toBeTruthy();
  });

  it("a config that is not valid JSON is never lost: a byte-for-byte backup is kept and the user is told", () => {
    const file = path.join(dir, "claude_desktop_config.json");
    const broken = '{ "mcpServers": { "other": { "command": "x" }, ';
    fs.writeFileSync(file, broken);
    const result = upsertServerEntry(file, entry);
    expect(result.replacedBrokenFile).toBe(true);
    expect(fs.readFileSync(result.backup, "utf8")).toBe(broken);
    expect(() => JSON.parse(fs.readFileSync(file, "utf8"))).not.toThrow();
  });});
