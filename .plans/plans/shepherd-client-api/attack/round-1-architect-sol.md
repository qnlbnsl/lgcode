revise
Grade: 6  B/M/m: 0/8/3  Flags: none

# Architect review of the client API plan and contract version 7

The overall placement is sound: the engine owns the log, transactions, authorization and delivery; pieces extend its explicit tables; the web and terminal clients use the same application programming interface (API). The plan needs corrections to preserve existing engine effects and to make its client stream, waits, size limit and alert promises implementable. These are changes within the proposed design.

## Scope and evidence

The repository was checked at commit `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. Repository references below are relative to that checkout. References to `plan.md`, `contract.md`, `decisions.md` and `scouting.md` are relative to this result's parent plan directory. References to `inputs/` are relative to the supplied `review/api-r1/` directory.

The refreshed plan, contract, decisions and binding inputs were reread after the launcher's correction. In particular, this review uses decision row 90 and criteria 5.4 and 10.1 as refreshed. This is a plan review. A confirmed finding below confirms a contradiction or missing contract requirement; it does not claim that the future implementation has failed a test.

## Findings

### A1. MAJOR — Design. E3 incorrectly restricts the existing after-commit hook to waits.

Scenario: the builder follows E3 literally and retains `afterCommit` only for blocking `wait`. Starting an agent records its start without opening its process and session. Stopping, resuming and answering a permission request also lose their external actions.

Evidence: `contract.md:797-806` says that `afterCommit` stays for blocking wait only, while `contract.md:811-815` promises unchanged engine behavior and names the preservation tests. Today, `packages/engine/src/commands/start.ts:53-79` starts the runner and records its session inside that hook. `commands/stop.ts:20` stops the runner there. `commands/resume.ts:45-56` reloads and dispatches queued work there. `packages/engine/src/routing/permissions.ts:49-54` delivers the selected permission answer there. `packages/engine/src/commands/CommandHandler.ts:275-279` executes the hook after committing.

Fix: distinguish a stored reply from an external after-commit action. Preserve every existing engine hook and its ordering and send-lane protection. Restrict piece planners from adding hooks if that is intended. Only the blocking wait needs to replace the immediate reply with a later reply. Name the lifecycle and permission-routing tests alongside the handler and receipt tests; the start/session assertion already exists at `packages/engine/test/commands/lifecycle.test.ts:65-84`.

### A2. MAJOR — Design. The generic client routes every streaming command to engine subscribe.

Scenario: the new `client.subscribe` is merged into the command group and invoked through `packages/client`. It calls the old `subscribe` endpoint, so its filters and checkpoint protocol do not run. Reconnection repeats the same wrong call.

Evidence: `contract.md:383-392` defines a distinct filtered stream. `plan.md:362-364` assigns the group merge and unknown-event decoding, while `plan.md:403-405` assigns server reads and the wait helper. The existing generic client assigns the same `subscribe` function to every streaming command at `packages/client/src/index.ts:218-219`. That helper hard-codes `connection.client.subscribe` at line 199. It does not receive the command tag.

Fix: explicitly assign the client refactor. Dispatch streams by their actual command tag, preserve the filter payload on retries, and extract the cursor from both event and checkpoint records. Add an acceptance case through the public client connection, with a dropped connection, rather than testing only the filtered server handler.

### A3. MAJOR — Design. Unknown-event handling is assigned after the decoder that rejects the event.

Scenario: a previously built client subscribes after the board starts writing a new event tag. Its typed remote procedure call (RPC) decoder rejects the chunk before the proposed subscribe-helper fallback can inspect the tag or advance the cursor.

Evidence: `contract.md:507-511` promises that such clients never fail on the new tag. `plan.md:354` and `plan.md:364` assign the fallback to the client's subscribe helper. That helper consumes a client created with `RpcClient.make(CommandsRpcGroup)` at `packages/client/src/index.ts:97`. The current subscription's wire success schema is `EventEnvelope` at `packages/contracts/src/commands.ts:131-134`; its event is the closed `Event` union at `packages/contracts/src/events.ts:184-192`.

The installed Effect 4.0.5 source, `node_modules/.pnpm/effect@4.0.5/node_modules/effect/src/rpc/RpcClient.ts:733-755`, decodes the incoming chunk before delivering it to the application stream. Lines 811-818 derive that decoder from the RPC success schema. The official [Effect RPC client source](https://raw.githubusercontent.com/Effect-TS/effect/effect@4.0.5/packages/effect/src/rpc/RpcClient.ts), checked on 2026-11-03, corroborates decoding at this boundary. A direct schema probe also rejected an otherwise valid envelope carrying an unknown event tag.

Fix: define a tolerant client wire envelope or a client-specific decoding group at the RPC boundary, then decode known events and preserve unknown tags above it. Keep the engine's durable event validation strict. Specify treatment of future caller metadata too. Test an older client against actual serialized frames from a newer server; passing a fabricated object directly to the helper would miss this failure.

### A4. MAJOR — Design. The snapshot omits engine state needed to compute settled.

Scenario: a client attaches while an agent is idle with an already queued delivery, including a roles capacity hold, or an open nonblocking wait. Those facts predate the snapshot cursor. The helper cannot recover them from subsequent events and can finish immediately when the engine would continue waiting.

Evidence: `contract.md:365-374` enumerates the snapshot's engine fields without deliveries or waits. E9 at `contract.md:947-956` adds consistent capture and piece sections but does not add them. E19 at `contract.md:1185-1200` requires the client to construct the common settled input from that snapshot and stream, expressly including delivery statuses. The current predicate at `packages/engine/src/routing/waits.ts:39-45` requires both active deliveries and open nonblocking waits. This is also a consumer dependency: `inputs/roles-plan.md:425-429` deliberately adds no separate condition because a held queue remains unsettled through engine deliveries.

Fix: specify a complete, caller-filtered engine wait-state section at the snapshot's sequence. It can be compact, but must include every initial fact needed by the shared predicate and its updates. Give it the same size and completeness treatment as the other snapshot sections. Test attachment after a delivery or wait was already opened, including a held roles queue.

### A5. MAJOR — Design. Sharing settled alone cannot preserve the promised wait exit codes.

Scenario: a waited agent is already stopped, crashed, paused or permanently interrupted. The proposed helper waits for settled, which requires idle, and can hang indefinitely instead of returning the engine's terminal reason and exit code.

Evidence: `contract.md:516-520` defines completion through the settled test. E19 at `contract.md:1185-1189` moves only `settled` and `holds`. In today's engine, a separate `reasonOf` at `packages/engine/src/routing/waits.ts:49-57` resolves crashed, stopped, paused and nonreloadable interrupted members; reloadable interrupted members remain unresolved. `plan.md:396` nevertheless promises the engine's exit codes. `packages/cli/src/commands/wait.ts:25-29` derives those codes from precisely these reasons.

Fix: share or explicitly specify the complete member-resolution rule and the any/all aggregation, including reloadability and terminal states. Then use it in the client helper and its command-line reporter. Preserve the agents-only engine wait ruling. Add a truth table covering each state, reloadability, any/all and mixed resolved members.

### A6. MAJOR — Design. The one-mebibyte message budget has no bound for existing engine data.

Scenario: a tool emits a large output or diff, or a thread page contains many ordinary events. A valid log record or reply exceeds the web message limit and cannot be read through the promised web transport. A reconnect can encounter the same record repeatedly.

Evidence: `contract.md:694-704` requires the largest event or reply to fit the 1,048,576-byte limit. `plan.md:356` tests declared maxima, but `packages/contracts/src/events.ts:61-76` allows unbounded text, tool input/output and file diffs. `contract.md:495-497` bounds a thread page by 500 events, without a byte bound. The snapshot enumeration at `contract.md:365-374` similarly gives no overall byte budget for engine records plus piece sections.

A read-only Node.js 26 probe using the current envelope schema accepted a single thread event with 2 MiB of text. Its encoded envelope was 2,097,359 bytes. A reply body containing 500 valid events with 3 KiB of text each was 1,639,813 bytes, before the RPC wrapper.

Fix: define byte-bounded pages and an overall snapshot strategy. Decide how an oversized single existing event is represented or fetched without silently truncating the log. State whether the web limit is inbound-only; if so, revise the claim that every event and reply fits it and define the outbound policy separately. Test actual encoded transport messages, including RPC chunk batching, rather than only declared piece maxima.

### A7. MAJOR — Design. A durable alert record does not settle the external-send crash window.

Scenario: ntfy accepts a push, then the service dies before recording `AlertDelivered`. Restarting must either resend and risk a duplicate, or assume delivery and risk losing a push whose first send did not succeed. The plan gives no chosen recovery policy.

Evidence: `plan.md:163-164` says that the alert log prevents both loss and duplicate sends across restart. `contract.md:607-613` specifies the external send and local attempt result, without an external idempotency or reconciliation rule. Criterion 6.3 at `plan.md:504` kills the service between the source event and alert creation; it does not cover the carrier-acceptance window. Criterion 6.11 at `plan.md:512` adds bounded retries but does not define their durable recovery state.

Fix: choose a delivery guarantee explicitly. The simpler option is durable at-least-once delivery with possible duplicate notifications, if accepted, and retry state reconstructed across restart. If duplicate suppression is required, specify and verify a carrier-supported stable identity and reconciliation protocol. Add failure injection before send, after carrier acceptance, before recording success, and during backoff. Do not treat the local alert-creation test as proof of external exactly-once delivery.

### A8. MAJOR — Design. A board alert has no specified way to read and answer its subject on the page.

Scenario: an agent posts a question addressed to the owner. A phone notification opens the agent's thread. The page offers engine `answer` and `prompt`, while the board post remains open because neither action is a reply to that post.

Evidence: `contract.md:570-578` promises that a board alert carries its post subject and a tap opens the post. The owner-approved thread destination is retained at `contract.md:635-648`. However, `plan.md:552-557` specifies thread content, engine answers, prompts and thread links, with no board subject reader or reply action. The board uses its own protocol: owner-addressed posts raise these alerts at `inputs/board-contract.md:284-289`; owner replies close them at `inputs/board-contract.md:239-246`; `board.read` and `board.post` are the relevant commands at `inputs/board-contract.md:510-512`.

Fix: keep the owner's thread destination, but agree with the board planner how that thread loads a post subject and sends a reply tied to its post id. Assign ownership of that small integration and its dependency order. Alternatively, explicitly scope this interaction to a later board client unit and amend the current promise. Test that following the notification, reading and replying actually clears the original board alert and delivers the board completion.

### m1. MINOR — Design. E21 depends on an index already known to omit thread events.

Scenario: the owner exports a thread while a delivery is queued. The paged log read omits the queued message even though the engine's thread view contains it.

Evidence: `contract.md:1222-1226` specifies using the existing per-event agent column. `packages/engine/src/log/EventLog.ts:175-178` fills that column only from a top-level agent id. `packages/engine/src/views/apply.ts:119-123` explicitly special-cases `DeliveryQueued.delivery.target`, and lines 338-346 include it in the thread. `docs/issues.md:519-532` already records the limitation as issue 31.

Fix: scope issue 31 into the new E21 read, using the nested target where needed or a separate thread index with a migration. Compare an owner's paged thread with the rebuilt thread view. Do not widen the envelope visibility rule for agents: `contract.md:444-447` deliberately preserves the existing behavior for events without a top-level agent id. This finding concerns the new plan's dependency on issue 31, rather than filing that old issue again.

### m2. MINOR — Design. Rollout has no compatible rollback procedure after the first new event.

Scenario: an operator rolls back to the recorded engine after enabling alerts or services. The old engine cannot rebuild a log containing the new tags or caller forms. The new nullable columns' forward compatibility does not make that binary rollback safe.

Evidence: `plan.md:200-221` specifies rollout but no rollback. `contract.md:1007-1025` makes old rows readable by the new engine and introduces service and piece callers. In the recorded engine, `packages/engine/src/log/subscribe.ts:35-46` rejects those caller forms and decodes the closed event union. `packages/engine/src/views/rebuild.ts:26-35` decodes all rows during rebuild. The board consumer already recognizes this constraint at `inputs/board-contract.md:585-597`, retaining its schemas and turning behavior off.

Fix: state the last compatible binary boundary and a rollback procedure that retains new schemas, decoders and reducers. Specify how to disable the web listener and alert sending, and what happens to pending attempts, without deleting events or restoring a stale database. If rollback requires a corrective forward build, say so and provide the recovery steps.

### m3. MINOR — Design. The planned user-interface tests are outside the current test inventory.

Scenario: web and viewer tests are added at the stated paths, but the root test command never discovers them.

Evidence: `plan.md:549-558` and `plan.md:598-600` name new web and viewer tests, mostly ending in `.tsx`. The existing `vitest.config.ts:4` lists six packages without either new package, and lines 23-26 include only `.ts` tests. The global environment is Node.js at line 8. The lead's setup step at `plan.md:204-205` names packages, dependencies and scopes but does not assign this test-runner integration.

Fix: assign registration of both projects, TypeScript JSX test discovery and the web tests' browser or document environment to the lead's setup change. Assign the separate Playwright configuration and invocation too. Verify discovered test names in the root verification workflow. This is an inventory gap, not an allegation that future tests were not run.

## Risk register

Each score is severity × fallout × probability. The decision is unset because acceptance, deferral and priority overrides belong to the owner. All entries below confirm plan or current-code evidence. Closing evidence is pending for every row; none has an accepted-risk expiry.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Owner role | Decision | Deadline |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | 6: core agent actions stop working until corrected. | 5: restoring operation needs a corrected engine build. | 10: ordinary start, stop and answer paths use these hooks if E3 is followed literally. | 300, fix before release. | Confirmed. | Shared engine builder. | Unset. | Before the next release to real users. |
| A2 | 6: the promised filtered client stream is wrong. | 3: one owner's client can recover with a corrected client. | 8: filtered subscriptions and mobile reconnects are common paths. | 144, schedule. | Confirmed. | Client library builder. | Unset. | Within this phase, or a dated follow-up with an owner. |
| A3 | 6: an older client's live stream terminates on a new event. | 3: updating the client restores operation. | 8: mixed client and server versions are a common deployment path. | 144, schedule. | Confirmed. | Contracts and client library builders. | Unset. | Within this phase, or a dated follow-up with an owner. |
| A6 | 6: valid threads cannot be transported under the stated budget. | 3: the owner can use the terminal while the web path is corrected. | 8: large tool outputs or ordinary full pages are common in active coding work. | 144, schedule. | Confirmed. | Contracts, reads and web transport builders. | Unset. | Within this phase, or a dated follow-up with an owner. |
| A4 | 6: an owner wait can report completion while work remains. | 3: the owner can inspect state and wait again. | 6: attachment during a held queue or nonblocking wait is an ordinary specific action. | 108, schedule. | Confirmed. | Shared engine and client reads builders. | Unset. | Within this phase, or a dated follow-up with an owner. |
| A5 | 6: a terminal wait can hang indefinitely. | 3: the owner can cancel it and inspect the agent. | 6: waiting on a stopped or paused agent is an ordinary specific action. | 108, schedule. | Confirmed. | Contracts, client helper and command-line builders. | Unset. | Within this phase, or a dated follow-up with an owner. |
| A8 | 6: the promised board notification and answer flow cannot complete. | 3: the owner can answer through board commands in the terminal. | 6: an owner-addressed board question is an ordinary specific action. | 108, schedule. | Confirmed. | Client page and board integration builders. | Unset. | Within this phase, or a dated follow-up with an owner. |
| A7 | 6: a required owner notification can be lost under one recovery choice. | 3: the durable in-app alert remains available. | 4: a service failure during the external send is one rare fault. | 72, schedule. | Confirmed contract gap. | Alert sender builder. | Unset. | Within this phase, or a dated follow-up with an owner. |
| m1 | 2: an export omits queued-message history while the log retains it. | 3: the owner can inspect the full view or export after a fix. | 8: prompt and board deliveries are common paths. | 48, record. | Confirmed. | Paged thread-read builder. | Unset. | Review at the end of this phase. |
| m2 | 4: a mistaken downgrade interrupts service until the newer binary is restored. | 3: restoring the compatible binary repairs it. | 4: rollback follows one rare operational fault. | 48, record. | Confirmed missing procedure. | Lead and release builder. | Unset. | Review at the end of this phase. |
| m3 | 1: test discovery is a tooling gap. | 1: development only. | 10: the current root configuration excludes these paths. | 10, record. | Confirmed. | Lead and user-interface builders. | Unset. | Review at the end of this phase. |

## Proposed post-build checks

1. Preserve the actual lifecycle side effects through E3. Observe runner start, stop, reload, queued dispatch and permission delivery, as well as receipts and log rows. A replayed request must not execute those effects twice. Evidence should include the unchanged lifecycle, permission-routing and receipt suites.

2. Connect through the public client library, subscribe with a filter, receive a checkpoint, drop the transport and resume. Inspect the wire command name, retained filters and resumed cursor. Run an older decoding group against a newer server event, followed by a known event. The unknown event must not end the stream or stall the cursor.

3. Compare owner and agent wait outcomes from the same sequence for preexisting queued and sent deliveries, open nonblocking waits, requests held for other agents, a roles capacity hold, and board conditions. Exercise terminal states and any/all separately. Evidence must show the expected terminal reason and exit code, not only a settled boolean.

4. Exercise snapshot capture while writers commit, and verify current read rights through a three-generation pause and recovery. Check that a client refreshes newly readable state when rights expand and stops receiving restricted data when they contract. Preserve L29's current-view rule; this is a synchronization check, not a request for wider rights.

5. Measure encoded web messages for long tool output, a full thread page, all snapshot sections and batched stream chunks. Read an oversized event already in an old log. The chosen size policy must yield complete recoverable data or a specified actionable response, without a reconnect loop at one sequence.

6. Inject service death around carrier acceptance and local success recording. Restart during backoff too. Show the selected delivery guarantee, bounded attempts and durable recovery. Separately open an owner-addressed board alert on the phone, read its subject, reply, and verify that its original post and alert close.

7. Rebuild a migrated database containing owner, agent, device, service-with-rule and piece envelopes. Compare live, catch-up and paged envelopes. Then perform the documented rollback or disable procedure without removing log records. Compare the owner's paged thread with the engine thread view, including queued deliveries.

8. Build the production browser bundle and start the pane viewer. Confirm the browser path does not import the Unix identity or socket implementations. List and run the new web and viewer tests from the root workflow, plus the separate browser end-to-end suite.

9. Keep the plan's host checks on the actual deployment: direct loopback, a real browser from another origin, missing Origin on an upgrade, proxy-preserved and proxy-rewritten Host, forged forwarded headers, the owner's process visibility settings, and a real phone. Evidence should distinguish the automated checks from the owner-run phone and proxy checks.

## Noted, not filed

- The open web server, deferred pairing, absence of a separate Unix user, ability to redirect alert settings and documented process-guard bypasses are accepted owner decisions. They are not new findings. The approved SECURITY.md and AGENTS.md changes are part of this review's baseline.
- The refreshed row 90 and criteria 5.4 and 10.1 address the public-Origin/proxy-Host mismatch. No finding relies on the superseded wording.
- The new scopes, vendor allowance, epic wording and issue/feature-list updates are already assigned known gaps. This reviewer has not edited those lists.
- E1 and E2's explicit command and access tables fit both consumers. E4's read distinction accommodates the board's read marking. E5 and E6's event and view extensions fit their folds. E7's namespaced tables are reasonable, subject to the rollback documentation above. E8 preserves the binding distinction between read and management rights. E9 needs A4 and A6. E10 needs A5 and the existing parity checks. E11 and E12 explicitly preserve caller and device information across all reads. E13's per-service allow lists and in-process entry point fit the roles consumer. E14 through E18 provide the permission, source and delivery checks the consumers require, subject to preserving A1's permission effect. E19 needs A4 and A5. E20 supplies the board's incoming condition. E21 needs m1. E22 exposes computation without a writer. E23's namespace-checked batches and level reactors match the board and roles' stated use. No additional confirmed shared-contract defect was found in those other provisions.
- Release sequencing correctly puts the shared engine units and their existing tests before consumer implementation. The owner mock gate and owner-run phone check remain necessary; they are not evidence that already exists.
- Current library and service documentation was consulted through Context7 for Effect, Caddy, ntfy and Ink. Context7's Effect results did not establish the precise RPC decoder behavior, so the installed 4.0.5 source and official source above were inspected. The cited static-server and browser-socket symbols exist in the installed version. An initial source lookup used a nonexistent `unstable/` directory; the lookup was corrected to the installed `src/http`, `src/socket` and `src/rpc` paths. An official static-server source fetch returned a cache miss, so only its installed API was confirmed; real static routing remains a post-build check.
- The official [Caddy reverse-proxy documentation](https://github.com/caddyserver/website/blob/master/src/docs/markdown/caddyfile/directives/reverse_proxy.md), checked through Context7 on 2026-11-03, documents forwarded-header handling and WebSocket proxying. It supports the proposed approach but does not replace PB-2's test of the owner's proxy configuration.
- The official [ntfy publishing documentation](https://github.com/binwiederhier/ntfy/blob/main/docs/publish.md), checked through Context7 on 2026-11-03, supports the publishing and click-link approach. Its message-update facilities do not by themselves establish the currently unspecified recovery guarantee in A7. The official [Ink documentation](https://github.com/vadimdemedes/ink/blob/master/readme.md), checked the same way, supports the proposed renderer and separate testing library.
- Node.js 26.13.0 was selected with `nvm use`. The focused schema and encoded-size probes described above ran without creating files. They are not a full engine regression run or an implementation test. Some broad text reads exceeded the tool's output budget; the relevant evidence ranges were read separately. No source files, tests, dependencies or repository documentation were changed, and no scratch directory was created.
