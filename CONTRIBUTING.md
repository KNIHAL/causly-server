# Contributing to causly-server

Thanks for considering a contribution — this project grew out of a personal workflow need, and it gets better with more people using it in different setups.

## Getting started

1. Fork and clone the repo
2. `npm install`
3. `npm run setup` to configure your own tokens locally
4. Make your changes
5. Test manually against a real Claude Desktop instance (see below)

## Adding a new tool module

Each service (GitHub, Vercel, Supabase, etc.) lives in its own file under `tools/`, following the same shape:

1. A `getToken()` helper that reads the relevant env var and throws a clear error if it's missing
2. A shared `xFetch()` helper that wraps `fetch` with auth headers and consistent error formatting
3. One exported async function per operation, each taking a single destructured object argument
4. Register each new function as a tool in `index.js` using `server.registerTool(...)`, with a `zod` input schema and a short, clear `description`

Keep functions small and single-purpose — one API call in, one plain-object result out. Avoid leaking raw API response shapes; map to a clean, minimal object.

## Testing your changes

There's no automated test suite yet (see the roadmap in the README), so please test manually:

1. Point your local Claude Desktop config at your working copy
2. Restart Claude Desktop
3. Exercise the new/changed tool through an actual conversation
4. Check `logs/activity.log` to confirm the call succeeded and logged as expected

## Pull requests

- Keep PRs focused — one feature or fix per PR
- Describe what you tested and how
- If you're adding a new service integration, update the README's feature list and the Mermaid workflow diagram if relevant

## Reporting issues

Open a GitHub issue with:
- What you expected to happen
- What actually happened (include the error message if there is one)
- Your OS and Node version

## Code of conduct

Be respectful, be constructive, assume good intent. This is a small tool built by one person for a real problem — treat it (and each other) accordingly.
