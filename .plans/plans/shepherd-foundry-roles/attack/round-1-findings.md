# Round 1 findings and how each was folded

Round 1 reviewed `attack/plan-v1.md` (commit `2ac51ae`). Six reviews found 2
blockers, 37 majors and 21 minors, with no refusals. Every finding is
folded below. The reviews are in
`.scratch/foundry-runs/foundation-plans-1/review/roles-r1/shepherd-foundry-roles/attack/`.
Prefixes: A is the architect (Sol), C the critic (Sol), Lo the logic
review (Opus), Ls the logic review (Sol), F the threat model (Opus), and
TM the threat model (Sol). The folded plan is frozen as `attack/plan-v2.md`.

Lead rulings applied: L20 (board #93) for F1 to F4, Lo-L6 and the matcher;
L17 (board #85) for the dropped fallback; L19 (board #95) and L22 (board #103) cited, at client API `586a7ff`,
with no change to the plan (row 52).

| Finding | Severity | Fold | Where |
|---|---|---|---|
| F1 Shell-character list is a denylist and misses `&` | blocker | L20's character allow-list; tests for `&` and each class the review named | WS-2 matcher list, 2.2, 2b; row 35 |
| F2 Matcher ignores sandbox-escape fields | blocker | L20: any escape field never matches; per-harness known-field list; overview promise rewritten | WS-2, 2.5, 2f; overview; row 35 |
| F3 Matcher cannot tell the shell from another tool with `command` | major | L20: tool kind `execute` only, recorded by 7a | 2.4, 7.1; row 35 |
| F4 Matcher reads a streamed, redacted copy | major | L20: the request's own input only, recorded by 7a; redacted input never matches | 2.6, 7.1; row 35 |
| F5 No engine backstop for service or pre-check answers | major | The engine applies its own answer checks to the pre-check's result; roles no longer call service `answer` | 7.2; Services; row 35 |
| F6 A test rule for an `edit`-mode agent runs any code | major | Highest asker mode, default `ask`; fixed warning on `rules.add`; overview says it plainly | 2a, 2.7, 2.9; overview; row 35 |
| F7 Folder scope undecidable; fixtures hold no tool calls | major | No working folder means no match; exact words remove the path guess; 2g records new samples | 2.6, 2g, 2.13; rows 35, 51; known gap 14 |
| F8 Snapshot section unbounded | major | Section holds no history, 256 KiB maximum, size test | Snapshot and sizes, 1.3a; row 47 |
| F9 Transcript reader opens the credential folder | minor | Hardened reader; WS-7c removes it | 5.7, 5b; row 45 |
| F10 Settings have no bounds | minor | Bounds for every setting, refused with path | 1.5, 3.8; row 48 |
| F11 Capacity re-send relays another author's text | minor | Plain prompts only; sender id in a fixed header outside the envelope | 4.5; row 49 |
| F12 Engine-prompt fallback kept against L17 | minor | Dropped; board-off behaviour stated | Services, 3.5, 3.6; row 34; known gap 12 |
| F13 Expiry needs a clock the pre-check lacks | minor | The transaction's time is a pre-check input | 7.2, 2.8; row 35 |
| TM-1 Settings write through a shell operand | major | A word naming a protected settings path never matches | WS-2 list, 2.6; row 35 |
| TM-2 Disable races an automatic answer | major | Match and answer in the request's own transaction (7a); the fallback answerer is dropped | 2.10; row 35 |
| TM-3 Hand-off mandatory text exceeds its cap | major | Overflow policy with markers and sequence numbers | WS-6, 6.2; row 47 |
| A1 Capacity-paused agent cannot be resumed | major | 7b reshaped: held delivery and `release` | 7.3, 7.4, 4.5; row 36; question 2 |
| A2 Capacity fallback and the board both retry | major | The board owns its wakes; the sheepdog re-sends plain prompts only | 4.5; row 49; known gap 6 |
| A3 Crash reload does not retry the work | major | Carry-on prompt after `SessionOpened`; give-up on refusal or reload failure | 4.6; row 42 |
| A4 Hand-off cannot keep whole exchanges within its cap | major | As TM-3 | WS-6; row 47 |
| A5 No rollback after roles events exist | major | Two owner switches; no downgrade once roles events exist | 3.10, 3f, 8.1, rollout 6; row 46 |
| A6 Fixtures have no permission examples | minor | Task 2g and criterion 2.13 | 2g; row 51 |
| A7 Cache expiry needs request start and lifetime split | minor | Request start or `TurnStarted`; lifetime split; owner setting otherwise | WS-5, 5.5, 7.5; row 45 |
| C1 Capacity retry has no exit from its pause | major | As A1 | row 36 |
| C2 Resume does not restart crashed work | major | As A3 | row 42 |
| C3 Hand-off exceeds both limits | major | As TM-3 | row 47 |
| C4 Stall rule flags an agent waiting on another | major | "Waiting on others" stops the stall clock | WS-4 intro, 4.3; row 37 |
| C5 Third-stall rule has no recurrence policy | major | Stall state machine with episodes | WS-4 intro, 4.2; row 37 |
| C6 Owner team-idle notice has no alert | minor | `TeamIdleReported` raises `roles.stall` for the owner | Alert sources, 4.9; row 39 |
| C7 Fixtures hold no tool calls | minor | As A6 | row 51 |
| Lo-L1 Stall flags every lead waiting on its workers | major | As C4 | row 37 |
| Lo-L2 Stall episode, count and progress undefined | major | State machine; counter per post and addressee; tool calls are not progress | 4.2; row 37 |
| Lo-L3 Crash resume fights the engine's notice and `gone` | major | The sheepdog keeps the first retry; its notice tells the holder about `gone` and not to replace; alternative offered to the lead | 4.6; row 42; known gap 15; question 2 |
| Lo-L4 7b pause cannot be resumed and wakes the parent | major | As A1; a held delivery keeps the wait open | 7.3; row 36 |
| Lo-L5 Re-send duplicates board wakes | major | As A2 | row 49 |
| Lo-L6 Prefix match admits code-running arguments | major | L20: exact word list | 2.3; row 35 |
| Lo-L7 Unknown working folder has no policy | major | As F7 | row 35 |
| Lo-L8 Owner notices without an alert kind; double alert | major | Mapping within the four kinds; no `GaveUp` alert after a crash | Alert sources, 4.9; row 39 |
| Lo-L9 Notices to a dead parent are lost | major | Nearest available holder, re-sent once when the recipient dies | 3.7; row 38 |
| Lo-L10 Request ids break repeats | major | Id with action kind, recipient and occurrence | Request ids, 3.3; row 41 |
| Lo-L11 Runaway measures a turn, not the worker's age | major | Turn and age limits | 4.4; row 43 |
| Lo-L12 Rule scope AND/OR and empty list | minor | Every listed dimension must match; empty matches nothing | 2.8; row 35 |
| Lo-L13 Team idle: paused, finished and several roots | minor | Live unpaused member required; per top agent and holder | 4.1; row 44 |
| Lo-L14 Alerts end too early | minor | Per-kind ends; no nudges after replace advice | Alert ends, 2.11; row 40 |
| Lo-L15 Missed cache deadlines fire at start-up | minor | Cache deadlines dropped; others re-checked, one step | 3.9; rows 37, 45 |
| Lo-L16 Cache fields lack the lifetime split | minor | Split fields read; reads renew | 5b, 5.5; row 45 |
| Lo-L17 Pass-up reported as the worker's break | minor | Only the worker's own actions, by caller | 4.8; row 50 |
| Lo-L18 Hand-off tie-break | minor | As TM-3 | row 47 |
| Lo-L19 Disable, expiry and id ordering | minor | Transaction match, time input, numeric ids never reused | 2.8, 2.9, 2.10; row 35 |
| Lo-L20 Capacity counter never resets | minor | Count per outage, reset on a clean turn | 4.5; row 49 |
| Lo-L21 Fallback kept against L17 | minor | As F12 | row 34 |
| Ls-L1 Capacity pause has no resume | major | As A1 | row 36 |
| Ls-L2 Crashed work not restarted; no failure branch | major | As A3 | row 42 |
| Ls-L3 Fallback retry competes with the board | major | As A2 | row 49 |
| Ls-L4 Dependency waits classed as stalls | major | As C4 | row 37 |
| Ls-L5 Escalation to a supervisor that cannot receive | major | As Lo-L9 | row 38 |
| Ls-L6 Revocation and answer ordering | major | As TM-2 | row 35 |
| Ls-L7 Hand-off exceeds budgets | major | As TM-3 | row 47 |
| Ls-L8 Notice fallback stale under L17 | minor | As F12 | row 34 |
| Ls-L9 Team idle with several roots | minor | As Lo-L13 | row 44 |

## Notes the reviews raised without filing

- Known gap 9 said "rollout step 7"; it is step 6, now corrected.
- `context-keeper.sh` compacted only leads, relayers and the manager; a role
  file may now switch compaction off for a role (row 45).
- The threat model's compensating control for known gap 11 is adopted: a
  rule added by a since-revoked device stops matching (row 35).
- The architect's and critic's restart checks (ARCH-PB-5, PB-ACTIONS) and
  the threat model's differential parse check (PB-T3) are post-build checks
  5 and 6 and criterion 3.2.
- The critic's PB-RIG: a test clock does not reach a child process, so
  the acceptance test sets its limits to seconds (conventions, 8.2).
