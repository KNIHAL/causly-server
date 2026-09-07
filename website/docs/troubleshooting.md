---
sidebar_position: 8
---

# Troubleshooting

Known, actionable issues — organized by the tool where they show up. If something isn't listed
here, check that tool's own page under [Tool categories](./tools/overview) for a "Known
limitation" note.

## GitHub — 403 on PR/Actions tools

If PR or Actions tools fail with `403`, the token is missing scope — it needs the "Pull requests"
and "Actions" permissions (fine-grained tokens) or `repo`/`workflow` scope (classic tokens). See
[GitHub setup](./tools/github#setup).

## Vercel — deployment tools fail

`vercel_create_deployment` (and `deploy_project`, which uses it) requires the target Vercel
project to already be git-linked. These tools trigger a deployment for an existing linked
project — they don't create that link for you.

## Supabase — `supabase_run_sql` returns 403

Some personal access tokens restrict raw SQL execution by default as an extra safety measure on
Supabase's side. Go back to the token's settings and confirm SQL execution is permitted, or
generate a new token with that permission enabled.

## Slack — `slack_search_messages` fails with `not_allowed_token_type`

This tool requires a Slack **user token** (`search:read` scope), not a bot token — bot tokens
(`xoxb-...`) cannot search. Every other Slack tool works fine with a bot token.

## Docker — `docker_push` fails

`docker_push` needs real registry authentication configured on the host running the server —
this isn't something the tool sets up for you.

## Sentry — `resolve_issue` / `ignore_issue` / `add_comment` fail

These three need an auth token with the `event:write` scope, in addition to the `project:read`
and `event:read` scopes the rest of the Sentry tools use.

## Gmail — setup fails or auth errors

Gmail uses OAuth2 (client ID + secret + refresh token), not a simple API key. Walk through the
full flow on the [Gmail setup](./tools/gmail#setup) page — a missing scope or an unexchanged
authorization code is the most common cause of auth errors.
