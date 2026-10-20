import { z } from "zod";
import * as gmailOps from "../tools/gmailOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
// ---------------- Gmail tools ----------------

server.registerTool(
  "gmail_get_profile",
  {
    description: "Get the authenticated Gmail account's profile — connectivity/auth check.",
    inputSchema: {},
  },
  wrap("gmail_get_profile", gmailOps.gmailGetProfile)
);

server.registerTool(
  "gmail_search",
  {
    description: "Search messages using Gmail search syntax (e.g. 'from:x@y.com is:unread').",
    inputSchema: { query: z.string(), max_results: z.number().optional().describe("Defaults to 10") },
  },
  wrap("gmail_search", gmailOps.gmailSearch)
);

server.registerTool(
  "gmail_list_messages",
  {
    description: "List recent messages, optionally scoped to a label.",
    inputSchema: {
      label_ids: z.string().optional().describe("e.g. INBOX, UNREAD"),
      max_results: z.number().optional().describe("Defaults to 10"),
    },
  },
  wrap("gmail_list_messages", gmailOps.gmailListMessages)
);

server.registerTool(
  "gmail_get_message",
  {
    description: "Get a single message's decoded content by message ID.",
    inputSchema: { message_id: z.string() },
  },
  wrap("gmail_get_message", gmailOps.gmailGetMessage)
);

server.registerTool(
  "gmail_get_thread",
  {
    description: "Get a full thread (all messages in it) by thread ID.",
    inputSchema: { thread_id: z.string() },
  },
  wrap("gmail_get_thread", gmailOps.gmailGetThread)
);

server.registerTool(
  "gmail_send",
  {
    description: "Send a new email. HIGH risk — requires confirm: true.",
    inputSchema: {
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("gmail_send", gmailOps.gmailSend)
);

server.registerTool(
  "gmail_reply",
  {
    description: "Reply to an existing message in the same thread. HIGH risk — requires confirm: true.",
    inputSchema: {
      message_id: z.string(),
      body: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("gmail_reply", gmailOps.gmailReply)
);

server.registerTool(
  "gmail_forward",
  {
    description: "Forward an existing message to a new recipient. HIGH risk — requires confirm: true.",
    inputSchema: {
      message_id: z.string(),
      to: z.string(),
      note: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("gmail_forward", gmailOps.gmailForward)
);
}
