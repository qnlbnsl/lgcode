revise
Grade: 6  B/M/m: 0/9/4  Flags: none

# Review scope and evidence

This is round 1 through the plan-critic lens. Repository claims were checked in the read-only checkout at 8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5. In this report, plan.md, contract.md, decisions.md and scouting.md mean the supplied shepherd-client-api review copies. Paths beginning inputs/ mean the sibling review inputs directory.

I reread the refreshed plan material, including decision 90 and criteria 5.4 and 10.1. The owner-approved open server, deferred pairing, deferred Unix user, and three computer-only actions are binding decisions, not findings. The supplied known-gaps.md exclusions are respected.

# Findings

## C01. MAJOR. The main engine gate runs no tests, and the new interface tests have no discovery task.

Category: Design; verification. Evidence status: confirmed. Responsible builder: client API planner and the lead's build-preparation unit.

Scenario: a unit changes authorization or delivery behavior and runs criterion 1.1's prescribed command. It exits successfully without exercising the engine. Later, the web and viewer builders use the prescribed root Vitest invocation, which cannot discover their test files.

Evidence: plan.md:250 and plan.md:266 prescribe pnpm -r test as the engine, acceptance and rebuild gate. I ran that exact command under Node.js v26.13.0. It exited 0 and printed only "Scope: 11 of 12 workspace projects". The test script is at the workspace root, package.json:12; packages/engine/package.json, packages/contracts/package.json, packages/client/package.json and packages/cli/package.json define typecheck but no test script. This agrees with the consumer plan's explicit warning at inputs/roles-plan.md:319.

The second half is independently visible at vitest.config.ts:4 and vitest.config.ts:26: the root projects omit web and viewer, and their includes accept .ts, not .tsx. Plan.md:234 prescribes root Vitest path invocations, while plan.md:550 and plan.md:598 depend on tests in those new packages, including .test.tsx files. Neither the tasks nor the lead's preparation decision at decisions.md:60 assigns the root test configuration and browser-test environment.

Fix: use the root test/check script or an explicit root Vitest command that actually discovers the engine and acceptance suites. Assign the lead or a named unit the new test projects, TSX discovery, browser-test setup and Playwright configuration. Require discovery output for each new package. The retrospective command above is a probe of the proposed gate; the plan does not claim it already ran a passing suite, so this is not an unverified-claim flag.

## C02. MAJOR. A database read transaction cannot make the live views and their cursor atomic.

Category: Design; timing. Evidence status: confirmed. Responsible builder: units 1a and 3.

Scenario: a snapshot reads durable head H, another transaction publishes H+1 to the live views, and the snapshot then reads those views. It returns state at H+1 with cursor H. The reverse mismatch is possible between database commit and publication. Applying the stream can then duplicate an effect or omit one.

Evidence: contract.md:947 says the snapshot reads the views and log head "in one read transaction" and concludes they agree. The views are an in-memory Ref, not database tables: packages/engine/src/views/Views.ts:41 and :43. Database commit precedes applying the batch to that Ref: packages/engine/src/log/EventLog.ts:261 and :266. Existing comparison code explicitly captures the head and live views under the writer permit, packages/engine/src/views/compare.ts:63. Criterion 3.1, plan.md:391, does not state a concurrent-commit scenario.

Fix: specify one immutable Views.snapshot together with that state's own sequence, or a short writer-permit capture following compareViews. Do expensive reply construction after capture. Add a controlled interleaving test around both sides of commit/publication. This changes the capture policy, not the owner's snapshot-and-subscribe decision.

## C03. MAJOR. The universal 1 MiB acceptance criterion has no finite engine or whole-snapshot bound.

Category: Design; capacity and acceptance feasibility. Evidence status: confirmed. Responsible builder: units 1a, 2, 3 and 5.

Scenario: a legitimate file diff is larger than 1 MiB, a thread page contains 500 moderate tool outputs, or the roster and open requests make the complete snapshot large. The plan's declared maximum-size test cannot satisfy its assertion merely because the board and roles sections fit separately.

Evidence: plan.md:356 requires every largest event and page plus envelope to fit. Contract.md:694 promises the same, but supplies numerical maxima only for the board. Contract.md:495 limits client.thread by event count only; contract.md:365 lists an unpaged snapshot with agents, requests, questions and alerts. Existing engine thread text, tool input/output and diffs have unrestricted string schemas at packages/contracts/src/events.ts:61-76; the runner translates raw output and diffs without a wire-size budget at packages/engine/src/runner/translate.ts:28-41. The bounded consumer sections, inputs/board-contract.md:454 and inputs/roles-plan.md:418, do not bound the complete response.

Fix: distinguish the inbound frame limit from outbound response policy. Either narrow criterion 2.6 to the bound actually required, or define an encoded-byte budget and continuation/chunking policy for complete responses and an oversized single item, including old log items. Preserve all thread content and cursor progress. Test real encoded RPC frames, including chunk wrappers and escaping, rather than adding constants for section maxima.

## C04. MAJOR. The shared client's stream dispatcher still invokes subscribe for every streaming command.

Category: Design; functional correctness. Evidence status: confirmed. Responsible builder: units 1a/2/3, with an explicit shared-client edit.

Scenario: a terminal client calls client.subscribe with a group filter. Its exported method invokes the engine's subscribe RPC, so it never calls the filtered handler and never receives its checkpoints. A server-only filtered-stream test can pass while this client flow remains broken.

Evidence: packages/client/src/index.ts:218 assigns the same subscribe function to every streaming RPC. That function calls connection.client.subscribe at :199, irrespective of the requested tag. Plan.md:364 names unknown-event decoding in this helper, but plan.md:403 assigns the filtered-stream work only to engine handlers. Contract section 6 does not name a tag-aware stream-dispatch edit or its reconnect coverage. Criterion 3.4 at plan.md:394 names only an engine test.

Fix: explicitly make the reconnecting stream helper accept the RPC tag and preserve that tag, filter, cursor and request-id policy across reconnects. Name the shared-client edit in the contract and add a test through the public packages/client entry point, with both subscribe and client.subscribe active.

## C05. MAJOR. Unknown-event handling is assigned after the existing typed RPC decoder would reject the event.

Category: Design; compatibility. Evidence status: confirmed. Responsible builder: unit 2 and the browser client unit.

Scenario: a web bundle built before board events exist receives a board event through the owner's stream. The proposed helper cannot record an unknown event and advance its cursor if schema decoding has already failed below it.

Evidence: contract.md:507 requires envelope-first tolerant decoding, while E5 preserves one strict EventEnvelope schema at contract.md:848. The existing client constructs RpcClient.make(CommandsRpcGroup), packages/client/src/index.ts:97. Its stream success schema is EventEnvelope, packages/contracts/src/commands.ts:132-133; EventEnvelope embeds the closed Event union, packages/contracts/src/events.ts:191. The plan assigns the change to the subscribe helper at plan.md:364 without specifying a different wire codec or decoder boundary.

Current official Effect source, checked 2026-11-03, builds decodeChunk from the RPC's success schema and decodes chunks before dispatching them to the application: [RpcClient.ts](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/rpc/RpcClient.ts). That supports the boundary concern; it is not a claim that local dependencies were installed or executed in this review.

Fix: define the tolerant client wire-envelope codec separately from the strict event schema used for persisted log validation. Name where the tag is inspected and where known payloads are validated. Cover an actual encoded unknown event through the RPC protocol into an older client, followed by a known event and a reconnect; a helper test handed an already-decoded object is insufficient.

## C06. MAJOR. Startup garbage collection deletes a standalone ntfy token, and no supported provisioning path is named.

Category: Design; failures. Evidence status: confirmed. Responsible builder: unit 6b and an explicitly named engine recovery edit.

Scenario: the owner configures an authenticated ntfy server with a token stored by reference. On the next normal restart, account-only secret collection removes that token. Alert delivery then fails until the owner restores it.

Evidence: plan.md:510 and plan.md:520 require the ntfy token to come from the existing secrets store by reference. Contract.md:651 makes it an alert setting, separate from accounts. At 8ff4c9b, packages/engine/src/recovery/restart.ts:139-147 retains only references reachable from account.secret or account.environment. Packages/engine/src/accounts/SecretStore.ts:51-54 removes all other values from the persistent file. The existing R22 regression pins this account-only behavior at packages/engine/test/recovery/restart.test.ts:606-626. No E1-E23 edit or WS-6 task extends retention. The current secret-setting command also requires an account and attaches the generated reference to its environment, packages/engine/src/commands/accounts.ts:38-48; it is not a general alert-secret setter.

Fix: explicitly define how the owner supplies/replaces an alert token without putting its raw value into events or ordinary settings, and include live alert-secret references in startup retention. Name the recovery file and R22 in the existing-test change inventory. Verify the current token survives restart, a replaced token can be collected, and an account removal does not break alerts.

## C07. MAJOR. The plan promises exactly-once phone delivery without choosing a crash-window policy.

Category: Design; durable recovery. Evidence status: confirmed. Responsible builder: unit 6b.

Scenario: ntfy accepts a notification, but the service dies before writing AlertDelivered, or the HTTP response is lost. Retrying may notify twice. Treating the attempt as delivered before publishing can lose a notification. Recording AlertRaised exactly once does not resolve this external side-effect ambiguity.

Evidence: plan.md:163-164 says the alert record prevents both lost and duplicate sends across restart, and plan.md:528 cites criterion 6.3 as mitigation. Criterion 6.3 at plan.md:504 tests event-to-alert creation, not an outbound send. Contract.md:607-613 specifies per-attempt results but no stable remote identity, uncertain-result policy, or recovery of an interrupted attempt. Plan.md:512 says only "backoff a bounded number of times", without defining the budget or its durability.

The current [ntfy publishing documentation](https://docs.ntfy.sh/publish/), checked 2026-11-03, describes ordinary publish requests and separate sequence identifiers for notification updates. The contract chooses neither a sequence-id mechanism nor a tested delivery guarantee. An update identifier must not simply be assumed to prove exactly-once delivery.

Fix: choose and state the delivery guarantee, including uncertain outcomes, durable attempt counts, retry exhaustion and recovery after restart. At-least-once delivery with possible duplicates is a straightforward option if the owner accepts that product behavior. If stronger behavior is required, pin and test the carrier mechanism that supplies it. Extend the fake-carrier tests to kill the service before send, after remote acceptance, and before local delivery-result commit.

## C08. MAJOR. The chosen shared client is Node-only, but the browser adaptation has no assigned task.

Category: Design; build feasibility. Evidence status: confirmed. Responsible builder: unit 7a, with a named shared-client task.

Scenario: the web builder follows decision 45 and imports packages/client into the Vite browser application. Its entry point loads Node socket and filesystem identity code, and its connection options cannot describe a web URL. The planned browser connection cannot use that implementation as specified.

Evidence: decisions.md:53 says the page talks through packages/client over a browser WebSocket. The current root imports node:crypto and @effect/platform-node/NodeSocket at packages/client/src/index.ts:1-3 and imports identity/socket checks at :19-22. ConnectOptions requires an Environment at :32, and connect resolves a local credential, checks a socket file and constructs ws+unix at :120-138. Plan.md:564 instead names a browser RpcClient and global WebSocket, but assigns no browser entry point or extraction of the shared transport-independent code.

Fix: reconcile these two choices explicitly. Assign a browser-safe client entry point or a browser client implementation with the shared types, tolerant decoder, retry and cursor policy. Keep the existing local client entry point for the pane viewer. Add a production browser-build and real-browser connection acceptance step; Node imports must not be hidden by browser shims that cannot perform Unix-socket identity checks.

## C09. MAJOR. The VS Code scope exclusion lacks the required owner quote or an open WIDENED row.

Category: Design; scope traceability. Evidence status: confirmed. Responsible builder: client API planner.

Evidence: decisions.md:59 closes row 51, excluding the VS Code extension, because epic row 2 does not name one. Plan.md:751 marks the feature out of scope on that row. The row gives no dated owner quote for excluding this item. The required plan-critic scope rule and gate 1 require that evidence, or an explicitly open WIDENED rule. This is a documentation gate finding, not an assertion that an editor extension should be built. The board-specific exception in inputs/rulings.md for an already marked WIDENED board exclusion does not establish this row's lineage.

Fix: cite the existing owner-approved in/out scope decision if it covers this exclusion. Otherwise mark the row WIDENED and open for the scope confirmation required by the review rules. Do not infer owner approval merely from omission.

## C10. MINOR. The contract gives reads' marks two different callers.

Category: Design; consistency. Evidence status: confirmed. Responsible builder: unit 1b.

Evidence: contract.md:975-977 says the piece caller is written by reactors and reads' marks. In contrast, E4 at contract.md:833-835 and the E23 table at contract.md:1270 require reads' marks to use the calling caller. The board consumer follows the latter rule at inputs/board-contract.md:429. Builders could produce different audit attribution depending on which paragraph they implement.

Fix: remove reads' marks from E11's piece-caller sentence. Test marks under an owner, device and agent, preserving the device field.

## C11. MINOR. Refusal acceptance criteria contradict the required refusal event.

Category: Design; acceptance clarity. Evidence status: confirmed. Responsible builder: unit 1b.

Evidence: plan.md:297 and contract.md:1286-1288 require that invalid fixture batches write "nothing". Contract.md:1273-1277 requires a CommandRefused for a refused planner or reactor batch. The existing planner refusal path already writes that event at packages/engine/src/commands/CommandHandler.ts:264.

Fix: specify "no requested piece events, deliveries, marks or side rows commit", and state which refusal/audit event and receipt are expected for each of planner, read and reactor failures. The test should assert the exact allowed writes.

## C12. MINOR. The claimed unchanged access to debug.compare-views does not match device behavior.

Category: Design; compatibility. Evidence status: confirmed. Responsible builder: units 1a and 1b.

Evidence: contract.md:306-309 says debug.compare-views is owner-only "which includes devices"; E2 at contract.md:762-773 says this preserves today's access. In the actual read handler, packages/engine/src/api/server.ts:163-165 allows only credential._tag === "owner", so a device is refused even in a debug-enabled service. Criterion 1.4 at plan.md:269 therefore cannot both preserve today's answer and follow the contract's stated device rule.

Fix: explicitly choose whether this diagnostic remains terminal-owner-only or gains device access in debug mode. Record a behavior change if access expands, preserve production omission of the debug group, and name the device regression alongside packages/engine/test/api/compare-views-rpc.test.ts.

## C13. MINOR. The board alert target still promises a post while the folded design offers only a thread target.

Category: Design; consumer contract consistency. Evidence status: confirmed. Responsible builder: client API planner and board planner.

Evidence: contract.md:570-575 and contract.md:1344 promise that a board.post alert opens its post. The folded rule at contract.md:647-650 builds only a link to the agent's thread, matching the owner's choice in inputs/client-api-design.md:84. The page acceptance at plan.md:557 covers only that thread link. The board still expects a post subject and post closure at inputs/board-contract.md:284-288.

Fix: reconcile the consumer text with the owner's thread-opening choice. State how the post subject remains available from that thread, or explicitly assign the board's owner-reading/reply flow to a later named unit. A board question must not be mistaken for an engine permission/question answer. This does not request signed links or link-triggered commands.

# Risk register

Scores use severity × fallout × probability. Decisions remain for the owner/lead. No finding is marked accepted by this reviewer.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Owner | Decision and deadline |
|---|---|---|---|---|---|---|---|
| C01 | Required verification gate | Not scored | The proposed command was exercised | Required gate correction | Confirmed | Planner and preparation lead | Open; before the affected unit merges |
| C06 | 6: alerts need manual credential repair | 3: owner can reconfigure | 10: normal restart with an alert-only token | 180; fix before release | Confirmed | Unit 6b and recovery builder | Open; before release |
| C08 | 6: browser connection cannot use the chosen client | 3: corrected client build repairs it | 10: normal browser build/import | 180; fix before release | Confirmed | Unit 7a | Open; before release |
| C04 | 4: filtering/cursor behavior is wrong | 3: corrected client repairs it | 10: every filtered call through the current wrapper | 120; schedule | Confirmed | Shared-client builder | Open; within this phase |
| C03 | 6: a valid response defeats the promised read contract | 3: owner can reduce the read once a policy exists | 6: ordinary larger histories/output | 108; schedule | Confirmed | Units 2, 3 and 5 | Open; within this phase |
| C05 | 6: an older page's stream stops | 3: a compatible build repairs it | 6: ordinary staged server/client upgrade | 108; schedule | Confirmed | Unit 2 | Open; within this phase |
| C02 | 6: snapshot state may need resynchronization | 3: a new snapshot repairs it | 4: one concurrent commit interleaving | 72; schedule | Confirmed | Units 1a and 3 | Open; within this phase |
| C07 | 6: a required phone alert can need manual attention | 3: alert remains reachable in the application | 4: one lost response or process failure | 72; schedule | Confirmed | Unit 6b | Open; within this phase |
| C13 | 2: alert opens a different context than promised | 3: owner can locate the post through the API | 6: ordinary board owner-question alert | 36; record | Confirmed | Client API and board planners | Open; phase-end review |
| C12 | 2: diagnostic access differs from the specification | 3: terminal diagnostic remains available | 2: debug-only device setup | 12; record | Confirmed | Unit 1a | Open; phase-end review |
| C09 | 1: scope approval evidence is missing | 1: planning only | 10: the closed row always lacks the quote | 10; record, with a scope gate to satisfy | Confirmed | Planner | Open; scope gate before acceptance |
| C10 | 1: conflicting audit specification before implementation | 1: planning only | 10: both instructions are present | 10; record | Confirmed | Unit 1b | Open; phase-end review |
| C11 | 1: incompatible test expectation | 1: development only | 10: the literal assertion contradicts the refusal rule | 10; record | Confirmed | Unit 1b | Open; phase-end review |

# Shared engine edit and consumer audit

All 23 named edits were checked. These are plan-level conclusions, not assertions that future code already works.

| Edit | Current anchor checked | Result against the board and roles consumers |
|---|---|---|
| E1 | packages/contracts/src/commands.ts:44 | The merge point exists. C04 identifies an additional client dispatch edit needed when a second stream is added. |
| E2 | packages/engine/src/commands/CommandHandler.ts:70 | The caller-kind expansion and agent-only planners are identified. C12 records the diagnostic exception. |
| E3 | packages/engine/src/commands/CommandHandler.ts:54 and :269 | Planner dispatch and receipt-reply replacement are explicitly named. The board's id/count replies and roles' classifications have a home. No additional finding. |
| E4 | packages/engine/src/api/server.ts:153 | The two inline reads exist. Board reads with marks are supported; C10 concerns their attribution. |
| E5 | packages/contracts/src/events.ts:88; packages/contracts/test/state-machine.test.ts:285 | The closed union and dynamic lifecycle tests match the proposed piece keep rows. The visibility sample test is named. No additional finding. |
| E6 | packages/engine/src/views/apply.ts:114 and :338 | Initial views, reducers and rebuild coverage are identified. Both consumers supply their views. No additional finding. |
| E7 | packages/engine/src/log/migrations.ts:11; packages/engine/src/log/EventLog.ts:199 | The migration and side-row targets exist. No additional board/roles migration requirement found. |
| E8 | packages/engine/src/api/server.ts:155; packages/engine/src/routing/holders.ts:21 | L29 is incorporated and the changed 7.3 visibility test is named. No new objection to that ruling. |
| E9 | packages/engine/src/views/Views.ts:43; packages/engine/src/views/compare.ts:63 | Both consumer sections have entries, but C02 and C03 require capture and whole-response decisions. |
| E10 | packages/cli/src/commands/registry.ts:10 and :35 | Dotted-name parsing and parity/inventory tests are assigned. No additional finding. |
| E11 | packages/contracts/src/events.ts:8; packages/engine/src/log/EventLog.ts:116 | Keeping Actor separate from Caller suits parent/holder semantics. C10 is the conflicting marks sentence. |
| E12 | packages/engine/src/commands/CommandHandler.ts:205; packages/engine/src/log/subscribe.ts:36 | Durable device identity, old-row decoding and affected log tests are named. No additional finding. |
| E13 | packages/engine/src/api/server.ts:87 | No service wire identity is introduced. The per-service allow-list and prohibition on answer match the roles' needs. The roles plan explicitly adds release later at inputs/roles-plan.md:446-448. No missing shared release edit is filed. |
| E14 | packages/contracts/src/events.ts:132; packages/engine/src/routing/permissions.ts:47 | Widened answer attribution supports the roles' in-transaction matcher. No additional finding. |
| E15 | packages/contracts/src/events.ts:23, :112 and :162; packages/engine/src/routing/envelope.ts:22 | All three sender fields and the renderer are named, including returned piece deliveries. The board's fixed author headers match. |
| E16 | packages/engine/src/routing/deliveries.ts:62 | The piece source/default withdrawal can support board target-stop and crash behavior. No additional finding. |
| E17 | packages/engine/src/routing/holders.ts:57 | Own queued withdrawal is specified and existing move-withdrawal tests are named. No additional finding. |
| E18 | packages/engine/src/routing/deliveries.ts:239 and :259 | Queue-time projection, send-time recheck, withdraw-and-continue and wait recheck match inputs/board-contract.md:143-190. Runtime integration remains a post-build check. |
| E19 | packages/engine/src/routing/waits.ts:33-45 | Delivery statuses and the piece view satisfy the board's three clauses at inputs/board-contract.md:384-407. Roles intentionally need no extra condition, inputs/roles-plan.md:425. |
| E20 | packages/engine/src/routing/waits.ts:83 | The blocking cancellation point matches the board's incoming condition. No additional finding. |
| E21 | packages/engine/src/log/EventLog.ts:175; packages/engine/src/views/apply.ts:122 | The source column exists but omits nested DeliveryQueued targets. Existing issue 31 already records this; see the post-build parity check below. C03 also applies to page sizing. |
| E22 | packages/engine/src/routing/holders.ts:21 and :35 | The pure management helpers exist and the read rule is separately specified. No additional finding. |
| E23 | packages/engine/src/commands/CommandHandler.ts:264 and :269 | The board and roles both use the new batch path. C11 concerns refusal observations; the own-event, reach, wait and no-direct-writer properties need the proposed integration checks. |

The current tests specifically named for changed engine behavior resolve in the checkout. The main missing test story is the executing/discovering gate, and the additional client/recovery changes above, rather than a nonexistent listed engine test. Prospective paths are treated as targets to create, not missing current files.

# Proposed post-build checks

| Id | Scenario | Expected result | Required evidence | Responsible area |
|---|---|---|---|---|
| PC01 | Pause a snapshot between reading its state and cursor while another command commits; repeat around commit/publication. | Snapshot state and sequence agree; applying later events equals full replay, without missing or duplicate changes. | A deterministic barrier test through the snapshot RPC, with the commit interleaving shown. | Engine snapshots |
| PC02 | Call both streams through the public client, filter one, skip many events, drop the connection and reconnect. | Correct RPC tags and filters remain in use; checkpoint and event cursors resume monotonically without gaps. | Captured request tags plus a real protocol integration test, not only a handler unit test. | Shared client |
| PC03 | Run an older browser/client build against a server writing a new namespaced event, then a known event. | Unknown event is recorded and skipped; known events and reconnection still work. Persisted event decoding remains strict. | Encoded RPC traffic into the older bundle and the final cursor. | Client contracts |
| PC04 | Build and serve the production web bundle, then open it in a real browser. | WebSocket connection, snapshot, thread and one command work using the open-web caller. No local filesystem/Unix socket identity path is required. | Browser build output and Playwright run against the production artifact. | Web client |
| PC05 | Configure an ntfy token used by no account; restart, replace it, remove an unrelated account, then restart again. | Current alert credential remains resolvable, replaced credentials follow the chosen collection policy, and secrets enter no event or log. | Persistent-store and real recovery assertions extending R22, plus carrier request verification. | Alerts and recovery |
| PC06 | Kill the process at each remote-send/local-record boundary, lose a success response, and exhaust retries. | Outcomes obey the newly chosen delivery guarantee; attempt budget survives restart; one failed alert does not stop processing others. | Fake ntfy request counts, durable attempt records and reconstructed alert state. | Alert carrier |
| PC07 | Read a 500-event thread with large outputs, an oversized single historical diff, and a large combined snapshot. | The chosen frame/response budget is obeyed with complete content, usable continuations and forward cursor progress. | Encoded RPC byte sizes, response reconstruction and full-log comparison. | Reads and transports |
| PC08 | Build an owner thread from paged reads containing queued, sent, returned and withdrawn deliveries. | Its event membership matches the engine's thread projection, including nested delivery targets. Agent reads still obey the declared visibility rule. | Comparison with packages/engine/src/views/apply.ts:122 and regression coverage for the already recorded issue 31. | Thread reads |
| PC09 | Submit invalid planner, marks and reactor batches; then submit valid ones as owner, device and agent. | No prohibited events or side rows commit; only the specified refusal audit remains; mark and reactor callers differ exactly as E23 requires. | Durable rows, receipts, envelopes and import-boundary results. | Piece batch path |
| PC10 | A board wake loses membership before send; another valid delivery follows it; a waiter depends on the target. | First delivery is withdrawn, second advances in the same pass, and wait checks use the resulting batch. | Real dispatcher, writer transaction and board condition integration. | Engine and board |
| PC11 | Pause/recover the middle of three generations while catch-up and live subscriptions are active. | The effective holder gains and loses the declared read rights; structural-parent reads remain; lifecycle rights do not expand. | L29 tests using current views on both stream phases and roster/thread reads. | Visibility |
| PC12 | Sleep the phone, answer a request from another client, reconnect and attempt the stale action. | The page resumes its cursor, displays the resolved request and handles the refused stale action without implying it succeeded. | Real-browser reconnection and concurrent-client test plus the owner's phone check. | Web page |
| PC13 | Exercise refreshed criteria 5.4/10.1 through the actual proxy and direct loopback route. | Static GET/HEAD works without Origin; upgrades without Origin and foreign origins fail; public names work only in proxy mode; bind remains loopback. | HTTP/upgrade matrix and a browser on the configured proxy address. | Web transport |

# Noted, not filed

- Gates 2, 6 and 8 have useful named tests and source anchors, but require C01-C08's corrections. The required UI mock gate is explicit at plan.md:568 and :610. Workstream risks and a single rollout section are present. Gate 7 is correctly pending this first review; that is not a defect.
- The owner and lead rulings explain direct engine edits, L29 visibility, L30 wait sequencing, and the narrow service path. I found no additional missing board/roles input in E15-E20 after matching their consumer clauses.
- The nine owner design outcomes and the supplied SECURITY.md/AGENTS.md diff were reviewed as approved exceptions. I do not re-file open authentication, agent access to the state folder, or the acknowledged guard bypasses.
- Missing scopes, unknown vendor allowance, the epic's paired-phone wording, and lead-only issue/feature updates remain the supplied known gaps. They are not counted. The plan itself also tells build units to write docs/issues.md at plan.md:238; the lead-only routing in inputs/rulings.md should govern execution.
- Existing issue 31 and issue 164 are not new defects. PC08 tests the new thread reader's reliance on the existing column; it does not request silently widening agent subscriptions.
- Caddy header behavior and the owner's /proc visibility are already PB-2 and PB-4/known gaps. I did not claim either was verified. The refreshed Host/Origin rules no longer require a public browser Origin to masquerade as loopback.
- The plan says E1-E22 in several overview passages but includes E23 in task 1b.8 and the contract's unit split. I treated E23 as assigned, not omitted.
- This checkout has no installed local Effect source at scouting.md's node_modules path. Current official Effect material was consulted for the decoder boundary. The absence of dependencies in this review checkout does not contradict the planner's earlier source reading and is not a finding or flag.
- The only execution probe was nvm use followed by pnpm -r test. The full suite, browser build, carrier fault tests and future acceptance tests were not run. No implementation was changed, no commit or push was made, and no scratch folder was created.
