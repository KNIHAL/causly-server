// Where the server keeps things.
//
// Running from a git checkout, files stay in the repo folder (as always).
// Installed from npm, the package folder is a cache that gets replaced on upgrade,
// so settings, logs and the secrets store live in ~/.causly instead (or CAUSLY_HOME).
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

export const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const isInstalledPackage = (root = PACKAGE_ROOT) => root.split(/[\\/]/).includes("node_modules");

export const causlyHome = () => process.env.CAUSLY_HOME || path.join(os.homedir(), ".causly");

/** Folder for logs and the secrets store. */
export const dataDir = () => (isInstalledPackage() ? causlyHome() : PACKAGE_ROOT);

/**
 * The file `keys` and `setup` write to: CAUSLY_ENV_FILE if set, a git checkout's own .env if it has one,
 * otherwise ~/.causly/.env.
 */
export const envWritePath = (root = PACKAGE_ROOT) => {
  if (process.env.CAUSLY_ENV_FILE) return process.env.CAUSLY_ENV_FILE;
  const checkout = path.join(root, ".env");
  if (!isInstalledPackage(root) && fs.existsSync(checkout)) return checkout;
  return path.join(causlyHome(), ".env");
};

/**
 * .env files, most specific first: ~/.causly/.env, then the .env next to the code (a git checkout).
 * CAUSLY_ENV_FILE, when set, is used on its own. Values already in the environment always win.
 */
export const envFiles = () =>
  process.env.CAUSLY_ENV_FILE ? [process.env.CAUSLY_ENV_FILE] : [path.join(causlyHome(), ".env"), path.join(PACKAGE_ROOT, ".env")];
