import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "activity.log");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Appends a structured log line for every tool invocation.
 * Never throws — logging failures must not break tool execution.
 */
export function logActivity(toolName, input, status, details = "") {
  try {
    const timestamp = new Date().toISOString();
    const safeInput = JSON.stringify(input);
    const line = `[${timestamp}] TOOL=${toolName} STATUS=${status} INPUT=${safeInput} ${details}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (err) {
    // Swallow logging errors — never let logging break the actual tool call.
    console.error("Logger error:", err.message);
  }
}
