# Changelog

All notable changes to this project are documented here.

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
