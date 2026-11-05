// Minimal environment for child processes (P1-04).
// Children get a small allowlist instead of every key in the server's env.
// Extra names are opted in with CAUSLY_PASSTHROUGH_ENV (comma list, "PREFIX*"
// patterns allowed, "*" = inherit everything, the old behavior).

const BASE = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "TZ", "LANG", "LANGUAGE", "LC_*",
  "TMPDIR", "TMP", "TEMP",
  // Windows essentials
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SystemRoot", "SystemDrive", "windir", "COMSPEC", "PATHEXT",
  "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432",
  "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432",
  "NUMBER_OF_PROCESSORS", "OS", "PROCESSOR_ARCHITECTURE",
];

const NETWORK = [
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
];

export const PROFILES = {
  command: [
    ...BASE, ...NETWORK,
    "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR",
    "CI", "NO_COLOR", "FORCE_COLOR",
    "JAVA_HOME", "GOPATH", "GOROOT", "CARGO_HOME", "RUSTUP_HOME", "PYENV_ROOT", "NVM_DIR", "VOLTA_HOME",
  ],
  docker: [
    ...BASE, ...NETWORK,
    "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
    "COMPOSE_PROJECT_NAME", "COMPOSE_FILE", "COMPOSE_PROFILES", "COMPOSE_PATH_SEPARATOR",
    "XDG_RUNTIME_DIR", "WSLENV", "WSL_DISTRO_NAME",
  ],
  terraform: [
    ...BASE, ...NETWORK,
    "TF_LOG", "TF_LOG_PATH", "TF_DATA_DIR", "TF_CLI_CONFIG_FILE", "TF_IN_AUTOMATION", "TF_INPUT",
    "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
  ],
  // simple-git rejects GIT_* itself, so none here.
  git: [...BASE, ...NETWORK, "SSH_AUTH_SOCK", "XDG_CONFIG_HOME"],
  media: [...BASE],
};

export function parsePassthrough(raw) {
  return String(raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function matcher(patterns, caseInsensitive) {
  const norm = (s) => (caseInsensitive ? s.toUpperCase() : s);
  const exact = new Set();
  const prefixes = [];
  let all = false;
  for (const p of patterns) {
    if (p === "*") all = true;
    else if (p.endsWith("*")) prefixes.push(norm(p.slice(0, -1)));
    else exact.add(norm(p));
  }
  return (name) => {
    if (all) return true;
    const n = norm(name);
    return exact.has(n) || prefixes.some((p) => n.startsWith(p));
  };
}

export function buildChildEnv({
  profile = "command",
  source = process.env,
  platform = process.platform,
  passthrough = source.CAUSLY_PASSTHROUGH_ENV,
} = {}) {
  const list = PROFILES[profile];
  if (!list) throw new Error(`Unknown child env profile: ${profile}`);
  const extra = Array.isArray(passthrough) ? passthrough : parsePassthrough(passthrough);
  const allowed = matcher([...list, ...extra], platform === "win32");
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && allowed(k)) out[k] = v;
  }
  return out;
}

export function describeChildEnv(source = process.env) {
  const extra = parsePassthrough(source.CAUSLY_PASSTHROUGH_ENV);
  if (extra.includes("*")) return "full environment inherited (CAUSLY_PASSTHROUGH_ENV=*)";
  if (extra.length) return `minimal + ${extra.length} passthrough (${extra.join(", ")})`;
  return "minimal (no passthrough)";
}
