# Causly Server — Next Version Plan (`cofounder`)

Status: **DRAFT — no code until this plan is finalized.**
Branch: `cofounder` (off `master`, after PR #28 merged).

## Goal

Build a server that makes **any agent a technical co-founder**: it can code, research, sell, and communicate with the team. Name and SDLC tagline stay the same. Safety, privacy, tools, intelligence and prompts all live in this server.

**Rule for every decision: avoid overengineering.** If a feature is not needed by the goal above, it is deferred.

Out of scope: anything related to `causly-hosted`; Azure/GCP/AWS direct-cloud tools.

A future agent, **ko-founder**, will use this server.

## Principles

- Free tools and APIs only, to start.
- Works with Claude, Cursor, Windsurf and custom agents (CrewAI, LangChain, pure JS/Python).
- Installed once, lives on the machine until uninstalled. Docker is never required.
- Anything that can cause serious harm needs approval. Plain file and simple git operations stay simple.

## Phase 0 — Foundation (everything else depends on it)

1. **Pack registry + lazy loading.** Each tool group is a "pack" with a small descriptor (name, description, tools, required env vars). The server reads only descriptors at startup and loads a pack's code when needed. Includes a few meta-tools (`search_tools`, `load_toolset`) and env-based profiles (e.g. `CAUSLY_TOOLSETS=git,github`). Goal: stay well under client tool limits (Cursor warns around 40 tools).
2. **`index.js` refactor.** Split the 1450+ line file into the pack structure. Done together with step 1, not separately.
3. **Safety layer.**
   - Approval gates and dry-run for risky actions (e.g. `terraform_destroy`, `delete_repo`, `delete_project`, `docker_remove`, anything that emails a real person, publishes publicly, or moves money).
   - Audit log.
   - Secret redaction in tool outputs.
   - Rate limits on outbound actions.
4. **Local store + scheduler (SQLite).** Shared by pipeline, follow-ups, reminders, approvals and audit state.
5. **Workspace jail.** Agent works inside one project folder: file tools cannot leave it, commands use allow/deny lists, timeouts and output limits, risky ones need approval.
6. **MCP prompts.** Ship ready-made prompts from the server (co-founder system prompt, playbooks like "research this lead", "plan this week's content") so any connecting agent gets them with no extra engine.

## Phase 1 — Tool packs (build order)

| # | Pack | Difficulty | Notes |
|---|------|-----------|-------|
| 1 | Web research | Easy | Search + page fetch, no account needed |
| 2 | Leads | Medium | Free tiers of Hunter/Apollo are limited (verify current limits); mix in HN "who's hiring", GitHub. Skip LinkedIn |
| 3 | SEO + content | Medium | Google Search Console (free), free keyword ideas via autocomplete/Trends. Real volume/difficulty data is paid, so numbers are rougher. Drafts and publishing are approval-gated |
| 4 | Pipeline (HubSpot free) | Medium | Contacts, deals, stages, notes |
| 5 | Outreach (on Gmail) | Medium | Drafts, follow-up tracking, reply triage. Nothing sent without approval |
| 6 | Google Calendar | Medium | Reuses Gmail OAuth with extra scopes |
| 7 | Telegram | Easy | Bot token only |
| 8 | Linear | Easy | GraphQL API key |
| 9 | Stripe | Easy | Test mode first; money actions approval-gated |
| 10 | Discord | Easy–Medium | Bot token + permissions setup |
| 11 | Meeting notes | Medium | Needs Calendar; starts with pasted/uploaded transcripts |

Each pack is built one at a time and fully tested before starting the next.

Possible gaps (not committed): analytics (Google Analytics), proposal/PDF generation, alerts (e.g. Telegram ping when a lead replies).

Skipped for now: WhatsApp, LinkedIn, X posting.

## Phase 2 — Distribution and compatibility

- `npm install -g causly-server` (one-time install). `npx` stays available for quick trials.
- `causly-server init` writes config into Claude Desktop, Cursor and Windsurf. These clients start the server themselves (stdio), so users never run it by hand.
- `causly-server start`: optional local HTTP mode for always-on use by custom agents, with optional auto-start on login. Built after stdio works.
- Build and test custom agents in pure JS, pure Python, CrewAI and LangChain.
- Contribute to open-source agent frameworks via integration examples/docs PRs using their MCP adapters (a native "tool" PR is unlikely to land).
- List on MCP registries (e.g. Smithery).

## Deferred

- Docker sandbox for `run_command` (opt-in, only if users ask). Server runs on the host; Docker is used only if already installed. Never handing the Docker socket to a containerized server.
- Semantic tool search (keyword search is enough for now).
- Eval harness comparing with/without lazy loading (nice proof, not required).
- Playbooks as a separate YAML engine (MCP prompts cover the need).
- Full local runtime environment beyond the workspace jail.

## Open questions

- Exact free-tier limits for lead and SEO data sources (to verify before building packs 2 and 3).
- Which actions go on the approval list beyond the ones named above.
- Where approvals surface for custom agents with no UI (e.g. Telegram prompt vs. CLI).
