import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createToolWrapper } from "../tools/toolWrapper.js";

describe("env reload", () => {
  let dir;
  let file;
  let saved;
  let mod;

  beforeEach(async () => {
    saved = { ...process.env };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-reload-"));
    file = path.join(dir, ".env");
    process.env.CAUSLY_ENV_FILE = file;
    process.env.CAUSLY_HOME = path.join(dir, "home");
    vi.resetModules();
    mod = await import("../tools/envLoader.js");
  });
  afterEach(() => {
    process.env = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const rewrite = (text, bumpMs = 5000) => {
    fs.writeFileSync(file, text);
    const t = new Date(Date.now() + bumpMs);
    fs.utimesSync(file, t, t);
  };

  it("does nothing before the first load, and when nothing changed", () => {
    expect(mod.reloadEnvIfChanged()).toBe(false);
    rewrite("RELOAD_A=1\n", 0);
    mod.loadEnv();
    expect(process.env.RELOAD_A).toBe("1");
    expect(mod.reloadEnvIfChanged()).toBe(false);
  });

  it("picks up a new key, a changed key and a removed key without a restart", () => {
    rewrite("RELOAD_A=1\nRELOAD_B=old\n", 0);
    mod.loadEnv();
    rewrite("RELOAD_B=new\nRELOAD_C=3\n");
    expect(mod.reloadEnvIfChanged()).toBe(true);
    expect(process.env.RELOAD_A).toBeUndefined();
    expect(process.env.RELOAD_B).toBe("new");
    expect(process.env.RELOAD_C).toBe("3");
  });

  it("picks up a settings file that did not exist at start", () => {
    mod.loadEnv();
    expect(process.env.RELOAD_NEW).toBeUndefined();
    rewrite("RELOAD_NEW=hello\n");
    expect(mod.reloadEnvIfChanged()).toBe(true);
    expect(process.env.RELOAD_NEW).toBe("hello");
  });

  it("never lets the file override what the process started with", () => {
    process.env.RELOAD_LAUNCH = "from-launch";
    rewrite("RELOAD_LAUNCH=from-file\n", 0);
    mod.loadEnv();
    rewrite("RELOAD_LAUNCH=changed\n");
    mod.reloadEnvIfChanged();
    expect(process.env.RELOAD_LAUNCH).toBe("from-launch");
    rewrite("");
    mod.reloadEnvIfChanged();
    expect(process.env.RELOAD_LAUNCH).toBe("from-launch"); // not deleted either
  });
});

describe("tool wrapper", () => {
  const base = { approvalCheck: () => ({ allowed: true }), workspaceCheck: () => ({ allowed: true }), activityLogger: vi.fn(), receiptEmitter: vi.fn() };
  const text = (r) => r.content[0].text;

  it("refreshes settings before each call", async () => {
    const refresh = vi.fn();
    const wrap = createToolWrapper({ ...base, envRefresher: refresh });
    await wrap("t", async () => ({ ok: 1 }))({});
    await wrap("t", async () => ({ ok: 1 }))({});
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("a failing refresh never blocks the tool", async () => {
    const wrap = createToolWrapper({ ...base, envRefresher: () => { throw new Error("disk"); } });
    expect(text(await wrap("t", async () => ({ ok: 1 }))({}))).toContain('"ok": 1');
  });

  it("adds the setup hint to a missing-key error, but logs the plain message", async () => {
    const logger = vi.fn();
    const wrap = createToolWrapper({ ...base, activityLogger: logger, envRefresher: () => {} });
    const r = await wrap("meeting_transcribe", async () => { throw new Error("Transcription is not set up. Missing: GROQ_API_KEY"); })({});
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Missing: GROQ_API_KEY");
    expect(text(r)).toContain('causly-server setup groq');
    expect(logger).toHaveBeenCalledWith("meeting_transcribe", {}, "ERROR", "Transcription is not set up. Missing: GROQ_API_KEY", expect.any(Number), expect.anything());
  });

  it("leaves other errors alone, and survives a failing hinter", async () => {
    const wrap = createToolWrapper({ ...base, envRefresher: () => {} });
    expect(text(await wrap("t", async () => { throw new Error("File not found"); })({}))).toBe("Error: File not found");
    const broken = createToolWrapper({ ...base, envRefresher: () => {}, errorHinter: () => { throw new Error("x"); } });
    expect(text(await broken("t", async () => { throw new Error("nope"); })({}))).toBe("Error: nope");
  });
});
