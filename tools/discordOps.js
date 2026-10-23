// Discord tools over the REST API (v10). No new dependencies; a bot token is all that is needed.
//
//   discord_get_me         check the bot token, show the bot
//   discord_list_guilds    servers the bot is in
//   discord_list_channels  channels of one server, grouped by category
//   discord_read_messages  recent messages in a channel
//   discord_send_message   post a message (HIGH risk, needs confirm: true)
//
// Credentials: DISCORD_BOT_TOKEN (Discord Developer Portal > your app > Bot > Reset Token).
// Invite the bot with the permissions View Channels, Read Message History, Send Messages.
// To read what OTHER people wrote, turn on "Message Content Intent" for the bot in the portal;
// without it Discord returns empty text for most messages.
import { UNTRUSTED_NOTICE } from "./webOps.js";

const API = "https://discord.com/api/v10";
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const SNOWFLAKE = /^\d{15,25}$/;
const MAX_TEXT = 2000;
const CHANNEL_KINDS = { 0: "text", 5: "announcement", 15: "forum" };

function snowflake(value, label) {
  const s = String(value ?? "").trim();
  if (!SNOWFLAKE.test(s)) throw new Error(`${label} must be a Discord id (a long number). In Discord, turn on Developer Mode and right-click > Copy ID, or use discord_list_guilds / discord_list_channels.`);
  return s;
}

async function call(method, path, { query, body } = {}, deps = {}) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("Discord is not set up. Missing: DISCORD_BOT_TOKEN (create a bot in the Discord Developer Portal and add its token to .env).");
  const scrub = (text) => String(text).split(token).join("[REDACTED]");
  const pairs = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  const qs = pairs.length ? `?${new URLSearchParams(pairs.map(([k, v]) => [k, String(v)]))}` : "";

  let res;
  try {
    res = await fetchFn(`${API}${path}${qs}`, {
      method,
      headers: {
        authorization: `Bot ${token}`,
        "user-agent": "DiscordBot (https://github.com/KNIHAL/causly-server, 1.0)",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`Could not reach Discord: ${scrub(err.message)}`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;

  const why = scrub(data.message || `HTTP ${res.status}`);
  if (res.status === 401) throw new Error("Discord rejected the bot token. Check DISCORD_BOT_TOKEN.");
  if (res.status === 403) throw new Error(`Discord refused: ${why}. The bot is missing access or a permission there: check its role and the channel's permissions (View Channel, Read Message History, Send Messages).`);
  if (res.status === 404) throw new Error(`Discord could not find that: ${why}. Check the id, and that the bot is in that server.`);
  if (res.status === 429) throw new Error(`Discord rate limit hit${data.retry_after ? `; retry in ${Math.ceil(data.retry_after)}s` : ""}.`);
  throw new Error(`Discord error: ${why}`);
}

// ---------------------------------------------------------------- tools

export async function getMe(_input = {}, deps = {}) {
  const me = await call("GET", "/users/@me", {}, deps);
  const guilds = await call("GET", "/users/@me/guilds", { query: { limit: 200 } }, deps);
  return { id: me.id, username: me.username, servers: guilds.length };
}

export async function listGuilds(_input = {}, deps = {}) {
  const data = await call("GET", "/users/@me/guilds", { query: { limit: 200 } }, deps);
  return { count: data.length, servers: data.map((g) => ({ id: g.id, name: g.name, ...(g.owner ? { owner: true } : {}) })) };
}

export async function listChannels({ guild_id } = {}, deps = {}) {
  const id = snowflake(guild_id, "guild_id");
  const data = await call("GET", `/guilds/${id}/channels`, {}, deps);
  const categories = new Map(data.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  const channels = data
    .filter((c) => c.type in CHANNEL_KINDS)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: CHANNEL_KINDS[c.type],
      ...(c.parent_id && categories.has(c.parent_id) ? { category: categories.get(c.parent_id) } : {}),
      ...(c.topic ? { topic: String(c.topic).slice(0, 200) } : {}),
    }));
  return { guild_id: id, count: channels.length, channels, notice: UNTRUSTED_NOTICE };
}

export async function readMessages({ channel_id, limit = 20, before, after } = {}, deps = {}) {
  const id = snowflake(channel_id, "channel_id");
  const query = {
    limit: clamp(Math.trunc(Number(limit)) || 20, 1, 100),
    ...(before ? { before: snowflake(before, "before") } : {}),
    ...(after ? { after: snowflake(after, "after") } : {}),
  };
  const raw = await call("GET", `/channels/${id}/messages`, { query }, deps);
  const messages = [...raw].reverse().map((m) => ({
    id: m.id,
    author: m.author?.username ?? "unknown",
    author_id: m.author?.id,
    ...(m.author?.bot ? { bot: true } : {}),
    time: m.timestamp,
    text: m.content ?? "",
    ...(m.message_reference?.message_id ? { reply_to: m.message_reference.message_id } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments.length } : {}),
    ...(m.embeds?.length ? { embeds: m.embeds.length } : {}),
  }));
  const blank = messages.length > 0 && messages.every((m) => !m.text && !m.attachments && !m.embeds);
  return {
    channel_id: id,
    count: messages.length,
    messages,
    ...(blank ? { note: "Every message came back with empty text. Turn on 'Message Content Intent' for the bot in the Discord Developer Portal (Bot page), then try again." } : {}),
    notice: UNTRUSTED_NOTICE,
  };
}

/** HIGH risk: posts as the bot where other people read it. The wrapper requires confirm: true. */
export async function sendMessage({ channel_id, text, reply_to_message_id, confirm } = {}, deps = {}) {
  const id = snowflake(channel_id, "channel_id");
  const content = String(text ?? "");
  if (!content.trim()) throw new Error("text is required.");
  if (content.length > MAX_TEXT) throw new Error(`text is ${content.length} characters; Discord allows ${MAX_TEXT}. Shorten it or send it in parts.`);
  const body = {
    content,
    allowed_mentions: { parse: [] }, // never ping @everyone, @here, roles or people by accident
    ...(reply_to_message_id ? { message_reference: { message_id: snowflake(reply_to_message_id, "reply_to_message_id"), fail_if_not_exists: false } } : {}),
  };
  const m = await call("POST", `/channels/${id}/messages`, { body }, deps);
  return { sent: true, id: m.id, channel_id: m.channel_id, time: m.timestamp };
}
