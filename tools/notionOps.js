const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function getToken() {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    throw new Error(
      "NOTION_API_KEY not set. Run `npm run setup` to configure it, or add it manually to your .env file: NOTION_API_KEY=secret_..."
    );
  }
  return token;
}

async function notionFetch(path, { method = "GET", body } = {}) {
  const token = getToken();
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Notion API error (${path}): ${data.message || data.code || "unknown_error"}`);
  }
  return data;
}

function simplifyPage(p) {
  return {
    id: p.id,
    url: p.url,
    archived: p.archived,
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
    parent: p.parent,
    properties: p.properties,
  };
}

/** Search pages and databases across the workspace. */
export async function notionSearch({ query, filter_type, page_size = 20 }) {
  const body = { page_size };
  if (query) body.query = query;
  if (filter_type) body.filter = { property: "object", value: filter_type };
  const data = await notionFetch("/search", { method: "POST", body });
  return {
    results: data.results.map((r) => ({
      id: r.id,
      object: r.object,
      url: r.url,
      title:
        r.properties?.title?.title?.[0]?.plain_text ||
        r.properties?.Name?.title?.[0]?.plain_text ||
        r.title?.[0]?.plain_text ||
        null,
    })),
    has_more: data.has_more,
    next_cursor: data.next_cursor,
  };
}

/** Get a single page's properties and metadata by page ID. */
export async function notionGetPage({ page_id }) {
  const data = await notionFetch(`/pages/${page_id}`);
  return simplifyPage(data);
}

/** Create a new page under a parent page or database. HIGH risk — requires confirm: true. */
export async function notionCreatePage({ parent_id, parent_type = "page_id", properties, children, confirm }) {
  const body = {
    parent: { [parent_type]: parent_id },
    properties,
  };
  if (children) body.children = children;
  const data = await notionFetch("/pages", { method: "POST", body });
  return simplifyPage(data);
}

/** Update an existing page's properties, or archive/restore it. HIGH risk — requires confirm: true. */
export async function notionUpdatePage({ page_id, properties, archived, confirm }) {
  const body = {};
  if (properties) body.properties = properties;
  if (archived !== undefined) body.archived = archived;
  const data = await notionFetch(`/pages/${page_id}`, { method: "PATCH", body });
  return simplifyPage(data);
}

/** Get a database's schema and metadata by database ID. */
export async function notionGetDatabase({ database_id }) {
  const data = await notionFetch(`/databases/${database_id}`);
  return {
    id: data.id,
    url: data.url,
    title: data.title?.[0]?.plain_text || null,
    properties: data.properties,
  };
}

/** Query a database's rows with optional filter and sort. */
export async function notionQueryDatabase({ database_id, filter, sorts, page_size = 20 }) {
  const body = { page_size };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  const data = await notionFetch(`/databases/${database_id}/query`, { method: "POST", body });
  return {
    results: data.results.map(simplifyPage),
    has_more: data.has_more,
    next_cursor: data.next_cursor,
  };
}

/** Create a new database under a parent page. HIGH risk — requires confirm: true. */
export async function notionCreateDatabase({ parent_page_id, title, properties, confirm }) {
  const body = {
    parent: { page_id: parent_page_id },
    title: [{ type: "text", text: { content: title } }],
    properties,
  };
  const data = await notionFetch("/databases", { method: "POST", body });
  return {
    id: data.id,
    url: data.url,
    title,
    properties: data.properties,
  };
}

/** Append content blocks (text, lists, tables, etc.) to a page or block. HIGH risk — requires confirm: true. */
export async function notionAppendBlockChildren({ block_id, children, confirm }) {
  const data = await notionFetch(`/blocks/${block_id}/children`, {
    method: "PATCH",
    body: { children },
  });
  return { block_id, appended: data.results.length, results: data.results.map((r) => ({ id: r.id, type: r.type })) };
}

/** Get the child blocks of a page or block. */
export async function notionGetBlockChildren({ block_id, page_size = 50 }) {
  const data = await notionFetch(`/blocks/${block_id}/children?page_size=${page_size}`);
  return {
    block_id,
    blocks: data.results.map((b) => ({ id: b.id, type: b.type, has_children: b.has_children, content: b[b.type] })),
    has_more: data.has_more,
    next_cursor: data.next_cursor,
  };
}

/** Update an existing block's content. HIGH risk — requires confirm: true. */
export async function notionUpdateBlock({ block_id, block_data, confirm }) {
  const data = await notionFetch(`/blocks/${block_id}`, { method: "PATCH", body: block_data });
  return { id: data.id, type: data.type, updated: true };
}

/** Delete (archive) a block. HIGH risk — requires confirm: true. */
export async function notionDeleteBlock({ block_id, confirm }) {
  const data = await notionFetch(`/blocks/${block_id}`, { method: "DELETE" });
  return { id: data.id, archived: true };
}

/** Get comments on a page or block. */
export async function notionGetComments({ block_id }) {
  const data = await notionFetch(`/comments?block_id=${block_id}`);
  return {
    comments: data.results.map((c) => ({
      id: c.id,
      discussion_id: c.discussion_id,
      created_time: c.created_time,
      text: c.rich_text?.map((t) => t.plain_text).join("") || "",
      created_by: c.created_by?.id,
    })),
  };
}

/** Add a comment to a page, or reply in an existing discussion thread. HIGH risk — requires confirm: true. */
export async function notionAddComment({ page_id, discussion_id, text, confirm }) {
  const body = { rich_text: [{ text: { content: text } }] };
  if (discussion_id) {
    body.discussion_id = discussion_id;
  } else {
    body.parent = { page_id };
  }
  const data = await notionFetch("/comments", { method: "POST", body });
  return { id: data.id, discussion_id: data.discussion_id, posted: true };
}

/** List all users in the workspace. */
export async function notionListUsers({ page_size = 50 }) {
  const data = await notionFetch(`/users?page_size=${page_size}`);
  return {
    users: data.results.map((u) => ({
      id: u.id,
      name: u.name,
      type: u.type,
      email: u.person?.email || null,
    })),
    has_more: data.has_more,
    next_cursor: data.next_cursor,
  };
}

/** Get a single workspace user's info by user ID. */
export async function notionGetUser({ user_id }) {
  const u = await notionFetch(`/users/${user_id}`);
  return {
    id: u.id,
    name: u.name,
    type: u.type,
    email: u.person?.email || null,
  };
}
