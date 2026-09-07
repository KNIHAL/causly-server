---
sidebar_position: 9
---

# Limitations

Current, structural limitations — things that are out of scope or not yet built, as opposed to
per-tool bugs (see [Troubleshooting](./troubleshooting) for those).

## Client support

Claude Desktop (or another MCP-compatible client) is the only supported way to use this server
today. There is no separate hosted agent or chat interface in this repository.

## No packaged installer yet

Setup is currently `git clone` + `npm install` + `.env` configuration + `npm run setup` (see
[Getting Started](./getting-started)). A single-command installer (`npx -y causly-server`) is
planned but not yet built.

## No continuous/background monitoring

The open-source core is request/response only — it acts when Claude calls a tool. Anything that
runs unattended and watches infrastructure over time (continuous cloud monitoring, alerting) is
not part of this repository.

## Direct Azure/GCP/AWS tools are out of scope for now

Terraform tools (already shipped) can provision and destroy cloud resources indirectly via
`plan`/`apply`/`destroy`. Direct-SDK cloud tools (account/resource listing, compute
management, runtime introspection independent of Terraform) are deliberately deferred — not
planned on a fixed timeline.

## BoundaryAttest is a proof of concept

The optional signed-receipt evidence layer covers only three workflow tools and uses an
operator-managed key file. It does not provide production key storage, rotation, revocation,
KMS/HSM integration, or a trust registry. See [Security](./security#optional-evidence-layer-boundaryattest-receipts-proof-of-concept).

## Per-tool limitations

Several individual tools have narrower, service-specific limitations (git-linked Vercel projects,
Slack bot vs. user tokens, Supabase SQL permissions, and others) — these are actionable and
covered in [Troubleshooting](./troubleshooting) and on each tool's own page.
