const SLACK_API = "https://slack.com/api";

function getToken() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error(
      "SLACK_BOT_TOKEN not set. Run `npm run setup` to configure it, or add it manually to your .env file: SLACK_BOT_TOKEN=xoxb-..."
    );
  }
  return token;
}

async function slackFetch(method, body = {}, useGet = false) {
  const token = getToken();

  let res;
  if (useGet) {
    const query = new URLSearchParams(
      Object.entries(body).reduce((acc, [k, v]) => {
        if (v !== undefined && v !== null) acc[k] = String(v);
        return acc;
      }, {})
    ).toString();
    res = await fetch(`${SLACK_API}/${method}${query ? `?${query}` : ""}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } else {
    res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
  }

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error (${method}): ${data.error || "unknown_error"}`);
  }
  return data;
}

/** Look up a Slack user's info by user ID. */
export async function slackGetUser({ user_id }) {
  const data = await slackFetch("users.info", { user: user_id }, true);
  const u = data.user;
  return {
    id: u.id,
    name: u.name,
    real_name: u.real_name,
    display_name: u.profile?.display_name || null,
    email: u.profile?.email || null,
    is_bot: u.is_bot,
    is_admin: u.is_admin || false,
  };
}

/** List channels in the workspace. Paginates automatically up to `limit` total channels. */
export async function slackListChannels({ limit = 100, types = "public_channel,private_channel" }) {
  const channels = [];
  let cursor;
  do {
    const data = await slackFetch(
      "conversations.list",
      { limit: Math.min(200, limit - channels.length), types, cursor },
      true
    );
    channels.push(...data.channels);
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor && channels.length < limit);

  return {
    channels: channels.slice(0, limit).map((c) => ({
      id: c.id,
      name: c.name,
      is_private: c.is_private,
      is_archived: c.is_archived,
      num_members: c.num_members,
    })),
  };
}

/** Get details of a single channel. */
export async function slackGetChannel({ channel_id }) {
  const data = await slackFetch("conversations.info", { channel: channel_id }, true);
  const c = data.channel;
  return {
    id: c.id,
    name: c.name,
    is_private: c.is_private,
    is_archived: c.is_archived,
    topic: c.topic?.value || null,
    purpose: c.purpose?.value || null,
    num_members: c.num_members,
  };
}

/** Read recent message history from a channel. */
export async function slackReadMessages({ channel_id, limit = 20 }) {
  const data = await slackFetch("conversations.history", { channel: channel_id, limit }, true);
  return {
    channel_id,
    messages: data.messages.map((m) => ({
      user: m.user || m.bot_id || "unknown",
      text: m.text,
      ts: m.ts,
      thread_ts: m.thread_ts || null,
      reply_count: m.reply_count || 0,
    })),
  };
}

/** Search messages across the workspace. Requires a user token with search:read scope; bot tokens generally can't search — this will surface a clear error if unsupported. */
export async function slackSearchMessages({ query, count = 20 }) {
  const data = await slackFetch("search.messages", { query, count }, true);
  return {
    query,
    total: data.messages?.total || 0,
    matches: (data.messages?.matches || []).map((m) => ({
      channel: m.channel?.name || m.channel?.id,
      user: m.username || m.user,
      text: m.text,
      ts: m.ts,
      permalink: m.permalink,
    })),
  };
}

/** Post a message to a channel. HIGH risk — requires confirm: true. */
export async function slackSendMessage({ channel_id, text, confirm }) {
  const data = await slackFetch("chat.postMessage", { channel: channel_id, text });
  return { channel: data.channel, ts: data.ts, sent: true };
}

/** Reply in a thread. HIGH risk — requires confirm: true. */
export async function slackReplyThread({ channel_id, thread_ts, text, confirm }) {
  const data = await slackFetch("chat.postMessage", {
    channel: channel_id,
    thread_ts,
    text,
  });
  return { channel: data.channel, ts: data.ts, thread_ts, sent: true };
}

/** Create a new channel. HIGH risk — requires confirm: true. */
export async function slackCreateChannel({ name, is_private = false, confirm }) {
  const data = await slackFetch("conversations.create", { name, is_private });
  return { id: data.channel.id, name: data.channel.name, is_private: data.channel.is_private, created: true };
}
