import fs from "fs";
import { envFiles } from "./paths.js";

/**
 * Minimal, dependency-free .env loader.
 * Written by hand instead of using the `dotenv` package because dotenv
 * prints a banner to stdout on load, which corrupts the MCP stdio
 * JSON-RPC stream (stdout must contain ONLY protocol messages).
 *
 * Files are read in order: CAUSLY_ENV_FILE, ~/.causly/.env, then the .env next to the
 * code (a git checkout). A variable that is already set is never overwritten, so the
 * client's own "env" block and earlier files win.
 */

let launchKeys = null; // variables the process started with: files never override these
let fromFiles = new Set(); // variables we set from files, so a reload can update or drop them
let seen = new Map(); // file -> "mtimeMs:size" at last load

function applyFiles() {
  for (const file of envFiles()) {
    if (!fs.existsSync(file)) continue;
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) continue;

      const key = line.slice(0, eqIndex).trim();
      let value = line.slice(eqIndex + 1).trim();

      // Strip surrounding quotes if present.
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key && !(key in process.env)) {
        process.env[key] = value;
        fromFiles.add(key);
      }
    }
  }
}

export function loadEnv() {
  if (launchKeys === null) launchKeys = new Set(Object.keys(process.env));
  applyFiles();
  snapshot();
}

function stamp(file) {
  try {
    const s = fs.statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "";
  }
}

function snapshot() {
  seen = new Map(envFiles().map((f) => [f, stamp(f)]));
}

/**
 * Pick up changes made to the settings files while the server is running (for example by
 * `causly-server setup`), so a new key works on the next tool call without a restart.
 * Variables the process started with keep winning. Cheap: a stat per file per call.
 */
export function reloadEnvIfChanged() {
  if (launchKeys === null) return false;
  const files = envFiles();
  const changed = files.length !== seen.size || files.some((f) => seen.get(f) !== stamp(f));
  if (!changed) return false;
  for (const key of fromFiles) if (!launchKeys.has(key)) delete process.env[key];
  fromFiles = new Set();
  applyFiles();
  snapshot();
  return true;
}
