# Roadmap

Current state: **181 tools** across 16 categories — filesystem, git, shell,
GitHub, Vercel, Supabase, Slack, Gmail, Notion, Terraform, Docker,
Postgres/MySQL, a local encrypted secrets manager, Sentry, plus project
intelligence, workflow automation, and a full security layer (redaction,
permission levels, approval gates, path protection, structured audit logs).
See [BUILD_LOG.md](./BUILD_LOG.md) for how we got here.

## Next up

### Deferred: Azure / GCP / AWS — direct cloud infrastructure

**Deliberately out of scope for now.** Testing any of these properly
requires a live cloud subscription and burns real credit/cost the moment
a key is generated — not worth it until there's an actual need driving it.
Revisit if/when that need shows up, not on a fixed timeline.

- Account/subscription/resource-group listing
- Compute: list, get, deploy, restart
- Storage accounts, managed databases
- Monitoring: metrics, logs, health
- Deployment: deploy, get status, get logs

Note: Terraform tools (already shipped) cover a good chunk of this
indirectly — provisioning and destroying cloud resources via `plan`/
`apply`/`destroy` works today, independent of any direct-SDK cloud
integration. Direct cloud tools would add runtime introspection/debugging
that Terraform alone doesn't give you.

### Hosted MCP server

Open-source local server is feature-complete for the current tool set.
Focus shifts to building the hosted version.

## After that

- **`review-changes` → real review workflow tool** — currently only a
  guided MCP prompt; could become a proper workflow tool once there's a
  clear "what does a good review look like" spec.
- **`investigate-production` / `rollback_deployment` workflow tools** —
  incident-response primitives, now that Sentry (monitoring) tools exist
  to support them.
- **MCP Resources for GitHub/Vercel/Sentry state** (`causly://repo/{path}/prs`,
  `causly://deployment/{id}/status`, `causly://sentry/{project}/issues`) —
  same pattern as the existing project resources, extended to the services
  we already talk to.
- **Automated test suite** — mocked API tests for every service module,
  plus unit tests for the security layer (redaction, classification, path
  denial) and the workflow tools. Currently verified by hand against real
  disposable resources (a throwaway GitHub repo, Docker containers, DB
  instances, a Sentry project — see BUILD_LOG.md) — good enough to ship,
  not good enough to stay unmonitored as the surface grows.
- **`npx -y causly-server`** installer — currently `git clone` + `npm
  install` + `.env` setup + `npm run setup`. Roadmap goal is a single
  command that detects the environment, configures Claude Desktop, and
  verifies the connection.
- **Jira/Linear tools** — only if real demand shows up; not planned by
  default.

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
