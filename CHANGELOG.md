# Changelog

All notable changes to this project are documented here.

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

## [1.0.0]

### Added
- Initial release
- File tools: read, read multiple, create, write, edit, delete, move, copy, get info
- Directory tools: list, tree, create, delete, search
- Git tools: init, status, add, commit, push, pull, log, diff, branch
- Shell execution tool (`run_command`) with a blocklist of destructive command patterns
- Local activity logging (`logs/activity.log`)
