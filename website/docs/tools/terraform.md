---
sidebar_position: 4
---

# Terraform

20 tools wrapping the local `terraform` CLI — the full lifecycle, state management, and a
GitHub-integrated CI hook. Implemented in `tools/terraformOps.js`.

## Setup

Install the [Terraform CLI](https://developer.hashicorp.com/terraform/install) and make sure
`terraform` is on your `PATH`. No API key required — these tools shell out to the CLI directly.

## Core lifecycle (9 tools)

| Tool | Risk | What it does |
|---|---|---|
| `terraform_init` | LOW | Initialize a working directory, download providers |
| `terraform_validate` | READ | Validate config syntax and internal consistency |
| `terraform_fmt` | LOW | Format `.tf` files to canonical style |
| `terraform_plan` | READ | Show what would change |
| `terraform_apply` | DESTRUCTIVE | Apply changes to reach the desired state |
| `terraform_destroy` | DESTRUCTIVE | Destroy all resources managed by the config |
| `terraform_show` | READ | Show current state or a saved plan |
| `terraform_output` | READ | Read output values from state |
| `terraform_workspace` | MEDIUM | Manage workspaces (dev/staging/prod) — list/new/select/delete |

## State & advanced (10 tools)

| Tool | Risk | What it does |
|---|---|---|
| `terraform_state_list` | READ | List resources tracked in state |
| `terraform_state_show` | READ | Show a single resource's attributes |
| `terraform_state_mv` | HIGH | Move a resource to a new state address |
| `terraform_state_rm` | HIGH | Stop tracking a resource, without destroying it |
| `terraform_state_pull` | READ | Download raw remote state as JSON |
| `terraform_import` | HIGH | Bring an existing real-world resource under management |
| `terraform_taint` | HIGH | Force a resource to be destroyed and recreated next apply |
| `terraform_untaint` | LOW | Remove a resource's tainted mark |
| `terraform_graph` | READ | Generate a dependency graph (DOT format) |
| `terraform_providers` | READ | List required providers and resolved versions |

## CI/CD hook (1 tool)

**`terraform_plan_comment`** (HIGH) — runs `terraform plan`, formats a Markdown summary, and
posts it as a comment on a GitHub pull request (via the same GitHub tooling used elsewhere in
this server) — so a reviewer sees the infrastructure diff before approving, without leaving the
PR.

## Example

```
"Run a plan against ./infra/staging and post the result as a comment on PR #42."
```

Claude calls `terraform_plan_comment` with `dir`, `owner`, `repo`, and `pull_number` — no manual
copy-pasting plan output into GitHub.
