revise
Grade: 7  B/M/m: 0/2/0  Flags: none

## Review scope and evidence

This is the round 5 architect review of the roles plan v14 against the client application programming interface (API) contract v12 and the board contract v10. The findings are fixable within the existing workstreams. Neither requires reopening an owner ruling.

Code citations below refer to the recorded checkout at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`, unless explicitly marked as the newer checkout at `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`. Document citations use `plan.md` and `decisions.md` beside this attack directory, and `inputs/client-api-contract.md` and `inputs/board-contract.md` under this review run. This is a source and contract review. It does not claim that the proposed implementation or its tests have run.

## Findings

### R5-A1. The hand-off selects a prompt event that the engine does not write.

Severity: **MAJOR**. Category: **Design**. Evidence status: **Confirmed**. Responsible builder: the roles hand-off builder, unit 10.

**Scenario and consequence.** A lead starts a worker with a short original brief, lets it produce responses, and requests `roles.handoff` for a replacement. Task 6a selects `PromptSent` and `ThreadItem`, but the ordinary start path writes neither of those for the original brief. The hand-off therefore loses the original task even when it fits comfortably within the promised first-prompt budget. A later prompt also has no `PromptSent` producer. Selecting response items cannot reconstruct the missing user side of the exchange. This breaks the promised replacement flow and criteria 6.1 and 6.2.

**Evidence.** `plan.md:1037` reserves the first section for the first prompt. `plan.md:1040` reserves the next section for the last exchange. `plan.md:1069` promises the first prompt whole when it fits. `plan.md:1079` explicitly selects over `PromptSent` and `ThreadItem`.

At the recorded commit, `packages/engine/src/commands/start.ts:37` constructs `AgentStarted`, with the brief in `firstPromptDelivery.content.text` at `start.ts:43`, and returns that event at `start.ts:52`. `packages/engine/src/commands/prompt.ts:7` constructs a `DeliveryQueued` carrying the subsequent prompt. `packages/contracts/src/events.ts:112` declares `PromptSent`, but a search of `packages/engine/src` finds no producer. Live user chunks do not fill the gap: `packages/engine/src/runner/translate.ts:18` translates `user_message_chunk` only during replay, and `packages/engine/src/routing/deliveries.ts:111` does not persist replay updates as live thread items.

The shared edits do not supply the absent writer. Client API edit E15 widens event callers; it does not add a `PromptSent` emission. Edit E21 (`inputs/client-api-contract.md:2087`) returns actual persisted events and expressly preserves the agent visibility restriction on `DeliveryQueued` at line 2097. Paging alone does not transform the stored events into the selector's assumed input.

**Suggested fix.** Define the hand-off against the actual event producers. Read a start-time brief from `AgentStarted.firstPromptDelivery`, and specify which real prompt-delivery events supply the user side of later exchanges, including their delivery correlation and visibility. Preserve the existing read and management boundaries. If the chosen solution instead adds a `PromptSent` writer, name its engine changes, tests and old-log fallback. The simpler original-brief fix needs no new engine event or history backfill. Build the hand-off tests through public `start` and `prompt` calls and actual runner updates, rather than creating synthetic `PromptSent` fixtures.

**Earlier answers and drift.** The previous hand-off answers about budgets, cut markers, inherited management rights and sibling isolation remain valid. This is a separate producer/consumer mismatch, not a reopening of those answers or issue 164's accepted visibility gap. At the newer commit, `packages/engine/src/commands/start.ts:45` still stores the first prompt inside `AgentStarted`, and `commands/prompt.ts:7` is unchanged. The defect exists at both commits; it was not introduced by engine drift.

### R5-A2. A restart after crash resume can discard the unfinished carry-on step.

Severity: **MAJOR**. Categories: **Design**, **Bug (failures)**. Evidence status: **Confirmed missing repair policy**. Responsible builders: the sheepdog base and crash-rule builders, units 5 and 6.

**Scenario and consequence.** The sheepdog already has a baseline and is on. A worker crashes after accepting its work. Its queue contains nothing pending. The sheepdog handles that crash, successfully resumes the session, and observes `SessionOpened`. The service then dies before the separate carry-on `prompt` and `CrashRetried` record. On restart, the sheepdog replays the original crash because no action record advanced its position. However, the worker has already resumed, so the instruction to check that the crash is still current now rejects the trigger. No rule is specified to finish this sheepdog's own partially completed retry. The worker remains idle without the promised carry-on, and the holder never receives the retry's promised notice. Manual intervention is required.

**Evidence.** `plan.md:561` derives position only from action records and baselines. `plan.md:567` and `plan.md:600` rely on repeatable request identifiers for restart safety. Criterion 4.6 (`plan.md:939`) orders the work as current-crash check, `resume`, `SessionOpened`, optional carry-on `prompt`, then `CrashRetried`. No durable pending retry or rule for continuing past a successful own resume is specified. Criterion 3.2 (`plan.md:819`) and post-build check 5 (`plan.md:1278`) require fault injection between commands and their records, but do not decide this repair policy.

The recorded engine makes the gap reachable. `packages/engine/src/commands/resume.ts:48` sets `midTurn` only for an interrupted agent whose previous state was working, not for a crashed agent. `packages/engine/src/recovery/reload.ts:81` considers sent deliveries for replay acceptance, and line 87 queues a carry-on only when replay found such a delivery or `midTurn` is true. With already accepted work and no pending delivery, neither applies. `packages/contracts/src/stateMachine.ts:82` makes `SessionOpened` move starting to idle. On a service restart, `packages/engine/src/recovery/restart.ts:123` records that idle state as the interruption's previous state. Reloading it does not recover the lost working state. Request deduplication alone supplies no missing continuation: `packages/engine/src/commands/CommandHandler.ts:254` returns a stored receipt with no `afterCommit`, while the initial command's receipt is committed before its setup continuation at line 269.

**Suggested fix.** Decide how an incomplete retry is recognized durably before building it. For example, record a pending crash-retry phase keyed by the crash sequence before `resume`, and make replay finish the carry-on and notice after its own successful resume. Explicitly distinguish that continuation from an unrelated later resume, stop or replacement. Name any added roles event, its fold, the `roles.record` allowance and the recovery tests. Retain stable identifiers for each command. An alternative is an explicitly planned engine operation that commits the required continuation with the successful reload. A generic orchestration layer is unnecessary.

**Why an earlier answer is insufficient.** Round 1 architect A3, critic C2 and logic Sol L2 were answered by decision 42's carry-on after resume. That fixes the uninterrupted path, but the answer fails at the partial-success boundary above. This finding preserves the owner's one-retry policy. It does not reopen known gap 15, which accepts a holder racing the sheepdog to create a replacement. The scenario needs no competing holder action. `commands/resume.ts` is unchanged between the recorded and newer commits. The newer `recovery/reload.ts:88` retains the same carry-on condition. This is not a drift finding.

## Risk register

The severity, fallout and probability scores follow the required risk rubric. Owner decisions remain unset.

| Finding | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence and builder | Owner decision, deadline and closure |
|---|---|---|---|---|---|---|
| R5-A1. The hand-off omits the original brief. | 6. A core feature remains wrong until repaired by hand. | 3. One team's owner or lead can supply the missing brief. | 10. The specified selector misses the brief on every normal public start-with-prompt path. | 180. Fix before release. | Confirmed. The unit 10 hand-off builder owns the fix. | Unset. The deadline is before the next release to real users. Acceptance and closing evidence are absent. |
| R5-A2. A partially successful crash retry loses its continuation. | 6. Automatic work recovery remains broken until someone prompts or replaces the worker. | 3. The owner or lead can repair the work. | 2. A worker crash and a service failure in the continuation window must coincide. | 36. Record for phase-end review. | Confirmed policy gap. The unit 5 and unit 6 builders own the fix. | Unset. Review at the end of the phase for fixing, batching or acceptance. Acceptance and closing evidence are absent. |

## Proposed post-build checks

These checks verify implementation after the two decisions above are repaired. They do not substitute for those decisions.

| Identifier and responsible area | Scenario | Expected result and required evidence |
|---|---|---|
| ARCH-PB1. The hand-off builder owns this check. | Start a worker with a distinctive brief through the public command, send another prompt, produce responses, and page across those events. Repeat with old logs, large text and multibyte cuts. | The hand-off contains the real original brief and the defined last exchange within both budgets. Show persisted source events, request identity, page boundaries, cut sequences and the encoded reply. Repeat allowed and refused callers without widening sibling reads. |
| ARCH-PB2. The sheepdog builders own this check. | Kill after resume's receipt, after successful `SessionOpened`, after the carry-on prompt, and before or after the notice record. Repeat with an intervening owner stop or resume. | The chosen repair policy finishes one eligible retry and notice, never resumes unrelated work, and never resends accepted original input. Show command receipts, pending-phase evidence, rebuilt views and deliveries across a fresh service process. |
| ARCH-PB3. The permission-path builder owns this check. | A matched request arrives while an agent holder is waiting. Repeat with an owner-held asker, catch-up split between the two writes, a hanging resolver and an unmatched request. | One committed projected batch gives no transient held result, holder delivery or approval alert for the matched case. Unmatched W19 behavior remains unchanged. Other agents' runner events progress during the resolver timeout. Show actual envelopes, publication boundaries, wait results and runner calls. |
| ARCH-PB4. The engine capacity and board builders own this check. | Withdraw and replace a board wake during a hold and across restart. Then withdraw the last queued item, including by stopping its asker, and release the empty hold. | The dispatcher sends nothing during the hold. An empty hold remains unsettled until release. The engine, rebuilt views, client fold and owner helper agree at complete batch boundaries. Include the board criterion 6.7 acceptance cases and the hidden agent snapshot field. |
| ARCH-PB5. The runner and cache builders own this check. | Run a raw capacity error through the real adapter and handler; run a multi-request turn with terminal usage, followed by a turn without usage and by session replay. | Capacity reaches the capacity outcome rather than a pause. Usage comes from the last request or the adapter's current context field, never a turn aggregate or stale prior turn. Show raw frame provenance, internal decoded events and persisted `TurnEnded`. |
| ARCH-PB6. The integration builder owns this check. | Compose the production service with the test clock and real socket; repeat a stall episode through the normal child-process service. Exercise every permitted and refused service command through the actual entry point. | Clock control reaches the service rules. Imports cannot bypass command boundaries. Piece `board.post` calls work in-process and the exact command/tool lists compile and pass. Show discovered test files and production composition evidence. |

## Noted, not filed

### Every round 4 answer remains represented.

I checked all 32 mapped round 4 findings, including the shared folds and the later contract changes. None of the following answers is refiled.

| Round 4 finding identifiers | Answer checked in the frozen documents |
|---|---|
| A-R4-A1. | Planner replies carry post identifiers, reads are separate, and the sheepdog retains the returned post identifier (`plan.md:357`, `plan.md:550`; client API E3 and E4). |
| A-R4-A2, C-R4-C3 and TS-R4-TM-2. | Read visibility and management rights are separate. `orient` uses the read rule, while the hand-off checks management on every call (`plan.md:367`, `plan.md:1073`; client API E8 and E22). |
| C-R4-C1, TS-R4-TM-4 and the lifecycle part of A-R4-A3. | Piece events keep every state, while the two new engine events have explicit cells (`plan.md:1156`; `inputs/client-api-contract.md:1640`). |
| TS-R4-TM-1. | Caller rule and device survive append, catch-up, rebuild and paged reads through one durable decoder (`inputs/client-api-contract.md:1817`). The first-use reactor reads durable `answeredBy`. |
| Ls-R4-L2, Lo-R4-L3 and TO F5. | A matched permission request has one projected committed batch, no routing events and one wait check. The owner helper gates its decision on a complete batch (`plan.md:1110`, `plan.md:1209`). |
| Ls-R4-L1 and Lo-R4-L6. | An unknown-reset pause counts as waiting on the owner, and clocks restart from zero when the account becomes usable (`plan.md:934`, `plan.md:936`). |
| Lo-R4-L1. | A lead's nonblocking wait and own open post no longer suppress cache keeping. Its own pending delivery or blocking request still does (`plan.md:987`). |
| Lo-R4-L2. | Settings-folder worktrees fail closed, with tests and an external-worktree recipe. Known gap 22 accepts the limitation (`plan.md:764`, `plan.md:1244`). |
| C-R4-C2, Lo-R4-L9 and the usage part of A-R4-A3. | The idle frame feeds per-turn runner state, an internal event, the handler decoder and the persisted event. The context basis is the reported context or last request, not the turn sum (`plan.md:1193`, `plan.md:1212`). |
| TS-R4-TM-3, Lo-R4-L8 and the capacity part of A-R4-A3. | Capacity has its own classifier result, runner outcome and handler path, with versioned recorded or documented evidence and updated classifier fixtures (`plan.md:1135`, `plan.md:1176`). |
| Lo-R4-L4 and Lo-R4-L7. | A failed hold condition means no hold. Outage endings and the capacity-return give-up trigger are explicit (`plan.md:1148`, `plan.md:1161`, `plan.md:1210`). |
| Lo-R4-L5. | Sheepdog turns do not make an agent busy for waiting dependencies, and the author-blocked exception keeps an owed answer moving (`plan.md:935`, `plan.md:936`). |
| Ls-R4-L3. | A wake containing a completion is ordinary work, even with sheepdog notices (`plan.md:828`). |
| TO F1 and TO F4. | Every candidate word and location is resolved under lexical gating and a bounded off-event-loop operation. The answer runs after commit on its own fiber (`plan.md:1122`, `plan.md:1209`). |
| TO F2, TO F3 and TO F6. | Each service has its own command list and an import boundary. `release` uses the engine's holder-rights helper and has unrelated-caller refusal tests (`plan.md:821`, `plan.md:1211`). |
| A-R4-A4, C-R4-C4, Ls-R4-L4 and TS-R4-TM-5. | The stall task now names `packages/engine/src/board/` and the shared contracts' settled function, rather than the removed package (`plan.md:949`). |

The earlier rounds' answers remain present: the restricted parser and prefix opt-in, recorded shell and sandbox qualification, fail-closed settings protection, bounded snapshots and paging, lead-mediated hand-off recovery, worker-only default age limit, request-start cache timing, whole-queue capacity holds, accepted-input protection, board-off escalation, dependency-cycle handling, durable timer reconstruction and registered test projects. R5-A2 identifies the precise incomplete branch of decision 42. It does not claim that all earlier crash handling was omitted.

### The named engine edit inventories are substantially complete.

For permission handling, the current writer immediately routes the request (`packages/engine/src/routing/permissions.ts:11`), while the runner transaction currently runs wait checks for each write (`packages/engine/src/commands/CommandHandler.ts:138`). The plan explicitly replaces that behavior for matched requests and preserves unmatched expectations. Its combined publication assumption matches `packages/engine/src/log/EventLog.ts:261`. The ceiling's settings protection and path resolver exist at `packages/engine/src/identity/ceiling.ts:317` and line 341. The plan names the permission, boundary, runner-hold, acceptance and W19 tests; client API E29 owns the shared permission-text and raw-input fixture changes.

For capacity, today's classifier has two pause classes (`packages/engine/src/runner/classify.ts:1`), the runner maps classification through its finish path (`packages/engine/src/runner/AcpRunner.ts:162`), and the internal outcome type is closed (`packages/engine/src/runner/Runner.ts:85`). The plan now names each writer and decoder, recovery readers, lifecycle cells, exhaustive event samples, fake runner, command pin and command-line parity map. The existing delivery and recovery tests retain their expectations for non-capacity cases, with new held cases assigned explicitly (`plan.md:1176`). I found no additional changed expectation to file.

For usage, the runner's idle branch returns before translation (`packages/engine/src/runner/AcpRunner.ts:354`), and the persisted turn-end writer currently omits usage (`packages/engine/src/routing/deliveries.ts:92`). The revised inventory follows the actual path through runner state and `RunnerEvent`, the handler decode, and the persisted writer (`plan.md:1193`). Adapter provenance remains a post-build check, rather than a claim that the provider documentation proves a particular adapter frame.

### The shared contracts agree on the other reviewed joins.

The roles now correlate `board.WakeBuilt` through its source identifier and the engine's `DeliveryQueued` before using `DeliveryAccepted` to mark a notice read (`plan.md:550`; `inputs/board-contract.md:326`). A service need not call the agent-only board read to do this. `board.status` supplies coherent condition lists, remains readable while disabled, and causes the board-dependent clocks to suspend as planned (`plan.md:823`, `plan.md:949`).

The open capacity hold is engine-owned settled state, including when its queue empties. Unit 11b owns the shared input, client fold and owner-visible `capacityHeld` field, depends on client API units 1b and 3, and shares the held board acceptance cases with whichever builder runs second (`plan.md:1166`, `plan.md:1210`, `plan.md:1390`; `inputs/client-api-contract.md:2043`; `inputs/board-contract.md:405`). No duplicate roles hold-unsettled entry is required.

The roles reducer reads only event and sequence. The service reconstructs clock times through `client.event` envelopes (`plan.md:583`), matching contract v12. Permission fields are owned by client API E29 even if standing rules are deferred. Stopped request askers cease to block the holder, and stopping an asker can empty a held queue (`plan.md:936`, `plan.md:1210`). Piece guards and the matcher/hold exceptions retain their distinct failure policies. Optional usage supports old-log rebuilds; shared migrations belong to the client API units. The rollout has switches for disabling behavior and does not promise compatibility with an older binary after the shared schema changes.

### The newer engine checkout does not invalidate a named edit.

I compared the named existing paths against `9e386b0`, including the runner, command handler, permission routing, ceiling, delivery/recovery paths, event log, contracts, test inventories and live-check entry points. The newer start path adds bounded, preemptible setup, but retains the same first-prompt event shape (`review-engine-now/packages/engine/src/commands/start.ts:39`). Reload exports its bounded setup helper, but retains the same recovery selection (`review-engine-now/packages/engine/src/recovery/reload.ts:79`). The runner's terminal-output and credential-redaction additions do not remove the permission, finish or idle branches named by the plan. Their changed line positions are not findings. I found no verified changed-since defect. Both filed findings also exist at the recorded commit.

### Library and service documentation supports the reviewed assumptions within its limits.

Official documentation was checked on 2026-11-03 after Context7 returned a monthly quota error. The pinned [Effect 4.0.5 Vitest documentation](https://raw.githubusercontent.com/Effect-TS/effect/effect@4.0.5/packages/vitest/README.md) documents scoped `it.effect` tests with `TestClock` and adjustment of simulated time. This supports the in-process test approach, subject to ARCH-PB6 proving production composition.

The [Anthropic prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) says cache lifetime is measured from request start and refreshed on use, and documents five-minute and one-hour cache writes. The [Anthropic error documentation](https://platform.claude.com/docs/en/api/errors) identifies `529 overloaded_error`. These support the plan's timing and classification sources, but do not prove that any installed adapter exposes the necessary last-request fields or preserves that error. The plan correctly requires recorded evidence or leaves the harness unsupported for the relevant behavior. An attempted fetch of the pinned RPC group source was unavailable; exact new group composition remains a build/type-check verification, not an independently verified signature claim here.

### Accepted limits are not new findings.

I did not refile the same-user database and credential boundary, the open-web computer-only guard limitation, absent qualifying standing-rule harnesses, Claude folder/discriminator limitations, Codex approved-command sandbox limitations, missing usage fallback, the symbolic-link swap window, settings-folder worktrees, the engine crash-notice race, alert-view ordering, unbuilt shared contracts, external Foundry-skill rollout or allowance estimates. These are explicitly accepted or gated in the owner rulings and known gaps. Neither finding depends on weakening those decisions.

## Review execution record

I read the repository guidance, engine design's overriding final section, engine plan and decisions, open issues, the task and team rules, the frozen roles documents, earlier finding maps, known gaps, rulings and both frozen contracts. I used Node.js 26 through `nvm use`, inspected recorded source and existing test expectations, and compared the named paths with the newer checkout. The repository remained unchanged. No runtime suite was run for this document review.

Some combined reads exceeded the output limit; the relevant sections were reread in smaller slices. An initial search used a nonexistent start-test filename; the actual acceptance flow and source paths were inspected instead. Installed dependency sources were unavailable, and Context7 was quota-limited, so library checks used official dated documentation. The pinned RPC source fetch remained unavailable and is scoped explicitly above. No cyber-policy refusal occurred. No scratch files were created. This result is the only file written.
