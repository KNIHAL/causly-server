import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  slackGetUser,
  slackListChannels,
  slackGetChannel,
  slackReadMessages,
  slackSearchMessages,
  slackSendMessage,
  slackReplyThread,
  slackCreateChannel,
} from "../tools/slackOps.js";

const jsonRes = (data) => Promise.resolve({ json: () => Promise.resolve(data) });

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SLACK_BOT_TOKEN;
});

describe("slackOps — auth & error handling", () => {
  it("throws if SLACK_BOT_TOKEN is missing", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    await expect(slackGetUser({ user_id: "U1" })).rejects.toThrow(/SLACK_BOT_TOKEN not set/);
  });

  it("throws a formatted error when Slack responds with ok: false", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ ok: false, error: "user_not_found" }));
    await expect(slackGetUser({ user_id: "U1" })).rejects.toThrow(/Slack API error \(users\.info\): user_not_found/);
  });

  it("defaults to 'unknown_error' when Slack omits the error field", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ ok: false }));
    await expect(slackGetUser({ user_id: "U1" })).rejects.toThrow(/unknown_error/);
  });
});

describe("slackOps — GET requests build query strings", () => {
  it("slackGetUser sends a GET with bearer auth and the user query param", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({ ok: true, user: { id: "U1", name: "kumar", real_name: "Kumar", is_bot: false, profile: {} } })
    );
    await slackGetUser({ user_id: "U1" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://slack.com/api/users.info?user=U1");
    expect(opts.headers.Authorization).toBe("Bearer xoxb-test");
    expect(opts.method).toBeUndefined();
  });

  it("slackGetUser maps profile fields with null fallbacks", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        ok: true,
        user: { id: "U1", name: "kumar", real_name: "Kumar", is_bot: false, profile: {} },
      })
    );
    const result = await slackGetUser({ user_id: "U1" });
    expect(result).toEqual({
      id: "U1",
      name: "kumar",
      real_name: "Kumar",
      display_name: null,
      email: null,
      is_bot: false,
      is_admin: false,
    });
  });

  it("slackGetUser surfaces display_name/email when present", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        ok: true,
        user: {
          id: "U1",
          name: "kumar",
          real_name: "Kumar",
          is_bot: false,
          is_admin: true,
          profile: { display_name: "K", email: "k@example.com" },
        },
      })
    );
    const result = await slackGetUser({ user_id: "U1" });
    expect(result.display_name).toBe("K");
    expect(result.email).toBe("k@example.com");
    expect(result.is_admin).toBe(true);
  });
});

describe("slackOps — channels", () => {
  it("slackGetChannel maps topic/purpose with null fallback", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        ok: true,
        channel: { id: "C1", name: "general", is_private: false, is_archived: false, num_members: 10 },
      })
    );
    const result = await slackGetChannel({ channel_id: "C1" });
    expect(result.topic).toBeNull();
    expect(result.purpose).toBeNull();
  });

  it("slackGetChannel extracts topic/purpose values when present", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        ok: true,
        channel: {
          id: "C1",
          name: "general",
          is_private: false,
          is_archived: false,
          topic: { value: "General chat" },
          purpose: { value: "Team-wide" },
          num_members: 10,
        },
      })
    );
    const result = await slackGetChannel({ channel_id: "C1" });
    expect(result.topic).toBe("General chat");
    expect(result.purpose).toBe("Team-wide");
  });

  it("slackListChannels returns a single page without pagination when no next_cursor", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        ok: true,
        channels: [{ id: "C1", name: "general", is_private: false, is_archived: false, num_members: 5 }],
        response_metadata: { next_cursor: "" },
      })
    );
    const result = await slackListChannels({});
    expect(result.channels).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("slackListChannels paginates via cursor until the limit is reached", async () => {
    global.fetch
      .mockReturnValueOnce(
        jsonRes({
          ok: true,
          channels: [{ id: "C1", name: "a", is_private: false, is_archived: false, num_members: 1 }],
          response_metadata: { next_cursor: "cursor1" },
        })
      )
      .mockReturnValueOnce(
        jsonRes({
          ok: true,
          channels: [{ id: "C2", name: "b", is_private: false, is_archived: false, num_members: 1 }],
          response_metadata: { next_cursor: "" },
        })
      );
    const result = await slackListChannels({ limit: 100 });
    expect(result.channels).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toContain("cursor=cursor1");
  });

  it("slackListChannels stops once accumulated channels reach the limit even mid-page", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        ok: true,
        channels: [
          { id: "C1", name: "a", is_private: false, is_archived: false, num_members: 1 },
          { id: "C2", name: "b", is_private: false, is_archived: false, num_members: 1 },
        ],
        response_metadata: { next_cursor: "cursor1" },
      })
    );
    const result = await slackListChannels({ limit: 1 });
    expect(result.channels).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("slackCreateChannel POSTs and returns created:true", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ ok: true, channel: { id: "C9", name: "new-chan", is_private: false } }));
    const result = await slackCreateChannel({ name: "new-chan" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://slack.com/api/conversations.create");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ name: "new-chan", is_private: false });
    expect(result).toEqual({ id: "C9", name: "new-chan", is_private: false, created: true });
  });
});

describe("slackOps — messages", () => {
  it("slackReadMessages maps messages with fallbacks for user/thread_ts/reply_count", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        ok: true,
        messages: [
          { text: "hi", ts: "1.1", bot_id: "B1" },
          { user: "U1", text: "hello", ts: "1.2", thread_ts: "1.0", reply_count: 3 },
        ],
      })
    );
    const result = await slackReadMessages({ channel_id: "C1" });
    expect(result.messages[0]).toEqual({ user: "B1", text: "hi", ts: "1.1", thread_ts: null, reply_count: 0 });
    expect(result.messages[1]).toEqual({ user: "U1", text: "hello", ts: "1.2", thread_ts: "1.0", reply_count: 3 });
  });

  it("slackSearchMessages maps matches and defaults total to 0", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ ok: true, messages: {} }));
    const result = await slackSearchMessages({ query: "deploy" });
    expect(result.total).toBe(0);
    expect(result.matches).toEqual([]);
  });

  it("slackSearchMessages maps channel name and username fallbacks", async () => {
    global.fetch.mockReturnValueOnce(
      jsonRes({
        ok: true,
        messages: {
          total: 1,
          matches: [
            {
              channel: { name: "general" },
              username: "kumar",
              text: "deployed to prod",
              ts: "1.1",
              permalink: "u",
            },
          ],
        },
      })
    );
    const result = await slackSearchMessages({ query: "deploy" });
    expect(result.matches[0].channel).toBe("general");
    expect(result.matches[0].user).toBe("kumar");
  });

  it("slackSendMessage POSTs channel and text", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ ok: true, channel: "C1", ts: "1.1" }));
    const result = await slackSendMessage({ channel_id: "C1", text: "hello", confirm: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ channel: "C1", text: "hello" });
    expect(result).toEqual({ channel: "C1", ts: "1.1", sent: true });
  });

  it("slackReplyThread includes thread_ts in the payload and response", async () => {
    global.fetch.mockReturnValueOnce(jsonRes({ ok: true, channel: "C1", ts: "1.3" }));
    const result = await slackReplyThread({ channel_id: "C1", thread_ts: "1.0", text: "reply", confirm: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ channel: "C1", thread_ts: "1.0", text: "reply" });
    expect(result).toEqual({ channel: "C1", ts: "1.3", thread_ts: "1.0", sent: true });
  });
});
