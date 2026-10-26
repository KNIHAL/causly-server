// `causly-server backup` and `restore`: your pipeline, meetings and reminders live in one SQLite file
// (~/.causly/causly.db). A backup is a consistent copy of it, safe to take while an editor is running.
// API keys are not in the backup; they are in the settings file (causly-server keys open).
import fs from "fs";
import path from "path";
import { dbPath } from "./store.js";
import { causlyHome } from "./paths.js";

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");

export const backupDir = () => path.join(causlyHome(), "backups");

async function openDb(file, options) {
  let sqlite;
  try {
    sqlite = await import("node:sqlite");
  } catch {
    throw new Error(`Backups need Node 22.13 or newer (this is ${process.version}).`);
  }
  return new sqlite.DatabaseSync(file, options ?? {});
}

export async function runBackup({ file, dbFile = dbPath(), now = new Date() } = {}) {
  if (!fs.existsSync(dbFile)) throw new Error("Nothing to back up yet: no pipeline, meeting or reminder data has been saved on this computer.");
  const target = path.resolve(file || path.join(backupDir(), `causly-${stamp(now)}.db`));
  if (fs.existsSync(target)) throw new Error(`${target} already exists. Choose another name; backups are never overwritten.`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = await openDb(dbFile);
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  return { file: target, bytes: fs.statSync(target).size };
}

async function checkBackupFile(file) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  let db;
  try {
    db = await openDb(file, { readOnly: true });
    const hasTable = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
    if (!hasTable) throw new Error("not a causly backup");
    const check = db.prepare("PRAGMA integrity_check").get();
    if (Object.values(check)[0] !== "ok") throw new Error("damaged");
  } catch (err) {
    throw new Error(err.message === "damaged" ? `${file} is damaged and cannot be restored.` : `${file} is not a causly-server backup.`);
  } finally {
    db?.close();
  }
}

export async function runRestore({ file, dbFile = dbPath(), now = new Date() } = {}) {
  if (!file) throw new Error("Give the backup file, for example: causly-server restore D:\\backups\\causly-20261026-0900.db");
  const source = path.resolve(file);
  await checkBackupFile(source);

  let safetyCopy = null;
  if (fs.existsSync(dbFile)) {
    safetyCopy = (await runBackup({ file: path.join(backupDir(), `before-restore-${stamp(now)}.db`), dbFile, now })).file;
  }
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const tmp = `${dbFile}.restoring`;
  fs.copyFileSync(source, tmp);
  try {
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${dbFile}${suffix}`, { force: true });
    fs.renameSync(tmp, dbFile);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Could not replace the data file (${err.code || err.message}). Quit Claude Desktop, Cursor and other apps that use causly-server, then run it again. Your current data is untouched.`);
  }
  return { restored: dbFile, safety_copy: safetyCopy };
}

/** Newest backup in the default folder, for `status`. */
export function latestBackup(dir = backupDir()) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".db") && !f.startsWith("before-restore"))
      .map((f) => ({ file: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0] ?? null;
  } catch {
    return null;
  }
}
