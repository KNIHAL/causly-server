# Changelog

All notable changes to this project are documented here.

## [1.5.0]

### Added
- **Notion — new category, 15 tools**: search, page/database CRUD, block append/read/update/delete, comments, users. All live-tested against a real shared Notion page.
- **Terraform — new category, 20 tools**: full lifecycle (init/validate/fmt/plan/apply/destroy/show/output/workspace), state management (state_list/show/mv/rm/pull/import/taint/untaint), graph/providers, and a CI/CD hook (`terraform_plan_comment` — posts a plan summary as a GitHub PR comment). 17/20 live-tested.
- **Docker — new category, 18 tools**: ps/images/build/run/stop/start/restart/rm/rmi/logs/inspect/exec/stats/push/pull/compose up-down. Cross-platform — tries `docker` directly first, falls back to `wsl docker` on Windows-only-WSL setups, with automatic Windows-path-to-WSL-path translation for build context, volumes, and compose working directory. 17/18 live-tested.
- **Generic Postgres/MySQL — new category, 8 tools**: query/list_tables/describe_table/test_connection for each engine, connection-string based. All 8 live-tested against throwaway Docker containers.
- **Local encrypted secrets manager — new category, 6 tools**: set/get/list/delete/rotate_key/generate_key. AES-256-GCM, local file store, no external service required. All 6 live-tested including a full key-rotation cycle.
- **Sentry monitoring — new category, 8 tools**: list_projects/list_issues/search_issues/get_issue/resolve_issue/ignore_issue/get_project_stats/add_comment. 5/8 live-tested.

Total: 181 tools, up from 106.

### Changed
- **License: PolyForm Noncommercial 1.0.0 → MIT.** Added `"license": "MIT"` to `package.json`.
- Removed the temporary `register/` staging folder now that all tool registrations live directly in `index.js`.
- Simplified `setup.js` — dropped interactive token prompting (tokens are documented/edited directly in `.env`), kept the cross-platform Claude Desktop config auto-update.
- Updated `CONTRIBUTING.md` and `ROADMAP.md` to reflect the new tool categories and the current Azure/GCP/AWS-deferred stance.

### Fixed
- Docker: Windows-style paths (`D:\...`) passed to `docker_build`/`docker_run`/`docker_compose_*` broke when the WSL fallback path was used — added automatic path translation to WSL form (`/mnt/d/...`).
- Secrets manager: default secrets-store path was anchored to `process.cwd()` (the server's launch directory) instead of the repo root, causing an `EPERM` in some launch configurations — now anchored via `import.meta.url`.
- Sentry: bare `/issues/{id}/` lookups 404'd on the default API host for EU-region (data-residency) organizations even though org/project-scoped endpoints worked fine there — added automatic regional-host fallback on 404.

## [1.4.0]

### Added
- **Gmail — new category, 8 tools** (OAuth2 refresh-token based): `gmail_get_profile`, `gmail_search`, `gmail_list_messages`, `gmail_get_message`, `gmail_get_thread`, `gmail_send`, `gmail_reply`, `gmail_forward`. Send/reply/forward classified `HIGH` risk (require `confirm: true`); reads classified `READ`.
- Setup wizard and `.env.example` now document the Gmail OAuth2 flow (Google Cloud Console + OAuth Playground) and prompt for `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN`

### Fixed
- `slack_list_channels` silently returning only the first page in large workspaces — now paginates via `response_metadata.next_cursor` up to the requested `limit`
- `.env.example` Slack scope list was missing `groups:write`, required for `slack_create_channel` with `is_private: true`

### Known limitation
- Gmail tools require OAuth2 credentials (not a simple API key) — one-time setup via Google Cloud Console. All 8 tools tested working live against a real Gmail account.

## [1.3.0]

### Added
- **Slack — new category, 8 tools** (Web API, bot-token based): `slack_get_user`, `slack_list_channels`, `slack_get_channel`, `slack_read_messages`, `slack_search_messages`, `slack_send_message`, `slack_reply_thread`, `slack_create_channel`. Send/reply/create-channel classified `HIGH` risk (require `confirm: true`); reads classified `READ`.
- Setup wizard and `.env.example` now prompt for `SLACK_BOT_TOKEN`

### Fixed
- `slack_get_user` failing with `missing_scope` — Slack app was missing the `users:read` bot scope; documented required scopes in `.env.example`

### Known limitation
- `slack_search_messages` requires a Slack **user token**, not a bot token — bot tokens return `not_allowed_token_type`. All other Slack tools tested working with a bot token against a live workspace.

## [1.2.0]

### Added
- **Git — 11 new tools**, completing the primitive layer (20/20): `git_create_branch`, `git_checkout`, `git_merge`, `git_reset`, `git_stash`, `git_show`, `git_remote`, `git_tag`, `git_changed_files`, `git_diff_stat`, `git_check_clean`
- **GitHub — 18 new tools**, completing PR lifecycle + Actions/CI (27/27): repo/issue get+update, PR get/update/merge, PR files/diff/comments/reviews, branch get/list, workflow list/runs/jobs/logs/rerun
- **Vercel — 4 new tools**, completing the deployment-verification set (11/11): `vercel_get_deployment_logs`, `vercel_get_deployment_events`, `vercel_cancel_deployment`, `http_check`
- **Project Intelligence — new category, 7 tools**: `project_detect`, `project_info`, `project_health`, `run_tests`, `run_lint`, `run_typecheck`, `run_build` — auto-detects language/framework/package manager and resolves the right commands instead of guessing
- **Workflow tools — new category, 4 tools**: `ship_change` (branch → checks → commit → push → PR, one call), `fix_ci` (diagnose a failing CI run with real logs), `verify_ci_fix` (commit/push/poll until green), `deploy_project` (health → tests+build → deploy → poll → HTTP-verify)
- **Security layer**: permission-level classification (`READ`/`LOW`/`MEDIUM`/`HIGH`/`DESTRUCTIVE`) with an approval gate (`confirm: true`) for risky tools; secret redaction on every log line; graded command-risk classification (force-push, `DROP TABLE`, curl-pipe-bash, etc.); path protection against writing/deleting inside system directories
- **Structured audit logging** — `logs/activity.log` is now JSONL (one JSON object per line) with operation ID, risk level, redacted input, and duration per call
- **MCP Resources**: `causly://project/{path}/health`, `/info`, `/git` for direct context reads
- **MCP Prompts**: `ship-feature`, `fix-ci`, `deploy-project`, `review-changes`
- `CODE_OF_CONDUCT.md`, `BUILD_LOG.md`, `ROADMAP.md`

### Changed
- License: MIT → PolyForm Noncommercial 1.0.0
- README rewritten to reflect the full 78-tool / 8-category surface and the security model

### Fixed
- `npm run <script>` (and any command relying on Windows' extension-less resolution — `node`, `where`, etc.) failing with `'node' is not recognized`, specifically inside nested `cmd.exe` processes. Root cause: the raw `PATHEXT` env var Claude Desktop passes in had a leading semicolon, producing an empty extension entry that silently broke resolution one process-layer down even though `PATHEXT` looked correct when echoed at the top level. `buildEnv()` now splits/filters/rejoins `PATH` and `PATHEXT` instead of string-concatenating, and resolves the real casing of each key (`Path` vs `PATH`) instead of risking a duplicate.
- `ship_change` failing outright when its target branch already existed instead of checking it out

## [1.1.3]

### Fixed
- `vercel_create_deployment` failing with `gitSource missing required property repoId` — Vercel's API requires the numeric GitHub repo ID, not an "owner/repo" string. Now resolves the ID automatically via the GitHub API before calling Vercel.

## [1.1.2]

### Fixed
- `run_command` occasionally failed with `spawn powershell.exe ENOENT` on Windows because it relied on PATH lookup to find PowerShell, and Claude Desktop's spawned environment doesn't always have a reliable PATH. Now resolves PowerShell via its standard absolute System32 path first, with automatic fallback to a PATH-based lookup and finally `cmd.exe` if PowerShell truly cannot be found.

## [1.1.1]

### Fixed
- `run_command` was failing to find `node`, `npm`, and other executables on Windows — Claude Desktop launches the server with a stripped-down environment where `PATHEXT` arrives missing standard extensions (`.EXE`, `.CMD`, `.BAT`, etc.), so PowerShell couldn't resolve commands even though they existed and their folder was in `PATH`. Now restores a sane default `PATHEXT` when spawning commands on Windows.

## [1.1.0]

### Added
- GitHub tools: authenticated user, create/delete/list repos, create/list issues, create/list pull requests, add comment
- Vercel tools: authenticated user, list/get projects, list/get deployments, create deployment, delete project
- Supabase tools: list organizations, list/get projects, create/delete project, run raw SQL
- Interactive setup wizard (`npm run setup`) — configures `.env` tokens and Claude Desktop config automatically
- `.env.example` template
- CONTRIBUTING.md, issue/PR templates, CI workflow

### Fixed
- `move_file` / `copy_file` / `write_file` / `create_file` failing with `EPERM` when the destination directory was a drive root on Windows (e.g. `D:\`)
- Removed the `dotenv` dependency — its stdout banner was corrupting the MCP stdio JSON-RPC stream, causing "Unexpected token" errors. Replaced with a small dependency-free `.env` parser.
- `run_command` was running through `cmd.exe` on Windows by default, which can't handle multi-statement scripts or many PowerShell-style commands. Now runs through `powershell.exe` on Windows.

## [1.0.0]

### Added
- Initial release
- File tools: read, read multiple, create, write, edit, delete, move, copy, get info
- Directory tools: list, tree, create, delete, search
- Git tools: init, status, add, commit, push, pull, log, diff, branch
- Shell execution tool (`run_command`) with a blocklist of destructive command patterns
- Local activity logging (`logs/activity.log`)
