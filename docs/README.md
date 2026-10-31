# Quality and hardening plan

This folder is the engineering plan for making Causly Server enterprise quality. It is internal
working documentation for contributors. User-facing docs live on the docs site
(`server.causly.in/docs`).

| File | What it holds |
|---|---|
| [P0.md](./P0.md) | Must be done before the 1.5.4 release and the 10 Nov 2026 launch |
| [P1.md](./P1.md) | Next release (1.6): deeper hardening, real approval flow, broader test coverage |
| [P2.md](./P2.md) | Later: larger features, long-running verification, enterprise extras |

Every item has an ID (`P0-03`), the evidence (file and line), the impact, the fix, and an
acceptance test. An item is done only when its acceptance test exists and passes.

## Where this came from

- An independent audit run on 30 Oct 2026 against `master` at commit `c6bc132`.
- A re-check of every audit claim against the code and `npm audit` on 31 Oct 2026.
- The open GitHub issue #2 and the "Limitations" page of the docs.
- A QA review of what the existing test suite (56 test files) does not cover.

Audit claims that did not survive the re-check are listed at the bottom of this page, so they are
not worked on by mistake.

## Rules of the sprint

1. **Test first.** For every security item, write the failing test that reproduces the problem,
   then fix it. The test stays as a regression test.
2. **One item, one commit.** Keep each commit small so it can be reviewed and reverted alone.
3. **Work on a branch.** P0 work goes on `security/hardening-1.5.4`. `master` is untouched until
   the branch is green on Ubuntu, macOS and Windows.
4. **No blind fixes.** Reproduce first. If an item cannot be reproduced, write down why and
   close it.
5. **Docs move with code.** Any change to a tool, a permission level or a default updates the
   matching page in the docs site in the same change set. The pages live in the `agenv` repo
   under `website/docs/server/`. Each P0 and P1 item has a "Docs to update" line that names them.
6. **No new unrequested scope.** New ideas go into P1 or P2, not into the sprint.

## Definition of done for a release

- [ ] `npm audit --omit=dev` reports no high or critical issues
- [ ] `npm test` passes on Ubuntu, macOS and Windows (Node 22 and 24)
- [ ] Every registered tool has an explicit permission level (enforced by a test)
- [ ] `npm pack --dry-run` shows only the allowlisted files
- [ ] `CHANGELOG.md` has a security section for the release
- [ ] `causly-server doctor --test` passes on a clean machine with real keys
- [ ] Package published with provenance, tag pushed, MCP Registry entry updated

## Timeline to launch (10 Nov 2026)

| Dates | Focus |
|---|---|
| 1 to 3 Nov | P0-01 to P0-06: dependencies, issue #2, redaction, shell injection, SSRF, file guards |
| 4 to 5 Nov | P0-07 to P0-09: CI, permission levels, MCP conformance and annotations |
| 6 to 7 Nov | P0-10 to P0-12: fuzz tests, install and upgrade matrix, release hygiene |
| 8 Nov | Release 1.5.4, ask Glama and the other directories to re-scan |
| 9 Nov | Buffer. Renew the Google token (`causly-server login google`), final `doctor --test` |
| 10 Nov | Product Hunt launch |

README and ROADMAP are updated last, after P0 is green.

## Limitations page to plan

| Limitation (docs) | Plan |
|---|---|
| Issue #2: `npm install` fails inside nested `cmd.exe` on Windows | P0-02 |
| Workspace limit is a guardrail, not a sandbox | P1-03 (Docker mounts, resources), documented honestly in the meantime |
| Approval gate is a flag, not a screen | P1-01 (real operator approval) |
| Commands inherit the server environment, including keys | P1-04 |
| Recurring calendar events: updating changes one instance only | P1-12 |
| Google token expires after 7 days in Testing mode | P1-13 (production publish is a user-side step) |
| Transcription needs the internet | P2-01 (local engine) |
| No sync between machines | P2-05 |
| BoundaryAttest is a proof of concept | P2-04 |
| Direct cloud tools (Azure, GCP, AWS) | Out of scope |
| LinkedIn, X and WhatsApp outreach | Out of scope |

## Audit claims that did not hold up

- **Master key validation is weak.** It is already checked: the key must decode to exactly 32
  bytes (`tools/secretsOps.js`). No work needed beyond a unit test.
- **Test tools bypass the approval gate.** `run_tests`, `run_lint`, `run_typecheck` and
  `run_build` run the project's own scripts. That is what they are for, so this is a policy
  decision, not a bug. See P1-05.
- **CVE numbers in the audit.** The audit quoted CVE IDs that `npm audit` does not report.
  `npm audit` reports GitHub advisory IDs (GHSA). Work is tracked against `npm audit`, not the
  quoted IDs.
- **"410+ tests".** That figure came from an older pull request. The suite has 56 test files and
  CI is green, but the count has to be taken from a fresh run.
