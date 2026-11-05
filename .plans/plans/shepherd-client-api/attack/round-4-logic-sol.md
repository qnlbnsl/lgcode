ship
Grade: 10  B/M/m: 0/0/0  Flags: none

## Findings

No new confirmed defect was found through the logic and failure policy lens. The five distinct round 3 major folds hold in contract version 12. The shared engine edits have stated write ownership, ordering and refusal rules. The board and roles joins do not require a contradictory wait or delivery rule.

This is a review of the frozen plan, not verification of an implementation. No build or runtime test is reported as passing. Repository references below are relative to the recorded checkout at `8ff4c9b`, unless explicitly marked `9e386b0`. Plan, contract and input references are relative to this round's review folder.

### Round 3 major folds

| Earlier failure | Recheck and result |
| --- | --- |
| An agent cannot recover an oversized event. | `contract.md:715` gives agents `client.event` under the stream's read rule, in the data envelope. Hidden and missing events have the same refusal. Losing a read right does not grant recovery access. Criterion 3.8 includes visible and hidden sequences. The fold holds. |
| An owner wait ends inside a committed batch. | `contract.md:797` gates every candidate end, including the needs-owner exit, on a read at a committed boundary. A read behind the stream is repeated. A read ahead requires consuming through that sequence and deciding again. With no piece lists, `client.sequence` supplies the boundary. Criterion 3.10 exercises split batches. The fold holds. |
| A large read prevents the stream acknowledgement. | `contract.md:1264` bounds live chunks and separates reads from streams. E32 at `contract.md:2411` makes the separation apply to both transports, preserves independent reconnects, and suspends stream reconnect during recovery reads. Criteria 3.9 and 7.14 exercise the slow link. The stated large-reply and connection-count limits remain accepted limits. The fold holds within them. |
| A throwing piece prevents commands or restart. | `contract.md:232` supplies a fallback for every function table, including deterministic reducer fallback and retaining secrets when collection cannot get a keep list. E30 at `contract.md:2375` specifies the common synchronous guard and a bounded error sink without event text. The roles' matcher and capacity condition are explicitly outside the table and have their own total failure rules. The fold holds. |
| A holder approves a title without seeing the action. | E29 at `contract.md:2302` carries redacted, bounded action fields, keeps them while the request is open, and uses them again on a move. Engine lines precede the title. The page and pane viewer show the input, associated tool-call items, or fixed warnings before approval. Criteria 1.42, 7.12 and 8.2 cover these paths. The fold holds. |

The related stop and withdrawal folds also hold. E31 cancels the stopped asker's permissions before moving held requests. E17 applies its reloaded-state repair to every withdrawal batch before wait checks, including engine withdrawals. These match the relevant existing mechanisms: `packages/engine/src/recovery/crash.ts:57`, `packages/engine/src/routing/deliveries.ts:222` and `packages/engine/src/routing/waits.ts:110`.

### Shared engine edits and existing tests

All E1 through E32 were checked. The following groups record the existing-code seams and the failure-policy conclusion. These are evidence for the review, not additional findings.

| Edits | Existing seam and conclusion |
| --- | --- |
| E1–E4 | `packages/contracts/src/commands.ts:10`, `packages/mcp/src/tools.ts:7` and `packages/engine/src/commands/CommandHandler.ts:54` contain the fixed inventories being replaced. The plan preserves the core command behavior while introducing group, planner and read tables. Access is explicitly checked before receipts, closing the existing ordering at `CommandHandler.ts:238` and `CommandHandler.ts:260`. Unsupported commands remain refused. |
| E5–E7 | `packages/contracts/src/stateMachine.ts:79`, `packages/engine/src/views/apply.ts:338` and `packages/engine/src/log/migrations.ts:11` are the lifecycle, fold and migration seams. Piece events keep lifecycle state. Reducers use only the event and sequence, matching the projection at `packages/engine/src/routing/waits.ts:28`. Piece side rows share the transaction rather than creating another writer. |
| E8–E10 | Visibility is shared across reads. The snapshot uses the publication boundary already present at `packages/engine/src/log/EventLog.ts:136` and the atomic view update at `packages/engine/src/views/Views.ts:44`. The command-line registry at `packages/cli/src/commands/registry.ts:10` is explicitly replaced to admit dotted names. No alternative snapshot writer is introduced. |
| E11–E14 | `packages/engine/src/log/EventLog.ts:116`, `packages/engine/src/log/subscribe.ts:36` and `packages/engine/src/views/rebuild.ts:26` explain why widening the live envelope alone would lose caller metadata. The migration, append and shared decoder changes cover the durable paths. A service cannot authenticate over the wire or call `answer`. Standing-rule answers instead carry their service and rule inside the permission transaction. |
| E15–E18 | The sender fields and wrapping changes cover the existing envelope at `packages/engine/src/routing/envelope.ts:14` and return behavior at `packages/engine/src/routing/deliveries.ts:45`. Queue-time reach uses projected state. Send-time reach runs in the send transaction. Refusal withdraws and advances the queue, with reloaded-state repair before wait checks. It grants no management right. |
| E19–E20 | The shared functions replace the existing definitions at `packages/engine/src/routing/waits.ts:33`, `waits.ts:39`, `waits.ts:49` and `waits.ts:92`. The client fold is compared with the engine fold at each sequence. A failed hold-unsettled function keeps the agent unsettled; a failed request-held function cannot grant a blocking-wait right. |
| E21–E23 | `packages/engine/src/views/apply.ts:122` supplies the thread identity which the old append column misses at `packages/engine/src/log/EventLog.ts:175`. Paged reads use the new durable decoder and visibility rule. Piece batches have one checked write path and explicit all-or-nothing refusal behavior. Engine events cannot bypass the lifecycle check. |
| E24–E26 | Stream dispatch, tolerant wire decoding and the browser split are expressly separate changes. Unknown tags advance the cursor, while a malformed known event fails decoding. The plan requires actual encoded-frame and production-browser checks rather than treating an object-level helper test as proof. |
| E27–E28 | The startup collection at `packages/engine/src/recovery/restart.ts:139` and account secret store-before-commit at `packages/engine/src/commands/accounts.ts:38` explain the required keep list and narrow removal operation. No runtime collection is added. Device answer refusal leaves the request open. The pending owner decision is explicitly isolated from the rest of the plan. |
| E29–E32 | The existing permission callback at `packages/engine/src/runner/AcpRunner.ts:400`, moved delivery at `packages/engine/src/routing/holders.ts:88`, and stop planner at `packages/engine/src/commands/stop.ts:10` are all covered. Action retention, guard fallback, asker's cancellation and transport separation have separate criteria. |

The named existing-test updates cover the changed receipt, caller, state, delivery, prompt-text, moving-request, restart and client-connection expectations. No existing assertion requiring an additional behavior reversal was found. In particular, `packages/engine/test/acceptance/failure-4-no-answerer.test.ts:24` stops holders, so E31 does not contradict its expectation that stopping a holder does not cancel the asker's permission. The plan also names new fixtures for the newly introduced failure paths.

### Interacting-rule truth table

| Condition | Required result | Contract or join |
| --- | --- | --- |
| A stream suggests completion halfway through a batch. | Do not return. Prove a batch boundary, catch up and decide again. | Client API section 3 and criterion 3.10. |
| A piece snapshot section is omitted because its function threw. | Do not treat the absent section as proof that no work remains. The piece's condition-list read is still required; a failed read cannot finish the wait. | `inputs/board-contract.md:453`, `inputs/board-contract.md:464` and `inputs/board-contract.md:652`; client API section 3. |
| A piece hold-unsettled function throws. | Keep the agent unsettled. | Client API section 1. |
| A capacity hold is open after its queue becomes empty. | Keep the agent unsettled until the hold ends. | E19 at `contract.md:2044`; roles unit 11b adds `capacityHeld`, its fold and release behavior, after client API units 1b and 3. |
| Queue-time reach allows, but send-time reach refuses. | Withdraw without sending, repair a stranded reloaded state, run wait checks and consider the next delivery. | E17–E18. |
| A piece batch has a valid own event followed by an invalid withdrawal. | Commit none of the proposed events or side rows. Write only the specified refusal for that batch kind. | E23. |
| A stopped asker has an open permission and an open question. | Cancel the permission and withdraw its queued delivery. Keep the question open, as on crash. | E31. |
| A piece secret keep function throws during startup. | Skip collection for that startup. Preserve values rather than guessing a keep set. | E27 and E30. |
| A device dismisses the protected lasting alert. | Close the page item without silencing the protected push. | Client API section 4 and criterion 6.17. |
| A token write succeeds, but its selecting event fails to commit. | The earlier selected token remains active. The unselected value is not a new active credential. | E27 and carrier lifecycle rules. |

### Comparison with the newer engine commit

The comparison against `9e386b0` found integration work, but no change that invalidates a named edit's required behavior.

The important new command-handler seam is start preemption. At `8ff4c9b`, actor mapping is in `packages/engine/src/commands/CommandHandler.ts:203`. At `9e386b0`, there is also credential mapping in `CommandHandler.ts:210`, reached through `preemptStart` at `CommandHandler.ts:237`. E12's requirement that `execute` treat open-web as a device must apply to both paths. Its implementation must preserve the newer cancellation checks and the start-preemption regression tests. This is a concrete post-build integration check below, rather than a claim that the plan requires retaining an agent-only fallback.

The newer runner also resolves the root account secret at `packages/engine/src/runner/AcpRunner.ts:340` and checks credential coverage in its permission path at `AcpRunner.ts:557`. This does not establish a second permitted path into the carrier namespace: the root reference is constrained by `packages/contracts/src/accounts.ts:4`, which excludes the dots in the carrier slot. Environment values still need E27's explicit refusal. E29 must preserve the newer coverage checks and structural redaction when adding the action fields.

The newer harness reset and first-use setup remain part of the existing harness planner behavior which E3 preserves. The newer bounded start and reload hooks likewise remain subject to E3's preserved after-commit and lane ordering. No shifted line number is counted as a defect.

## Risk register

The register is empty. There are no confirmed or unresolved findings to score. The implementation checks below are verification obligations, not scored allegations of defects.

## Proposed post-build checks

| Scenario | Expected result | Evidence needed |
| --- | --- | --- |
| On the `9e386b0` integration, open-web stops a start whose setup never returns. Repeat with an invalid device credential and with a refused stop. | Open-web follows the owner's authorized preemption path. Invalid credentials cannot preempt. A stop that does not commit still follows the newer start cleanup rules. | Extend the real command-handler fixture in `packages/engine/test/commands/start-setup.test.ts:55`; record cancellation, stop outcome and final lifecycle state. |
| A board snapshot function throws while the board still has blocking work. Repeat with a failed board status read and a stream split inside the work-removing batch. | No false settled result. The failed section is marked, the required status read is not skipped, and every eventual return uses the batch-boundary gate. | Real client frames, piece-list replies and final cursor, combining criteria 1.44 and 3.10 with board wait cases. |
| The newer runner receives a permission with action input containing a secret across the cap boundary. Repeat with unavailable credential coverage and with a moved request. | Redaction precedes the cap, credential-coverage refusal is retained, and the moved holder sees the same bounded action or fixed warning. | The real adapter callback, stored event, live/rebuilt request row and rendered holder delivery; retain the newer login/redaction regressions. |
| A capacity hold remains open with no queued delivery, then ends by timer, stop or crash. | Engine and client remain equally unsettled until the ending event, then agree at every sequence. | Add these events to E19's engine/client property test, as required by roles unit 11b. |
| A throttled client recovers an oversized visible event while other reads run and the stream disconnects. | The recovery read finishes before stream reconnect; the cursor advances once; read reconnects do not restart a healthy stream. Hidden sequences remain inaccessible. | Existing criteria 3.8, 3.9 and 7.14, plus the real-phone check PB-15. |

## Noted, not filed

The owner-approved unauthenticated loopback period, deferred dedicated Unix user, future pairing, pending persistent-answer ruling, accepted large-reply limit and known loopback-port squatting limit are not reopened. The v12 timestamp addition supplies the full envelope needed for the roles' timers. The capacity-hold addition has an explicit producer, client fold and dependency order.

Carrier clearing is best effort, rather than a guarantee that every already issued external request can be recalled. The official [ntfy publishing documentation](https://docs.ntfy.sh/publish/) was checked on 2026-11-03 for sequence updates and deletion. No new external-service guarantee is assumed here. Context7 returned a quota error; the official [Effect 4 documentation](https://effect.website/docs/v4/onboarding) was consulted as fallback. No untested Effect runtime behavior is presented as verified.

The review checkout remains unchanged. No scratch folder was created, no application code was added, and no commit or push was made.
