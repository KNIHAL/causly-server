---
sidebar_position: 6
---

# Deployment

Causly Server itself is not "deployed" as a hosted service today — it runs as a local process on
the machine you install it on, launched by Claude Desktop (or another MCP client) via `node
index.js`. There is currently no documented method for running it as a standalone hosted service.

## Deploying your own projects

What Causly Server *does* provide today is tooling to deploy the projects you're working on
through Claude:

- [Vercel](./tools/vercel) — trigger deployments, poll status, verify a live URL is actually
  responding
- [Docker](./tools/docker) — build images, run/manage containers, `compose up`/`down`
- [Terraform](./tools/terraform) — full IaC lifecycle (plan/apply/destroy/state), plus a CI
  plan-comment hook
- [`deploy_project`](./tools/workflow-tools) — chains project health checks, tests, build, a
  Vercel deployment, and an HTTP health check into one verified action

## Causly Hosted

**Coming soon:** a managed version of Causly Server, run for you instead of on your own machine,
is in development. There is an early-access waitlist:
[→ Join the Causly Hosted waitlist](https://tally.so/r/NpZkpW). This documentation site covers
the open-source local server; hosted-specific documentation will be added once that product is
available.
