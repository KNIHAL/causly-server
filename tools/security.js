// Security subsystem: secret redaction, permission levels, and command
// risk classification. Single source of truth so every tool call, log
// line, and approval check uses the same rules.

// ---------------- Secret redaction ----------------

// Key names (case-insensitive substring match) whose values must never
// appear in logs, error messages, or tool responses.
const SECRET_KEY_PATTERNS = [
  "token",
  "password",
  "passwd",
  "api_key",
  "apikey",
  "secret",
  "authorization",
  "access_token",
  "refresh_token",
  "db_pass",
  "credential",
  "private_key",
  "client_secret",
  "auth_token",
];

const REDACTED = "[REDACTED]";

function isSecretKey(key) {
  const lower = key.toLowerCase();
  return SECRET_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Recursively walk an object/array and replace the value of any key that
 * looks like a secret with "[REDACTED]". Never mutates the input — returns
 * a deep copy. Safe against circular references (bails out to "[Circular]").
 */
export function redactSecrets(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => redactSecrets(item, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = isSecretKey(key) ? REDACTED : redactSecrets(val, seen);
    }
    return out;
  }

  return value;
}

/**
 * Redact secret-looking substrings out of a plain string (e.g. an error
 * message that happens to include "token=abc123..."). Best-effort — key/
 * value pairs like `token=xxx`, `token: xxx`, `"token":"xxx"` are caught;
 * this is not a substitute for redactSecrets() on structured data.
 */
export function redactSecretsInString(str) {
  if (typeof str !== "string") return str;
  const pattern = new RegExp(
    `\\b(${SECRET_KEY_PATTERNS.join("|")})\\b(\\s*[:=]\\s*)("[^"]*"|'[^']*'|\\S+)`,
    "gi"
  );
  return str.replace(pattern, (_match, key, sep) => `${key}${sep}${REDACTED}`);
}

// ---------------- Permission levels ----------------

// READ        — safe, read-only, no side effects
// LOW         — normal dev actions, low blast radius, easily reversible
// MEDIUM      — modifies project/repo state, reversible with effort
// HIGH        — production-impacting or hard to reverse (pushes, deploys,
//               merges, arbitrary shell/SQL execution)
// DESTRUCTIVE — deletion / irreversible
//
// Approval policy: READ and LOW run automatically. MEDIUM runs
// automatically too in this single-user trusted-local-machine mode, but
// is classified so that policy can be tightened later without touching
// every tool. HIGH and DESTRUCTIVE always require the caller to pass
// `confirm: true` — this is the approval gate.
export const PERMISSION_LEVELS = {
  // Files
  read_file: "READ",
  read_multiple_files: "READ",
  create_file: "MEDIUM",
  write_file: "MEDIUM",
  edit_file: "MEDIUM",
  delete_file: "DESTRUCTIVE",
  move_file: "MEDIUM",
  copy_file: "LOW",
  get_file_info: "READ",

  // Directory
  list_directory: "READ",
  directory_tree: "READ",
  create_directory: "LOW",
  delete_directory: "DESTRUCTIVE",
  search_files: "READ",

  // Git
  git_init: "LOW",
  git_status: "READ",
  git_add: "LOW",
  git_commit: "MEDIUM",
  git_push: "MEDIUM",
  git_pull: "MEDIUM",
  git_log: "READ",
  git_diff: "READ",
  git_branch: "READ",
  git_create_branch: "LOW",
  git_checkout: "MEDIUM",
  git_merge: "MEDIUM",
  git_reset: "HIGH",
  git_stash: "LOW",
  git_show: "READ",
  git_remote: "MEDIUM",
  git_tag: "LOW",
  git_changed_files: "READ",
  git_diff_stat: "READ",
  git_check_clean: "READ",

  // Command
  run_command: "HIGH",

  // GitHub
  github_get_authenticated_user: "READ",
  github_create_repo: "MEDIUM",
  github_delete_repo: "DESTRUCTIVE",
  github_list_repos: "READ",
  github_create_issue: "LOW",
  github_list_issues: "READ",
  github_create_pull_request: "MEDIUM",
  github_list_pull_requests: "READ",
  github_add_comment: "LOW",
  github_get_repo: "READ",
  github_get_issue: "READ",
  github_update_issue: "MEDIUM",
  github_get_pull_request: "READ",
  github_update_pull_request: "MEDIUM",
  github_merge_pull_request: "HIGH",
  github_get_pull_request_files: "READ",
  github_get_pull_request_diff: "READ",
  github_get_pull_request_comments: "READ",
  github_get_pull_request_reviews: "READ",
  github_get_branch: "READ",
  github_list_branches: "READ",
  github_list_workflows: "READ",
  github_list_workflow_runs: "READ",
  github_get_workflow_run: "READ",
  github_get_workflow_run_jobs: "READ",
  github_get_job_logs: "READ",
  github_rerun_workflow: "MEDIUM",

  // Vercel
  vercel_get_authenticated_user: "READ",
  vercel_list_projects: "READ",
  vercel_get_project: "READ",
  vercel_list_deployments: "READ",
  vercel_get_deployment: "READ",
  vercel_create_deployment: "HIGH",
  vercel_delete_project: "DESTRUCTIVE",
  vercel_get_deployment_logs: "READ",
  vercel_get_deployment_events: "READ",
  vercel_cancel_deployment: "MEDIUM",
  http_check: "READ",

  // Project intelligence
  project_detect: "READ",
  project_info: "READ",
  project_health: "READ",
  run_tests: "LOW",
  run_lint: "LOW",
  run_typecheck: "LOW",
  run_build: "LOW",

  // Workflows
  ship_change: "HIGH",
  fix_ci: "READ",
  verify_ci_fix: "HIGH",
  deploy_project: "HIGH",

  // Slack
  slack_get_user: "READ",
  slack_list_channels: "READ",
  slack_get_channel: "READ",
  slack_read_messages: "READ",
  slack_search_messages: "READ",
  slack_send_message: "HIGH",
  slack_reply_thread: "HIGH",
  slack_create_channel: "HIGH",

  // Supabase
  supabase_list_organizations: "READ",
  supabase_list_projects: "READ",
  supabase_get_project: "READ",
  supabase_create_project: "MEDIUM",
  supabase_delete_project: "DESTRUCTIVE",
  supabase_run_sql: "HIGH",
};

const APPROVAL_REQUIRED_LEVELS = new Set(["HIGH", "DESTRUCTIVE"]);

/**
 * Checks whether a tool call is allowed to proceed. HIGH and DESTRUCTIVE
 * tools require the caller to explicitly pass `confirm: true` in their
 * input — this is the approval gate for this single-user trusted-machine
 * server (no separate human-approval UI exists at the MCP layer, so the
 * explicit flag stands in for it: the AI must consciously decide to
 * proceed, typically after confirming with the person).
 *
 * Returns { allowed, level, reason }. Never throws.
 */
export function checkApproval(toolName, input) {
  const level = PERMISSION_LEVELS[toolName] || "MEDIUM";
  if (!APPROVAL_REQUIRED_LEVELS.has(level)) {
    return { allowed: true, level };
  }
  if (input && input.confirm === true) {
    return { allowed: true, level };
  }
  return {
    allowed: false,
    level,
    reason: `'${toolName}' is a ${level}-risk action and requires explicit confirmation. Re-call with confirm: true to proceed.`,
  };
}

// ---------------- Command risk classification ----------------

// Beyond the hard BLOCKED_PATTERNS in commandOps.js (which stop a call
// outright), this gives a *graded* risk read on a command string so it can
// be surfaced in logs/results for auditability — per the roadmap's own
// warning: "Do not rely only on regex-based destructive command blocking."
const RISKY_COMMAND_SIGNALS = [
  { pattern: /\b(rm|del|erase)\b/i, reason: "deletes files" },
  { pattern: /\bdrop\s+(table|database|schema)\b/i, reason: "drops a database object" },
  { pattern: /\btruncate\s+table\b/i, reason: "truncates a table" },
  { pattern: /\bgit\s+push\s+.*--force/i, reason: "force-pushes (can overwrite remote history)" },
  { pattern: /\bgit\s+reset\s+--hard/i, reason: "hard-resets (can discard uncommitted work)" },
  { pattern: /\bcurl\b.*\|\s*(bash|sh|powershell)/i, reason: "pipes a remote script directly into a shell" },
  { pattern: /\biwr\b.*\|\s*iex\b/i, reason: "downloads and executes a remote script (PowerShell)" },
  { pattern: /\bchmod\s+-R\s+777\b/i, reason: "recursively opens permissions" },
  { pattern: /\bsudo\b|\brunas\b/i, reason: "elevates privileges" },
  { pattern: />\s*\/dev\/(sd|nvme|hd)/i, reason: "writes directly to a disk device" },
  { pattern: /\bnpm\s+publish\b/i, reason: "publishes a package publicly" },
  { pattern: /\bgh\s+repo\s+delete\b/i, reason: "deletes a GitHub repository" },
];

/**
 * Returns a risk read on a shell command string: { risk: "LOW"|"ELEVATED",
 * signals: [reasons] }. Purely informational (does not block) — the hard
 * BLOCKED_PATTERNS check in commandOps.js still runs separately and does
 * block outright. This exists so risky-but-legitimate commands (force
 * push, drop table, etc.) are visible in the audit log even when allowed.
 */
export function classifyCommandRisk(command) {
  const signals = RISKY_COMMAND_SIGNALS.filter((s) => s.pattern.test(command)).map((s) => s.reason);
  return { risk: signals.length ? "ELEVATED" : "LOW", signals };
}

// ---------------- Path security ----------------

// System-critical directories that must never be targeted by delete/write
// operations, even on a trusted single-user machine — a wrong path here
// is the difference between "oops, undo" and "reinstall Windows". Matched
// case-insensitively against the resolved absolute path prefix.
const DENIED_PATH_PREFIXES = [
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

/**
 * Checks whether a path falls inside a denied system directory. Compares
 * the normalized, lowercased path against known-dangerous prefixes.
 * Returns { denied, reason }.
 */
export function isPathDenied(targetPath) {
  if (!targetPath || typeof targetPath !== "string") return { denied: false };
  const normalized = targetPath.replace(/\//g, "\\").toLowerCase();
  const hit = DENIED_PATH_PREFIXES.find((prefix) => normalized.startsWith(prefix.toLowerCase()));
  if (hit) {
    return { denied: true, reason: `'${targetPath}' is inside a protected system directory (${hit}) and cannot be modified through this tool.` };
  }
  return { denied: false };
}
