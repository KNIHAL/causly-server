import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// gmailOps.js caches the OAuth access token at module scope, so each test
// needs a fresh module instance to avoid leaking cached tokens between
// tests. Dynamically re-import after vi.resetModules() in beforeEach.
let gmailOps;

function tokenRes(accessToken = "access-token-1", expiresIn = 3600, ok = true, errorBody = {}) {
  return Promise.resolve({
    ok,
    json: () =>
      Promise.resolve(ok ? { access_token: accessToken, expires_in: expiresIn } : errorBody),
  });
}

function apiRes(data, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    statusText: "Error",
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.useRealTimers();
  process.env.GMAIL_CLIENT_ID = "test-client-id";
  process.env.GMAIL_CLIENT_SECRET = "test-client-secret";
  process.env.GMAIL_REFRESH_TOKEN = "test-refresh-token";
  global.fetch = vi.fn();
  gmailOps = await import("../tools/gmailOps.js");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.GMAIL_CLIENT_ID;
  delete process.env.GMAIL_CLIENT_SECRET;
  delete process.env.GMAIL_REFRESH_TOKEN;
});

describe("gmailOps — OAuth token handling", () => {
  it("throws if any Gmail credential is missing", async () => {
    delete process.env.GMAIL_REFRESH_TOKEN;
    await expect(gmailOps.gmailGetProfile()).rejects.toThrow(/Gmail credentials not set/);
  });

  it("fetches an access token via refresh_token grant before calling the API", async () => {
    global.fetch
      .mockReturnValueOnce(tokenRes("tok1"))
      .mockReturnValueOnce(apiRes({ emailAddress: "k@x.com", messagesTotal: 1, threadsTotal: 1 }));

    await gmailOps.gmailGetProfile();

    const [tokenUrl, tokenOpts] = global.fetch.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(tokenOpts.method).toBe("POST");
    const params = new URLSearchParams(tokenOpts.body);
    expect(params.get("client_id")).toBe("test-client-id");
    expect(params.get("client_secret")).toBe("test-client-secret");
    expect(params.get("refresh_token")).toBe("test-refresh-token");
    expect(params.get("grant_type")).toBe("refresh_token");

    const [apiUrl, apiOpts] = global.fetch.mock.calls[1];
    expect(apiUrl).toBe("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    expect(apiOpts.headers.Authorization).toBe("Bearer tok1");
  });

  it("throws a formatted error when the OAuth refresh fails", async () => {
    global.fetch.mockReturnValueOnce(
      tokenRes(undefined, undefined, false, { error: "invalid_grant", error_description: "Token has been expired or revoked" })
    );
    await expect(gmailOps.gmailGetProfile()).rejects.toThrow(
      /Gmail OAuth refresh error: Token has been expired or revoked/
    );
  });

  it("reuses the cached access token for a second call within the cache window", async () => {
    global.fetch
      .mockReturnValueOnce(tokenRes("tok1", 3600))
      .mockReturnValueOnce(apiRes({ emailAddress: "k@x.com" }))
      .mockReturnValueOnce(apiRes({ emailAddress: "k@x.com" }));

    await gmailOps.gmailGetProfile();
    await gmailOps.gmailGetProfile();

    // 1 token fetch + 2 API calls = 3 total, not 4 (no second token fetch)
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("refetches the token once the cached one has expired", async () => {
    vi.useFakeTimers();
    global.fetch
      .mockReturnValueOnce(tokenRes("tok1", 60)) // expires in 60s
      .mockReturnValueOnce(apiRes({ emailAddress: "k@x.com" }))
      .mockReturnValueOnce(tokenRes("tok2", 3600))
      .mockReturnValueOnce(apiRes({ emailAddress: "k@x.com" }));

    await gmailOps.gmailGetProfile();
    vi.advanceTimersByTime(61_000); // past expiry (60s - 30s buffer = 30s window)
    await gmailOps.gmailGetProfile();

    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(global.fetch.mock.calls[3][1].headers.Authorization).toBe("Bearer tok2");
  });

  it("throws a formatted Gmail API error using error.message from the body", async () => {
    global.fetch.mockReturnValueOnce(tokenRes()).mockReturnValueOnce(apiRes({ error: { message: "Invalid query" } }, false, 400));
    await expect(gmailOps.gmailSearch({ query: "bad:::query" })).rejects.toThrow(/Gmail API error \(400\): Invalid query/);
  });
});

describe("gmailOps — reads", () => {
  it("gmailGetProfile returns simplified fields", async () => {
    global.fetch
      .mockReturnValueOnce(tokenRes())
      .mockReturnValueOnce(apiRes({ emailAddress: "k@x.com", messagesTotal: 100, threadsTotal: 40, extra: "x" }));
    const result = await gmailOps.gmailGetProfile();
    expect(result).toEqual({ emailAddress: "k@x.com", messagesTotal: 100, threadsTotal: 40 });
  });

  it("gmailSearch URL-encodes the query and maps message ids", async () => {
    global.fetch
      .mockReturnValueOnce(tokenRes())
      .mockReturnValueOnce(apiRes({ messages: [{ id: "m1", threadId: "t1" }] }));
    const result = await gmailOps.gmailSearch({ query: "from:x@y.com is:unread" });
    expect(global.fetch.mock.calls[1][0]).toContain(encodeURIComponent("from:x@y.com is:unread"));
    expect(result.messages).toEqual([{ id: "m1", threadId: "t1" }]);
  });

  it("gmailSearch returns an empty array when there are no messages", async () => {
    global.fetch.mockReturnValueOnce(tokenRes()).mockReturnValueOnce(apiRes({}));
    const result = await gmailOps.gmailSearch({ query: "nothing" });
    expect(result.messages).toEqual([]);
  });

  it("gmailListMessages includes labelIds only when given", async () => {
    global.fetch.mockReturnValueOnce(tokenRes()).mockReturnValueOnce(apiRes({ messages: [] }));
    await gmailOps.gmailListMessages({ label_ids: "INBOX" });
    expect(global.fetch.mock.calls[1][0]).toContain("labelIds=INBOX");

    // Token is cached from the previous call, so only the API response needs queuing.
    global.fetch.mockReturnValueOnce(apiRes({ messages: [] }));
    await gmailOps.gmailListMessages({});
    expect(global.fetch.mock.calls[2][0]).not.toContain("labelIds");
  });

  it("gmailGetMessage extracts headers and decodes a plain-text body", async () => {
    const bodyText = "Hello there!";
    const encoded = Buffer.from(bodyText, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    global.fetch.mockReturnValueOnce(tokenRes()).mockReturnValueOnce(
      apiRes({
        id: "m1",
        threadId: "t1",
        snippet: "Hello...",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: "a@x.com" },
            { name: "To", value: "b@x.com" },
            { name: "Subject", value: "Hi" },
            { name: "Date", value: "Mon, 1 Jan 2024" },
          ],
          body: { data: encoded },
        },
      })
    );
    const result = await gmailOps.gmailGetMessage({ message_id: "m1" });
    expect(result.from).toBe("a@x.com");
    expect(result.subject).toBe("Hi");
    expect(result.body).toBe(bodyText);
  });

  it("gmailGetMessage prefers the text/plain part in a multipart payload", async () => {
    function enc(s) {
      return Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    global.fetch.mockReturnValueOnce(tokenRes()).mockReturnValueOnce(
      apiRes({
        id: "m1",
        threadId: "t1",
        payload: {
          headers: [],
          parts: [
            { mimeType: "text/html", body: { data: enc("<p>HTML</p>") } },
            { mimeType: "text/plain", body: { data: enc("Plain text version") } },
          ],
        },
      })
    );
    const result = await gmailOps.gmailGetMessage({ message_id: "m1" });
    expect(result.body).toBe("Plain text version");
  });

  it("gmailGetMessage returns an empty body when there's no payload data", async () => {
    global.fetch.mockReturnValueOnce(tokenRes()).mockReturnValueOnce(
      apiRes({ id: "m1", threadId: "t1", payload: { headers: [] } })
    );
    const result = await gmailOps.gmailGetMessage({ message_id: "m1" });
    expect(result.body).toBe("");
  });

  it("gmailGetThread maps every message in the thread", async () => {
    function enc(s) {
      return Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    global.fetch.mockReturnValueOnce(tokenRes()).mockReturnValueOnce(
      apiRes({
        id: "t1",
        messages: [
          {
            id: "m1",
            snippet: "s1",
            payload: { headers: [{ name: "From", value: "a@x.com" }], body: { data: enc("body1") } },
          },
          {
            id: "m2",
            snippet: "s2",
            payload: { headers: [{ name: "From", value: "b@x.com" }], body: { data: enc("body2") } },
          },
        ],
      })
    );
    const result = await gmailOps.gmailGetThread({ thread_id: "t1" });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].body).toBe("body1");
    expect(result.messages[1].from).toBe("b@x.com");
  });
});

describe("gmailOps — sending", () => {
  function decodeRaw(raw) {
    return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  }

  it("gmailSend builds a correctly formatted raw MIME message", async () => {
    global.fetch.mockReturnValueOnce(tokenRes()).mockReturnValueOnce(apiRes({ id: "sent1", threadId: "t1" }));
    const result = await gmailOps.gmailSend({ to: "x@y.com", subject: "Hello", body: "Test body", confirm: true });
    const body = JSON.parse(global.fetch.mock.calls[1][1].body);
    const decoded = decodeRaw(body.raw);
    expect(decoded).toContain("To: x@y.com");
    expect(decoded).toContain("Subject: Hello");
    expect(decoded).toContain("Test body");
    expect(result).toEqual({ id: "sent1", threadId: "t1", sent: true });
  });

  it("gmailSend includes Cc/Bcc headers only when given", async () => {
    global.fetch.mockReturnValueOnce(tokenRes()).mockReturnValueOnce(apiRes({ id: "sent2", threadId: "t2" }));
    await gmailOps.gmailSend({ to: "x@y.com", subject: "Hi", body: "b", cc: "cc@y.com", bcc: "bcc@y.com", confirm: true });
    const body = JSON.parse(global.fetch.mock.calls[1][1].body);
    const decoded = decodeRaw(body.raw);
    expect(decoded).toContain("Cc: cc@y.com");
    expect(decoded).toContain("Bcc: bcc@y.com");
  });

  it("gmailReply prefixes subject with 'Re:' and sets In-Reply-To/References", async () => {
    global.fetch
      .mockReturnValueOnce(tokenRes())
      .mockReturnValueOnce(
        apiRes({
          threadId: "t1",
          payload: {
            headers: [
              { name: "From", value: "sender@x.com" },
              { name: "Subject", value: "Original subject" },
              { name: "Message-ID", value: "<msg1@x.com>" },
            ],
          },
        })
      )
      .mockReturnValueOnce(apiRes({ id: "reply1", threadId: "t1" }));

    const result = await gmailOps.gmailReply({ message_id: "m1", body: "reply body", confirm: true });
    const sendBody = JSON.parse(global.fetch.mock.calls[2][1].body);
    const decoded = decodeRaw(sendBody.raw);
    expect(decoded).toContain("To: sender@x.com");
    expect(decoded).toContain("Subject: Re: Original subject");
    expect(decoded).toContain("In-Reply-To: <msg1@x.com>");
    expect(decoded).toContain("References: <msg1@x.com>");
    expect(sendBody.threadId).toBe("t1");
    expect(result.sent).toBe(true);
  });

  it("gmailReply does not double-prefix a subject that already starts with 'Re:'", async () => {
    global.fetch
      .mockReturnValueOnce(tokenRes())
      .mockReturnValueOnce(
        apiRes({
          threadId: "t1",
          payload: {
            headers: [
              { name: "From", value: "sender@x.com" },
              { name: "Subject", value: "Re: Already a reply" },
              { name: "Message-ID", value: "<msg1@x.com>" },
            ],
          },
        })
      )
      .mockReturnValueOnce(apiRes({ id: "reply2", threadId: "t1" }));

    await gmailOps.gmailReply({ message_id: "m1", body: "reply body", confirm: true });
    const sendBody = JSON.parse(global.fetch.mock.calls[2][1].body);
    const decoded = decodeRaw(sendBody.raw);
    expect(decoded).toContain("Subject: Re: Already a reply");
    expect(decoded).not.toContain("Re: Re:");
  });

  it("gmailForward prefixes subject with 'Fwd:' and includes the original message content", async () => {
    function enc(s) {
      return Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    global.fetch
      .mockReturnValueOnce(tokenRes())
      .mockReturnValueOnce(
        apiRes({
          id: "m1",
          threadId: "t1",
          payload: {
            headers: [
              { name: "From", value: "original@x.com" },
              { name: "To", value: "me@x.com" },
              { name: "Subject", value: "Quarterly report" },
              { name: "Date", value: "Mon, 1 Jan 2024" },
            ],
            body: { data: enc("Original message body") },
          },
        })
      )
      .mockReturnValueOnce(apiRes({ id: "fwd1", threadId: "t2" }));

    const result = await gmailOps.gmailForward({ message_id: "m1", to: "new@x.com", note: "FYI", confirm: true });
    const sendBody = JSON.parse(global.fetch.mock.calls[2][1].body);
    const decoded = decodeRaw(sendBody.raw);
    expect(decoded).toContain("To: new@x.com");
    expect(decoded).toContain("Subject: Fwd: Quarterly report");
    expect(decoded).toContain("FYI");
    expect(decoded).toContain("From: original@x.com");
    expect(decoded).toContain("Original message body");
    expect(result.sent).toBe(true);
  });

  it("gmailForward does not double-prefix a subject that already starts with 'Fwd:'", async () => {
    function enc(s) {
      return Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    global.fetch
      .mockReturnValueOnce(tokenRes())
      .mockReturnValueOnce(
        apiRes({
          id: "m1",
          threadId: "t1",
          payload: {
            headers: [{ name: "Subject", value: "Fwd: Already forwarded" }],
            body: { data: enc("body") },
          },
        })
      )
      .mockReturnValueOnce(apiRes({ id: "fwd2", threadId: "t2" }));

    await gmailOps.gmailForward({ message_id: "m1", to: "new@x.com", confirm: true });
    const sendBody = JSON.parse(global.fetch.mock.calls[2][1].body);
    const decoded = decodeRaw(sendBody.raw);
    expect(decoded).toContain("Subject: Fwd: Already forwarded");
    expect(decoded).not.toContain("Fwd: Fwd:");
  });
});
