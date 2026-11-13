ship
Grade: 8  B/M/m: 0/0/1  Flags: none

## Review scope and conclusion

I reviewed the client Application Programming Interface (API) plan, contract version 12, decisions, scouting, binding rulings, approved security changes, known gaps, and the earlier findings and folds. I checked the shared engine edits against commit 8ff4c9b. I checked changes to their implementation sites against commit 9e386b0. Code references below use 8ff4c9b unless they explicitly name 9e386b0.

The five distinct majors from round 3 are addressed. The board contract version 10 and roles plan version 14 agree with the shared boundaries, including the two additions in version 12. I found one minor omission in the instructions for adapting E12 to the newer engine. It does not justify another review round.

This was a plan review and source inspection. I did not build the proposed system, run the engine test suite, or perform attack testing. A small read-only probe confirmed that passing undefined to Effect's Redacted.value throws. That probe was not an end-to-end reproduction of an open-web request.

## Finding R4-TM-1: E12 must also adapt the new stop preflight

Severity: MINOR.
Category: Design.
Responsibility: Access.
Responsible builder: The client API engine builder for unit 1b.
Evidence status: Confirmed omission in the adaptation instructions.

At 8ff4c9b, execute resolves credentials in one place, packages/engine/src/commands/CommandHandler.ts:203. E12 correctly names that location and adds an in-process open-web credential, which has neither a device credential nor an agent token. It expressly requires execute to accept that caller without verification and to preserve its device access kind.

At 9e386b0, packages/engine/src/commands/CommandHandler.ts:202 adds preemptStart. It independently resolves the caller at line 210 before stop waits for the target's lane. execute invokes it before entering its transaction at line 237. The new helper recognizes owner and device credentials, then assumes every remaining credential has an agent token at line 216. E12 names only the original resolution site. Its named changes do not mention this second site.

Scenario: A builder applies the named transaction change when rebasing unit 1b onto 9e386b0, then a web caller stops an agent whose start setup is running. The new open-web variant must also be handled before the stop enters the lane. Leaving the helper unchanged either produces a TypeScript error when the credential union widens, or, if the union is bypassed, reads the missing token and defects before reaching the transaction. Merely skipping preemption for open-web would make this caller wait behind the running setup.

The helper's orElseSucceed at 9e386b0:packages/engine/src/commands/CommandHandler.ts:229 is not a defect fallback. Effect's current version 4 documentation distinguishes typed failures from defects. I checked the official [fallback documentation](https://effect.website/docs/v4/error-management/fallback) on 2026-11-03.

Suggested fix: Add preemptStart to E12's named changes for 9e386b0. Resolve open-web consistently in both paths, or share the resolver, while retaining all existing credential and holder checks before cancellation. Add an open-web case to the new start-setup tests. Keep the existing owner-stop and invalid-device assertions in 9e386b0:packages/engine/test/commands/start-setup.test.ts:55 and :83.

This is minor because the plan already states the correct caller semantics and the ordinary type check should expose the missing branch. I am not reporting a demonstrated shipped stop failure or a new authorization bypass.

## Risk register

| Finding | Severity | Fallout | Probability | Product and band | Evidence | Owner | Decision | Deadline | Acceptance | Closing evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| R4-TM-1. E12 omits the newer preflight adaptation. | 1. The confirmed consequence is an implementation instruction gap caught during development. | 1. The omission concerns integration work before release. | 10. The builder must handle the added credential variant when adapting this file. | 10, record. | Confirmed plan omission; no implemented-flow reproduction. | Client API unit 1b builder. | Pending the lead or owner. | Review with the phase's minor findings. | None. | None yet. |

The owner's team rule 8 continues to govern security findings. This finding requests a small correction to the engine adaptation instructions and does not introduce a security release gate.

## Verification of round 3's five major folds

| Major group | Verification and result |
|---|---|
| An agent cannot recover an oversized event. | Contract sections 2 and 3 now allow client.event to an agent under the same read rule as its stream. The response includes the event's envelope and is wrapped as data on the server. Owner-only events remain hidden. This preserves the boundary being extracted from packages/engine/src/api/server.ts:154. Criterion 3.8 includes an agent's recovery and a hidden oversized sequence. The fold holds. |
| The owner's wait can end within a committed batch. | The wait algorithm now gates every termination reason on a sequence returned at the end of a write. Without piece lists it reads client.sequence. With lists it catches the stream up to the lists' sequence and decides again. This covers both settled and owner-needed exits. The distinction matters because packages/engine/src/routing/waits.ts:28 projects intermediate events, and packages/engine/src/log/EventLog.ts:136 publishes committed batches into the event stream. Criterion 3.10 retains the split-batch counterexamples. The fold holds. |
| A large reply blocks the stream's acknowledgement. | E32 uses separate stream and read connections, independently reconnecting, and keeps recovery reads alive when the stream closes. Section 3 also caps a live chunk at 256 kibibytes. This changes the single connection and hard-coded stream dispatch in packages/client/src/index.ts:144 and :192. The slower large-read heartbeat limit remains explicitly accepted. The fold holds. |
| A throwing piece table can halt commands or replay. | Section 1 and E30 enumerate guarded calls and refusing fallbacks. E6 limits reducers to the event and sequence, which matches the projection constraint in packages/engine/src/routing/waits.ts:28 and the pure fold in packages/engine/src/views/apply.ts:338. The two direct roles functions have their own explicit failure rules. Criterion 1.44 and the throwing-piece fixture cover commands, stop, adapter requests, restart, and rebuild. The fold holds. |
| An agent holder approves only a title. | E29 carries bounded, redacted input and locations, places engine-built lines before the title, retains action while a request is open, and uses it again after a move. This addresses the title-only producer in packages/engine/src/runner/AcpRunner.ts:411 and routed delivery builders in packages/engine/src/routing/holders.ts:46 and :78. Page and pane requirements show the action before approval, with a Codex thread-item fallback and fixed warnings. Criteria 1.42, 7.12, and 8.2 cover the affected paths. The fold holds. |

I also checked the related minor folds: the encoded snapshot display budget, durable caller metadata, device snapshot wrapping, old-carrier warnings, device dismissal of a lasting-setting alert, missing tokens, public Origin handling, and installation order. None reopens a settled issue. E31 deliberately closes permission requests on stop while leaving the accepted stopped-asker question gap.

## Audit of shared engine edits E1 through E32

The anchors in this table identify the existing behavior checked at 8ff4c9b. A new module promised by the plan is not treated as existing code. The test column records whether the plan names the affected existing expectations or supplies a new test. These are source checks, not claims that the tests ran.

| Edit | Existing behavior checked | Test and adaptation assessment |
|---|---|---|
| E1. Command groups. | packages/contracts/src/commands.ts:44 defines the group, and :137 omits only debug for production. | The existing sixteen-command, group-size, and Model Context Protocol inventory assertions in contracts/test/commands.test.ts are explicitly addressed. The pre-merge uniqueness fixture is specified. |
| E2. Access before receipts. | packages/contracts/src/commands.ts:16 defines owner-only commands; packages/engine/src/commands/CommandHandler.ts:237 forms receipt identity. | The access lookup precedes receipt retrieval. The exact offered tool list and authorization expectations are named. |
| E3. Planner replies and hooks. | packages/engine/src/commands/CommandHandler.ts:54, :67, :97, :269, and :278 contain the supported set, dispatch, reply builder, receipt callback, and afterCommit execution. | Handler, authorization, lifecycle, permission, transaction-receipt, and log-receipt tests are named. Engine hooks and blocking-wait replacement replies remain explicit. The newer start setup and send-lane behavior must remain intact. |
| E4. Read table and marks. | packages/engine/src/api/server.ts:154 and :163 implement the existing stream and debug reads. | Visibility and compare-views tests remain named. New read-marks coverage checks lost access on retry and no page text in receipts. |
| E5. Event union and lifecycle. | packages/contracts/src/events.ts:88, packages/contracts/src/stateMachine.ts:90, and packages/engine/src/views/apply.ts:122 show the union, keep effects, and thread ownership extraction. | The event roundtrip, exhaustive state-machine, view, and visibility samples are named. Piece events gain keep entries without a permissive unknown-event fallback. |
| E6. Piece views and reactors. | packages/engine/src/views/apply.ts:114 and :338 initialize and fold views. | View, rebuild, comparison, fixtures, and rebuild-registration checks are named. Recovery readiness is covered by a fixture reactor. |
| E7. Migrations and side rows. | packages/engine/src/log/migrations.ts:71 and packages/engine/src/log/EventLog.ts:199 write migrations and side rows. | Existing append and receipt expectations remain named. Namespace ownership is tested. |
| E8. Shared visibility. | packages/engine/src/api/server.ts:155 filters self and structural children; packages/engine/src/routing/holders.ts:21 finds the effective holder. | The changed grandchild expectation in subscribe-visibility.test.ts is identified explicitly, including live and catch-up recovery. |
| E9. Consistent snapshot. | packages/engine/src/views/Views.ts:41 and packages/engine/src/log/EventLog.ts:136 show publication after the database write. | The new publication-barrier test checks one view value and its own sequence. |
| E10. Dotted command names. | packages/cli/src/commands/registry.ts:10 derives the inventory from the group. | Command-inventory and parity tests are named, retaining engine names. |
| E11. Caller schema and receipt key. | packages/contracts/src/events.ts:8 keeps Actor narrow; :184 defines the envelope; packages/engine/src/log/EventLog.ts:116 builds caller keys. | Event and receipt tests are named. The joint E11/E12 migration, append path, row decoder, rebuild, and restart equality test preserve service rules and device identity. |
| E12. Device and open-web identity. | packages/engine/src/commands/CommandHandler.ts:203 resolves the old caller; packages/engine/src/api/server.ts:87 authenticates wire credentials. | Existing handler, authentication, and per-request credential tests are named. The new path test is specified. R4-TM-1 adds the newer preflight site and its focused test. |
| E13. In-process services. | packages/engine/src/api/server.ts:87 has no service credential route. | Authentication expectations remain. New tests cover the exact service list, command rights, and durable rule attribution. |
| E14. Rule-attributed answers. | packages/contracts/src/events.ts:130 and packages/engine/src/routing/permissions.ts:44 build the answer event. | Permission and durable-caller tests cover the widened answeredBy without widening holders. |
| E15. Delivery senders and data envelopes. | packages/contracts/src/events.ts:23, packages/engine/src/routing/envelope.ts:22, packages/engine/src/commands/prompt.ts:10, and packages/engine/src/routing/deliveries.ts:45 contain the sender seams. | All three sender fields are named. Event, text-is-data, rendered-prompt, and delivery tests retain old encodings and add service and piece cases. |
| E16. Delivery source rules. | packages/contracts/src/events.ts:30 and packages/engine/src/routing/deliveries.ts:57 distinguish engine source outcomes. | Existing delivery expectations remain. The new table governs pending piece sources, not already returned deliveries. |
| E17. Own queued withdrawals. | packages/engine/src/routing/holders.ts:57 withdraws only queued deliveries; packages/engine/src/routing/waits.ts:110 projects batches before wait checks. | The existing move-withdrawal test is named, and a new piece-withdrawal case covers the reloaded target. All withdrawals now pass the common first step. |
| E18. Reach at queue and send. | packages/engine/src/routing/deliveries.ts:217 dispatches under the send lane; :259 rechecks waits after a changed send outcome. | Delivery and carry-on-dispatch tests remain named. Fresh transaction views, withdrawal, and continuing to the next delivery are explicit new cases. |
| E19. Settled and member rules. | packages/engine/src/routing/waits.ts:39 defines settled behavior. | Existing wait and acceptance expectations are named. Shared engine/client equivalence includes the version 12 capacity-held clause supplied by roles unit 11b. |
| E20. Blocking request-held checks. | packages/engine/src/routing/waits.ts:33 defines held requests. | Existing waits remain named. Fixture piece conditions extend the check, with guarded failure behavior. |
| E21. Paged thread reads. | packages/engine/src/log/EventLog.ts:175 derives agent_id, while packages/engine/src/views/apply.ts:122 also finds queued delivery targets. | A new indexed thread_agent_id and page-boundary comparison address the existing mismatch. Agent visibility remains narrower by design. |
| E22. Rights helpers. | packages/engine/src/routing/holders.ts:21 and :35 compute effective-holder authority. | The plan reuses these helpers and E8 rather than granting pieces new management rights. No existing behavior change needs a changed assertion. |
| E23. Checked piece batches. | packages/contracts/src/stateMachine.ts:122 checks event effects; packages/engine/src/routing/waits.ts:110 performs wait checks. | The new fixture covers planner, read, and reactor batches, exact refusal writes, projected checks, and writer import boundaries. The changed CommandRefused roundtrip is named. |
| E24. Stream dispatch by command. | packages/client/src/index.ts:199 calls subscribe by a fixed name; :219 routes all stream schemas there. | Existing subscription expectations remain. The new multi-stream test directly covers the defect being changed. |
| E25. Tolerant client wire decoding. | packages/client/src/index.ts:97 constructs the strict typed client. | Real encoded newer-server frames, unknown event tags, and widened callers are explicitly tested at the remote boundary. The engine's durable decoder remains strict. |
| E26. Browser entry. | packages/client/src/index.ts:3 imports the Node socket implementation. | New import-boundary and browser build checks are specified. The Node identity path stays separate. |
| E27. Carrier token ownership. | packages/engine/src/recovery/restart.ts:140 collects references at startup; packages/engine/src/commands/SecretStore.ts:13 documents that lifetime; packages/engine/src/commands/CommandHandler.ts:221 and :234 special-case secret commands. | The existing restart secret test is named. New removal and account-write interleaving cases protect the generation slot and account secrets. |
| E28. Device answer restrictions. | packages/engine/src/routing/permissions.ts:35 checks the holder and :38 applies agent option limits. | Existing permission expectations remain and gain device/owner option cases. The owner's question 6 is explicitly pending; the recommendation is internally consistent. |
| E29. Permission action data. | packages/engine/src/runner/AcpRunner.ts:411 and packages/engine/src/routing/holders.ts:46 currently carry the description. | Text, permission, moved-request, rendered-prompt, and fake-agent changes are named. New action-field tests include old logs, absent input, locations, and redaction before cutting. |
| E30. Piece-call guard. | packages/engine/src/views/apply.ts:338 is the pure fold that must survive a piece throw. | The new fixture and boundary test cover table calls. The two direct roles functions are named exceptions with their own refusing policy. |
| E31. Stop cancels own permission requests. | packages/engine/src/commands/stop.ts:12 moves held work without cancellation; packages/engine/src/recovery/crash.ts:58 cancels before :66 moves held work from the projected state. | The new stop-cancels-requests test covers the difference. The existing failure-4-no-answerer stops holders and need not have its expectation inverted. |
| E32. Two client connections. | packages/client/src/index.ts:144 maintains the current connection and :192 retries streams. | Concurrent reconnect expectations, the peer connection accounting, and new oversized-state cases are specified. Unary retry identity remains unchanged. |

I compared the newer implementation sites for these edits. Changes to account login inspection, terminal output, redaction, and start setup do not invalidate the declared access, snapshot, delivery, or replay contracts. R4-TM-1 is the additional caller-resolution site, rather than a shifted line-number finding. The newer structural redactor merits the specific post-build case below.

## Joins with the board and roles plans

The board's structural membership rule stays distinct from effective-holder management rights. The shared delivery path supplies the author header and data envelope, checks reach against projected views when queued, and checks it again when sent. A membership change therefore cannot authorize a stale queued wake. The board does not acquire answer, stop, or resume rights through that delivery check.

Board status lists carry a common sequence for the owner's wait gate. The roles capacity hold remains part of the engine's settled predicate, including an empty held queue. Version 12 puts capacityHeld in the owner's snapshot and shared client fold, omits it for an agent, and assigns the change to roles unit 11b. This agrees with the board's settlement requirement.

The roles services remain in-process identities with fixed command allowlists. Stall watch's client.event read includes the envelope and occurredAt. Reducers still depend only on the event and sequence. This resolves timer restoration without making replay depend on a placeholder envelope time.

The standing-rule matcher and capacity-hold condition are expressly outside the piece table guard. Each has its own bounded or pure execution requirements, content-free logging, and a malformed-result or error outcome of no. The standing-rule input is the actual redacted action. Unknown, absent, cut, or redacted evidence does not qualify for an automatic allowance. Matcher paths are resolved before the writer transaction, and a qualifying answer is committed with its request rather than publishing a transient held request.

Roles rule and setting events feed the lasting-setting alert source. Board and roles provide level-based openMatters for first-start scans, and their snapshot sections remain bounded and absent for agents. I found no conflicting privilege or event ownership promise at these joins.

## Trace of the six security responsibilities

### Isolation

The design has one host owner. It intentionally does not provide separate authenticated web users in this build. The approved SECURITY.md change and the rulings explicitly accept the open loopback surface and defer a separate operating-system user and device pairing.

Within that model, agent tokens, effective-holder reads, owner-only classes, service allowlists, device restrictions, and piece namespace checks remain separate boundaries. All client reads use the common visibility rule. Agent snapshots contain identity rows rather than owner display, account, device, alert, or wait-state sections. Service and piece senders cannot masquerade as the owner.

### Identity across sessions

The Unix socket keeps credential authentication and rechecks. At 8ff4c9b, packages/engine/src/api/server.ts:113 reauthenticates requests, and :119 watches credential changes for non-owner callers. The command handler checks stopped or crashed agent identity before looking up a receipt at packages/engine/src/commands/CommandHandler.ts:209.

The web build has no account sign-out or another person's sign-in isolation to promise. Closing a tab clears its in-memory state, but every later accepted web client reaches the same owner's data. Web settings changes close existing web sockets. Host credential revocation alone does not authenticate or revoke the deliberately open web surface. This is the accepted architecture, not an unreported multi-user guarantee.

### Access

The Unix socket, in-process open-web constructor, service path, and piece batch path have distinct origins. Host credentials are refused on the web transport. Host and Origin checks, loopback binding, network checks, forwarded HTTPS checks, proxy user checks, and the ancestry guard implement the chosen web boundary. The ancestry guard remains a simple misuse guard.

Access checks precede receipts. Read retries recheck current access. Services have no wire credential. A piece cannot append raw engine control events, invent an owner sender, or withdraw another namespace's delivery. The owner-only token setter, three computer-only commands, debug exclusion, and pending device-answer rule remain explicit exceptions.

### Integrity

The log remains the replay source. Piece events and side rows commit atomically. Reactor batches are constructed and checked from current transaction views after recovery readiness. Read marks do not persist page replies. Source sequences and deterministic reducers prevent restart from inventing a different history.

The snapshot takes its own view sequence. The wait gate prevents decisions on an intermediate batch state. Caller rule and device metadata have durable columns and one row decoder. Carrier rotation stores a fresh generation before publishing its reference and removes only the old carrier value. Stop cancellation, reach withdrawal, and reloaded-state cleanup feed the same wait checks.

### Confidentiality and stored copies

| Copy or hop | Content and lifecycle |
|---|---|
| The engine database, receipts, views, and replay. | Redacted thread and action content, caller metadata, settings, alert state, and token references remain as engine history. Read replies with thread text are not copied into receipts. Raw carrier token values do not enter these events. |
| The local secret store. | Account secrets and the active carrier generation live in the existing store. At 8ff4c9b, packages/engine/src/accounts/SecretStore.ts:42 creates a 0600 temporary file and renames it. The file is not encrypted at rest. That is an existing host boundary, not a claim of cryptographic protection. Startup collection and narrow generation removal are specified. |
| Adapter processes and their output. | Account environment and provider credentials are local process inputs. The carrier namespace is excluded from account resolution. Redaction precedes new action caps and delivery. Agent text remains data in the generated envelopes. |
| Browser and pane memory. | Thread data is live in memory. The page does not put it in local storage. Static offline assets do not authorize cached thread data. Closing the page is not deletion of the engine history. |
| Exports. | An explicit export creates an owner-controlled 0600 file. It persists until its owner removes it. It does not revoke or erase history or a previously received notification. |
| The web and remote proxy. | Loopback is the local plaintext hop. Remote encryption terminates at the owner's HTTPS proxy over the approved network path. The plan does not promise authenticated browser identity. |
| The alert carrier and phone. | The fixed alert payload contains its kind, title, sanitized bounded identity labels, and link. It excludes permission input and thread text. Carrier caches and notifications are additional copies. Their removal is best effort and cannot be treated as engine deletion. |
| Error and diagnostic logs. | Piece errors log names and fixed context, not request text. Token commands and carrier errors must not put values in receipts, logs, command-line arguments, or browser state. |

Open alert retries, dismissal, first-start scans, generation changes, and old-token warnings are specified separately from deleting local and remote copies. Selecting none clears the token. A device dismissal of a lasting-setting alert does not cancel its required initial push attempts. A restart may remove a retired value before its best-effort warning succeeds; that limit is already recorded.

### Secrets and dependencies

E27 protects the reserved carrier reference namespace in the planner, runner, and collector. Collection stays at startup, avoiding a race with an account secret stored before commit. Token setting is owner-only and has no value readback. Carrier authentication is kept out of the page and URL.

The plan names the new client and presentation dependencies and leaves installation to the lead's provisioning unit. It retains the repository's licensing requirements for copied code. I found no new dependency or secret-handling decision that requires reopening an owner ruling.

## Proposed post-build checks

1. Extend the 9e386b0 start-setup test with an open-web stop while setup never returns. Require prompt cancellation, one AgentStopped, no later SessionOpened, and no later spawn. Keep invalid-device cancellation refusal and holder authority checks. This closes R4-TM-1.

2. Exercise E29 against the newer redactor using nested adapter data with a registered secret in an ordinary field, an arbitrary key, and a field named _tag. Check the retained event, moved-holder delivery, client.event response, warning flags, and the cut boundary. At 8ff4c9b, packages/engine/src/identity/redactor.ts:210 recursively redacts keys and strings. At 9e386b0, packages/engine/src/identity/redactor.ts:211 preserves schema structure, and packages/engine/src/log/redactionStructure.ts:39 treats _tag specially unless the context is free text. New adapter input must use the promised full data redaction rather than inherit a schema discriminator exemption. packages/engine/src/runner/AcpRunner.ts:173 at 9e386b0 already has cleanStructure for arbitrary protocol data. This is a check of E29's stated requirement, not a second finding.

3. Run the round 3 recovery and wait fixtures over encoded production frames. Include a hidden oversized event for an agent, a recovery read surviving a dropped stream, and every termination reason while a committed batch crosses chunks. Include board status lists and an empty capacity-held queue. These belong to the existing criteria 3.8 through 3.10 and the joined roles checks.

4. Run the throwing-piece fixture through real startup replay and adapter permission recording. Check every table fallback and both separately guarded roles functions. Verify equality of rebuilds and live views after a throw. This extends the existing PB-18 evidence, not its scope.

5. Run the token lifecycle and alert tests with the actual carrier: restart, missing token, rotation during pending sends, clearing, device dismissal, and a failed account secret commit interleaved with carrier removal. Require no raw token in logs, receipts, browser state, or delivered action text. Retain the documented limits for duplicate delivery and remote deletion.

6. Complete the already planned real browser and proxy checks for public Origin, absent forwarded headers, settings changes closing sockets, and WireGuard appearing after service startup. Keep the declared open-server trust model when interpreting the result.

## Noted, not filed

The open web server, deferred separate operating-system user, same-user file access, provider cache retention, duplicate alerts, ordinary account values under nonsensitive names, uncapped agent count, stopped-asker questions, slow oversized-read heartbeat limit, connection cap, and loopback port squatting are recorded owner choices or named known gaps. I did not re-file them.

An owner deliberately changing their own proxy, reading their own store, or bypassing a self-imposed limit is outside the finding set. Question 6 remains pending exactly as the rulings state. I did not convert that pending recommendation into a new owner decision.

No application code, plan, issue list, or repository file was changed. The review checkout remained clean. The assigned scratch directory was not created. An initial file-presence check used an unavailable python alias; rerunning it with python3 succeeded without creating a file.

refused: none.
