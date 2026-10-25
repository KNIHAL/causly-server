// One list of every service the server can talk to: which settings it needs, where to get the key,
// and a cheap live check. `setup`, `keys`, `doctor --test` and the "key missing" hints all read this.
//
// A check is async (env, { fetch }) => { detail } and throws an Error with a plain message when
// something is wrong. Checks only read from the service; they never change anything.

const TIMEOUT_MS = 10_000;

const scrub = (msg, env, names) => {
  let out = String(msg);
  for (const n of names) if (env[n] && String(env[n]).length >= 6) out = out.split(env[n]).join("[REDACTED]"); // very short values are not secrets and would mangle the text
  return out;
};

async function call(fetchFn, url, init = {}) {
  let res;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`Could not reach ${new URL(url).host}: ${err.message}`);
  }
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

const rejected = (status, what = "the key") => {
  if (status === 401) return new Error(`The service rejected ${what} (401). Check that it was copied completely and has not been revoked.`);
  if (status === 403) return new Error(`${what[0].toUpperCase()}${what.slice(1)} is valid but lacks permission (403). Check its scopes.`);
  return null;
};

const bearer = (token) => ({ authorization: `Bearer ${token}` });

/** Google refresh-token check, shared by Gmail and Calendar. */
async function googleCheck(env, { fetch: f }, { tokenName, idNames, secretNames, scopeAll, scopeAny }) {
  const pick = (names) => names.map((n) => env[n]).find(Boolean);
  const clientId = pick(idNames);
  const clientSecret = pick(secretNames);
  if (!clientId || !clientSecret) throw new Error(`Needs ${idNames[0]} and ${secretNames[0]} too.`);
  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: env[tokenName], grant_type: "refresh_token" });
  const { res, body } = await call(f, "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  if (!res.ok) {
    if (body.error === "invalid_grant") throw new Error("Google says the refresh token is expired or revoked. If your Google Cloud app is in Testing mode, tokens expire after 7 days: publish the app, then create a new token.");
    if (body.error === "invalid_client") throw new Error("Google rejected the client id or secret.");
    throw new Error(`Google error: ${body.error_description || body.error || `HTTP ${res.status}`}`);
  }
  const scope = String(body.scope || "");
  if (scope) {
    const missing = (scopeAll || []).filter((s) => !scope.includes(s));
    if (missing.length) throw new Error(`The token works but is missing: ${missing.join(", ")}. Authorize again with all the scopes listed in the steps.`);
    if (scopeAny && !scopeAny.some((s) => scope.includes(s))) throw new Error(`The token works but has none of the needed scopes (${scopeAny.join(", ")}).`);
  }
  return { detail: "token refreshes and has the right scopes" };
}

export const SERVICES = [
  {
    id: "github",
    name: "GitHub",
    env: [{ name: "GITHUB_TOKEN", secret: true }],
    url: "https://github.com/settings/tokens?type=beta",
    steps: ["Create a fine-grained token.", "Give it Contents, Issues and Pull requests (read and write). Add Administration only if you want repo create/delete."],
    check: async (env, { fetch: f }) => {
      const { res, body } = await call(f, "https://api.github.com/user", { headers: { ...bearer(env.GITHUB_TOKEN), "user-agent": "causly-server", accept: "application/vnd.github+json" } });
      if (!res.ok) throw rejected(res.status) || new Error(`GitHub error: ${body.message || res.status}`);
      return { detail: `signed in as ${body.login}` };
    },
  },
  {
    id: "slack",
    name: "Slack",
    env: [{ name: "SLACK_BOT_TOKEN", secret: true }],
    url: "https://api.slack.com/apps",
    steps: ["Create an app, open OAuth & Permissions.", "Add bot scopes: channels:read, channels:history, groups:read, groups:history, chat:write, users:read.", "Install to the workspace and copy the Bot token (xoxb-...)."],
    check: async (env, { fetch: f }) => {
      const { body } = await call(f, "https://slack.com/api/auth.test", { method: "POST", headers: bearer(env.SLACK_BOT_TOKEN) });
      if (!body.ok) throw new Error(`Slack says: ${body.error || "unknown error"}${body.error === "invalid_auth" ? " (check the token)" : ""}`);
      return { detail: `workspace ${body.team}, bot ${body.user}` };
    },
  },
  {
    id: "gmail",
    name: "Gmail",
    env: [{ name: "GMAIL_CLIENT_ID", secret: false }, { name: "GMAIL_CLIENT_SECRET", secret: true }, { name: "GMAIL_REFRESH_TOKEN", secret: true }],
    url: "https://developers.google.com/oauthplayground",
    steps: [
      "In console.cloud.google.com enable the Gmail API, set up the OAuth consent screen and create an OAuth client (Desktop app).",
      "In OAuth Playground (gear icon: use your own credentials) authorize gmail.readonly, gmail.send, gmail.modify.",
      "Exchange the code and copy the Refresh token.",
    ],
    check: (env, deps) => googleCheck(env, deps, { tokenName: "GMAIL_REFRESH_TOKEN", idNames: ["GMAIL_CLIENT_ID"], secretNames: ["GMAIL_CLIENT_SECRET"], scopeAny: ["gmail", "mail.google.com"] }),
  },
  {
    id: "calendar",
    name: "Google Calendar",
    env: [
      { name: "CALENDAR_REFRESH_TOKEN", secret: true },
      { name: "CALENDAR_CLIENT_ID", secret: false, optional: true, note: "Only if different from the Gmail client" },
      { name: "CALENDAR_CLIENT_SECRET", secret: true, optional: true, note: "Only if different from the Gmail client" },
      { name: "CAUSLY_TIMEZONE", secret: false, optional: true, note: "e.g. Asia/Kolkata (default: this computer's zone)" },
    ],
    url: "https://developers.google.com/oauthplayground",
    steps: [
      "Enable the Google Calendar API in the same Google Cloud project as Gmail.",
      "In OAuth Playground (your own credentials) authorize BOTH https://www.googleapis.com/auth/calendar.events and https://www.googleapis.com/auth/calendar.readonly.",
      "Exchange the code and copy the Refresh token.",
      "The Gmail client id and secret are reused unless you set CALENDAR_CLIENT_ID and CALENDAR_CLIENT_SECRET.",
    ],
    check: (env, deps) =>
      googleCheck(env, deps, {
        tokenName: "CALENDAR_REFRESH_TOKEN",
        idNames: ["CALENDAR_CLIENT_ID", "GMAIL_CLIENT_ID"],
        secretNames: ["CALENDAR_CLIENT_SECRET", "GMAIL_CLIENT_SECRET"],
        scopeAll: ["calendar.events", "calendar.readonly"],
      }),
  },
  {
    id: "telegram",
    name: "Telegram",
    env: [{ name: "TELEGRAM_BOT_TOKEN", secret: true }, { name: "TELEGRAM_CHAT_ID", secret: false, discover: true, note: "Found automatically after you message the bot" }],
    url: "https://t.me/BotFather",
    steps: ["In Telegram open @BotFather, send /newbot, pick a name and username.", "Copy the token it gives you.", "Then open your new bot and press Start so it can see your chat."],
    check: async (env, { fetch: f }) => {
      const { res, body } = await call(f, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
      if (!res.ok || !body.ok) throw new Error(res.status === 401 || res.status === 404 ? "Telegram rejected the bot token (check it was copied completely)." : `Telegram error: ${body.description || res.status}`);
      return { detail: `bot @${body.result.username}` };
    },
  },
  {
    id: "linear",
    name: "Linear",
    env: [{ name: "LINEAR_API_KEY", secret: true }],
    url: "https://linear.app/settings/account/security",
    steps: ["Settings, Account, Security & access, Personal API keys.", "Create a key and copy it (starts with lin_api_)."],
    check: async (env, { fetch: f }) => {
      const { res, body } = await call(f, "https://api.linear.app/graphql", { method: "POST", headers: { authorization: env.LINEAR_API_KEY, "content-type": "application/json" }, body: JSON.stringify({ query: "{ viewer { name } organization { name } }" }) });
      if (!res.ok || body.errors) throw rejected(res.status) || new Error(`Linear error: ${body.errors?.[0]?.message || res.status}`);
      return { detail: `${body.data.viewer.name} in ${body.data.organization.name}` };
    },
  },
  {
    id: "groq",
    name: "Groq (meeting transcription)",
    env: [
      { name: "GROQ_API_KEY", secret: true },
      { name: "GROQ_WHISPER_MODEL", secret: false, optional: true, note: "default whisper-large-v3-turbo" },
      { name: "GROQ_MAX_FILE_MB", secret: false, optional: true, note: "25 on the free tier" },
    ],
    url: "https://console.groq.com/keys",
    steps: ["Create a free account and an API key.", "Recordings are uploaded to Groq only when you confirm a transcription."],
    check: async (env, { fetch: f }) => {
      const { res, body } = await call(f, "https://api.groq.com/openai/v1/models", { headers: bearer(env.GROQ_API_KEY) });
      if (!res.ok) throw rejected(res.status) || new Error(`Groq error: ${body.error?.message || res.status}`);
      const whisper = (body.data || []).some((m) => /whisper/i.test(m.id));
      return { detail: whisper ? "key works, Whisper available" : "key works" };
    },
  },
  {
    id: "stripe",
    name: "Stripe",
    env: [{ name: "STRIPE_API_KEY", secret: true }, { name: "STRIPE_ALLOW_LIVE", secret: false, optional: true, note: "true allows live keys; leave unset while testing" }, { name: "STRIPE_DEFAULT_CURRENCY", secret: false, optional: true, note: "e.g. usd" }],
    url: "https://dashboard.stripe.com/test/apikeys",
    steps: ["Turn on Test mode in the dashboard, open Developers, API keys.", "Copy the secret key (sk_test_...) or a restricted key (rk_test_...). Live keys are refused unless STRIPE_ALLOW_LIVE=true."],
    check: async (env, { fetch: f }) => {
      const { res, body } = await call(f, "https://api.stripe.com/v1/account", { headers: bearer(env.STRIPE_API_KEY) });
      if (!res.ok) throw rejected(res.status) || new Error(`Stripe error: ${body.error?.message || res.status}`);
      const live = /_live_/.test(env.STRIPE_API_KEY);
      return { detail: `${live ? "LIVE" : "test"} mode account ${body.id}` };
    },
  },
  {
    id: "discord",
    name: "Discord",
    env: [{ name: "DISCORD_BOT_TOKEN", secret: true }],
    url: "https://discord.com/developers/applications",
    steps: ["New Application, Bot, Reset Token, copy the token.", "Turn on Message Content Intent on the Bot page.", "OAuth2, URL Generator: scope bot with View Channels, Read Message History, Send Messages; open the URL to invite the bot."],
    check: async (env, { fetch: f }) => {
      const { res, body } = await call(f, "https://discord.com/api/v10/users/@me", { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
      if (!res.ok) throw rejected(res.status, "the bot token") || new Error(`Discord error: ${body.message || res.status}`);
      return { detail: `bot ${body.username}` };
    },
  },
  {
    id: "notion",
    name: "Notion",
    env: [{ name: "NOTION_API_KEY", secret: true }],
    url: "https://www.notion.so/my-integrations",
    steps: ["Create an integration and copy its secret.", "In Notion open each page or database you want available, then ... , Connections, add the integration. Unshared pages stay invisible."],
    check: async (env, { fetch: f }) => {
      const { res, body } = await call(f, "https://api.notion.com/v1/users/me", { headers: { ...bearer(env.NOTION_API_KEY), "notion-version": "2022-06-28" } });
      if (!res.ok) throw rejected(res.status) || new Error(`Notion error: ${body.message || res.status}`);
      return { detail: `integration ${body.name || body.id}` };
    },
  },
  {
    id: "sentry",
    name: "Sentry",
    env: [{ name: "SENTRY_AUTH_TOKEN", secret: true }],
    url: "https://sentry.io/settings/account/api/auth-tokens/",
    steps: ["Create an auth token with project:read and event:read (add event:write to resolve, ignore or comment on issues)."],
    check: async (env, { fetch: f }) => {
      let last;
      for (const host of ["sentry.io", "de.sentry.io"]) {
        const { res, body } = await call(f, `https://${host}/api/0/organizations/`, { headers: bearer(env.SENTRY_AUTH_TOKEN) });
        if (res.ok) return { detail: `${(body || []).length} organization(s) on ${host}` };
        last = res.status;
        if (res.status === 401 || res.status === 403) break;
      }
      throw rejected(last) || new Error(`Sentry error: HTTP ${last}`);
    },
  },
  {
    id: "vercel",
    name: "Vercel",
    env: [{ name: "VERCEL_TOKEN", secret: true }],
    url: "https://vercel.com/account/tokens",
    steps: ["Create a token and copy it."],
    check: async (env, { fetch: f }) => {
      const { res, body } = await call(f, "https://api.vercel.com/v2/user", { headers: bearer(env.VERCEL_TOKEN) });
      if (!res.ok) throw rejected(res.status) || new Error(`Vercel error: ${body.error?.message || res.status}`);
      return { detail: `signed in as ${body.user?.username || body.user?.email}` };
    },
  },
  {
    id: "supabase",
    name: "Supabase",
    env: [{ name: "SUPABASE_ACCESS_TOKEN", secret: true }],
    url: "https://supabase.com/dashboard/account/tokens",
    steps: ["Create an access token and copy it."],
    check: async (env, { fetch: f }) => {
      const { res, body } = await call(f, "https://api.supabase.com/v1/projects", { headers: bearer(env.SUPABASE_ACCESS_TOKEN) });
      if (!res.ok) throw rejected(res.status) || new Error(`Supabase error: ${body.message || res.status}`);
      return { detail: `${Array.isArray(body) ? body.length : 0} project(s)` };
    },
  },
];

export const findService = (ref, services = SERVICES) => {
  const s = String(ref ?? "").trim().toLowerCase();
  return services.find((x) => x.id === s || x.name.toLowerCase() === s || x.name.toLowerCase().startsWith(`${s} `));
};

export const requiredNames = (svc) => svc.env.filter((v) => !v.optional).map((v) => v.name);
export const allNames = (services = SERVICES) => services.flatMap((s) => s.env.map((v) => v.name));

/** configured: every required setting present. incomplete: some but not all. */
export function serviceState(svc, env = process.env) {
  const req = requiredNames(svc);
  const have = req.filter((n) => env[n]);
  return { configured: have.length === req.length, incomplete: have.length > 0 && have.length < req.length, missing: req.filter((n) => !env[n]) };
}

/** Run a service's live check. Never throws; the message has secrets removed. */
export async function checkService(svc, env = process.env, deps = {}) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  try {
    const r = await svc.check(env, { fetch: fetchFn });
    return { id: svc.id, name: svc.name, ok: true, detail: r.detail };
  } catch (err) {
    return { id: svc.id, name: svc.name, ok: false, detail: scrub(err.message, env, svc.env.map((v) => v.name)) };
  }
}

/** When a tool error mentions one of a service's settings, say how to fix it. */
export function setupHint(message, services = SERVICES) {
  const text = String(message ?? "");
  const svc = services.find((s) => s.env.some((v) => !v.optional && text.includes(v.name)));
  return svc ? `Fix: run "causly-server setup ${svc.id}" in a terminal. New keys are picked up on the next tool call.` : null;
}
