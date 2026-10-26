import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { runBackup, runRestore, latestBackup } from "../tools/backupOps.js";
import { runStatus } from "../tools/statusOps.js";
import { checkForUpdate, compareVersions, updateMessage } from "../tools/updateCheck.js";
import { runInit, welcomeLines } from "../tools/cliOps.js";

let dir;
let dbFile;
const NOW = new Date("2026-10-26T10:00:00Z");

function makeDb(file, rows = ["first"]) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (namespace TEXT, version INTEGER)");
  db.exec("CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, title TEXT, due_at TEXT, status TEXT)");
  for (const r of rows) db.prepare("INSERT INTO reminders (title, due_at, status) VALUES (?, ?, 'pending')").run(r, "2026-10-27T03:30:00.000Z");
  db.close();
}
const titles = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  const out = db.prepare("SELECT title FROM reminders ORDER BY id").all().map((r) => r.title);
  db.close();
  return out;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-backup-"));
  dbFile = path.join(dir, "causly.db");
  process.env.CAUSLY_HOME = path.join(dir, "home");
});
afterEach(() => {
  delete process.env.CAUSLY_HOME;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("backup and restore", () => {
  it("backs up a live database and refuses to overwrite a backup", async () => {
    makeDb(dbFile, ["a", "b"]);
    const r = await runBackup({ dbFile, now: NOW });
    expect(r.file).toContain(path.join("home", "backups"));
    expect(titles(r.file)).toEqual(["a", "b"]);
    await expect(runBackup({ dbFile, file: r.file })).rejects.toThrow(/already exists/);
  });

  it("says so when there is nothing to back up", async () => {
    await expect(runBackup({ dbFile })).rejects.toThrow(/Nothing to back up/);
  });

  it("restores, keeping a copy of what was there", async () => {
    makeDb(dbFile, ["old"]);
    const backup = (await runBackup({ dbFile, file: path.join(dir, "b.db") })).file;
    const db = new DatabaseSync(dbFile);
    db.prepare("INSERT INTO reminders (title, due_at, status) VALUES ('newer', 'x', 'pending')").run();
    db.close();

    const r = await runRestore({ file: backup, dbFile, now: NOW });
    expect(titles(dbFile)).toEqual(["old"]);
    expect(titles(r.safety_copy)).toEqual(["old", "newer"]);
  });

  it("restores onto a computer with no data yet", async () => {
    makeDb(path.join(dir, "src.db"), ["x"]);
    const r = await runRestore({ file: path.join(dir, "src.db"), dbFile });
    expect(titles(dbFile)).toEqual(["x"]);
    expect(r.safety_copy).toBeNull();
  });

  it("rejects files that are not causly backups", async () => {
    const other = path.join(dir, "other.db");
    const db = new DatabaseSync(other);
    db.exec("CREATE TABLE t (a)");
    db.close();
    fs.writeFileSync(path.join(dir, "junk.db"), "not a database");
    await expect(runRestore({ file: other, dbFile })).rejects.toThrow(/not a causly-server backup/);
    await expect(runRestore({ file: path.join(dir, "junk.db"), dbFile })).rejects.toThrow(/not a causly-server backup/);
    await expect(runRestore({ file: path.join(dir, "missing.db"), dbFile })).rejects.toThrow(/File not found/);
  });

  it("finds the newest backup", async () => {
    expect(latestBackup()).toBeNull();
    makeDb(dbFile);
    const r = await runBackup({ dbFile, now: NOW });
    expect(latestBackup().file).toBe(r.file);
  });
});

describe("update check", () => {
  it("compares versions", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.5.0", "1.5.0")).toBe(0);
    expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0);
  });

  const reply = (version) => async () => new Response(JSON.stringify({ version }), { status: 200 });
  const cacheFile = () => path.join(dir, "cache.json");

  it("reports a newer version and remembers it for a day", async () => {
    let calls = 0;
    const fetch = async () => (calls++, reply("1.6.0")());
    const first = await checkForUpdate({ current: "1.5.0", fetch, cacheFile: cacheFile(), env: {}, now: () => 1000 });
    expect(first.newer).toBe(true);
    expect(updateMessage(first)).toMatch(/1\.5\.0 -> 1\.6\.0/);
    await checkForUpdate({ current: "1.5.0", fetch, cacheFile: cacheFile(), env: {}, now: () => 2000 });
    expect(calls).toBe(1);
    await checkForUpdate({ current: "1.5.0", fetch, cacheFile: cacheFile(), env: {}, now: () => 1000 + 25 * 3_600_000 });
    expect(calls).toBe(2);
  });

  it("stays quiet when up to date, offline, unpublished or switched off", async () => {
    const own = (n) => path.join(dir, `cache-${n}.json`);
    expect(updateMessage(await checkForUpdate({ current: "1.5.0", fetch: reply("1.5.0"), cacheFile: own(1), env: {} }))).toBeNull();
    expect(await checkForUpdate({ current: "1.5.0", fetch: async () => { throw new Error("offline"); }, cacheFile: own(2), env: {} })).toBeNull();
    expect(await checkForUpdate({ current: "1.5.0", fetch: async () => new Response("{}", { status: 404 }), cacheFile: own(3), env: {} })).toBeNull();
    let called = false;
    expect(await checkForUpdate({ current: "1.5.0", fetch: async () => ((called = true), reply("9.0.0")()), cacheFile: own(4), env: { CAUSLY_UPDATE_CHECK: "off" } })).toBeNull();
    expect(called).toBe(false);
  });
});

describe("status", () => {
  const root = path.resolve(import.meta.dirname, "..");

  it("shows editors, keys, data and the backup state", async () => {
    const home = path.join(dir, "userhome");
    fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
    const where = { platform: "linux", home, env: {} };
    runInit({ ...where, root, client: "cursor", workspace: dir });
    makeDb(dbFile, ["call Acme"]);

    const r = await runStatus({ ...where, env: { GROQ_API_KEY: "gsk_abcdef123456" }, version: "1.5.0", dbFile, now: NOW, checkUpdate: false });
    const text = r.lines.join("\n");
    expect(text).toMatch(/Cursor \(\d+ tool packs at startup; files limited to /);
    expect(text).toMatch(/1 ready \(Groq/);
    expect(text).not.toContain("gsk_abcdef123456");
    expect(text).toMatch(/Reminders: 1 pending; next: "call Acme"/);
    expect(text).toMatch(/Backup:    none yet/);
    expect(text).toMatch(/Pipeline:  0 open deal\(s\)/); // tables of unused packs read as zero

    await runBackup({ dbFile, now: NOW });
    const after = await runStatus({ ...where, env: {}, version: "1.5.0", dbFile, now: NOW, checkUpdate: false });
    expect(after.lines.join("\n")).toMatch(/Backup:    last one today/);
  });

  it("explains an empty setup", async () => {
    const r = await runStatus({ platform: "linux", home: path.join(dir, "empty"), env: {}, version: "1.5.0", dbFile, now: NOW, checkUpdate: false });
    const text = r.lines.join("\n");
    expect(text).toMatch(/Editors:   none yet/);
    expect(text).toMatch(/Keys:      none yet/);
    expect(text).toMatch(/nothing saved yet/);
  });

  it("adds the update notice when one exists", async () => {
    const fetch = async () => new Response(JSON.stringify({ version: "9.0.0" }), { status: 200 });
    const r = await runStatus({ platform: "linux", home: path.join(dir, "empty"), env: {}, version: "1.5.0", dbFile, now: NOW, fetch });
    expect(r.lines.join("\n")).toMatch(/newer version is available: 1\.5\.0 -> 9\.0\.0/);
  });
});

describe("welcome", () => {
  it("shows example prompts and the useful commands", () => {
    const text = welcomeLines().join("\n");
    expect(text).toMatch(/Try asking your agent/);
    expect(text).toMatch(/causly-server status/);
  });
});
