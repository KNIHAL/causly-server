# Roadmap

Current state: **106 tools**, 10 categories, 4 workflow tools, 3 MCP
resources, 4 MCP prompts, full security layer (redaction, permission
levels, approval gates, path protection, structured audit logs). See
[BUILD_LOG.md](./BUILD_LOG.md) for how we got here.

## Next up

### Deferred: Azure — cloud infrastructure

**Deferred until hosted MCP server launch.** Adding Azure now means
burning the $200 Azure credit during dev/test instead of at launch —
testing it properly requires a live subscription, and that trial clock
starts the moment a key is generated. Building and testing this
alongside the hosted server (open-source + hosted release together)
means the credit gets used once, right before launch, not wasted early.

- Account/subscription/resource-group listing
- App Service: list, get, deploy, restart
- Storage accounts, databases
- Monitoring: metrics, logs, health
- Deployment: deploy, get status, get logs

This becomes the foundation for the eventual **managed/continuous cloud
monitoring layer** — the open-source core stays request/response only (no
background watching); continuous monitoring is the paid product built on
top of these primitives.

### Hosted MCP server — current focus

Open-source local server is feature-complete for now (106 tools, 10
categories). Focus shifts to building the hosted version — Azure gets
added and tested as part of that build, timed to launch together.

## After that

- **`review-changes` → real review workflow tool** — currently only a
  guided MCP prompt; could become a proper workflow tool once there's a
  clear "what does a good review look like" spec.
- **`investigate-production` / `rollback_deployment` workflow tools** —
  incident-response primitives, once Azure/monitoring tools exist to
  support them.
- **MCP Resources for GitHub/Vercel state** (`causly://repo/{path}/prs`,
  `causly://deployment/{id}/status`) — same pattern as the existing
  project resources, extended to the services we already talk to.
- **Automated test suite** — mocked GitHub/Vercel/Supabase/Azure API
  tests, plus unit tests for the security layer (redaction,
  classification, path denial) and the workflow tools. Currently verified
  by hand against a disposable real GitHub repo (see BUILD_LOG.md) —
  good enough to ship, not good enough to stay unmonitored as the surface
  grows.
- **`npx -y causly-server`** installer — currently `git clone` + `npm
  install` + `npm run setup`. Roadmap goal is a single command that
  detects the environment, configures Claude Desktop, and verifies the
  connection.

## Explicitly not now

- **BYOK (bring your own key)** — people can already point their own
  tokens at this via `.env`; a dedicated BYOK flow isn't a priority while
  the server stays single-user/local.
- **Separate agent or chat interface** — Claude Desktop (MCP) is the only
  supported client for now. A standalone agent/UI is a possible future
  product, not part of this repo's scope.
- **Continuous/background cloud watching** — the open-source core is
  request/response only. Anything that runs unattended and watches
  infrastructure over time is the managed layer, not this repo.
