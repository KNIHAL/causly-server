import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, closeDb, registerMigrations } from "../tools/store.js";
import { schedule, runJob, unschedule, stopScheduler, listJobs } from "../tools/scheduler.js";

// node:sqlite needs Node 22.13+; CI also runs older Node.
const hasSqlite = await import("node:sqlite").then(
  () => true,
  () => false
);

describe.skipIf(!hasSqlite)("local store", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-store-"));
    process.env.CAUSLY_DB_PATH = path.join(dir, "nested", "test.db");
  });

  afterEach(() => {
    closeDb();
    delete process.env.CAUSLY_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates the database file and its folder on first use", async () => {
    expect(fs.existsSync(process.env.CAUSLY_DB_PATH)).toBe(false);
    await getDb();
    expect(fs.existsSync(process.env.CAUSLY_DB_PATH)).toBe(true);
  });

  it("applies migrations once and picks up newly added ones", async () => {
    registerMigrations("store_t1", ["CREATE TABLE store_t1 (id INTEGER)"]);
    let db = await getDb();
    expect(db.prepare("PRAGMA table_info(store_t1)").all().map((c) => c.name)).toEqual(["id"]);

    registerMigrations("store_t1", ["CREATE TABLE store_t1 (id INTEGER)", "ALTER TABLE store_t1 ADD COLUMN name TEXT"]);
    db = await getDb();
    expect(db.prepare("PRAGMA table_info(store_t1)").all().map((c) => c.name)).toEqual(["id", "name"]);
    const versions = db.prepare("SELECT version FROM schema_migrations WHERE namespace = ? ORDER BY version").all("store_t1");
    expect(versions.map((r) => r.version)).toEqual([1, 2]);
  });

  it("keeps data across reopen without re-running migrations", async () => {
    registerMigrations("store_t2", ["CREATE TABLE store_t2 (v TEXT)"]);
    let db = await getDb();
    db.prepare("INSERT INTO store_t2 (v) VALUES (?)").run("kept");
    closeDb();
    db = await getDb(); // would throw "table already exists" if migrations re-ran
    expect(db.prepare("SELECT v FROM store_t2").all().map((r) => r.v)).toEqual(["kept"]);
  });

  it("rolls back a failed migration and keeps earlier ones", async () => {
    registerMigrations("store_t3", ["CREATE TABLE store_t3 (id INTEGER)", "THIS IS NOT SQL"]);
    await expect(getDb()).rejects.toThrow();
    // Fix the registration so other tests are unaffected, then check what was recorded.
    registerMigrations("store_t3", ["CREATE TABLE store_t3 (id INTEGER)"]);
    const db = await getDb();
    const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations WHERE namespace = ?").get("store_t3");
    expect(row.v).toBe(1);
  });

  it("opens the database once for concurrent callers", async () => {
    const [a, b] = await Promise.all([getDb(), getDb()]);
    expect(a).toBe(b);
  });
});

describe("scheduler", () => {
  afterEach(() => {
    stopScheduler();
    vi.restoreAllMocks();
  });

  it("runs a job on demand", async () => {
    const fn = vi.fn();
    schedule("sched-run", 60_000, fn);
    await runJob("sched-run");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("logs a failing job instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    schedule("sched-fail", 60_000, () => {
      throw new Error("boom");
    });
    await expect(runJob("sched-fail")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  it("does not start a job that is still running", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const fn = vi.fn(() => gate);
    schedule("sched-overlap", 60_000, fn);
    const first = runJob("sched-overlap");
    await runJob("sched-overlap"); // skipped
    release();
    await first;
    expect(fn).toHaveBeenCalledOnce();
  });

  it("unschedule and stopScheduler remove jobs", () => {
    schedule("sched-a", 60_000, () => {});
    schedule("sched-b", 60_000, () => {});
    unschedule("sched-a");
    expect(listJobs()).toEqual(["sched-b"]);
    stopScheduler();
    expect(listJobs()).toEqual([]);
  });
});
