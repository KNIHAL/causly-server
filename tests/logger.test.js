import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
  },
}));

const fs = (await import("fs")).default;
const { logActivity } = await import("../tools/logger.js");

beforeEach(() => {
  fs.appendFileSync.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function lastEntry() {
  const [, line] = fs.appendFileSync.mock.calls[fs.appendFileSync.mock.calls.length - 1];
  return JSON.parse(line.trim());
}

describe("logActivity", () => {
  it("writes a JSONL entry with the expected shape", () => {
    logActivity("read_file", { path: "/tmp/x" }, "success", "read ok", 12);
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    const entry = lastEntry();
    expect(entry.tool).toBe("read_file");
    expect(entry.status).toBe("success");
    expect(entry.details).toBe("read ok");
    expect(entry.duration_ms).toBe(12);
    expect(entry.operation_id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
  });

  it("looks up risk_level from PERMISSION_LEVELS for a known tool", () => {
    logActivity("delete_file", {}, "success");
    expect(lastEntry().risk_level).toBe("DESTRUCTIVE");
  });

  it("defaults risk_level to MEDIUM for an unknown tool", () => {
    logActivity("some_unregistered_tool", {}, "success");
    expect(lastEntry().risk_level).toBe("MEDIUM");
  });

  it("redacts secret-looking fields in the input object before writing", () => {
    logActivity("gmail_send", { to: "x@example.com", token: "abc123" }, "success");
    const entry = lastEntry();
    expect(entry.input.token).toBe("[REDACTED]");
    expect(entry.input.to).toBe("x@example.com");
  });

  it("redacts secret-looking substrings in the details string", () => {
    logActivity("run_command", {}, "error", "failed: token=abc123xyz");
    const entry = lastEntry();
    expect(entry.details).toContain("[REDACTED]");
    expect(entry.details).not.toContain("abc123xyz");
  });

  it("defaults details to an empty string and duration_ms to null when omitted", () => {
    logActivity("read_file", {}, "success");
    const entry = lastEntry();
    expect(entry.details).toBe("");
    expect(entry.duration_ms).toBeNull();
  });

  it("never throws even if the underlying fs write fails", () => {
    fs.appendFileSync.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logActivity("read_file", {}, "success")).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith("Logger error:", "disk full");
  });

  it("generates a unique operation_id per call", () => {
    logActivity("read_file", {}, "success");
    const id1 = lastEntry().operation_id;
    logActivity("read_file", {}, "success");
    const id2 = lastEntry().operation_id;
    expect(id1).not.toBe(id2);
  });
});
