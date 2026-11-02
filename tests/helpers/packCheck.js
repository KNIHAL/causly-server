// Checks the list of files npm would publish (P0-07). Used by tests/packageContents.test.js.
const ALWAYS_INCLUDED = [/^package\.json$/, /^(readme|license|licence)(\..*)?$/i];

// Things that must never be published, wherever they are, even inside an allowed folder.
const FORBIDDEN = [
  { re: /(^|\/)\.env(\..+)?$/, except: /(^|\/)\.env\.example$/, why: "environment file" },
  { re: /\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/i, why: "database" },
  { re: /\.log$/i, why: "log file" },
  { re: /(^|\/)logs\//, why: "logs folder" },
  { re: /\.(pem|key|p12|pfx|jks|keystore)$/i, why: "private key or keystore" },
  { re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, why: "ssh key" },
  { re: /\.enc$/i, why: "encrypted secrets store" },
  { re: /(^|\/)\.npmrc$/, why: "npm credentials" },
  { re: /(^|\/)credentials(\.json)?$/i, why: "credentials file" },
  { re: /(^|\/)\.git(\/|$)/, why: "git data" },
  { re: /(^|\/)node_modules\//, why: "node_modules" },
  { re: /(^|\/)\.agent-tests\//, why: "local agent test folder" },
  { re: /\.(tgz|zip)$/i, why: "archive" },
];

function matchesEntry(file, entry) {
  const clean = entry.replace(/^\.\//, "").replace(/\/$/, "");
  if (clean.includes("*")) {
    const re = new RegExp(`^${clean.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);
    return re.test(file);
  }
  return file === clean || file.startsWith(`${clean}/`);
}

/** Returns a list of problems; empty means the package contents are fine. */
export function checkPackedFiles(paths, pkg) {
  const allow = [...(pkg.files || [])];
  if (pkg.main) allow.push(pkg.main);
  for (const target of Object.values(typeof pkg.bin === "string" ? { bin: pkg.bin } : pkg.bin || {})) allow.push(target);

  const problems = [];
  for (const file of paths) {
    const forbidden = FORBIDDEN.find((rule) => rule.re.test(file) && !(rule.except && rule.except.test(file)));
    if (forbidden) problems.push(`forbidden (${forbidden.why}): ${file}`);
    const allowed = ALWAYS_INCLUDED.some((re) => re.test(file)) || allow.some((entry) => matchesEntry(file, entry));
    if (!allowed) problems.push(`not in the package.json "files" allowlist: ${file}`);
  }
  return problems;
}
