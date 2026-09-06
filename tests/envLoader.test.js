import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}));

const fs = (await import("fs")).default;
const { loadEnv } = await import("../tools/envLoader.js");

const originalEnv = { ...process.env };

beforeEach(() => {
  fs.existsSync.mockReset();
  fs.readFileSync.mockReset();
  // Clear any keys our tests might set, without nuking unrelated env vars.
  delete process.env.FOO;
  delete process.env.BAR;
  delete process.env.QUOTED;
  delete process.env.SINGLE_QUOTED;
  delete process.env.ALREADY_SET;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("loadEnv", () => {
  it("does nothing if .env does not exist", () => {
    fs.existsSync.mockReturnValue(false);
    loadEnv();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("parses simple KEY=value lines into process.env", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("FOO=bar\nBAR=baz");
    loadEnv();
    expect(process.env.FOO).toBe("bar");
    expect(process.env.BAR).toBe("baz");
  });

  it("skips blank lines and comments", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("# a comment\n\nFOO=bar\n  # indented comment\n");
    loadEnv();
    expect(process.env.FOO).toBe("bar");
  });

  it("skips lines without an = sign", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("not a valid line\nFOO=bar");
    loadEnv();
    expect(process.env.FOO).toBe("bar");
  });

  it("strips surrounding double quotes from values", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('QUOTED="hello world"');
    loadEnv();
    expect(process.env.QUOTED).toBe("hello world");
  });

  it("strips surrounding single quotes from values", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("SINGLE_QUOTED='hello world'");
    loadEnv();
    expect(process.env.SINGLE_QUOTED).toBe("hello world");
  });

  it("does not overwrite a key that's already set in process.env", () => {
    process.env.ALREADY_SET = "original";
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("ALREADY_SET=from_file");
    loadEnv();
    expect(process.env.ALREADY_SET).toBe("original");
  });

  it("trims whitespace around keys and values", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("  FOO  =  bar  ");
    loadEnv();
    expect(process.env.FOO).toBe("bar");
  });

  it("handles values containing an = sign (only splits on the first =)", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("FOO=key=value=pairs");
    loadEnv();
    expect(process.env.FOO).toBe("key=value=pairs");
  });

  it("skips lines with an empty key", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("=novalue\nFOO=bar");
    loadEnv();
    expect(process.env.FOO).toBe("bar");
  });
});
