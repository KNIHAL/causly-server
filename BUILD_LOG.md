# Build Log

A running account of what was built, in what order, and why — including
bugs found and fixed along the way. See [ROADMAP.md](./ROADMAP.md) for
what's planned next.

## Vision shift

Causly Server started as a general-purpose MCP toolset (filesystem, git,
shell, GitHub, Vercel, Supabase — ~55 tools). It's being rebuilt into an
**autonomous AI DevOps operator for solo founders and micro-agencies**:
open-source core, Claude Desktop-only for now (no separate agent/chat
interface, no continuous cloud watching — that becomes the managed/paid
layer later), licensed non-commercial instead of MIT.

## Phase 1 — Foundation (pre-existing)

Filesystem (9 tools), directory (5 tools), git basics (9 tools), shell
execution (1 tool), GitHub basics (9 tools), Vercel (7 tools), Supabase
(6 tools), activity logging.

## Phase 2 — Complete the git primitive layer

Added 11 tools: `git_create_branch`, `git_checkout`, `git_merge`,
`git_reset`, `git_stash`, `git_show`, `git_remote`, `git_tag`,
`git_changed_files`, `git_diff_stat`, `git_check_clean`. Git is now
20/20 — full lifecycle: branch, inspect, commit, push, merge when
permitted.

## Phase 3 — GitHub PR lifecycle

Added 12 tools: repo/issue read+update, PR get/update/merge, PR
files/diff/comments/reviews, branch get/list. The AI can now understand
the complete lifecycle of a PR from issue to merge.

## Phase 4 — GitHub Actions / CI

Added 6 tools: `list_workflows`, `list_workflow_runs`, `get_workflow_run`,
`get_workflow_run_jobs`, `get_job_logs`, `rerun_workflow`. This is what
makes the "AI fixes its own CI failure" capability possible later.
GitHub is now 27/27.

## Phase 5 — Project intelligence

New file `projectOps.js`, 7 tools: `project_detect`, `project_info`,
`project_health`, `run_tests`, `run_lint`, `run_typecheck`, `run_build`.
Detects language/framework/package manager from manifest files and
resolves the right test/lint/build commands automatically instead of the
AI having to guess or ask.

## Phase 6 — Vercel deployment verification

Added 4 tools: `vercel_get_deployment_logs`, `vercel_get_deployment_events`,
`vercel_cancel_deployment`, `http_check`. Vercel is now 11/11. (Initially
deprioritized, then added back — dropping *new* tools ≠ dropping the
category; existing Vercel support stays regardless of where the founder's
own landing page happens to be hosted.)

## Phase 7 — Workflow tool: `ship_change`

New file `workflowOps.js`. Chains: inspect changes → create/checkout
branch → run tests/lint/typecheck/build (stop on failure) → commit →
push → auto-resolve owner/repo from git remote → open PR. This is the
first "killer" end-to-end workflow — one call, real work, verified
result.

## Phase 8 — Workflow tools: `fix_ci` + `verify_ci_fix`

`fix_ci` finds the latest failing run (or a given run_id), lists jobs,
pulls logs for every failed job, returns a structured diagnosis — it does
not write the fix itself. `verify_ci_fix` commits, pushes, and polls
until the new run completes, reporting pass/fail.

**Bug found during dev:** a leftover orphaned docblock fragment caused a
syntax error (`Unexpected token '*'`) — fixed before commit.

## Phase 9 — Workflow tool: `deploy_project`

Chains: project health (working tree clean) → tests + build (abort on
failure) → trigger Vercel deployment → poll until ready/errored → HTTP
health-check the live URL. Returns a *verified* pass/fail, not just
"deployment triggered."

All three workflow tools complete. Total at this point: 78 tools.

## Bug hunt — npm PATH failures on Windows

End-to-end testing surfaced `npm run <script>` failing with `'node' is
not recognized`, even though top-level `node`/`npm` calls worked fine.

**Root cause, found by direct reproduction:** the raw `PATHEXT`
environment variable Claude Desktop passes in on this machine has a
**leading semicolon** (`;.COM;.EXE;...`), producing an empty extension
entry. That empty entry silently breaks Windows' extension-less command
resolution *specifically inside nested `cmd.exe` processes* — which is
exactly what `npm run` uses internally to spawn `node`. Top-level calls
worked because PowerShell's own resolution doesn't hit the same path.

**Fix:** `buildEnv()` in `commandOps.js` now splits `PATH`/`PATHEXT` on
`;`, filters out empty segments, and rejoins — instead of naively
string-concatenating, which could reintroduce the same class of bug. Also
fixed: writing to `env.PATH` when the real key was cased `Path` created a
second, duplicate key, which could confuse env serialization for nested
processes — now resolved via case-insensitive key lookup that writes back
through the *original* key.

Verified live: `npm run test` / `npm run build` went from hard failure to
clean `exit_code: 0` after the fix.

## Bug found — `ship_change` branch-exists failure

`ship_change` always tried to *create* a new branch, so re-running it (or
running it on a branch that already existed) failed outright. Fixed to
fall back to `git_checkout` when `git_create_branch` reports the branch
already exists.

## Phase 12 — Security / AI-employee layer

New file `security.js`, wired through `logger.js`, `index.js`,
`fileOps.js`, `directoryOps.js`, `commandOps.js`:

1. **Secret redaction** — `redactSecrets()` / `redactSecretsInString()`
   recursively strip token/password/api_key/secret-like fields from any
   object or string before it touches a log or error message.
2. **Permission levels** — every tool classified `READ` / `LOW` /
   `MEDIUM` / `HIGH` / `DESTRUCTIVE`. `HIGH`/`DESTRUCTIVE` tools are
   blocked by an approval gate in `wrap()` unless the caller passes
   `confirm: true`.
3. **Command risk classification** — `classifyCommandRisk()` scans for
   elevated-risk signals (force-push, `DROP TABLE`, curl-pipe-bash,
   `sudo`, chmod 777, etc.) and surfaces them in the `run_command` result
   for auditability, on top of the existing hard-blocked destructive
   patterns.
4. **Path security** — `isPathDenied()` blocks writes/deletes targeting
   protected system directories (`C:\Windows`, `Program Files`,
   `ProgramData`, etc.), wired into file and directory delete/write/create
   operations.
5. **Structured audit logging** — `logger.js` rewritten to append one
   JSON object per line (JSONL): timestamp, `operation_id`, `tool`,
   `risk_level`, `status`, redacted `input`, redacted `details`,
   `duration_ms`.
6. **MCP Resources** — `causly://project/{path}/health`, `/info`, `/git`
   for direct context reads without a tool-call round trip.
7. **MCP Prompts** — `ship-feature`, `fix-ci`, `deploy-project`,
   `review-changes` guide the AI toward the safe, repeatable workflows
   this server was built for.

## End-to-end verification

A disposable private GitHub repo (`causly-server-e2e-test`) was created,
exercised against every category of tool, and deleted afterward — nothing
was left behind. Results:

- **Files, Directory, Git, Command** — all 35 tools pass.
- **GitHub — all 27 tools pass**, including the full PR lifecycle
  (create → files → diff → comments → reviews → update → merge) and the
  full CI lifecycle (push a deliberately failing workflow → `fix_ci`
  diagnoses it with real logs → fix pushed → `verify_ci_fix` confirms the
  re-run goes green).
- **`ship_change` verified live** — produced a real PR end-to-end from a
  single call.
- **Vercel / Supabase** — read-only tools verified against real accounts;
  write/delete tools (`vercel_create_deployment`, `vercel_delete_project`,
  `supabase_delete_project`) intentionally **not** exercised against real
  production resources (no disposable Vercel-linked test project existed,
  and Supabase/Vercel production projects were not touched for safety).
- **Project intelligence — all 7 tools pass**, including the npm-PATH fix
  confirmed against a real `npm run test`/`npm run build`.
- **Security layer verified live** — the approval gate correctly blocked
  `run_command`, `git_reset`, `supabase_run_sql`, and `github_delete_repo`
  without `confirm: true`, and allowed them once confirmed. Command risk
  classification correctly flagged force-push and curl-pipe-bash as
  `ELEVATED`.
- **One real environment issue found during testing (not a code bug):**
  the GitHub token initially lacked "Pull requests" and "Actions"
  permissions, causing 403s across every PR/Actions tool. Fixed by
  updating the token's fine-grained permissions — all 27 GitHub tools
  passed afterward.

## Documentation pass

License changed from MIT to **PolyForm Noncommercial 1.0.0**. Added
`CODE_OF_CONDUCT.md`, rewrote `README.md` to reflect the current 78-tool /
8-category surface, the security model, and the workflow tools. Added
this file and `ROADMAP.md`.
