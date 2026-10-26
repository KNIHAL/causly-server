import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { parseTargets, buildAuthUrl, runGoogleLogin, GOOGLE_TARGETS } from "../tools/googleLogin.js";
import { readEnvValues } from "../tools/envFile.js";
import { setupHint } from "../tools/services.js";

let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-glogin-"));
  file = path.join(dir, ".env");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ALL_GMAIL = GOOGLE_TARGETS.gmail.scopes.join(" ");
const ALL_CAL = GOOGLE_TARGETS.calendar.scopes.join(" ");

function stubTerm(answers = []) {
  const out = [];
  const queue = [...answers];
  return {
    out,
    interactive: true,
    write: (t) => out.push(t),
    line: async () => queue.shift() ?? "",
    secret: async () => queue.shift() ?? "",
    confirm: async () => true,
  };
}

/** Google stub: authorization_code -> refresh token; refresh_token grant -> access token with the same scopes. */
function stubGoogle({ scope, refresh = "1//refresh-token-value", exchangeStatus = 200, exchangeBody } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = new URLSearchParams(String(init.body));
    calls.push(Object.fromEntries(body));
    if (body.get("grant_type") === "authorization_code") {
      const b = exchangeBody ?? { refresh_token: refresh, access_token: "a", scope };
      return new Response(JSON.stringify(b), { status: exchangeStatus });
    }
    return new Response(JSON.stringify({ access_token: "a", expires_in: 3600, scope }), { status: 200 });
  };
  return { fetch, calls };
}

/** Plays the browser: reads the printed sign-in link and calls the local redirect. */
const browser = (params, { first } = {}) => async (url) => {
  const u = new URL(url);
  const redirect = u.searchParams.get("redirect_uri");
  const state = u.searchParams.get("state");
  if (first) await fetch(`${redirect}/?code=nope&state=wrong`); // a stray request must be ignored
  await fetch(`${redirect}/?${new URLSearchParams({ state, ...params })}`);
};

describe("parseTargets", () => {
  it("defaults to Gmail and Calendar, and understands all", () => {
    expect(parseTargets("")).toEqual(["gmail", "calendar"]);
    expect(parseTargets("all")).toEqual(["gmail", "calendar", "gsc"]);
    expect(parseTargets("calendar, search-console")).toEqual(["calendar", "gsc"]);
  });
  it("rejects unknown names", () => {
    expect(() => parseTargets("drive")).toThrow(/Unknown Google service: drive/);
  });
});

describe("buildAuthUrl", () => {
  it("asks for offline access and a fresh consent", () => {
    const u = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:1234", scopes: ["a", "b"], state: "s" }));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toBe("a b");
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:1234");
  });
});

describe("runGoogleLogin", () => {
  it("asks for the client once, signs in, saves one token for both services and checks them", async () => {
    const env = {};
    const term = stubTerm(["client-id-123", "client-secret-456"]);
    const google = stubGoogle({ scope: `${ALL_GMAIL} ${ALL_CAL}` });
    const r = await runGoogleLogin({ targets: ["gmail", "calendar"], term, env, file, fetch: google.fetch, open: browser({ code: "the-code" }, { first: true }) });
    expect(r.saved).toEqual(["gmail", "calendar"]);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    const saved = readEnvValues(file);
    expect(saved.GMAIL_CLIENT_ID).toBe("client-id-123");
    expect(saved.GMAIL_CLIENT_SECRET).toBe("client-secret-456");
    expect(saved.GMAIL_REFRESH_TOKEN).toBe("1//refresh-token-value");
    expect(saved.CALENDAR_REFRESH_TOKEN).toBe("1//refresh-token-value");
    expect(env.CALENDAR_REFRESH_TOKEN).toBe("1//refresh-token-value"); // usable without a restart
    const exchange = google.calls.find((c) => c.grant_type === "authorization_code");
    expect(exchange.code).toBe("the-code");
    expect(exchange.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("does not ask for the client again when it is already saved", async () => {
    const env = { GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "csecret-xyz" };
    const term = stubTerm([]);
    const google = stubGoogle({ scope: ALL_CAL });
    const r = await runGoogleLogin({ targets: ["calendar"], term, env, file, fetch: google.fetch, open: browser({ code: "c" }) });
    expect(r.saved).toEqual(["calendar"]);
    expect(term.out.join("")).not.toMatch(/OAuth client is needed/);
  });

  it("saves only the services whose permissions were all granted", async () => {
    const env = { GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "csecret-xyz" };
    const term = stubTerm();
    const google = stubGoogle({ scope: `${ALL_GMAIL} ${GOOGLE_TARGETS.calendar.scopes[0]}` }); // calendar.readonly unticked
    const r = await runGoogleLogin({ targets: ["gmail", "calendar"], term, env, file, fetch: google.fetch, open: browser({ code: "c" }) });
    expect(r.saved).toEqual(["gmail"]);
    expect(r.not_saved).toEqual([{ target: "calendar", missing: ["calendar.readonly"] }]);
    expect(readEnvValues(file).CALENDAR_REFRESH_TOKEN).toBeUndefined();
  });

  it("explains a denied sign-in and saves nothing", async () => {
    const env = { GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "csecret-xyz" };
    await expect(
      runGoogleLogin({ targets: ["gmail"], term: stubTerm(), env, file, fetch: stubGoogle().fetch, open: browser({ error: "access_denied" }) })
    ).rejects.toThrow(/did not allow access/);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("explains a missing refresh token", async () => {
    const env = { GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "csecret-xyz" };
    const google = stubGoogle({ exchangeBody: { access_token: "a", scope: ALL_GMAIL } });
    await expect(runGoogleLogin({ targets: ["gmail"], term: stubTerm(), env, file, fetch: google.fetch, open: browser({ code: "c" }) })).rejects.toThrow(/did not return a refresh token/);
  });

  it("explains a rejected client", async () => {
    const env = { GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "csecret-xyz" };
    const google = stubGoogle({ exchangeStatus: 401, exchangeBody: { error: "invalid_client" } });
    await expect(runGoogleLogin({ targets: ["gmail"], term: stubTerm(), env, file, fetch: google.fetch, open: browser({ code: "c" }) })).rejects.toThrow(/rejected the client id or secret/);
  });

  it("stops when a service has its own, different OAuth client", async () => {
    const env = { GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "csecret-xyz", CALENDAR_CLIENT_ID: "other", CALENDAR_CLIENT_SECRET: "other-secret" };
    await expect(runGoogleLogin({ targets: ["calendar"], term: stubTerm(), env, file, fetch: stubGoogle().fetch, open: () => {} })).rejects.toThrow(/different OAuth client/);
  });

  it("gives up with a clear message when nobody signs in", async () => {
    const env = { GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "csecret-xyz" };
    await expect(runGoogleLogin({ targets: ["gmail"], term: stubTerm(), env, file, fetch: stubGoogle().fetch, open: () => {}, timeoutMs: 80 })).rejects.toThrow(/Timed out/);
  });

  it("refuses to continue without a client id and secret", async () => {
    await expect(runGoogleLogin({ targets: ["gmail"], term: stubTerm(["", ""]), env: {}, file, fetch: stubGoogle().fetch, open: () => {} })).rejects.toThrow(/client id and secret are needed/);
  });
});

describe("expired Google token hint", () => {
  it("points to login google", () => {
    expect(setupHint("Gmail OAuth refresh error: Token has been expired or revoked.")).toMatch(/causly-server login google/);
    expect(setupHint("Google sign-in failed (invalid_grant: Bad Request).")).toMatch(/causly-server login google/);
  });
});
