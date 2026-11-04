revise
Grade: 6  B/M/m: 0/3/1  Flags: none

## Review basis and verdict

This is the round 2 security threat-model review of plan version 2 and board contract version 3.
The repository was checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`.
References beginning `board/` mean the supplied `board-r2/shepherd-message-board/` directory.
References beginning `inputs/` mean its sibling inputs directory.
Repository references resolve in the assigned checkout.
API means application programming interface.
RPC means remote procedure call.
JSON means JavaScript Object Notation.

The remaining access defect is deferred under the owner's security ruling in run `team-rules.md`, rule 8.
It does not block this planning phase.
The verdict requests revision for the two message-size design defects, which break the promised device surface independently of security.
The lead must record findings in `docs/issues.md` in the integrated change.
The lead must also pass security findings to the manager's attack list.
This reviewer changes no repository document.
The pending owner decision about the extension seam remains pending.

## Findings

### R2-TM-1. Group revocation can commit before an unauthorized queued wake is sent

Severity: MAJOR.
Category: Security, access and confidentiality; Design.
Responsibilities: 1, isolation; 3, access; 5, confidentiality.
Evidence status: Confirmed gap between the stated transactions.
Responsible builder: Board units 2b and 3c, with the client API seam owner.

Scenario: A busy agent W belongs to group channel C.
A wake containing C's private text is queued for W.
The owner removes C's label from W, and that engine command commits.
W is now a non-member under the computed membership rule.
Before the board reactor processes the group event, W's turn ends.
The dispatcher reserves and sends the existing wake.
The reactor subsequently finds it sent and cannot withdraw it.
The reservation occurred after revocation, so this is outside the accepted exception for text already sent.

Evidence: `board/contract.md:56` computes group membership at every check.
However, `board/contract.md:212` explicitly puts group cleanup in the later reactor batch.
`board/plan.md:447` makes the reactor a follower of committed events.
Its membership work is at `board/plan.md:459`.
The registered reach check authorizes construction, using the queueing transaction's snapshot (`board/contract.md:79`; `inputs/client-api-contract.md:648`).
No dispatch-time check or barrier against unprocessed membership events is specified.
At the recorded commit, `packages/engine/src/commands/group.ts:3` produces the group event alone.
`packages/engine/src/log/EventLog.ts:136` applies committed views before publishing to followers.
The dispatcher checks lifecycle, account state and a live token before writing `DeliverySent`, then sends the stored body (`packages/engine/src/routing/deliveries.ts:230`, `packages/engine/src/routing/deliveries.ts:239`, `packages/engine/src/routing/deliveries.ts:248`, `packages/engine/src/routing/deliveries.ts:255`).
Serializing the reactor's eventual withdrawal against dispatch does not serialize the earlier group revocation against dispatch.

Why the round 1 answer fails: This reopens only the unsent-copy portion of Sol TM-2, also reported as Opus m6 and logic L5.
Decision row 50 (`board/decisions.md:60`) and criterion 4.4 define cleanup, but allow it to lag the membership change.
Post-build check 7 (`board/plan.md:590`) requires membership at send time without assigning a mechanism that can enforce it.
The same-channel reply constraint and the explicit current-membership check for forwarding an answer are adequate plan answers to the other portions of Sol TM-1 and TM-2.
They are not re-filed.

Suggested fix: Agree with the seam owner on a piece-specific authorization check inside the dispatch reservation transaction, or an equivalent atomic invalidation/barrier covering the membership mutation.
Revalidate every carried post, including incidental unread posts.
Rebuild or withdraw an invalid queued wake without losing authorized posts or leaving obligations unresolved.
Cover every input that changes the reach predicate, including group membership, holder changes and a direct pair losing its shared non-direct channel.
Specify how the guard remains effective while the board reactor is disabled, because `board/contract.md:317` still permits queued wakes to be sent.
Keep the existing exception for a delivery reserved as sent before revocation.
The synchronization boundary needs a plan decision; a race test alone cannot supply it.

### R2-TM-2. The owner's full board snapshot cannot remain below the network message limit

Severity: MAJOR.
Category: Design; Bug, failures.
Responsibility: 3, access to the promised client surface.
Evidence status: Confirmed contract contradiction.
Responsible builder: Board unit 4 and the client API snapshot/seam owner.

Scenario: A channel accumulates 65 maximum-size ASCII posts.
Their text alone occupies 1,064,960 bytes.
The owner's first snapshot includes all of that text, plus channel records, read state, wake indexes and the rest of the engine snapshot.
It cannot fit the 1,048,576-byte network limit.
A device opening or resynchronizing the board cannot complete the documented snapshot-first flow.
Closing the posts does not remove them from the view.

Evidence: The view contains posts with text and open or closed status (`board/plan.md:325`).
The owner and devices receive that whole view in one snapshot (`board/contract.md:250`; `board/plan.md:522`).
Posts cannot be deleted (`board/contract.md:166`).
The text limit is 16,384 characters per post (`board/contract.md:110`), with no lifetime post-count cap.
The client starts with one snapshot and then subscribes (`inputs/client-api-contract.md:299`).
The network contract limits one message to 1 MiB and claims that every piece's largest reply fits (`inputs/client-api-contract.md:570`).
The 256 KiB wake cap and 512 KiB read-page cap do not bound this separate reply.

Relation to round 1: The snapshot filter answers Opus M0's agent-disclosure concern.
This finding concerns the size of the newly explicit whole-view owner snapshot.
It does not request weakening that filter or re-file an existing known gap.

Suggested fix: Change the shared contract through the lead.
Return bounded current board summaries in the initial snapshot and page history separately, or define a bounded snapshot transfer with a consistent sequence boundary.
Preserve the data needed by the owner's wait helper without embedding all historical post text.
State the wire bound for every snapshot part and test a board whose retained history exceeds it.
Increasing a finite message limit cannot bound an ever-growing whole-history snapshot.

### R2-TM-3. A 256 KiB UTF-8 wake can still exceed 1 MiB after JSON encoding

Severity: MAJOR.
Category: Design; Bug, failures.
Responsibility: 3, reliable access to the client stream.
Evidence status: Confirmed counterexample to the stated sizing argument.
Responsible builder: Board wake builder, unit 3a, and the client API transport owner.

Scenario: Twelve valid maximum-length posts contain U+0001 characters.
Their text occupies 196,608 UTF-8 bytes before headers.
The merged body can fit comfortably below 256 KiB.
JSON encodes each such character as the six ASCII characters `\u0001`.
Those text characters alone therefore require 1,179,648 bytes on the wire.
A single delivery event containing the body exceeds 1 MiB.
A device catching up encounters the same oversized event again after reconnecting.

Evidence: `board/contract.md:110` limits text by length but does not prohibit these characters.
`board/contract.md:180` caps the unencoded UTF-8 body.
`board/plan.md:397` uses the same budget.
The stored wake body appears in delivery events (`board/contract.md:260`).
The existing server selects JSON RPC serialization at `packages/engine/src/api/server.ts:128`.
The client API's assertion that the raw body cap plus envelope fits the network message is at `inputs/client-api-contract.md:570`.
Post-build check 9 tests four-byte characters (`board/plan.md:595`), which does not exercise JSON's control-character expansion.

Current official documentation was checked through Context7 on 2026-11-03.
The [Effect 4 RPC serialization reference](https://effect.website/docs/v4/api/effect/rpc/RpcSerialization) describes its JSON serializer as encoding whole message payloads.
This confirms the serialization model, not an unbuilt transport test or exact-version implementation proof.
The six-byte escape calculation follows JSON encoding.
An in-memory calculation also confirmed that 262,144 U+0001 characters produce a 1,572,875-byte ASCII JSON object containing only its `text` field.

Why the round 1 answer fails: Opus M5 was answered by decision row 53 (`board/decisions.md:63`).
That answer bounds raw wake bytes, while the failed surface limits encoded messages.
It therefore does not close the oversized-event part of M5.
The page budget says encoded size and need not share this defect.

Suggested fix: Budget the fully serialized event and RPC envelope, with reserved metadata headroom.
Alternatively, derive and enforce a conservative raw-body bound from the maximum serialization expansion.
Keep omitted posts open and unread under the existing overflow rule.
Add control characters, quotes and backslashes to the size cases.
Coordinate the bound with the seam helper's outer envelope rather than counting only the board's inner body.

### R2-TM-4. The storage inventory still omits command-receipt copies

Severity: MINOR.
Category: Security, confidentiality; Design, data inventory.
Responsibilities: 5, confidentiality; 6, secrets.
Evidence status: Confirmed inventory omission.
Responsible builder: Board planner, with the client API seam owner.

Evidence: The complete-copy inventory at `board/contract.md:260` lists events, memory, device caches and harness session files.
It omits the receipts table.
Board mutations use the engine's receipts and transaction path (`board/contract.md:267`; `inputs/client-api-contract.md:140`).
At the recorded commit, `packages/engine/src/log/EventLog.ts:210` stores the committed envelopes in `receipts.result_json`, including when a custom command reply is supplied.
A post's receipt therefore also copies its post event and queued wake text.
This is independent of whether paged reads are deduplicated.

Why the round 1 answer is incomplete: Opus m3 requested every stored copy.
Decision row 55 (`board/decisions.md:65`) adds an inventory but misses this existing store.
There is no new deletion promise, so this is an inventory defect rather than a claim that a shipped purge loses data.

Suggested fix: Add receipt envelopes to the inventory and to the secret-scan surfaces.
Include them in any future purge design.
Do not describe closing a post as erasing any copy.

## Risk register

Scores are severity × fallout × probability.
They describe launched use, without assuming a hostile process reading the owner's files.
No risk is accepted or marked fixed by this review.
The security deferral is the run's existing owner ruling, not a new reviewer decision.

| Finding | Severity score and reason | Fallout score and reason | Probability score and reason | Score and band | Evidence | Owner | Decision and deadline | Acceptance and closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R2-TM-1 | 6. Private channel text reaches an agent after its API access was removed. | 7. Delivered text cannot be recalled from its conversation. | 6. Removing a busy member is ordinary use; the unfenced follower interleaving is scored at its worst plausible probability. | 252, fix before release. | Confirmed plan gap. | Board access/membership and seam dispatch. | Security fix deferred under run rule 8; lead and manager track it. Normal deadline: before release to real users. | No individual acceptance or closing evidence. |
| R2-TM-2 | 6. Device initialization and resynchronization fail until the snapshot contract is repaired. | 3. One owner's deployment is affected; a bounded transfer can recover from the retained log. | 8. Accumulating more than 1 MiB of retained board history is common sustained use. | 144, schedule. | Confirmed contradiction. | Board registration and client snapshot. | Unset; repair in this phase or assign a dated follow-up. | None. |
| R2-TM-3 | 6. One oversized retained event can stall device catch-up until repaired. | 3. One deployment is affected and its stored posts remain available for recovery. | 4. An unusual tool-text/control-character payload is sufficient; no credential bypass is needed. | 72, schedule. | Confirmed sizing counterexample. | Board wake builder and client transport. | Unset; repair in this phase or assign a dated follow-up. | None. |
| R2-TM-4 | 1. An incomplete inventory leaves a documentation and verification gap; no deletion flow is promised. | 1. The demonstrated omission is in the planning artifact. | 10. Every receipted post exercises the omitted copy. | 10, record. | Confirmed omission. | Board planner and seam owner. | Unset; review at phase end. | None. |

## Round 1 answers checked

The complete round 1 finding-to-decision table was checked against this plan and both contracts.
The findings above identify the answers that do not hold fully.
Other answers remain plan decisions awaiting implementation evidence.

- Same-channel replies and current caller membership are explicit in criterion 2.10 and `board/contract.md:113`.
- Sibling reach, group admission and the permission ceiling are explicit in criteria 2.6, 2.7 and 2.9, with a narrow seam exception.
  Those decisions are not reopened.
- Agent snapshots omit the board section.
  Author headers use authenticated ids and fixed words, with the piece sender `board`.
  Service authors remain in-process only.
- Delivery status comes from the engine view.
  Returns have a bounded retry and an undeliverable disposition.
  Read tracking uses a contiguous watermark and explicit read holes.
- Question outcomes, author crash/resume, withdrawal and terminal wake cleanup have explicit rules.
  The incoming-wait condition and the client wait helper are present in seam items 12 and 16.
- Channel ids, per-manager names, group-size policy, owner-question limits, switch-based rollback and uncertain restart sends have explicit answers.
  Their practical enforcement still needs the named tests.
- New-package/test registration, scope exclusions and pending owner authorization remain the known gaps.
  No duplicate finding is filed for them.
  The lead-only issue and feature handoff is consistent.

## Trace of the six security responsibilities

1. Isolation: This is a single-owner system with multiple agent identities.
   Owner devices intentionally have owner board access.
   Board events are owner-only and the agent snapshot omits the board view (`board/contract.md:250`).
   Member reads and same-channel replies have explicit rules.
   R2-TM-1 concerns an unsent derived copy, outside the accepted parent-thread and same-user disk exceptions.
2. Identity across sessions: The board adds no owner-switch or login system.
   It inherits authenticated agent and device identities.
   The existing handler verifies credentials before retrieving a receipt (`packages/engine/src/commands/CommandHandler.ts:201`).
   The socket rechecks non-owner credentials and invalidates connections (`packages/engine/src/api/server.ts:111`).
   Composed network routes and device-cache clearing still need client-area evidence.
   Provider sign-out pauses delivery; it does not create a different board owner.
3. Access: Commands, service callers, channel membership and reply boundaries are specified.
   R2-TM-1 identifies the remaining dispatch boundary.
   R2-TM-2 and R2-TM-3 identify ordinary failures of the promised device access path.
   Agent text itself grants no permission.
4. Integrity: Events and receipts share the command transaction.
   The board has an explicit rebuild check, outcome table, idempotent reactor and logical-wake guarantee.
   External delivery may repeat without replay proof, as explicitly accepted.
   No permanent-corruption defect was established in this review.
5. Confidentiality and deletion: The declared copies are post events, delivery/prompt events, the memory view, device caches and harness session files.
   Add receipts under R2-TM-4.
   Posts cannot be deleted.
   Existing indefinite retention remains issue 1 (`docs/issues.md:20`), rather than a new finding.
   File-mode protection is not proof of encryption at rest.
   No board-specific encryption layer is proposed, and this review does not certify downstream-store encryption.
   Remote encryption remains the client API's obligation under SECURITY.md rule 5.
   External alerts must carry no post text (`inputs/client-api-contract.md:515`).
6. Secrets and dependencies: Every event must pass the engine redactor.
   Registered-secret and combined-wake checks are planned.
   Harness login-token coverage remains a post-build check, not an assertion of success.
   The board adds workspace packages but names no new external dependency or copied implementation.
   Package registration remains known gap 5.

## Proposed post-build checks

These verify decided rules.
They do not replace the missing transaction and wire-budget decisions above.

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| R2-PB-1 | Delay the board reactor after a group-label removal commits, then release the target's busy turn. Repeat across restart and board disablement. Include a mixed-channel wake. | No delivery reserved after loss of reach contains inaccessible posts. Authorized posts survive, obligations resolve, and already-sent copies follow the documented exception. | Ordered mutation/reservation transactions, captured runner bodies and rebuilt views. | Board units 2b/3c and seam dispatch. |
| R2-PB-2 | Retain at least 65 maximum ASCII posts and much more than 1 MiB of history, then initialize and resynchronize a real paired-device connection. | Snapshot transfer and subsequent subscription complete within the chosen per-message budget at a consistent sequence. Agent snapshots still omit the board. | Encoded wire sizes, snapshot pages/parts, sequence boundary and device-visible results. | Board registration and client snapshot. |
| R2-PB-3 | Merge maximum-length posts containing U+0001, quotes, backslashes and four-byte characters. Exercise live and replayed delivery events and read pages. | Every fully encoded message, including framing/envelope fields, fits the listener limit. Omitted posts stay discoverable and unread. | Serialized messages measured in bytes and successful network catch-up. | Board unit 3a and client transport. |
| R2-PB-4 | Plant registered raw, encoded, split-post and harness-login secrets, then post, merge, read and alert. | No planted secret remains in events, receipt envelopes/replies, delivered bodies or service output. External alerts have no post text. | Separate scans of each stored and transmitted copy. | Board unit 3a, engine redactor and client alerts. |
| R2-PB-5 | Revoke an agent token or device credential on an established connection; try every composed board read and mutation. Attempt an author/service override. | No data or effects after revocation; no forged author; service identity is available only in process. | Socket/network responses, connection closure and committed events. | Board registration and client authentication. |
| R2-PB-6 | Query a child's status as a holder who is not in its channels; query board reads/listings/snapshots/streams as unrelated agents. | Only the declared status projection is returned. No undeclared channel history or raw board view escapes. The documented child-thread exception remains explicit. | Response bodies and captured event streams using real identities. | Board access and acceptance units. |

Keep the existing restart, queued-cleanup, wait-projection and sparse-read checks in the plan.
No implementation check is claimed to have passed.

## Refused checks

None.

## Noted, not filed

The accepted same-user disk-access limit and the parent's visibility of a child's conversation are not new findings.
A deliberate escape from a self-imposed limit is not the basis of any finding.
The general seam authorization, package setup and four WIDENED exclusions remain the supplied pending decisions.
This review does not reopen the owner's agent-only engine wait ruling.

The repository matched the recorded commit and remained clean.
Node.js 26.13.0 was selected with `nvm use`.
No application tests, attack tests, dependency installation, commits, pushes or team messages ran.
Several broad reads exceeded the output budget; the relevant sections and evidence anchors were reread in smaller ranges.
Only in-memory message-size calculations were performed beyond document and source inspection.
The assigned scratch folder was never created and was confirmed absent.
Only this result file was written.
