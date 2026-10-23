// Telegram Bot API tools. No new dependencies; a bot token is all that is needed.
//
//   telegram_get_me        check the bot token, show the bot's name
//   telegram_get_updates   recent messages sent to the bot (also how you find a chat id)
//   telegram_get_chat      details of one chat
//   telegram_notify        send a message to YOUR chat (TELEGRAM_CHAT_ID): alerts, "lead replied"
//   telegram_send_message  send a message to any chat (HIGH risk, needs confirm: true)
//
// Credentials: TELEGRAM_BOT_TOKEN (from @BotFather). TELEGRAM_CHAT_ID is the chat that
// telegram_notify writes to; get it by messaging your bot and calling telegram_get_updates.
import { UNTRUSTED_NOTICE } from "./webOps.js";

const API = "https://api.telegram.org";
const MAX_TEXT = 4096;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const CHAT_ID = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

function token(env = process.env) {
  const t = env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("Telegram is not set up. Missing: TELEGRAM_BOT_TOKEN (create a bot with @BotFather and add the token to .env).");
  return t;
}

const scrub = (text, t) => String(text).split(t).join("[REDACTED]");

/** One Bot API call. Errors never contain the bot token. */
async function call(method, params, deps = {}) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const t = token();
  let res;
  try {
    res = await fetchFn(`${API}/bot${t}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params ?? {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new Error(`Could not reach Telegram: ${scrub(err.message, t)}`);
  }
  const data = await res.json().catch(() => ({}));
  if (data.ok) return data.result;

  const why = scrub(data.description || `HTTP ${res.status}`, t);
  const code = data.error_code ?? res.status;
  if (code === 401) throw new Error("Telegram rejected the bot token. Check TELEGRAM_BOT_TOKEN.");
  if (code === 409) throw new Error("This bot has a webhook set, which blocks reading updates here. Remove the webhook (deleteWebhook) to use telegram_get_updates.");
  if (code === 403) throw new Error(`Telegram refused: ${why}. For a person, they must open the bot and press Start first; for a group or channel, add the bot to it.`);
  if (code === 429) {
    const wait = data.parameters?.retry_after;
    throw new Error(`Telegram rate limit hit${wait ? `; retry in ${wait}s` : ""}.`);
  }
  throw new Error(`Telegram error: ${why}`);
}

function checkChatId(id, label = "chat_id") {
  const s = String(id ?? "").trim();
  if (!CHAT_ID.test(s)) throw new Error(`${label} must be a number like 123456789 (groups are negative) or a channel like @mychannel.`);
  return s;
}

function checkText(text) {
  const s = String(text ?? "");
  if (!s.trim()) throw new Error("text is required.");
  if (s.length > MAX_TEXT) throw new Error(`text is ${s.length} characters; Telegram allows ${MAX_TEXT}. Shorten it or send it in parts.`);
  return s;
}

const PARSE_MODES = ["HTML", "MarkdownV2"];

async function send({ chat_id, text, reply_to_message_id, parse_mode, silent }, deps) {
  const body = {
    chat_id,
    text: checkText(text),
    disable_web_page_preview: true,
    ...(silent ? { disable_notification: true } : {}),
    ...(reply_to_message_id !== undefined ? { reply_parameters: { message_id: Number(reply_to_message_id), allow_sending_without_reply: true } } : {}),
  };
  if (parse_mode !== undefined) {
    if (!PARSE_MODES.includes(parse_mode)) throw new Error("parse_mode must be HTML or MarkdownV2 (leave it out for plain text).");
    body.parse_mode = parse_mode;
  }
  const m = await call("sendMessage", body, deps);
  return { sent: true, chat_id: m.chat?.id, message_id: m.message_id, date: new Date(m.date * 1000).toISOString() };
}

// ---------------------------------------------------------------- tools

export async function getMe(_input = {}, deps = {}) {
  const me = await call("getMe", {}, deps);
  return {
    id: me.id,
    username: me.username,
    name: me.first_name,
    can_join_groups: me.can_join_groups,
    notify_chat_configured: Boolean(process.env.TELEGRAM_CHAT_ID),
  };
}

const person = (u) => (u ? { id: u.id, ...(u.username ? { username: u.username } : {}), name: [u.first_name, u.last_name].filter(Boolean).join(" ") } : undefined);

function simplifyUpdate(u) {
  const m = u.message ?? u.channel_post;
  if (!m) return { update_id: u.update_id, kind: "other" };
  return {
    update_id: u.update_id,
    kind: u.message ? "message" : "channel_post",
    message_id: m.message_id,
    chat: { id: m.chat.id, type: m.chat.type, ...(m.chat.title ? { title: m.chat.title } : {}), ...(m.chat.username ? { username: m.chat.username } : {}) },
    from: person(m.from),
    date: new Date(m.date * 1000).toISOString(),
    text: m.text ?? m.caption ?? (m.photo ? "[photo]" : m.document ? "[document]" : m.voice ? "[voice message]" : "[non-text message]"),
  };
}

export async function getUpdates({ limit = 20, offset } = {}, deps = {}) {
  const params = { limit: clamp(Math.trunc(Number(limit)) || 20, 1, 100), timeout: 0, allowed_updates: ["message", "channel_post"] };
  if (offset !== undefined) params.offset = Math.trunc(Number(offset));
  const raw = await call("getUpdates", params, deps);
  const updates = raw.map(simplifyUpdate);
  return {
    count: updates.length,
    updates,
    ...(raw.length ? { next_offset: raw[raw.length - 1].update_id + 1 } : {}),
    hint: "Pass next_offset as offset to mark these as read; they will not be returned again. Without offset they stay in the queue (kept for 24 hours).",
    notice: UNTRUSTED_NOTICE,
  };
}

export async function getChat({ chat_id } = {}, deps = {}) {
  const c = await call("getChat", { chat_id: checkChatId(chat_id) }, deps);
  return {
    id: c.id,
    type: c.type,
    ...(c.title ? { title: c.title } : {}),
    ...(c.username ? { username: c.username } : {}),
    ...(c.first_name ? { name: [c.first_name, c.last_name].filter(Boolean).join(" ") } : {}),
    ...(c.description ? { description: String(c.description).slice(0, 500) } : {}),
    notice: UNTRUSTED_NOTICE,
  };
}

/** Message to the owner's own chat. Cannot reach anyone else, so no confirmation is needed. */
export async function notify({ text, silent, parse_mode } = {}, deps = {}) {
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!chat) throw new Error("TELEGRAM_CHAT_ID is not set. Message your bot, call telegram_get_updates to see your chat id, and add it to .env.");
  return send({ chat_id: checkChatId(chat, "TELEGRAM_CHAT_ID"), text, silent, parse_mode }, deps);
}

/** Message to any chat. HIGH risk: the wrapper requires confirm: true. */
export async function sendMessage({ chat_id, text, reply_to_message_id, parse_mode, silent, confirm } = {}, deps = {}) {
  return send({ chat_id: checkChatId(chat_id), text, reply_to_message_id, parse_mode, silent }, deps);
}
