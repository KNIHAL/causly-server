// Local SQLite store shared by packs that need to remember things between
// sessions (reminders, pipeline, follow-ups, ...).
//
// - Uses Node's built-in `node:sqlite` (no native dependency). Needs Node 22.13+;
//   the rest of the server keeps working on older Node, only store-backed
//   tools report a clear error.
// - Opened lazily on first use, so users who never touch these tools never get a file.
// - Location: ~/.causly/causly.db, or CAUSLY_DB_PATH.
// - Each pack owns its tables through registerMigrations(namespace, [sql, ...]).
//   Migrations are append-only: never edit a shipped statement, add a new one.
import fs from "fs";
import os from "os";
import path from "path";
import { causlyHome } from "./paths.js";

const migrations = new Map(); // namespace -> SQL statements, in order
const applied = new Map(); // namespace -> highest applied version, for the open db
let db = null;
let openPath = null;
let opening = null; // { file, promise }

export function registerMigrations(namespace, statements) {
  migrations.set(namespace, statements);
}

export function dbPath() {
  return process.env.CAUSLY_DB_PATH || path.join(causlyHome(), "causly.db");
}

async function openDatabase(file) {
  let sqlite;
  try {
    sqlite = await import("node:sqlite");
  } catch {
    throw new Error(`The local store needs Node 22.13 or newer (this is ${process.version}).`);
  }
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = new sqlite.DatabaseSync(file);
  handle.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;"); // wait for another process's write instead of failing
  handle.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "namespace TEXT NOT NULL, version INTEGER NOT NULL, applied_at TEXT NOT NULL, " +
      "PRIMARY KEY (namespace, version))"
  );
  return handle;
}

function migrate(handle) {
  for (const [namespace, statements] of migrations) {
    let current = applied.get(namespace);
    if (current === undefined) {
      current = handle
        .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations WHERE namespace = ?")
        .get(namespace).v;
    }
    for (let v = current; v < statements.length; v++) {
      handle.exec("BEGIN");
      try {
        handle.exec(statements[v]);
        handle
          .prepare("INSERT INTO schema_migrations (namespace, version, applied_at) VALUES (?, ?, ?)")
          .run(namespace, v + 1, new Date().toISOString());
        handle.exec("COMMIT");
      } catch (err) {
        handle.exec("ROLLBACK");
        throw err;
      }
      current = v + 1;
    }
    applied.set(namespace, current);
  }
}

/** The open database, with every registered migration applied. */
export async function getDb() {
  const file = dbPath();
  if (!db || openPath !== file) {
    if (!opening || opening.file !== file) {
      closeDb();
      const promise = openDatabase(file).then(
        (handle) => {
          db = handle;
          openPath = file;
          applied.clear();
          opening = null;
        },
        (err) => {
          opening = null;
          throw err;
        }
      );
      opening = { file, promise };
    }
    await opening.promise;
  }
  migrate(db);
  return db;
}

export function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  db = null;
  openPath = null;
  applied.clear();
}
