---
sidebar_position: 10
---

# Supabase

7 tools for the Supabase Management API — organizations, projects, and raw SQL execution.
Implemented in `tools/supabaseOps.js`.

## Setup

1. Log into [supabase.com/dashboard](https://supabase.com/dashboard)
2. Go to **Account** (top-right avatar) → **Access Tokens**
3. Click **Generate new token**, name it, copy it
4. Add it to `.env` as `SUPABASE_ACCESS_TOKEN`

This is an account-level token — it can see and manage every organization and project your
Supabase account has access to, not just one project. Treat it like any other credential with
broad scope.

## Tools

| Tool | Risk | What it does |
|---|---|---|
| `supabase_list_organizations` | READ | List organizations the authenticated account belongs to |
| `supabase_list_projects` | READ | List Supabase projects for the authenticated account |
| `supabase_get_project` | READ | Get details of a single project by its ref/ID |
| `supabase_create_project` | HIGH | Create a new Supabase project |
| `supabase_delete_project` | DESTRUCTIVE | Delete a Supabase project |
| `supabase_run_sql` | MEDIUM | Run raw SQL against a project's database — creating tables, altering schema, or querying data directly |

## Example

```
"List my Supabase projects, then show me the schema of the users table in the
'staging' project."
```

Claude calls `supabase_list_projects` to find the project ref for "staging", then
`supabase_run_sql` with a query against `information_schema.columns` to read the schema.

## Known limitation

`supabase_run_sql` uses the Management API's SQL execution endpoint. Some personal access
tokens restrict this capability by default as an extra safety measure on Supabase's side — if a
call returns `403`, go back to the token's settings and confirm SQL execution is permitted for
it, or generate a new token with that permission enabled.
