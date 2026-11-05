// Failure-path tests for GitHub, Gmail, Calendar, Slack and Telegram (P1-08).
// Each service has one recorded-fixture file in tests/fixtures/errors/. Every case is replayed
// through the real tool code with real Response objects, and must produce one clear message with the
// fix, never a stack trace, an HTML page, a parser error or a secret.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", "errors", `${name}.json`), "utf8"));

const REQUIRED = ["401", "403_scope", "403_rate_limit", "404", "429", "5xx", "timeout", "network", "malformed_json"];
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function makeResponse(r) {
  const raw = r.rawBody ?? JSON.stringify(r.body ?? {});
  const headers = {};
  for (const [k, v] of Object.entries(r.headers ?? {})) headers[k] = v === "SOON_60" ? String(Math.floor(Date.now() / 1000) + 60) : v;
  return new Response(raw, { status: r.status, headers });
}

function thrower(kind) {
  if (kind === "TimeoutError") return Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  return Object.assign(new TypeError("fetch failed"), { cause: { code: kind } });
}

/** A fetch that answers the token endpoint (Google services) and replays `apiCase` for everything else. */
function replayFetch(apiCase, { tokenCase } = {}) {
  return vi.fn(async (url) => {
    if (String(url).startsWith(TOKEN_URL)) {
      if (tokenCase) return makeResponse(tokenCase);
      return makeResponse({ status: 200, body: { access_token: "ya29.ACCESSTOKEN", expires_in: 3600 } });
    }
    if (apiCase.throws) throw thrower(apiCase.throws);
    return makeResponse(apiCase.response);
  });
}

const SERVICES = {
  github: {
    env: { GITHUB_TOKEN: "ghp_SECRETTOKEN123" },
    async run(c) {
      global.fetch = replayFetch(c);
      const m = await import("../tools/githubOps.js");
      return m.githubGetAuthenticatedUser();
    },
  },
  gmail: {
    env: { GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "csecret", GMAIL_REFRESH_TOKEN: "test-refresh-token" },
    async run(c) {
      global.fetch = replayFetch(c, { tokenCase: c.tokenResponse });
      const m = await import("../tools/gmailOps.js");
      return m.gmailGetProfile();
    },
  },
  calendar: {
    env: { CALENDAR_REFRESH_TOKEN: "rt", GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "csecret" },
    async run(c) {
      const { clearTokenCache } = await import("../tools/googleAuth.js");
      clearTokenCache();
      const cal = await import("../tools/calendarOps.js");
      return cal.listCalendars({}, { fetch: replayFetch(c, { tokenCase: c.tokenResponse }), now: () => Date.now() });
    },
  },
  slack: {
    env: { SLACK_BOT_TOKEN: "xoxb-test" },
    async run(c) {
      global.fetch = replayFetch(c);
      const m = await import("../tools/slackOps.js");
      return m.slackGetUser({ user_id: "U1" });
    },
  },
  telegram: {
    env: { TELEGRAM_BOT_TOKEN: "123456:SECRET-abc" },
    async run(c) {
      const tg = await import("../tools/telegramOps.js");
      return tg.getMe({}, { fetch: replayFetch(c) });
    },
  },
};

const saved = { ...process.env };
const savedFetch = global.fetch;
beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  global.fetch = savedFetch;
});

function assertClean(message, secrets) {
  expect(message).not.toMatch(/\n\s+at /); // no stack
  expect(message).not.toMatch(/<\s*(html|body|!doctype)/i); // no error page
  expect(message).not.toMatch(/Unexpected token|SyntaxError|is not valid JSON|JSON\.parse|\[object Object\]/); // no parser noise
  expect(message).not.toMatch(/undefined|NaN/);
  expect(message.length).toBeLessThan(600);
  for (const s of secrets) expect(message).not.toContain(s);
}

for (const [service, runner] of Object.entries(SERVICES)) {
  describe(`${service}: failure paths`, () => {
    const fx = fixture(service);

    it("has a recorded fixture for every failure class", () => {
      expect(fx.service).toBe(service);
      for (const cls of REQUIRED) expect(Object.keys(fx.cases), `missing ${cls}`).toContain(cls);
    });

    for (const [name, c] of Object.entries(fx.cases)) {
      it(`${name}: clear message, the fix, no stack or secret`, async () => {
        Object.assign(process.env, runner.env);
        let error;
        try {
          await runner.run(c);
        } catch (e) {
          error = e;
        }
        expect(error, "the call should fail").toBeInstanceOf(Error);
        expect(error.message).toMatch(new RegExp(c.match, "s"));
        assertClean(error.message, fx.secrets);
      });
    }
  });
}

describe("pagination", () => {
  it("GitHub: a failure on page 2 of the issue list is reported clearly", async () => {
    process.env.GITHUB_TOKEN = "ghp_SECRETTOKEN123";
    const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `t${i}`, state: "open", html_url: "u" }));
    const fx = fixture("github").cases;
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      return call === 1 ? makeResponse({ status: 200, body: page1 }) : makeResponse(fx["5xx"].response);
    });
    const { githubListIssues } = await import("../tools/githubOps.js");
    await expect(githubListIssues({ owner: "o", repo: "r", per_page: 150 })).rejects.toThrow(/having problems \(HTTP 502\)/);
    expect(call).toBe(2);
  });

  it("GitHub: a rate limit on page 2 says how long to wait", async () => {
    process.env.GITHUB_TOKEN = "ghp_SECRETTOKEN123";
    const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `t${i}`, state: "open", html_url: "u" }));
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      return call === 1 ? makeResponse({ status: 200, body: page1 }) : makeResponse(fixture("github").cases["429"].response);
    });
    const { githubListIssues } = await import("../tools/githubOps.js");
    await expect(githubListIssues({ owner: "o", repo: "r", per_page: 150 })).rejects.toThrow(/Try again in 42s/);
  });

  it("GitHub: pages are followed until the list ends", async () => {
    process.env.GITHUB_TOKEN = "ghp_SECRETTOKEN123";
    const full = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: "t", state: "open", html_url: "u" }));
    const last = [{ number: 101, title: "t", state: "open", html_url: "u" }];
    let call = 0;
    global.fetch = vi.fn(async () => makeResponse({ status: 200, body: ++call === 1 ? full : last }));
    const { githubListIssues } = await import("../tools/githubOps.js");
    const r = await githubListIssues({ owner: "o", repo: "r", per_page: 150 });
    expect(r.issues).toHaveLength(101);
    expect(call).toBe(2);
  });

  it("Slack: a rate limit on page 2 of the channel list is reported clearly", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    let call = 0;
    global.fetch = vi.fn(async () => {
      call++;
      return call === 1
        ? makeResponse({ status: 200, body: { ok: true, channels: [{ id: "C1", name: "general" }], response_metadata: { next_cursor: "c2" } } })
        : makeResponse(fixture("slack").cases["429"].response);
    });
    const { slackListChannels } = await import("../tools/slackOps.js");
    await expect(slackListChannels({ limit: 300 })).rejects.toThrow(/rate limit reached \(429\). Try again in 8s/);
    expect(call).toBe(2);
  });

  it("Slack: pages are followed by cursor until the list ends", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      const next = new URL(url).searchParams.get("cursor");
      return makeResponse({
        status: 200,
        body: next
          ? { ok: true, channels: [{ id: "C2", name: "random" }], response_metadata: { next_cursor: "" } }
          : { ok: true, channels: [{ id: "C1", name: "general" }], response_metadata: { next_cursor: "c2" } },
      });
    });
    const { slackListChannels } = await import("../tools/slackOps.js");
    const r = await slackListChannels({ limit: 300 });
    expect(r.channels.map((c) => c.id)).toEqual(["C1", "C2"]);
  });
});

describe("a failed call through the tool wrapper", () => {
  it("returns Error: plus the message, with no stack and the fix line once", async () => {
    process.env.GITHUB_TOKEN = "ghp_SECRETTOKEN123";
    global.fetch = vi.fn(async () => makeResponse(fixture("github").cases["401"].response));
    const { githubGetAuthenticatedUser } = await import("../tools/githubOps.js");
    const { createToolWrapper } = await import("../tools/toolWrapper.js");
    const wrap = createToolWrapper({
      envRefresher: () => {},
      activityLogger: () => {},
      receiptEmitter: () => {},
      approvalCheck: async () => ({ allowed: true }),
      workspaceCheck: async () => ({ allowed: true }),
    });
    const out = await wrap("github_get_authenticated_user", githubGetAuthenticatedUser)({});
    expect(out.isError).toBe(true);
    const text = out.content[0].text;
    expect(text).toMatch(/^Error: GitHub rejected the credentials \(401\)/);
    expect((text.match(/causly-server setup github/g) ?? []).length).toBe(1);
    assertClean(text, ["ghp_SECRETTOKEN123"]);
  });
});
