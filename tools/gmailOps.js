const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cachedAccessToken = null;
let cachedExpiry = 0;

function getCreds() {
  const client_id = process.env.GMAIL_CLIENT_ID;
  const client_secret = process.env.GMAIL_CLIENT_SECRET;
  const refresh_token = process.env.GMAIL_REFRESH_TOKEN;
  if (!client_id || !client_secret || !refresh_token) {
    throw new Error(
      "Gmail credentials not set. Run `npm run setup` to configure them, or add to .env: " +
        "GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN"
    );
  }
  return { client_id, client_secret, refresh_token };
}

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedExpiry - 30000) {
    return cachedAccessToken;
  }
  const { client_id, client_secret, refresh_token } = getCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id,
      client_secret,
      refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gmail OAuth refresh error: ${data.error_description || data.error || res.statusText}`);
  }
  cachedAccessToken = data.access_token;
  cachedExpiry = Date.now() + data.expires_in * 1000;
  return cachedAccessToken;
}

async function gmailFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message = data?.error?.message || res.statusText;
    throw new Error(`Gmail API error (${res.status}): ${message}`);
  }

  return data;
}

function base64UrlEncode(str) {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function extractHeader(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || null;
}

function extractBody(payload) {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === "text/plain") || payload.parts[0];
    if (textPart) return extractBody(textPart);
  }
  return "";
}

function buildRawMessage({ to, subject, body, inReplyTo, references, cc, bcc }) {
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].filter(Boolean);
  return base64UrlEncode(lines.join("\r\n"));
}

/** Get the authenticated Gmail account's profile — useful as a connectivity/auth check. */
export async function gmailGetProfile() {
  const data = await gmailFetch("/users/me/profile");
  return { emailAddress: data.emailAddress, messagesTotal: data.messagesTotal, threadsTotal: data.threadsTotal };
}

/** Search messages using Gmail search syntax (e.g. "from:x@y.com is:unread"). */
export async function gmailSearch({ query, max_results = 10 }) {
  const data = await gmailFetch(`/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max_results}`);
  return { query, messages: (data.messages || []).map((m) => ({ id: m.id, threadId: m.threadId })) };
}

/** List recent messages (optionally scoped to a label). */
export async function gmailListMessages({ label_ids, max_results = 10 }) {
  const params = new URLSearchParams({ maxResults: String(max_results) });
  if (label_ids) params.set("labelIds", label_ids);
  const data = await gmailFetch(`/users/me/messages?${params.toString()}`);
  return { messages: (data.messages || []).map((m) => ({ id: m.id, threadId: m.threadId })) };
}

/** Get a single message's content (decoded), by message ID. */
export async function gmailGetMessage({ message_id }) {
  const data = await gmailFetch(`/users/me/messages/${message_id}?format=full`);
  const headers = data.payload?.headers;
  return {
    id: data.id,
    threadId: data.threadId,
    from: extractHeader(headers, "From"),
    to: extractHeader(headers, "To"),
    subject: extractHeader(headers, "Subject"),
    date: extractHeader(headers, "Date"),
    messageIdHeader: extractHeader(headers, "Message-ID"),
    snippet: data.snippet,
    body: extractBody(data.payload),
    labelIds: data.labelIds,
  };
}

/** Get a full thread (all messages in it), by thread ID. */
export async function gmailGetThread({ thread_id }) {
  const data = await gmailFetch(`/users/me/threads/${thread_id}?format=full`);
  return {
    id: data.id,
    messages: (data.messages || []).map((m) => {
      const headers = m.payload?.headers;
      return {
        id: m.id,
        from: extractHeader(headers, "From"),
        to: extractHeader(headers, "To"),
        subject: extractHeader(headers, "Subject"),
        date: extractHeader(headers, "Date"),
        snippet: m.snippet,
        body: extractBody(m.payload),
      };
    }),
  };
}

/** Send a new email. HIGH risk — requires confirm: true. */
export async function gmailSend({ to, subject, body, cc, bcc, confirm }) {
  const raw = buildRawMessage({ to, subject, body, cc, bcc });
  const data = await gmailFetch("/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
  return { id: data.id, threadId: data.threadId, sent: true };
}

/** Reply to an existing message (same thread). HIGH risk — requires confirm: true. */
export async function gmailReply({ message_id, body, confirm }) {
  const original = await gmailFetch(`/users/me/messages/${message_id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`);
  const headers = original.payload?.headers;
  const to = extractHeader(headers, "From");
  let subject = extractHeader(headers, "Subject") || "";
  if (!/^re:/i.test(subject)) subject = `Re: ${subject}`;
  const msgIdHeader = extractHeader(headers, "Message-ID");
  const refsHeader = extractHeader(headers, "References");
  const references = [refsHeader, msgIdHeader].filter(Boolean).join(" ");

  const raw = buildRawMessage({ to, subject, body, inReplyTo: msgIdHeader, references });
  const data = await gmailFetch("/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, threadId: original.threadId }),
  });
  return { id: data.id, threadId: data.threadId, sent: true };
}

/** Forward an existing message to a new recipient. HIGH risk — requires confirm: true. */
export async function gmailForward({ message_id, to, note = "", confirm }) {
  const original = await gmailGetMessage({ message_id });
  const subject = /^fwd:/i.test(original.subject || "") ? original.subject : `Fwd: ${original.subject || ""}`;
  const body = [
    note,
    "",
    "---------- Forwarded message ---------",
    `From: ${original.from}`,
    `Date: ${original.date}`,
    `Subject: ${original.subject}`,
    `To: ${original.to}`,
    "",
    original.body,
  ].join("\n");

  const raw = buildRawMessage({ to, subject, body });
  const data = await gmailFetch("/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
  return { id: data.id, threadId: data.threadId, sent: true };
}
