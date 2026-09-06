import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("child_process", async () => {
  const { promisify } = await import("node:util");
  function attachCustom(fn) {
    fn[promisify.custom] = (file, args, options) =>
      new Promise((resolve, reject) => {
        // Support both exec(command, options, cb) and execFile(file, args, options, cb)
        if (typeof args === "function") {
          fn(file, options, (err, stdout, stderr) => {
            if (err) {
              err.stdout = err.stdout ?? stdout;
              err.stderr = err.stderr ?? stderr;
              reject(err);
            } else resolve({ stdout, stderr });
          });
        } else {
          fn(file, args, options, (err, stdout, stderr) => {
            if (err) {
              err.stdout = err.stdout ?? stdout;
              err.stderr = err.stderr ?? stderr;
              reject(err);
            } else resolve({ stdout, stderr });
          });
        }
      });
    return fn;
  }
  const exec = attachCustom(vi.fn());
  const execFile = attachCustom(vi.fn());
  return { exec, execFile };
});

const { exec, execFile } = await import("child_process");
const { runCommand } = await import("../tools/commandOps.js");

function ok(stdout = "", stderr = "") {
  return (...callArgs) => {
    const cb = callArgs[callArgs.length - 1];
    cb(null, stdout, stderr);
  };
}
function enoent() {
  const err = new Error("ENOENT: not found");
  err.code = "ENOENT";
  return (...callArgs) => callArgs[callArgs.length - 1](err);
}
function nonZeroExit(stdout = "", stderr = "command failed", code = 1) {
  const err = new Error(stderr);
  err.code = code;
  err.stdout = stdout;
  err.stderr = stderr;
  return (...callArgs) => callArgs[callArgs.length - 1](err);
}

beforeEach(() => {
  exec.mockReset();
  execFile.mockReset();
});

describe("runCommand — blocked patterns", () => {
  it("blocks rm -rf /", async () => {
    await expect(runCommand({ command: "rm -rf /" })).rejects.toThrow(/Blocked/);
    expect(execFile).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("blocks format C:", async () => {
    await expect(runCommand({ command: "format C:" })).rejects.toThrow(/Blocked/);
  });

  it("blocks shutdown commands", async () => {
    await expect(runCommand({ command: "shutdown /s /t 0" })).rejects.toThrow(/Blocked/);
  });

  it("blocks reg delete", async () => {
    await expect(runCommand({ command: "reg delete HKLM\\Software\\Foo" })).rejects.toThrow(/Blocked/);
  });

  it("blocks fork bombs", async () => {
    await expect(runCommand({ command: ":(){ :|:& };:" })).rejects.toThrow(/Blocked/);
  });

  it("does not block a benign command containing 'shutdown' as a substring of something else", async () => {
    // Sanity: ensure the blocklist doesn't over-match ordinary commands.
    execFile.mockImplementationOnce(ok("build ok", ""));
    const result = await runCommand({ command: "npm run build" });
    expect(result.exit_code).toBe(0);
  });
});

describe("runCommand — Windows execution chain (assumes win32 host)", () => {
  it("runs successfully via PowerShell on the first attempt", async () => {
    execFile.mockImplementationOnce(ok("hello", ""));
    const result = await runCommand({ command: "echo hello" });
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.command).toBe("echo hello");
    expect(result.risk).toEqual({ risk: "LOW", signals: [] });
    expect(execFile.mock.calls[0][0]).toMatch(/powershell\.exe$/i);
    expect(execFile.mock.calls[0][1]).toEqual(["-NoProfile", "-NonInteractive", "-Command", "echo hello"]);
  });

  it("falls back to 'powershell.exe' via PATH when the absolute path ENOENTs", async () => {
    execFile.mockImplementationOnce(enoent());
    execFile.mockImplementationOnce(ok("fallback1 ok", ""));
    const result = await runCommand({ command: "echo hi" });
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("fallback1 ok");
    expect(execFile.mock.calls[1][0]).toBe("powershell.exe");
  });

  it("falls back to exec(command) via cmd/ComSpec when both PowerShell attempts ENOENT", async () => {
    execFile.mockImplementationOnce(enoent());
    execFile.mockImplementationOnce(enoent());
    exec.mockImplementationOnce(ok("fallback2 ok", ""));
    const result = await runCommand({ command: "echo hi" });
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("fallback2 ok");
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("falls back to absolute cmd.exe path as the last resort", async () => {
    execFile.mockImplementationOnce(enoent());
    execFile.mockImplementationOnce(enoent());
    exec.mockImplementationOnce(enoent());
    execFile.mockImplementationOnce(ok("fallback3 ok", ""));
    const result = await runCommand({ command: "echo hi" });
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("fallback3 ok");
    expect(execFile.mock.calls[2][0]).toMatch(/cmd\.exe$/i);
    expect(execFile.mock.calls[2][1]).toEqual(["/d", "/s", "/c", "echo hi"]);
  });

  it("does not attempt further fallbacks on a non-ENOENT error — surfaces the failure as data", async () => {
    execFile.mockImplementationOnce(nonZeroExit("", "Some-Command : term not recognized", 1));
    const result = await runCommand({ command: "Some-Command" });
    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain("term not recognized");
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(exec).not.toHaveBeenCalled();
  });

  it("reports timed_out when the process was killed via SIGTERM", async () => {
    const err = new Error("timeout");
    err.killed = true;
    err.signal = "SIGTERM";
    err.stdout = "";
    err.stderr = "";
    execFile.mockImplementationOnce((...callArgs) => callArgs[callArgs.length - 1](err));
    const result = await runCommand({ command: "sleep 100" });
    expect(result.timed_out).toBe(true);
    expect(result.exit_code).toBe(1);
  });

  it("truncates very long stdout", async () => {
    const longOutput = "x".repeat(25000);
    execFile.mockImplementationOnce(ok(longOutput, ""));
    const result = await runCommand({ command: "generate-long-output" });
    expect(result.stdout.length).toBeLessThan(longOutput.length);
    expect(result.stdout).toContain("truncated");
  });

  it("attaches classifyCommandRisk output for a risky command", async () => {
    execFile.mockImplementationOnce(ok("", ""));
    const result = await runCommand({ command: "git push origin main --force" });
    expect(result.risk.risk).toBe("ELEVATED");
    expect(result.risk.signals).toContain("force-pushes (can overwrite remote history)");
  });

  it("passes cwd through to the exec options", async () => {
    execFile.mockImplementationOnce(ok("", ""));
    await runCommand({ command: "dir", cwd: "D:\\projects\\myapp" });
    expect(execFile.mock.calls[0][2].cwd).toBe("D:\\projects\\myapp");
  });
});

describe("runCommand — non-Windows platform", () => {
  it("calls exec directly, bypassing the PowerShell fallback chain", async () => {
    vi.resetModules();
    vi.doMock("os", () => ({ default: { platform: () => "linux" } }));
    vi.doMock("child_process", async () => {
      const { promisify } = await import("node:util");
      const execFn = vi.fn();
      execFn[promisify.custom] = (command, options) =>
        new Promise((resolve, reject) => {
          execFn(command, options, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          });
        });
      const execFileFn = vi.fn();
      return { exec: execFn, execFile: execFileFn };
    });

    const { exec: linuxExec, execFile: linuxExecFile } = await import("child_process");
    linuxExec.mockImplementationOnce((command, options, cb) => cb(null, "linux ok", ""));
    const { runCommand: linuxRunCommand } = await import("../tools/commandOps.js");

    const result = await linuxRunCommand({ command: "echo hi" });
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("linux ok");
    expect(linuxExecFile).not.toHaveBeenCalled();

    vi.doUnmock("os");
    vi.doUnmock("child_process");
    vi.resetModules();
  });
});
