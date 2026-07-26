import { exec, execFile } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const IS_WINDOWS = os.platform() === "win32";

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

  const runOpts = {
    cwd,
    timeout: timeout_ms,
    maxBuffer: 10 * 1024 * 1024, // 10MB
    windowsHide: true,
  };

  try {
    // On Windows, spawn powershell.exe directly as the target process
    // (not via exec's "shell" option) — this is what makes windowsHide
    // actually suppress the console window. Using exec's shell option
    // with a custom shell path leaves windowsHide ineffective on Windows,
    // which was popping up (and auto-closing) a visible terminal window
    // on every single tool call.
    const { stdout, stderr } = IS_WINDOWS
      ? await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], runOpts)
      : await execAsync(command, runOpts);

    return {
      command,
      cwd,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      exit_code: 0,
    };
  } catch (err) {
    // exec/execFile reject on non-zero exit code — surface it as data, not
    // a hard throw, so the caller can see stdout/stderr even on failure.
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
