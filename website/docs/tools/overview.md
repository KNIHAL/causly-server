---
sidebar_position: 1
---

# Tool categories

Every service this server talks to, grouped the way an actual product touches them — not an
alphabetical dump. 181 tools total.

| Category | Tools | What it's for |
|---|---|---|
| [Filesystem, Git & Shell](./filesystem-git-shell) | 31 | The primitive layer — files, directories, git, raw commands |
| [GitHub](./github) | 27 | Repos, issues, full PR lifecycle, Actions/CI |
| [Notion](./notion) | 15 | Pages, databases, blocks, comments, users |
| [Terraform](./terraform) | 20 | Full IaC lifecycle, state management, CI plan-comment hook |
| [Docker](./docker) | 18 | Containers, images, compose — cross-platform |
| [Database (Postgres/MySQL)](./database) | 8 | Generic SQL query and schema tools |
| [Secrets manager](./secrets) | 6 | Local AES-256-GCM encrypted secret storage |
| [Sentry](./sentry) | 8 | Error monitoring, issue triage |
| [Vercel](./vercel) | 11 | Deployments, projects, logs, health checks |
| [Supabase](./supabase) | 7 | Projects, organizations, raw SQL |
| [Slack](./slack) | 8 | Channels, messages, threads |
| [Gmail](./gmail) | 8 | Search, read, send, reply, forward (OAuth2) |
| [Project intelligence](./workflow-tools#project-intelligence) | 7 | Stack detection, test/lint/build runners |
| [Workflow tools](./workflow-tools) | 4 | `ship_change`, `fix_ci`, `verify_ci_fix`, `deploy_project` |

Every tool call passes through the same [security layer](../architecture#the-security-layer) —
classified by risk, redacted before logging, and gated behind `confirm: true` for anything `HIGH`
or `DESTRUCTIVE`.
