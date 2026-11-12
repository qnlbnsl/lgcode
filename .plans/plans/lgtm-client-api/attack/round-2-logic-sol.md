revise
Grade: 5  B/M/m: 1/2/1  Flags: none

## Scope and evidence

This is the round 2 logic and failure-policy review of client API contract v8 and its plan. Repository code was checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. References to `contract.md`, `plan.md`, `decisions.md` and `attack/` are relative to the reviewed `lgtm-client-api/` folder. References to `inputs/` are relative to its parent review folder. Other paths are relative to the recorded checkout.

The review checked the round 1 blocker and major folds, edits E1 through E28, and the supplied board and roles consumers. The supplied board contract identifies itself as v7 at `inputs/board-contract.md:3`, despite the task's v8 label. Its older wording was treated under the lead's explicit lag allowance in `inputs/rulings.md:45`. No finding below depends on that version lag.

The security findings are recorded for the lead and manager under team rule 8. This review does not reopen the owner's choices about authentication, a separate Unix user, or web access to carrier settings.

## Findings

### R2-L1. BLOCKER — Runtime secret collection can delete a secret whose account transaction has not committed

Category: Security (integrity), Design.
Evidence status: Confirmed missing serialization policy, with an isolated probe of the existing store.
Responsible builder: Unit 1b, edit E27, with unit 6b's token-clear worker.

E27 moves the existing global collector and explicitly calls it from the alert worker after a token is cleared (`contract.md:1818-1832`). It says there is no behavior change for accounts (`contract.md:1834`). That claim misses a new concurrency boundary.

The existing account secret planner deliberately stores a fresh value before committing its reference (`packages/engine/src/commands/accounts.ts:42-48`). Account commands run inside the log writer transaction (`packages/engine/src/commands/CommandHandler.ts:201`, `packages/engine/src/commands/CommandHandler.ts:260-269`). The collector, however, reads references from the currently published account views and then calls `retainOnly` (`packages/engine/src/recovery/restart.ts:140-147`). The secret store's semaphore orders file operations, but does not include the account's later database commit (`packages/engine/src/accounts/SecretStore.ts:49-63`).

The new runtime call permits this sequence:

1. A carrier clear triggers collection. The collector reads a keep set before account secret S has committed.
2. An `accounts set-secret` transaction stores S. Its account event has not committed or published yet.
3. Collection acquires the secret-store semaphore after the put and deletes S, because its keep set does not include S.
4. The account transaction commits its reference to S. The stored account now refers to a missing credential.

Collection can also read its stale keep set after the put and before publication. The two paths have the same outcome. A restart cannot reconstruct the value, because the log intentionally stores only the reference. The existing startup-only collection avoids concurrent client commands; the new alert worker call removes that protection.

| Collection context | A put-to-reference-commit gap can coexist | Result with the existing collector |
| --- | --- | --- |
| Startup recovery before serving commands | No concurrent client account command | Existing startup policy is sufficient for this case. |
| Runtime, serialized with the writer through reading the keep set and retaining values | No | The new reference is either visible or its put has not begun. |
| Runtime, protected only by the secret-store semaphore | Yes | A successful put can be deleted before its reference commits. |

The isolated probe loaded the recorded `accounts/SecretStore.ts`, put a synthetic reference, retained a pre-commit empty keep set, and then resolved the reference. Resolution returned absent. The reference-commit step was modeled, rather than executed through a database. This proves that the store's lock does not protect the proposed sequence; it is not an integration test of unbuilt E27.

Suggested fix: make the engine's runtime collection helper hold the log writer permit from reading the views through `retainOnly`, using the same writer-then-secret-store lock order as account commands. Alternatively, remove only the cleared carrier slot through a dedicated safe operation and retain global collection at startup. State this rule in E27 and name a runtime account-secret race test in addition to the existing restart test. The piece should call the engine helper rather than import the writer around E23's boundary.

### R2-L2. MAJOR — An oversized state event advances the page's cursor without repairing its current picture

Category: Bug (failures), Design.
Evidence status: Confirmed contract gap, with a probe of the recorded reducer.
Responsible builder: Units 2, 3 and 7a.

Every event over 256 KiB is replaced by an oversized marker, and the stream cursor moves past it (`contract.md:964-971`). The web page uses that stream (`plan.md:650`). Its stated recovery is loading the event on a tap in the thread view (`plan.md:635`).

That policy is sufficient for lazy conversation content. It is not sufficient for events that create or update the current roster, requests or other state. An existing `AgentStarted` event includes its whole first prompt (`packages/contracts/src/events.ts:89-102`; `packages/engine/src/commands/start.ts:42-46`). A 300 KiB first prompt is below the new inbound limit but puts that event above the marker threshold.

Concrete case: the page takes a snapshot, and another client starts an agent with that prompt. The page receives a marker instead of `AgentStarted`, advances its cursor, and receives the later session and lifecycle events. The engine's reducer creates an agent only on `AgentStarted`; later events update an existing record (`packages/engine/src/views/apply.ts:175-207`). No automatic roster or snapshot refresh is specified for the marker. The new agent can therefore remain absent from the situation view, even while it needs the owner. Reconnecting from the advanced cursor does not repair the missing event.

A read-only probe applied a start event and session event to the recorded reducer. It then compared that with skipping the start event, as the marker path does. The start envelope encoded to 307,644 bytes. Full application produced one roster entry; skipping the start produced zero. This was a reducer probe, not a built web-page test.

| Oversized event | A cursor advance plus deferred thread tap preserves the current picture |
| --- | --- |
| A thread text or diff item with no other state effect | Yes, if the placeholder remains available. |
| `AgentStarted` with a large first prompt | No. The agent's roster record is missing. |
| `PermissionRequested` with a large description | No. The open-request record and count are missing. |
| A large event without thread membership | No general recovery read is specified; `client.thread` is not a general event lookup. |

Suggested fix: distinguish content placeholders from state repair. On an oversized state event, automatically refresh a coherent snapshot or the affected authoritative read, and specify how its sequence joins the stream. A compact state projection accompanying the marker is another option. Keep lazy thread loading for large content. Add a test in which a second client starts an agent after the page's snapshot and the start event becomes a marker. The situation view must still converge without a tap or reload. Also cover an oversized permission request and an event without a thread.

### R2-L3. MAJOR — Carrier replacement has conflicting pending rules and no generation for an in-flight result

Category: Bug (failures), Design.
Evidence status: Confirmed contradictory delivery policy.
Responsible builder: Unit 6b, with unit 6a's alert view.

The pending predicate requires that an alert have no `AlertDelivered` at all, while its failure budget is reset when the carrier changes (`contract.md:794-798`). A separate rule says that setting a carrier makes every open, non-baseline alert pending once (`contract.md:818-819`; `plan.md:582`). Both rules cannot hold when the alert was delivered to a previous carrier configuration.

For example, deliver an open approval alert to server/topic A, unset the carrier, and later set server/topic B. The first rule suppresses delivery because A's delivered record remains. The second requires a delivery to B. Neither a restart nor the request-id policy resolves which rule wins.

There is also an ordinary in-flight race. A send to A starts. The owner changes the carrier to B. A then accepts and its result is recorded. Attempt events are specified to carry the carrier's name and attempt number, with no configuration revision (`contract.md:751-756`). Both configurations are named `ntfy`. The late result can satisfy the unqualified delivered predicate and suppress B's pending send. The same ambiguity affects which configuration owns an attempt number and its retry deadline.

| Alert open | Delivered to old configuration | Carrier newly set | Required by “no AlertDelivered” | Required by “every open alert” |
| --- | --- | --- | --- | --- |
| Yes | No | Yes | Pending | Pending |
| Yes | Yes | Yes | Not pending | Pending |
| No | Either | Yes | Not pending | Not pending |

Suggested fix: choose one policy explicitly. To keep the stated “every open alert” policy, give carrier settings a durable revision and key pending status, attempts, deadlines and delivered records by alert plus revision. Capture the destination and matching token consistently for one attempt. A late result for A must not complete B's duty. If already delivered alerts intentionally stay suppressed across replacement, amend the opposite promise and still define how old in-flight results and retry counters are handled. Test replacement both after delivery and while a response is held, including across a restart.

This is not the accepted possibility that a phone gets a duplicate, nor the accepted power to redirect alerts. It is an undefined delivery duty after an authorized setting change.

### R2-L4. MINOR — The reserved-device-id check names a factory that receives no device id

Category: Design.
Evidence status: Confirmed mismatch with the recorded code.
Responsible builder: Unit 1b, edit E12.

E12 says that `open-web` is refused as a real device id in `mintDeviceCredential` and “by DeviceAdded's planner” (`contract.md:1424-1426`). At the recorded commit, the factory takes no argument and returns a token and token hash, rather than a device id (`packages/engine/src/identity/devices.ts:12-15`). There is no `DeviceAdded` command planner in the current command inventory (`packages/engine/src/commands/CommandHandler.ts:54`). Device rows are inserted through `sideRows.devices`, where the supplied id is used directly (`packages/engine/src/log/EventLog.ts:202-204`).

The named insertion points therefore do not specify where unit 1b enforces criterion 1.34 before pairing is built. This is limited today because production pairing is deferred.

Suggested fix: name the actual device-row insertion boundary and enforce the reserved id there. If the factory is to receive an id, specify that signature change and its callers. Add a test that attempts a real side-row insertion with the reserved id, rather than testing only a future pairing planner.

## Round 1 blocker and major fold audit

These are design dispositions, not claims that the future tests passed.

| Fold and original findings | Round 2 result |
| --- | --- |
| Row 91: Opus TM-1, blocker | Holds as a planned network boundary. The contract now requires configured client networks, and the proxy example and negative checks are named (`contract.md:1035-1055`; `plan.md:735-736`). The owner's actual proxy remains PB-2. |
| Rows 92-93: Opus TM-2/TM-3 and Sol TM-3 | Holds for the stated other-user and destination policies (`contract.md:301-309`, `contract.md:878-906`). Known same-user bypasses are not re-filed. |
| Row 94: Opus TM-4, Sol TM-1, critic C06 | Startup retention and the computer-side token input are now specified. R2-L1 records the new runtime collection consequence. |
| Row 95: Opus TM-5 | Reviewed as recommended answer E28, as instructed. The pending owner answer is not a finding. |
| Rows 96-97: Opus TM-6/TM-7 and logic LOGIC-14 | The in-process open-web credential and explicit client access/visibility table close the missing paths (`contract.md:985-1014`, `contract.md:1415-1423`). R2-L4 concerns the reserved-id enforcement location. |
| Row 102: architect A1 and logic R1 | Holds. E3 preserves lifecycle hooks and their lanes (`contract.md:1200-1209`). The recorded hooks exist in `commands/start.ts:53`, `commands/stop.ts:20`, `commands/resume.ts:45` and `routing/permissions.ts:49`, under `packages/engine/src/`. |
| Row 103: architect/critic snapshot findings, Sol TM-2, logic R2/LOGIC-4 | Holds. E9 now uses one views value and its own sequence. That addresses the separate publication boundary in `packages/engine/src/views/Views.ts:41-44` and `packages/engine/src/log/EventLog.ts:136-140`. |
| Row 104: architect A4/A5, logic R3/LOGIC-1/LOGIC-2 | Holds as a member policy. The state table includes terminal reasons and reloadability, with deliveries, questions, requests and non-blocking waits supplied (`contract.md:598-653`). The existing member rule is at `packages/engine/src/routing/waits.ts:39-58` and `packages/engine/src/routing/waits.ts:83-95`. |
| Row 105: architect A6 and critic C03 | The inbound/page distinction closes the impossible universal size bound. The new marker policy leaves the state-repair gap in R2-L2. |
| Row 106: architect A7, critic C07, logic R4/LOGIC-5 | Crash duplication, bounded attempts and durable backoff are now decided. R2-L3 covers the unhandled interaction with carrier replacement. |
| Row 107: logic LOGIC-3 | The current-view closing table supplies the missing stop, crash and account remedies (`contract.md:765-786`). The stopped-asker engine gap is already known and not re-filed. |
| Row 108: logic LOGIC-6/LOGIC-7/LOGIC-8 | Recovery gating, first-start baseline, refusal position and write-failure behavior are now named (`contract.md:198-226`, `contract.md:1744-1755`). Verify crash cuts around baseline creation as proposed below. |
| Row 109: architect A2/A3 and critic C04/C05 | E24 names per-tag stream dispatch and E25 moves tolerance to the decoding boundary (`contract.md:1769-1795`). The recorded client routes all streams to subscribe at `packages/client/src/index.ts:199` and `packages/client/src/index.ts:218-219`, so both edits are necessary. |
| Row 110: critic C08 | E26 supplies a browser entry and a Node-free core (`contract.md:1797-1814`). Pairing transport remains a future check, as noted below. |
| Row 111: critic C01, Sol TM-4 and logic R5 | The root check now names the real runner. `package.json:12` runs Vitest through `check`; `vitest.config.ts:4` and `vitest.config.ts:26` explain why the lead's added projects and TSX discovery are still required. |
| Row 112: architect A8 | The subject panel has a named owner and board integration test (`contract.md:830-848`). Consumer folding is permitted to lag. |
| Row 121: critic C09 | The widened scope is explicitly a known gap. No new finding. |

## Shared engine edits and consumer audit

| Edits | Logic and failure-policy result |
| --- | --- |
| E1-E2 | The shared group and caller-kind table support the consumers. Access precedes receipts. The existing tests that enumerate names and access are named. |
| E3-E4 | Engine hooks are retained, piece planners have small durable replies, and reads with marks do not persist pages. The named receipt, lifecycle, authorization and read-mark checks fit those changes. |
| E5-E7 | Piece tags have exhaustive keep rows, views rebuild from the log, and piece side tables have namespace ownership. The named state-machine, event, view and migration tests cover the intended changes. |
| E8-E10 | The holder read rule follows L29, and snapshot capture now has a coherent cursor. CLI naming follows the merged group. No extra management right is granted. |
| E11-E14 | Caller/rule/device durability and per-service allowlists support the roles' second permission write and in-process reads. R2-L4 identifies the reserved-id location gap. |
| E15-E18 | Wrapping, own queued withdrawals, projected queue-time reach and transactional send-time reach satisfy the board's delivery needs. A denied send advances to the next item and runs wait checks. The recorded dispatcher reserves inside a transaction before invoking the runner (`packages/engine/src/routing/deliveries.ts:239-259`), so implementation must preserve that boundary. |
| E19-E20 | Input delivery statuses plus the piece view support the board's third hold clause (`inputs/board-contract.md:384-407`). The roles deliberately leave their piece conditions false because capacity work remains queued (`inputs/roles-plan.md:425-429`, `inputs/roles-plan.md:1065`). No shared-contract conflict found in that choice. |
| E21-E22 | The separate thread index addresses the current nested delivery target (`packages/engine/src/views/apply.ts:122-123`). Engine tags are explicitly separated from piece alert tags. Rights helpers compute without granting an extra lifecycle right. |
| E23 | One checked write path supports board level repair and roles first-use records. Refusal writes and progress are now explicit. Preserve same-transaction batch construction and the wait-check projection in implementation. |
| E24-E26 | Dispatch and decoding changes address the actual current client. R2-L2 covers the downstream marker consequence. |
| E27 | R2-L1 covers runtime collection. Startup keep entries alone are insufficient. |
| E28 | The recommended device-answer restrictions have named planner inputs and tests. No finding about their pending approval. |

The contract names existing tests for its declared changes. R2-L1 requires the declaration that accounts are unchanged to be corrected and a runtime concurrency check added. This review did not run the full regression suite for an unbuilt plan.

## Risk register

Scores use severity × fallout × probability. Decisions belong to the owner. The run's existing security deferral applies to R2-L1; the lead should carry that row to the manager.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Owner | Decision | Deadline | Acceptance / closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R2-L2 | 6: the current situation view can omit an active agent or request until repaired manually. | 3: one owner's client; a new snapshot repairs it. | 6: an ordinary large start prompt or request exercises the rule. | 108, schedule | Confirmed design gap; reducer probe | Units 2/3/7a | Not set by reviewer | This phase or dated follow-up with owner | None |
| R2-L3 | 6: an open alert can miss the newly selected destination until manual intervention. | 3: one owner can reset or inspect the client. | 6: an ordinary carrier replacement after a delivery exposes the contradiction; no crash is required. | 108, schedule | Confirmed policy contradiction | Units 6a/6b | Not set by reviewer | This phase or dated follow-up with owner | None |
| R2-L1 | 8: a stored secret value can be permanently deleted while its reference commits. | 3: one owner can restore or replace the external credential. | 4: one runtime collection/account-write overlap exposes the missing serialization. | 96, schedule | Confirmed missing policy; isolated store probe | Units 1b/6b | Existing run-wide security deferral; no new acceptance inferred | Lead to record follow-up under team rule 8 | None |
| R2-L4 | 1: a reserved-id acceptance test currently has no applicable production insertion point named. | 1: internal build correctness until pairing adds a writer. | 2: fixture or future device creation exposes it. | 2, record | Confirmed code mismatch | Unit 1b | Not set by reviewer | End-of-phase review | None |

## Proposed post-build checks

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| LC2-1 | Pause an account secret command after its put and before its event commit. Trigger token-clear collection at both sides of its keep-set read. | A committed reference always resolves; account and carrier values remain separate. | A deterministic barrier test over the real engine collector, account planner and secret store, plus a restart. | Units 1b/6b |
| LC2-2 | While a page is subscribed, another client starts an agent with a 300 KiB prompt, then opens a large permission request. Also send a large non-thread event. | The roster, request list and counts converge without user action; cursors do not skip unrepaired state. | Real encoded frames through the browser client and page, with assertions after reconnect. | Units 2/3/7a |
| LC2-3 | Deliver on A, unset and set B; separately hold A's response while switching to B, then restart. | Delivery follows the chosen revision policy; a result for A cannot satisfy B's duty or spend B's retry budget. | Fake endpoints with controlled responses and durable event/view assertions. | Units 6a/6b |
| LC2-4 | Kill immediately after first-start baseline initialization and between individual baseline alert writes. | Every preexisting open matter appears once as a baseline alert and is never pushed; later matters are pushed. | Restart tests at every cut, including board and roles sources. | Unit 6a |
| LC2-5 | Interleave a read's snapshot, channel removal, mark commit and lost reply; resend the same request id after removal. | Marks never restore access or resurrect membership; the resent read is refused and stores no page text. | Real read/mark path with barriers and the board reducer. | E4/E23 and board reads |
| LC2-6 | Queue a board wake, remove its target's membership, and race dispatcher and board repair. Put another valid delivery behind it. | No denied wake is sent; withdrawal and wait checks agree; the next delivery proceeds in the same pass. Capacity holds still block the whole queue. | Composed board/roles/engine tests using the real send transaction and lanes. | Units 1b and consumer integration |
| LC2-7 | Keep a remote WebSocket open while proxy mode or allowed networks are tightened at the computer. | Existing connections follow an explicitly documented policy; turning the web server off closes them immediately. | Real connection test and a settings-change trace. | Units 5/10 |
| LC2-8 | Insert a real device side row using the reserved id. | The durable insertion is refused, independently of credential token minting. | Database/side-row test, not only a factory stub. | Unit 1b |

## Noted, not filed

- The known-gap list was respected. Authentication, own-user separation, persistent settings exposed to the open web server, duplicate push delivery, stopped askers, proxy-specific behavior and ntfy server configuration are not new findings.
- E28 was reviewed as the recommended answer to question 6. No approval was requested again.
- Board incoming and hold-unsettled deliberately differ. Reading an incoming question can settle its addressee, while a blocking wait must still give way to that incoming duty. The author remains held by its open post.
- The ntfy sequence-id and deletion mechanism is documented by the provider. It does not make sends atomic with the log. This was checked on 2026-11-03 against [ntfy publishing documentation](https://docs.ntfy.sh/publish/#updating-deleting-notifications). The owner's installed version remains PB-5.
- The revised Caddy assumptions match its documented default forwarding behavior and interface binding. Checked on 2026-11-03 against [reverse proxy defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults) and [bind](https://caddyserver.com/docs/caddyfile/directives/bind). The actual installation still needs PB-2.
- Effect documentation was consulted through Context7, and the pinned 4.0.5 source was read for RPC chunk decoding, group merging and the browser constructor. Its browser constructor rejects custom handshake-header options (`effect/src/socket/Socket.ts:870-890` in the installed 4.0.5 dependency). An empty credential module can work now, but the later pairing plan must choose a browser-supported credential mechanism. Pairing is deferred, so this is not filed as a current failure.
- No repository file was edited, committed or pushed. The repository was clean at the final status check. The assigned scratch folder was removed.
- Probe execution initially failed because the isolated checkout could not resolve the engine's `@lgtm/contracts` package link. For the secret-store probe, the retry stubbed only the imported, unexercised log-error class and loaded the unchanged store. The reducer probe mapped the contracts import to this recorded checkout's contracts source. Both probes then completed. Neither probe is presented as an application integration test or as proof that the planned implementation exists.
