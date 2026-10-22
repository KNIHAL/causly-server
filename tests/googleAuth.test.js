import { describe, it, expect, afterEach, vi } from "vitest";
import { googleCredentials, getAccessToken, clearTokenCache } from "../tools/googleAuth.js";

afterEach(() => clearTokenCache());

const spec = { refreshTokenEnv: "R", clientIdEnvs: ["A_ID", "B_ID"], clientSecretEnvs: ["A_SECRET", "B_SECRET"] };

describe("googleCredentials", () => {
  it("uses the first variable that is set", () => {
    expect(googleCredentials(spec, { R: "r", B_ID: "b", A_SECRET: "a", B_SECRET: "b2" })).toEqual({ client_id: "b", client_secret: "a", refresh_token: "r" });
    expect(googleCredentials(spec, { R: "r", A_ID: "a", B_ID: "b", A_SECRET: "s" }).client_id).toBe("a");
  });

  it("lists everything that is missing", () => {
    expect(() => googleCredentials(spec, {})).toThrow(/A_ID or B_ID, A_SECRET or B_SECRET, R/);
  });
});

describe("getAccessToken", () => {
  const creds = { client_id: "id", client_secret: "secret", refresh_token: "refresh" };
  const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) }));

  it("exchanges the refresh token and caches the result until shortly before expiry", async () => {
    const f = okFetch();
    let now = 1_000_000;
    expect(await getAccessToken(creds, { fetch: f, now: () => now })).toBe("tok");
    expect(f.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    const body = f.mock.calls[0][1].body;
    expect(Object.fromEntries(body)).toEqual({ client_id: "id", client_secret: "secret", refresh_token: "refresh", grant_type: "refresh_token" });

    now += 3_000_000; // 50 minutes later: still valid
    await getAccessToken(creds, { fetch: f, now: () => now });
    expect(f).toHaveBeenCalledTimes(1);

    now += 600_000; // within a minute of expiry: refresh
    await getAccessToken(creds, { fetch: f, now: () => now });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("explains a failed exchange", async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Token has been expired or revoked." }) }));
    await expect(getAccessToken(creds, { fetch: bad })).rejects.toThrow(/invalid_grant: Token has been expired or revoked/);
  });
});
