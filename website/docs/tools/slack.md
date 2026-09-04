---
sidebar_position: 11
---

# Slack

8 tools using the Slack Web API — channels, messages, and threads. Implemented in
`tools/slackOps.js`.

## Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app (or use an
   existing one) for your workspace
2. Under **OAuth & Permissions**, add these bot token scopes:
   - `channels:read`, `groups:read` — list channels
   - `groups:write` — required specifically for `slack_create_channel` with `is_private: true`
   - `chat:write` — send messages and thread replies
   - `users:read` — look up user info
   - `channels:history`, `groups:history` — read message history
3. Install the app to your workspace
4. Copy the **Bot User OAuth Token** (`xoxb-...`) into `.env` as `SLACK_BOT_TOKEN`

## Tools

| Tool | Risk | What it does |
|---|---|---|
| `slack_get_user` | READ | Look up a user's info by user ID |
| `slack_list_channels` | READ | List channels in the workspace |
| `slack_get_channel` | READ | Get details of a single channel |
| `slack_read_messages` | READ | Read recent message history from a channel |
| `slack_search_messages` | READ | Search messages across the workspace |
| `slack_send_message` | HIGH | Post a message to a channel |
| `slack_reply_thread` | HIGH | Reply in a thread |
| `slack_create_channel` | HIGH | Create a new channel |

`slack_list_channels` paginates automatically via Slack's `response_metadata.next_cursor` up to
the `limit` you request, so large workspaces don't silently get truncated to the first page.

## Example

```
"Check the #incidents channel for anything from the last hour, and post a summary
in #eng-updates."
```

Claude calls `slack_read_messages` on `#incidents` → `slack_send_message` (confirm: true) on
`#eng-updates`.

## Known limitation

`slack_search_messages` requires a Slack **user token** (`search:read` scope), not a bot token
— bot tokens return `not_allowed_token_type` for search specifically. Every other Slack tool
here works fine with a bot token.
