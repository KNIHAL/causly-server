import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runSetup, keysList, formatKeysList, keysSet, keysUnset, keysOpen, testConfigured } from "../tools/setupOps.js";
import { readEnvValues } from "../tools/envFile.js";
import { findService } from "../tools/services.js";

let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-setup-"));
  file = path.join(dir, ".env");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Scripted terminal: answers come from a list, in the order the wizard asks. */
function script(answers) {
  const out = [];
  const left = [...answers];
  const next = (q) => {
    out.push(q);
    if (!left.length) throw new Error(`ran out of answers at: ${q}`);
    return left.shift();
  };
  return {
    out,
    left,
    term: {
      interactive: true,
      write: (t) => out.push(t),
      line: async (q) => next(q),
      secret: async (q) => next(q),
      confirm: async (q, def) => {
        const a = next(q);
        return a === "" ? def : a === "y";
      },
      readPipedLine: async () => next("piped"),
    },
  };
}
const said = (s) => s.out.join("");

function fetchStub(routes) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k));
    if (!hit) throw new Error(`unexpected ${url}`);
    const r = hit[1];
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {} };
  };
  return { fetch, calls };
}

const tgOk = {
  getMe: { body: { ok: true, result: { username: "causlybot" } } },
  getUpdates: { body: { ok: true, result: [{ message: { chat: { id: 42, type: "private", first_name: "Asha" } } }] } },
};

describe("runSetup: one service", () => {
  it("telegram: asks for the token, tests it, finds the chat and saves both", async () => {
    const s = script(["123:abcdefghij", "", "y"]); // token, Enter after messaging the bot, confirm chat
    const env = {};
    const { fetch } = fetchStub(tgOk);
    const r = await runSetup({ service: "telegram", term: s.term, env, file, fetch });
    expect(r.saved).toEqual(["telegram"]);
    expect(readEnvValues(file)).toEqual({ TELEGRAM_BOT_TOKEN: "123:abcdefghij", TELEGRAM_CHAT_ID: "42" });
    expect(env.TELEGRAM_CHAT_ID).toBe("42");
    expect(said(s)).toContain("@causlybot");
    expect(said(s)).toContain("@BotFather");
    expect(s.left).toEqual([]);
  });

  it("does not save a key that fails its test unless the user insists", async () => {
    const bad = { getMe: { status: 401, body: { ok: false } } };
    const skip = script(["999:wrongwrongwrong", ""]);
    const r1 = await runSetup({ service: "telegram", term: skip.term, env: {}, file, fetch: fetchStub(bad).fetch });
    expect(r1.skipped).toEqual(["telegram"]);
    expect(fs.existsSync(file)).toBe(false);
    expect(said(skip)).toMatch(/FAILED: Telegram rejected/);

    const force = script(["999:wrongwrongwrong", "s"]);
    const r2 = await runSetup({ service: "telegram", term: force.term, env: {}, file, fetch: fetchStub(bad).fetch });
    expect(r2.saved_untested).toEqual(["telegram"]);
    expect(readEnvValues(file).TELEGRAM_BOT_TOKEN).toBe("999:wrongwrongwrong");
  });

  it("lets the user re-enter after a failure", async () => {
    let n = 0;
    const fetch = async () => ({ ok: ++n > 1, status: n > 1 ? 200 : 401, json: async () => (n > 1 ? { data: [{ id: "whisper-large-v3" }] } : { error: { message: "bad" } }) });
    const s = script(["gsk_firstattempt1", "", "", "r", "gsk_secondattempt2", "", ""]); // key + two optionals skipped, test fails, retry, key + two optionals skipped
    const r = await runSetup({ service: "groq", term: s.term, env: {}, file, fetch });
    expect(r.saved).toEqual(["groq"]);
    expect(readEnvValues(file).GROQ_API_KEY).toBe("gsk_secondattempt2");
  });

  it("keeps an existing key when the user says no, and re-tests it", async () => {
    const s = script(["n", "", ""]); // keep existing, skip the two optionals
    const env = { GROQ_API_KEY: "gsk_existing_key_99" };
    const { fetch, calls } = fetchStub({ "api.groq.com": { body: { data: [] } } });
    const r = await runSetup({ service: "groq", term: s.term, env, file, fetch });
    expect(r.saved).toEqual(["groq"]);
    expect(calls).toHaveLength(1);
    expect(said(s)).toContain("set (…y_99)");
    expect(said(s)).not.toContain("gsk_existing_key_99");
    expect(fs.existsSync(file)).toBe(false); // nothing changed, nothing written
  });

  it("re-asks when a pasted value cannot be stored", async () => {
    const s = script(['"quoted"', "gsk_goodkey123456", "", ""]);
    await runSetup({ service: "groq", term: s.term, env: {}, file, fetch: fetchStub({ "api.groq.com": { body: { data: [] } } }).fetch });
    expect(said(s)).toMatch(/quote mark.*Try again/);
    expect(readEnvValues(file).GROQ_API_KEY).toBe("gsk_goodkey123456");
  });

  it("skips cleanly when a required value is left empty", async () => {
    const s = script([""]);
    const r = await runSetup({ service: "linear", term: s.term, env: {}, file, fetch: fetchStub({}).fetch });
    expect(r.skipped).toEqual(["linear"]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("telegram: explains how to finish when no chat is chosen", async () => {
    const noChat = { getMe: tgOk.getMe, getUpdates: { body: { ok: true, result: [] } } };
    const s = script(["123:abcdefghij", "", "", "", "", ""]); // five "press Enter" rounds with nothing found
    const r = await runSetup({ service: "telegram", term: s.term, env: {}, file, fetch: fetchStub(noChat).fetch });
    expect(r.saved).toEqual(["telegram"]);
    expect(readEnvValues(file)).toEqual({ TELEGRAM_BOT_TOKEN: "123:abcdefghij" });
    expect(said(s)).toMatch(/keys set TELEGRAM_CHAT_ID/);
  });

  it("rejects an unknown service with the list of valid ones", async () => {
    await expect(runSetup({ service: "myspace", term: script([]).term, env: {}, file })).rejects.toThrow(/Unknown service "myspace".*telegram/);
  });
});

describe("runSetup: menu", () => {
  it("shows status, accepts numbers, and finishes on Enter", async () => {
    const s = script(["99", "x", "", ""]); // out-of-range, junk, then finish... (see below)
    const r = await runSetup({ term: s.term, env: { LINEAR_API_KEY: "lin_api_abcdefgh" }, file, fetch: fetchStub({}).fetch });
    expect(r.saved).toEqual([]);
    expect(said(s)).toMatch(/Linear\s+set up/);
    expect(said(s)).toMatch(/Type the numbers from the list/);
  });

  it("configures the picked services in order", async () => {
    const services = ["linear", "groq"].map((id) => findService(id));
    const s = script(["1,2", "lin_api_key_value_1", "gsk_key_value_0002", "", "", ""]);
    const fetch = fetchStub({ "api.linear.app": { body: { data: { viewer: { name: "N" }, organization: { name: "O" } } } }, "api.groq.com": { body: { data: [] } } }).fetch;
    const r = await runSetup({ term: s.term, env: {}, file, fetch, services });
    expect(r.saved).toEqual(["linear", "groq"]);
    expect(readEnvValues(file)).toEqual({ LINEAR_API_KEY: "lin_api_key_value_1", GROQ_API_KEY: "gsk_key_value_0002" });
  });
});

describe("keys", () => {
  it("lists status without revealing secrets, and shows unknown settings", () => {
    fs.writeFileSync(file, "MY_OWN=1\nGROQ_API_KEY=gsk_abcdefghijkl9999\n");
    const r = keysList({ env: { GROQ_API_KEY: "gsk_abcdefghijkl9999", TELEGRAM_CHAT_ID: "42" }, file });
    const text = formatKeysList(r);
    expect(text).toMatch(/GROQ_API_KEY\s+set \(…9999\)/);
    expect(text).toMatch(/TELEGRAM_CHAT_ID\s+set \(42\)/);
    expect(text).toMatch(/LINEAR_API_KEY\s+missing/);
    expect(text).toMatch(/GROQ_WHISPER_MODEL\s+-\s+\(optional\)/);
    expect(text).toContain("Other settings in the file: MY_OWN");
    expect(text).not.toContain("gsk_abcdefghijkl9999");
  });

  it("keys set: from a hidden prompt, from a pipe, and from an explicit value", async () => {
    const env = {};
    const a = script(["lin_api_typed_value"]);
    await keysSet({ name: "LINEAR_API_KEY", term: a.term, file, env });
    expect(readEnvValues(file).LINEAR_API_KEY).toBe("lin_api_typed_value");
    expect(env.LINEAR_API_KEY).toBe("lin_api_typed_value");

    const piped = script(["gsk_piped_value_01"]);
    piped.term.interactive = false;
    await keysSet({ name: "GROQ_API_KEY", term: piped.term, file, env });
    expect(readEnvValues(file).GROQ_API_KEY).toBe("gsk_piped_value_01");

    const r = await keysSet({ name: "CAUSLY_TIMEZONE", term: script([]).term, file, env, value: "Asia/Kolkata" });
    expect(r.notes).toEqual([]);
  });

  it("keys set warns about unknown names and about an environment value that outranks the file", async () => {
    const r1 = await keysSet({ name: "SOMETHING_ELSE", term: script([]).term, file, env: {}, value: "x1" });
    expect(r1.notes[0]).toMatch(/not a setting this server knows/);
    const r2 = await keysSet({ name: "GROQ_API_KEY", term: script([]).term, file, env: {}, value: "gsk_new_value_123", launchEnv: { GROQ_API_KEY: "gsk_from_system_1" } });
    expect(r2.notes[0]).toMatch(/takes priority/);
  });

  it("keys set refuses a bad name or an empty value", async () => {
    await expect(keysSet({ name: "lower", term: script([]).term, file, env: {} })).rejects.toThrow(/capital letters/);
    await expect(keysSet({ name: "GROQ_API_KEY", term: script([]).term, file, env: {}, value: " " })).rejects.toThrow(/empty/);
  });

  it("keys unset removes the line and the live value", () => {
    fs.writeFileSync(file, "LINEAR_API_KEY=abc\nOTHER=1\n");
    const env = { LINEAR_API_KEY: "abc" };
    expect(keysUnset({ name: "LINEAR_API_KEY", file, env }).removed).toBe(true);
    expect(env.LINEAR_API_KEY).toBeUndefined();
    expect(fs.readFileSync(file, "utf8")).toBe("OTHER=1\n");
    expect(keysUnset({ name: "LINEAR_API_KEY", file, env }).removed).toBe(false);
    expect(keysUnset({ name: "OTHER", file, env: {}, launchEnv: { OTHER: "1" } }).notes[0]).toMatch(/still set in the environment/);
  });

  it("keys open creates the file and starts the platform editor", () => {
    const exec = vi.fn();
    const r = keysOpen({ file: path.join(dir, "new", ".env"), platform: "win32", exec });
    expect(fs.existsSync(r.file)).toBe(true);
    expect(exec).toHaveBeenCalledWith("notepad.exe", [r.file], expect.anything(), expect.any(Function));
    const mac = vi.fn();
    keysOpen({ file, platform: "darwin", exec: mac });
    expect(mac.mock.calls[0][0]).toBe("open");
  });
});

describe("testConfigured", () => {
  it("checks configured services, reports incomplete ones, skips the rest", async () => {
    const { fetch } = fetchStub({ "api.groq.com": { body: { data: [{ id: "whisper" }] } } });
    const results = await testConfigured({ env: { GROQ_API_KEY: "gsk_abcdefghij", TELEGRAM_BOT_TOKEN: "1:x" }, fetch });
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(by.groq.ok).toBe(true);
    expect(by.telegram).toMatchObject({ ok: false, detail: "incomplete: missing TELEGRAM_CHAT_ID" });
    expect(by.linear).toBeUndefined();
  });
});
