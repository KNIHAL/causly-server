import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { serializeEntry, rotateIfNeeded } from "../tools/logger.js";

let dir;
let file;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-log-"));
  file = path.join(dir, "activity.log");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("serializeEntry (forged lines)", () => {
  const base = { timestamp: "t", operation_id: "id", tool: "run_command", risk_level: "HIGH", status: "success" };

  it("a newline in a value cannot add a second line", () => {
    const forged = 'x\n{"tool":"read_file","status":"success","details":"forged"}';
    const out = serializeEntry({ ...base, input: { command: forged }, details: forged });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.slice(0, -1)).not.toContain("\n");
    expect(out.split("\n").filter(Boolean)).toHaveLength(1);
    const parsed = JSON.parse(out);
    expect(parsed.tool).toBe("run_command");
    expect(parsed.input.command).toBe(forged);
  });

  it("carriage returns and other control characters are escaped", () => {
    const out = serializeEntry({ ...base, input: {}, details: "a\r\nb\u0000c\u001bd" });
    expect(out).not.toMatch(/[\r\u0000\u001b]/);
    expect(JSON.parse(out).details).toBe("a\r\nb\u0000c\u001bd");
  });

  it("U+2028, U+2029 and U+0085 are escaped and round-trip", () => {
    const details = "a\u2028b\u2029c\u0085d";
    const out = serializeEntry({ ...base, input: {}, details });
    expect(out).not.toMatch(/[\u2028\u2029\u0085]/);
    expect(JSON.parse(out).details).toBe(details);
  });

  it("an oversized entry is cut down to one short valid line", () => {
    const out = serializeEntry({ ...base, input: { content: "A".repeat(100_000) }, details: "B".repeat(100_000) });
    expect(Buffer.byteLength(out)).toBeLessThan(8 * 1024);
    const parsed = JSON.parse(out);
    expect(parsed.input.truncated).toBe(true);
    expect(parsed.input.original_bytes).toBeGreaterThan(100_000);
    expect(parsed.tool).toBe("run_command");
  });
});

describe("rotateIfNeeded", () => {
  const env = { CAUSLY_LOG_MAX_BYTES: "100", CAUSLY_LOG_KEEP: "3" };

  it("does nothing while under the cap", () => {
    fs.writeFileSync(file, "x".repeat(50));
    expect(rotateIfNeeded(file, 10, env)).toBe(false);
    expect(fs.existsSync(`${file}.1`)).toBe(false);
  });

  it("does nothing when the file does not exist yet", () => {
    expect(rotateIfNeeded(file, 10, env)).toBe(false);
  });

  it("moves the file to .1 when the next line would pass the cap", () => {
    fs.writeFileSync(file, "x".repeat(95));
    expect(rotateIfNeeded(file, 10, env)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(`${file}.1`, "utf8")).toBe("x".repeat(95));
  });

  it("keeps only CAUSLY_LOG_KEEP rotated files and drops the oldest", () => {
    for (let n = 1; n <= 5; n++) {
      fs.writeFileSync(file, String(n).repeat(100));
      rotateIfNeeded(file, 10, env);
    }
    expect(fs.readFileSync(`${file}.1`, "utf8")).toBe("5".repeat(100));
    expect(fs.readFileSync(`${file}.2`, "utf8")).toBe("4".repeat(100));
    expect(fs.readFileSync(`${file}.3`, "utf8")).toBe("3".repeat(100));
    expect(fs.existsSync(`${file}.4`)).toBe(false);
  });

  it("never throws, even when the rotation itself fails", () => {
    fs.writeFileSync(file, "x".repeat(100));
    fs.mkdirSync(`${file}.1`); // a directory where a file should go
    fs.writeFileSync(path.join(`${file}.1`, "blocker"), "x");
    expect(() => rotateIfNeeded(file, 10, env)).not.toThrow();
  });
});
