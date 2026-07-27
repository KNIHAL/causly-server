# Changelog

All notable changes to this project are documented here.

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
