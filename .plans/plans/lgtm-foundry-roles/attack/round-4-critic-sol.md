revise
Grade: 6  B/M/m: 0/3/1  Flags: none

# Review scope and evidence

This is the round 4 plan-critic review of the frozen roles plan v5. The checkout is clean at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. `plan.md` is byte-identical to `attack/plan-v5.md`. Repository files were read only. Node.js 26.13.0 was selected with `nvm use`. No implementation tests or live account checks were run.

Paths below are relative to the recorded checkout unless prefixed otherwise. `P` means this report's parent plan directory, `/home/qnlbnsl/projects/personal/lgtm-studio/.scratch/foundry-runs/foundation-plans-1/review/roles-r4/lgtm-foundry-roles`. `I` means the sibling `roles-r4/inputs` directory. Plan and contract citations refer to those frozen files, rather than to files supposedly present in the checkout.

The owner's direct-engine-edit answer and rulings L26, L27 and L28 are binding. None of these findings asks to restore the old extension mechanism, defer the authorized capacity work, or build standing rules without a qualifying recording.

# Findings

## C-R4-C1. Event registration omits an exhaustive lifecycle consumer and its existing test

**MAJOR. Category: Design. Evidence status: confirmed plan gap. Responsible area: client API shared engine unit 1a, followed by roles units 1 and 11b.**

Scenario: the shared engine unit extends `Event` with piece events, and the roles units add their action events plus `DeliveryHeld` and `DeliveryReleased`. Following the enumerated registration edits leaves the contracts package unable to typecheck. The existing lifecycle test also exercises every newly added tag without a lifecycle-table entry. Merely decoding the new events and adding a piece reducer does not complete registration.

Evidence:

- `I/client-api-contract.md:693` describes E5 as extending the union, making engine views ignore piece tags, and updating only `packages/contracts/test/events-roundtrip.test.ts`. `P/plan.md:498` delegates roles event registration to E5. `P/plan.md:976` adds the two capacity events without naming a lifecycle-table change.
- At the recorded commit, `packages/contracts/src/stateMachine.ts:78` explicitly requires every event to have a decision for all seven lifecycle states. Its `eventTable` is typed as `Record<Event["_tag"], Record<StateName, EventEffect>>` at line 79. `eventEffect` indexes that table at line 122.
- `packages/contracts/test/state-machine.test.ts:285` derives tags from the actual event union. Its checks at lines 333 and 344 exercise every tag/state cell. This existing test is absent from both E5's and WS-7's changed-test inventories.
- The event union also drives `packages/engine/test/api/subscribe-visibility.test.ts:149`. Its sample inventory must equal the union. New roles events are owner-only (`P/plan.md:356`), so its all-tag self/child expectations at `packages/engine/test/api/subscribe-visibility.test.ts:154` need class-aware cases while preserving the original engine-tag assertions.

Suggested fix: make E5 include the lifecycle table, state the policy for piece metadata events, and assign the lifecycle cells for the two engine hold events. Name the existing state-machine test and the new-tag visibility fixture changes in the owning units. Do not weaken coverage by dropping new tags from the exhaustive tests.

Also complete the affected-test inventory for `release`: `packages/cli/test/parity.test.ts:23` iterates the full RPC group, but its payload map at line 27 has no `release`, and line 39 explicitly rejects a missing fixture. E10 promises whole-group parity coverage (`I/client-api-contract.md:759`); WS-7b must extend that coverage when it later adds this command. Its verify command at `P/plan.md:990` runs only engine tests, omitting both contracts tests and CLI parity. Add a final workspace check, such as the existing `pnpm check` from `package.json:13`, after these engine units. This is one event/API registration and verification finding, rather than separate findings for each resulting fixture failure.

## C-R4-C2. The named WS-7c route cannot carry the cited terminal usage to the event log

**MAJOR. Category: Design. Evidence status: confirmed missing engine path. Responsible area: roles engine unit 11c.**

Scenario: a Claude adapter emits exactly the usage frames cited by task 7c, and no transcript is available. The adapter has supplied cache token counts, but a translator-only change cannot put them on the persisted `TurnEnded`. This breaks criterion 5.6's adapter-first usage flow and leaves cache timing without that source.

Evidence:

- `P/plan.md:956` identifies the changed runner behavior as translation reading ignored usage updates. Task 7c at `P/plan.md:977` names only `runner/translate.ts`, the contracts `TurnEnded` schema, and fixture lines 17–20. Unit 11c is consequently described as an optional event field plus translation, in the contracts work area (`P/plan.md:1148`).
- `packages/testing/fixtures/claude.ndjson:17` and line 19 report aggregate `used`/`size`. The actual `inputTokens`, `cachedReadTokens` and `cachedWriteTokens` are inside the terminal idle `state_update` at line 20.
- `packages/engine/src/runner/AcpRunner.ts:354` handles that idle frame and returns at line 363, before the call to `translate` at line 365. The terminal usage therefore does not reach the named translator.
- The per-turn structure has no usage field (`packages/engine/src/runner/AcpRunner.ts:59`). `finish` emits only identity and delivery id for `turnEnded` at line 178. The internal `RunnerEvent` schema likewise has no usage at `packages/engine/src/runner/Runner.ts:67`. The handler decodes that schema at `packages/engine/src/commands/CommandHandler.ts:133`, and `packages/engine/src/routing/deliveries.ts:92` constructs the persisted event without usage.

Suggested fix: expand 7c's engine-unit description to include collecting terminal usage before finishing, carrying it through the internal runner event, and copying it into the persisted event. Name the affected files and any changed existing tests. Classify the unit by its actual backend work. Keep absent adapter data optional, as already decided.

Make U01 or the existing `runner/stream.test.ts` addition explicitly observe the entire raw idle-frame-to-log path, with the transcript unavailable. Add a second turn without usage and a replay case to prove old usage is not reused. This finding does not demand that the supplied fixture contain a request timestamp or a lifetime split that it does not report; the existing unknown-expiry policy remains appropriate.

## C-R4-C3. The shared visibility contract equates two different existing rights rules

**MAJOR. Category: Design. Evidence status: confirmed contradiction. Responsible area: client API E8/E22 and roles hand-off/orientation contracts.**

Scenario: an orchestrator has a lead whose worker needs replacement. The lead pauses or crashes. The orchestrator becomes the worker's current holder and receives its notice, but the frozen contract gives incompatible answers about whether the orchestrator can read the worker's thread and obtain its hand-off.

Evidence:

- Current subscriptions allow the caller itself and structural direct children, regardless of whether a parent is available (`packages/engine/src/api/server.ts:155`). They do not use inherited holder rights.
- Lifecycle authorization does use the current holder (`packages/engine/src/commands/CommandHandler.ts:75`). `holderAbove` skips unavailable ancestors and can select a grandparent (`packages/engine/src/routing/holders.ts:21`). These are distinct existing rules.
- `I/client-api-contract.md:343` defines agent-scoped visibility using parent rights and calls it the existing rule. Lines 389–397 both grant parent-rights visibility and categorically exclude grandchildren. E8 says it reproduces today's filter exactly and retains the existing test expectations (`I/client-api-contract.md:732`). The current test expressly excludes grandchildren in both catch-up and live streams (`packages/engine/test/api/subscribe-visibility.test.ts:154`).
- The roles plan deliberately routes notices to that inherited holder (`P/plan.md:452`), requires parent rights for hand-offs and a successful lead thread read (`P/plan.md:896`), and also retains the categorical no-grandchildren limitation (`P/plan.md:509`). E22 exports the engine's parent-rights helper without resolving its difference from the visibility filter (`I/client-api-contract.md:961`).

Suggested fix: state separately which rule governs lifecycle commands and which governs reads. If reads retain direct-child visibility, specify how the inherited holder performs the promised hand-off when its child lead is unavailable. If reads inherit holder rights, record that as an intentional existing-behavior change and update the no-grandchildren statements and affected subscription tests. Add the failed-parent case to roster, snapshot, thread, catch-up and live visibility acceptance. Do not resolve this by silently broadening access or by changing the tests without changing the contract.

This does not reopen the ruling about piece deliveries reaching outside a caller's tree. It concerns read access and the engine's distinct existing rules.

## C-R4-C4. The stall task still imports a package removed by the engine rework

**MINOR. Category: Design. Evidence status: confirmed stale anchor. Responsible area: roles planner, WS-4.**

Scenario: the stall-rule builder follows task 4b and looks for the board's status function in `packages/board`, despite both plans now placing it inside the engine.

Evidence: `P/plan.md:783` still specifies Board v5 and the pure export from `packages/board`. Its source declaration also pins v5 (`P/plan.md:289`). The supplied Board v6 places code in `packages/contracts/src/board/` and `packages/engine/src/board/` (`I/board-contract.md:24`), and explicitly exports the status function from `packages/engine/src/board/` at line 472. The same task cites `routing/waits.ts:settled`, although CAPI E19 moves it with no re-export (`I/client-api-contract.md:924`).

Suggested fix: update the board source version and these task anchors to the supplied contracts. Keep `waits.ts` only as an explicitly historical pattern if useful. This is a surviving stale reference in the rewritten plan, not a request to implement the already recorded unbuilt board dependency.

# Risk register

The register separates product risk from build gates. Decisions remain with the owner. No finding is accepted or closed by this review.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Status and owner | Decision, deadline and closing evidence |
| --- | --- | --- | --- | --- | --- | --- |
| C-R4-C1 | Not scored. | Not scored. | Not scored. | Failing build/check gate. | Confirmed; shared engine and roles builders. | Owner decision pending. The required gate must pass before merge. No closing evidence. |
| C-R4-C2 | 6: a promised adapter-usage flow remains unavailable until code is fixed. | 3: affects the running session and is repairable by the application. | 8: reported terminal usage is a common active-use path; the missing-transcript case is expressly supported. | 144, schedule. | Confirmed; unit 11c backend builder. | Owner decision pending. Within this phase or a dated follow-up with an owner. No closing evidence. |
| C-R4-C3 | 6: a holder can be unable to complete replacement through the promised read flow. | 3: one team can recover through its owner. | 4: a parent process failure is one ordinary system fault. | 72, schedule. | Confirmed; client API and roles planners. | Owner decision pending. Within this phase or a dated follow-up with an owner. No closing evidence. |
| C-R4-C4 | 1: internal builder guidance names the wrong location. | 1: development only. | 8: the normal stall implementation follows this task. | 8, record. | Confirmed; roles planner. | Owner decision pending. Review at phase end. No closing evidence. |

Acceptance and expiry are not applicable because no risk has been accepted. These scores do not waive the need to settle the contradictory access contract before implementing it.

# Proposed post-build checks

| Id | Scenario | Expected result | Required evidence and responsible area |
| --- | --- | --- | --- |
| R4-PC01 | Build after registering roles and capacity events and `release`. | Every lifecycle cell is defined; old engine visibility expectations remain covered; owner-only roles tags are tested as hidden from agents; CLI dispatch includes `release`. | Workspace typecheck and full test output, including state-machine, visibility, contracts and CLI parity tests. Shared engine and roles builders. |
| R4-PC02 | Feed the cited Claude terminal frame through the real ACP runner and command handler with transcript access unavailable. Then send a turn without usage and replay a session. | The first persisted `TurnEnded` contains only reported usage; later turns do not inherit it; replay does not create a new usage observation. | Raw fixture-shaped input, runner events, persisted events and rebuild equality. Unit 11c. |
| R4-PC03 | Pause or crash a lead between an orchestrator and a worker; query and subscribe as the orchestrator before and after the change. | Roster, snapshot, thread and catch-up/live access all implement the explicitly chosen visibility policy; the inherited holder can complete the documented replacement procedure. | Socket-level allow/refuse assertions and a completed hand-off/replacement trace. Client API and roles builders. |
| R4-PC04 | Inject a capacity error before acceptance, after acceptance, and after a board wake is replaced; repeat over service restart and account return. | Whole-queue hold persists; no duplicate accepted prompt; held reload stays idle; every owner/holder/service release counts; the configured retry bound is respected. | Real runner-to-log-to-dispatch trace and replay comparison, rather than a classifier-only test. Unit 11b and stall watch builders. |
| R4-PC05 | Exercise the conditional recording gate and timer acceptance service. | Without a qualifying harness, units 3, 4 and 11a and the standing-rule acceptance step are absent; other roles work still completes. In-process clock tests agree with the real-child stall check. | Recording matrix, launch selection, discovered test files, composed socket test and the already proposed real-minute child-process result. Roles lead and acceptance builder. |

These checks supplement the eight checks already present at `P/plan.md:1025`. They do not claim implementation behavior has already been demonstrated.

# Noted, not filed

## Earlier answers and owner scope

The round 1 and round 2 finding maps were checked against the current workstreams. Their substantive answers remain in v5: hold/release replaces the invalid pause/resume design; accepted deliveries receive carry-on rather than resend; switches preserve log schemas; role-file and hand-off data stay bounded and redacted; overflow is retrieved through the lead; stall episodes and deadlocks are defined; owner alerts and board-off suspension are explicit; turn timing uses `DeliverySent`; and acceptance runs the composed service on its test clock. The new visibility finding concerns inherited ancestors, not the answered sibling-overflow finding.

All 27 round 3 answers remain represented at plan level:

| Finding ids | Current answer checked |
| --- | --- |
| TO-R3-2; C-R3-C3 | Conditional recorder-first build under L27, recorder preparation and unit 3p: `P/plan.md:516`, `:642`, `:921`, `:1137`, `:1153`. This supersedes the formerly unanswered owner question. |
| TO-R3-1; TO-R3-3; TO-R3-4; TO-R3-5; Lo-R3-L9; TS-R3-TM-1 | Adapter-owned shell/sandbox evidence, case-insensitive protected names, refused-mode guard and resolved paths: WS-2's checks at `P/plan.md:531` onward and criterion 7.2 at `:966`. |
| A-R3-A1 | Notice post correlation and read-state fold, including restart: `P/plan.md:460`, `:680`. |
| C-R3-C1; A-R3-A2; Lo-R3-L8; Ls-R3-L3; TS-R3-TM-2 | Whole encoded rule limit and ordered aggregate snapshot cap: `P/plan.md:398`, `:405`. |
| Lo-R3-L1; Lo-R3-L4; Lo-R3-L5; Lo-R3-L7 | Transitive waits with cycle termination, resettable usage pauses as busy, blocking-wait exclusion, and restricted progress reset: `P/plan.md:717` through `:762`, criteria 4.2–4.7. |
| Lo-R3-L2; Lo-R3-L3; Ls-R3-L1 | Whole-agent hold, engine-owned outage count, held reload/account return and release when disabled: `P/plan.md:683`, `:967`. |
| Ls-R3-L2; Lo-R3-L6; TS-R3-TM-3 | Explicit `roles.StallEnded`, mixed-wake handling and stall watch compaction attribution: `P/plan.md:684`. |
| C-R3-C2; C-R3-C4; C-R3-C5 | Tests now live in existing workspace packages (`P/plan.md:314`); board-off recipient exception (`:679`); crash retry limited to 0 or 1 (`:773` and WS-3 settings). |

This verifies that the earlier decisions survived the rewrite. It is not implementation clearance. C-R4-C1 concerns additional exhaustive consumers exposed by the direct engine integration, not a return of the answered new-package discovery problem.

The scope trace and decision rows retain the owner's source universe and the lead's explicit rulings. I found no new unmarked scope widening to file. Direct engine edits are authorized; the absence of the old extension seam is not a defect. The snapshot, hand-off, settings and role-file maxima are contractual limits with aggregate handling, rather than promises that all independent maxima fit simultaneously.

## Gate assessment and accepted limits

Gates 1 and 2 need the visibility decision and usage acceptance clarification above. Gate 6 needs the affected-package checks in C-R4-C1. Gate 8 has the stale anchors in C-R4-C4. The traceability universe, per-workstream risks and repository guardrail table are present. There is no new screen requiring a design mock. This report supplies the current adversarial pass; it does not close its findings. Scope provisioning and per-vendor launch allowances remain explicit pre-launch dependencies under the known gaps, rather than new findings.

I did not re-file the recorded lack of a currently qualifying standing-rule harness, the symbolic-link race after resolution, the same-user executable-content risk, transcript availability uncertainty, the external Foundry skill rewrite, or the no-downgrade policy. The owner/lead rulings govern those limits.

Effect 4 test-clock claims were checked through context7 against the official [Effect 4.0.4 vitest README](https://github.com/Effect-TS/effect/blob/effect%404.0.4/packages/vitest/README.md) on 2026-11-03. The cache policy's request-start lifetime and refresh-on-read premise was checked against the official [Anthropic prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) on the same date. Neither check proves an adapter emits the optional data.

## Review log

Some broad file reads exceeded the tool's output budget. Relevant sections were reread in bounded ranges before citations were used. A guessed `commands/permissions.ts` read found no file; `rg` located the actual `routing/permissions.ts`, and no finding relies on the guessed path. Large fixture content was inspected by parsing only the cited frames. There were no policy refusals.

No repository file was edited, no commit or push was made, and no message was sent to the launcher or another agent. The assigned scratch directory was never created and is absent. This report is the only file written.
