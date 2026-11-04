# Session Report: the three foundation plans, 2026-11-03

- Harness: claude (Claude Code)
- Session: the lead `plans-lead`, team `build-plans`, run `foundation-plans-1`; Claude Code session 07279ae2-9ee0-490a-9f3c-5fb3a97bdfda
- Lead model: Claude Opus 5.5 (`claude-opus-5-5`)
- Updated: 2026-11-03

## Session summary

The planning team wrote and reviewed the plans for rows 2 to 4 of the epic `.plans/epics/shepherd-foundation/epic.md`. The owner accepted all three. These are plans only, so no code was built or run.

The client API plan was accepted at `b38aa6f`, with contract version 17, 12 build units and 48 launches. The message board plan was accepted at `ea7aea5`, with contract version 15, 9 build units and 33 launches. The foundry roles plan was accepted at `57b2822`, with 17 build units and about 57 launches, or 14 units and about 42 launches if standing rules are deferred.

Later commits on the client API and board branches leave those contracts unchanged: `430b206` and `baa47e8` on the client API, and `1ac1821` on the board.

## What the owner changed

| Question | The owner's decision |
|---|---|
| Web login, question 6 | One password from `SHEPHRD_WEB_PASSWORD`. There is no pairing, no device credential and no rate limit. A logged-in session is the owner. Mobile login comes later and starts from what Home Assistant does. |
| Visual Studio Code extension, question 9 | It stays out, and it is one of the last things, along with the mobile app. |
| Proxy and encryption, question 10 | Shephrd serves plain HTTP on loopback. The proxy, certificates and DNS (Domain Name System) are the owner's later work. |
| Board plan, question 12 | The owner sent it back. It gained an acknowledge command, a bounded reminder for unanswered questions, and labelled post text. |
| Roles plan, question 13 | Accepted. Worktrees go to `<repo>/.worktrees/` and become their own plan, `shepherd-worktrees`. |
| `AGENTS.md` rule 7 | Rewritten: agents have full authority inside a team, and moving work into the base branch waits for the owner. |

The owner also approved, in a design talk recorded in `docs/specs/2026-11-03-client-api-design.md`, shipping remote access before Shephrd has its own Unix user.

## Session metrics

### Intent completion

| Intent | Status |
|---|---|
| Three plans, one planner each | Done |
| The client API design round | Done |
| The owner's acceptance of each plan | Done |
| Epic rows `linked` and the roadmap updated | Done |
| Attack-list lines to the manager | Done: 13 for the client API, 9 for the board, 8 for the roles |
| Issues and features lists | Done: entries 300 to 355 in `docs/issues.md`, and 9 additions to `docs/features.md` |

### Raw metrics

| Metric | Value and source |
|---|---|
| Commits on the worker branches | 37 client API, 25 board, 31 roles, every one signed |
| Review rounds | 5 client API, 7 board, 6 roles |
| Tokens | Not measured here. Every planner's session id is in the attribution table. |

## Attribution

Every commit on a worker branch was written by that branch's planner. Transcripts are at `~/.claude/projects/-home-qnlbnsl-projects-personal-herdr-synapse-sheprd--claude-worktrees-<worktree>/<session>.jsonl`.

| Commits | Branch | Agent | Harness | Model | Effort | Session |
|---|---|---|---|---|---|---|
| 37, head `baa47e8` | `worker/plans-api` | `plans-api` | Claude Code | Claude Opus 5.5 | high | 0dba83c9-1195-4636-91c1-8c4df99fc022 |
| 25, head `1ac1821` | `worker/plans-board` | `plans-board` | Claude Code | Claude Opus 5.5 | high | 02e74275-4ebf-47b5-a96e-99cac5edbc92 |
| 31, head `57b2822` | `worker/plans-roles` | `plans-roles` | Claude Code | Claude Opus 5.5 | high | 097a8a12-65ec-41ea-916c-9cf3e4f148a3 |
| Epic wording, merges, the rule 7 change and this report | `area/plans` | `plans-lead` | Claude Code | Claude Opus 5.5 | not recorded | 07279ae2-9ee0-490a-9f3c-5fb3a97bdfda |

The lead's commit also holds issue and feature entries drafted by a Claude Sonnet 5.5 helper from the planners' result files. The lead spot-checked them, and the helper did not verify the claims against the code.

**Reviewers.** Each plan's rounds used the four plan lenses, on Codex `gpt-6.1-sol` at high effort, with Claude Opus 5.5 at high effort for the logic and threat model seats of the early rounds. Their findings are in each plan's `attack/` folder.

## Review verdicts

| Plan | Last review | What no reviewer has read |
|---|---|---|
| Client API | Threat model 10, ship. Architect 7, revise, with one major that version 16 fixed. | Version 17, the plain HTTP change. The manager ruled that no review was needed unless it reached beyond that section. |
| Message board | Logic 7, revise, with one major, R7-L1, that version 15 fixed. | The R7-L1 fix. The manager's instruction was to fold major findings with one reviewer. |
| Foundry roles | Logic 10, ship, in round 6. | The re-citation of client API version 17 and board version 15, and four lines on how the sheepdog meets the board's new rule. |

## Open items

- The owner's choice on `isHarnessSettings` is issue 353.
- A hang in the middle of a turn is caught only at the sheepdog's two-hour runaway limit. The owner accepted this as a limit.
- `shepherd-worktrees` is the next plan to write.
- Standing rules depend on recordings the owner runs for each harness, and on today's evidence no harness qualifies.

No security issue is outstanding from this run. No commit broke a repository rule.
