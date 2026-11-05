revise
Grade: 6  B/M/m: 0/3/2  Flags: none

## Scope and evidence

This is a review of plan version 5 and board contract version 6 against the frozen client application programming interface (API) contract version 3. Repository code references resolve at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. The checkout was clean. Node.js 26 was selected with `nvm use`.

In references below, `board/` means the task's `shepherd-message-board/` folder, and `inputs/` means its sibling inputs folder. Repository paths are relative to the assigned checkout. Earlier findings, their mappings, the binding rulings, the engine design and decisions, the open issue inventory, and the security rules were consulted. There is no board implementation at this commit. These are plan findings, not claims that an implemented board was exploited or that tests failed in a run. No application tests or attack probes were run.

The recommendation to revise rests independently on the ordinary integration defects below. Team rule 8 says security does not block this planning run. The lead should route the security finding to `docs/issues.md` and the manager's attack to-do list, rather than treating this review as a security veto. This reviewer writes only this report and makes no issue-list or repository edits.

## Findings

### R4-TM-1. The new transactional `board.read` conflicts with the read, receipt and current-access contracts

Severity: MAJOR. Category: Security (access), Design. Responsibilities: access and confidentiality. Evidence status: confirmed contract conflict; the resulting board runtime behavior remains unbuilt. Responsible builders: board/backend and the client API area.

The direct-edit rework deliberately puts `board.read` in the planner table because it writes `board.Read`. This is explicit in `board/decisions.md:110`, engine change B5 at `board/plan.md:328`, task 3a.1 at `board/plan.md:556`, and criterion 5.1 at `board/plan.md:684`. However, the frozen shared contract expressly identifies `board.read` as a paged read, says paged reads are not deduplicated (`inputs/client-api-contract.md:179`, `:193`), and places it in a read table that checks access on each request, takes no writer permit and writes no receipt (`inputs/client-api-contract.md:679`). The board also promises that a read receipt contains only the post-id `board.Read` event (`board/contract.md:420`; criterion 5.11 at `board/plan.md:694`).

The existing transactional handler does not have that receipt behavior. It looks up a caller/request receipt at `packages/engine/src/commands/CommandHandler.ts:237`, returns its stored reply at `:254` before calling the planner at `:260`, and constructs and stores each new reply through the callback at `:269`. The writer stores both envelopes and the complete redacted reply at `packages/engine/src/log/EventLog.ts:210`. Redaction removes registered secrets; it does not remove ordinary post text from a page.

A concrete boundary case is an agent member reading channel C under request R, with the response lost in transit. The manager then removes that member while its agent token stays valid. A retry of R must not become a fresh channel read after removal. Under the specified ordinary planner/receipt path, a page-capable reply would instead be stored and replayed before the membership planner runs. The same path would retain page text in the receipt, contradicting the stated inventory. This is distinct from recalling text already delivered to a harness. It concerns a new API response after access is removed. It is also distinct from the earlier queued-wake revocation fixes, which correctly recheck at send.

R4-TM-3 explains why the present reply constructor cannot yet construct that page at all. Adding page replies to the ordinary receipt machinery without resolving this finding would produce the replay and inventory failures described here. The omission of that constructor does not reconcile the contracts.

Suggested fix: agree on an explicit read-with-read-mark path between the two areas. It must authorize every request against current membership, compute a page under a defined snapshot, and commit the read marks without persisting or replaying the page as a command receipt. If the chosen solution instead changes the published read semantics, name that decision and update both contracts and the storage inventory. Merely adding `board.read` to the read table is insufficient because the specified read table cannot write its read marks. Name the affected handler, read dispatcher and receipt tests in B5/B9. The access decision belongs in the plan; it must not be left to a post-build experiment. Under team rule 8, route the security fix for deferred follow-up as instructed by the owner.

Closing evidence should include a lost-response read followed by member removal and a retry of the same request id, plus a receipt-store inspection proving that ordinary page text was not persisted. Keep token-revocation checks as a separate positive control.

### R4-TM-2. A returned board wake still has an incompatible sender schema

Severity: MAJOR. Category: Design, Bug (failures). Responsibility traced: integrity; the demonstrated consequence is failed delivery recovery, not established permanent corruption. Evidence status: confirmed omission in the shared edit inventory. Responsible builders: client API contracts and board/backend.

Shared edit E15 widens `Delivery.sender` and `PromptSent.sender` from `Actor` to `Sender`, adding a piece and a service (`inputs/client-api-contract.md:833`). Its return-path paragraph at `:853` expressly requires returned piece deliveries. Board B5 and task 3a.3 require keeping `DeliveryReturned` so that the reactor can count returns (`board/plan.md:328`, `:558`, `:600`). Neither edit widens the sender field on that event.

At the recorded commit, `Actor` accepts only owner and agent (`packages/contracts/src/events.ts:8`). `DeliveryReturned.sender` is independently declared as `Actor` at `:162`. The return builder directly copies `row.sender` into it (`packages/engine/src/routing/deliveries.ts:45`). A runner failure uses that return builder before making the agent idle (`:130`). The log validates event envelopes at `packages/engine/src/log/EventLog.ts:182`.

After exactly the named sender edits, the return builder receives a `Sender` but must produce an event that still requires `Actor`. A normal returned board wake therefore cannot satisfy the event type. Bypassing the type would leave a schema rejection rather than the return event that drives the board's retry and second-failure rules. This breaks the promised recovery path, including the round 3 answer about returns after acceptance.

Suggested fix: add `DeliveryReturned.sender: Sender` to E15 and its exact file inventory. Audit other copies of sender-bearing return data without broadening `Actor`, which still serves a different purpose for holders and parents. Add piece and service return cases to `packages/contracts/test/events-roundtrip.test.ts` and `packages/engine/test/routing/deliveries.test.ts`, and exercise the board reactor through the actual failed-delivery path. Retain the existing owner and agent return expectations. A schema-only test of `DeliveryQueued` or a manually fabricated reactor return is insufficient.

### R4-TM-3. The planner table has no planned mechanism for producing board command replies

Severity: MAJOR. Category: Design, Bug (failures). Responsibility traced: integrity and reliable command acknowledgement. Evidence status: confirmed missing engine change. Responsible builders: client API command handling and board/backend.

`board.open` must return a channel id, `board.post` a post id, and `board.read` a page (`board/contract.md:435`, `:437`, `:439`). B1 adds their command schemas, while B5 and task 3a.1 add planners that return events (`board/plan.md:324`, `:328`, `:556`). E3 replaces the supported set and command-planning switch with a table (`inputs/client-api-contract.md:665`). These changes do not address reply construction.

The current `Plan` contains events, optional side rows, and an after-commit effect; it has no normal reply projection (`packages/engine/src/commands/internal.ts:41`). The existing `replyFor` is a closed constructor for engine commands at `packages/engine/src/commands/CommandHandler.ts:97`. It extracts an agent id, question id or delivery id from specific engine events and handles a few named engine commands. It cannot return a board channel id, post id or page from a board event. The handler persists that constructor's result at `:269` and immediately decodes it against the command's success schema at `:249`, `:275`.

Thus the first ordinary `board.open` or `board.post` cannot obtain its promised id through the planned integration. If its schema requires that field, the handler treats the freshly written receipt as unreadable. This decoding happens inside the writer transaction, so it is not evidence that a board write commits without its reply: the transaction can roll back and the `LogWriteFailed` path latches the writer (`packages/engine/src/log/EventLog.ts:261`, `:273`). The finding is the missing board reply path, not a re-filing of the already documented general writer-latch concern. An after-commit reply cannot repair this design: receipt decoding occurs first, and receipt retries omit the after-commit effect (`CommandHandler.ts:258`, `:275`, `:278`).

Suggested fix: name the direct edit to `Plan`, the planner table and the handler's reply construction, or name a complete typed command-to-reply table. Define how a command-specific reply is produced from the committed, redacted batch and stored as the same valid reply returned on retries. Keep read pages subject to the separate access and no-cached-page decision in R4-TM-1. Add the exact source files and existing handler tests to the engine-change inventory. Tests must call the real handler for `board.open` and `board.post`, assert returned ids, retry each request, and prove both reply equality and one logical mutation. Keep all existing engine reply expectations and registered-secret receipt scans.

### R4-TM-4. Dropping stopped agents' owed completions has no permitted rebuildable transition

Severity: MINOR. Category: Design, Bug (timing). Responsibility traced: integrity; this is obsolete notification state, not demonstrated permanent loss. Evidence status: confirmed contradiction. Responsible builder: board/backend.

Round 3 logic m6 is answered by decision row 95 (`board/decisions.md:105`): owed completions are dropped when their author stops. The reactor now says this at `board/plan.md:593`. However, owed completions belong to the durable board view (`board/plan.md:439`), and the exhaustive fold criterion 2.1 says to fold board events, board delivery acceptance and returns, `AgentStarted` and `AgentGrouped`, and to ignore every other event (`:457`). It excludes `AgentStopped`. The eight planned board events do not supply a completion-drop event (`board/contract.md:449`).

Consider a closed question with an owed completion while its author is unavailable. The author then stops. There need not be any open post to close or delivery acceptance to discharge it. With the prescribed fold, no event removes that completion. A reactor-only in-memory deletion would not survive criterion 2.2's rebuild from the log (`board/plan.md:458`). A stopped agent can later resume in the existing engine (`packages/contracts/src/stateMachine.ts:58`, `:70`), so preserving the obsolete completion can also revive its notification.

This re-files the failed mechanism behind m6, not its policy question: the policy answer is present, but the explicit fold contract still forbids implementing it persistently.

Suggested fix: fold `AgentStopped` to clear that agent's owed completions and update criterion 2.1, or specify a dedicated logged transition and revise the event inventory. Test a completion already owed before stop, rebuild from the log, then resume. The completion must remain absent from both the live view and snapshot.

### R4-TM-5. B2 omits an exhaustive event consumer and a required visibility fixture edit

Severity: MINOR. Category: Design (integration and test inventory). Responsibilities traced: access and integrity assurance. Evidence status: confirmed source and test inventory omissions. Responsible builders: board/contracts and the client API contracts area.

B2 lists `events.ts`, board events and `visibility.ts`, and names only the existing event-roundtrip test as gaining board cases (`board/plan.md:325`). The proposed scopes likewise omit `stateMachine.ts` and the engine subscribe visibility fixture (`board/plan.md:884`). E5 asserts that engine views ignore piece tags but inventories only the union change (`inputs/client-api-contract.md:693`).

The existing lifecycle `eventTable` is explicitly a `Record<Event["_tag"], ...>` and requires a decision for every event (`packages/contracts/src/stateMachine.ts:78`). Adding eight union tags without editing it leaves an incomplete typed record. The plan must name the explicit keep behavior, or a deliberate dispatcher change, even though board events are not intended to change lifecycle state.

Separately, `packages/engine/test/api/subscribe-visibility.test.ts:35` enumerates the full union, but its payload fixtures are a manually enumerated `samples` table at `:52`. The test at `:149` requires the fixture keys to equal every union tag. Eight new board events require eight new samples. That existing test file is not in B2, while criterion 6.6 forbids changes to existing test files not named by the engine-change table (`board/plan.md:728`). E8's earlier service case does not supply fixtures for board event schemas introduced later.

Suggested fix: name `packages/contracts/src/stateMachine.ts` and the subscribe visibility test in B2, assign their units and scopes, and specify owner-only cases for all eight board events. Retain the engine event cases. The lifecycle tests should cover the new tags' keep behavior, and the visibility test should continue proving both catch-up and live filtering. These are concrete required build and test gates, so they cannot be waived or risk-scored away. No test run or author process allegation is implied.

## Risk register

Scores use severity × fallout × probability. The numbers describe the planned result if shipped. The owner has not made an acceptance decision on these findings. A fix is not closed until its revised contract and tests have been reviewed.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Owner | Decision and deadline | Acceptance and closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R4-TM-3 | 6: core command replies fail until repaired. | 5: one installation needs a code or support fix. | 10: the missing fields affect normal open and post commands. | 300, fix before release. | Confirmed plan omission. | Client API command handling and board/backend. | Owner decision unset; resolve before the next release. | No acceptance; require real-handler reply and retry tests plus re-review. |
| R4-TM-1 | 6: private channel text can be returned contrary to current access. | 7: a delivered page cannot be recalled. | 4: a lost response and subsequent access change expose the replay path. | 168, fix before release by the default scale. | Confirmed conflicting contracts; runtime outcome unbuilt. | Board/backend and client API reads. | Security follow-up is deferred under team rule 8; lead records it and informs the manager. The default band is not a planning veto. | No acceptance; require explicit read semantics, revocation retry evidence and receipt inventory evidence. |
| R4-TM-2 | 6: the promised delivery recovery path fails. | 5: correcting the schema requires a code fix. | 4: an ordinary runner delivery failure exercises it. | 120, schedule. | Confirmed omitted sender field. | Client API contracts and board/backend. | Owner decision unset; within this phase or a dated owned follow-up. | No acceptance; require returned piece/service roundtrip and actual runner failure tests. |
| R4-TM-4 | 2: obsolete completion state and an unwanted later notice. | 3: the owner can repair notification state. | 6: stopping an agent with an owed completion is an ordinary specific action. | 36, record. | Confirmed contradictory fold rule. | Board/backend. | Owner decision unset; review at phase end. | No acceptance; require stop, rebuild and resume evidence. |
| R4-TM-5 | Not scored: an exhaustive type check and a required fixture check are implicated. | Not applicable. | Not applicable. | Required gates. | Confirmed missing inventory entries. | Board/contracts and client API contracts. | Correct the inventory and pass the required checks before merge. | No waiver; require complete union consumers and unchanged old visibility assertions. |

## Direct engine changes B1 to B9

The owner authorizes direct engine edits. These findings do not object to that authorization or demand a plugin seam.

| Change | Check against the recorded engine and shared edits | Result |
| --- | --- | --- |
| B1: commands and access | The engine has a closed command group and handler. E1/E2 add schemas and access entries, and the whole-group inventory checks can cover additions. | Preserve the seven agent tools and owner/service differences. The missing reply mechanism is R4-TM-3. |
| B2: event union, visibility and alert source | The event schema is shared with log decoding. The explicit owner-only class is appropriate for board events. | Add the total lifecycle table and full-union visibility fixtures in R4-TM-5. |
| B3: board view | The current views state and apply function need a new field; B3 names `apply`, rebuild, compare-views and fixture changes. | The rebuild requirement is appropriate. Completion cleanup still contradicts the fold inventory, R4-TM-4. |
| B4: reach at queue and send | The engine dispatcher separates queuing from sending. E18 supplies the delivery under judgment, projects the queue batch, and proceeds after withdrawal. | The specified wake-id index and per-post checks address the earlier race. Keep the named delivery and carry-on tests. |
| B5: planners and source rules | `CommandHandler.ts:260` currently dispatches planning; `routing/deliveries.ts:61` currently switches on sources. E3/E16 are relevant edits. | R4-TM-1, R4-TM-2 and R4-TM-3 identify the missing read, returned sender and reply details. |
| B6: unsettled condition | `routing/waits.ts:39` computes settled status and `:49` distinguishes pause/crash reasons. E19 changes the idle predicate. | Keep those existing lifecycle reasons. Test the board condition from the full canonical board and delivery state, then compare its status/snapshot results at one sequence. |
| B7: request-held condition | `routing/waits.ts:33` defines holds, and its cancellation and wait checks use that result. E20 adds board incoming holds. | The no-disposition rule and no-board-event positive control preserve existing behavior. Test the new condition through an actual blocking wait. |
| B8: reactor lifetime | Current handler setup forks followers at `CommandHandler.ts:177`; the shared contract moves reactor lifetime into service wiring. | Register the board once in that scoped service lifetime. No mode-specific delivery code is needed. Verify restart and termination after integration. |
| B9: reads, snapshot and disabled state | Current server special reads are at `packages/engine/src/api/server.ts:153`. E4/E9 provide their replacement tables. | Owner-only board snapshot data, no agent board section, and bounded metadata agree with the privacy rules. Reconcile `board.read` separately under R4-TM-1. |

The report does not certify that every future test edit has been inventoried. R4-TM-5 gives two concrete omissions from the required inventory; R4-TM-2 and R4-TM-3 identify additional cases to name in the shared edits and board table.

## Earlier findings and round 3 answers

The seven grouped round 3 answers remain represented in the rework:

1. A crash does not remove group membership. The view uses label carriers that are not stopped, and distinguishes crash, pause, interrupt and resume (`board/plan.md:447`, `:462`). Lifecycle resolution remains separate from membership.
2. Completion text is bounded to 64 kibibytes (KiB), wake completion text to 128 KiB, and full replies are available through paged `repliesTo` reads (`board/contract.md:248`; `board/plan.md:550`). Keep the encoded-size test; there is no new finding against that adopted truncation policy.
3. Status has a bounded default with condition results and sequence; detailed lists and channels page under 512 KiB. Snapshot condition results must equal full-view results and the helper rejects older summaries (`board/plan.md:689`, `:692`; decision row 89 at `board/decisions.md:99`). That addresses the earlier list-truncation and stale-helper objections.
4. Manager succession is stored in `board.ManagerChanged`, uses structural parent links, and triggers on stop or crash rather than pause. Resuming the former manager restores no rights (`board/plan.md:461`).
5. E18 supplies the delivery identity and projected batch to reach checks and tells the dispatcher to continue after a withdrawal (`inputs/client-api-contract.md:885`). The board preserves this in its wake index and send-time requirements.
6. Completion reply text is subject to the current membership reach check at send (`board/contract.md:157`; `board/plan.md:648`). The new read-receipt finding concerns a different entry point.
7. The third unsettled clause covers questions never accepted, not a question accepted and left unanswered (`board/contract.md:350`; `board/decisions.md:100`). Silent accepted addressees can settle; their asker remains held on its own open post.

The round 3 minor answers are also present: accepted-then-returned wakes do not recount discharged completions or failure counts (row 91); the idle rule stops after two completion failures while flush can repair them (row 92); late replies can upgrade dispositions except `replied` (row 93); services cannot be addressees (row 94); agents cannot choose another group anchor (row 96); and incoming paging includes carried unanswered questions as well as overflow (row 97). R4-TM-2 prevents the promised return event from passing through the newly widened sender model. R4-TM-4 explains precisely why the stop-completion answer in row 95 still lacks a durable implementation path. These are the exceptions to treating the earlier answers as held.

The earlier rounds' same-channel reply check, sparse read watermark, late-join positions, channel and subtree access checks, namespace-restricted queued withdrawal, fixed author headers, registered-secret redaction, durable completion obligation, explicit thread-visibility exception and no board system-post policy remain stated. The direct-edit rework does not revoke them. R4-TM-1 is a new conflict introduced by locating the read in the ordinary receipt path; it is not a repeat of the answered queued-wake access issue. Known gaps concerning vendor assignment, scopes and exclusions remain known gaps, rather than new findings here.

## Trace through the six security responsibilities

### Isolation

This is a single-owner engine. Agent channel membership limits API disclosure and routing mistakes; it is not a separate person's encrypted tenancy. The owner and paired devices may see the board, services have named privileges, and agents may read channel pages only while members. Board events are owner-only, and agent snapshots have no board section. Parent visibility into a child's thread is an explicit exception, including quoted board text (`board/contract.md:410`). Group anchors and structural subtree checks prevent accidental access through a shared label. Same-operating-system-user access to the event log is explicitly acknowledged, not newly introduced by this board.

### Identity across sessions

Agent identity comes from the authenticated engine caller, and invalid or stopped-agent credentials are rejected. The existing handler validates agent credentials before transactional receipt lookup (`packages/engine/src/commands/CommandHandler.ts:201`). Session revocation is separate from channel-member removal, which is why it does not answer R4-TM-1. Paired devices act as the owner but retain device metadata. A network caller cannot choose a service identity; service callers are in-process identities under E13.

Device cache clearing on sign-out, reconnect after revocation, and pairing a different installation belong to the client API/device lifecycle. They require integration evidence, not an invented multi-person account model in this board. Provider account sign-out controls the ability to dispatch using that account; it does not change board membership. The existing dispatcher checks provider-account usability before sending (`packages/engine/src/routing/deliveries.ts:230`). Preserve that guard when adding piece delivery. Provider sign-out must not silently erase an owed completion.

### Access

The important boundaries are the caller-to-command access table, service-to-engine in-process boundary, channel membership, manager privileges, direct-message grants, subtree group membership, queued delivery namespace and send-time reach. Flush is not an agent tool. The helper fixes the piece namespace and wraps the prompt, so untrusted board text cannot select an owner sender or a different delivery source. The dispatcher rechecks every carried post and completion at send; a queued authorization decision is insufficient. Those stated decisions survive the rework. The read-mark and receipt contract needs the explicit resolution in R4-TM-1. Access and rate constraints must apply through the API as well as the terminal tools.

### Integrity

Post events, wake events and queued deliveries are planned in one transaction. The log is the source of truth; the board view is rebuilt and delivery status is taken from the canonical engine delivery view. Reactor actions must reread current state and be idempotent. External duplicate delivery after an ambiguous crash is explicitly permitted while one logical wake remains. Return counts distinguish pre-accept returns from post-accept returns. Stops, crashes and resumes have different effects. R4-TM-2, R4-TM-3 and R4-TM-4 identify concrete holes in those integration mechanisms. They do not establish permanent historical corruption in an implementation that does not exist yet.

### Confidentiality

The data inventory includes `board.PostWritten`, wake `DeliveryQueued`, `PromptSent`, command receipts that queued wakes, the live view, device caches and harness session files (`board/contract.md:415`). Closing a post deletes none of those copies. There is no new deletion promise. Do not present close, member removal or token revocation as erasing previously delivered copies. R4-TM-1 identifies the unaccounted page-reply copy that the ordinary receipt path would add.

The board relies on the engine and client API for encrypted network transport and on the documented owner-user storage boundary for local files. No new board encryption-at-rest layer is specified. The existing same-user log and harness-file exposure is an acknowledged project property; it is not evidence of encrypted local storage. Remote client caches must follow the client's storage and sign-out rules. Preserve the TLS requirement from `SECURITY.md` and do not expose a new plaintext remote board route. Alert metadata, status, snapshots and errors must not copy arbitrary post text outside the documented text-bearing paths.

### Secrets and dependencies

Post text is normalized and redacted before persistence; fixed headers derive from engine-authenticated ids. The event writer redacts events and side rows before commit (`packages/engine/src/log/EventLog.ts:250`), and receipt redaction recursively handles strings and object keys (`:219`). Board receipts and wake copies must use those paths. A secret scan must check all copies, not just `PostWritten`. Registered-token redaction does not imply removal of every credential an agent might invent or paste.

The rework adds no package, lock-file change, copied third-party source or custom cryptographic scheme. It uses the existing Effect 4 and schema libraries. Current Effect 4 schema documentation was checked through Context7 on 2026-11-03: `https://effect.website/docs/v4/api/effect/Schema` and `https://effect.website/docs/v4/schema/basic-usage`. The relevant claim is that tagged schemas validate their variants and `decodeUnknownSync` rejects invalid input; no local Effect experiment was run. Existing credential and shadow-home work remains in its owning engine/client units and known issues.

## Proposed post-build checks

These are verification work, not substitutes for the pre-build contract decisions above.

1. Exercise `board.open` and `board.post` through the actual authenticated handler. Check promised ids, one transaction, identical valid retry replies, conflicting request-id refusal, and continued writer usability.
2. Exercise the agreed read-mark design through the real transport. Interleave a lost response, membership removal, same-id retry, token revocation and rejoin. Inspect persistent receipts for page text and verify the declared storage inventory.
3. Drive a piece wake through actual runner failure both before and after acceptance. Validate `DeliveryReturned`, its sender, retry counts, completion discharge, second-failure suppression and flush repair. Include the shared service sender case.
4. Stop an author with a completion already owed, rebuild without an in-memory checkpoint, and resume. Compare live, rebuilt, snapshot and status state.
5. Run full-union schema, lifecycle and subscribe visibility coverage with all board tags. Check catch-up and live streams for owners, devices, member agents, unrelated agents and parents. Preserve the explicit own-thread/child-thread exception.
6. Race dispatch with removal, direct-grant loss, manager changes, stop, crash and account pause. Include the queue batch projection, the exact delivery under judgment, the next queued delivery after withdrawal, and a mixed wake where only some carried posts remain reachable.
7. Compare full-view condition results with status and snapshot results at the same sequence, including queued, returned, withdrawn and accepted board wakes. Prove a stale status response cannot end the wait helper early and an incoming question releases a blocking wait.
8. Inspect every persisted text copy, transport reply, receipt, alert and error for registered-token leakage and user-controlled author metadata. Check encoded response and completion sizes using escaping-heavy text. Verify client cache clearing and revocation across reconnect under the client API's lifecycle contract.
9. Run the required `pnpm check` and the inventoried engine regressions after integration. Confirm that changes to existing tests match the corrected engine-change table and retain their original engine assertions.

## Refusals and noted items

Refused: none. No check required changing models or invoking a cyber testing lane during this plan review.

Noted, not filed: an owner can deliberately read the local log, inspect a harness session, change their own team, or forward already received board text. That is inside the acknowledged single-owner operating-system boundary. No claim of cross-account exposure is made here. Previously documented retention, scope and vendor-assignment gaps are not re-filed.

Only this result file was written. No repository file was changed, and no commit or push was made. The assigned scratch directory was never created and was absent at completion.
