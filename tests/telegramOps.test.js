import { describe, it, expect, beforeEach } from "vitest";
import * as tg from "../tools/telegramOps.js";

const TOKEN = "123456:SECRET-abc";

/** fetch stub: records calls, answers with the handler's Telegram-style result. */
function stub(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = String(url).split("/").pop();
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), method, body });
    const out = await handler({ method, body });
    if (out instanceof Error) throw out;
    if (out?.__error) return { ok: false, status: out.__error, json: async () => ({ ok: false, error_code: out.__error, description: out.description, parameters: out.parameters }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, result: out }) };
  };
  return { deps: { fetch }, calls };
}

const sentMsg = (extra = {}) => ({ message_id: 7, chat: { id: 42 }, date: 1_792_000_000, ...extra });

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_CHAT_ID = "42";
});

describe("telegramOps — setup and errors", () => {
  it("explains a missing token", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { deps } = stub(() => ({}));
    await expect(tg.getMe({}, deps)).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("calls the Bot API with the token in the path", async () => {
    const { deps, calls } = stub(() => ({ id: 1, username: "causly_bot", first_name: "Causly" }));
    const me = await tg.getMe({}, deps);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
    expect(me).toEqual({ id: 1, username: "causly_bot", name: "Causly", can_join_groups: undefined, notify_chat_configured: true });
  });

  it("maps 401, 403, 409 and 429 to clear messages", async () => {
    await expect(tg.getMe({}, stub(() => ({ __error: 401, description: "Unauthorized" })).deps)).rejects.toThrow(/rejected the bot token/);
    await expect(tg.sendMessage({ chat_id: "9", text: "hi" }, stub(() => ({ __error: 403, description: "bot was blocked by the user" })).deps)).rejects.toThrow(/press Start/);
    await expect(tg.getUpdates({}, stub(() => ({ __error: 409, description: "Conflict: can't use getUpdates while webhook is active" })).deps)).rejects.toThrow(/webhook/);
    await expect(tg.notify({ text: "x" }, stub(() => ({ __error: 429, description: "Too Many Requests", parameters: { retry_after: 7 } })).deps)).rejects.toThrow(/retry in 7s/);
  });

  it("never leaks the token in an error", async () => {
    const leaky = stub(() => new Error(`connect failed for https://api.telegram.org/bot${TOKEN}/getMe`));
    await expect(tg.getMe({}, leaky.deps)).rejects.toThrow(/Could not reach Telegram/);
    await tg.getMe({}, leaky.deps).catch((e) => expect(e.message).not.toContain("SECRET"));
    const apiLeak = stub(() => ({ __error: 400, description: `bad request ${TOKEN}` }));
    await tg.getMe({}, apiLeak.deps).catch((e) => expect(e.message).not.toContain("SECRET"));
  });
});

describe("telegramOps — reading", () => {
  const updates = [
    { update_id: 10, message: { message_id: 1, chat: { id: 42, type: "private", username: "kumar" }, from: { id: 42, username: "kumar", first_name: "Kumar" }, date: 1_792_000_000, text: "hello" } },
    { update_id: 11, message: { message_id: 2, chat: { id: 42, type: "private" }, from: { id: 42, first_name: "Kumar" }, date: 1_792_000_100, photo: [{}] } },
    { update_id: 12, channel_post: { message_id: 3, chat: { id: -100, type: "channel", title: "News" }, date: 1_792_000_200, text: "post" } },
    { update_id: 13, edited_message: {} },
  ];

  it("simplifies updates and gives next_offset", async () => {
    const { deps, calls } = stub(() => updates);
    const r = await tg.getUpdates({}, deps);
    expect(calls[0].body).toMatchObject({ limit: 20, timeout: 0, allowed_updates: ["message", "channel_post"] });
    expect(calls[0].body.offset).toBeUndefined();
    expect(r.count).toBe(4);
    expect(r.updates[0]).toMatchObject({ kind: "message", text: "hello", chat: { id: 42, type: "private", username: "kumar" }, from: { id: 42, username: "kumar", name: "Kumar" } });
    expect(r.updates[1].text).toBe("[photo]");
    expect(r.updates[2]).toMatchObject({ kind: "channel_post", chat: { title: "News" } });
    expect(r.updates[3]).toEqual({ update_id: 13, kind: "other" });
    expect(r.next_offset).toBe(14);
    expect(r.notice).toBeTruthy();
  });

  it("passes offset and clamps the limit", async () => {
    const { deps, calls } = stub(() => []);
    const r = await tg.getUpdates({ limit: 500, offset: 14 }, deps);
    expect(calls[0].body.limit).toBe(100);
    expect(calls[0].body.offset).toBe(14);
    expect(r.count).toBe(0);
    expect(r.next_offset).toBeUndefined();
  });

  it("gets a chat and validates the id", async () => {
    const { deps, calls } = stub(() => ({ id: -100, type: "supergroup", title: "Leads", description: "d" }));
    const r = await tg.getChat({ chat_id: "-100" }, deps);
    expect(calls[0].body).toEqual({ chat_id: "-100" });
    expect(r).toMatchObject({ id: -100, type: "supergroup", title: "Leads" });
    await expect(tg.getChat({ chat_id: "not a chat" }, deps)).rejects.toThrow(/chat_id must be/);
  });
});

describe("telegramOps — sending", () => {
  it("notify writes to the owner's chat, plain text, previews off", async () => {
    const { deps, calls } = stub(() => sentMsg());
    const r = await tg.notify({ text: "Lead replied: Acme" }, deps);
    expect(calls[0].method).toBe("sendMessage");
    expect(calls[0].body).toEqual({ chat_id: "42", text: "Lead replied: Acme", disable_web_page_preview: true });
    expect(r).toMatchObject({ sent: true, chat_id: 42, message_id: 7 });
  });

  it("notify can be silent and use HTML", async () => {
    const { deps, calls } = stub(() => sentMsg());
    await tg.notify({ text: "<b>Due</b>", silent: true, parse_mode: "HTML" }, deps);
    expect(calls[0].body).toMatchObject({ disable_notification: true, parse_mode: "HTML" });
  });

  it("notify needs TELEGRAM_CHAT_ID and cannot be pointed elsewhere", async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    const { deps, calls } = stub(() => sentMsg());
    await expect(tg.notify({ text: "x" }, deps)).rejects.toThrow(/TELEGRAM_CHAT_ID/);
    process.env.TELEGRAM_CHAT_ID = "42";
    await tg.notify({ text: "x", chat_id: "999" }, deps);
    expect(calls[0].body.chat_id).toBe("42");
  });

  it("send_message targets a chat and can reply to a message", async () => {
    const { deps, calls } = stub(() => sentMsg({ chat: { id: -100 } }));
    const r = await tg.sendMessage({ chat_id: "-100", text: "Thanks!", reply_to_message_id: 5, confirm: true }, deps);
    expect(calls[0].body.chat_id).toBe("-100");
    expect(calls[0].body.reply_parameters).toEqual({ message_id: 5, allow_sending_without_reply: true });
    expect(r.chat_id).toBe(-100);
  });

  it("accepts @channel names", async () => {
    const { deps, calls } = stub(() => sentMsg());
    await tg.sendMessage({ chat_id: "@mychannel", text: "hi", confirm: true }, deps);
    expect(calls[0].body.chat_id).toBe("@mychannel");
  });

  it("validates text, chat id and parse mode before any network call", async () => {
    const { deps, calls } = stub(() => sentMsg());
    await expect(tg.notify({ text: "   " }, deps)).rejects.toThrow(/text is required/);
    await expect(tg.notify({ text: "x".repeat(4097) }, deps)).rejects.toThrow(/4096/);
    await expect(tg.sendMessage({ chat_id: "abc", text: "x" }, deps)).rejects.toThrow(/chat_id must be/);
    await expect(tg.sendMessage({ chat_id: "1", text: "x", parse_mode: "Markdown" }, deps)).rejects.toThrow(/parse_mode/);
    expect(calls).toHaveLength(0);
  });
});
