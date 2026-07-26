import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);

// On Windows, run through PowerShell instead of the default cmd.exe —
// cmd.exe can't handle multi-statement scripts, several quoting styles,
// or common PowerShell cmdlets that Claude may reasonably try to use.
const SHELL_OPTION = os.platform() === "win32" ? { shell: "powershell.exe" } : {};

// Commands containing these patterns are blocked outright — no override.
// Keeps a single mistaken/careless call from wiping a drive or the OS.
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!\S)/i, // rm -rf /
  /rm\s+-rf\s+[a-z]:\\?\s*$/i, // rm -rf C:\ or D:\
  /format\s+[a-z]:/i, // format C:
  /del\s+\/s\s+\/q\s+[a-z]:\\?\s*$/i, // del /s /q C:\
  /:\(\)\{.*\};:/, // fork bomb
  /shutdown|restart-computer/i,
  /reg\s+delete/i,
];

const DEFAULT_TIMEOUT_MS = 60_000; // 1 minute
const MAX_OUTPUT_CHARS = 20_000;

function truncate(str) {
  if (!str) return str;
  return str.length > MAX_OUTPUT_CHARS
    ? str.slice(0, MAX_OUTPUT_CHARS) + `\n... [truncated, ${str.length - MAX_OUTPUT_CHARS} more chars]`
    : str;
}

/**
 * Run a shell command in a given working directory.
 * Blocks a short list of catastrophic patterns; everything else is allowed
 * since this server runs with full trusted access on the user's own machine.
 */
export async function runCommand({ command, cwd, timeout_ms = DEFAULT_TIMEOUT_MS }) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(
        `Blocked: this command matches a destructive pattern (${pattern}) and was not run. If this is a false positive, rephrase the command.`
      );
    }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeout_ms,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      windowsHide: true,
      ...SHELL_OPTION,
    });
    return {
      command,
      cwd,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      exit_code: 0,
    };
  } catch (err) {
    // exec rejects on non-zero exit code — surface it as data, not a hard throw,
    // so the caller can see stdout/stderr even on failure.
    return {
      command,
      cwd,
      stdout: truncate(err.stdout || ""),
      stderr: truncate(err.stderr || err.message),
      exit_code: err.code ?? 1,
      timed_out: err.killed && err.signal === "SIGTERM",
    };
  }
}
