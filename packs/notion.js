import { z } from "zod";
import { wrap } from "../tools/toolWrapper.js";
import * as notionOps from "../tools/notionOps.js";

export default function register(server) {
// ----------------NOtion tools ----------------
server.registerTool(
  "notion_search",
  {
    description: "Search pages and databases across the workspace.",
    inputSchema: {
      query: z.string().optional(),
      filter_type: z.string().optional().describe("'page' or 'database' to restrict results"),
      page_size: z.number().optional().describe("Defaults to 20"),
    },
  },
  wrap("notion_search", notionOps.notionSearch)
);

server.registerTool(
  "notion_get_page",
  {
    description: "Get a single page's properties and metadata by page ID.",
    inputSchema: { page_id: z.string() },
  },
  wrap("notion_get_page", notionOps.notionGetPage)
);

server.registerTool(
  "notion_create_page",
  {
    description: "Create a new page under a parent page or database. HIGH risk — requires confirm: true.",
    inputSchema: {
      parent_id: z.string(),
      parent_type: z.string().optional().describe("'page_id' or 'database_id', defaults to page_id"),
      properties: z.record(z.any()),
      children: z.array(z.any()).optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_create_page", notionOps.notionCreatePage)
);

server.registerTool(
  "notion_update_page",
  {
    description: "Update an existing page's properties, or archive/restore it. HIGH risk — requires confirm: true.",
    inputSchema: {
      page_id: z.string(),
      properties: z.record(z.any()).optional(),
      archived: z.boolean().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_update_page", notionOps.notionUpdatePage)
);

server.registerTool(
  "notion_get_database",
  {
    description: "Get a database's schema and metadata by database ID.",
    inputSchema: { database_id: z.string() },
  },
  wrap("notion_get_database", notionOps.notionGetDatabase)
);

server.registerTool(
  "notion_query_database",
  {
    description: "Query a database's rows with optional filter and sort.",
    inputSchema: {
      database_id: z.string(),
      filter: z.record(z.any()).optional(),
      sorts: z.array(z.any()).optional(),
      page_size: z.number().optional().describe("Defaults to 20"),
    },
  },
  wrap("notion_query_database", notionOps.notionQueryDatabase)
);

server.registerTool(
  "notion_create_database",
  {
    description: "Create a new database under a parent page. HIGH risk — requires confirm: true.",
    inputSchema: {
      parent_page_id: z.string(),
      title: z.string(),
      properties: z.record(z.any()),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_create_database", notionOps.notionCreateDatabase)
);

server.registerTool(
  "notion_append_block_children",
  {
    description: "Append content blocks (text, lists, tables, etc.) to a page or block. HIGH risk — requires confirm: true.",
    inputSchema: {
      block_id: z.string(),
      children: z.array(z.any()),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_append_block_children", notionOps.notionAppendBlockChildren)
);

server.registerTool(
  "notion_get_block_children",
  {
    description: "Get the child blocks of a page or block.",
    inputSchema: {
      block_id: z.string(),
      page_size: z.number().optional().describe("Defaults to 50"),
    },
  },
  wrap("notion_get_block_children", notionOps.notionGetBlockChildren)
);

server.registerTool(
  "notion_update_block",
  {
    description: "Update an existing block's content. HIGH risk — requires confirm: true.",
    inputSchema: {
      block_id: z.string(),
      block_data: z.record(z.any()),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_update_block", notionOps.notionUpdateBlock)
);

server.registerTool(
  "notion_delete_block",
  {
    description: "Delete (archive) a block. HIGH risk — requires confirm: true.",
    inputSchema: {
      block_id: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_delete_block", notionOps.notionDeleteBlock)
);

server.registerTool(
  "notion_get_comments",
  {
    description: "Get comments on a page or block.",
    inputSchema: { block_id: z.string() },
  },
  wrap("notion_get_comments", notionOps.notionGetComments)
);

server.registerTool(
  "notion_add_comment",
  {
    description: "Add a comment to a page, or reply in an existing discussion thread. HIGH risk — requires confirm: true.",
    inputSchema: {
      page_id: z.string().optional(),
      discussion_id: z.string().optional(),
      text: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_add_comment", notionOps.notionAddComment)
);

server.registerTool(
  "notion_list_users",
  {
    description: "List all users in the workspace.",
    inputSchema: { page_size: z.number().optional().describe("Defaults to 50") },
  },
  wrap("notion_list_users", notionOps.notionListUsers)
);

server.registerTool(
  "notion_get_user",
  {
    description: "Get a single workspace user's info by user ID.",
    inputSchema: { user_id: z.string() },
  },
  wrap("notion_get_user", notionOps.notionGetUser)
);
}
