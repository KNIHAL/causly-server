// Where the server keeps things.
//
// Running from a git checkout, files stay in the repo folder (as always).
// Installed from npm, the package folder is a cache that gets replaced on upgrade,
// so settings, logs and the secrets store live in ~/.causly instead (or CAUSLY_HOME).
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

export const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const isInstalledPackage = (root = PACKAGE_ROOT) => root.split(/[\\/]/).includes("node_modules");

export const causlyHome = () => process.env.CAUSLY_HOME || path.join(os.homedir(), ".causly");

/** Folder for logs and the secrets store. */
export const dataDir = () => (isInstalledPackage() ? causlyHome() : PACKAGE_ROOT);

/** .env files, most specific first. Values already in the environment always win. */
export const envFiles = () =>
  [process.env.CAUSLY_ENV_FILE, path.join(causlyHome(), ".env"), path.join(PACKAGE_ROOT, ".env")].filter(Boolean);
