// Owner-only files and crash-safe writes for everything Causly keeps on disk: the activity log, the
// local database, the secrets store, backups and editor-config backups can all hold sensitive data.
//
// macOS and Linux: folders 0700, files 0600. Windows has no useful chmod; the profile folder's ACL
// keeps other users out, and `homePrivacy()` checks the data folder really is inside the profile.
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { causlyHome, dataDir } from "./paths.js";

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

const posix = () => process.platform !== "win32";

/** chmod that never throws and does nothing on Windows. Returns true when the mode was applied. */
export function chmodQuiet(target, mode) {
  if (!posix()) return false;
  try {
    fs.chmodSync(target, mode);
    return true;
  } catch {
    return false;
  }
}

/** Create a Causly-owned folder as 0700 (mkdir's mode is masked by umask and ignored when it exists). */
export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  chmodQuiet(dir, DIR_MODE);
}

const STALE_TEMP_MS = 60 * 60 * 1000;

function removeStaleTemps(dir, base) {
  try {
    const cutoff = Date.now() - STALE_TEMP_MS;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(`.${base}.`) || !name.endsWith(".tmp")) continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
    }
  } catch {
    // best effort: a leftover temp file is harmless
  }
}

/**
 * Write a file so a crash can never leave half of it: the data goes to a temporary file in the same
 * folder (created with the final mode, so it is never readable by others), is flushed to disk, then
 * renamed over the target. A symlinked target is written through, not replaced.
 *
 * options.mode          mode for a new file (default 0600)
 * options.preserveMode  keep the mode of an existing file (editor configs)
 * options.mkdir         create the parent folder (0700) when missing
 */
export function writeFileAtomic(file, data, { mode = FILE_MODE, preserveMode = false, mkdir = false } = {}) {
  let target = path.resolve(file);
  let existingMode = null;
  try {
    target = fs.realpathSync(target);
    existingMode = fs.statSync(target).mode & 0o777;
  } catch {
    // new file
  }
  const dir = path.dirname(target);
  if (mkdir) fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const base = path.basename(target);
  removeStaleTemps(dir, base);

  const finalMode = preserveMode && existingMode !== null ? existingMode : mode;
  const tmp = path.join(dir, `.${base}.${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", finalMode);
    fs.writeFileSync(fd, data);
    try {
      fs.fsyncSync(fd);
    } catch {
      // not every file system can flush
    }
    fs.closeSync(fd);
    fd = undefined;
    chmodQuiet(tmp, finalMode);
    fs.renameSync(tmp, target);
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      }
    }
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // nothing more to do
    }
    throw err;
  }
  return target;
}

/**
 * Tighten permissions on what Causly already keeps (older versions created these with the default
 * mode). Only known files and folders are touched, and symlinks are skipped. Returns what changed.
 */
export function hardenDataFolder({ home = causlyHome(), data = dataDir(), env = process.env } = {}) {
  const changed = [];
  if (!posix()) return { changed };

  const fix = (p, mode) => {
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) return;
      if ((st.mode & 0o777) !== mode) {
        fs.chmodSync(p, mode);
        changed.push(p);
      }
    } catch {
      // missing or not ours to change
    }
  };

  const defaultHome = path.resolve(path.join(os.homedir(), ".causly"));
  if (path.resolve(home) === defaultHome) fix(home, DIR_MODE);

  const dbFiles = (db) => [db, `${db}-wal`, `${db}-shm`];
  const files = [];
  for (const base of new Set([home, data])) {
    files.push(path.join(base, ".env"), ...dbFiles(path.join(base, "causly.db")), path.join(base, ".causly-secrets.enc"));
    for (const sub of ["logs", "backups"]) {
      const dir = path.join(base, sub);
      fix(dir, DIR_MODE);
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile()) files.push(path.join(dir, entry.name));
        }
      } catch {
        // folder does not exist yet
      }
    }
  }
  if (env.CAUSLY_DB_PATH) files.push(...dbFiles(env.CAUSLY_DB_PATH));
  if (env.CAUSLY_ENV_FILE) files.push(env.CAUSLY_ENV_FILE);
  for (const f of files) fix(f, FILE_MODE);
  return { changed };
}

/** Is Causly's data folder private to this user? For `doctor`: { ok, detail }. */
export function homePrivacy({ home = causlyHome() } = {}) {
  const resolved = path.resolve(home);
  if (!posix()) {
    const profile = path.resolve(os.homedir());
    const inside = resolved.toLowerCase().startsWith(profile.toLowerCase() + path.sep);
    return inside
      ? { ok: true, detail: `${resolved} (inside your Windows profile, which other users cannot open)` }
      : { ok: false, detail: `${resolved} is outside your Windows profile, so its access comes from the parent folder. Make sure only you can open it, or use the default folder` };
  }
  try {
    const mode = fs.statSync(resolved).mode & 0o777;
    if ((mode & 0o077) === 0) return { ok: true, detail: `${resolved} (mode ${mode.toString(8)})` };
    return { ok: false, detail: `${resolved} is mode ${mode.toString(8)}, so other users can open it. Run: chmod 700 "${resolved}"` };
  } catch {
    return { ok: true, detail: `${resolved} (not created yet)` };
  }
}
