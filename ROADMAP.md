# Roadmap

Current state: **181 tools** across 16 categories — filesystem, git, shell,
GitHub, Vercel, Supabase, Slack, Gmail, Notion, Terraform, Docker,
Postgres/MySQL, a local encrypted secrets manager, Sentry, plus project
intelligence, workflow automation, and a full security layer (redaction,
permission levels, approval gates, path protection, structured audit logs).
An automated `vitest` test suite now covers every tool module (`npm test`),
on top of manual verification against real disposable resources.
See [BUILD_LOG.md](./BUILD_LOG.md) for how we got here.

## Next up

### BoundaryAttest server receipts — first POC

An opt-in, local `server_attested` receipt adapter now covers only `ship_change`, `verify_ci_fix`, and `deploy_project`. Before treating it as production infrastructure, key custody, rotation/revocation, multi-process persistence, and operational deployment policy still need explicit designs. The receipt layer remains evidence only and does not participate in Causly authorization.

### Planned: Azure / GCP / AWS — direct cloud infrastructure

Direct cloud-provider tools are on the roadmap and will be built — they're sequenced after the
hosted server (below) rather than immediately, since testing them properly requires a live cloud
subscription and real cost the moment a key is generated.

- Account/subscription/resource-group listing
- Compute: list, get, deploy, restart
- Storage accounts, managed databases
- Monitoring: metrics, logs, health
- Deployment: deploy, get status, get logs

Note: Terraform tools (already shipped) cover a good chunk of this
indirectly — provisioning and destroying cloud resources via `plan`/
`apply`/`destroy` works today, independent of any direct-SDK cloud
integration. Direct cloud tools will add runtime introspection/debugging
that Terraform alone doesn't give you.

### Planned: Hosted MCP server (Causly Hosted)

Open-source local server is feature-complete for the current tool set.
A managed, hosted version — run for you instead of on your own machine — is in active
development, with an early-access waitlist open today. Focus shifts here next.

### Planned: Local runtime installer

A single-command local runtime provider (`npx -y causly-server`) that detects the environment,
configures Claude Desktop, and verifies the connection — replacing today's `git clone` + `npm
install` + `.env` setup + `npm run setup` flow. See "After that" below for current detail; this
is confirmed future work, not just an idea.

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
