revise
Grade: 6  B/M/m: 0/3/2  Flags: none

## Review scope and verdict

This is the round 4 security threat-model review of the supplied foundry roles plan v5. Repository evidence was checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. References use `P` for `../plan.md`, `D` for `../decisions.md`, `C` for `../../inputs/client-api-contract.md`, `B` for `../../inputs/board-contract.md`, and `R` for `../../inputs/rulings.md`, relative to this report. Repository paths are relative to the recorded checkout. API means application programming interface. ACP means Agent Client Protocol.

The earlier matcher safeguards survive the rework. Standing rules remain conditional on a qualifying recording. The findings concern the shared engine edits and their integration inventory: durable caller attribution, a contradictory read boundary, the capacity outcome between the runner and routing, the state table, and one stale board anchor.

The verdict requests plan corrections. It does not override team rule 8, which defers security fixes. The lead records the security items in `docs/issues.md` and passes them to the manager's attack list. This report neither grants a new exception to SECURITY.md nor imposes a new security veto. The owner's authorization to edit the engine and rulings L26 to L28 are accepted.

## Findings

### R4-TM-1. The shared caller edits do not specify how the new audit identity survives a log read

Severity: MAJOR.
Category: Design; security, integrity of the audit record.
Responsibilities: Identity across sessions; integrity.
Responsible builder: Client API engine units 1a and 1b, coordinated with roles WS-2 and WS-7a.
Evidence status: Confirmed omission in the named storage changes. The implementation has not been built.

Scenario: A device answers a request, or a standing rule answers one. The live envelope has the acting device or the service's rule id. The service restarts before the standing-rule reactor records first use, or a client reconnects and reads the same envelope from the log. The storage path described in E11 and E12 has no durable representation of the new metadata.

Evidence: C:772 defines `Caller` with an optional rule, but changes `callerKey` to `service:<name>` expressly without the rule. C:786 adds `EventEnvelope.device` and says the command handler sets it. Neither edit specifies storage or reconstruction of those additional envelope values.

At the recorded commit, `callerKey` is used for both the receipts scope and the event row, not just for receipts: `packages/engine/src/log/EventLog.ts:116`, `:177` and `:253`. The live envelope is constructed separately from the actor at `EventLog.ts:182`. The events table holds a caller string and the event payload, with no device or separate caller-metadata field, at `packages/engine/src/log/migrations.ts:16`. Catch-up reconstructs the caller solely from that string at `packages/engine/src/log/subscribe.ts:36`. Rebuild uses the same row decoder at `packages/engine/src/views/rebuild.ts:26`. Adding an optional field to the envelope schema alone does not store it.

The roles depend on this distinction. P:622 makes the first-use reactor react to a `PermissionAnswered` with a rule caller. P:595 requires the answer envelope to identify the service and rule. The event's separate `answeredBy` field is durable under E14 and can preserve the answer's rule id; it does not by itself repair the promised envelope attribution or recover the acting device for arbitrary engine events. The rule-creation event's own device field likewise does not supply device attribution for every later command.

Suggested fix: Extend E11 and E12 with one explicit durable representation of the complete caller and optional device. Keep the receipt key scoped to the service name separately. Name the append path, migration if needed, catch-up decoder, rebuild query, and E21 paged reader that carry that representation. Alternatively, explicitly change the reactor to use durable `answeredBy`, while still implementing the envelope's device and caller contract. Add database round-trip and restart cases to `packages/engine/test/log/append.test.ts`, `log/subscribe-gapless.test.ts`, `log/receipts.test.ts`, `views/rebuild.test.ts` and the roles pre-check suite. Compare live, catch-up and rebuilt envelopes, including the device and rule, rather than only checking that a service name decodes.

This does not assert that device revocation necessarily fails: `RuleAdded` also records its adding device in the roles event. The defect is the missing durable audit path and the caller-based reactor's reliance on it.

### R4-TM-2. The shared visibility edit conflates direct-child reads with inherited lifecycle rights

Severity: MAJOR.
Category: Design; security, access.
Responsibilities: Isolation; access.
Responsible builder: Client API visibility and read handlers, coordinated with roles WS-1 and WS-6.
Evidence status: Confirmed contradictory boundary and incorrect claim about the recorded code.

Scenario: An orchestrator has a lead, which has a worker. The lead pauses or crashes. The orchestrator inherits lifecycle rights over the worker. Does it now receive the worker's history through subscribe, roster, thread and hand-off? Conversely, does the unavailable lead lose its own direct-child stream? The frozen contract gives incompatible answers.

Evidence: C:343 calls visibility over agents for which the caller holds a parent's rights “the engine's existing rule.” C:393 also says an agent does not see its grandchildren. E8 at C:732 says the new common visibility function reproduces today's filter exactly and keeps the existing test's expectations.

The recorded stream checks only whether the event is about the caller or its structural direct child at `packages/engine/src/api/server.ts:155`. It does not call `holderAbove`. Lifecycle rights do use availability: `packages/engine/src/routing/holders.ts:21` skips every ancestor except an idle or working one, and `packages/engine/src/commands/CommandHandler.ts:73` uses that helper for targeted lifecycle commands. These rules differ in the scenario above.

This is directly observable in the named existing test. `packages/engine/test/api/subscribe-visibility.test.ts:154` promises no grandchild visibility in catch-up or live reads. Its samples include paused, crashed and stopped child states at `:60`, `:81` and `:84`; its expected set remains self plus direct child at `:160`. Replacing that test's filter with inherited holder rights cannot simply keep its expectations.

P:351 delegates hand-off authorization to a parent's rights, P:889 and P:898 rely on thread visibility for omitted hand-off material, and C:741 makes all these reads share a visibility function. Thus the inconsistency affects the roles' actual read path, rather than an unused contract paragraph.

Suggested fix: State one read policy for the unavailable-parent case before building. If reads remain structural, provide a separate structural read predicate and explain how an inherited holder obtains a hand-off when it cannot read the source thread. If reads follow inherited rights, record that as a deliberate change to existing behavior, reconcile the no-grandchildren statement, and name the changed visibility expectations and corresponding engine-plan decision. Exercise the orchestrator, unavailable lead, worker, replacement sibling and unrelated agent across pause, crash, stop and resume, on every read surface. The owner already permits engine changes; no renewed permission request is needed merely to document this change.

This is not a claim of cross-human-account exposure. It is an unresolved agent read boundary inside the single-owner product.

### R4-TM-3. WS-7b omits the runner outcome that must carry capacity to the hold planner

Severity: MAJOR.
Category: Design; bug, failure handling.
Responsibility: Integrity of delivery and retry state.
Responsible builder: Engine backend, WS-7b.
Evidence status: Confirmed missing path and source entries in the change inventory. No claim is made that unbuilt code has failed a test.

Scenario: A real adapter returns a capacity error. The new classifier recognizes it, but the existing runner maps every recognized classification to an account-pause outcome. The hold planner cannot receive a distinct capacity outcome through the current runner schema. Merely extending the classifier and the delivery planner is insufficient.

Evidence: P:940 and P:976 list the classifier, delivery routing, recovery and public contracts as 7b's affected code. They omit `AcpRunner.ts` and `Runner.ts`. At the recorded commit, the injected classifier type permits only usage and sign-in classifications at `packages/engine/src/runner/AcpRunner.ts:54`. Its `finish` path maps a recognized error to `outcome: pause` at `:170`. The `RunnerEvent.promptReply` schema permits only success, error, or a pause whose reason is usage or sign-in at `packages/engine/src/runner/Runner.ts:85`. The command handler decodes that schema before routing at `packages/engine/src/commands/CommandHandler.ts:133`.

If capacity is added only to the classifier, the runner's pause construction no longer fits the schema. If it is put into the pause reason without changing routing, `packages/engine/src/routing/deliveries.ts:179` treats any non-sign-in reason as a usage limit. Both contradict P:967's “no pause is written” and can leave capacity behaving like account exhaustion instead of a queue hold.

The inventory's statement about updating only the “both kinds” fixture check also understates the existing test dependency. `packages/engine/test/runner/classify-errors.test.ts:21` types fixtures as exactly two kinds. Its real-runner loop at `:119` assumes every fixture becomes a pause. A capacity fixture needs a separate expected outcome, while the existing usage and sign-in expectations remain intact.

Suggested fix: Define the internal capacity outcome explicitly and add its producer, `RunnerEvent` schema, command-handler consumption and delivery planner to task 7b and decision row 80's change inventory. Keep capacity separate from account pauses and from successful agent prose. Name the updates to the whole classifier test, including its real-runner loop, and add an adapter-through-handler case proving that a capacity error reaches `DeliveryHeld`, writes neither account-pause events nor a sender return, and reaches the normal return path when the stall watch is off. Preserve the before/after-acceptance cases, restart cases and queue-wide hold tests already specified.

The desired hold policy is present in v5. The missing piece is the concrete internal contract connecting the recorded runner to that policy.

### R4-TM-4. The new event unions have no assigned update to the closed lifecycle event table

Severity: MINOR.
Category: Design, integration inventory.
Responsibility: Access and integrity checks on engine events.
Responsible builder: Client API unit 1a for the shared rule; each piece's contracts unit for its entries.
Evidence status: Confirmed omitted source and test.

Client API E5 at C:693 opens `Event`; the roles add events under P:361 and add `DeliveryHeld` and `DeliveryReleased` in WS-7. Neither plan's named integration inventory assigns entries in `packages/contracts/src/stateMachine.ts`. That file's event table is explicitly `Record<Event["_tag"], Record<StateName, EventEffect>>` at `:79`. Its lookup indexes the table directly at `:122`. New union members therefore require explicit lifecycle decisions; ignoring unknown tags in views does not provide those decisions.

The existing exhaustive test is `packages/contracts/test/state-machine.test.ts:282`, including the all-events check at `:333`. It is not named among E5's or WS-7's affected tests.

Suggested fix: Add the event table and that existing test to the change inventory. Assign lifecycle effects for the roles events and the two hold events. Preserve the existing engine cells. Do not weaken the exhaustive typing or add a permissive fallback merely to accept new tags. This is a bounded planning omission that the compiler should expose during implementation.

### R4-TM-5. WS-4b still points to the board package removed by the direct-engine rework

Severity: MINOR.
Category: Design, source anchor.
Responsibility: Integrity of the stall rule's integration.
Responsible builder: Roles planner and WS-4b.
Evidence status: Confirmed stale target.

P:783 names the pure `board.status` export from `packages/board`. Under the supplied board v6 contract, the export instead belongs in `packages/engine/src/board/`, in “For LGTM Studio's own services.” C:95 to C:105 places pieces in the existing engine packages and removes separate contracts and composition packages; B's opening layout places the board inside the engine's two existing packages. There is no current `packages/board` directory in the recorded checkout.

Suggested fix: Point WS-4b at the board v6 engine export and update the adjacent source-version references. Update known gap 3's statement that the board contract is still awaiting the L26 rework. Do not treat this as an absent dependency requiring a new package.

## Earlier answers checked

The following table checks every round 3 answer in the supplied findings map. Duplicate findings share a row. “Holds” means the v5 decision and acceptance case preserve the answer; implementation proof remains for the build.

| Round 3 finding | Result in v5 |
|---|---|
| TO-R3-1 | Holds. WS-2 rejects model-requested sandbox fields as proof of execution containment and requires an adapter-set approval marker; criteria 2.5 and 2.14 retain the negative cases. |
| TO-R3-2 | Holds under L27 and D:85. Recording precedes units 3, 4 and 11a; no qualifying harness defers both WS-2 and WS-7a. Known gap 21 now states the combined outcome. |
| TS-R3-TM-1 | Holds within the stated limitation. WS-2 resolves operands and values after an equals sign, denies resolution failures other than a missing path, and tests existing aliases in 2.6. The later-link race remains known gap 20. |
| A-R3-A1 | Holds. The roles fold post ids, board read/wake events and delivery acceptance; criteria 3.5 and 3.7 preserve read-state checks across restart. |
| C-R3-C1; A-R3-A2; Ls-R3-L3; TS-R3-TM-2; Lo-R3-L8 | Holds. Whole-rule encoded validation and ordered snapshot filling replace the impossible independent-maxima guarantee; criterion 1.3a tests multibyte overflow and truncation. |
| Lo-R3-L1 | Holds. The waits graph is transitive with a visited set; criterion 4.3 includes working siblings, deeper workers, idle chains and cycles. |
| Lo-R3-L2; Ls-R3-L1 | Holds as the intended queue/reload policy in 7.3 and 3.10. R4-TM-3 concerns the omitted runner outcome before that policy, rather than reopening the chosen queue-wide hold. |
| Lo-R3-L3 | Holds. Engine hold/release events count every release per agent and outage, independent of the later roles record; K10 covers an owner release. |
| Lo-R3-L4 | Holds. A usage pause with a known reset counts as busy; 4.1 and 4.3 retain the pause cases. |
| Ls-R3-L2; TS-R3-TM-3; Lo-R3-L6 | Holds. The roles write `StallEnded`; stall watch compaction remains a stall watch turn; 3.11 tests the ordinary-turn transition through the alert reactor. |
| C-R3-C2 | Holds. Tests now live under the existing engine and contracts projects, which `vitest.config.ts:4` and `:26` discover. Separate test-project registration is no longer needed. |
| C-R3-C3 | Holds. Task 2h and unit 3p prepare selectable recorder scenarios before recording. |
| C-R3-C4 | Holds. The explicit board-off `GaveUp` alert exception applies even to an agent recipient; N11 and N12 retain the cases. |
| C-R3-C5 | Holds. The crash-retry setting is 0 or 1 and 4.6 defines zero as immediate give-up. |
| Lo-R3-L5 | Holds. Criterion 4.4 excludes open blocking-wait time. |
| Lo-R3-L7 | Holds. Only the stated progress resets episodes; a board post during a nudge's own turn does not. |
| Lo-R3-L9; TO-R3-4; TO-R3-5 | Holds. Protected names ignore case, any refused mode blocks rules, and M66 to M69 test those cases. |
| TO-R3-3 | Holds. A title cannot be a shell discriminator; M63 and X04 preserve that refusal. |

The round 1 and round 2 maps were also checked against the final workstreams. Their security answers remain: the character allow-list; exact words and explicit prefix opt-in; shell identity plus a positive sandbox marker; request-owned unredacted and uncut input; an independent transactional engine backstop; highest mode since start; owner-only rule mutation; expiry and adding-device revocation; bounded snapshots and paged recovery; hand-off overflow relayed through the lead; bounded transcript reads; fixed notice bodies; service-specific action kinds; deterministic action ids; switches; board-off suspension; and no engine-prompt fallback.

The non-security answers remain in the final criteria: carry-on after crash with explicit give-up causes, owner alerts, holder rerouting, three stall episodes, worker-only age limits, transitive waits, production-bound timer tests in-process, cache request-start timing and lifetime history, and accepted deliveries never being re-sent as original prompts. R4-TM-1 qualifies the earlier promise of service envelope attribution under the newly enumerated storage edits. R4-TM-2 is a shared-contract read-policy contradiction; it does not reopen the already-correct prohibition on a replacement reading its sibling's thread.

## The six security responsibilities

1. **Isolation.** This remains one owner's service, rather than a multi-owner account system. Role mutation is owner/device-only. Roles events and snapshot data are hidden from agents. Hand-off and roster reads depend on the common engine read predicate, whose contradictory inherited-rights case is R4-TM-2. Channel routing does not create lifecycle authority.

2. **Identity across sessions.** Services are in-process identities with no wire credential. Device revocation must end later reads and automatic matching by device-added rules. Rules have their adding device in their own event, while complete envelope provenance needs R4-TM-1. A provider sign-out pauses its agents; the stall watch does not override the engine's sign-in path. Roles do not introduce a second human sign-in or a separate device cache.

3. **Access.** Standing rules remain behind the recording gate, owner-approved mutations, current transaction time and views, and independent option/mode/settings checks. Unrecognized input, escaping sandbox requests, protected destinations, redacted input and unsupported harnesses fail closed. Service action kinds remain closed. `release` has a target-holder check, not merely an agent-callable access-table entry. Authenticated socket and remote access remain the client API's responsibility.

4. **Integrity.** The roles view is rebuilt from events. Request ids distinguish repeats from retries. Queue holds, release counting, accepted deliveries and restart state have explicit policies. R4-TM-1 covers durable attribution and R4-TM-3 covers the missing capacity outcome. The earlier alert-view ordering risk remains known gap 19, not a new finding.

5. **Confidentiality.** New events inherit the event redactor, which is called before commit at `packages/engine/src/log/EventLog.ts:250`. Notices use fixed bodies and sanitized names. Hand-offs retain redaction and data envelopes. The fallback transcript reader keeps numbers only. Remote channel encryption belongs to piece 2. No application encryption at rest is established by this plan: the recorded event writer stores JSON text at `EventLog.ts:178`. File permissions are access controls, not proof of encryption. This is the existing storage model, not a newly claimed encrypted store.

6. **Secrets and dependencies.** The roles add no service token, account secret store or new third-party dependency. Role-file upload sends content instead of a host path. Recorder output must retain existing scrubbing. Copied code remains subject to the third-party directory, licence and NOTICE rules; reading another project's design does not itself require copying code.

## Data inventory, removal and revocation

| Data | Every relevant copy | Removal and revocation policy |
|---|---|---|
| Role files, rules, settings and snoozes | Owner's source file; command payload; redacted event; event and receipt rows; live/rebuilt roles view; authorized reads, snapshots and device caches. Rule words and notes are omitted from the snapshot summary. | Set replaces active content. Disable/remove/expiry stops future matching. Revocation suspends the adding device's rules. Historical log and receipts remain. |
| Action records and notices | Roles events and view; receipts; board post and board view; wake delivery; PromptSent and thread; harness session; model input/cache; client caches. Owner notices additionally create alert records and sanitized notification payloads. | Switching off stops future actions under the stated hold-release policy. Closing, reading or dismissing changes state, rather than erasing historical copies. Already sent notices cannot be recalled. |
| Permission tool input | Harness request; bounded redacted PermissionRequested event; log and receipts; authenticated streams, paged reads and client memory. Existing tool-call thread items can also contain the input. | Answer/cancel closes the request. The added input stays outside the requests view and snapshot, but remains in history. |
| Hand-off | Existing source thread; bounded transient selection; read reply; lead memory/export; replacement's initial prompt; resulting thread, harness history and provider input/cache. | No new durable hand-off table is promised. Reading or replacing a worker does not erase its history. |
| Usage | Numeric TurnEnded fields; log and derived timing state; or the existing Claude transcript and bounded reader memory. | Missing/unsafe usage schedules nothing. Sign-out suppresses work but does not delete the harness transcript or provider copies. |
| Caller attribution | Live and historical envelope; receipts; view/thread copies; authenticated clients. | Must survive reconnect and rebuild. R4-TM-1 identifies the missing durable path. |

There is no historical-erasure or account-deletion promise here. Event retention is already open issue 1 at `docs/issues.md:20`. The board contract's privacy section explicitly inventories its copies and says closing a post erases none. Client sign-out cache disposal belongs to the client API; exported files and harness/provider retention remain separate. These existing policies are not silently replaced with a new deletion guarantee.

## Proposed post-build checks

These validate implementation after the decisions above are made. They are not substitutes for settling R4-TM-2's access policy.

| Id | Scenario | Expected result and required evidence | Responsible area |
|---|---|---|---|
| R4-PB-1 | Record each proposed rule-eligible harness, including ordinary approvals, escalation retries, missing metadata and a non-shell execute tool. | Only a qualifying adapter shape is enabled. Preserve scrubbed request frames, pinned shape and X01 to X04 output. If none qualifies, show WS-2 and WS-7a omitted. | Roles WS-2; recorder unit 3p. |
| R4-PB-2 | Disable, remove or expire a rule; revoke its adding device; switch rules off; inject a throwing or unsafe matcher. | Transaction order controls authority. Engine backstops independently refuse persistent, unknown, above-mode and settings answers. Failure routes the original request normally. Preserve event order, receipts and runner calls. | Roles WS-2 and engine WS-7a. |
| R4-PB-3 | Read the same device command and rule answer live, through catch-up, E21 and rebuild; restart before first-use recording. | Device and full caller attribution agree. One RuleFirstUsed and its alert appear. Receipt scoping remains service-wide. Preserve raw stored rows and decoded envelopes. | Client API E11, E12, E14; roles pre-check. |
| R4-PB-4 | Pause/crash/stop/resume a middle parent while all read surfaces are open. Request a hand-off as the inherited holder, original parent, replacement and unrelated agent. | Every surface follows the selected read policy. Refusals contain no excerpt. Preserve caller credentials, snapshots and returned event ids. | Client API visibility; roles WS-1 and WS-6. |
| R4-PB-5 | Drive capacity before and after first content through the real ACP runner and handler; repeat through holds, manual release, restart and provider sign-out. | Capacity is distinct from account pauses. Accepted original work is never repeated. Counts and queue holds survive. Stall-watch-off uses the ordinary return path. Preserve runner outcomes, delivery lineage, account events and rebuilt views. | Engine WS-7b; roles capacity rule. |
| R4-PB-6 | Kill between each stall watch command and action record, including post/flush, carry-on and release. Repeat while switches change. | Completed actions act once; incomplete actions finish under stable ids; off leaves no indefinite hold. Preserve command receipts, calls and live/rebuilt views. | Roles WS-3 and WS-4; board integration. |
| R4-PB-7 | Plant known secrets in role advice, rule notes, request input, hand-off excerpts and transcript records. Include encoded and split forms. | Logs, receipts, stream, replies, notices and alerts contain no planted secret. Transcript-derived records contain numbers/timestamps only. Preserve redacted output and secret-search results without printing the planted values. | Roles WS-1, WS-2, WS-5, WS-6 and WS-7a. |
| R4-PB-8 | Differentially parse accepted shell samples; exercise protected paths, existing aliases and the documented later-link race. | Accepted commands retain the intended words; existing protected aliases never match. Measure the remaining race under known gap 20 without claiming it is prevented. | Roles matcher; engine WS-7a. |
| R4-PB-9 | Run one stall episode against the real service child process with production minutes, separately from the in-process clock suite. | Same nudge, escalation and alert lifecycle as the in-process suite. Preserve socket events and elapsed times. | Roles acceptance and live-check units. |

## Risk register

Scores are severity × fallout × probability. An unresolved design is scored at its worst plausible probability. No severity-floor adjustment applies. Dispositions are left to the owner and lead. Team rule 8 controls the security findings' actual scheduling.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Owner | Decision and deadline | Acceptance and closing evidence |
|---|---|---|---|---|---|---|---|---|
| R4-TM-2 | 6: private thread data can cross the intended agent read boundary. | 7: already read text cannot be recalled. | 6: an unavailable middle parent is ordinary specific use. | 252, fix before release. | Confirmed contradiction; chosen policy unresolved. | Client API reads; roles integration. | Unset. Nominally before release; security scheduling follows team rule 8. | None. |
| R4-TM-1 | 6: security attribution and a named first-use reactor can be wrong until repaired. | 5: one owner needs diagnosis or a storage/reader change. | 6: restarting or reconnecting after a device action is ordinary specific use. | 180, fix before release. | Confirmed storage-inventory omission. | Client API engine units; roles pre-check. | Unset. Nominally before release; security scheduling follows team rule 8. | None. |
| R4-TM-3 | 6: a core capacity-retry flow cannot use the existing internal outcome as specified. | 5: one owner needs a code/configuration correction to resume the promised flow. | 4: one provider overload exposes the missing path. | 120, schedule. | Confirmed internal-contract omission. | Engine WS-7b. | Unset. Within this phase or a dated follow-up with an owner. | None. |
| R4-TM-5 | 2: a builder follows an obsolete integration path. | 1: development-only reference error. | 10: every use of that anchor encounters it. | 20, record. | Confirmed stale anchor. | Roles planner. | Unset. Phase-end review. | None. |
| R4-TM-4 | 1: the compiler/exhaustive check should expose the missing entries before runtime. | 1: development-only integration omission. | 10: adding new tags requires updating the closed table. | 10, record. | Confirmed missing assigned source/test. | Shared contracts and piece units. | Unset. Phase-end review; required build gates still must pass. | None. |

## Noted, not filed

- Known gaps 1 through 21 were considered. Vendor budgets, absent scopes, unbuilt dependencies, fixture/transcript uncertainty, supported-harness limits, the external Foundry rewrite, the initial crash-notice race, alert-view ordering and the later-link race are not re-filed.
- The accepted same-user state-folder limit remains exactly the owner's decision. No finding assumes that file permissions stop an agent running as that user.
- An owner who opts into prefix rules or wider asker modes deliberately authorizes broader commands. The fixed warnings remain. That choice is not a finding.
- Device revocation does not undo prior role-file or settings changes. Those commands already carry owner authority; rules have the separate suspension policy.
- Earlier rounds' generic service-answer concern remains answered for the roles path: the roles service does not call answer, and WS-7a independently checks the selected option. This review does not claim that the roles use a generic service answer after removing it.
- Local file permissions and the absence of historical deletion are existing engine policies. This report does not infer encryption at rest or a device-cache wipe from either.
- The owner's engine-edit authorization is sufficient. No new approval question was sent.

## Refused checks

None.

## Review log and verification limits

The reviewer base, threat-model brief, plan lenses, six security responsibilities, finding labels, risk rubric and grading rubric were read. The supplied plan, decisions, scouting, requests, known gaps, round 1 to round 3 finding maps, round 3 threat-model findings, frozen contracts, rulings, repository guidance, engine security/design sections and relevant engine-plan criteria were inspected.

The checkout's HEAD equals the recorded commit. Node.js 26.13.0 was selected with `nvm use`. Repository source and tests were inspected read-only. No application tests, attack tests, live-account recording, commit, push or team-board action was performed. No implementation test pass is claimed.

Effect test-clock behavior was checked through Context7 on 2026-11-03 against the [Effect 4.0.4 vitest documentation](https://github.com/effect-ts/effect/blob/effect@4.0.4/packages/vitest/README.md), the documented version used by the plan. It supports the plan's stated test-service and clock setup. Claude cache renewal and request-start timing were checked on 2026-11-03 against the [official prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). Those timing claims do not produce a new finding.

One attempted inspection named a nonexistent standalone threads module; the actual thread fold is in `packages/engine/src/views/apply.ts:338`, which was then inspected. One guessed log-test filename was absent; the actual existing test is `packages/engine/test/log/subscribe-gapless.test.ts`, named correctly above. These were read-only lookup corrections, not changes to the plan or repository.

No scratch files or scratch directory were created. The only output is this result file.
