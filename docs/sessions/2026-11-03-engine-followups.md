# Session Report: the engine follow-ups, 2026-11-02 to 2026-11-03

- Harness: claude (Claude Code)
- Session: the lead `engine-lead`, team `build-engine`, run `engine-build-1`; Claude Code session 3e452ab1-41e4-4183-ad6c-dc41e3c8c8a2
- Lead model: Claude Opus 5.5 (`claude-opus-5-5`), effort medium, no advisor
- Updated: 2026-11-03T23:44:32Z

## Session summary

This report follows `docs/sessions/2026-11-01-engine-build.md`, which stops at pull request 4. It covers what the team built after that: three flaky-test fixes, the account reset timer fix, the login-token fix, the live-check probes, and a last test-only reliability change.

Pull requests 4, 5, 6, 7 and 13 are merged into `engine`. Pull request 15 is open at this report's writing, and the manager merges it. Nothing in this report is deployed.

## Session metrics

### Intent completion

| Intent | Status |
|---|---|
| Make the flaky cleanup and crash tests reliable (issues 207, 208) | Merged in pull request 4 |
| Make the replay test read the owner's recordings (issue 209) | Merged in pull request 5 |
| Stop the account reset timer dropping a deadline (issue 210) | Merged in pull request 6 |
| Keep login-store tokens out of the event log (issue 223) | Merged in pull request 7; independent verification of the fixes is deferred to the hostile pass |
| Give each live acceptance criterion honest evidence (L-1) | Merged in pull request 13; final live run passed 18 of 23 steps, and each failure has an issue |
| Remove three false failures from `pnpm check` (issues 276, 235, 248) | Built, pull request 15 open |

### Raw metrics

| Metric | Value and source |
|---|---|
| Last full check | `pnpm check` passed three times at `374a163`, with 196 test files, 2,977 tests passed and 2 skipped (test runner post #1350) |
| Tokens | Not measured here; every seat's session id is in `.foundry/scores.md` and in the table below |
| Issues recorded | 241 entries in `docs/issues.md` at `a89f91d`; status lines are free text, so no exact open count is claimed |

## Attribution of the units

Session ids are from `herdr agent get`. Claude Code transcripts are at `~/.claude/projects/<worktree path with slashes as dashes>/<session id>.jsonl`. Codex transcripts are at `~/.codex/sessions/<date>/rollout-*-<session id>.jsonl`.

| Commit | Worker branch | Agent | Harness | Model | Effort | Reviewers | Session id |
|---|---|---|---|---|---|---|---|
| `d515cd8`, `aae856e` | `worker/engine-u8cfl` | engine-u8cfl | Codex | gpt-6.1-sol | high | Lead read the diff | 01a19b97-721c-7002-9d14-778f2262751e |
| `4b57bf6` | `worker/engine-u8cfl` | engine-u8bfl | Claude Code | Sonnet 5.5 | high | Lead read the diff | 0251dcb6-1a29-46bd-967f-50f1ac4c4c80 |
| `31625d5` | `worker/engine-rpfx` | engine-rpfx | Codex | gpt-6.1-sol | high | Lead checked the files and scanned the fixtures | 01a19da6-abd6-7582-962a-520b901c36bb |
| `f4d79a6`, `5662a5f` | `worker/engine-acfl` | engine-acfl | Codex | gpt-6.1-sol | high | engine-acflrv, session e1383838-b6e1-4999-a4c5-18dfa64270a0 | 01a19dc4-22d2-7ad2-bcef-2bc477d77ad5 |
| `b88b876` and earlier, `8830d8b` | `worker/engine-shb` | engine-shb | Claude Code | Opus 5.5 | high | engine-shbv, session 01a19ef7-842e-7f12-99e8-1ad89d80e0b3 | 39edbe51-1e29-44f0-b210-999c973affa8 |
| `d91b67b` | engine-sht's worker branch | engine-sht | Codex | gpt-6.1-sol | high | engine-shbv | 01a19e9c-506f-79e3-87a2-6ed29643810c |
| `1e64487` to `9751bda` | `worker/engine-lcpb` | engine-lcpb | Codex | gpt-6.1-sol | high | engine-lcpv, session d40fb295-5b77-4024-8105-cc4b2084a38a; engine-lcp242r, session 2c00dc21-5d50-4be5-9cb6-3116f5444b74 | 01a19e96-5b10-7523-89cc-7ee334a1d235 |
| `2e7d96f` | `worker/engine-lcpt` | engine-lcpt | Claude Code | Opus 5.5 | high | engine-lcpv | 171ba7fa-b9e4-4cf7-927c-a9496f2f8457 |
| `a105465`, `f5e002c`, `05b366c` | `worker/engine-lcpb` | engine-lead | Claude Code | Opus 5.5 | medium | None; disclosed in pull request 13 | 3e452ab1-41e4-4183-ad6c-dc41e3c8c8a2 |
| `fac6343` | `worker/engine-rel` | engine-rel | Codex | gpt-6.1-sol | medium | None; lead read the diff | 01a1a3a4-48f1-7a41-a4d9-5780d9cd1946 |
| `374a163` | `worker/engine-rel` | engine-lead | Claude Code | Opus 5.5 | medium | None; a one-word status correction | 3e452ab1-41e4-4183-ad6c-dc41e3c8c8a2 |

## What each worker reported

- **Issues 207 and 208 were test races.** Each old test failed under pinned machine load, and each fixed test passed under the same load. Every original assertion was kept.
- **Issue 209 needed the replay test to read its expectations from the recordings.** The owner's fixtures were committed byte for byte. Issue 37 stays open, because the scrubber rule did not change.
- **Issue 210 was a production fault.** The reset timer dropped a deadline that passed during a check, which delayed the account by a minute. Issue 211 records the review's two minor points.
- **Issue 223 added a credential source for each file-backed harness.** A security reviewer rejected round 1, and each finding was reproduced by an attack test. Five own defects were fixed in `8830d8b`. Three older redactor limits were recorded as issues 232, 233 and 234.
- **L-1 took eight fix rounds, mostly from what the real harnesses showed.** The test writer's adversarial tests found five probe defects (issues 218 to 222). The reviewers' folds added issue 242's redacted terminal output, and issues 249, 270 and 271.
- **The reliability change is tests and `docs/issues.md` only.** Its proofs are in pull request 15. The seat wrote "fixed" on issue 248, and the lead changed that to "mitigated, cause unconfirmed".

## Decisions and rulings

- The owner chose option (b) on issue 236: the Codex Shephrd server runs approval-free, scoped to that server. Option (a) stays open as issue 237.
- The owner deferred issue 240, and issue 241 was deferred to the hostile pass.
- The manager ruled live run 6 final, whatever it showed, and ruled that minor review points on the terminal fix be recorded without another round.
- The manager asked for one cheap seat on the reliability change, so no review seat ran on it.

## Lessons learned

- A real harness shows faults that fakes do not. Most of L-1's fix rounds came from live runs, not from the test suite.
- A test that checks the whole log for an absence can fail on correct, later behaviour. Issue 276 was this kind of test, and scoping it to the failed request's id fixed it.
- A status word needs evidence behind it. A timeout whose cause stays unconfirmed is mitigated, not fixed.
- The lead wrote the readiness wait `a105465` itself, which saved a round but left that one commit without another reader. Pull request 13 says so.

## Stale document review

None confirmed in this stretch. The older report's "live check not yet run" open item is superseded: the manager reported that the live check passed all 14 steps at `71d13c1`. The lead relays that report and did not re-read that run's log.

## Instruction suggestions

None.

## Open items

- **Merge pull request 15.** This is the manager's step.
- **The hostile pass.** It owes the verification of issue 223's fixes and takes issue 241. Issues 224, 225, 231, 232, 233 and 234 are open for it.
- **Live-check records:** issues 212, 237, 246, 272, 273, 274 and 275.
- **Remaining flakes:** issue 235's `failure-1-crash` and `recovery/orphans`, and issue 247. Issue 248's cause stays unconfirmed.
- **Questions for the owner, through the manager:** issues 75, 113, 134, 150, 152 and 37.
- **Worktree cleanup:** the run's worker worktrees under `.claude/worktrees/foundry-engine-*` can be removed after pull request 15 merges.
