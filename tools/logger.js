import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { redactSecrets, redactSecretsInString } from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "activity.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Appends a structured log line for every tool invocation.
 * Never throws — logging failures must not break tool execution.
 * Secret-looking fields (tokens, passwords, keys, etc.) are always
 * redacted before anything touches disk — this applies to the input
 * object AND the free-text details/error string.
 */
export function logActivity(toolName, input, status, details = "") {
  try {
    const timestamp = new Date().toISOString();
    const safeInput = JSON.stringify(redactSecrets(input));
    const safeDetails = redactSecretsInString(details);
    const line = `[${timestamp}] TOOL=${toolName} STATUS=${status} INPUT=${safeInput} ${safeDetails}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (err) {
    // Swallow logging errors — never let logging break the actual tool call.
    console.error("Logger error:", err.message);
  }
}
