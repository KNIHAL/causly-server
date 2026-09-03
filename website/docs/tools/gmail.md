---
sidebar_position: 12
---

# Gmail

8 tools using the Gmail API with OAuth2 — search, read, send, reply, forward. Implemented in
`tools/gmailOps.js`.

## Setup

Gmail uses OAuth2 (client ID + secret + refresh token), not a simple API key, because Gmail
access is tied to a specific Google account rather than a project-level API key:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/), create a project (or use
   an existing one)
2. Enable the **Gmail API** for that project
3. Under **Credentials**, create an **OAuth 2.0 Client ID** (application type: Desktop app) —
   this gives you a client ID and client secret
4. Go to [Google's OAuth Playground](https://developers.google.com/oauthplayground), click the
   gear icon (top-right) and check **Use your own OAuth credentials**, entering the client ID/
   secret from step 3
5. In the scopes list, authorize whichever of these you need:
   `https://www.googleapis.com/auth/gmail.readonly`,
   `https://www.googleapis.com/auth/gmail.send`,
   `https://www.googleapis.com/auth/gmail.modify`
6. Click **Authorize APIs**, sign in, then **Exchange authorization code for tokens** — this
   gives you a refresh token
7. Add all three values to `.env`: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
   `GMAIL_REFRESH_TOKEN`

## Tools

| Tool | Risk | What it does |
|---|---|---|
| `gmail_get_profile` | READ | Get the authenticated account's profile — connectivity check |
| `gmail_search` | READ | Search messages using Gmail search syntax (`from:`, `subject:`, etc.) |
| `gmail_list_messages` | READ | List recent messages, optionally scoped to a label |
| `gmail_get_message` | READ | Get a single message's decoded content by message ID |
| `gmail_get_thread` | READ | Get a full thread (all messages in it) by thread ID |
| `gmail_send` | HIGH | Send a new email |
| `gmail_reply` | HIGH | Reply to an existing message in the same thread |
| `gmail_forward` | HIGH | Forward an existing message to a new recipient |

## Example

```
"Find the latest email from our Vercel billing alerts and forward it to me
with a summary."
```

Claude calls `gmail_search` with a query like `from:vercel.com subject:billing` →
`gmail_forward` (confirm: true) with the matched message ID.
