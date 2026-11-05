import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ended = [];
vi.mock("pg", () => {
  class Pool {
    constructor(opts) {
      this.opts = opts;
    }
    async end() {
      ended.push(this.opts.connectionString);
    }
    async query() {
      return { rows: [], rowCount: 0, fields: [] };
    }
  }
  return { default: { Pool } };
});
vi.mock("mysql2/promise", () => ({
  default: {
    createPool: (cs) => ({
      end: async () => {
        ended.push(cs);
      },
      query: async () => [[], []],
    }),
  },
}));

const { readFile, readMultipleFiles } = await import("../tools/fileOps.js");
const { listDirectory, directoryTree, searchFiles } = await import("../tools/directoryOps.js");
const { postgresListTables, mysqlListTables, closeAllPools, _pools } = await import("../tools/dbOps.js");
const { limit } = await import("../tools/limits.js");

let dir;
const saved = { ...process.env };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-limits-"));
  ended.length = 0;
});
afterEach(async () => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  await closeAllPools();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("limit()", () => {
  it("uses the default, the variable, and ignores bad values", () => {
    expect(limit("CAUSLY_MAX_READ_BYTES", {})).toBe(2 * 1024 * 1024);
    expect(limit("CAUSLY_MAX_READ_BYTES", { CAUSLY_MAX_READ_BYTES: "100" })).toBe(100);
    expect(limit("CAUSLY_MAX_READ_BYTES", { CAUSLY_MAX_READ_BYTES: "-5" })).toBe(2 * 1024 * 1024);
    expect(limit("CAUSLY_MAX_READ_BYTES", { CAUSLY_MAX_READ_BYTES: "abc" })).toBe(2 * 1024 * 1024);
    expect(() => limit("NOPE")).toThrow();
  });
});

describe("read_file", () => {
  it("returns small files unchanged, with no truncation fields", async () => {
    const f = path.join(dir, "a.txt");
    fs.writeFileSync(f, "hello");
    expect(await readFile({ path: f })).toEqual({ path: f, content: "hello" });
  });

  it("caps a huge file and says so, without reading it all", async () => {
    const f = path.join(dir, "big.txt");
    fs.writeFileSync(f, "x".repeat(5 * 1024 * 1024));
    const r = await readFile({ path: f });
    expect(r.truncated).toBe(true);
    expect(r.content.length).toBe(2 * 1024 * 1024);
    expect(r.size_bytes).toBe(5 * 1024 * 1024);
    expect(r.bytes_returned).toBe(2 * 1024 * 1024);
  });

  it("does not leave half a character at the cut", async () => {
    process.env.CAUSLY_MAX_READ_BYTES = "4";
    const f = path.join(dir, "u.txt");
    fs.writeFileSync(f, "ab€Z"); // a b + 3-byte euro sign + Z
    const r = await readFile({ path: f });
    expect(r.truncated).toBe(true);
    expect(r.content).toBe("ab");
  });
});

describe("read_multiple_files", () => {
  it("stops at the batch budget and marks the rest skipped", async () => {
    process.env.CAUSLY_MAX_READ_BYTES = "1000";
    process.env.CAUSLY_MAX_BATCH_BYTES = "1500";
    const files = [0, 1, 2, 3].map((i) => {
      const f = path.join(dir, `f${i}.txt`);
      fs.writeFileSync(f, "y".repeat(1000));
      return f;
    });
    const r = await readMultipleFiles({ paths: files });
    expect(r.truncated).toBe(true);
    expect(r.results[0].content.length).toBe(1000);
    expect(r.results[1].truncated).toBe(true);
    expect(r.results[1].content.length).toBe(500);
    expect(r.results[2].skipped).toBe(true);
    expect(r.results[3].skipped).toBe(true);
    expect(r.results.every((x) => (x.content?.length ?? 0) <= 1000)).toBe(true);
  });

  it("has no marker when everything fits", async () => {
    const f = path.join(dir, "ok.txt");
    fs.writeFileSync(f, "ok");
    const r = await readMultipleFiles({ paths: [f] });
    expect(r).toEqual({ results: [{ path: f, content: "ok", success: true }] });
  });
});

describe("directory tools", () => {
  it("list_directory caps entries and marks truncated", async () => {
    process.env.CAUSLY_MAX_LIST_ENTRIES = "10";
    for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(dir, `f${i}`), "");
    const r = await listDirectory({ path: dir });
    expect(r.entries).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it("list_directory is plain when under the limit", async () => {
    fs.writeFileSync(path.join(dir, "a"), "");
    const r = await listDirectory({ path: dir });
    expect(r.truncated).toBeUndefined();
    expect(r.entries).toEqual([{ name: "a", type: "file" }]);
  });

  it("directory_tree stops after the total entry budget", async () => {
    process.env.CAUSLY_MAX_TREE_ENTRIES = "25";
    for (let d = 0; d < 10; d++) {
      fs.mkdirSync(path.join(dir, `d${d}`));
      for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(dir, `d${d}`, `f${i}`), "");
    }
    const tree = await directoryTree({ path: dir, max_depth: 5 });
    const count = (n) => 1 + (n.children ?? []).reduce((s, c) => s + count(c), 0);
    expect(count(tree) - 1).toBeLessThanOrEqual(25);
    const anyCut = (n) => n.truncated || (n.children ?? []).some(anyCut);
    expect(anyCut(tree)).toBe(true);
  });

  it("directory_tree clamps absurd depth", async () => {
    let p = dir;
    for (let i = 0; i < 30; i++) {
      p = path.join(p, "n");
      fs.mkdirSync(p);
    }
    const tree = await directoryTree({ path: dir, max_depth: 1_000_000 });
    let depth = 0;
    for (let n = tree; n.children?.length; n = n.children[0]) depth++;
    expect(depth).toBeLessThanOrEqual(20);
  });

  it("search_files stops at the scan budget", async () => {
    process.env.CAUSLY_MAX_SCAN_ENTRIES = "30";
    for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(dir, `file${i}`), "");
    const r = await searchFiles({ root_path: dir, pattern: "zzz" });
    expect(r.truncated).toBe(true);
    expect(r.scan_limit_reached).toBe(true);
  });

  it("search_files caps max_results at 1000", async () => {
    const r = await searchFiles({ root_path: dir, pattern: "x", max_results: 10_000_000 });
    expect(r.truncated).toBe(false);
  });

  it("a 2,500-file folder finishes quickly and within the default entry cap", async () => {
    for (let i = 0; i < 2500; i++) fs.writeFileSync(path.join(dir, `f${i}`), "");
    const t0 = Date.now();
    const r = await listDirectory({ path: dir });
    expect(r.entries).toHaveLength(2000);
    expect(r.truncated).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 60000);
});

describe("database pools", () => {
  it("never holds more than the limit and closes the least recently used", async () => {
    process.env.CAUSLY_MAX_DB_POOLS = "3";
    for (let i = 0; i < 6; i++) await postgresListTables({ connection_string: `postgres://u:p@h/db${i}` });
    expect(_pools.size()).toBe(3);
    await new Promise((r) => setTimeout(r, 10));
    expect(ended).toEqual(["postgres://u:p@h/db0", "postgres://u:p@h/db1", "postgres://u:p@h/db2"]);
  });

  it("reusing a pool keeps it from being evicted", async () => {
    process.env.CAUSLY_MAX_DB_POOLS = "2";
    await postgresListTables({ connection_string: "postgres://u:p@h/a" });
    await postgresListTables({ connection_string: "postgres://u:p@h/b" });
    await postgresListTables({ connection_string: "postgres://u:p@h/a" }); // a is now newest
    await postgresListTables({ connection_string: "postgres://u:p@h/c" }); // evicts b
    await new Promise((r) => setTimeout(r, 10));
    expect(ended).toEqual(["postgres://u:p@h/b"]);
  });

  it("the limit counts Postgres and MySQL pools together", async () => {
    process.env.CAUSLY_MAX_DB_POOLS = "2";
    await postgresListTables({ connection_string: "postgres://u:p@h/a" });
    await mysqlListTables({ connection_string: "mysql://u:p@h/b" });
    await mysqlListTables({ connection_string: "mysql://u:p@h/c" });
    expect(_pools.size()).toBe(2);
  });

  it("closes pools that sat idle", async () => {
    process.env.CAUSLY_DB_POOL_IDLE_MS = "1000";
    await postgresListTables({ connection_string: "postgres://u:p@h/idle" });
    _pools.sweepIdle(Date.now() + 5000);
    expect(_pools.size()).toBe(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(ended).toEqual(["postgres://u:p@h/idle"]);
  });
});
