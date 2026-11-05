ship
Grade: 8  B/M/m: 0/0/3  Flags: none

# Review basis

This is the round 5 plan critic review of roles plan v14, on the client API contract v12 and the board contract v10. The three findings are limited defects. They do not justify another review round under the assignment's severity rule.

Paths below are relative to this review's `roles-r5/` directory unless they begin with `packages/`. `P` means `shepherd-foundry-roles/plan.md`. `CAPI` means `inputs/client-api-contract.md`. Code references are relative to the repository at recorded commit `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`, except references explicitly marked current, which use `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`. The findings concern the proposed design, not defects asserted to exist in unbuilt roles code.

# Findings

## R5-C1. A delayed first-use record can reopen a disabled rule's alert

**MINOR. Category: Design; consequence: an obsolete alert. Evidence status: confirmed specification gap. Responsible builder: roles backend, first-use reactor and alert sources. Risk score: 24.**

A rule answers a permission request. Before the first-use reactor writes its record, the owner disables the rule. The disable event ends any existing first-use alert. The delayed reactor then writes `RuleFirstUsed`, which raises a new alert for that already-disabled rule. A restart between the answer and the reactor's write makes this ordering particularly easy to exercise.

The reactor's predicate is use count above zero and no first-use record; it has no enabled-state condition (`P:783`). Every first-use record raises the alert (`P:400`), and a disable or removal ends it (`P:417`). The record carries the rule id and asking agent, without its current state (`P:388`). The client API contract explicitly leaves a piece's alert source a pure function of one envelope (`CAPI:889-895`), so the source cannot quietly consult the current rule view to repair this ordering. Criterion 2.12 covers delayed recording across restart and eventual closure, but does not cover disable-before-record (`P:770`).

Specify the late-record behavior while preserving the first-use audit record. For example, make the record distinguish whether the notification is still applicable at its atomic write, or specify a durable cleanup that closes this stale alert. Add a deterministic test that holds the reactor after the permission answer, commits a disable, then lets it run, both with and without a restart. The rule must remain disabled, its first use must remain recorded once, and no obsolete alert may remain open. This is a limited notification defect, not an approval-safety defect or a reopening of the answered first-use idempotency finding.

## R5-C2. The build dependency table omits conditional and usage edges

**MINOR. Category: Design. Evidence status: confirmed. Responsible builder: roles planner and launch lead. Risk score: 8.**

The supported outcome in which no harness qualifies drops units 3, 4 and 11a (`P:653-658`, `P:1402-1410`). Units 12 and 13 nevertheless retain unconditional dependencies on dropped unit 4 (`P:1392-1393`). The stated 14-unit build therefore has dangling dependencies. The acceptance scenario already makes its standing-rule step conditional (`P:1245-1246`), so this needs a corresponding execution-table correction rather than a reversal of lead ruling L27.

There is also a missing ordinary dependency: unit 9 depends only on unit 5 (`P:1387`), although its acceptance criterion and usage-source task consume WS-7c's persisted usage (`P:1004`, `P:1012`). Unit 11c produces that runner-to-log path (`P:1391`, `P:1212`). A launcher following the table can start cache timing before its declared usage source exists.

Make the unit-4 edges conditional on the qualifying-harness branch and add unit 11c as a prerequisite of unit 9. Check both selected build graphs for missing dependencies. This is an execution-plan defect that the lead can correct directly; no core product flow is proved broken by it.

## R5-C3. A client cannot recover snoozes omitted from the bounded snapshot

**MINOR. Category: Design. Evidence status: confirmed contract gap. Responsible builder: roles contracts and snapshot/read handlers. Risk score: 24.**

A client connects when the roles snapshot reaches its byte budget before all snoozes fit. It receives a truncated snooze list and subscribes after the snapshot's sequence. It has no specified read that reconstructs the omitted current snoozes, so it cannot show the complete current team-idle notification state.

The snapshot includes snoozes and explicitly permits their list to be cut after earlier sections have consumed the 128 KiB budget (`P:434-464`). The documented recovery reads are only `roles.rules.list` and `roles.actions.list` (`P:441-443`). The command table defines settings as limits and switches, and the action list as sheepdog action records (`P:371-377`). `roles.Snoozed` is separate from that action-record list (`P:384-388`). The snapshot acceptance criterion reconstructs omitted rules and records but omits snoozes (`P:623`).

Provide a bounded read for the complete current snooze state, either through an existing suitable read or a paged snooze read. Extend the snapshot reconstruction criterion to deliberately cut the snooze list and recover it through that named command. This preserves the accepted snapshot limits. The scheduler can still honor its persisted snoozes; the limited defect is the client's incomplete overview after connection.

# Risk register

Scores use severity × fallout × probability. Decisions remain with the owner. No acceptance, fix commit or closing evidence exists for these new findings.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Responsible role | Decision | Deadline | Acceptance | Closing evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| R5-C1 | 2: obsolete notice | 3: one owner can dismiss it | 4: delayed reactor overlaps a disable | 24, record | Confirmed design gap | Roles backend | Pending owner | Review at phase end | None | Pending late-record test |
| R5-C3 | 2: incomplete notification-state display | 3: confined to the connecting client; recoverable through a corrected read | 4: uncommon large-state snapshot reaches the cut | 24, record | Confirmed contract gap | Roles contracts/backend | Pending owner | Review at phase end | None | Pending reconstruction test |
| R5-C2 | 1: launch/tooling gap | 1: development only | 8: dependency-driven launches commonly consume this table | 8, record | Confirmed plan gap | Planner/launch lead | Pending owner | Review at phase end | None | Pending corrected graphs |

# Proposed post-build checks

These are implementation proof obligations, not additional findings about code that does not exist yet.

| Id | Scenario | Expected result | Required evidence | Responsible role |
|---|---|---|---|---|
| PB-C1 | Pause first-use recording after a rule answer; disable the rule; resume the reactor, including across restart. | One audit record, no reopened stale alert, no further rule matches. | Persisted event order, alert state, rebuilt view, and a deterministic test addressing R5-C1. | Roles backend |
| PB-C2 | Run the build selection with a qualifying harness and with none. Exercise a snapshot whose snoozes are cut. | Both graphs resolve; the remaining socket acceptance runs without standing rules; a client recovers every current snooze through its documented read. | Selected dependency graphs, socket scenario output, snapshot/read reconstruction addressing R5-C2 and R5-C3. | Launch lead and roles backend |
| PB-C3 | A matched permission request arrives while its holder is in a blocking wait; repeat with an owner-held asker. Include a stalled path resolver and a matcher that throws. | Request and answer publish atomically; no routed delivery, transient request-held wake or owner alert; failures fall back to ordinary approval; another agent's runner events continue. | PC09-PC17, durable callers after log reload, event batches, waiter/alert observations, and existing permission tests. | Engine backend and client API builder |
| PB-C4 | Capacity failure before acceptance and after acceptance; replace and withdraw board wakes under the hold; empty its queue; restart; release with each allowed and refused caller. | No dispatch or wait completion while held; accepted content is not resent; the carry-on is held; release dispatches any next delivery; an empty hold remains unsettled until release. | K09-K19, RL04-RL06, board criterion 6.7, live/rebuilt views, engine wait and owner-helper results at the same completed batch boundary. | Engine, board and client API builders |
| PB-C5 | Kill between each sheepdog command and its action record, including a recipient becoming unavailable before retry. Replay oversized-event markers. | Exactly one intended action with stable retry body; the documented recipient transition occurs once; `client.event` retrieves markers through the actual service entry point. | S02-S06, notice tests, service allowlist tests, persisted command receipts and action records. | Roles backend |
| PB-C6 | Feed raw terminal usage through the actual runner; follow with a turn lacking usage; use a multi-request turn. Run cache deadlines with the composed socket service on the test clock. | Terminal usage reaches `TurnEnded`; usage does not leak between turns or replays; context uses `used` or the last request, never the turn sum; cache timing uses request start. | Usage U01-U04, CM01-CM20, raw-frame-to-log trace, and Foundry acceptance output. Run the separate live check on real accounts only through the owner-authorized step. | Engine and roles backend |
| PB-C7 | Register all new commands and events in the actual composed application, including against the newer engine branch. | Exhaustive schemas, state transitions, visibility samples, MCP names and command-line parity remain complete; pre-existing credential/terminal behavior survives. | The named contracts/engine/CLI test files, new held-event round trips, real-runner fixture loop, rebuild check, then the full workspace check required by P:1233. | Engine backend and integration reviewer |

# Noted, not filed

## Earlier review answers

The 32 round 4 findings remain answered. The following groups cover every entry in `attack/round-4-findings.md`; none warrants reopening.

| Round 4 findings | Answer retained in v14 |
|---|---|
| A-R4-A1 | Planner replies carry the board post id; notices persist it (`P:392`, `P:783`; CAPI E3). |
| A-R4-A2, C-R4-C3, TS-R4-TM-2 | `orient` uses the read rule; hand-off uses management rights (`P:367-368`, `P:626`, WS-6). |
| C-R4-C1, TS-R4-TM-4 | Roles events keep all states; held/released lifecycle cells and exhaustive tests are named (`P:622-634`, `P:1156-1160`, `P:1182-1184`). |
| TS-R4-TM-1 | Durable envelope caller/device and `answeredBy` remain explicit dependencies of first-use reconstruction (`P:783`; CAPI E11, E12, E14). |
| Ls-R4-L2, Lo-R4-L3, TO F5 | Rule answer and request are one projected transaction; routing is replaced; wait checks run once; PC09, PC10 and PC16 prove no transient held request (`P:1110-1119`, `P:1209`). |
| Ls-R4-L1, Lo-R4-L6 | Unknown-reset usage pauses count as owner-blocked; clocks restart from zero; TI12 and ST22 remain (`P:869-892`, `P:934-936`). |
| Lo-R4-L1 | Cache guards concern the agent's own pending work; non-blocking waits and working descendants do not suppress compaction; CM18-CM20 remain (`P:985-1004`). |
| Lo-R4-L2 | Worktrees under harness settings paths fail closed; M70, PC14 and the documentation requirement remain (`P:764`, `P:1209`, `P:1244`; known gap 22). |
| C-R4-C2, Lo-R4-L9 | Runner idle-frame capture, internal event, handler decode and persisted usage are all named; the basis is `used` or the last request (`P:1193-1212`). |
| TS-R4-TM-3, Lo-R4-L8 | Capacity is a runner outcome distinct from pause; classification sources and the real-runner fixture loop are specified (`P:1135-1149`, `P:1176-1181`, `P:1210`). |
| A-R4-A3 | Changed writers/readers and existing classifier, lifecycle, visibility, contracts, stream and CLI tests are named; whole-workspace verification remains (`P:1105-1220`, `P:1233`). |
| A-R4-A4, C-R4-C4, Ls-R4-L4, TS-R4-TM-5 | Stall task 4b names the engine board export and contracts settled helper (`P:949`). |
| Lo-R4-L4, Lo-R4-L7 | Hold-condition failure means no; outage ends and capacity return cause are explicit (`P:1161-1166`, `P:1210`, WS-4 capacity task). |
| Lo-R4-L5 | Sheepdog work is excluded from busy time, with the author-blocked exception retained; ST20/ST21 remain (WS-4 introduction and criteria 4.2/4.3). |
| Ls-R4-L3 | A wake containing a completion is an ordinary turn; N19 remains (`P:515-520`, criterion 3.11). |
| TO F1, TO F4 | Every word and locations entry is resolved under bounded, off-event-loop work; answer runs on its own fiber; PC11-PC13 remain (`P:1122-1128`, `P:1209`). |
| TO F2, TO F3 | Per-service command lists, negative real-entry tests and import-boundary tests remain; sheepdog has no answer/start/stop rights (`P:821`). |
| TO F6 | `release` uses the holder rights helper, explicit refusal cases and CLI parity (`P:1153-1155`, `P:1211`). |

The earlier-round safety and durability answers also remain: exact conservative command parsing, role-and-group intersection, sandbox and shell discrimination gates, settings-path protection, recorded request input, bounded snapshots and hand-offs, holder-aware delivery/read tracking, restart-safe action ids, board-off behavior, capacity outage counts, and the three-episode stall rules. R5-C1 adds a different event ordering; R5-C3 adds the omitted snooze recovery surface. Neither disputes the bounds or idempotency fixes already accepted.

## Engine edits at both commits

At `8ff4c9b`, the named edits have real targets. `packages/engine/src/commands/CommandHandler.ts:130` handles runner events, decodes at line 133, performs writes and wait checks inside the transaction at lines 138-165, and consumes runner events sequentially at line 177. `packages/engine/src/log/EventLog.ts:242` implements the serialized SQL transaction, and publishes after the outer transaction commits at line 266. Thus the plan correctly treats WS-7a as a change to the existing atomic path, rather than an independent later answer.

The usage repair addresses the actual missing route: `packages/engine/src/runner/AcpRunner.ts:59` has no per-turn usage, `finish` at line 162 creates the terminal event, and the idle-frame branch at line 354 returns before translation. The permission handler at line 400 owns the permission request's tool call. `packages/engine/src/routing/deliveries.ts:92` creates persisted `TurnEnded`; WS-7c names this writer and the handler decode. Merely editing translation would still be insufficient, and the revised plan no longer does that.

Capacity also changes real behavior: `packages/engine/src/runner/AcpRunner.ts:54` currently admits only the two pause classifications; its `finish` maps classified errors to pauses. `packages/engine/src/routing/deliveries.ts:109` distinguishes acceptance, its pause path is at line 142, and `packages/engine/src/recovery/reload.ts:76` builds recovered delivery state. The proposed accepted-versus-unaccepted hold policy names those paths. The dispatcher at `packages/engine/src/routing/deliveries.ts:230` and its trigger at line 269 will need the specified hold/release behavior; this is covered by PB-C4, not treated as already implemented.

The exhaustive existing tests are real: `packages/contracts/test/events-roundtrip.test.ts:18`, `packages/contracts/test/state-machine.test.ts:285`, `packages/engine/test/api/subscribe-visibility.test.ts:149`, `packages/engine/test/runner/classify-errors.test.ts:21` and `packages/cli/test/parity.test.ts:27`. The classifier fixture inventory at lines 51-55 and real-runner assertions at lines 122-136 explain why the plan now names both changes. `packages/engine/test/support/rebuildCheck.ts` exists, and the root Vitest configuration includes the affected projects.

The check against `9e386b0` found no concrete invalidation of a named change. Current `CommandHandler.ts:132` retains the runner-event path; current `AcpRunner.ts:259` retains `finish`, current line 487 retains the early idle return, and current line 558 retains the permission-request path. Terminal draining and redaction have been added around these paths, so the builder must preserve them while inserting capture and classification. Core delivery routing, the lifecycle table and the ceiling resolver have not been replaced. The changed reload helper remains the same recovery integration point. New start preemption and structured redaction require preservation in integration tests, but neither makes the roles plan's named change wrong. Shifted line numbers are not findings.

## Shared joins, scope and accepted limits

The client API and board joins agree on the significant boundaries: batch-end wait evaluation, durable callers and service identities, owner-only roles events, separate read and management rules, all-tool permission input with execute-only matching, source-id delivery tracking and explicit board readers, and the empty capacity hold remaining unsettled. The owner/device/service snapshot carries `capacityHeld`; the agent snapshot omits it (`P:1167-1175`). A withdrawal may empty the queue without ending the hold. The hold condition and matcher are separately total fail-closed functions; the general piece guard is not their only failure policy.

The service prose's shorter command list should be aligned editorially with criterion 3.4, which already explicitly permits `client.event` (`P:821`) and agrees with the current client API contract. Likewise, older execute-only wording does not override WS-2's explicit all-tool recording and criterion 7.1. These have a usable, specific governing answer and are not additional findings.

The ten planning gates and the scope decisions were checked against the supplied owner/lead rulings. No new blanket scope rule lacking the required owner confirmation was found. The Foundry workflow rewrite stays outside these product units. Standing rules remain conditional on recordings, with no assumption that either current harness qualifies. Known gaps 14, 17, 18 and 21 accept that outcome; the dependency correction in R5-C2 must preserve it. The database-write threat, the computer-only rule-add limitation while the web server is open, the settings-folder restriction and the crash/replacement race are already disclosed and accepted in the supplied decisions or known gaps. They are not re-filed.

## Review log and documentation checks

This was a static plan/code review. Node 26 was selected with `nvm use`. No product tests or live-account runs were performed, and no implementation proof is claimed. Both checkout commits were verified. The reviewed repository remained clean. No reviewer scratch files were created, so the named scratch folder required no cleanup. The only produced file is this result.

The documentation lookup through Context7 failed with its monthly-quota message. The fallback read official sources on 2026-11-03: [Effect 4.0.4 TestClock source](https://raw.githubusercontent.com/Effect-TS/effect/effect@4.0.4/packages/effect/src/testing/TestClock.ts), the [official Effect Vitest README](https://raw.githubusercontent.com/Effect-TS/effect-smol/main/packages/vitest/README.md), and [Anthropic prompt caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). These support deterministic clock adjustment, the test-service approach, and measuring cache lifetime from request start. The pinned Vitest README fetch was unavailable; the unpinned README is not treated as proof of every installed-version API. The implementation must use the repository's pinned exports and prove the socket scenario through PB-C6. No copied source code was produced.
