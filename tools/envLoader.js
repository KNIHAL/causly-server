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
export function loadEnv() {
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
      }
    }
  }
}
