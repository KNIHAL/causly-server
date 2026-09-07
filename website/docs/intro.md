---
sidebar_position: 1
slug: /
---

# Introduction

## What Causly Server is

Causly Server is an [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server — a
process that runs on your own machine and exposes a set of tools that an MCP client (Claude
Desktop, or any other MCP-compatible client) can call directly inside a conversation.

It gives Claude 181 tools spanning the filesystem, git, GitHub, Docker, Terraform, databases, a
local secrets manager, monitoring (Sentry), documentation (Notion), communication (Slack, Gmail),
and deployment (Vercel) — plus a set of higher-level workflow tools that chain those primitives
into verified, end-to-end outcomes (`ship_change`, `fix_ci` + `verify_ci_fix`, `deploy_project`).

## The problem it's for

Building and shipping a real product normally means constantly switching context — write code,
open a terminal, check Docker, log into Notion, check Sentry, SSH into a database, run Terraform,
check Slack. Causly Server puts all of that inside one conversation with Claude: you describe
what you want, Claude does the actual work through these tools, and reports back a verified
result rather than a guess.

It's aimed at solo founders and small teams without a dedicated DevOps person — the tool surface
plays that role, running locally under guardrails the operator controls.

## How it works, at a high level

Causly Server is a single Node.js process (`index.js`) that:

1. Starts an MCP server over stdio
2. Registers every tool, resource, and prompt
3. Routes each incoming tool call through a security layer (classification, redaction, the
   approval gate) before it touches your filesystem, a database, a cloud API, or anything else
4. Executes the actual operation
5. Writes a structured, redacted line to `logs/activity.log`
6. Returns the result to the client

See [Architecture](./architecture) for the full breakdown, and [Security](./security) for the
detailed security model.

## Current scope

- **Local, single-user, Claude Desktop (or any MCP client)** — there is no separate hosted agent
  or chat interface in this repository. See [Limitations](./limitations).
- **181 tools across 16 categories** — the full list is in [Tool categories](./tools/overview).
- **Open source, MIT licensed** — the code is the reference implementation; a managed "Causly
  Hosted" offering is in development separately (see [Deployment](./deployment)).
