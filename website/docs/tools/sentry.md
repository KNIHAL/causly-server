---
sidebar_position: 8
---

# Sentry

8 tools for error monitoring and issue triage. Implemented in `tools/sentryOps.js`.

## Setup

1. Create an auth token at
   [sentry.io/settings/account/api/auth-tokens](https://sentry.io/settings/account/api/auth-tokens/)
   with at minimum `project:read` and `event:read` scopes — add `event:write` if you also want
   `resolve_issue`/`ignore_issue`/`add_comment` to work
2. Add it to `.env` as `SENTRY_AUTH_TOKEN`

Note: this is a **Sentry auth token**, not the DSN your app uses to *report* errors — those are
two different credentials with different purposes.

### EU data residency

Organizations on Sentry's EU region store data on `de.sentry.io` rather than `sentry.io`. Most
endpoints (org/project-scoped listing and search) work fine via the default `sentry.io` API host
regardless of region, but a handful of resource-specific lookups (like fetching a single issue by
ID) only resolve on the organization's actual host. `sentryOps.js` handles this automatically —
on a 404, it retries the same request against the other known region host before giving up. You
don't need to configure anything for this.

## Tools

| Tool | Risk | What it does |
|---|---|---|
| `sentry_list_projects` | READ | List projects in the organization |
| `sentry_list_issues` | READ | List recent issues for a project |
| `sentry_search_issues` | READ | Search issues with Sentry query syntax |
| `sentry_get_issue` | READ | Full detail — stack trace context, occurrence counts |
| `sentry_resolve_issue` | HIGH | Mark an issue resolved |
| `sentry_ignore_issue` | HIGH | Mute an issue |
| `sentry_get_project_stats` | READ | Error-count trends over a time period |
| `sentry_add_comment` | HIGH | Add a note to an issue |

## Example

```
"Show me unresolved errors on the api project from the last 24 hours."
```

Claude calls `sentry_search_issues` with `query: "is:unresolved"`.
