---
sidebar_position: 9
---

# Vercel

11 tools for deployments, projects, and deployment verification. Implemented in
`tools/vercelOps.js`.

## Setup

1. Go to [vercel.com/account/tokens](https://vercel.com/account/tokens)
2. Create a new token
3. Add it to `.env` as `VERCEL_TOKEN`

## Tools

| Tool | Risk | What it does |
|---|---|---|
| `vercel_get_authenticated_user` | READ | Get the authenticated user/team |
| `vercel_list_projects` | READ | List Vercel projects |
| `vercel_get_project` | READ | Get details of a single project |
| `vercel_delete_project` | DESTRUCTIVE | Delete a project |
| `vercel_list_deployments` | READ | List recent deployments, optionally scoped to a project |
| `vercel_get_deployment` | READ | Get status/details of a specific deployment |
| `vercel_create_deployment` | HIGH | Trigger a new deployment from a git-connected project |
| `vercel_get_deployment_logs` | READ | Get build/runtime logs for a deployment |
| `vercel_get_deployment_events` | READ | Get a deployment's build/progress state |
| `vercel_cancel_deployment` | HIGH | Cancel a currently building or queued deployment |
| `http_check` | READ | Hit a URL and report status code, health, and response time |

`vercel_create_deployment` resolves the numeric GitHub repository ID automatically from an
`owner/repo` string before calling Vercel's API, since Vercel's deployment API requires the
numeric ID directly rather than accepting the string form.

## Example

```
"Deploy my project and confirm it's actually live once it's done."
```

Claude calls `vercel_create_deployment` (confirm: true) → polls `vercel_get_deployment` until
ready → `http_check` against the live URL to verify a real `200` response — the same sequence
[`deploy_project`](./workflow-tools) automates end to end.

## Known limitation

`vercel_create_deployment` (and `deploy_project`, which uses it) requires the target Vercel
project to already be git-linked — these tools trigger a deployment for an existing linked
project, they don't create that link for you.
