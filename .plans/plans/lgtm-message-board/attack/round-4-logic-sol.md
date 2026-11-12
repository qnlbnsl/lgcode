revise
Grade: 6  B/M/m: 0/5/3  Flags: none

## Review basis

This reviews plan version 5 and board contract version 6 through the logic and failure-policy lens. The repository was checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. Source paths below are relative to that repository. Paths beginning `../` are relative to this report.

The owner authorizes direct engine edits. L26 and L28 bind this review. There is no finding against changing existing engine behavior, moving the board into the existing packages, or replacing the former seam. The findings concern decisions and integration work missing from the proposed changes. They are not results from running an implemented board.

## Findings

### R4-L1. The owner's wait can remain held after its last completion is accepted

Severity: **MAJOR**. Category: **Design; Bug (timing and failures)**. Evidence status: **Confirmed missing refresh transition**. Responsible builder: board unit 4 and the client wait-helper builder, coordinated by the lead.

Scenario: Agent A has one owed completion and no other board obligation. The owner's helper reads A's status after the completion wake is built. Its board hold is true. The engine then accepts that wake and A ends its turn. Acceptance discharges the completion, and A is now settled. Neither acceptance nor turn end is a board event. No further board event is required when all obligations have cleared. The helper's prescribed refresh rule therefore retains the true board hold indefinitely, although an engine wait can finish.

Evidence: The helper reads condition results from the snapshot and re-reads status only “after each board event” (`../contract.md:366`, `../contract.md:370`; decision row 89 at `../decisions.md:99`). Acceptance discharges completions (`../plan.md:371`) and the board fold explicitly processes the engine's `DeliveryAccepted` (`../plan.md:457`). A nonfailed owed completion holds its author unsettled (`../contract.md:354`). In the existing engine, acceptance is written as an engine event (`packages/engine/src/routing/deliveries.ts:104`), and turn end is also an engine event (`packages/engine/src/routing/deliveries.ts:92`). The shared contract promises that the helper and engine use the same settled result (`../../inputs/client-api-contract.md:419`).

There is also an ordering gap: rejecting a summary older than the last summary seen does not require the current summary to cover the stream event being evaluated. A helper can still evaluate an idle transition using a condition result from before a newly received board obligation. The plan does not specify a barrier between the refresh and the settled decision.

Why the round 3 answer is incomplete: Row 89 fixes unbounded fallback replies and makes both condition results available. Those improvements hold. Its event-trigger and sequence rules do not maintain those results across engine events that change them. This reopens the freshness part of group 3, rather than its response-size finding.

Suggested fix: Define all events that invalidate a board condition summary, including delivery acceptance, return and withdrawal and relevant lifecycle events. Before deciding settled, require a condition result covering the relevant processed sequence, with a specified way to reconcile a later summary with the engine state used in the same decision. An event-driven refresh is sufficient; no timer or polling loop is needed. Add an owner-versus-agent wait comparison where the final events are acceptance and turn end, with no subsequent board event.

### R4-L2. The pure board condition cannot observe whether a wake is still queued

Severity: **MAJOR**. Category: **Design; Bug (timing)**. Evidence status: **Confirmed input-contract contradiction**. Responsible builder: board units 1, 2a and 3b, with the E19 builder for the shared input type.

Scenario: T is idle, has an unanswered incoming question, and has never accepted a wake carrying it. A queued wake carries that question and an optional digest post. The digest post loses reach, so the dispatcher withdraws the wake before sending. Until the reactor rebuilds it, T has no queued or sent wake. The third hold clause must now become true to prevent a wait from reporting T settled. However, the board view is unchanged by that withdrawal, and the condition is specified as a function of that board view alone.

Evidence: The third clause requires both acceptance history and absence of a queued or sent carrying wake (`../contract.md:355`, `../plan.md:625`). Both conditions are expressly pure functions of the board's full view (`../contract.md:366`; criterion 1.7 at `../plan.md:404`). That view keeps the wake index but expressly does not store delivery status; it reads status from the separate engine deliveries view (`../plan.md:432`, `../plan.md:444`). Criterion 2.1 folds acceptance and return but ignores `DeliveryWithdrawn`, `DeliverySent` and `DeliveryRequeued` (`../plan.md:457`). Thus two engine snapshots can have identical board views and require different answers from the proposed function.

The existing engine stores withdrawal in its deliveries view (`packages/engine/src/views/apply.ts:290`). Its base settled predicate stops holding an idle target as soon as no delivery is queued or sent (`packages/engine/src/routing/waits.ts:39`). Wait checks run on the projected batch (`packages/engine/src/routing/waits.ts:110`), before a later board-reactor transaction can repair the gap.

Why the earlier answer fails at this boundary: Row 90 correctly narrows the rule to never-accepted questions. It does not supply the current delivery state needed to evaluate that narrower rule. L28 settles the module's location, not this missing input. This is separate from R4-L1: the engine itself cannot obtain the required result through the stated function signature even with perfect client refresh.

Suggested fix: Define a contracts-owned input containing the board data and the necessary delivery facts, or pass the engine deliveries projection as a separate pure input. Keep delivery status in one authoritative view. Specify the adapter from engine state and the adapter from client summaries, so E19's small shared input and the board's full-view function agree. Add a test with identical board views before and after a send-time withdrawal, requiring different hold results.

### R4-L3. Returned board deliveries still have an owner-or-agent-only sender schema

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence status: **Confirmed omission in the relied-on engine edits**. Responsible builder: client API unit 1b, with board unit 3a verifying B5.

Scenario: A board wake is sent as the piece `board`, and its adapter returns an ordinary error before acceptance. B5 requires a durable `DeliveryReturned` so the board can retry once and then resolve an undeliverable addressee. The retained return event cannot represent that sender under the specified schema changes.

Evidence: E15 widens `Delivery.sender` and `PromptSent.sender` from `Actor` to `Sender`, naming those two fields (`../../inputs/client-api-contract.md:833`). E16 changes source handling, but does not widen the return event (`../../inputs/client-api-contract.md:862`). B5 expressly keeps `DeliveryReturned` on a board return (`../plan.md:328`; task 3a.3 at `../plan.md:558`).

At the recorded commit, `DeliveryReturned.sender` is independently declared as `Actor` (`packages/contracts/src/events.ts:162`), whose variants are only owner and agent (`packages/contracts/src/events.ts:8`). The return builder copies the original delivery's sender into this field (`packages/engine/src/routing/deliveries.ts:45`). Failure handling uses that return (`packages/engine/src/routing/deliveries.ts:130`). The log decodes the full event envelope inside the append transaction (`packages/engine/src/log/EventLog.ts:182`). Widening only the two named fields leaves a type incompatibility and an invalid returned-event payload; retry accounting cannot be recorded by the stated path.

This is not the previously answered “what happens after acceptance” question. Row 91 supplies that policy. The missing change is the existing return-event schema needed to record either return case.

Suggested fix: Add `DeliveryReturned.sender: Sender` to E15 and the board's dependency inventory, preserving decoding of existing owner and agent returns. Name `packages/contracts/test/events-roundtrip.test.ts` for piece and service return cases and `packages/engine/test/routing/deliveries.test.ts` for the real append path. Verify the first and second unaccepted board returns and an accepted-then-returned wake through the engine, not solely by folding hand-built events.

### R4-L4. Adding planners does not provide the board's transactional command replies

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence status: **Confirmed missing engine integration path**. Responsible builder: client API unit 1a and board unit 3a.

Scenario: `board.open` writes `board.ChannelOpened` and must return its channel id. `board.post` must return its post id. `board.read` is deliberately a transactional planner because it writes read acknowledgements, but must return a page of post text. The proposed planner-table change gives these commands a dispatch entry, without specifying how their replies and replayable receipts are constructed.

Evidence: The board deliberately puts all six commands other than `board.channels` and `board.status` into the planner table (`../plan.md:328`, `../decisions.md:110`, row 100). Task 3a.1 specifies planners returning events (`../plan.md:556`). The public reply requirements are the command table at `../contract.md:435` and `../contract.md:437`, plus the page contract at `../contract.md:376`. E3 replaces `supported` and `planCommand` with a planner table; E4 moves nontransactional reads (`../../inputs/client-api-contract.md:665`, `../../inputs/client-api-contract.md:679`). Neither specifies reply projection or a richer planner result.

At the recorded commit, `Plan` carries events, side rows and an after-commit effect, with no transactional reply field (`packages/engine/src/commands/internal.ts:41`). The handler's separate `replyFor` recognizes only engine event kinds and engine command names (`packages/engine/src/commands/CommandHandler.ts:97`). It produces no channel id, post id or read page. The handler uses that function to write the receipt and subsequently decodes the stored reply against the command schema (`packages/engine/src/commands/CommandHandler.ts:269`, `packages/engine/src/commands/CommandHandler.ts:250`). This consumer is absent from B1–B9 and E3/E4/E22. A planner entry alone does not make the promised replies possible.

Suggested fix: Assign an explicit engine edit for transactional reply construction, either by directly extending `replyFor` or by defining a typed reply projector in the planner contract. Define how a read page is returned while its receipt retains only the read-acknowledgement events, as criterion 5.11 requires. Name `packages/engine/test/commands/handler.test.ts` and `packages/engine/test/log/receipts.test.ts` for the changed path. Verify board ids and read pages through actual RPC calls, including retries and secret removal. Do not use an after-commit effect as a substitute for deciding the transactional receipt semantics.

### R4-L5. The engine-change inventory omits the exhaustive lifecycle event table

Severity: **MINOR**. Category: **Design (build integration)**. Evidence status: **Confirmed inventory omission**. Responsible builder: board unit 1 and the shared E5 builder.

B2 adds eight tags to the engine's `Event` union but names only `events.ts`, board event definitions and visibility (`../plan.md:325`). E5 likewise names the union and asserts that engine views ignore piece events (`../../inputs/client-api-contract.md:693`). The existing lifecycle table is separately exhaustive over `Event["_tag"]` (`packages/contracts/src/stateMachine.ts:79`), and `eventEffect` indexes it without a fallback (`packages/contracts/src/stateMachine.ts:122`). The listed edits therefore require an additional source change before the contracts package can typecheck.

Suggested fix: Name this table in E5/B2 and decide the lifecycle effect of every board tag, normally “keep.” The existing `packages/contracts/test/state-machine.test.ts:285` enumerates the actual union, and its checks at line 333 already exercise every new event against every lifecycle state. Name that test as coverage; it need not have its expectations weakened or necessarily have its source edited. This is a pre-build inventory gap, not a claim that a current build was run and failed.

### R4-L6. Dropping a stopped agent's completion debt has no permitted fold transition

Severity: **MINOR**. Category: **Design; Bug (failures)**. Evidence status: **Confirmed contradiction**. Responsible builder: board units 2a and 3b.

Scenario: A has an already closed post with an owed completion. A stops before receiving it. The plan says the stop drops the debt, but criterion 2.1 requires the board fold to ignore `AgentStopped`. The listed board events have no completion-drop event. Closing A's still-open posts cannot remove this already-closed post's debt. Mutating it only in the reactor would not survive rebuilding.

Evidence: The stop-drop rule is explicit at `../plan.md:378`, `../plan.md:593` and `../contract.md:247`. The fold's exhaustive permitted inputs and “ignores every other event” are at `../plan.md:457`; the eight board tags are listed at `../contract.md:449`. The existing engine retains an agent's record when processing a stop (`packages/engine/src/views/apply.ts:205`), and permits resuming a stopped agent (`packages/contracts/src/stateMachine.ts:58`), so it is not sufficient to hide stale debt while the agent is stopped.

Why the round 3 answer is incomplete: Row 95 fixes the intended policy for logic m6. The view contract still cannot implement that policy durably. The limited consequence is retained stale completion metadata and possible delivery after a later resume, rather than loss of the stored answer.

Suggested fix: Make the board fold process `AgentStopped` for completion removal, or choose an explicit durable event for the removal and include it in the schemas. Preserve crash debt. Add stop-versus-crash and stop-then-resume cases to `packages/engine/test/board/view.test.ts` and the rebuild comparison.

### R4-L7. A completion can be packed again while its first wake is sent but unaccepted

Severity: **MINOR**. Category: **Design; Bug (timing)**. Evidence status: **Confirmed missing selection rule**. Responsible builder: board units 3a and 3b.

Scenario: Completion C is owed to A and is carried by sent wake D1. Before D1 is accepted, a new question for A builds D2. C is still owed, so the completion-first packing rule includes C in D2 too. D1 is subsequently accepted, discharging C. The plan gives no acceptance cleanup for D2, which later sends C again. No restart or uncertain replay is involved.

Evidence: Completion debt is discharged only at acceptance (`../contract.md:243`). The body includes the target's owed completions first (`../contract.md:289`; `../plan.md:521`). A sent wake is never changed, while a later wake may queue behind it (`../contract.md:309`). Cleanup is defined for post closure or an addressee's disposition (`../contract.md:316`), not discharge of a completion already copied into another wake. The existing engine has a real interval between send and acceptance (`packages/engine/test/routing/deliveries.test.ts:45`).

Suggested fix: Define when an owed completion is eligible for packing while another active wake carries it. For example, reserve it to that wake until return or withdrawal, then make it eligible again. Alternatively, remove discharged completion copies from queued wakes on acceptance. Preserve crash and return repair, including the case where removing the duplicate leaves a digest-only wake. Add this ordering to the completion and merge tests. The finding concerns duplicate notices; it does not challenge the accepted possibility of duplicate external sends after an uncertain restart.

### R4-L8. Mandatory reply identifiers can still exceed a completion's cap

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence status: **Confirmed size contradiction**. Responsible builder: board units 1, 2a and 3a.

Scenario: A opens an all-mode question to B and C. B replies once, resolving its part, and then posts additional short replies with the same `replyTo` while C is still pending. Those additional posts need no replies themselves. Nothing in the contract refuses repeated replies or caps the number linked to an open question. When C finally answers, the completion must name every reply id while remaining within 64 KiB. Two thousand UUID-shaped reply ids alone encode to 78,001 bytes, before the outcome, dispositions, text, markers or other fields.

Evidence: A reply is a post with an optional same-channel `replyTo` (`../contract.md:194`). The restrictions bound text, addressees and the author's own open must-reply questions, not the number of replies to an existing question (`../contract.md:191`, `../contract.md:201`). The view keeps a post's replies (`../plan.md:437`), and another post is still written when the replying addressee is already resolved; only its disposition update is conditional (`../plan.md:502`). The completion must carry “the ids of every reply” within 64 KiB (`../contract.md:248`, `../plan.md:367`). The maximum-size criterion uses sixteen replies, one per addressee (`../plan.md:550`), which is not the maximum permitted number of reply posts.

The byte count was checked with Node.js 26.13.0 using 2,000 distinct 36-character UUID-shaped strings and `Buffer.byteLength(JSON.stringify(ids))`. This is arithmetic over permitted metadata, not a run of a future completion encoder.

Why the round 3 answer is incomplete: Row 88 correctly bounds reply text and provides a paged read for omitted text. It still requires an unbounded set of reply identifiers in the bounded notice. The sixteen-addressee cap bounds dispositions, not every linked reply post. This is a remaining case of group 2's indivisible oversized completion.

Suggested fix: Bound the identifiers as well, returning a total and a paged `repliesTo` retrieval path for those omitted. Alternatively, explicitly define a bounded set of counted answers, such as one selected answer per addressee, and specify how additional replies appear in the collection and pages. Do not silently discard linked replies or truncate the required id set. Add a repeated-reply case that exceeds the metadata budget while every post stays small.

## Interacting-rule truth table

These are evaluations of the proposed rules, not executions of future board code. There are no money bases or accounting periods in this plan.

| Inputs | Required result or unresolved interaction |
| --- | --- |
| `reply=none`, no flush or other real wake | No wake. The post stays unread until read or included in a later digest. |
| `any`, one replied and another pending | Close answered and clean all obsolete queued demands. |
| `all`, one replied and another pending | Stay open; clean only the replying addressee's queued demand. |
| `all`, every addressee disposed, at least one replied | Close answered with all dispositions. |
| Either mode, every addressee disposed, none replied | Close unanswerable and owe the agent author a completion. |
| Owner replies, even if not an addressee | Close answered under the outcome table. |
| Author withdraws itself or stops | Withdraw without creating a new completion debt. Existing stop debt needs R4-L6. |
| Another authorized actor withdraws, or the author is explicitly removed | Withdraw and owe a reason-bearing completion; no unauthorized reply text. |
| Group author crashes | Keep membership and open questions; retain completion debt for resume. |
| Group addressee crashes | Resolve gone by lifecycle handling, without treating the crash as removal. A later reply can upgrade it while open. |
| Current manager crashes, then its parent pauses and resumes | Record succession once; the pause moves nothing and rights never return automatically. |
| Addressee interrupted and not reloadable | Resolve gone immediately, including catch-up; refuse new questions to it. |
| Addressee interrupted and reloadable | Leave pending while recovery tries; reload failure resolves gone. |
| Last shared-channel grant ends for a direct pair | Resolve open addressees removed; close by the outcome table; history remains readable. |
| Wake contains both a valid question and an invalid digest post at send | Withdraw, then rebuild without the digest; hold the never-reached addressee during the gap. R4-L2 lacks the necessary delivery input. |
| Board wake returned before acceptance, first then second time | Retry once, then resolve undeliverable or mark completion delivery failed. R4-L3 prevents the required return record under the listed schema edits. |
| Board wake accepted, then returned | Completions remain discharged; retry only still-open incoming questions; do not increment the unaccepted-return count. |
| Completion failed twice | Do not independently retry or hold unsettled for it; retain status and allow flush or a later real wake to carry it. |
| Completion sent but unaccepted, another wake built | Reservation or duplicate-removal policy is missing. R4-L7. |
| Completion accepted, turn ends, no further board events | Engine can settle; the owner's cached hold can remain true. R4-L1. |
| A still-open collection accumulates enough replies that identifiers alone exceed 64 KiB | Text omission cannot make the mandatory metadata fit. R4-L8. |
| Incoming posts or completions exceed their budgets | Bound each completion, use at most 128 KiB for completions, leave the rest owed or open, and provide the stated authorized pages. |
| Board disabled and an old wake loses reach | Dispatcher still withdraws it; no reactor rebuild until re-enabled. Early waits are the stated rollback consequence. |

Write ownership is otherwise clear: command planners use the engine transaction, the reactor re-reads before writing, and the log is the durable source. Send-time checks and withdrawal ownership remain engine responsibilities. The findings above concern the data and transitions those writers need, rather than introducing a second writer.

## Earlier answers checked

All round 1 and round 2 mapped findings were compared with the current rules, as were every round 3 group and minor answer. “Holds” here means that the plan contains a consistent decision; future implementation still needs its tests.

| Earlier answers | Assessment |
| --- | --- |
| Round 1 reach, ceilings, direct grants and group authority | Preserved through the current per-post reach rule, fixed anchors, start ceilings, fixed sender labels and L13/L16. No old caller-tree restriction is re-filed. |
| Round 1 wake index, requeues, merge order and cleanup; round 2 per-addressee cleanup | Preserved. Delivery status is read from the engine view; sent-and-requeued wakes are distinguished from never-sent wakes. R4-L7 is a distinct overlap involving durable completions. |
| Round 1 sparse read state, reply channel, repair command, disabled rollback and restart guarantee | Preserved. Read watermarks plus explicit holes, same-channel replies, close access and qualified restart guarantees remain. |
| Round 1 scope and document ownership | WIDENED exclusions remain a known acceptance item under L14. Only the lead updates the issue and feature lists. |
| Round 2 fixed ancestry, owner anchors, grant revocation and send-time reach | Preserved, including direct grant termination and the check while disabled. |
| Round 2 interrupted agents and late replies | Preserved, including the no-reload-attempt interruption case. |
| Round 2 durable completion, owner snapshot and encoded byte budgets | The lifecycle and size decisions are preserved. The input, refresh, stop-fold and overlapping-send gaps are identified separately above. |
| Round 2 start ceilings, metadata-only status, fixed headers, receipt inventory and incoming overflow read | Preserved as written. |
| Round 3 group 1: crash versus membership | Row 84 holds. A crash no longer removes a group member or withdraws an author's questions. |
| Round 3 group 2: bounded completions | Row 88 bounds text and provides authorized pages, but not the mandatory reply identifiers. R4-L8 reopens that remaining size case. |
| Round 3 group 3 and R3-A4/C3-04/T3-5: bounded fallback and condition results | Bounds and computed result fields hold. The freshness guarantee is incomplete as R4-L1. The engine condition's delivery inputs also need R4-L2. |
| Round 3 group 4: recorded managers | Row 85 holds. Succession uses fixed ancestry and excludes availability, with no automatic return of rights. |
| Round 3 group 5 and m4: delivery-specific send checks and queue progress | E18 preserves the delivery id/source input, projected queue-time state and dispatcher progress. No prior reach-input finding is re-filed. |
| Round 3 group 6 and T3-3: completion text authorization | Row 87 holds. Outcome-only completion is distinct from permission to forward reply text. |
| Round 3 group 7 and T3-6: a silent recipient after acceptance | Row 90 correctly narrows the hold to never-reached questions. R4-L2 concerns evaluating that chosen condition, not widening it again. |
| Round 3 m1: accepted-then-returned wakes | Row 91 supplies a clear policy. R4-L3 concerns the omitted sender schema needed to record returns. |
| Round 3 m2, m3 and m5 | Rows 92–94 preserve bounded automatic retry, flush repair, late upgrades from every non-replied disposition, and refusal of service addressees. |
| Round 3 m6 | Row 95 chooses the right stop policy, but the permitted fold transitions still cannot drop the debt. R4-L6. |
| Round 3 T3-4 and C3-05 | Agent-chosen foreign anchors are refused; the overflow test allows already-carried unanswered questions in incoming pages. |

## Engine-change audit

| Change | Check against the recorded source and shared edits |
| --- | --- |
| B1: commands, access and tools | Existing group composition is at `packages/contracts/src/commands.ts:44`; the explicit tool inventory is at `packages/mcp/src/tools.ts:6`. E1/E2/E10 assign the required composition changes. The named parity test also has per-command payload/reply fixtures (`packages/cli/test/parity.test.ts:27`) that need board cases; these are fixture updates allowed by the plan. |
| B2: events and visibility | The closed union is at `packages/contracts/src/events.ts:88`. E5/E8 cover adding tags and hiding them. The omitted lifecycle event-table consumer is R4-L5. |
| B3: board view and comparison | `apply` explicitly assembles every state field (`packages/engine/src/views/apply.ts:338`), so E6/B3 must add the board field. Comparison walks state keys generically (`packages/engine/src/views/compare.ts:29`). The named apply, rebuild, compare and fixture files are appropriate. |
| B4: reach at send | Today's reservation names one delivery before the runner call (`packages/engine/src/routing/deliveries.ts:239`). E18 defines where the new transaction-local check and continuation belong. Named delivery and carry-on tests cover the affected dispatcher path. |
| B5: planners and source rules | Existing planner dispatch and reply generation are separate; R4-L4 covers the missing reply path. Existing return construction and source classification are at `packages/engine/src/routing/deliveries.ts:45` and line 61; R4-L3 covers its omitted schema consumer. |
| B6: hold unsettled | The existing predicate is at `packages/engine/src/routing/waits.ts:39`. The proposed behavioral change is explicit, but its data adapter and owner-helper freshness need R4-L1/R4-L2. No-board regression expectations are sensible. |
| B7: request held | Existing held-subject cancellation is at `packages/engine/src/routing/waits.ts:83`. The board's no-disposition incoming rule extends that behavior coherently through E20. |
| B8: reactor | Existing lifetime followers are started in `packages/engine/src/commands/CommandHandler.ts:177`; the program composes that service at `packages/engine/src/service.ts:95`. The plan assigns the new reactor to the shared lifetime list. Its specific starting location is to follow unit 1a. |
| B9: reads, snapshot and disable | E4/E9 define the new read and snapshot tables. The board distinguishes transactional read acknowledgements from status/channel reads. Reply construction for transactional `board.read` remains R4-L4. Disabled schemas, view and reach remain active as required. |

The audit does not establish that every required shared engine edit is currently built. The return schema, transactional reply projector and lifecycle event table need to appear in the frozen inventories and named unit ownership before that claim can be made.

## Risk register

Scores are severity × fallout × probability. The reviewer has not accepted or deferred any risk. Closing evidence and the owner's disposition remain pending.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Owner | Decision and deadline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R4-L4 | 6: transactional board commands cannot provide their promised replies | 3: corrected engine integration restores the flow | 10: normal open, post and read commands use this path | **180, fix before release** | Confirmed missing integration | Client API 1a; board 3a | Unset; before release to real users. |
| R4-L1 | 6: an owner wait can remain blocked after work completes | 3: restarting the wait obtains a fresh snapshot | 8: accepting the last completion is a common completion path | **144, schedule** | Confirmed refresh gap | Board 4; client helper | Unset; this phase or a dated follow-up with an owner. |
| R4-L2 | 6: engine waits can report a never-reached target settled | 3: owner or reactor can recover the underlying question | 4: one send-time withdrawal during a queued wake | **72, schedule** | Confirmed input conflict | Board 1/2a/3b; E19 | Unset; this phase or a dated follow-up with an owner. |
| R4-L3 | 6: the board's bounded delivery-repair flow cannot record a return | 3: the retained question can be repaired after the schema change | 4: one ordinary adapter or runner failure | **72, schedule** | Confirmed schema omission | Client API 1b; board 3a | Unset; this phase or a dated follow-up with an owner. |
| R4-L8 | 6: an allowed collection cannot produce its required completion | 3: retained replies remain retrievable manually | 4: an extended collection accumulates many linked replies before its final answer | **72, schedule** | Confirmed size conflict | Board 1/2a/3a | Unset; this phase or a dated follow-up with an owner. |
| R4-L7 | 2: the author receives a redundant completion notice | 3: the queue can be rebuilt without the duplicate | 6: another question arrives before acceptance | **36, record** | Confirmed missing packing rule | Board 3a/3b | Unset; review at phase end. |
| R4-L6 | 2: stale completion metadata survives a stop and may reappear | 3: explicit durable cleanup repairs the state | 4: a stop occurs with completion debt outstanding | **24, record** | Confirmed fold contradiction | Board 2a/3b | Unset; review at phase end. |
| R4-L5 | 1: an integration/build inventory gap | 1: development only; typechecking catches it | 10: extending the event union necessarily reaches this exhaustive type | **10, record** | Confirmed inventory omission | Board 1; E5 | Unset; review at phase end. |

No severity floor applies. No currently failing build gate is claimed or scored; this is a review of unbuilt plans.

## Proposed post-build checks

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| R4-PB1 | Start owner and agent waits on an author with one completion debt. Deliver and accept its last completion, then end its turn with no later board event. Delay a status reply in a separate run. | Both waits agree; neither hangs nor ends from a stale condition result. | An integration trace with stream, summary and settled-evaluation sequences. | Board 4 and client helper. |
| R4-PB2 | Compare an idle target's condition before and after a dispatcher withdrawal, with the board view otherwise identical and the reactor paused. | The board hold covers the entire repair gap, and the engine wait does not satisfy early. | Pure input-adapter assertions and the engine's projected wait-check events. | Board 1/2a/3b and E19. |
| R4-PB3 | Return a piece-sender wake before acceptance twice, then separately accept and return another wake. | Return events encode and rebuild; the first case terminates at the chosen retry bound; the accepted case preserves discharge and does not increment the failure count. | Actual log append, schemas, reactor output and rebuild comparison. | Client API 1b and board 3a/3b. |
| R4-PB4 | Call open, post and read through the public connection, then retry each request id. | Ids and read pages have the contracted shape; writes act once; receipts and replies obey the chosen read policy and remove registered secrets. | Captured RPC replies, stored receipts, event counts and rebuild comparison. | Client API 1a and board 3a/4. |
| R4-PB5 | Merge board tags into the real event union. | Every lifecycle state has an explicit effect for every board tag; engine transitions remain unchanged. | Typecheck and the existing contracts state-machine matrix. | Board 1 and E5. |
| R4-PB6 | Stop an author with an already-owed completion, rebuild, and resume it. Repeat with crash and resume as the control. | Stop debt is absent live and rebuilt and is not delivered after resume; crash debt survives and is delivered. | Fold tests and real stop/crash/recovery traces. | Board 2a/3b. |
| R4-PB7 | Hold the runner acknowledgement for a sent completion wake, then queue a second wake to that author and accept the first. | The completion is not presented twice after a known acceptance; the second wake's legitimate question is preserved. | Wake indices, bodies, acceptance events and delivery counts. | Board 3a/3b. |
| R4-PB8 | Replay the same reactor input while racing a committed reply, manager succession and membership removal. | One authoritative close and one permitted disposition upgrade; no reply is overwritten; live and rebuilt views agree. | Existing planned idempotence and racing-reply tests with log traces. | Board 3b/3c. |
| R4-PB9 | Dispatch a label-revoked wake with a valid engine prompt behind it, also while the board is disabled. | The unauthorized wake is withdrawn, the next delivery progresses in the same pass, and no withdrawn body reaches the runner. | Dispatcher tests with controlled transaction barriers. | E18 and board 3c. |

| R4-PB10 | Keep an all-mode collection open while one member posts enough short replies to overflow the reply-id budget, then close it with the final member's answer. | The completion fits its cap, every retained reply remains accessible through authorized pages, and debt discharges according to the chosen bounded-notice policy. | Encoded sizes, complete paged reply enumeration and acceptance/debt assertions. | Board 1/2a/3a. |

## Noted, not filed

- Known gaps 1, 5 and 7 remain launch or acceptance work assigned to the lead. No known gap was re-filed. L28 resolves the placement question in row 101; R4-L2 addresses the function's data, not its folder.
- The bounded completion, fixed manager, service/direct-pair, per-delivery reach and no-disposition fixes survive the direct-engine rework as decisions.
- A silent addressee that already accepted its question is allowed to settle, while its asker remains unsettled. That is the explicit row 90 choice, not an omitted automatic retry.
- Owner replies may close an all-mode collection before every agent answers. The outcome table states that product choice.
- Board disable intentionally stops its reactor and conditions while retaining schemas, views and reach enforcement. Early waits are an expressly stated consequence.
- The guarantee that condition-id lists are never truncated is bounded only by agent count, not by a stated maximum agent count. The 50-agent size check does not prove a universal 256 KiB bound. This is a capacity limit to measure and assign before larger deployments; the prior bounded-summary fix is not re-filed for ordinary team sizes.
- Repository source was read only. No application code, plan, issue list or feature list was edited. No subagents, team-board commands, commits or pushes were used. No scratch folder was created, so none remains to delete. An exploratory read of a nonexistent MCP test filename was corrected by listing the actual test files; no test result was inferred from that failed read.
- No new Effect-library behavior was assumed to establish these findings. Existing TypeScript declarations and engine control flow provide the source evidence. Board implementation tests were not run because this assignment reviews a frozen plan.
