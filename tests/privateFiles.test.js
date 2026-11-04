import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { writeFileAtomic, ensurePrivateDir, hardenDataFolder, homePrivacy } from "../tools/privateFiles.js";
import { secretsSet, secretsGet, secretsList } from "../tools/secretsOps.js";
import { runBackup, runRestore } from "../tools/backupOps.js";
import { upsertServerEntry, removeServerEntry } from "../tools/cliOps.js";
import { getDb, closeDb } from "../tools/store.js";

const sqlite = await import("node:sqlite").catch(() => null); // needs Node 22.13+
const posix = process.platform !== "win32";
const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);

let dir;
const saved = { SECRETS_MASTER_KEY: process.env.SECRETS_MASTER_KEY, CAUSLY_DB_PATH: process.env.CAUSLY_DB_PATH, CAUSLY_HOME: process.env.CAUSLY_HOME };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-private-"));
  process.env.SECRETS_MASTER_KEY = crypto.randomBytes(32).toString("hex");
});

afterEach(() => {
  closeDb();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("replaces the content and leaves no temporary file", () => {
    const f = path.join(dir, "a.txt");
    writeFileAtomic(f, "one");
    writeFileAtomic(f, "two");
    expect(fs.readFileSync(f, "utf8")).toBe("two");
    expect(fs.readdirSync(dir)).toEqual(["a.txt"]);
  });

  it("creates the parent folder only when asked", () => {
    const f = path.join(dir, "new", "a.txt");
    expect(() => writeFileAtomic(f, "x")).toThrow();
    writeFileAtomic(f, "x", { mkdir: true });
    expect(fs.readFileSync(f, "utf8")).toBe("x");
  });

  it("removes its temporary file and keeps the old content when the write fails", () => {
    const f = path.join(dir, "a.txt");
    writeFileAtomic(f, "old");
    // a folder in the way makes the rename fail on every platform
    const blocked = path.join(dir, "blocked");
    fs.mkdirSync(blocked);
    expect(() => writeFileAtomic(blocked, "x")).toThrow();
    expect(fs.readFileSync(f, "utf8")).toBe("old");
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it.skipIf(!posix)("is owner-only by default and can keep an existing mode", () => {
    const f = path.join(dir, "a.txt");
    writeFileAtomic(f, "x");
    expect(mode(f)).toBe("600");
    fs.chmodSync(f, 0o644);
    writeFileAtomic(f, "y", { preserveMode: true });
    expect(mode(f)).toBe("644");
  });

  it.skipIf(!posix)("writes through a symlink instead of replacing it", () => {
    const real = path.join(dir, "real.json");
    const link = path.join(dir, "link.json");
    fs.writeFileSync(real, "old");
    fs.symlinkSync(real, link);
    writeFileAtomic(link, "new", { preserveMode: true });
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(real, "utf8")).toBe("new");
  });

  it.skipIf(!posix)("ensurePrivateDir makes a new or existing folder 0700", () => {
    const d = path.join(dir, "d");
    ensurePrivateDir(d);
    expect(mode(d)).toBe("700");
    fs.chmodSync(d, 0o755);
    ensurePrivateDir(d);
    expect(mode(d)).toBe("700");
  });
});

describe("secrets store", () => {
  it.skipIf(!posix)("is created owner-only and stays that way after a rotation of values", async () => {
    const store = path.join(dir, "s.enc");
    await secretsSet({ name: "A", value: "1", store_path: store, confirm: true });
    expect(mode(store)).toBe("600");
    await secretsSet({ name: "B", value: "2", store_path: store, confirm: true });
    expect(mode(store)).toBe("600");
  });

  it("survives a crash in the middle of a write: the old file is intact", async () => {
    const store = path.join(dir, "s.enc");
    await secretsSet({ name: "OLD", value: "old-value", store_path: store, confirm: true });
    const before = fs.readFileSync(store);

    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "helpers", "crashDuringWrite.mjs");
    const child = spawnSync(process.execPath, [script, store], { env: { ...process.env }, encoding: "utf8" });
    expect(child.status).toBe(137); // it did die, after writing the temporary file

    expect(fs.readFileSync(store).equals(before)).toBe(true);
    expect((await secretsGet({ name: "OLD", store_path: store })).value).toBe("old-value");
    expect((await secretsList({ store_path: store })).secrets.map((s) => s.name)).toEqual(["OLD"]);

    // the next write works and the store still opens
    await secretsSet({ name: "AFTER", value: "x", store_path: store, confirm: true });
    expect((await secretsList({ store_path: store })).secrets).toHaveLength(2);
  });
});

describe.skipIf(!sqlite)("database and backups", () => {
  it.skipIf(!posix)("the database file and its folder are owner-only", async () => {
    process.env.CAUSLY_DB_PATH = path.join(dir, "data", "test.db");
    await getDb();
    expect(mode(process.env.CAUSLY_DB_PATH)).toBe("600");
    expect(mode(path.dirname(process.env.CAUSLY_DB_PATH))).toBe("700");
    for (const suffix of ["-wal", "-shm"]) {
      const f = process.env.CAUSLY_DB_PATH + suffix;
      if (fs.existsSync(f)) expect(mode(f)).toBe("600");
    }
  });

  function makeDb(file) {
    const db = new sqlite.DatabaseSync(file);
    db.exec("CREATE TABLE schema_migrations (namespace TEXT, version INTEGER)");
    db.exec("CREATE TABLE t (v TEXT)");
    db.exec("INSERT INTO t (v) VALUES ('kept')");
    db.close();
  }

  it.skipIf(!posix)("a backup is owner-only, appears only when complete, and leaves no partial file", async () => {
    const dbFile = path.join(dir, "causly.db");
    makeDb(dbFile);
    const target = path.join(dir, "out", "b.db");
    const { file } = await runBackup({ file: target, dbFile });
    expect(file).toBe(target);
    expect(mode(target)).toBe("600");
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual(["b.db"]);
    await expect(runBackup({ file: target, dbFile })).rejects.toThrow(/already exists/);
    expect(fs.readdirSync(path.join(dir, "out"))).toEqual(["b.db"]); // the refusal left nothing behind
  });

  it.skipIf(!posix)("the default backup folder is 0700 and a restore gives owner-only files", async () => {
    process.env.CAUSLY_HOME = path.join(dir, "home");
    const dbFile = path.join(dir, "causly.db");
    makeDb(dbFile);
    const { file } = await runBackup({ dbFile });
    expect(mode(path.dirname(file))).toBe("700");
    fs.chmodSync(file, 0o644);
    await runRestore({ file, dbFile });
    expect(mode(dbFile)).toBe("600");
  });
});

describe("editor config files", () => {
  it.skipIf(!posix)("backups are owner-only, and the config keeps its own mode", () => {
    const f = path.join(dir, "mcp.json");
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { other: { env: { TOKEN: "secret" } } } }));
    fs.chmodSync(f, 0o644);
    const res = upsertServerEntry(f, { command: "node" });
    expect(mode(res.backup)).toBe("600");
    expect(mode(f)).toBe("644");
    const config = JSON.parse(fs.readFileSync(f, "utf8"));
    expect(config.mcpServers.other.env.TOKEN).toBe("secret");
    const removed = removeServerEntry(f);
    expect(mode(removed.backup)).toBe("600");
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it.skipIf(!posix)("a symlinked config file stays a symlink", () => {
    const real = path.join(dir, "dotfiles-mcp.json");
    const link = path.join(dir, "mcp.json");
    fs.writeFileSync(real, "{}");
    fs.symlinkSync(real, link);
    upsertServerEntry(link, { command: "node" });
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(real, "utf8")).mcpServers["causly-server"]).toBeTruthy();
  });
});

describe.skipIf(!posix)("hardenDataFolder", () => {
  it("tightens known files and folders from older installs and leaves everything else alone", () => {
    const home = path.join(dir, "home");
    fs.mkdirSync(path.join(home, "logs"), { recursive: true });
    fs.mkdirSync(path.join(home, "backups"));
    const loose = [".env", "causly.db", "causly.db-wal", ".causly-secrets.enc", "logs/activity.log", "backups/causly-1.db"].map((n) => path.join(home, n));
    for (const f of loose) {
      fs.writeFileSync(f, "x");
      fs.chmodSync(f, 0o644);
    }
    fs.chmodSync(path.join(home, "logs"), 0o755);
    const unrelated = path.join(home, "notes.txt");
    fs.writeFileSync(unrelated, "x");
    fs.chmodSync(unrelated, 0o644);
    const outside = path.join(dir, "outside.txt");
    fs.writeFileSync(outside, "x");
    fs.chmodSync(outside, 0o644);
    fs.symlinkSync(outside, path.join(home, "backups", "link.db"));

    const { changed } = hardenDataFolder({ home, data: home, env: {} });

    for (const f of loose) expect(mode(f)).toBe("600");
    expect(mode(path.join(home, "logs"))).toBe("700");
    expect(mode(path.join(home, "backups"))).toBe("700");
    expect(mode(unrelated)).toBe("644");
    expect(mode(outside)).toBe("644"); // a symlink is never followed
    expect(changed.length).toBeGreaterThanOrEqual(loose.length);
    expect(hardenDataFolder({ home, data: home, env: {} }).changed).toEqual([]); // nothing left to fix
  });

  it("does not change the mode of a custom CAUSLY_HOME folder that already exists", () => {
    const home = path.join(dir, "shared");
    fs.mkdirSync(home);
    fs.chmodSync(home, 0o755);
    hardenDataFolder({ home, data: home, env: {} });
    expect(mode(home)).toBe("755");
  });
});

describe("homePrivacy", () => {
  it.skipIf(!posix)("reports a folder other users can open", () => {
    const d = path.join(dir, "h");
    fs.mkdirSync(d, { mode: 0o700 });
    fs.chmodSync(d, 0o700);
    expect(homePrivacy({ home: d }).ok).toBe(true);
    fs.chmodSync(d, 0o755);
    const res = homePrivacy({ home: d });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/chmod 700/);
  });

  it.skipIf(!posix)("does not complain about a folder that does not exist yet", () => {
    expect(homePrivacy({ home: path.join(dir, "nope") }).ok).toBe(true);
  });

  it.skipIf(posix)("on Windows, accepts the profile folder and flags one outside it", () => {
    expect(homePrivacy({ home: path.join(os.homedir(), ".causly") }).ok).toBe(true);
    const outside = path.parse(os.homedir()).root + "causly-data";
    expect(homePrivacy({ home: outside }).ok).toBe(false);
  });
});
