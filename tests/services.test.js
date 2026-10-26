import { describe, it, expect } from "vitest";
import { SERVICES, findService, serviceState, checkService, setupHint, allNames, requiredNames } from "../tools/services.js";

/** fetch stub: routes by URL substring to { status, body }; records calls. */
function stub(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k));
    if (!hit) throw new Error(`unexpected url ${url}`);
    const r = typeof hit[1] === "function" ? hit[1](init) : hit[1];
    if (r instanceof Error) throw r;
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body ?? {} };
  };
  return { fetch, calls };
}
const run = (id, env, routes) => checkService(findService(id), env, stub(routes));

describe("registry", () => {
  it("has unique ids and valid setting names", () => {
    const ids = SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of allNames()) expect(n).toMatch(/^[A-Z][A-Z0-9_]+$/);
    for (const s of SERVICES) {
      expect(requiredNames(s).length, `${s.id} needs a required setting`).toBeGreaterThan(0);
      expect(s.steps.length).toBeGreaterThan(0);
      expect(s.url).toMatch(/^https:\/\//);
      expect(typeof s.check).toBe("function");
    }
  });

  it("finds by id or name, and rejects unknown", () => {
    expect(findService("TELEGRAM").id).toBe("telegram");
    expect(findService("google calendar").id).toBe("calendar");
    expect(findService("groq").id).toBe("groq");
    expect(findService("nope")).toBeUndefined();
  });

  it("works out configured, incomplete and missing", () => {
    const tg = findService("telegram");
    expect(serviceState(tg, {})).toEqual({ configured: false, incomplete: false, missing: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] });
    expect(serviceState(tg, { TELEGRAM_BOT_TOKEN: "t" })).toMatchObject({ configured: false, incomplete: true, missing: ["TELEGRAM_CHAT_ID"] });
    expect(serviceState(tg, { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" }).configured).toBe(true);
    expect(serviceState(findService("calendar"), { CALENDAR_REFRESH_TOKEN: "r" }).configured).toBe(true); // optional ones are not required
  });
});

describe("setupHint", () => {
  it("points at the right service when a required setting is named", () => {
    expect(setupHint("Missing: GROQ_API_KEY (free key)")).toMatch(/setup groq/);
    expect(setupHint("TELEGRAM_BOT_TOKEN is not set")).toMatch(/setup telegram/);
  });
  it("stays quiet otherwise", () => {
    expect(setupHint("Cannot find the file")).toBeNull();
    expect(setupHint("CAUSLY_TIMEZONE looked odd")).toBeNull(); // optional settings do not trigger it
    expect(setupHint(undefined)).toBeNull();
  });
});

describe("live checks", () => {
  it("github", async () => {
    const ok = await run("github", { GITHUB_TOKEN: "ghp_x" }, { "api.github.com/user": { body: { login: "kumar" } } });
    expect(ok).toMatchObject({ ok: true, detail: "signed in as kumar" });
    const bad = await run("github", { GITHUB_TOKEN: "ghp_x" }, { "api.github.com/user": { status: 401, body: { message: "Bad credentials" } } });
    expect(bad.ok).toBe(false);
    expect(bad.detail).toMatch(/rejected/);
  });

  it("sends the right auth header for linear (raw key) and others (Bearer)", async () => {
    const s = stub({ "api.linear.app": { body: { data: { viewer: { name: "N" }, organization: { name: "O" } } } }, "api.groq.com": { body: { data: [{ id: "whisper-large-v3" }] } } });
    await checkService(findService("linear"), { LINEAR_API_KEY: "lin_api_x" }, s);
    await checkService(findService("groq"), { GROQ_API_KEY: "gsk_x" }, s);
    expect(s.calls[0].init.headers.authorization).toBe("lin_api_x");
    expect(s.calls[1].init.headers.authorization).toBe("Bearer gsk_x");
  });

  it("slack reports its own error code", async () => {
    const r = await run("slack", { SLACK_BOT_TOKEN: "xoxb-1" }, { "auth.test": { body: { ok: false, error: "invalid_auth" } } });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/invalid_auth/);
    expect((await run("slack", { SLACK_BOT_TOKEN: "x" }, { "auth.test": { body: { ok: true, team: "T", user: "u" } } })).detail).toBe("workspace T, bot u");
  });

  it("telegram", async () => {
    const ok = await run("telegram", { TELEGRAM_BOT_TOKEN: "1:abc", TELEGRAM_CHAT_ID: "5" }, { getMe: { body: { ok: true, result: { username: "causlybot" } } } });
    expect(ok.detail).toBe("bot @causlybot");
    const bad = await run("telegram", { TELEGRAM_BOT_TOKEN: "1:abc" }, { getMe: { status: 401, body: { ok: false, description: "Unauthorized" } } });
    expect(bad.ok).toBe(false);
  });

  it("groq notes whether Whisper is available", async () => {
    expect((await run("groq", { GROQ_API_KEY: "k" }, { "api.groq.com": { body: { data: [{ id: "llama" }] } } })).detail).toBe("key works");
    expect((await run("groq", { GROQ_API_KEY: "k" }, { "api.groq.com": { body: { data: [{ id: "whisper-large-v3-turbo" }] } } })).detail).toMatch(/Whisper/);
  });

  it("stripe says test or LIVE", async () => {
    const routes = { "api.stripe.com": { body: { id: "acct_1" } } };
    expect((await run("stripe", { STRIPE_API_KEY: "sk_test_1" }, routes)).detail).toBe("test mode account acct_1");
    expect((await run("stripe", { STRIPE_API_KEY: "sk_live_1" }, routes)).detail).toMatch(/^LIVE/);
  });

  it("sentry tries the EU host when the first one says no", async () => {
    let n = 0;
    const r = await run("sentry", { SENTRY_AUTH_TOKEN: "t" }, { "sentry.io/api/0/organizations": () => (++n === 1 ? { status: 404 } : { body: [{}, {}] }) });
    expect(r).toMatchObject({ ok: true, detail: "2 organization(s) on de.sentry.io" });
  });

  describe("google", () => {
    const env = { CALENDAR_REFRESH_TOKEN: "r", GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "sec" };
    const token = (body, status = 200) => ({ "oauth2.googleapis.com/token": { status, body } });

    it("accepts a token with both calendar scopes, and reuses the Gmail client", async () => {
      const s = stub(token({ access_token: "a", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly" }));
      const r = await checkService(findService("calendar"), env, s);
      expect(r.ok).toBe(true);
      expect(String(s.calls[0].init.body)).toContain("client_id=cid");
    });

    it("names the scope that is missing", async () => {
      const r = await run("calendar", env, token({ access_token: "a", scope: "https://www.googleapis.com/auth/calendar.events" }));
      expect(r.ok).toBe(false);
      expect(r.detail).toMatch(/missing: calendar\.readonly/);
    });

    it("explains an expired token (Testing-mode apps)", async () => {
      const r = await run("calendar", env, token({ error: "invalid_grant" }, 400));
      expect(r.detail).toMatch(/7 days/);
    });

    it("asks for the client id when none is set", async () => {
      const r = await run("calendar", { CALENDAR_REFRESH_TOKEN: "r" }, token({}));
      expect(r.detail).toMatch(/CALENDAR_CLIENT_ID/);
    });

    it("gmail needs some gmail scope", async () => {
      const e = { GMAIL_CLIENT_ID: "c", GMAIL_CLIENT_SECRET: "s", GMAIL_REFRESH_TOKEN: "r" };
      expect((await run("gmail", e, token({ access_token: "a", scope: "https://www.googleapis.com/auth/gmail.send" }))).ok).toBe(true);
      expect((await run("gmail", e, token({ access_token: "a", scope: "openid" }))).ok).toBe(false);
    });
  });

  it("never leaks the key in an error and survives a network failure", async () => {
    const r = await run("linear", { LINEAR_API_KEY: "lin_api_SECRET" }, { "api.linear.app": new Error("boom lin_api_SECRET") });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/Could not reach api\.linear\.app/);
    expect(r.detail).not.toContain("lin_api_SECRET");
  });
});
