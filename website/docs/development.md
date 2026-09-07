---
sidebar_position: 7
---

# Development

## Repository structure

```
causly-server/
├── index.js                # Server entry point, tool/resource/prompt registration
├── setup.js                 # Configures your Claude Desktop config automatically
├── package.json
├── .env                     # Your local tokens (never committed)
├── .env.example
├── BUILD_LOG.md              # What was built, in what order, and why
├── ROADMAP.md                 # What's planned next
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── docs/                     # Detailed technical docs (GitHub Pages build output)
├── website/                   # Docusaurus source for the docs site
├── tests/                     # Automated tests (vitest)
├── .github/
│   ├── workflows/ci.yml
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── tools/
│   ├── fileOps.js           # File read/write/edit/move/copy
│   ├── directoryOps.js      # Directory listing, tree, search
│   ├── gitOps.js            # Git operations via simple-git
│   ├── commandOps.js        # Shell command execution
│   ├── githubOps.js         # GitHub REST API — repos, issues, PRs, Actions
│   ├── vercelOps.js         # Vercel REST API — projects, deployments
│   ├── supabaseOps.js       # Supabase Management API
│   ├── slackOps.js          # Slack Web API — channels, messages, threads
│   ├── gmailOps.js          # Gmail API (OAuth2) — search, read, send, reply, forward
│   ├── notionOps.js         # Notion API — pages, databases, blocks, comments
│   ├── terraformOps.js      # Terraform CLI wrapper — full lifecycle + state + CI hook
│   ├── dockerOps.js         # Docker CLI wrapper — cross-platform (direct or via WSL)
│   ├── dbOps.js             # Generic Postgres/MySQL query tools
│   ├── secretsOps.js        # Local AES-256-GCM encrypted secrets manager
│   ├── sentryOps.js         # Sentry API — issues, projects, stats
│   ├── projectOps.js        # Stack detection, test/lint/build runners
│   ├── workflowOps.js       # ship_change, fix_ci, verify_ci_fix, deploy_project
│   ├── boundaryAttest.js    # Optional signed workflow-receipt POC
│   ├── security.js          # Redaction, permission levels, risk classification
│   ├── envLoader.js         # Dependency-free .env parser
│   └── logger.js            # Structured JSONL activity logging
└── logs/
    └── activity.log          # Auto-generated
```

## Local development workflow

1. Fork and clone the repo
2. `npm install`
3. Copy `.env.example` to `.env` and add tokens for whichever services you're working on
4. `npm run setup` to point your local Claude Desktop config at this repo
5. Make your changes
6. Restart Claude Desktop and exercise the new/changed tool through a real conversation
7. Check `logs/activity.log` to confirm the call succeeded and logged as expected

## Testing

The repository includes an automated test suite (`vitest`) under `tests/`, with one test file
per tool module (`gitOps`, `githubOps`, `dockerOps`, `dbOps`, `secretsOps`, `sentryOps`,
`slackOps`, `supabaseOps`, `terraformOps`, `vercelOps`, `notionOps`, `gmailOps`, plus
`security`, `logger`, `commandOps`, `fileOps`, `directoryOps`, `envLoader`, `projectOps`,
`workflowOps`, and `boundaryAttest`):

```bash
npm test                        # run the full suite
npm run test:boundaryattest     # run just the BoundaryAttest tests
```

New tool modules and changes are additionally verified manually against a real Claude Desktop
instance before merging — restart Claude Desktop, exercise the tool through an actual
conversation, and check `logs/activity.log`.

## Adding a new tool module

Each service (GitHub, Vercel, Supabase, Notion, Sentry, etc.) lives in its own file under
`tools/`, following the same shape:

1. A `getToken()` helper that reads the relevant env var and throws a clear error if it's missing
2. A shared `xFetch()` helper that wraps `fetch` with auth headers and consistent error
   formatting
3. One exported async function per operation, each taking a single destructured object argument
4. Register each new function as a tool in `index.js` using `server.registerTool(...)`, with a
   `zod` input schema and a short, clear `description`

Keep functions small and single-purpose — one API call in, one plain-object result out. Avoid
leaking raw API response shapes; map to a clean, minimal object.

## Pull requests

- Keep PRs focused — one feature or fix per PR
- Describe what you tested and how
- If you're adding a new service integration, update the README's feature list and the Mermaid
  workflow diagram if relevant

Full contribution guide: [CONTRIBUTING.md](https://github.com/KNIHAL/causly-server/blob/main/CONTRIBUTING.md).
