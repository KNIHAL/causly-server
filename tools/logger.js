import fs from "fs";
import path from "path";
import crypto from "crypto";
import { redactSecrets, redactSecretsInString, getPermissionLevel } from "./security.js";
import { dataDir } from "./paths.js";
import { limit } from "./limits.js";

const LOG_DIR = path.join(dataDir(), "logs");
const LOG_FILE = path.join(LOG_DIR, "activity.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 }); // owner only (macOS/Linux); P1-02
}

// One entry never takes more than this, so a single huge input (a big write_file, say) cannot fill the log.
const MAX_ENTRY_BYTES = 16 * 1024;
// JSON.stringify already escapes quotes, backslashes and every control character below U+0020, so a value
// cannot add a line. These three are legal inside a JSON string but some readers split lines on them.
const LINE_BREAKS = /[\u2028\u2029\u0085]/g;

/**
 * One entry as one line: a single JSON object, control characters escaped, size capped, newline at the end.
 * Whatever the tool input or the error text contains, the result is exactly one line.
 */
export function serializeEntry(entry) {
  let line = JSON.stringify(entry);
  if (Buffer.byteLength(line) > MAX_ENTRY_BYTES) {
    const input = JSON.stringify(entry.input ?? null);
    line = JSON.stringify({
      ...entry,
      input: { truncated: true, original_bytes: Buffer.byteLength(input), preview: input.slice(0, 1000) },
      details: String(entry.details ?? "").slice(0, 2000),
    });
  }
  return line.replace(LINE_BREAKS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) + "\n";
}

/**
 * Before an append: if the file would pass CAUSLY_LOG_MAX_BYTES (default 10 MB), shift
 * activity.log.1 .. .N up by one (N = CAUSLY_LOG_KEEP, default 5; the oldest is deleted) and start a new
 * activity.log. Returns true when it rotated. Never throws.
 */
export function rotateIfNeeded(file, incomingBytes, env = process.env) {
  try {
    const max = limit("CAUSLY_LOG_MAX_BYTES", env);
    const size = fs.statSync(file).size;
    if (size === 0 || size + incomingBytes <= max) return false;
    const keep = limit("CAUSLY_LOG_KEEP", env);
    fs.rmSync(`${file}.${keep}`, { force: true });
    for (let i = keep - 1; i >= 1; i--) {
      if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
    return true;
  } catch {
    return false; // no file yet, or another process rotated first: just append
  }
}

/**
 * Appends a structured JSON log line for every tool invocation: one self-contained JSON object per line
 * (JSONL), so it can be parsed, searched and aggregated later without regex-scraping free text.
 *
 * Never throws: logging failures must not break tool execution.
 * Secret-looking fields (tokens, passwords, keys, etc.) are always redacted before anything touches
 * disk. This applies to the input object AND the free-text details/error string.
 * The file rotates at a size (see rotateIfNeeded) and each line is size-capped and newline-safe
 * (see serializeEntry).
 *
 * Fields: timestamp, operation_id (correlates a call across retries), tool, risk_level, status,
 * input (redacted), details (redacted), duration_ms.
 */
export function logActivity(toolName, input, status, details = "", durationMs = null, operationId = crypto.randomUUID()) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      operation_id: operationId,
      tool: toolName,
      risk_level: getPermissionLevel(toolName, input),
      status,
      input: redactSecrets(input),
      details: redactSecretsInString(details),
      duration_ms: durationMs,
    };
    const line = serializeEntry(entry);
    rotateIfNeeded(LOG_FILE, Buffer.byteLength(line));
    fs.appendFileSync(LOG_FILE, line, { encoding: "utf8", mode: 0o600 });
    return entry;
  } catch (err) {
    // Swallow logging errors: never let logging break the actual tool call.
    console.error("Logger error:", err.message);
    return null;
  }
}