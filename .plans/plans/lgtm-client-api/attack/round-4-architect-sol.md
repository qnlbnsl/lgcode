revise
Grade: 7  B/M/m: 0/1/1  Flags: none

# Architect review of the client API contract, version 12

The shared engine design is implementable. One transport omission still defeats a promised recovery flow. One smaller omission leaves the Codex action-display fold without the correlation data it requires. Neither finding calls for another architectural layer.

This review checks the recorded engine at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`, then checks the named change sites against `9e386b0`. Unqualified repository references below are at `8ff4c9b`. References prefixed `engine-now/` are in the supplied checkout at `9e386b0`. Planning references are relative to `review/api-r4/`: `lgtm-client-api/` holds this plan and its contract, and `inputs/` holds the companion contracts and rulings. `Effect4/` denotes `/home/qnlbnsl/projects/personal/lgtm-studio/node_modules/.pnpm/effect@4.0.5/node_modules/effect/src/`.

# Findings

## R4-A1. The default RPC ping timeout still prevents the promised slow recovery

Severity: MAJOR. Category: Design and bug, failures. Evidence status: Confirmed by the existing transport and the pinned dependency's implementation. This is a static failure trace, not a claim that the future browser implementation was run.

Scenario: The browser receives a state-bearing marker and starts its recovery read on the separate read connection. The server immediately sends the promised 1 MiB event over a connection limited to 500 kilobits per second. Its message takes about 16.8 seconds before protocol overhead. There is no complete server message to decode during that transfer. Effect's own ping watchdog expires before the reply finishes. The client retries from before the marker and repeats the same failed read. Separating the stream connection removes the acknowledgement deadlock, but does not remove this watchdog on the read connection.

Evidence:

- `lgtm-client-api/contract.md:1289` chooses two existing connection records. `contract.md:1297` expressly promises that the recovery can outlast the stream deadline and that the 1 MiB case converges. E32 at `contract.md:2411` specifies two of today's records without a change to their ping settings. `lgtm-client-api/plan.md:687`, criterion 7.14, requires this exact throttled case to converge without a repeated read loop.
- Today's connection constructs `RpcClient.makeProtocolSocket` with only retry options, at `packages/client/src/index.ts:91`. It therefore inherits the dependency's ping defaults. This site is unchanged at `9e386b0`.
- `Effect4/rpc/RpcClient.ts:1249` defaults the interval and timeout to five seconds. The pinger records liveness only on decoded responses, at `Effect4/rpc/RpcClient.ts:1117`. Its repeated tick checks the elapsed time since that response and opens the timeout latch at `Effect4/rpc/RpcClient.ts:1265`. With no intervening response, this can terminate the connection around the second tick, well before a 16.8-second message completes. `Effect4/rpc/RpcClient.ts:1174` races this timeout against the receive loop and turns it into a socket read error.
- The server encodes a response and writes it whole at `Effect4/rpc/RpcServer.ts:1634`. A protocol `Pong` is also an RPC response, at `Effect4/rpc/RpcServer.ts:881`. It cannot make a later data message overtake the large response's bytes. The browser's complete-message delivery rule is specified in the [WebSockets standard, section 4](https://websockets.spec.whatwg.org/#feedback-from-the-protocol).
- The current [Effect RPC client documentation](https://effect.website/docs/v4/api/effect/rpc/RpcClient/#makeprotocolsocket), checked on 2026-11-03, also documents the five-second defaults and decoded-frame liveness. The pinned 4.0.5 source above independently confirms the behavior, so this does not depend on applying newer documentation to an older package.

The accepted gap is wrongly scoped. `lgtm-client-api/attack/known-gaps.md:92` calculates the remaining limit from two 25-second heartbeats, about 3 MiB on this link. The inherited RPC watchdog makes a much smaller reply fail. This finding does not ask for unbounded replies on arbitrarily slow links. It asks for the already-required 1 MiB case to work.

Suggested fix: Name the RPC ping policy in E26/E32 and configure the read connection explicitly. Coordinate that policy with the stated web heartbeat and the supported recovery transfer time. A read timeout consistent with the planned 25-second heartbeat and its two-miss allowance is a small change; do not leave the five-second default active underneath it. Keep the separate stream acknowledgement deadline. Extend criterion 7.14 to assert the actual protocol options and exercise the real watchdog, rather than a fixture protocol that has no pinger. Update the known-gap calculation to describe the shortest effective timeout after the fix.

## R4-A2. The Codex diff join has no persisted tool-call id

Severity: MINOR. Category: Design. Evidence status: Confirmed. This is an incomplete fold of round 3's minor TM3-2, rather than a reopening of its approved display rule.

Scenario: A tool-call update contains a file diff and `toolCallId: edit-1`. Its permission request has no raw input, as the plan's Codex-shaped case allows. E29 and the page criterion require the corresponding thread diff to appear unfolded above Allow. The engine stores the file change without the call id. The page and pane viewer cannot identify the required item by the specified join. A location can show the affected path, but cannot restore the lost association or supply the diff. The fixed warning remains a safe fallback, so this is a limited display defect, not another major approval failure.

Evidence:

- `lgtm-client-api/contract.md:2354` requires the page and viewer to select thread items with the same `toolCallId`. `lgtm-client-api/plan.md:685`, criterion 7.12, requires the matching items in the Codex-shaped case.
- `packages/contracts/src/events.ts:76` gives a file-change content record only `path` and `diff`. Only the separate tool-call variant has `callId`, at `events.ts:69`.
- `packages/engine/src/runner/translate.ts:28` creates file-change records without that id for both supported diff shapes. At `translate.ts:35`, it returns those records before the fallback tool-call record that would preserve the id. `packages/engine/src/routing/deliveries.ts:114` persists their content with a random item id; that id cannot reconstruct the missing call id.
- The existing test supplies `toolCallId: edit-1` at `packages/engine/test/runner/stream.test.ts:82`, then asserts the id-free file-change object exactly at `stream.test.ts:97`. E29's changed-test list at `lgtm-client-api/contract.md:2364` omits this test.
- This is not drift introduced by the newer engine. The same early return and id-free diff construction remain at `engine-now/packages/engine/src/runner/translate.ts:30` through line 37, at `9e386b0`.

Suggested fix: Add an optional correlation field to file-change content, preserve the validated tool-call id in both translator diff branches, and name the mapping between that field and a request's `toolCallId`. Keep old events decodable when the field is absent. Add `packages/engine/test/runner/stream.test.ts` to E29's changed-test list and update its exact assertion. Exercise the path from a raw adapter update through a persisted event and a permission request into both approver views. A handcrafted UI fixture with an invented correlation field would not prove this fold.

# Shared engine edits and the companion plans

I checked all E1–E32 against their named existing writers and readers. Apart from R4-A2, I found no additional concrete mismatch in the named changes or their existing-test impact lists. This is a plan review; no future implementation or test result is implied.

| Edits | Result of the source and contract check |
|---|---|
| E1–E4 | The merged command group, access-before-receipt check, planner table and read table have identifiable existing sites. `packages/engine/src/commands/CommandHandler.ts:54`, line 67 and line 215 are the existing support and dispatch paths. Its after-commit execution at line 278 must survive the table refactor, as E3 requires. Fresh read replies are separate from stored command receipts. |
| E5–E10 | Event retention, piece reducers, migrations, visibility, snapshot assembly and dotted command names have named owners. The coherent snapshot can use the existing whole-state reference: `packages/engine/src/views/Views.ts:44` applies a complete batch in one reference update. `packages/engine/src/log/EventLog.ts:133` publishes only after applying the batch. E9 correctly takes the sequence from the captured views value instead of the separate log head. |
| E11–E14 | Caller, acting device, service identity and answering-rule provenance have both a durable encoding and a decoder/backfill path. The current receipt-key restriction at `packages/engine/src/log/EventLog.ts:116` is explicitly replaced. Service access requires both the service's own list and the command's access; a network caller cannot claim that identity. |
| E15–E18 | Sender widening includes the delivery, sent event and returned event. The existing return-notice branch at `packages/engine/src/routing/deliveries.ts:46` already distinguishes an agent sender, which the plan preserves. Queue and send checks use projected and fresh transaction views respectively. E17's idle repair precedes wait checks and covers a withdrawal from a reloaded agent, including a withdrawal caused by another engine path. |
| E19–E23 | The shared settled input, request-held conditions, thread index, exported helpers and piece-batch path are explicitly owned. The placeholder envelope in `packages/engine/src/routing/waits.ts:28` explains the reducer restriction to event and sequence. Piece writes cannot bypass source ownership, reach checks, idle repair and waits. The roles capacity hold is an engine settled input, rather than a contradictory per-piece override. |
| E24–E26, E32 | Dispatch, tolerant decoding at the RPC boundary, browser imports and separate connection lifetimes are specified and testable. Known malformed events remain errors. R4-A1 is the remaining transport failure. |
| E27–E31 | Startup-only collection, generation-specific token slots, reserved account names, web answer restrictions, bounded permission actions, guarded piece functions and stop-time permission cancellation have explicit behavior and tests. E29 needs the additional writer and test in R4-A2. E31 does not claim to close questions from a stopped asker, which remains an accepted gap. |

The board join holds at the contract level. `inputs/board-contract.md:482` makes marked reads fresh and writes their marks through E23 without a receipt. Its snapshot and condition lists at line 516 use one views sequence. Its owner-only events remain unreadable to agents even though `client.event` is agent-callable. Its guard rule at line 640 matches E30. The wake's own-namespace withdrawal and send-time reach rules agree with E17/E18. No lifecycle permission is conferred by a board delivery.

The roles join also holds. `inputs/roles-plan.md:821` includes `client.event` in the sheepdog's explicit service list and preserves the lack of `board.read`. Its permission-action data agrees with E29. Its capacity-hold clause and `capacityHeld` snapshot field at line 1166 agree with version 12's E19, including the client fold, stop/crash closure and property test. Roles unit 11b supplies that behavior after the shared engine and read units; the client API does not pretend to implement it earlier. The named matcher and capacity-condition exceptions retain their own fail rules, as the final ruling permits.

# Round 3 folds

| Earlier major group | Round 4 result |
|---|---|
| Agent marker recovery | Holds. `client.event` is granted under the stream's read rule, its tool pin is updated, its reply includes the envelope, and criterion 3.8 tests agent recovery and refusal of hidden events. |
| Wait completion inside a committed batch | Holds. Criterion 3.10 requires a batch-end sequence gate before every result, including owner-held exit 2, and covers both live and paged splits. This uses the actual views publication order cited above. |
| Large reads sharing a stream connection | The queue and acknowledgement fix is sound, but its complete convergence promise still fails through the independent ping timeout in R4-A1. |
| Throwing piece functions stopping the engine | Holds as a plan. E30 names one synchronous guard, deterministic reducer fallback, each table's failure policy, and a throwing fixture through commands and rebuild. |
| Approvers seeing only a title | The major fold holds for holders, moves and the pane viewer: the bounded action stays in the open request row and the fixed warning covers absence. R4-A2 concerns the additional Codex diff-display path. |

The round 3 minor fixes for encoded snapshot budgets and incremental command installation are explicit. Unit 2 installs event schemas without premature handlers, and unit 3 precedes the browser unit that uses its reads.

# Proposed post-build checks

1. Run criterion 7.14 through the production browser artifact and the real Effect protocol at 500 kilobits per second. Record read-connection lifetime, ping-timeout callbacks, recovery attempts, cursor movement and answer completion. Recover one 1 MiB state event while the stream produces a backlog. The read must complete once even if the stream reconnects. Retain the actual configured ping values as evidence. Browser timing delays alone are insufficient evidence of a bandwidth-limited transfer.
2. Test the R4-A2 correlation from raw diff updates, including both translator diff shapes, an absent raw input, repeated edits of the same path under different call ids, and an old file-change event without an id. The page and pane viewer must show only the matching action or the prescribed fallback. Capture the persisted events and rendered controls.
3. Preserve the newer engine's start preemption during E3/E12. At `8ff4c9b`, execution begins at `packages/engine/src/commands/CommandHandler.ts:198`. At `9e386b0`, it is wrapped by `engine-now/packages/engine/src/commands/CommandHandler.ts:237`, with a separate credential check in `preemptStart` at line 202. Extend the newer `packages/engine/test/commands/start-setup.test.ts:55` case to the branded open-web caller: a stop must interrupt a setup that never returns within the existing five-second test deadline. An unauthorized caller must not preempt it. This is a preservation check, not a finding that adding the new union has already broken unbuilt code.
4. Exercise E11/E12/E21 through append, read pages, catch-up and a full rebuild from a pre-migration log. Verify service rule and device provenance, all three sender positions, and the `DeliveryQueued` target index. Compare recovered views and envelopes, not only schema acceptance.
5. Combine a board wake, a roles capacity hold, a stopped asker and a reloaded target. Withdraw the final queued wake, then release the hold. Assert no target remains working with nothing sent, no stale permission wakes survive stop, and owner waits agree with the engine at each batch end. Use the shared fold property test and the real sequence gate.
6. Keep the already-required hostile piece fixture, carrier-generation race, startup secret retention, real proxy and real ntfy checks. The carrier checks must include an hour-long outage, an old-generation completion after rotation, and the installed server's sequence-id update and delete behavior. Show outbound requests and resulting phone state. Documentation alone does not close these environment checks.

# Noted, not filed

I compared the named sites across `8ff4c9b` and `9e386b0`, including command handling, start setup, account and harness planning, runner permission translation, redaction, recovery, routing, log persistence, client imports and registry changes. I found no additional confirmed drift defect. The newer start preemption merits check 3. New login and redaction work requires preserving the newer implementation when applying the edits, but shifted anchors and added safeguards alone are not findings.

I did not reopen the approved direct engine edits, the absence of authentication in this phase, question 6's pending recommended answer, plain account values on the stream, same-user limitations, the port-squatter limitation, duplicate push delivery, the connection cap, or the accepted unbounded-agent snapshot limit. The lead owns recording issues and feature changes; this reviewer made none.

Library and service checks were read on 2026-11-03. Context7 provided ntfy documentation, but its Effect result did not answer the RPC question and later queries hit its quota. I used the pinned Effect source and official documentation as the fallback. Besides the RPC and WebSocket sources in R4-A1, I checked [Effect RPC groups](https://effect.website/docs/v4/api/effect/rpc/RpcGroup/), [Effect sockets](https://effect.website/docs/v4/api/effect/socket/Socket/), [ntfy publishing](https://docs.ntfy.sh/publish/), and [Caddy reverse-proxy headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults). The ntfy documentation supports sequence-id updates and deletes; deployed-server compatibility still needs PB-5. Caddy documents forwarding the original Host and setting the forwarded headers; the real proxy configuration still needs PB-2.

I also checked the official [React logic-sharing guidance](https://react.dev/learn/reusing-logic-with-custom-hooks), [Vite production build guidance](https://vite.dev/guide/build), [Ink repository documentation](https://github.com/vadimdemedes/ink), and [Playwright network guidance](https://playwright.dev/docs/network). These support the proposed division of shared logic and separate renderers and the named build/browser checks. They do not prove the future UI or a particular throttling fixture correct.

Node 26 was selected. The repository remained unchanged and clean. No implementation tests, deployed-service probes or browser tests were run. No scratch directory was created. No policy refusal occurred. The result file is the only write made for this assignment.

# Risk register

| Id | Severity and reason | Fallout and reason | Probability and reason | Product and band | Evidence | Responsible builder | Decision | Deadline | Acceptance | Closing evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| R4-A1 | 6. The promised control-state recovery remains unusable on the affected connection until its policy or network changes. | 3. The affected owner can recover on a faster link; the durable log is intact. | 4. A slow link is one specific network condition, and the required event size is explicitly supported. | 6 × 3 × 4 = 72. Schedule. | Confirmed source trace. | Client transport builder, unit 2. Assignment unset. | Unset; owner decides. | Within this phase, or a dated follow-up with an owner. | None. | Pending corrected policy and real-protocol convergence evidence. |
| R4-A2 | 2. The approver loses the matching diff presentation but retains the warning fallback. | 3. One approval can be inspected through the thread by the owner. | 6. An edit request with omitted raw input is an ordinary specific adapter path. | 2 × 3 × 6 = 36. Record. | Confirmed schema, translator and exact test assertion. | Runner/contracts builder for E29, with page and pane consumers. Assignment unset. | Unset; owner decides. | Review at the end of the phase. | None. | Pending persisted correlation and both consumer checks. |

The risk bands rank remediation; they do not change the MAJOR consequence label or assert that the owner has authorized another review round. There are no blockers or flags.
