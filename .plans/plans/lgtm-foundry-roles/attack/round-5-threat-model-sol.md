ship
Grade: 10  B/M/m: 0/0/0  Flags: none

# Round 5 threat model review

## Verdict and scope

No new confirmed or unresolved finding. Plan v14 is ready to build under the supplied owner and lead rulings. This is a plan verdict, not a claim that the proposed implementation has passed its tests.

I reviewed the roles plan, decisions, scouting, requests, known gaps, earlier finding maps, the supplied client API contract v12, board contract v10, and the binding rulings. I checked the named engine changes at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`, then compared their touched paths with `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`. Repository source references below are relative to the checkout named by their commit. Plan references mean the supplied roles `plan.md`.

The security review uses the owner's current network and caller decisions. It does not reopen the accepted same-user access limit, the open-web design, or the computer-only guard's stated limit. Team rule 8 defers security fixes; it does not remove the obligation to report a newly found defect. I found none to add to the lead's issue list.

## Findings

None. No severity, category, responsible builder, or suggested fix is assigned.

## The six responsibilities

| Responsibility | Trace and result |
| --- | --- |
| Isolation | The roles add no second person's account or tenancy model. They do add boundaries among agents, the owner/device callers, services, and piece code. The command table distinguishes reads from planners. Roles events are owner-only, and the roles snapshot section is absent for agents. Orient follows the shared read rule. Handoff uses the narrower management rule on every request, including a repeat. It ends inherited access when the parent recovers. See plan lines 343–378, criterion 1.3, and criteria 6.4–6.5. |
| Identity across sessions | Durable caller and device identity come from client API edits E11–E12. A rule answer retains both the service caller and `answeredBy`, including after rebuilding the log. The first-use reactor derives its work from those durable records. The rules do not depend on a device's continuing authority to add approvals: adding a rule is now computer-only. A revoked device cannot obtain a repeated read from a receipt. Harness sign-in changes the owner's provider session, not the owner of the roles database. The shared contract explicitly states that the open page has no sign-out and describes lost-phone network revocation; this plan adds no browser identity cache. |
| Access | Standing rules accept only a qualified harness's shell permission request, its own uncut and unredacted input, a recorded adapter-set shell discriminator, and positive evidence that approval remains sandboxed. Model-supplied sandbox fields do not establish that evidence. The engine independently checks the one-time option, ceiling, and settings exclusion inside the request transaction. Services have command-specific allow-lists and no wire credential. Piece writes are namespace-limited. Handoff, release, and orient use their specified distinct rights. See criteria 2.4–2.15, 3.4, 6.5, and 7.2–7.4. |
| Integrity | Rule selection and answer commit together, with separate caller envelopes, one projected wait check, and no approval routing. Publication occurs after the transaction. The first-use and sheepdog records use durable identities and repeatable action ids. Capacity holds belong to the whole queue, survive reload, preserve acceptance, and remain unsettled even when withdrawal empties the queue. Usage is captured before the idle-frame return and travels through the handler to the log. Rebuild, interruption, and complete-batch wait tests are named. See criteria 2.11–2.12, 3.2, 3.9–3.12, and 7.2–7.5. |
| Confidentiality | Roles events use engine redaction. The matcher rejects redacted or cut input. The transcript fallback retains numbers and timestamps only, with a bounded read and no text logging. Handoff uses redacted history and a data envelope. Notice bodies use fixed text and sanitized names. Off-host alerts use the shared contract's restricted fields, fixed titles, and transport rules. Existing local plaintext storage and retained history are disclosed, rather than represented as encrypted or erased. See plan lines 333–339, criterion 5.7, criterion 6.4, and client API sections 4–5. |
| Secrets and dependencies | Neither role files nor standing rules grant a secret-store API. The transcript reader is constrained to a validated session path. The roles create no service secret, network credential, or new token store. They use the existing workspace's TypeScript, Node.js 26, and pinned Effect stack. Design references do not authorize copying code without the repository's attribution requirements. Recording gates precede harness support; an unsupported harness never matches. |

## Data inventory, deletion, and revocation

The following accounts for the roles' data and the shared copies it reaches. Removal of an active rule is not historical erasure.

| Copy | Contents and lifetime |
| --- | --- |
| Event database, write-ahead log, receipts, and side tables | Redacted role file imports, rules, settings, action records, rule answers, usage, and related engine/board events. The log retains history. A rule disable/remove stops future matching in the transaction's views. It does not purge earlier log or receipt records. |
| Rebuilt views and bounded snapshot sections | Active configuration, derived action state, and summaries. Rule words and action history are recovered through bounded paged reads. Agent snapshots omit the roles section. Permission action details exist only on an open request row and leave that row when it closes; their original event remains in history. See criteria 1.3–1.3a and 7.1. |
| Adapter request holds and runner state | The live permission request and turn usage. Restart cancels the old process's permissions. Client API E31 also cancels a stopped asker's requests and withdraws their deliveries. The capacity hold is separate from any particular queued delivery. |
| Transcript fallback and harness session files | Harness-owned conversation files remain outside the roles' retention policy. The fallback opens only the expected session path without following a symbolic link, reads a bounded tail, and retains numbers and timestamps. No transcript text becomes a roles record. See criterion 5.7. |
| Owner's source role file | An external file is imported through the authorized setter. Its contents and hash enter the redacted log. Changing or deleting the source file does not silently change the active imported file. See criterion 1.5 and plan line 645. |
| Board posts, wakes, and harness conversations | Fixed notices and deliberately forwarded handoff text can be copied into board history and an agent conversation. Board author identity, send-time reach checks, and envelopes govern the transfer. Closing a post or withdrawing a wake does not promise to erase an accepted conversation. |
| Browser memory, static cache, and exports | The shared contract keeps read data in memory, not browser storage. Static assets may be cached. A deliberate thread export is an owner-managed file. Closing a page is not a purge of server history or an export. |
| Alert carrier cache and phone notifications | Only the shared alert fields leave the host. Carrier retention, best-effort clear, and manual phone removal govern those copies. Dismissing an alert is not proof of deletion at every destination. |
| Diagnostic logs, proxy logs, and backups | Roles errors contain no event or transcript text. Shared service/protocol logs remain redacted; proxy logs and owner-created backups have their external retention. This plan adds no purge mechanism for them. |
| Existing secret store and provider-side state | The roles add no secret value. Account keys and the carrier token stay under the existing client API/engine rules. Provider revocation can cause a sign-in pause; it neither deletes owner history nor transfers its ownership. Provider session and cache retention are not controlled by these roles. |

No unresolved deletion or identity boundary is being deferred to a test. The absence of historical deletion and encryption at rest is existing disclosed scope, including client API section 5's stored-copy inventory and the recorded engine security model.

## Earlier answers remain in force

I checked all 32 entries in the round 4 finding map against the current criteria. The grouped rows below account for every entry.

| Round 4 finding ids | Current answer and assessment |
| --- | --- |
| A-R4-A1 | E3 has planner replies; reads are classified separately. The sheepdog takes the board post id from the reply. Row 95 and the roles command table retain the answer. |
| A-R4-A2, C-R4-C3, TS-R4-TM-2 | L29's read rule is explicit. Orient uses it; handoff requires management rights. Recovery of an intermediate parent removes inherited access. Row 96 and criterion 6.5 retain the answer. |
| C-R4-C1, TS-R4-TM-4 | Roles events enter all seven lifecycle states through E5; the engine's hold/release events have explicit state effects. Visibility samples and state-machine tests are named. Rows 87 and 97 retain the answer. |
| TS-R4-TM-1 | E11–E12 persist caller/device distinctions; E14 and criterion 7.2 retain the service and rule identity. First-use writes use the piece path. Rows 98–99 retain the answer. |
| Ls-R4-L2, Lo-R4-L3, TO F5 | One projected transaction replaces request routing entirely and runs waits once. PC09–PC10 and PC16 cover held waits, absence of owner alerts, and atomic publication. The owner's helper now also gates on a complete batch. |
| Ls-R4-L1, Lo-R4-L6 | Unknown-reset pauses count as the owner, and known-reset usage pauses count as busy. TI12 and ST22 cover clocks and restart. |
| Lo-R4-L1 | Cache scheduling no longer excludes a nonblocking wait or an agent's own open post. CM18–CM19 preserve the working-worker case. |
| Lo-R4-L2 | Protected worktree folders fail closed. M70 and PC14 cover them. Known gap 22 and the external-worktree documentation preserve the accepted answer. |
| C-R4-C2, Lo-R4-L9 | WS-7c captures idle-frame usage before returning and carries it through the runner schema, handler, and delivery planner. Context uses reported used tokens or the last request, never a turn sum. |
| TS-R4-TM-3, Lo-R4-L8 | WS-7b adds a capacity outcome throughout the runner/handler path, with a recorded or documented source per supported adapter. K14 covers the real path. Capacity is never mapped to a usage pause. |
| A-R4-A3 | WS-7 inventories the existing writers, schema readers, lifecycle cells, visibility samples, fake runner, classifier fixtures, tool list, and command-line parity. E5/E8/E15 supply the shared half. |
| A-R4-A4, C-R4-C4, Ls-R4-L4, TS-R4-TM-5 | Task 4b names the board's engine export and the contracts settled module. The removed seam/package path does not return. |
| Lo-R4-L4, Lo-R4-L7 | The hold condition has a total fail-no contract. Engine hold events count the outage, the ending conditions are explicit, and the capacity return triggers give-up. K13/K15 and CP08–CP10 remain. |
| Lo-R4-L5, Ls-R4-L3 | Sheepdog-only turns do not count as ordinary progress or busy work. A wake containing a completion is ordinary. ST20–ST21 and N19 remain. |
| TO F1, TO F4 | Every word, each part after an equals sign, and every location is resolved through the engine resolver. The work is bounded, off the event loop, and time-limited. The after-commit answer uses its own fiber. PC11–PC13 and PC17 remain. |
| TO F2, TO F3 | The standing-rules identity calls no command. The sheepdog's exact allowed list is pinned in criterion 3.4, including its recovery read. Services cannot answer permissions or close board posts through unused general rights. E23 plus import-boundary and entry-point tests cover bypasses. |
| TO F6 | Release uses the management helper. RL04–RL06 reject a sibling, a child of the target, and an unrelated agent. Command-line parity is named. |

The rounds 1–3 maps also retain their substantive answers. These include the character allow-list, approval-event sandbox proof, exact request input, case-insensitive protected names, symbolic-link resolution, mode history, transaction-time expiry, encoded size limits, bounded handoff overflow, transitive waits with cycle detection, unread-notice tracking, durable action ids, and whole-queue holds.

Later decisions intentionally supersede some older wording. In particular, rules are now added only at the computer, E29 owns permission input fields and their open-row view, the build uses direct engine edits, and L27 makes standing-rule implementation conditional on a qualifying recording. Those are recorded changes, not lost safeguards.

## Joins with the other plans

| Join | Result |
| --- | --- |
| Shared read and management rules | Client API section 3, E21–E22, orient, and handoff agree. Agent recovery reads receive the prescribed envelope and cannot fetch owner-only roles events. |
| Service and piece authority | E13's per-service list, E23's piece batch boundary, the roles command table, and board service restrictions compose. Board permission for a generic service to close a post does not grant that command to this sheepdog. |
| Permission requests and owner waits | E29 provides bounded redacted action details even when no harness qualifies. WS-7a owns only its conditional pre-check. Both agent and owner waits judge the complete rule-answer batch. E31's stop cancellation is reflected in the roles' wait graph and hold tests. |
| Board notice read tracking | Board v10 gives the reader on Read and the wake source id on WakeBuilt. The roles join those to DeliveryQueued and DeliveryAccepted instead of treating a source id as a delivery id. No board.read capability is added to the service. |
| Capacity holds and wake withdrawal | E17/E18 withdrawal normalization, E19's capacityHeld state, board criterion 6.7, and roles criterion 7.3 agree. Empty held queues stay unsettled until release. The integration test is explicitly assigned to whichever unit is built second. |
| Alerts and first-start scans | Roles provide namespaced fixed kinds, owner-recipient sources, explicit end events, and openMatters over rebuilt views. First-use history is not manufactured as a baseline matter. Engine failure-alert suppression is bounded by the acknowledged lag risk and tests. |
| Piece exceptions | E30 guards table functions. The matcher and capacity condition retain their separate total fail-closed/fail-no contracts. No new wrapper or unguarded table route is planned. |

## Engine edits and the later commit

| Named change | Recorded code check and drift result |
| --- | --- |
| WS-7a transaction and independent answer | At 8ff4c9b, `packages/engine/src/commands/CommandHandler.ts:138` opens the runner transaction, `:147` applies wait checks, and `:177` consumes events sequentially. `packages/engine/src/log/EventLog.ts:261` commits before publishing. The plan changes the correct places. At 9e386b0, the corresponding handler anchors are `:140`, `:149`, and `:179`; the transaction requirement still applies. |
| WS-7b classification and delivery | At 8ff4c9b, `packages/engine/src/runner/AcpRunner.ts:162` finishes the turn, `:170` chooses classification, and `:173` constructs a pause. `packages/engine/src/routing/deliveries.ts:165` handles outcomes and `:179` selects a pause reason. At 9e386b0, runner finish is at `:259` and outcome selection at `:270`. The new terminal drain precedes it at `:263`. The plan still needs its distinct capacity outcome and does not require removing the new drain. |
| WS-7b dispatcher, reload, and lifecycle | At 8ff4c9b, `packages/engine/src/routing/deliveries.ts:230` determines dispatch readiness; `packages/engine/src/recovery/reload.ts:84` and `:98` derive retry/carry state; `packages/contracts/src/stateMachine.ts:79` is the exhaustive event table. Those bodies are unchanged at 9e386b0. The later reload change exports the existing bounded setup helper; it does not replace the state derivation that WS-7b edits. |
| WS-7c usage | At 8ff4c9b, `packages/engine/src/runner/AcpRunner.ts:354` handles idle before translation. `packages/engine/src/routing/deliveries.ts:92` writes the persisted turn end. At 9e386b0, the idle branch is at `:487` and still returns at `:496`. The plan's raw-frame-to-log change remains necessary and correctly located. |
| Shared permission-input and caller edits | At 8ff4c9b, `packages/engine/src/runner/AcpRunner.ts:400` handles permissions and `packages/engine/src/log/EventLog.ts:177` stores caller data. At 9e386b0, the permission handler is at `:558` and its redaction calls use credential coverage, for example `:569`. E29 must extend that handler while preserving its coverage guards. The plan assigns the fields to E29 rather than duplicating their writer. |
| Rights helper | At 8ff4c9b, `packages/engine/src/routing/holders.ts:21` selects the available holder above an agent and `:35` checks authority for it. This file is unchanged at 9e386b0. Release and handoff name the correct management boundary. |

The plan names the existing tests affected by each WS-7 behavior change, including classifier fixture kinds and the real-runner loop, runner usage/roundtrip, lifecycle and visibility, permissions and waits, fake runner, restart/delivery behavior, the exact tool list, and command-line parity. A path comparison found no intervening edit to those named test files. The routing and usage checks therefore have no newly discovered test-inventory conflict.

The later commit adds login credential coverage, terminal output, harness defaults/reset, and start cancellation. Those changes do not invalidate a named roles edit. In particular, the new terminal drain and credential-coverage redaction must survive the integration; no finding is based on shifted line numbers.

## Proposed post-build checks

These are implementation checks of settled requirements, not unresolved access decisions.

1. Run the recording gate before enabling any harness. Trace the raw approval event to the command that actually runs. A model field, shell-like title, missing working folder, or escalation approval must never qualify the harness.
2. Run PC01–PC17 through the real command handler. Include a permissive stub matcher, protected symbolic-link operands and locations, timeout, sibling activity, owner-held asker, waiting agent holder, and atomic views publication.
3. Rebuild durable caller/device and service-rule identity from the database, then repeat first-use processing across an interruption between the answer and its audit record. Check a disable committed before the request and two first uses in one batch.
4. Execute the service entry-point refusal tests and the import-boundary test. Verify the sheepdog's exact allow-list, standing-rules' empty list, namespace-only piece writes, and no service answer/start/stop/board-read/board-close.
5. Run board criterion 6.7 with capacity holds through restart, wake replacement, last-wake withdrawal, stopped asker's permission withdrawal, and empty-queue release. Compare persisted events, rebuilt views, agent wait, owner helper, and capacityHeld at complete-batch boundaries.
6. Inject a recorded capacity error before and after delivery acceptance. Preserve accepted content, queue only the appropriate retry/carry-on, count holds in the engine, and keep usage/sign-in outcomes unchanged. Retain the newer terminal-drain behavior.
7. Feed raw idle usage through the real runner and handler, including a second turn without usage and replay. Exercise the transcript fallback with malformed ids, symbolic links, a large file, and credential-like text. Assert that only bounded numeric data leaves it.
8. Test handoff and orient under parent pause and recovery, including a resent read, overflow references, agent envelopes, multibyte input, and redacted content. The replacement must ask its lead for inaccessible predecessor history.
9. Run the in-process real-socket acceptance test with the injected test clock, then the planned real child-process timing check. Confirm fail-closed piece fallbacks, restart behavior, and honest discovery of the intended test files.

The plan already includes these checks or their constituent cases. Their success remains to be demonstrated after implementation.

## Noted, not filed

- No currently demonstrated harness qualifies for standing rules. L27 and known gaps 14, 17, 18, and 21 explicitly gate the feature. I have not treated synthetic matcher tests as evidence of real support.
- A same-user program can read owner files and alter source code that an approved test runs. This is the existing accepted host boundary. Deliberately undermining that boundary is not a new roles finding.
- Symbolic links can change after pre-check resolution. Known gap 20 records that remaining race; the plan does not claim atomic execution-time path protection.
- Protected settings segments also cover .claude/worktrees. Known gap 22 preserves fail-closed behavior and requires documentation of an external worktree location.
- The open-web model and the computer-only guard's limit are explicit owner decisions. Rules.add remains computer-only; this is not equivalent to a separate operating-system identity.
- Historical retention, plaintext local stores, provider/harness session copies, and alert clear limits remain disclosed shared scope. This review does not reinterpret remove, dismiss, stop, or sign-out as secure erasure.
- The sheepdog's service paragraph abbreviates its reads; criterion 3.4 and the frozen service contract expressly include client.event. There is no concrete missing-capability failure to file from that abbreviated prose.
- The pending client API owner question about persistent answers is reviewed using the written recommended refusal. The roles require only one-time allows and no service answer command, so this creates no contradictory roles requirement.
- Contract-only defects belong to the client API review under the supplied rulings. No genuine roles/contract conflict was found.

## Risk register

Empty. There is no new confirmed or unresolved finding to score. Accepted known gaps remain in their existing records; this verdict does not mark them fixed or renew their acceptance.

## Verification record and limitations

The recorded checkout was clean. Node.js 26.13.0 was selected with nvm use. I performed source reads and comparisons only. I did not run application tests, perform attack testing, change repository files, commit, push, or create scratch files.

Context7's library resolution calls returned a monthly quota error. I used official documentation as the fallback, checked on 2026-11-03:

- [Node.js filesystem documentation](https://nodejs.org/api/fs.html) supports the concern about synchronous filesystem work blocking the event loop. The plan explicitly moves bounded resolution off that path.
- [Effect's official testing example](https://github.com/Effect-TS/effect/blob/main/ai-docs/src/09_testing/10_effect-tests.ts) and [the official vitest integration README](https://github.com/Effect-TS/effect/blob/main/packages/vitest/README.md) show TestClock from effect/testing and clock advancement in it.effect. I did not independently retrieve the precise historical 4.0.4 README cited by the planner. No contradiction of that claimed historical lookup was established.
- [Anthropic's prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) supports the five-minute/one-hour lifetime distinction and refreshing cache lifetime on use. Adapter reporting and actual transcript availability remain recording/post-build questions.

refused: none.
