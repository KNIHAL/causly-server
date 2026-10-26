import { z } from "zod";
import * as slackOps from "../tools/slackOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
// ---------------- Slack tools ----------------

server.registerTool(
  "slack_get_user",
  {
    description: "Look up a Slack user's info by user ID.",
    inputSchema: { user_id: z.string() },
  },
  wrap("slack_get_user", slackOps.slackGetUser)
);

server.registerTool(
  "slack_list_channels",
  {
    description: "List channels in the workspace.",
    inputSchema: {
      limit: z.number().optional().describe("Defaults to 100"),
      types: z.string().optional().describe("Comma-separated: public_channel, private_channel, mpim, im — defaults to public_channel,private_channel"),
    },
  },
  wrap("slack_list_channels", slackOps.slackListChannels)
);

server.registerTool(
  "slack_get_channel",
  {
    description: "Get details of a single channel.",
    inputSchema: { channel_id: z.string() },
  },
  wrap("slack_get_channel", slackOps.slackGetChannel)
);

server.registerTool(
  "slack_read_messages",
  {
    description: "Read recent message history from a channel.",
    inputSchema: { channel_id: z.string(), limit: z.number().optional().describe("Defaults to 20") },
  },
  wrap("slack_read_messages", slackOps.slackReadMessages)
);

server.registerTool(
  "slack_search_messages",
  {
    description: "Search messages across the workspace. Requires a user token with search:read scope.",
    inputSchema: { query: z.string(), count: z.number().optional().describe("Defaults to 20") },
  },
  wrap("slack_search_messages", slackOps.slackSearchMessages)
);

server.registerTool(
  "slack_send_message",
  {
    description: "Post a message to a channel. HIGH risk — requires confirm: true.",
    inputSchema: {
      channel_id: z.string(),
      text: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("slack_send_message", slackOps.slackSendMessage)
);

server.registerTool(
  "slack_reply_thread",
  {
    description: "Reply in a thread. HIGH risk — requires confirm: true.",
    inputSchema: {
      channel_id: z.string(),
      thread_ts: z.string(),
      text: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("slack_reply_thread", slackOps.slackReplyThread)
);

server.registerTool(
  "slack_create_channel",
  {
    description: "Create a new channel. HIGH risk — requires confirm: true.",
    inputSchema: {
      name: z.string(),
      is_private: z.boolean().optional().describe("Defaults to false"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("slack_create_channel", slackOps.slackCreateChannel)
);
}
