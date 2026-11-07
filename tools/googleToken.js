// How old the Google sign-in is, so `status` and `doctor` can warn before it stops working.
//
// While a Google OAuth app is in "Testing" status, Google expires its refresh tokens 7 days after
// sign-in. Once the app is published to production they do not expire this way. Causly cannot ask
// Google which status the app has, so it records when each token was saved (NAME_ISSUED in the
// settings file) and warns from day 5. People who have published the app silence the warning with
// CAUSLY_GOOGLE_PUBLISHED=true.

const DAY = 86_400_000;

export const TESTING_LIFETIME_DAYS = 7;
export const WARN_FROM_DAY = 5;

export const GOOGLE_TOKEN_ENVS = {
  GMAIL_REFRESH_TOKEN: "Gmail",
  CALENDAR_REFRESH_TOKEN: "Google Calendar",
  GSC_REFRESH_TOKEN: "Google Search Console",
};

export const isGoogleToken = (name) => Object.hasOwn(GOOGLE_TOKEN_ENVS, name);
export const issuedName = (tokenEnv) => `${tokenEnv}_ISSUED`;
export const markedPublished = (env = process.env) => /^(1|true|yes)$/i.test(String(env.CAUSLY_GOOGLE_PUBLISHED ?? "").trim());

const ageText = (days) => (days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);

/**
 * The saved Google sign-ins whose age is known, one entry per sign-in (Gmail and Calendar are
 * usually the same one). level: "ok", "soon" (day 5 or 6) or "expired" (day 7 or later).
 */
export function googleSignIns({ env = process.env, now = new Date() } = {}) {
  const groups = new Map();
  for (const [tokenEnv, label] of Object.entries(GOOGLE_TOKEN_ENVS)) {
    if (!env[tokenEnv]) continue;
    const issued = Date.parse(env[issuedName(tokenEnv)] ?? "");
    if (!Number.isFinite(issued)) continue; // saved by hand or by an older version: the age is not known
    if (!groups.has(issued)) groups.set(issued, []);
    groups.get(issued).push(label);
  }
  return [...groups].map(([issued, labels]) => {
    const days = Math.max(0, Math.floor((now.getTime() - issued) / DAY));
    const level = days >= TESTING_LIFETIME_DAYS ? "expired" : days >= WARN_FROM_DAY ? "soon" : "ok";
    const left = Math.max(0, TESTING_LIFETIME_DAYS - days);
    const who = `Google sign-in (${labels.join(", ")})`;
    const base = `${who} was saved ${ageText(days)}`;
    const text =
      level === "ok"
        ? `${base}`
        : level === "soon"
          ? `${base}. If your Google app is in Testing status, Google expires it after ${TESTING_LIFETIME_DAYS} days (${left} day${left === 1 ? "" : "s"} left). Publish the app to stop that, or renew with: causly-server login google`
          : `${base}. If your Google app is in Testing status, Google has expired it. Renew with: causly-server login google, and publish the app so it does not happen again.`;
    return { labels, issued: new Date(issued), days, level, text };
  });
}

/** Lines for `status`: only sign-ins that need attention, and none once the app is marked published. */
export function googleWarnings(opts = {}) {
  if (markedPublished(opts.env ?? process.env)) return [];
  return googleSignIns(opts).filter((s) => s.level !== "ok");
}

/** The note printed after `login google`, with the day Testing status would stop it. */
export function loginExpiryNote(now = new Date(), env = process.env) {
  if (markedPublished(env)) return null;
  const until = new Date(now.getTime() + TESTING_LIFETIME_DAYS * DAY).toISOString().slice(0, 10);
  return `If your Google app is in Testing status, this sign-in stops working on ${until}. To avoid renewing every week, publish the app (see the Gmail page in the docs at server.causly.in/docs), then run: causly-server keys set CAUSLY_GOOGLE_PUBLISHED  (enter: true). That also stops these reminders.`;
}
