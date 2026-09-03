---
sidebar_position: 14
---

# Workflow tools & project intelligence

Individual tools are primitives. These chain them into real, verified outcomes — this is the
"AI employee" layer, in `tools/workflowOps.js` and `tools/projectOps.js`.

## Workflow tools

### `ship_change`

Inspects your current changes, creates or checks out a branch, runs your project's checks,
commits, pushes, and opens the PR — one call instead of eight.

### `fix_ci` + `verify_ci_fix`

`fix_ci` finds the latest failing GitHub Actions run for a branch, pulls the real job logs (not
just "it failed"), and returns them for diagnosis. Once the underlying code is fixed,
`verify_ci_fix` commits, pushes, and polls until the run is actually green — not just "pushed and
hoped."

### `deploy_project`

Checks project health, runs tests and the build, deploys, polls for completion, and then
HTTP-verifies the live URL is actually responding — not just "deployment triggered."

## Project intelligence

Auto-detects your stack instead of guessing generic commands:

- `project_detect` — language, framework, package manager
- `project_info` — structured summary of the above, plus resolved test/lint/build commands
- `project_health` — git cleanliness, ahead/behind, dependency status
- `run_tests`, `run_lint`, `run_typecheck`, `run_build` — run the correct command for the
  detected stack (`npm test` vs `pytest` vs `cargo test`, etc.) rather than assuming one
  ecosystem

## Example

```
"Ship this change."
```

Claude calls `project_health` → `run_tests`/`run_lint` → `ship_change` (confirm: true) — branch,
commit, push, PR, in one guided sequence instead of Claude re-deriving the steps each time.
