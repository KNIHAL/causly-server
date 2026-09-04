---
sidebar_position: 3
---

# Notion

15 tools covering search, page/database CRUD, block content, comments, and workspace users —
implemented in `tools/notionOps.js`.

## Setup

1. Create an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Copy its **Internal Integration Secret** into `.env` as `NOTION_API_KEY`
3. Open the page or database you want Claude to access in Notion, click **`...`** →
   **Connections**, and add your integration

That last step is required for every page/database individually — Notion's API only exposes
content that's been explicitly shared with the integration, even with a valid token.

## Tools

| Tool | Risk | What it does |
|---|---|---|
| `notion_search` | READ | Search pages and databases across the workspace |
| `notion_get_page` | READ | Get a page's properties and metadata |
| `notion_create_page` | HIGH | Create a page under a parent page or database |
| `notion_update_page` | HIGH | Update properties, or archive/restore a page |
| `notion_get_database` | READ | Get a database's schema |
| `notion_query_database` | READ | Query rows with filter/sort |
| `notion_create_database` | HIGH | Create a database under a parent page |
| `notion_append_block_children` | HIGH | Add content blocks to a page or block |
| `notion_get_block_children` | READ | Read a page's/block's child blocks |
| `notion_update_block` | HIGH | Edit an existing block's content |
| `notion_delete_block` | HIGH | Archive a block |
| `notion_get_comments` | READ | Read comments on a page or block |
| `notion_add_comment` | HIGH | Add a comment or reply |
| `notion_list_users` | READ | List all workspace users |
| `notion_get_user` | READ | Get a single user's info |

## Example

```
"Search my Notion workspace for a page about the Q3 roadmap, and add a comment
summarizing what we just shipped."
```

Claude calls `notion_search` → `notion_add_comment` (with `confirm: true`), using the real page ID
from the search result.
