// Minimal Google OAuth helper: turns a refresh token into a short-lived access token.
// Used by Google-backed tools that are not Gmail (Search Console now, Calendar later).
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const cache = new Map(); // "clientId:refreshToken" -> { token, expiresAt }

/**
 * Read credentials from the environment. Each client id/secret can come from several
 * variable names (first one set wins), so one OAuth client can serve several tools.
 */
export function googleCredentials({ refreshTokenEnv, clientIdEnvs, clientSecretEnvs }, env = process.env) {
  const pick = (names) => names.map((name) => env[name]).find(Boolean);
  const client_id = pick(clientIdEnvs);
  const client_secret = pick(clientSecretEnvs);
  const refresh_token = env[refreshTokenEnv];
  const missing = [];
  if (!client_id) missing.push(clientIdEnvs.join(" or "));
  if (!client_secret) missing.push(clientSecretEnvs.join(" or "));
  if (!refresh_token) missing.push(refreshTokenEnv);
  if (missing.length) throw new Error(`Google access is not set up. Missing: ${missing.join(", ")}.`);
  return { client_id, client_secret, refresh_token };
}

export async function getAccessToken(creds, { fetch: fetchFn = globalThis.fetch, now = Date.now } = {}) {
  const key = `${creds.client_id}:${creds.refresh_token}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now() + 60_000) return hit.token;

  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const why = [data.error, data.error_description].filter(Boolean).join(": ");
    throw new Error(`Google sign-in failed${why ? ` (${why})` : ""}. Check the client id, client secret and refresh token.`);
  }
  cache.set(key, { token: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

export function clearTokenCache() {
  cache.clear();
}
