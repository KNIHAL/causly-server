// `causly-server login google`: sign in with the browser instead of copying tokens by hand.
//
// A tiny web server on 127.0.0.1 (random port) receives Google's redirect, the code is exchanged for a
// refresh token, and the token is saved to the settings file and checked live. One sign-in can cover
// Gmail, Calendar and Search Console, so the user clicks Allow once.
import http from "http";
import { execFile } from "child_process";
import os from "os";
import { randomBytes } from "crypto";
import { setEnvValue } from "./envFile.js";
import { envWritePath } from "./paths.js";
import { findService, checkService } from "./services.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = (s) => `https://www.googleapis.com/auth/${s}`;

export const GOOGLE_TARGETS = {
  gmail: { label: "Gmail", tokenEnv: "GMAIL_REFRESH_TOKEN", scopes: ["gmail.readonly", "gmail.send", "gmail.modify"].map(SCOPE), overrides: [] },
  calendar: { label: "Google Calendar", tokenEnv: "CALENDAR_REFRESH_TOKEN", scopes: ["calendar.events", "calendar.readonly"].map(SCOPE), overrides: ["CALENDAR_CLIENT_ID", "CALENDAR_CLIENT_SECRET"] },
  gsc: { label: "Google Search Console", tokenEnv: "GSC_REFRESH_TOKEN", scopes: [SCOPE("webmasters.readonly")], overrides: ["GSC_CLIENT_ID", "GSC_CLIENT_SECRET"] },
};

export const DEFAULT_GOOGLE_TARGETS = ["gmail", "calendar"];

const CLIENT_SETUP_STEPS = [
  "Open console.cloud.google.com, create a project (or pick one) and enable the Gmail API, Google Calendar API and (optional) Search Console API.",
  "OAuth consent screen: choose External, add your own Google account as a test user. Then press Publish app, otherwise Google expires the token after 7 days.",
  "Credentials, Create credentials, OAuth client ID, type Desktop app. Copy the Client ID and Client secret.",
];

export function parseTargets(value) {
  const names = String(value ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!names.length) return [...DEFAULT_GOOGLE_TARGETS];
  const expanded = names.flatMap((n) => (n === "all" ? Object.keys(GOOGLE_TARGETS) : n === "search-console" ? ["gsc"] : [n]));
  const unknown = expanded.filter((n) => !GOOGLE_TARGETS[n]);
  if (unknown.length) throw new Error(`Unknown Google service: ${unknown.join(", ")}. Choose from: ${Object.keys(GOOGLE_TARGETS).join(", ")}, all.`);
  return [...new Set(expanded)];
}

export function buildAuthUrl({ clientId, redirectUri, scopes, state }) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent", // makes Google return a refresh token every time
    state,
  }).toString();
  return u.toString();
}

const PAGE = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h2>${title}</h2><p>${body}</p></body>`;

/** Local server that waits for Google's redirect. Resolves with the code; rejects on error, wrong state or timeout. */
export function startCallbackServer({ state, timeoutMs = 300_000 } = {}) {
  return new Promise((resolveStart, rejectStart) => {
    let settle;
    const result = new Promise((resolve, reject) => (settle = { resolve, reject }));
    result.catch(() => {}); // the caller awaits it later; avoid an unhandled rejection meanwhile
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      const reply = (status, title, body) => {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(PAGE(title, body));
      };
      if (url.searchParams.get("state") !== state) {
        reply(400, "Wrong request", "This sign-in does not belong to the running causly-server command. Start it again from the terminal.");
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error) {
        reply(200, "Sign-in cancelled", "You can close this tab and return to the terminal.");
        settle.reject(new Error(error === "access_denied" ? "You did not allow access in the browser." : `Google returned an error: ${error}`));
      } else if (code) {
        reply(200, "Signed in", "causly-server is connected. You can close this tab and return to the terminal.");
        settle.resolve(code);
      } else {
        reply(400, "Nothing to do", "No code in the request.");
      }
    });
    const timer = setTimeout(() => settle.reject(new Error("Timed out waiting for the browser sign-in (5 minutes). Run the command again.")), timeoutMs);
    server.on("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      resolveStart({
        redirectUri: `http://127.0.0.1:${server.address().port}`,
        result,
        close: () => {
          clearTimeout(timer);
          server.close();
          server.closeAllConnections?.();
        },
      });
    });
  });
}

export function openBrowser(url, { platform = os.platform(), exec = execFile } = {}) {
  const [cmd, args] =
    platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    exec(cmd, args, { windowsHide: true }, () => {});
  } catch {
    // the URL is printed as well, so the user can open it by hand
  }
}

export async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetch: fetchFn = globalThis.fetch }) {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (body.error === "invalid_client") throw new Error("Google rejected the client id or secret. Check them with: causly-server keys list");
    throw new Error(`Google could not finish the sign-in: ${body.error_description || body.error || `HTTP ${res.status}`}`);
  }
  if (!body.refresh_token) {
    throw new Error("Google did not return a refresh token. Remove causly-server at https://myaccount.google.com/permissions and run the command again.");
  }
  return { refreshToken: body.refresh_token, scope: String(body.scope || "") };
}

const pickFirst = (env, names) => names.map((n) => env[n]).find(Boolean);

/**
 * Sign in to Google and save the refresh token for each chosen service.
 * term: from terminal.js (only needed when the OAuth client id/secret are not saved yet).
 */
export async function runGoogleLogin({
  targets = DEFAULT_GOOGLE_TARGETS,
  term,
  env = process.env,
  file = envWritePath(),
  fetch: fetchFn = globalThis.fetch,
  open = openBrowser,
  timeoutMs,
} = {}) {
  const say = (t = "") => term.write(`${t}\n`);
  const chosen = parseTargets(Array.isArray(targets) ? targets.join(",") : targets);
  const result = { saved: [], not_saved: [], checks: [] };

  // 1. the OAuth client (the app registration), asked for once
  let clientId = pickFirst(env, ["GMAIL_CLIENT_ID", "CALENDAR_CLIENT_ID", "GSC_CLIENT_ID"]);
  let clientSecret = pickFirst(env, ["GMAIL_CLIENT_SECRET", "CALENDAR_CLIENT_SECRET", "GSC_CLIENT_SECRET"]);
  const newClient = {};
  if (!clientId || !clientSecret) {
    say("\nFirst, a Google OAuth client is needed (one time, takes a few minutes):");
    CLIENT_SETUP_STEPS.forEach((s, i) => say(`  ${i + 1}. ${s}`));
    say("  Link: https://console.cloud.google.com/apis/credentials\n");
    if (!clientId) clientId = (await term.line("Client ID: ")).trim();
    if (!clientSecret) clientSecret = (await term.secret("Client secret: ")).trim();
    if (!clientId || !clientSecret) throw new Error("A client id and secret are needed to sign in. Nothing saved.");
    newClient.GMAIL_CLIENT_ID = clientId;
    newClient.GMAIL_CLIENT_SECRET = clientSecret;
  }

  // a service with its own client would get a token that does not match it
  for (const t of chosen) {
    const own = GOOGLE_TARGETS[t].overrides;
    const [oid, osec] = own.map((n) => env[n]);
    if ((oid && oid !== clientId) || (osec && osec !== clientSecret)) {
      throw new Error(`${own[0]} is set to a different OAuth client than the one used for sign-in. Remove ${own.join(" and ")} (causly-server keys unset NAME) to use one client, or sign in for that service separately.`);
    }
  }

  // 2. browser sign-in
  const state = randomBytes(16).toString("hex");
  const server = await startCallbackServer({ state, timeoutMs });
  let code;
  try {
    const scopes = [...new Set(chosen.flatMap((t) => GOOGLE_TARGETS[t].scopes))];
    const url = buildAuthUrl({ clientId, redirectUri: server.redirectUri, scopes, state });
    say(`\nSigning in for: ${chosen.map((t) => GOOGLE_TARGETS[t].label).join(", ")}`);
    say("Your browser should open. If it does not, open this link:\n");
    say(url);
    say("\nGoogle may say the app is not verified: choose Advanced, then continue (it is your own app). Tick every permission box, then press Allow.");
    say("Waiting for you in the browser...");
    open(url);
    code = await server.result;
  } finally {
    server.close();
  }

  // 3. code -> refresh token
  const { refreshToken, scope } = await exchangeCode({ code, clientId, clientSecret, redirectUri: server.redirectUri, fetch: fetchFn });

  // 4. save, for the services whose permissions were all granted
  for (const [name, value] of Object.entries(newClient)) {
    setEnvValue(file, name, value);
    env[name] = value;
  }
  for (const t of chosen) {
    const target = GOOGLE_TARGETS[t];
    const missing = target.scopes.filter((s) => !scope.includes(s));
    if (missing.length) {
      result.not_saved.push({ target: t, missing: missing.map((s) => s.split("/").pop()) });
      say(`\n${target.label}: not saved, you did not allow: ${missing.map((s) => s.split("/").pop()).join(", ")}. Run the command again and tick every box.`);
      continue;
    }
    setEnvValue(file, target.tokenEnv, refreshToken);
    env[target.tokenEnv] = refreshToken;
    result.saved.push(t);
  }

  // 5. live check
  const services = { gmail: "gmail", calendar: "calendar", gsc: "gsc" };
  for (const t of result.saved) {
    const svc = findService(services[t]);
    if (!svc) continue;
    const r = await checkService(svc, env, { fetch: fetchFn });
    result.checks.push(r);
    say(`${r.ok ? "ok  " : "FAIL"}  ${GOOGLE_TARGETS[t].label}: ${r.detail}`);
  }
  if (result.saved.length) say(`\nSaved to ${file}. Running tools pick it up on their next call.`);
  return result;
}
