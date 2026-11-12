# Round 2 findings and how each was folded

Round 2 reviewed `attack/plan-v2.md` (commits `cbff04c` and `fe0a049`). Six
reviews found 0 blockers, 23 majors and 18 minors, all graded 6, with no
refusals. Every finding is folded below. The reviews are in
`.scratch/foundry-runs/foundation-plans-1/review/roles-r2/lgtm-foundry-roles/attack/`.
Prefixes: A is the architect (Sol), C the critic (Sol), Lo the logic review
(Opus), Ls the logic review (Sol), N the threat model (Opus), and TM the
threat model (Sol). The folded plan is frozen as `attack/plan-v3.md`.

Lead rulings applied: L25 (board #127) for TM-3, the shell's identity
(row 54); L20 as re-sent with round 2 for the opt-in prefix (row 67); L23
(client API `ced973b`) and L24 (board v5 `e84fd65`) cited (row 55). Board
#109 closed question 2 (row 53) and kept the crash rule (row 42, known gap
15).

| Finding | Severity | Fold | Where |
|---|---|---|---|
| A-R2-A1 The turn-start event has no writer | major | A turn starts at the `DeliverySent` that made the agent working; runaway and the cache fallback time from it | WS-4 intro, 4.4, 4c, WS-5, 5.5; row 64 |
| A-R2-A2 The replacement cannot read the hand-off's overflow references | major | Markers are addressed to the lead, who reads with `client.thread` and posts the cut part; the recipe says so; no visibility widened | WS-6, 6.5, 8.1, 8.2; row 62 |
| A-R2-A3 The snapshot cap has no overflow policy for its permitted rules | major | Bounded summary without rule words, stated list maxima, `truncated` marks, recovery through `roles.rules.list` and the new `roles.actions.list` | Snapshot and sizes, 1.3a, 1d; row 61 |
| A-R2-A4 Fallback capacity retries lose their origin after the first re-send | major | The no-7b re-send is dropped: the returned delivery wakes its sender as today | 4.5, Overview; row 57; known gap 6 |
| A-R2-A5 The acceptance test cannot set second-scale limits | minor | The composed service runs in the test process on the test clock, over its real socket, at production defaults | Conventions, 8.2, 8b; post-build check 7; row 63 |
| C-R2-C1 The snapshot cannot contain the permitted rules | major | As A-R2-A3 | row 61 |
| C-R2-C2 The replacement cannot follow the overflow references | major | As A-R2-A2 | row 62 |
| C-R2-C3 The acceptance test needs settings the schema refuses | major | As A-R2-A5 | row 63 |
| C-R2-C4 The worker age cap became an all-role cap | major | The age limit is workers-only by default; leads and the orchestrator have none unless their role file sets one | Key decisions, 4.4; row 65 |
| C-R2-C5 The crash exception suppresses the board-off owner escalation | minor | With the board off, `GaveUp` is raised to the owner under the `engineAlertOpen` test, not a blanket crash exception | Board switched off, 3.6, 4.9; rows 58, 59 |
| C-R2-C6 The engine verify command runs no test script | minor | Verify lines use `pnpm vitest run <paths>` at the repository root | Conventions, every Verify line; row 66; result file issue |
| Lo-R2-L1 "Waiting on others" hides every deadlock | major | Waiting counts only while an awaited party is busy, is the owner, or holds the agent's request or question; cycle tests; team idle counts only busy members | WS-4 intro, 4.3, 4a, 4b; row 56 |
| Lo-R2-L2 A failed reload after the stall watch's resume tells the owner nothing | major | `GaveUp` records its cause and `engineAlertOpen`, and raises `roles.stall` unless the engine's alert is open | Events, 4.6, 4.9, 4e; row 58 |
| Lo-R2-L3 A held delivery re-sends a prompt the agent already took | major | Only an unaccepted delivery is held and re-sent; an accepted one gets a held carry-on | 7.3, 7b; post-build check 6; row 57 |
| Lo-R2-L4 With the stall watch off, a hold is permanent | major | The hold needs a registered condition that says yes only while the stall watch is on and retries remain; switching off releases each held delivery once | 3.10, 3f, 7.3; row 57 |
| Lo-R2-L5 The rule size and the snapshot cap contradict | major | Rule fields bounded to fit 2 KiB; the snapshot carries no rule words | 2a, 1.3a; row 61 |
| Lo-R2-L6 Capacity exhaustion has no action kind or alert | minor | `GaveUp { cause: capacity }`, flushed to the holder, raising `roles.stall` for the owner | 4.5, Events, flush list; rows 57, 58 |
| Lo-R2-L7 With the board off, every addressee walks to "replace" | minor | The stall, team-idle and flush rules are suspended with counts kept and clocks restarted | Board switched off, 3.6; row 59 |
| Lo-R2-L8 "Nudge" and "stall watch turn" are undefined | minor | Both defined: a nudge is a direct `reply: none` post plus `board.flush`; a stall watch turn is a wake listing only stall watch posts, or its carry-on prompt | Notices paragraph, 3.11; row 60 |
| Lo-R2-L9 The hand-off's two 24 KiB sections pass the token limit | minor | Sections of 20 KiB each, measured encoded, inside 48,000 bytes and 64 KiB | WS-6, 6.2; row 62 |
| Lo-R2-L10 A cache read is treated as five minutes | minor | A read-only request takes the lifetime of the latest write in view, else nothing is scheduled | WS-5, 5.5; row 64 |
| Lo-R2-L11 The plan cites board v3, not v4 | minor | Cites board v5 `e84fd65` (L24), noting round 2 reviewed v4 `bcc33e1` | Sources, traceability; row 55; known gap 3 |
| Ls-R2-L1 Switching off the stall watch leaves holds with no owner | major | As Lo-R2-L4 | row 57 |
| Ls-R2-L2 The snapshot cannot contain its rules | major | As A-R2-A3 | row 61 |
| Ls-R2-L3 A shortened hand-off points to an unreadable thread | major | As A-R2-A2 | row 62 |
| Ls-R2-L4 The blanket crash-alert exception defeats the board-off escalation | major | As C-R2-C5 | rows 58, 59 |
| Ls-R2-L5 Acceptance timing violates the settings bounds | minor | As A-R2-A5 | row 63 |
| N1 A Codex escalation can carry no named field | major | A positive sandboxed-run marker is required; `reason` and `prefix_rule` mean no match; 2g records Codex's retry-without-sandbox and `require_escalated` approvals; a harness whose recordings cannot separate them is `unsupported` | WS-2 list, 2.5, 2.14, 2g; row 67; known gap 18 |
| N2 The pre-check has no failure policy | major | The engine calls it as a total function; any error or malformed result is no match and normal routing; a throwing stub is tested | 7.2, 2.15; row 67 |
| N7 The mode guard checks only the asker's current mode | major | The asker's highest mode since start, from `ModeChanged`; `roles.rules.add` warns that an agent whose folder contains the asker's can change what runs; the overview says so | Overview, WS-2, 2.8, 2.10, 1d; row 67 |
| N3 Runner batches are written with caller `owner` | minor | `PermissionAnswered` is a second write in the same transaction with the service caller envelope, and `answeredBy` is the service | 7.2, 7a anchor; row 67; result file issue |
| N4 The F11 header cannot be built by a service prompt | minor | The no-7b re-send is dropped | 4.5; row 57 |
| N5 A recording cannot prove Claude's shell folder | minor | The exception is removed; Claude stays fail-closed; a launch setting goes to features | WS-2 list, 2.6; row 67; known gap 14; result file feature |
| N6 Codex reports a command as a list | minor | Lists are compared item by item, no item may contain a space, and a shell wrapper is accepted only in its pinned form | WS-2 list, 2.7, 2b, 2f; row 67 |
| N8 7a's `toolInput` has no maximum | minor | Recorded only for kind `execute`, at most 8 KiB, with `inputTruncated` that never matches, kept out of views and snapshots | 7.1, 2.6; row 67; result file issue |
| N9 The hand-off's markers point to an unreadable thread | minor | As A-R2-A2 | row 62 |
| N10 `roles.record` does not limit event kinds | minor | A closed list of action kinds per service; `RuleAdded` and `SettingsChanged` refused | Command table, 3.4, 3a; row 67 |
| TM-R2-TM-1 The settings exclusion misses names inside arguments | major | No word may contain a protected settings name anywhere, such as `of=.claude/settings.json` | WS-2 list, 2.6; row 67 |
| TM-R2-TM-2 The snapshot's rules exceed its cap | major | As A-R2-A3 | row 61 |
| TM-R2-TM-3 `execute` does not identify the shell tool | major | Lead ruling L25: kind `execute` plus the harness's pinned shell discriminator from 2g; a harness without one is `unsupported`; no new engine field | WS-2 list, 2.4, 2.14, 2f; row 54; known gap 17 |
| TM-R2-TM-4 The acceptance test needs refused timer values | minor | As A-R2-A5 | row 63 |

Count: 23 majors and 18 minors, 41 in all.

## Noted, not filed, and applied

- `roles.handoff` loses its service access (command table).
- `RoleFileSet`, `RuleAdded` and `SettingsChanged` record the device (Events).
- WS-7b's `release` adds one command to CAPI §2's service list, which the amended owner question includes (Services).
- The request id's recipient is read from the engine's views when the action is decided (Request ids).
- The recipe states that `holderAbove` skips a paused parent (Recipient, 8.1).
- Post-build check 7: one stall episode on the real child-process service with real minutes.
