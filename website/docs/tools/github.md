---
sidebar_position: 2
---

# GitHub

27 tools covering repos, issues, the complete PR lifecycle, and GitHub Actions/CI. Implemented
in `tools/githubOps.js`.

## Setup

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Generate a token (classic or fine-grained) with `repo` scope — add `workflow` scope too if
   you want `github_rerun_workflow` to work
3. Add it to `.env` as `GITHUB_TOKEN`

## Repos & issues

| Tool | Risk | What it does |
|---|---|---|
| `github_get_authenticated_user` | READ | Get the authenticated user's profile |
| `github_list_repos` | READ | List repositories for the authenticated user |
| `github_get_repo` | READ | Get a repository's details (default branch, visibility, language, etc.) |
| `github_create_repo` | HIGH | Create a new repository |
| `github_delete_repo` | DESTRUCTIVE | Delete a repository |
| `github_list_issues` | READ | List issues on a repository |
| `github_get_issue` | READ | Get a single issue's details |
| `github_create_issue` | MEDIUM | Create an issue |
| `github_update_issue` | MEDIUM | Update an issue's title, body, state, or labels |
| `github_add_comment` | MEDIUM | Add a comment to an issue or pull request |

## Pull requests

| Tool | Risk | What it does |
|---|---|---|
| `github_list_pull_requests` | READ | List pull requests |
| `github_get_pull_request` | READ | Get a single PR's details, including mergeable status |
| `github_create_pull_request` | MEDIUM | Create a pull request |
| `github_update_pull_request` | MEDIUM | Update a PR's title, body, state, or base branch |
| `github_merge_pull_request` | HIGH | Merge a pull request |
| `github_get_pull_request_diff` | READ | Get the full raw diff of a PR |
| `github_get_pull_request_files` | READ | List files changed in a PR, with additions/deletions |
| `github_get_pull_request_comments` | READ | List conversation comments on a PR |
| `github_get_pull_request_reviews` | READ | List reviews (approved/changes-requested/commented) |

## Branches

| Tool | Risk | What it does |
|---|---|---|
| `github_get_branch` | READ | Get a single branch's details, including protection status |
| `github_list_branches` | READ | List branches on a repository |

## Actions / CI

| Tool | Risk | What it does |
|---|---|---|
| `github_list_workflows` | READ | List workflows defined in a repository |
| `github_list_workflow_runs` | READ | List recent workflow runs, optionally filtered by branch/status |
| `github_get_workflow_run` | READ | Get details of a single run (status, conclusion, timestamps) |
| `github_get_workflow_run_jobs` | READ | List jobs in a run, with per-step status |
| `github_get_job_logs` | READ | Get the raw log text for a specific failed job |
| `github_rerun_workflow` | MEDIUM | Re-run a workflow run |

## Example

```
"Find the latest failing CI run on the main branch and show me why it failed."
```

Claude calls `github_list_workflow_runs` (filtered to `main`, failed status) →
`github_get_workflow_run_jobs` → `github_get_job_logs` for the failing job — the exact sequence
[`fix_ci`](./workflow-tools) automates for you.

See also: [Workflow tools](./workflow-tools) — `ship_change` and `fix_ci` chain several of these
GitHub tools together into a single verified action.
