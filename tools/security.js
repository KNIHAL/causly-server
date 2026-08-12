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
