ship
Grade: 8  B/M/m: 0/0/3  Flags: none

# Round 4 plan critic review

The plan can proceed with the three limited corrections below. No finding requires another review round. The five distinct round 3 major folds hold at the plan level. This is a review of a frozen plan, not clearance of an implementation.

Code anchors refer to the recorded checkout at `8ff4c9b`, unless explicitly marked `9e386b0`. Plan and contract anchors refer to the frozen `lgtm-client-api` folder supplied in the assignment. The newer engine was checked separately at `9e386b0`.

## Findings

### C4-01. MINOR, Design: the proposed file-edit join loses its correlation id before storage.

**Scenario.** A permission request has locations but no input. Its action is supplied in a tool update containing a diff. The page and pane viewer must unfold the matching thread items above Allow. The engine currently discards the tool-call id from that diff. Consequently, the specified join cannot reliably display the edit. The conservative result is the fixed missing-input warning, which leaves the round 3 minor's promised improvement incomplete.

**Evidence.** `contract.md:2354` requires matching by `toolCallId`. At `8ff4c9b`, `packages/engine/src/runner/translate.ts:28` builds file-change content without the id, and line 35 returns those changes before the tool-call branch that retains it. `packages/contracts/src/events.ts:76` permits only path and diff on file-change content. `packages/engine/src/routing/deliveries.ts:114` assigns a fresh item id, so that field cannot recover the lost correlation.

The existing test already demonstrates the loss: `packages/engine/test/runner/stream.test.ts:82` sends `edit-1`, while line 97 expects content without it. E29's test inventory at `contract.md:2364` does not name that existing expectation or the translator change.

A Node.js 26 probe of the actual translator confirmed that an update with `toolCallId: "edit-42"` and diff content produces file-change content containing no `edit-42`. Both supported diff representations follow this omission. The translator change between `8ff4c9b` and `9e386b0` adds a comment only, so the issue survives the newer baseline.

**Suggested fix.** Add an optional correlation field to file-change content and carry it through translation and the event boundary. Keep old logs decodable. Name the existing stream test's changed expectation in E29. Test the page and viewer using events produced through the real translator, including two pending edits, rather than manufacturing already-correlated thread items.

This is the missing engine support for the chosen fold, not a request to reopen the owner's warning policy or the original TM3-2 decision.

**Responsible builder:** unit 1b, with units 7b and 8 consuming the field. **Evidence status:** confirmed.

### C4-02. MINOR, Design: device attribution does not name the later writes from start.

**Scenario.** A phone starts an agent. Its initial command batch records the device, but the later session-opened or failed-start batch is still attributed only to the owner if the named edits are applied without extending the start hook. The operation works, but the device audit trail is incomplete.

**Evidence.** E12 promises that an envelope written for a device carries `device` at `contract.md:1810`. The durable append design takes the optional device explicitly at `contract.md:1828`. E12 adds only `callerKind` to planner input at line 1807. E13 explicitly carries the caller and device into resume's later writes at lines 1865–1870, but names no corresponding change for start.

At `8ff4c9b`, `packages/engine/src/commands/internal.ts:36` gives a planner only runtime, actor and snapshot. The start hook closes over the actor and later calls append directly for `SessionOpened` at `packages/engine/src/commands/start.ts:79` and `AgentStartFailed` at line 83. Changing the command handler's initial append cannot supply the device to those separate transactions. At `9e386b0`, the equivalent direct actor-only appends remain in `packages/engine/src/commands/start.ts:64` and line 95.

**Suggested fix.** Explicitly carry the optional acting device into start's success and failure hooks, alongside the caller information needed by append. Extend the named device cases in `packages/engine/test/commands/handler.test.ts` and `log/caller-durable.test.ts` to cover both outcomes after the initial commit. Include live, catch-up and rebuilt envelopes.

**Responsible builder:** unit 1b. **Evidence status:** confirmed omission in the writer inventory. This is a limited audit defect, not loss of the start operation.

### C4-03. MINOR, Design: E12 needs one additional credential branch on the newer engine.

**Scenario.** The builder applies E12 to the current engine. Handling the new open-web credential only in the command transaction leaves the earlier stop preemption check assuming that every remaining credential is an agent token.

**Evidence.** At `8ff4c9b`, the credential discrimination is in `packages/engine/src/commands/CommandHandler.ts:203`–213, matching E12's named target at `contract.md:1793`–1801. Between `8ff4c9b` and `9e386b0`, the engine added a second discrimination in `preemptStart`, at `packages/engine/src/commands/CommandHandler.ts:210`–216 in the newer checkout. The owner and device branches are followed by an else branch reading `credential.token`. Every valid stop payload reaches this check before the main transaction, through line 237.

The newer regression test `packages/engine/test/commands/start-setup.test.ts:55` checks that stop interrupts hung setup promptly. It is absent from E12's named test additions.

**Suggested fix.** Name the newer preemption path in E12. Apply the same open-web actor mapping there while preserving the credential and holder checks for other callers. Add an open-web version of the hung-start stop case in `start-setup.test.ts`.

This is a real baseline adaptation, not a shifted anchor. It is minor because adding the credential union exposes the unhandled branch during type checking. I am not claiming that an implemented, type-checked web stop already fails.

**Responsible builder:** unit 1b. **Evidence status:** confirmed.

## Risk register

The scores use the supplied severity, fallout and probability scales. Decisions remain with the owner. No acceptance or closing evidence exists yet.

| Id | Severity and reason | Fallout and reason | Probability and reason | Product and band | Owner and deadline | Decision |
|---|---|---|---|---|---|---|
| C4-01 | 2. The edit preview falls back to a warning. | 3. The owner can inspect the thread. | 8. File edits are common in active use. | 48, record. | Unit 1b, reviewed at phase end. | Owner to decide. |
| C4-02 | 2. Later events lose device attribution. | 3. The initial command still identifies the device. | 8. Starting agents is common. | 48, record. | Unit 1b, reviewed at phase end. | Owner to decide. |
| C4-03 | 1. The omitted union branch is a build integration gap. | 1. Type checking exposes it during development. | 10. Adding the union on this baseline encounters it deterministically. | 10, record. | Unit 1b, reviewed at phase end. | Owner to decide. |

The required type-check gate must pass regardless of C4-03's score.

## Round 3 folds and joins

| Earlier major | Round 4 assessment |
|---|---|
| An agent cannot fetch an oversized event. | Holds. `contract.md:692`–734 defines the event read and its data envelope. The access table at line 1326 admits agents. Criterion 3.8 covers real marker recovery and envelope identity. |
| An owner's wait ends inside a batch. | Holds. `contract.md:757`–862 puts an authoritative batch-end read before every terminal result, including owner-held exits. It supplies `client.sequence` when no piece supplies lists. Board contract v10, `inputs/board-contract.md:464`–469, explicitly adopts the same gate. |
| A large reply blocks the stream acknowledgement. | Holds within the stated transport limit. `contract.md:1254`–1318 and E32 at line 2411 require separate stream and read connections, bounded live chunks and recovery that does not reopen the stream prematurely. The remaining heartbeat limit is a named known gap. |
| A piece's pure function stops the engine. | Holds. `contract.md:232`–272 gives the guard and fallback table. E30 names the shared guard. Board contract line 640 and roles plan line 471 adopt it. The separately total permission matcher and capacity condition have explicit no-match policies. |
| An agent holder approves only a title. | Holds. E29, `contract.md:2321`–2347, supplies action fields or fixed warnings inside the existing envelope and preserves them on moved requests. C4-01 concerns the separate file-diff preview improvement, not this major's holder-delivery fix. |

The board and roles joins agree on projected batches, source ids before delivery ids exist, durable service callers, the shared wait fold, and the capacity hold's contribution to unsettled state. Contract v12's `client.event` envelope and owner-only `capacityHeld` lines match the roles plan's uses. No additional major arose from the named engine edits or the newer baseline comparison.

## Proposed post-build checks

1. For C4-01, send two diff-bearing tool updates and permission requests without input through the actual runner, writer, event read and both interfaces. Each request must show its own diff. Old file-change events must still decode. Keep the warning when actual action content is unavailable.
2. For C4-02, start from a real device and from open-web. Delay runner success until after the initial commit, then repeat with runner rejection. Compare the device field on every resulting live envelope with catch-up and rebuild, including after restart.
3. For C4-03, on the newer engine, use open-web to stop a hung start. It must meet the existing prompt-preemption bound. Repeat the existing invalid-credential and unauthorized-agent controls to prove they cannot cancel setup.
4. Run the already named split-batch wait cases over real frames. Include no pieces, board lists, and an empty capacity-held queue. Record the gate's returned sequence and the exact applied cursor at return.
5. Run the throwing-piece fixture through committed events and restart. Verify the fallback for each table and that ordinary stop remains usable. A log-only assertion does not prove replay survives.
6. Run the two-connection recovery cases on the throttled phone link. Capture connection identities, markers, acknowledgements and the applied cursor. Test the documented remaining heartbeat limit separately.
7. Validate the remote-access example against real Caddy and ntfy. For ntfy, use separate publishing and subscribing users with the intended topic permissions. Prove the phone credential cannot publish and the engine credential cannot read.

These are implementation evidence requests, not claims that the tests have already run.

## Noted, not filed

The owner's open web server, shared Unix user, proxy trust limits, carrier redirection, best-effort old-carrier warning, plain account values and remaining large-reply limit are explicit decisions or known gaps. They are not new findings. The pending E28 owner choice and the explicitly WIDENED extension exclusion remain visible. I found no additional unmarked scope expansion requiring a major.

The review remained read-only. Node.js 26.13.0 was selected with `nvm use`. The translator probe ran against the recorded source and returned `retainsCallId: false`. No full test suite or implementation build was run. No scratch files were created, and the repository remained clean. The first result-writing command found no `python` executable; the writer was changed to `python3`.

Context7 returned a monthly-quota error. Official-source checks were used instead, accessed on 2026-11-03. Effect's [version 4.0.5 remote procedure call client source](https://raw.githubusercontent.com/Effect-TS/effect/effect@4.0.5/packages/effect/src/rpc/RpcClient.ts) shows acknowledgements following queue insertion. Retrieving the corresponding RpcGroup source failed, so I make no new verification claim about that file. Caddy documents [interface binding](https://caddyserver.com/docs/caddyfile/directives/bind) and [immediate-peer address matching](https://caddyserver.com/docs/caddyfile/matchers#remote_ip), which support the proposed example. The ntfy [access-control and token documentation](https://docs.ntfy.sh/config/#access-control) supports separate read and write users, and states that tokens inherit their user's access rather than providing independent granular scopes.
