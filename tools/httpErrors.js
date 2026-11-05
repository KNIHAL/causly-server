// Shared handling for failed calls to outside services (P1-08).
// Every failure class gets one clear sentence that says what happened and the fix, never a stack
// trace, an HTML page or a secret. Causly does not retry on its own: a rate-limit message says how
// long to wait and the caller decides.
import { redactSecretsInString } from "./security.js";

export const SERVICE_INFO = {
  github: {
    label: "GitHub",
    fix: 'causly-server setup github',
    forbidden: "The token is missing a permission for this action (a fine-grained token needs access to the repository, a classic token needs the repo scope).",
  },
  gmail: {
    label: "Gmail",
    fix: 'causly-server login google',
    forbidden: "The Google sign-in is missing a Gmail permission, or the Gmail API is not enabled in your Google Cloud project.",
  },
  calendar: {
    label: "Google Calendar",
    fix: 'causly-server login google',
    forbidden: "The refresh token needs the calendar.events and calendar.readonly scopes, and the Calendar API must be enabled in the Google Cloud project.",
    notFound: "Check the event id and calendar id.",
  },
  google: {
    label: "Google sign-in",
    fix: 'causly-server login google',
  },
  slack: {
    label: "Slack",
    fix: 'causly-server setup slack',
    forbidden: "The Slack app is missing a permission (scope) for this action, or the bot is not in that channel.",
    notFound: "Check the channel or user id, and that the bot can see it.",
  },
  telegram: {
    label: "Telegram",
    fix: 'causly-server setup telegram',
    forbidden: "For a person, they must open the bot and press Start first; for a group or channel, add the bot to it.",
    notFound: "Check the chat id.",
  },
};

const MAX_WHY = 240;

/** Remove secrets, markup and bulk from text that came from a remote service. */
export function scrubRemote(text, secrets = []) {
  let s = String(text ?? "");
  for (const secret of secrets) if (secret) s = s.split(String(secret)).join("[REDACTED]");
  s = redactSecretsInString(s);
  if (/<\s*(html|head|body|!doctype)/i.test(s)) return ""; // an error page, not a message
  s = s.replace(/\s+/g, " ").trim();
  return s.length > MAX_WHY ? `${s.slice(0, MAX_WHY)}...` : s;
}

/** The human message in a service's JSON error body, whatever shape it uses. */
export function whyFrom(data) {
  if (!data || typeof data !== "object") return typeof data === "string" ? data : "";
  const e = data.error;
  return (
    data.message ||
    (e && typeof e === "object" ? e.message : "") ||
    data.error_description ||
    data.description ||
    (typeof e === "string" ? e : "") ||
    ""
  );
}

/** Seconds to wait from a Retry-After header (seconds or an HTTP date), or null. */
export function retryAfterSeconds(value, now = Date.now()) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - now) / 1000));
}

const waitText = (secs) => (secs === null ? "Wait a minute and try again." : `Try again in ${secs}s.`);

/**
 * Run fetch with a timeout and turn a network failure or timeout into a plain message.
 * Resolves with the Response; rejects with an Error that is safe to show.
 */
export async function httpFetch(service, fetchFn, url, init = {}, { timeoutMs = 20_000, secrets = [] } = {}) {
  const label = SERVICE_INFO[service]?.label ?? service;
  try {
    return await fetchFn(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(`${label} did not answer within ${Math.round(timeoutMs / 1000)}s. Try again; if it keeps happening, check your connection or ${label}'s status page.`);
    }
    const code = err?.cause?.code || err?.code || "";
    const why = scrubRemote(code ? `${code}` : err?.message, secrets);
    throw new Error(`Could not reach ${label}${why ? ` (${why})` : ""}. Check your internet connection and try again.`);
  }
}

/** Read a response body as JSON without ever throwing. */
export async function readBody(res) {
  if (typeof res.text !== "function" && typeof res.json === "function") {
    try {
      return { data: await res.json(), text: "", malformed: false };
    } catch {
      return { data: null, text: "", malformed: true };
    }
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    return { data: null, text: "", malformed: true };
  }
  if (!text) return { data: null, text: "", malformed: false };
  try {
    return { data: JSON.parse(text), text, malformed: false };
  } catch {
    return { data: null, text, malformed: true };
  }
}

/** A 2xx reply whose body is not the JSON we expected (a proxy page, a cut-off response). */
export function malformedReply(service, status) {
  const label = SERVICE_INFO[service]?.label ?? service;
  return new Error(`${label} sent a reply that could not be read (HTTP ${status}, not valid JSON). This is usually a proxy or a temporary ${label} problem; try again.`);
}

/**
 * The error for a failed call. `status` is the HTTP status (or the service's own code),
 * `why` the service's message, `retryAfter` seconds when the service said how long to wait.
 * Overrides can replace the 403 and 404 advice.
 */
export function httpFailure(service, { status, why = "", retryAfter = null, rateLimited = false, forbidden, notFound, secrets = [] } = {}) {
  const info = SERVICE_INFO[service] ?? { label: service, fix: "" };
  const label = info.label;
  const reason = scrubRemote(why, secrets);
  const fix = info.fix ? ` Fix: run "${info.fix}" in a terminal.` : "";

  if (status === 401) {
    return new Error(`${label} rejected the credentials (401). The key is wrong, expired or revoked.${fix}`);
  }
  if (status === 429 || rateLimited) {
    return new Error(`${label} rate limit reached${status ? ` (${status})` : ""}. ${waitText(retryAfter)}`);
  }
  if (status === 403) {
    const advice = forbidden ?? info.forbidden ?? "The key does not allow this action.";
    return new Error(`${label} refused the request (403)${reason ? `: ${reason}` : ""}. ${advice}${fix}`);
  }
  if (status === 404) {
    const advice = notFound ?? info.notFound ?? "Check the names and ids; a private item also needs a key that can see it.";
    return new Error(`${label} could not find that (404)${reason ? `: ${reason}` : ""}. ${advice}`);
  }
  if (status >= 500) {
    return new Error(`${label} is having problems (HTTP ${status}). This is on their side; wait a bit and try again.`);
  }
  return new Error(`${label} returned an error${status ? ` (${status})` : ""}${reason ? `: ${reason}` : ""}.`);
}

/** Failure from a non-2xx Response and its parsed body. */
export function failureFromResponse(service, res, body, extra = {}) {
  const h = (name) => res.headers?.get?.(name) ?? null;
  const retryAfter = retryAfterSeconds(h("retry-after"));
  const remaining = h("x-ratelimit-remaining");
  const reset = Number(h("x-ratelimit-reset"));
  const resetIn = Number.isFinite(reset) && reset > 0 ? Math.max(0, Math.ceil(reset - Date.now() / 1000)) : null;
  const why = whyFrom(body.data);
  // GitHub (and some others) answer 403 for a spent rate limit.
  const limited = res.status === 403 && (remaining === "0" || retryAfter !== null || /rate limit|too many requests/i.test(why));
  return httpFailure(service, {
    status: res.status,
    why,
    retryAfter: retryAfter ?? (limited ? resetIn : null),
    rateLimited: limited,
    ...extra,
  });
}
