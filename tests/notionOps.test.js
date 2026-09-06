import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  notionSearch,
  notionGetPage,
  notionCreatePage,
  notionUpdatePage,
  notionGetDatabase,
  notionQueryDatabase,
  notionCreateDatabase,
  notionAppendBlockChildren,
  notionGetBlockChildren,
  notionUpdateBlock,
  notionDeleteBlock,
  notionGetComments,
  notionAddComment,
  notionListUsers,
  notionGetUser,
} from "../tools/notionOps.js";

const OK = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
const FAIL = (data, status = 400) => Promise.resolve({ ok: false, status, json: () => Promise.resolve(data) });

beforeEach(() => {
  process.env.NOTION_API_KEY = "secret_test";
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NOTION_API_KEY;
});

describe("notionOps", () => {
  it("throws if NOTION_API_KEY is missing", async () => {
    delete process.env.NOTION_API_KEY;
    await expect(notionSearch({})).rejects.toThrow(/NOTION_API_KEY not set/);
  });

  it("throws a descriptive error on a failed API call", async () => {
    global.fetch.mockReturnValueOnce(FAIL({ message: "Unauthorized", code: "unauthorized" }, 401));
    await expect(notionSearch({})).rejects.toThrow(/Unauthorized/);
  });

  it("sends Notion-Version and bearer auth headers", async () => {
    global.fetch.mockReturnValueOnce(OK({ results: [], has_more: false, next_cursor: null }));
    await notionSearch({});
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.notion.com/v1/search");
    expect(opts.headers.Authorization).toBe("Bearer secret_test");
    expect(opts.headers["Notion-Version"]).toBe("2022-06-28");
  });

  it("search extracts titles from multiple property shapes", async () => {
    global.fetch.mockReturnValueOnce(
      OK({
        results: [
          { id: "1", object: "page", url: "u1", properties: { title: { title: [{ plain_text: "A" }] } } },
          { id: "2", object: "page", url: "u2", properties: { Name: { title: [{ plain_text: "B" }] } } },
          { id: "3", object: "database", url: "u3", title: [{ plain_text: "C" }] },
          { id: "4", object: "page", url: "u4", properties: {} },
        ],
        has_more: true,
        next_cursor: "abc",
      })
    );
    const result = await notionSearch({ query: "test" });
    expect(result.results.map((r) => r.title)).toEqual(["A", "B", "C", null]);
    expect(result.has_more).toBe(true);
    expect(result.next_cursor).toBe("abc");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.query).toBe("test");
  });

  it("search applies filter_type as a property filter", async () => {
    global.fetch.mockReturnValueOnce(OK({ results: [], has_more: false, next_cursor: null }));
    await notionSearch({ filter_type: "database" });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.filter).toEqual({ property: "object", value: "database" });
  });

  it("getPage simplifies page fields", async () => {
    global.fetch.mockReturnValueOnce(
      OK({
        id: "p1",
        url: "u1",
        archived: false,
        created_time: "t1",
        last_edited_time: "t2",
        parent: { database_id: "d1" },
        properties: { Name: {} },
        extra: "dropped",
      })
    );
    const result = await notionGetPage({ page_id: "p1" });
    expect(result).not.toHaveProperty("extra");
    expect(result.id).toBe("p1");
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.notion.com/v1/pages/p1");
  });

  it("createPage builds parent object from parent_type", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "p2", url: "u2", properties: {} }));
    await notionCreatePage({ parent_id: "db1", parent_type: "database_id", properties: { Name: {} }, confirm: true });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.notion.com/v1/pages");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.parent).toEqual({ database_id: "db1" });
  });

  it("createPage defaults parent_type to page_id", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "p2", url: "u2", properties: {} }));
    await notionCreatePage({ parent_id: "pg1", properties: {}, confirm: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.parent).toEqual({ page_id: "pg1" });
  });

  it("updatePage sends only provided fields", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "p1", url: "u1", properties: {} }));
    await notionUpdatePage({ page_id: "p1", archived: true, confirm: true });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.notion.com/v1/pages/p1");
    expect(opts.method).toBe("PATCH");
    const body = JSON.parse(opts.body);
    expect(body).toEqual({ archived: true });
  });

  it("getDatabase extracts title text", async () => {
    global.fetch.mockReturnValueOnce(
      OK({ id: "d1", url: "u1", title: [{ plain_text: "Tasks" }], properties: {} })
    );
    const result = await notionGetDatabase({ database_id: "d1" });
    expect(result.title).toBe("Tasks");
  });

  it("queryDatabase forwards filter and sorts, simplifies results", async () => {
    global.fetch.mockReturnValueOnce(
      OK({
        results: [{ id: "p1", url: "u1", archived: false, properties: {} }],
        has_more: false,
        next_cursor: null,
      })
    );
    const filter = { property: "Status", select: { equals: "Done" } };
    const sorts = [{ property: "Date", direction: "descending" }];
    const result = await notionQueryDatabase({ database_id: "d1", filter, sorts });
    expect(result.results).toHaveLength(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.filter).toEqual(filter);
    expect(body.sorts).toEqual(sorts);
  });

  it("createDatabase wraps title as Notion rich text", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "d1", url: "u1", properties: {} }));
    await notionCreateDatabase({ parent_page_id: "pg1", title: "Tasks", properties: {}, confirm: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.parent).toEqual({ page_id: "pg1" });
    expect(body.title).toEqual([{ type: "text", text: { content: "Tasks" } }]);
  });

  it("appendBlockChildren reports count and simplified results", async () => {
    global.fetch.mockReturnValueOnce(
      OK({ results: [{ id: "b1", type: "paragraph" }, { id: "b2", type: "heading_1" }] })
    );
    const result = await notionAppendBlockChildren({ block_id: "blk1", children: [{}, {}], confirm: true });
    expect(result).toEqual({
      block_id: "blk1",
      appended: 2,
      results: [
        { id: "b1", type: "paragraph" },
        { id: "b2", type: "heading_1" },
      ],
    });
  });

  it("getBlockChildren maps content by block type", async () => {
    global.fetch.mockReturnValueOnce(
      OK({
        results: [{ id: "b1", type: "paragraph", has_children: false, paragraph: { rich_text: [] } }],
        has_more: false,
        next_cursor: null,
      })
    );
    const result = await notionGetBlockChildren({ block_id: "blk1" });
    expect(result.blocks[0].content).toEqual({ rich_text: [] });
    expect(global.fetch.mock.calls[0][0]).toContain("/blocks/blk1/children?page_size=50");
  });

  it("updateBlock PATCHes and confirms update", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "b1", type: "paragraph" }));
    const result = await notionUpdateBlock({ block_id: "b1", block_data: { paragraph: {} }, confirm: true });
    expect(result).toEqual({ id: "b1", type: "paragraph", updated: true });
    expect(global.fetch.mock.calls[0][1].method).toBe("PATCH");
  });

  it("deleteBlock issues a DELETE and confirms archival", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "b1" }));
    const result = await notionDeleteBlock({ block_id: "b1", confirm: true });
    expect(result).toEqual({ id: "b1", archived: true });
    expect(global.fetch.mock.calls[0][1].method).toBe("DELETE");
  });

  it("getComments extracts joined rich_text and author id", async () => {
    global.fetch.mockReturnValueOnce(
      OK({
        results: [
          {
            id: "c1",
            discussion_id: "disc1",
            created_time: "t1",
            rich_text: [{ plain_text: "Hello " }, { plain_text: "world" }],
            created_by: { id: "u1" },
          },
        ],
      })
    );
    const result = await notionGetComments({ block_id: "p1" });
    expect(result.comments[0].text).toBe("Hello world");
    expect(result.comments[0].created_by).toBe("u1");
  });

  it("addComment replies in a discussion when discussion_id is given", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "c1", discussion_id: "disc1" }));
    await notionAddComment({ discussion_id: "disc1", text: "reply", confirm: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.discussion_id).toBe("disc1");
    expect(body.parent).toBeUndefined();
  });

  it("addComment starts a new discussion on a page when no discussion_id given", async () => {
    global.fetch.mockReturnValueOnce(OK({ id: "c1", discussion_id: "disc2" }));
    await notionAddComment({ page_id: "pg1", text: "first comment", confirm: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.parent).toEqual({ page_id: "pg1" });
    expect(body.discussion_id).toBeUndefined();
  });

  it("listUsers maps person email when present", async () => {
    global.fetch.mockReturnValueOnce(
      OK({
        results: [
          { id: "u1", name: "Kumar", type: "person", person: { email: "k@example.com" } },
          { id: "u2", name: "Bot", type: "bot" },
        ],
        has_more: false,
        next_cursor: null,
      })
    );
    const result = await notionListUsers({});
    expect(result.users[0].email).toBe("k@example.com");
    expect(result.users[1].email).toBeNull();
  });

  it("getUser returns a single simplified user", async () => {
    global.fetch.mockReturnValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "u1", name: "Kumar", type: "person", person: { email: "k@example.com" } }),
    });
    const result = await notionGetUser({ user_id: "u1" });
    expect(result).toEqual({ id: "u1", name: "Kumar", type: "person", email: "k@example.com" });
  });
});
