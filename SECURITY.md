# Security Policy

Causly is an MCP server that gives an AI model the ability to execute shell
commands, read/write files, manage git repositories, and call third-party
APIs (GitHub, Vercel, Supabase, Slack, Gmail, Notion, Sentry, and more) on
behalf of the person running it. Because it performs real actions against
real machines and real infrastructure, security issues here can have a
direct, tangible impact — we take reports seriously and appreciate
responsible disclosure.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.5.x   | :white_check_mark: |
| < 1.5   | :x:                 |

Only the latest minor release on the `master` branch receives security
fixes. Please upgrade to the latest version before reporting an issue, in
case it has already been addressed.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report it privately using one of the following:

- GitHub's [private vulnerability reporting](../../security/advisories/new)
  feature on this repository (preferred), or
- Email the maintainer directly (see the profile on the repository owner's
  GitHub page for contact details).

Please include as much of the following as you can:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof-of-concept
- The affected tool(s)/file(s) and version
- Any suggested mitigation, if you have one

### What to expect

- **Acknowledgement:** within 3 business days of your report.
- **Initial assessment:** within 7 business days, including whether the
  report is accepted, needs more information, or is declined (with reasoning).
- **Fix & disclosure:** we aim to ship a patch as quickly as the severity
  warrants. Once a fix is released, we will credit the reporter (unless you
  prefer to remain anonymous) and publish a summary via a GitHub Security
  Advisory.

We ask that you give us a reasonable window to fix the issue before any
public disclosure.

## Scope

The following are considered in-scope for security reports:

- Command injection, path traversal, or arbitrary file access beyond what a
  tool's documented parameters allow
- Bypasses of the approval/confirmation layer (e.g. a `HIGH` or
  `DESTRUCTIVE` tool executing without `confirm: true`)
- Bypasses of the blocked-command list (`commandOps.js`) or the protected
  system-path denylist (`security.js`)
- Credential or secret leakage — logs, error messages, or tool output that
  expose API keys, tokens, or values from `.env` / the encrypted secrets
  store (`secretsOps.js`) in plaintext
- Any way a tool call could exfiltrate data to an unintended destination
- Vulnerabilities in a direct dependency that are reachable through Causly's
  own code paths

The following are generally **out of scope**:

- Vulnerabilities that require the operator to have already granted the AI
  model unrestricted, unsupervised execution of arbitrary tools with no
  human oversight — Causly is designed to be run by someone who reviews
  `HIGH`/`DESTRUCTIVE` actions before confirming them
- Issues in third-party services Causly integrates with (GitHub, Vercel,
  Supabase, Slack, Gmail, Notion, Sentry) — please report those to the
  respective vendor
- Missing security best-practices in example/demo configuration that is
  clearly marked as such

## Security Best Practices for Users

If you run causly-server, we recommend:

- Never commit `.env` or the encrypted secrets file (`.causly-secrets.enc`)
  to version control — both are already git-ignored by default.
- Set `SECRETS_MASTER_KEY` to a securely generated, unique value per
  environment, and rotate it periodically using the built-in
  `secrets_rotate_key` tool.
- Review any `HIGH` or `DESTRUCTIVE` risk-level tool call (as flagged by
  `security.js`) before confirming it, especially `run_command`,
  `delete_file`, `delete_directory`, and `terraform_destroy`.
- Scope API tokens (`GITHUB_TOKEN`, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`,
  `SLACK_BOT_TOKEN`, Gmail OAuth credentials, etc.) as narrowly as the
  platform allows, rather than using account-wide admin tokens.
- Run causly-server under a system user with the minimum filesystem and
  process permissions it actually needs.
- Keep dependencies up to date (`npm audit`) and update to the latest
  causly-server release promptly when a security advisory is published.

## Disclosure Policy

We follow a coordinated disclosure process: once a reported vulnerability
is fixed and released, we publish a GitHub Security Advisory describing the
issue, its impact, affected versions, and the fix. We credit reporters who
wish to be credited.

Thank you for helping keep Causly and its users safe.
