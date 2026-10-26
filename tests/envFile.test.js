import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { isValidName, readEnvValues, checkValue, setEnvValue, unsetEnvValue, describeSecret } from "../tools/envFile.js";

let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-envfile-"));
  file = path.join(dir, "sub", ".env");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("names and values", () => {
  it("accepts setting-style names only", () => {
    expect(isValidName("GROQ_API_KEY")).toBe(true);
    expect(isValidName("lower")).toBe(false);
    expect(isValidName("A")).toBe(false);
    expect(isValidName("BAD NAME")).toBe(false);
    expect(isValidName("X=1")).toBe(false);
  });

  it("trims values and rejects anything unsafe to store", () => {
    expect(checkValue("  abc  ")).toBe("abc");
    expect(() => checkValue("   ")).toThrow(/empty/);
    expect(() => checkValue("a\nb=c")).toThrow(/line break/);
    expect(() => checkValue('"quoted"')).toThrow(/quote/);
    expect(() => checkValue("x".repeat(5000))).toThrow(/too long/);
  });

  it("describes secrets without revealing them", () => {
    expect(describeSecret("")).toBe("missing");
    expect(describeSecret("short")).toBe("set");
    expect(describeSecret("gsk_abcdefghijkl1234")).toBe("set (…1234)");
  });
});

describe("setEnvValue", () => {
  it("creates the file and its folder, owner-only", () => {
    const r = setEnvValue(file, "GROQ_API_KEY", "abc");
    expect(r).toEqual({ created: true, replaced: false });
    expect(fs.readFileSync(file, "utf8")).toBe("GROQ_API_KEY=abc\n");
    if (os.platform() !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(file))).toEqual([".env"]); // no temp file left behind
  });

  it("replaces an active line and keeps everything else", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# my keys\nA_KEY=1\n\nB_KEY=2\n");
    expect(setEnvValue(file, "A_KEY", "new")).toMatchObject({ replaced: true, created: false });
    expect(fs.readFileSync(file, "utf8")).toBe("# my keys\nA_KEY=new\n\nB_KEY=2\n");
  });

  it("fills in a commented placeholder instead of adding a second line", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# CALENDAR_CLIENT_ID=\nOTHER=1\n");
    setEnvValue(file, "CALENDAR_CLIENT_ID", "id123");
    expect(fs.readFileSync(file, "utf8")).toBe("CALENDAR_CLIENT_ID=id123\nOTHER=1\n");
  });

  it("appends when the name is new, and keeps Windows line endings", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "A=1\r\nB=2\r\n");
    setEnvValue(file, "C_KEY", "3");
    expect(fs.readFileSync(file, "utf8")).toBe("A=1\r\nB=2\r\nC_KEY=3\r\n");
  });

  it("does not match a longer name that merely starts the same", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "GROQ_API_KEY_OLD=1\n");
    setEnvValue(file, "GROQ_API_KEY", "2");
    expect(readEnvValues(file)).toEqual({ GROQ_API_KEY_OLD: "1", GROQ_API_KEY: "2" });
  });

  it("rejects bad names and values without touching the file", () => {
    expect(() => setEnvValue(file, "bad", "x")).toThrow(/valid setting name/);
    expect(() => setEnvValue(file, "A_KEY", "")).toThrow(/empty/);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("readEnvValues and unsetEnvValue", () => {
  it("reads active lines, strips quotes, ignores comments and a missing file", () => {
    expect(readEnvValues(file)).toEqual({});
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# c\nA="x y"\nB=\'z\'\nC=plain=with=equals\n  D = spaced  \nnonsense\n');
    expect(readEnvValues(file)).toEqual({ A: "x y", B: "z", C: "plain=with=equals", D: "spaced" });
  });

  it("removes a setting and reports whether it was there", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "# keep\nA_KEY=1\nB_KEY=2\n");
    expect(unsetEnvValue(file, "A_KEY")).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("# keep\nB_KEY=2\n");
    expect(unsetEnvValue(file, "A_KEY")).toBe(false);
    expect(unsetEnvValue(path.join(dir, "none"), "A_KEY")).toBe(false);
  });
});
