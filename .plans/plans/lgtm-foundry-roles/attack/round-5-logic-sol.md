revise
Grade: 7  B/M/m: 0/1/1  Flags: none

## Scope and evidence

This review checks plan v14 through logic and failure policy. It checks the round 1 to round 4 finding maps, decisions, known gaps, binding rulings, client API contract v12, and board contract v10. In the references below, `plan.md` and `decisions.md` are the frozen files beside this attack folder. `CAPI` and `Board` are the copies in `roles-r5/inputs/`. Code references are relative to the repository and are at `8ff4c9b`, unless another commit is stated.

The review is static. No application code was changed, and no test execution is claimed. Node.js 26.13.0 was selected with `nvm use`. The checkout remained clean. No scratch files were created.

## Findings

### R5-L1. MAJOR, Design / Bug (failures): an interrupted automatic crash recovery has no durable continuation policy

**Scenario.** A worker has accepted its prompt and then crashes. The sheepdog calls `resume`, which opens the saved session successfully. Kill the LGTM Studio service after `SessionOpened`, before the sheepdog's carry-on `prompt` and `CrashRetried` record. At restart, engine recovery restores the worker idle. The original crash is no longer the worker's current lifecycle state, and the sheepdog has no completed crash action record. Reapplying the specified current-crash check skips the very operation whose remaining carry-on is still owed. The worker never gets the promised continuation unless someone prompts it manually.

**Plan evidence.** Criterion 4.6 (`plan.md:939`) specifies the order: check the crash, call `resume`, wait for `SessionOpened`, send the missing carry-on, then report `CrashRetried`. The position and request-id rules (`plan.md:561`, `plan.md:600`) provide replay and deduplication, but define no admitted, partly completed crash operation that survives a change out of `crashed`. Criterion 3.2 (`plan.md:819`) and post-build check 5 (`plan.md:1278`) promise exactly one command across a kill between commands and records. That promise needs a continuation decision here, not merely a repeated command identifier.

**Checked engine evidence.** At `8ff4c9b`, `packages/engine/src/commands/resume.ts:26` commits `starting`; its reload gets `midTurn: true` only for an interrupted agent whose previous state was working (`resume.ts:48`). A resume from `crashed` therefore does not request a carry-on. `packages/engine/src/recovery/reload.ts:81` considers sent deliveries, and `reload.ts:87` queues a carry-on only from a replay-proven sent delivery or `midTurn`. An already accepted delivery does not supply either. The successful `SessionOpened` therefore leaves this case idle. A subsequent restart records `previous: idle` (`packages/engine/src/recovery/restart.ts:123`) and reloads with `midTurn: false` (`restart.ts:175`), again supplying no continuation. Replaying the original resume identifier also cannot finish its external hook: receipt replay sets `afterCommit: undefined` (`packages/engine/src/commands/CommandHandler.ts:255`). CAPI preserves that behavior explicitly (`CAPI:1575`).

These same resume and restart decisions remain at `9e386b0`: `packages/engine/src/commands/resume.ts:26`, `resume.ts:48`, `packages/engine/src/recovery/reload.ts:82`, `reload.ts:88`, and `packages/engine/src/recovery/restart.ts:123`, `restart.ts:175`. Receipt replay still omits the hook at `packages/engine/src/commands/CommandHandler.ts:297`. This is a defect in the proposed recovery policy against both commits, not a finding caused by shifted anchors.

**Suggested fix.** Define when a crash recovery is admitted and how its remaining steps are recovered after admission. Record its crash sequence, command identities and unfinished phase before the first external action, or define an equivalent durable reconstruction from the engine records. Apply the current-crash check to a new admission; continue an already admitted operation from its durable outcome after restart. State how an owner stop or manual replacement cancels that duty. Distinguish an admission that must be skipped from an admitted resume that still owes its carry-on. An engine operation that durably queues that carry-on with the successful reload is another possible fix, but would need its own named engine change and tests.

**Earlier answers.** The happy-path fixes for round 1 A3/C2/Ls-L2 and round 2's retry safety remain useful. This finding is the unaddressed recovery window between the successful resume and its follow-up prompt. It does not reopen known gap 15, which accepts the separate race with a holder starting a replacement.

**Owner:** roles/backend, with engine/backend if the chosen fix changes resume. **Evidence status:** confirmed plan-policy gap from the specified operation order and the checked engine behavior; implementation remains unbuilt.

### R5-L2. MINOR, Design: the stall acceptance table requires opposite outcomes for the same lead

Criterion 4.3 (`plan.md:936`) says that when a worker posts a question to its idle lead while a sibling works, neither the worker nor the lead is stalled. In the same criterion, it requires that the lead be nudged about that question because the asker reaches nothing busy except through the lead. The author-blocked exception in `plan.md:889` and decision row 88 (`decisions.md:92`) chooses the second outcome. The first expectation was retained from the earlier transitive-waiting answer and now contradicts it.

Use one explicit fixture: idle lead L, working sibling S, worker W whose unanswered post Q names L, and no other route from W to busy work except through L. State that W is shielded by the working dependency, while Q's clock for L runs under the exception. Remove the unconditional statement that L is also shielded, or narrow it to a separate post and explain that distinction. Make ST16 and ST21 express those distinct expectations.

This is a limited acceptance-specification defect. It does not establish a second major runtime failure or warrant another round by itself.

**Owner:** roles/backend and the planner. **Evidence status:** confirmed contradictory expectations. This is the remaining inconsistency in the fold of round 3 Lo-R3-L1 and round 4 Lo-R4-L5, not a rejection of either policy.

## Risk register

The scores use severity × fallout × probability. Decisions remain with the owner or lead; suggested fixes above are recommendations.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score / band | Evidence | Owner | Decision / deadline |
|---|---|---|---|---|---|---|---|
| R5-L1 | 6: automatic recovery can leave core work idle until manually prompted. | 3: the holder can repair it by prompting; no permanent data loss is established. | 2: an agent crash and a service interruption during its recovery coincide. | 36 / record | Confirmed policy gap. | roles/backend; engine/backend if needed. | Pending; review at phase end under the rubric. |
| R5-L2 | 1: conflicting test expectations require a specification correction. | 1: development-stage consequence. | 10: both statements apply to the stated fixture. | 10 / record | Confirmed. | Planner and roles/backend. | Pending; review at phase end under the rubric. |

## Interacting-rule truth table

These are plan outcomes, not results of executed tests.

| Conditions | Stall or idle outcome | Other required behavior |
|---|---|---|
| Sheepdog off; any board state. | No notices or timers. | Release existing holds; create no new hold. |
| Sheepdog on; board off. | Stall and team-idle rules suspended. | Crash and capacity handling continue; board-off give-up may alert the owner. |
| Worker paused for usage with known reset. | Counts as busy for its dependency chain; no stall. | Engine owns the account-return timer. |
| Worker signed out or paused with unknown reset. | Counts as the owner; dependent clocks stop. | Restart those clocks from zero when the account becomes usable. |
| Open capacity hold with an empty queue. | Counts as busy; no stall or cache action. | Engine and owner helper remain waiting until release, stop or crash. |
| Idle dependency cycle; no owner, real busy party or held request reachable. | Owed replies can stall. | The visited set terminates the search. |
| Lead reaches working children; worker owes an unrelated reply. | Ordinary transitive waiting shields the dependent worker. | Sheepdog-only turns do not supply busy work. |
| Worker W asks idle L while sibling S works; all W-to-busy paths pass through L. | W is shielded; Q's clock for L runs by the exception. | R5-L2 removes the contrary expectation. |
| Crash recovery succeeds through resume, then service dies before carry-on. | Engine may restore the worker idle. | R5-L1 requires a durable remaining carry-on duty. |

## Earlier answers and the joins

The round 4 answers hold in the reviewed contract and plan text, subject to R5-L2's contradictory retained expectation. The standing-rule request and answer are one projected batch with no holder delivery or `OwnerNeeded`; the owner's wait gates every exit at a complete views sequence. Unknown-reset pauses count as the owner. Cache timing permits an idle lead with a non-blocking wait or an open own post. Worktrees under protected settings folders fail closed. Usage travels through the idle frame and the internal runner event. Capacity has its own outcome, its count belongs to the engine, and its outage has named ends. Sheepdog-only wakes and compactions are excluded from real busy work; a completion makes a wake ordinary. Services have individual command lists, release uses the management helper, and roles events keep every lifecycle state. The shared fixes separate reads from planners, read visibility from management rights, durable caller identity from receipt keys, and piece writes from direct log writes.

Earlier answers on bounded snapshots, hand-off overflow through the lead, board-off behavior, recovery readiness, rule qualification, first-use notices and one-time permission checks were retained. No accepted owner decision or open known gap is re-filed.

The cross-plan joins also agree: `board.WakeBuilt` names a source id, the roles learn its delivery id from `DeliveryQueued`, and read state can then follow acceptance (`plan.md:550`; `Board:326`). Empty holds remain unsettled in the engine rather than in a roles condition (`plan.md:1210`; `CAPI:2043`; `Board:410`). The snapshot flag is owner/device/service-only. The board's service direct pair allows sheepdog notices, and service command restrictions still exclude `board.read`. The first-use reactor is a level rule and writes only its namespace through the piece batch path.

## Proposed post-build checks

1. **PB-R5-CRASH.** For an accepted worker prompt, kill after the sheepdog's resume transaction, after its successful `SessionOpened`, and after its carry-on prompt but before its action record. Restart the actual service. Expect one admitted recovery to finish with exactly one carry-on, one correct retry count and one notice; expect an intervening owner stop to cancel it. Required evidence: durable envelopes and rebuilt views, plus the fake runner's actual sends. Owner: roles/backend. This verifies the policy chosen for R5-L1; it cannot replace choosing that policy.
2. **PB-R5-ACTIONS.** In the existing kill-between-command-and-record test, include multi-command and multi-recipient actions: post, flush and record; episode 2's nudge and holder notice; each top agent and distinct holder in team idleness. Verify distinct command request identifiers, stable bodies on retry, and that a saved source position skips no unfinished part. Required evidence: receipts, source positions and actual delivered wakes. Owner: roles/backend.
3. **PB-R5-STALL.** Exercise the exact L/W/S fixture in R5-L2, then add a busy route that bypasses L and a sheepdog-only turn at L. Expect only the chosen post/addressee clocks to run and the episode count to survive restart. Required evidence: clock transitions and action records. Owner: roles/backend.
4. **PB-R5-JOIN.** Run the named board-capacity-hold acceptance case through both engine wait and the owner's helper, including a split catch-up batch and a withdrawal of the final queued wake. Verify agreement at complete-state boundaries and a release with no send from an empty queue. Required evidence: socket replies, committed envelopes and rebuilt views. Owner: engine/backend with the board and client API builders.
5. **PB-R5-STREAM.** Keep PC13's proof that a hanging permission-path resolution does not stop another agent's runner events. The existing consumer is sequential at `8ff4c9b`, `packages/engine/src/commands/CommandHandler.ts:177`, and at `9e386b0`, `CommandHandler.ts:179`. Verify this through the real event consumer, not just a pure matcher or a clock timeout. This is verification of the already named criterion, not a re-filed finding.

## Noted, not filed

- I compared the named engine-edit paths against `9e386b0`. The newer login handling, start preemption, terminal output and structural redaction do not remove the resume, capacity, permission or usage paths this plan relies on. No additional finding is filed solely for branch movement. The newer runner's idle frame still returns before ordinary translation (`9e386b0`, `packages/engine/src/runner/AcpRunner.ts:487`), so WS-7c's named capture point remains necessary. The stronger redaction around permission data must be preserved when implementing CAPI E29 (`9e386b0`, `AcpRunner.ts:558`).
- The existing tests named for WS-7 are present at `8ff4c9b`. The fixture-kind coverage and real-runner classification loop are at `packages/engine/test/runner/classify-errors.test.ts:21`, `classify-errors.test.ts:51` and `classify-errors.test.ts:122`, matching the proposed third outcome. The state, visibility, wait and permission test inventories are named in the roles plan and shared edits. The event-tag pin at `packages/contracts/test/events-roundtrip.test.ts:75` is covered by CAPI E5 and must also gain the two new engine tags in unit 11b.
- No money calculation is introduced. Cache scheduling chooses a deadline; it does not compute a charge. Standing-rule ties are explicitly resolved by lowest numeric rule id, and mode, expiry and switch checks are transaction-local. No additional arithmetic or tie-breaking defect was found.
- The qualifying-harness gate, absent Claude shell folder, Codex sandbox evidence, accepted same-user state access, symbolic-link timing window, and engine crash-notice race remain the listed known gaps or rulings. They are not counted again.
- Context7 returned a monthly-quota error. I used official documentation as the fallback, checked on 2026-11-03. The [Effect testing README](https://github.com/Effect-TS/effect/blob/main/packages/vitest/README.md) and [Effect 4 scheduling examples](https://effect.website/docs/v4/scheduling/cookbook) support the proposed test-clock approach. [Anthropic's prompt-caching guidance](https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/prompt-caching.md) supports measuring cache lifetime from the request start, with generation time consuming that lifetime. Adapter-specific last-request usage and transcript availability still require the plan's recorded and live checks; no claim of their successful execution is made.
