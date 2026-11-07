import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { googleSignIns, googleWarnings, loginExpiryNote, issuedName, isGoogleToken, markedPublished } from "../tools/googleToken.js";
import { runGoogleLogin, GOOGLE_TARGETS } from "../tools/googleLogin.js";
import { keysSet, keysUnset, keysList } from "../tools/setupOps.js";
import { readEnvValues, setEnvValue } from "../tools/envFile.js";
import { runDoctor } from "../tools/cliOps.js";
import { runStatus } from "../tools/statusOps.js";

const NOW = new Date("2026-11-07T06:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000 - 3_600_000).toISOString(); // a little over n days

const withToken = (days, extra = {}) => ({
  GMAIL_REFRESH_TOKEN: "1//t",
  [issuedName("GMAIL_REFRESH_TOKEN")]: daysAgo(days),
  ...extra,
});

let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-gtoken-"));
  file = path.join(dir, ".env");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("googleSignIns: how old the sign-in is", () => {
  it.each([
    [0, "ok", /saved today/],
    [1, "ok", /saved yesterday/],
    [4, "ok", /saved 4 days ago/],
    [5, "soon", /2 days left/],
    [6, "soon", /1 day left/],
    [7, "expired", /has expired it/],
    [20, "expired", /saved 20 days ago/],
  ])("%s days old is %s", (days, level, text) => {
    const [s] = googleSignIns({ env: withToken(days), now: NOW });
    expect(s.level).toBe(level);
    expect(s.days).toBe(days);
    expect(s.text).toMatch(text);
  });

  it("the warning says what to do: publish the app or renew", () => {
    const [soon] = googleSignIns({ env: withToken(5), now: NOW });
    expect(soon.text).toMatch(/Testing status/);
    expect(soon.text).toMatch(/Publish the app/);
    expect(soon.text).toMatch(/causly-server login google/);
  });

  it("says nothing about a token whose age is unknown (saved by hand or by an older version)", () => {
    expect(googleSignIns({ env: { GMAIL_REFRESH_TOKEN: "1//t" }, now: NOW })).toEqual([]);
    expect(googleSignIns({ env: withToken(6, { [issuedName("GMAIL_REFRESH_TOKEN")]: "not a date" }), now: NOW })).toEqual([]);
  });

  it("ignores a date for a token that is no longer set", () => {
    expect(googleSignIns({ env: { [issuedName("GMAIL_REFRESH_TOKEN")]: daysAgo(6) }, now: NOW })).toEqual([]);
  });

  it("a date in the future (clock change) counts as today, never negative", () => {
    const [s] = googleSignIns({ env: withToken(-3), now: NOW });
    expect(s.days).toBe(0);
    expect(s.level).toBe("ok");
  });

  it("Gmail and Calendar signed in together are one line; separate sign-ins are separate lines", () => {
    const same = daysAgo(6);
    const together = googleSignIns({
      env: { GMAIL_REFRESH_TOKEN: "a", CALENDAR_REFRESH_TOKEN: "b", GMAIL_REFRESH_TOKEN_ISSUED: same, CALENDAR_REFRESH_TOKEN_ISSUED: same },
      now: NOW,
    });
    expect(together).toHaveLength(1);
    expect(together[0].text).toMatch(/Gmail, Google Calendar/);

    const apart = googleSignIns({
      env: { GMAIL_REFRESH_TOKEN: "a", CALENDAR_REFRESH_TOKEN: "b", GMAIL_REFRESH_TOKEN_ISSUED: daysAgo(6), CALENDAR_REFRESH_TOKEN_ISSUED: daysAgo(1) },
      now: NOW,
    });
    expect(apart.map((s) => s.level).sort()).toEqual(["ok", "soon"]);
  });
});

describe("googleWarnings and CAUSLY_GOOGLE_PUBLISHED", () => {
  it("returns only sign-ins that need attention", () => {
    expect(googleWarnings({ env: withToken(2), now: NOW })).toEqual([]);
    expect(googleWarnings({ env: withToken(5), now: NOW })).toHaveLength(1);
    expect(googleWarnings({ env: withToken(9), now: NOW })).toHaveLength(1);
  });

  it.each(["true", "TRUE", "1", "yes", " true "])("is silent once the app is marked published (%s)", (v) => {
    expect(markedPublished({ CAUSLY_GOOGLE_PUBLISHED: v })).toBe(true);
    expect(googleWarnings({ env: withToken(9, { CAUSLY_GOOGLE_PUBLISHED: v }), now: NOW })).toEqual([]);
  });

  it.each(["", "false", "no", "0", undefined])("%s does not count as published", (v) => {
    expect(markedPublished({ CAUSLY_GOOGLE_PUBLISHED: v })).toBe(false);
  });
});

describe("loginExpiryNote", () => {
  it("names the day a Testing-status sign-in stops working", () => {
    const note = loginExpiryNote(NOW, {});
    expect(note).toMatch(/2026-11-14/);
    expect(note).toMatch(/CAUSLY_GOOGLE_PUBLISHED/);
  });
  it("is not shown once the app is marked published", () => {
    expect(loginExpiryNote(NOW, { CAUSLY_GOOGLE_PUBLISHED: "true" })).toBeNull();
  });
});

describe("the date follows the token", () => {
  it("only Google refresh tokens are tracked", () => {
    expect(isGoogleToken("GMAIL_REFRESH_TOKEN")).toBe(true);
    expect(isGoogleToken("CALENDAR_REFRESH_TOKEN")).toBe(true);
    expect(isGoogleToken("GSC_REFRESH_TOKEN")).toBe(true);
    expect(isGoogleToken("GITHUB_TOKEN")).toBe(false);
    expect(isGoogleToken("toString")).toBe(false);
  });

  it("keys set on a Google token stamps it; other keys are left alone", async () => {
    const env = {};
    await keysSet({ name: "GMAIL_REFRESH_TOKEN", value: "1//new", file, env });
    await keysSet({ name: "GITHUB_TOKEN", value: "ghp_x", file, env });
    const saved = readEnvValues(file);
    expect(Date.parse(saved.GMAIL_REFRESH_TOKEN_ISSUED)).toBeGreaterThan(Date.now() - 60_000);
    expect(saved).not.toHaveProperty("GITHUB_TOKEN_ISSUED");
    expect(env.GMAIL_REFRESH_TOKEN_ISSUED).toBe(saved.GMAIL_REFRESH_TOKEN_ISSUED);
  });

  it("replacing a token resets the date, so an old date cannot cause a false warning", async () => {
    setEnvValue(file, "GMAIL_REFRESH_TOKEN", "1//old");
    setEnvValue(file, "GMAIL_REFRESH_TOKEN_ISSUED", daysAgo(30));
    const env = { ...readEnvValues(file) };
    await keysSet({ name: "GMAIL_REFRESH_TOKEN", value: "1//fresh", file, env });
    expect(googleSignIns({ env, now: new Date() })[0].level).toBe("ok");
  });

  it("keys unset removes the token and its date", async () => {
    const env = {};
    await keysSet({ name: "GMAIL_REFRESH_TOKEN", value: "1//x", file, env });
    keysUnset({ name: "GMAIL_REFRESH_TOKEN", file, env });
    expect(readEnvValues(file)).toEqual({});
    expect(env).toEqual({});
  });

  it("keys list does not show the date as a setting to manage", async () => {
    const env = {};
    await keysSet({ name: "GMAIL_REFRESH_TOKEN", value: "1//x", file, env });
    const list = keysList({ env, file });
    expect(list.other).not.toContain("GMAIL_REFRESH_TOKEN_ISSUED");
  });
});

describe("login google records when the token was saved", () => {
  const ALL = [...GOOGLE_TARGETS.gmail.scopes, ...GOOGLE_TARGETS.calendar.scopes].join(" ");
  const term = { out: [], interactive: true, write(t) { this.out.push(t); }, line: async () => "", secret: async () => "", confirm: async () => true };
  const google = async (url, init) => {
    const body = new URLSearchParams(String(init.body));
    return new Response(
      JSON.stringify(body.get("grant_type") === "authorization_code" ? { refresh_token: "1//rt", access_token: "a", scope: ALL } : { access_token: "a", expires_in: 3600, scope: ALL }),
      { status: 200 }
    );
  };
  const browser = async (url) => {
    const u = new URL(url);
    await fetch(`${u.searchParams.get("redirect_uri")}/?${new URLSearchParams({ state: u.searchParams.get("state"), code: "c" })}`);
  };

  it("stamps each saved token, and prints when it would expire in Testing status", async () => {
    term.out.length = 0;
    const env = { GMAIL_CLIENT_ID: "id", GMAIL_CLIENT_SECRET: "secret" };
    await runGoogleLogin({ targets: ["gmail", "calendar"], term, env, file, fetch: google, open: browser, now: NOW });
    const saved = readEnvValues(file);
    expect(saved.GMAIL_REFRESH_TOKEN_ISSUED).toBe(NOW.toISOString());
    expect(saved.CALENDAR_REFRESH_TOKEN_ISSUED).toBe(NOW.toISOString());
    expect(env.GMAIL_REFRESH_TOKEN_ISSUED).toBe(NOW.toISOString());
    const out = term.out.join("");
    expect(out).toMatch(/Testing status, this sign-in stops working on 2026-11-14/);
  });

  it("does not print the reminder when the app is marked published", async () => {
    term.out.length = 0;
    const env = { GMAIL_CLIENT_ID: "id", GMAIL_CLIENT_SECRET: "secret", CAUSLY_GOOGLE_PUBLISHED: "true" };
    await runGoogleLogin({ targets: ["gmail"], term, env, file, fetch: google, open: browser, now: NOW });
    expect(term.out.join("")).not.toMatch(/Testing status/);
  });
});

describe("doctor and status", () => {
  const exec = (cmd, args, opts, cb) => cb(null, "ffmpeg version 7\n");
  const where = () => ({ platform: "linux", home: path.join(dir, "home"), exec, nodeVersion: "22.14.0", now: NOW });
  const googleCheck = (r) => r.checks.filter((c) => c.name === "Google sign-in");

  it("doctor warns from day 5, with the days left and the fix", async () => {
    const r = await runDoctor({ ...where(), env: withToken(5) });
    const [c] = googleCheck(r);
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/2 days left/);
    expect(c.detail).toMatch(/causly-server login google/);
    expect(r.ok).toBe(true); // a warning, not a failed setup
  });

  it("doctor shows a young sign-in as fine", async () => {
    const [c] = googleCheck(await runDoctor({ ...where(), env: withToken(1) }));
    expect(c).toMatchObject({ ok: true });
    expect(c.detail).toMatch(/saved yesterday/);
  });

  it("doctor says an expired sign-in has expired", async () => {
    const [c] = googleCheck(await runDoctor({ ...where(), env: withToken(8) }));
    expect(c.ok).toBe(false);
    expect(c.detail).toMatch(/has expired it/);
  });

  it("doctor has no Google line when there is no known sign-in, and a calm one when published", async () => {
    expect(googleCheck(await runDoctor({ ...where(), env: {} }))).toEqual([]);
    expect(googleCheck(await runDoctor({ ...where(), env: { GMAIL_REFRESH_TOKEN: "1//t" } }))).toEqual([]);
    const [c] = googleCheck(await runDoctor({ ...where(), env: withToken(9, { CAUSLY_GOOGLE_PUBLISHED: "true" }) }));
    expect(c.ok).toBe(true);
    expect(c.detail).toMatch(/published/);
  });

  it("status shows a Google line only when the sign-in needs attention", async () => {
    const base = { platform: "linux", home: path.join(dir, "home"), version: "1.6.0", dbFile: path.join(dir, "none.db"), now: NOW, checkUpdate: false };
    const soon = await runStatus({ ...base, env: withToken(6) });
    expect(soon.lines.some((l) => /^Google:\s+Google sign-in \(Gmail\).*1 day left/.test(l))).toBe(true);
    expect(soon.google).toHaveLength(1);

    const fine = await runStatus({ ...base, env: withToken(2) });
    expect(fine.lines.some((l) => l.startsWith("Google:"))).toBe(false);

    const published = await runStatus({ ...base, env: withToken(9, { CAUSLY_GOOGLE_PUBLISHED: "true" }) });
    expect(published.lines.some((l) => l.startsWith("Google:"))).toBe(false);
  });
});
