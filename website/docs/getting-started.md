---
sidebar_position: 2
---

# Getting Started

## Fork & Run

This is the current setup path. There is no packaged installer yet — you run the server directly
from a cloned copy of the repository.

### Requirements

- Node.js 18+
- Claude Desktop (or any MCP-compatible client)
- Optional, only for the tools you plan to use: Docker, the Terraform CLI, a Postgres/MySQL
  instance

### Steps

1. Clone the repository anywhere on your machine, e.g. `D:\causly-server`
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in tokens for whichever services you plan to use — skip
   anything you don't need, add more anytime:
   ```bash
   cp .env.example .env
   ```
4. Point Claude Desktop at this server — either run the setup helper, which finds your Claude
   Desktop config automatically and adds the entry:
   ```bash
   npm run setup
   ```
   or add the entry by hand to your Claude Desktop config
   (`%APPDATA%\Claude\claude_desktop_config.json` on Windows):
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
5. Restart Claude Desktop. Claude now has direct access to every registered tool.

Per-service setup (which token goes where, and how to generate it) is documented on each tool
category's page — see [Tool categories](./tools/overview).

## Local runtime installation

**Coming soon:** Causly Server will provide a dedicated local runtime installation experience
 that detects the environment,
configures MCP client, and verifies the connection in one command. This section will be
expanded when that installer is available — for now, use Fork & Run above.
