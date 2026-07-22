# Causly Server

A custom MCP (Model Context Protocol) server that gives Claude full, direct access to your local filesystem, shell, and git — so it can read, write, edit, and manage real projects on your machine instead of just talking about code.

Built for [Causly](#) as the core dev-automation layer behind our AI agency workflow, and open-sourced so anyone can plug it into their own Claude Desktop setup.

## Why this exists

Claude is great at writing code, but by default it can't touch your actual project files. Causly Server closes that gap: once connected, Claude can create files, edit them in place, run your build/test commands, and commit changes — all on your own machine, under your own control.

## Features

**File operations**
`read_file` · `read_multiple_files` · `create_file` · `write_file` · `edit_file` · `delete_file` · `move_file` · `copy_file` · `get_file_info`

**Directory operations**
`list_directory` · `directory_tree` · `create_directory` · `delete_directory` · `search_files`

**Git operations**
`git_init` · `git_status` · `git_add` · `git_commit` · `git_push` · `git_pull` · `git_log` · `git_diff` · `git_branch`

**Shell execution**
`run_command` — run any shell command (npm install, tests, builds, etc.) in a given directory. A short list of destructive patterns (drive wipes, `format`, `shutdown`) is hard-blocked; everything else runs with full permissions, since this is designed for trusted, single-user local use.

**Logging**
Every tool call — success or failure — is appended to `logs/activity.log` for auditability.

## Requirements

- Node.js 18+
- Claude Desktop

## Setup

1. Clone or download this repo anywhere on your machine, e.g. `D:\causly-server`
2. Install dependencies:
   ```bash
   npm install
   ```
3. Add it to your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows):
   ```json
   {
     "mcpServers": {
       "causly-server": {
         "command": "node",
         "args": ["D:\\causly-server\\index.js"]
       }
     }
   }
   ```
4. Restart Claude Desktop. Claude will now have direct access to the tools above.

## Security note

This server runs with **full, unrestricted access** to whatever machine it's installed on — there are no path restrictions. That's an intentional design choice for personal/trusted single-user setups, not a general-purpose deployment. If you plan to expose this to other users or run it in a shared environment, you should add path allow-listing and stricter command controls before doing so.

## Project structure

```
causly-server/
├── index.js              # Server entry point, tool registration
├── package.json
├── tools/
│   ├── fileOps.js         # File read/write/edit/move/copy
│   ├── directoryOps.js    # Directory listing, tree, search
│   ├── gitOps.js          # Git operations via simple-git
│   ├── commandOps.js      # Shell command execution
│   └── logger.js          # Activity logging
└── logs/
    └── activity.log        # Auto-generated
```

## License

MIT — see [LICENSE](./LICENSE) for details.
