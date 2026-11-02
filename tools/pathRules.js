// Protected-path rules (pure string logic, no filesystem access).
//
//  - System directories (C:\Windows, /etc, /usr, /System ...): writing is refused, reading is fine.
//  - Credential locations (~/.ssh, ~/.aws, ~/.config/gcloud, OS keychain folders): reading AND
//    writing are refused, so a prompt-injected agent cannot read or replace keys.
//  - Windows name tricks (device names such as CON or NUL, NTFS alternate data streams, device
//    paths like \\.\PhysicalDrive0): refused for reading and writing.
//
// Paths are compared on path boundaries ("C:\Windows.old" is not inside "C:\Windows"), after
// normalising "..", slashes, "\\?\" prefixes, admin shares of this machine and the trailing dots
// and spaces that Windows ignores. pathGuard.js adds real-path resolution (symlinks, 8.3 names).
import os from "os";
import path from "path";
import { PACKAGE_ROOT } from "./paths.js";

const WIN_SYSTEM_DIRS = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
  "C:\\Users\\Default",
  "C:\\Users\\Public",
  "C:\\System Volume Information",
  "C:\\Recovery",
  "C:\\Boot",
];
const WIN_SYSTEM_ENV = ["SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData"];

const POSIX_SYSTEM_DIRS = [
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/lib",
  "/lib32",
  "/lib64",
  "/boot",
  "/dev",
  "/proc",
  "/sys",
  "/System",
  "/Library",
  "/private/etc",
  "/private/var/db",
];

// Credential folders below a home directory, with "/" separators.
const HOME_SECRET_DIRS = [".ssh", ".aws", ".config/gcloud", ".kube", ".gnupg", ".azure", ".causly", "Library/Keychains", ".local/share/keyrings"];
const POSIX_SECRET_ABSOLUTE = ["/Library/Keychains", "/System/Library/Keychains"];
const WIN_HOME_SECRET_DIRS = [
  ".ssh",
  ".aws",
  ".config\\gcloud",
  ".kube",
  ".gnupg",
  ".azure",
  ".causly",
  "AppData\\Roaming\\gnupg",
  "AppData\\Roaming\\gcloud",
  "AppData\\Roaming\\Microsoft\\Credentials",
  "AppData\\Local\\Microsoft\\Credentials",
  "AppData\\Roaming\\Microsoft\\Protect",
  "AppData\\Roaming\\Microsoft\\Vault",
  "AppData\\Local\\Microsoft\\Vault",
];

// Any user's home, not just the current one.
const POSIX_ANY_HOME_SECRET = ciRegExp(
  `^/(?:home|users)/[^/]+/(?:${HOME_SECRET_DIRS.map(escapeRe).join("|")})(?:/|$)|^/(?:root|var/root)/(?:${HOME_SECRET_DIRS.map(escapeRe).join("|")})(?:/|$)`
);
const WIN_ANY_HOME_SECRET = ciRegExp(
  `^[a-z]:\\\\users\\\\[^\\\\]+\\\\(?:${WIN_HOME_SECRET_DIRS.map((d) => escapeRe(d.toLowerCase())).join("|")})(?:\\\\|$)`
);

const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)$/i;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

// Path-boundary comparison: /etc contains /etc/x but not /etcetera.
const underWin = (n, prefix) => n === prefix || n.startsWith(`${prefix}\\`);
const underPosix = (n, prefix) => n === prefix || n.startsWith(`${prefix}/`);

function ciRegExp(source) {
  return new RegExp(source, "i");
}

// Causly's own data: ~/.causly or CAUSLY_HOME (API keys, secrets store, database), a custom
// CAUSLY_ENV_FILE and the .env next to the code (a git checkout).
function causlyOwnPaths(env) {
  return [env.CAUSLY_HOME, env.CAUSLY_ENV_FILE, path.join(PACKAGE_ROOT, ".env")].filter(Boolean);
}

function isLocalHost(name) {
  const host = name.toLowerCase().replace(/^\[|\]$/g, "");
  const names = ["localhost", "127.0.0.1", "::1"];
  try {
    names.push(os.hostname().toLowerCase());
  } catch {
    // no hostname available
  }
  if (process.env.COMPUTERNAME) names.push(process.env.COMPUTERNAME.toLowerCase());
  return names.includes(host);
}

function detectStyle(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\") ? "win32" : "posix";
}

/** Canonical Windows form of a path, or { problem } when the path itself is not allowed. */
function canonicalWin32(raw) {
  let s = raw.replace(/\//g, "\\");

  const prefixed = s.match(/^\\\\[?.]\\(.*)$/);
  if (prefixed) {
    const rest = prefixed[1];
    if (/^[a-z]:(?:\\|$)/i.test(rest)) s = rest;
    else if (/^unc\\/i.test(rest)) s = `\\\\${rest.slice(4)}`;
    else return { problem: "device" };
  }

  // Administrative share of this machine: \\localhost\C$\x is C:\x.
  const share = s.match(/^\\\\([^\\]+)\\([a-z])\$(?:\\(.*))?$/i);
  if (share && isLocalHost(share[1])) s = `${share[2]}:\\${share[3] || ""}`;

  const drive = /^[a-z]:/i.test(s) ? s.slice(0, 2) : "";
  if (s.slice(drive.length).includes(":")) return { problem: "stream" };

  const strip = (value) =>
    value
      .split("\\")
      .map((c) => (c === "" || /^\.+$/.test(c) ? c : c.replace(/[. ]+$/, "")))
      .join("\\");
  const n = path.win32.normalize(strip(path.win32.normalize(s)));

  const names = n.slice(drive.length).split("\\");
  if (names.some((c) => c && RESERVED_NAME.test(c.split(".")[0].trim()))) return { problem: "reserved" };
  return { path: n };
}

function windowsHomes(home, env) {
  const homes = [];
  if (home) homes.push(path.win32.normalize(home).toLowerCase());
  if (env.USERPROFILE) homes.push(path.win32.normalize(env.USERPROFILE).toLowerCase());
  return homes;
}

function checkWin32(raw, access, { home, env }) {
  const canon = canonicalWin32(raw);
  if (canon.problem === "device") {
    return { denied: true, reason: `'${raw}' is a Windows device path, which is not allowed through this tool.` };
  }
  if (canon.problem === "stream") {
    return { denied: true, reason: `'${raw}' uses an NTFS alternate data stream, which is not allowed through this tool.` };
  }
  if (canon.problem === "reserved") {
    return {
      denied: true,
      reason: `'${raw}' contains a reserved Windows device name (CON, NUL, COM1 ...), which is not allowed through this tool.`,
    };
  }
  const n = canon.path.toLowerCase();

  const secretDirs = [];
  for (const h of windowsHomes(home, env)) {
    for (const d of WIN_HOME_SECRET_DIRS) secretDirs.push(`${h}\\${d.toLowerCase()}`);
  }
  if (env.APPDATA) secretDirs.push(`${env.APPDATA.toLowerCase()}\\gcloud`, `${env.APPDATA.toLowerCase()}\\microsoft\\credentials`, `${env.APPDATA.toLowerCase()}\\microsoft\\protect`, `${env.APPDATA.toLowerCase()}\\microsoft\\vault`);
  if (env.LOCALAPPDATA) secretDirs.push(`${env.LOCALAPPDATA.toLowerCase()}\\microsoft\\credentials`, `${env.LOCALAPPDATA.toLowerCase()}\\microsoft\\vault`);
  for (const p of causlyOwnPaths(env)) secretDirs.push(path.win32.normalize(p).toLowerCase());
  const secret = secretDirs.find((d) => underWin(n, path.win32.normalize(d))) || (WIN_ANY_HOME_SECRET.test(n) ? "a user credentials folder" : null);
  if (secret) {
    return { denied: true, reason: `'${raw}' is inside a protected credentials location (${secret}) and cannot be accessed through this tool.` };
  }

  if (access === "write") {
    const dirs = [...WIN_SYSTEM_DIRS];
    for (const key of WIN_SYSTEM_ENV) if (env[key]) dirs.push(path.win32.normalize(env[key]));
    const hit = dirs.find((d) => underWin(n, d.toLowerCase()));
    if (hit) {
      return { denied: true, reason: `'${raw}' is inside a protected system directory (${hit}) and cannot be modified through this tool.` };
    }
  }
  return { denied: false };
}

function checkPosix(raw, access, { home, env }) {
  if (!raw.startsWith("/")) return { denied: false }; // relative: pathGuard resolves it first
  const n = path.posix.normalize(raw).toLowerCase();

  const secretDirs = POSIX_SECRET_ABSOLUTE.map((d) => d.toLowerCase());
  if (home) {
    const h = path.posix.normalize(home.replace(/\\/g, "/")).toLowerCase().replace(/\/$/, "");
    for (const d of HOME_SECRET_DIRS) secretDirs.push(`${h}/${d.toLowerCase()}`);
  }
  for (const p of causlyOwnPaths(env)) secretDirs.push(path.posix.normalize(p.replace(/\\/g, "/")).toLowerCase());
  const secret = secretDirs.find((d) => underPosix(n, d)) || (POSIX_ANY_HOME_SECRET.test(n) ? "a user credentials folder" : null);
  if (secret) {
    return { denied: true, reason: `'${raw}' is inside a protected credentials location (${secret}) and cannot be accessed through this tool.` };
  }

  if (access === "write") {
    const hit = POSIX_SYSTEM_DIRS.find((d) => underPosix(n, d.toLowerCase()));
    if (hit) {
      return { denied: true, reason: `'${raw}' is inside a protected system directory (${hit}) and cannot be modified through this tool.` };
    }
  }
  return { denied: false };
}

/**
 * Is this path protected? Returns { denied, reason }.
 * Options: access "write" (default) or "read"; style "auto" | "win32" | "posix";
 * home and env can be injected for tests.
 */
export function isPathDenied(targetPath, { access = "write", style = "auto", home, env = process.env } = {}) {
  if (!targetPath || typeof targetPath !== "string") return { denied: false };
  let homeDir = home;
  if (homeDir === undefined) {
    try {
      homeDir = os.homedir();
    } catch {
      homeDir = "";
    }
  }
  const resolvedStyle = style === "auto" ? detectStyle(targetPath) : style;
  const context = { home: homeDir, env };
  return resolvedStyle === "win32" ? checkWin32(targetPath, access, context) : checkPosix(targetPath, access, context);
}
