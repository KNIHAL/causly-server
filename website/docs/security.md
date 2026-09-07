---
sidebar_position: 5
---

# Security

Every tool call is genuinely capable of changing your filesystem, your infrastructure, or your
production systems — so nothing runs unexamined. Four things happen before (and around) every
call, implemented in `tools/security.js`. This page covers the detailed model; see
[Architecture](./architecture#the-security-layer) for how it fits into the overall request flow.

## 1. Permission classification

Every registered tool carries a fixed risk level:

| Level | Meaning | Example |
|---|---|---|
| `READ` | Reads data, changes nothing | `git_status`, `docker_ps`, `sentry_list_issues` |
| `LOW` | Small, easily reversible changes | `git_add`, `notion_get_comments` |
| `MEDIUM` | Meaningful but recoverable changes | `git_commit`, `ship_change` |
| `HIGH` | Real-world side effects, needs explicit confirmation | `docker_build`, `deploy_project`, `slack_send_message` |
| `DESTRUCTIVE` | Hard or impossible to undo, needs explicit confirmation | `terraform_destroy`, `docker_rm`, `secrets_delete` |

## 2. The approval gate

Any `HIGH` or `DESTRUCTIVE` tool is rejected unless the caller passes `confirm: true` in its
input. This means Claude has to explicitly decide "yes, actually do this" — it can't be
accidentally triggered by a model just following a chain of reasoning.

## 3. Secret redaction

Before anything is written to `logs/activity.log`, every input is scanned and known-sensitive
fields (tokens, passwords, keys, connection strings, anything matching common credential
patterns) are replaced with a redacted placeholder — regardless of which tool or field they
appear in.

## 4. Command and path risk scanning

- `run_command` inputs are scanned for genuinely destructive patterns (drive wipes, `format`,
  `shutdown`) which are hard-blocked outright, and for elevated-risk-but-sometimes-legitimate
  patterns (force-push, `DROP TABLE`, `curl | bash`, `sudo`) which are flagged in the audit log
  rather than silently allowed.
- File and directory tools reject any target path that resolves inside a protected system
  directory (e.g. `C:\Windows`, `/etc`), regardless of how the path was constructed.

## Structured audit log

Every tool call — regardless of outcome — appends one JSON object to `logs/activity.log`:

```json
{"timestamp":"2026-09-02T11:29:08Z","operation_id":"a1b2c3","tool":"docker_build","risk":"HIGH","status":"ok","duration_ms":4210,"input":{"context_dir":"...","tag":"...","confirm":true}}
```

This is what makes the server auditable after the fact — a real trail of what ran, when, at what
risk level, and how long it took.

## Optional evidence layer: BoundaryAttest receipts (proof of concept)

An opt-in adapter can additionally produce portable, signed receipts for three workflow tools —
`ship_change`, `verify_ci_fix`, `deploy_project`. It is evidence only: it does not approve,
block, execute, or change a tool call, and does not replace any of the mechanisms above. See
[BoundaryAttest](./tools/boundaryattest) for the full spec, and note its own stated limits — this
is a proof of concept, not production key management.

## Security best practices for operators

- Never commit `.env` or the encrypted secrets file (`.causly-secrets.enc`) — both are
  git-ignored by default.
- Set `SECRETS_MASTER_KEY` to a securely generated, unique value per environment, and rotate it
  periodically with `secrets_rotate_key` (see [Secrets manager](./tools/secrets)).
- Review any `HIGH` or `DESTRUCTIVE` tool call before confirming it, especially `run_command`,
  `delete_file`, `delete_directory`, and `terraform_destroy`.
- Scope API tokens (`GITHUB_TOKEN`, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SLACK_BOT_TOKEN`,
  Gmail OAuth credentials, etc.) as narrowly as the platform allows, rather than using
  account-wide admin tokens.
- Run the server under a system user with the minimum filesystem and process permissions it
  actually needs.
- Keep dependencies up to date (`npm audit`).

## Reporting a vulnerability

Do not open a public GitHub issue for security vulnerabilities. Use GitHub's private
vulnerability reporting feature on the repository, or email the maintainer directly. Full policy,
scope, and disclosure process: [SECURITY.md](https://github.com/KNIHAL/causly-server/blob/main/SECURITY.md).
