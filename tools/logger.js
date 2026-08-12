import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { redactSecrets, redactSecretsInString, PERMISSION_LEVELS } from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "activity.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Appends a structured JSON log line for every tool invocation — one
 * self-contained JSON object per line (JSONL), so it can be parsed/
 * searched/aggregated later without regex-scraping free text.
 *
 * Never throws — logging failures must not break tool execution.
 * Secret-looking fields (tokens, passwords, keys, etc.) are always
 * redacted before anything touches disk — this applies to the input
 * object AND the free-text details/error string.
 *
 * Fields: timestamp, operation_id (correlates a call across retries),
 * tool, risk_level, status, input (redacted), details (redacted),
 * duration_ms.
 */
export function logActivity(toolName, input, status, details = "", durationMs = null) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      operation_id: crypto.randomUUID(),
      tool: toolName,
      risk_level: PERMISSION_LEVELS[toolName] || "MEDIUM",
      status,
      input: redactSecrets(input),
      details: redactSecretsInString(details),
      duration_ms: durationMs,
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // Swallow logging errors — never let logging break the actual tool call.
    console.error("Logger error:", err.message);
  }
}
