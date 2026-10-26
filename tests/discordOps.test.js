import { describe, it, expect, beforeEach } from "vitest";
import * as discord from "../tools/discordOps.js";

const TOKEN = "MTIz.SECRET.token";
const GUILD = "111111111111111111";
const CHAN = "222222222222222222";
const MSG = "333333333333333333";

/** fetch stub: handler gets { method, path, query, body }; return data, a Response-like error, or an Error to throw. */
function stub(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const call = { method: init.method || "GET", path: u.pathname.replace("/api/v10", ""), query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers };
    calls.push(call);
    const out = await handler(call);
    if (out instanceof Error) throw out;
    if (out?.__error) return { ok: false, status: out.__error, json: async () => ({ message: out.message, retry_after: out.retry_after }) };
    return { ok: true, status: 200, json: async () => out };
  };
  return { deps: { fetch }, calls };
}

beforeEach(() => {
  process.env.DISCORD_BOT_TOKEN = TOKEN;
});

describe("discordOps — setup and errors", () => {
  it("explains a missing token", async () => {
    delete process.env.DISCORD_BOT_TOKEN;
    await expect(discord.getMe({}, stub(() => ({})).deps)).rejects.toThrow(/DISCORD_BOT_TOKEN/);
  });

  it("authenticates as a bot with a user agent", async () => {
    const { deps, calls } = stub((c) => (c.path === "/users/@me" ? { id: "9", username: "causly-bot" } : [{ id: GUILD, name: "Causly" }]));
    const r = await discord.getMe({}, deps);
    expect(calls[0].headers.authorization).toBe(`Bot ${TOKEN}`);
    expect(calls[0].headers["user-agent"]).toMatch(/^DiscordBot \(/);
    expect(r).toEqual({ id: "9", username: "causly-bot", servers: 1 });
  });

  it("maps 401, 403, 404 and 429", async () => {
    await expect(discord.listGuilds({}, stub(() => ({ __error: 401 })).deps)).rejects.toThrow(/rejected the bot token/);
    await expect(discord.listChannels({ guild_id: GUILD }, stub(() => ({ __error: 403, message: "Missing Access" })).deps)).rejects.toThrow(/Missing Access.*permission/);
    await expect(discord.listChannels({ guild_id: GUILD }, stub(() => ({ __error: 404, message: "Unknown Guild" })).deps)).rejects.toThrow(/Unknown Guild/);
    await expect(discord.readMessages({ channel_id: CHAN }, stub(() => ({ __error: 429, retry_after: 2.3 })).deps)).rejects.toThrow(/retry in 3s/);
  });

  it("never leaks the token in an error", async () => {
    const api = stub(() => ({ __error: 400, message: `bad ${TOKEN}` }));
    await discord.listGuilds({}, api.deps).catch((e) => expect(e.message).not.toContain("SECRET"));
    const net = stub(() => new Error(`boom ${TOKEN}`));
    await expect(discord.listGuilds({}, net.deps)).rejects.toThrow(/Could not reach Discord/);
    await discord.listGuilds({}, net.deps).catch((e) => expect(e.message).not.toContain("SECRET"));
  });

  it("rejects malformed ids before any call", async () => {
    const { deps, calls } = stub(() => ({}));
    await expect(discord.listChannels({ guild_id: "my server" }, deps)).rejects.toThrow(/Discord id/);
    await expect(discord.readMessages({ channel_id: "#general" }, deps)).rejects.toThrow(/Discord id/);
    await expect(discord.readMessages({ channel_id: CHAN, before: "abc" }, deps)).rejects.toThrow(/before/);
    await expect(discord.sendMessage({ channel_id: "x", text: "hi" }, deps)).rejects.toThrow(/Discord id/);
    expect(calls).toHaveLength(0);
  });
});

describe("discordOps — reading", () => {
  it("lists servers", async () => {
    const { deps } = stub(() => [{ id: GUILD, name: "Causly", owner: true }, { id: "444444444444444444", name: "Other" }]);
    const r = await discord.listGuilds({}, deps);
    expect(r.servers).toEqual([{ id: GUILD, name: "Causly", owner: true }, { id: "444444444444444444", name: "Other" }]);
  });

  it("lists text-like channels in order with their category, hiding voice and categories", async () => {
    const { deps } = stub(() => [
      { id: "10", type: 4, name: "Community", position: 0 },
      { id: "11", type: 0, name: "general", position: 2, parent_id: "10", topic: "Say hi" },
      { id: "12", type: 2, name: "Voice", position: 1, parent_id: "10" },
      { id: "13", type: 5, name: "news", position: 1, parent_id: "10" },
      { id: "14", type: 15, name: "help", position: 3 },
    ]);
    const r = await discord.listChannels({ guild_id: GUILD }, deps);
    expect(r.channels).toEqual([
      { id: "13", name: "news", type: "announcement", category: "Community" },
      { id: "11", name: "general", type: "text", category: "Community", topic: "Say hi" },
      { id: "14", name: "help", type: "forum" },
    ]);
  });

  it("reads messages oldest first and passes paging options", async () => {
    const newestFirst = [
      { id: "3", author: { id: "u2", username: "bot", bot: true }, content: "Done", timestamp: "2026-10-23T03:00:00Z", message_reference: { message_id: "2" } },
      { id: "2", author: { id: "u1", username: "asha" }, content: "Need a quote", timestamp: "2026-10-23T02:00:00Z", attachments: [{}], embeds: [{}, {}] },
    ];
    const { deps, calls } = stub(() => newestFirst);
    const r = await discord.readMessages({ channel_id: CHAN, limit: 500, before: MSG }, deps);
    expect(calls[0].path).toBe(`/channels/${CHAN}/messages`);
    expect(calls[0].query).toEqual({ limit: "100", before: MSG });
    expect(r.messages.map((m) => m.id)).toEqual(["2", "3"]);
    expect(r.messages[0]).toMatchObject({ author: "asha", text: "Need a quote", attachments: 1, embeds: 2 });
    expect(r.messages[1]).toMatchObject({ author: "bot", bot: true, reply_to: "2" });
    expect(r.note).toBeUndefined();
    expect(r.notice).toBeTruthy();
  });

  it("explains blank messages (Message Content Intent off)", async () => {
    const { deps } = stub(() => [{ id: "2", author: { id: "u1", username: "asha" }, content: "", timestamp: "t" }, { id: "1", author: { id: "u1", username: "asha" }, content: "", timestamp: "t" }]);
    const r = await discord.readMessages({ channel_id: CHAN }, deps);
    expect(r.note).toMatch(/Message Content Intent/);
  });

  it("does not warn for an empty channel", async () => {
    const r = await discord.readMessages({ channel_id: CHAN }, stub(() => []).deps);
    expect(r).toMatchObject({ count: 0 });
    expect(r.note).toBeUndefined();
  });
});

describe("discordOps — sending", () => {
  it("posts with mentions disabled", async () => {
    const { deps, calls } = stub(() => ({ id: MSG, channel_id: CHAN, timestamp: "2026-10-23T03:00:00Z" }));
    const r = await discord.sendMessage({ channel_id: CHAN, text: "Hello @everyone", confirm: true }, deps);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe(`/channels/${CHAN}/messages`);
    expect(calls[0].body).toEqual({ content: "Hello @everyone", allowed_mentions: { parse: [] } });
    expect(r).toEqual({ sent: true, id: MSG, channel_id: CHAN, time: "2026-10-23T03:00:00Z" });
  });

  it("replies to a message without failing if it was deleted", async () => {
    const { deps, calls } = stub(() => ({ id: "5", channel_id: CHAN, timestamp: "t" }));
    await discord.sendMessage({ channel_id: CHAN, text: "Thanks!", reply_to_message_id: MSG, confirm: true }, deps);
    expect(calls[0].body.message_reference).toEqual({ message_id: MSG, fail_if_not_exists: false });
  });

  it("validates text before any call", async () => {
    const { deps, calls } = stub(() => ({}));
    await expect(discord.sendMessage({ channel_id: CHAN, text: "  " }, deps)).rejects.toThrow(/text is required/);
    await expect(discord.sendMessage({ channel_id: CHAN, text: "x".repeat(2001) }, deps)).rejects.toThrow(/2000/);
    await expect(discord.sendMessage({ channel_id: CHAN, text: "hi", reply_to_message_id: "abc" }, deps)).rejects.toThrow(/reply_to_message_id/);
    expect(calls).toHaveLength(0);
  });
});
