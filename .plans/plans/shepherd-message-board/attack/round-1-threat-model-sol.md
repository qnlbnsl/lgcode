ship
Grade: 7  B/M/m: 0/2/0  Flags: none

## Scope and verdict

This is the security threat-model review of the first frozen message-board plan.
The repository was checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`.
The checkout was clean.
No repository files were changed.
No attack testing or application tests were run for this plan review.
No scratch folder was created.

The verdict permits this planning phase to proceed under the owner's security deferral in `team-rules.md:26-30` (rule 8).
It does not clear the two access boundaries below.
The lead must record both findings in `docs/issues.md` and send their substance to the manager for the owner's attack list.
This reviewer writes only this result file, as assigned.
The engine extension remains conditional on the owner's answer, as the supplied rulings require.

References beginning `shepherd-message-board/` or `inputs/` are relative to `/home/qnlbnsl/projects/personal/herdr-synapse/sheprd/.scratch/foundry-runs/foundation-plans-1/review/board-r1/`.
Repository references are relative to the assigned checkout.
`team-rules.md` is in `/home/qnlbnsl/projects/personal/herdr-synapse/sheprd/.scratch/foundry-runs/foundation-plans-1/`.
API means application programming interface.

## Findings

### TM-1. A reply can forward a private channel's text to another channel's asker

Severity: MAJOR.
Category: Security, access and isolation.
Responsibilities: 1, isolation; 3, access; 5, confidentiality.
Evidence status: Confirmed omission in the planned authorization rules.
Responsible builder: The board's access unit 2b and command unit 3a.

Scenario: Agent A asks agent B a question Q in channel C1.
B also belongs to private channel C2, which A cannot read.
B submits a post in C2 with `replyTo: Q`, for example after choosing the wrong channel in a caller.
B is authorized to post in C2.
B is also an addressee of Q.
Under the stated handler steps, the reply closes Q and its text is included in the wake to A.
The board has forwarded a C2 post to a non-member without an authorized bridge between the channels.
This needs neither access to the state folder nor a forged credential.

Evidence: `shepherd-message-board/contract.md:70-75` gives a post its own channel and an optional reference to another post.
It does not constrain that reference to the same channel.
`shepherd-message-board/plan.md:304-321` checks posting access and whether the caller is an addressee of the referenced open post.
It then adds the original asker to the wake set.
There is no same-channel requirement in those steps.
`shepherd-message-board/contract.md:80-83` requires forwarding the replies when the question closes.
`shepherd-message-board/contract.md:145-147` promises channel access only to members and the owner, subject to the stated parent-thread exception.
A can be an unrelated agent rather than B's parent, so that exception does not cover this scenario.

Suggested fix: Resolve `replyTo` against the command's snapshot and require the referenced post to belong to the post's channel.
Require the caller to retain access to that channel.
Reject a missing or cross-channel reference before writing a post or closing a question.
If cross-channel replies are intended, define the separate disclosure authorization instead of treating an addressee check as permission to forward any channel's text.
Keep this as a design decision in the deferred security work, rather than asking a post-build test to invent the boundary.

### TM-2. Removing a member does not define revocation for pending wakes or subsequent answers

Severity: MAJOR.
Category: Security, access and confidentiality; Design, membership lifecycle.
Responsibilities: 1, isolation; 3, access; 5, confidentiality.
Evidence status: Unresolved access boundary in the plan.
Responsible builder: The board's units 2b, 3a and 3b, with the client API seam owner where dispatch coordination is needed.

Scenario: A is a channel member and authors a question addressed to B.
The manager removes A while B is still working.
B later writes its answer in that same channel.
The stated closing rule still queues a wake to A with the answer, although A is no longer a member.
The answer contains text written after A's removal.
This is separate from TM-1 because every post in this example belongs to the same channel.

There is also an undecided pending-delivery case.
A channel post can be copied into a wake while its target is busy or paused.
Removing that target changes command access but has no stated effect on the already constructed wake.
The plan does not say whether membership is a grant at enqueue time or a permission that must still hold when the text is sent.
An unanswered addressee removed from a channel also stays live under the current rules, while losing the ability to post its answer.
That can leave the author's question open indefinitely.

Evidence: `shepherd-message-board/contract.md:44-54` permits explicit removal and makes group membership follow the engine's labels.
`shepherd-message-board/plan.md:264-266` computes group membership at read time without requiring a board event for a change.
`shepherd-message-board/plan.md:304-321` queues the original asker's reply wake without a current-membership condition.
`shepherd-message-board/contract.md:88-93` defines loss of answerability only for stopped or crashed agents.
Membership loss does not satisfy either condition.
The reactor's assigned work at `shepherd-message-board/plan.md:349` covers gone authors, gone addressees and accepted wakes.
It does not assign revocation handling.

The existing dispatcher cannot supply a channel check automatically.
At the recorded commit, `packages/engine/src/routing/deliveries.ts:230-251` selects a stored delivery using the target's lifecycle, account status and live token.
It does not know a board channel or its members.
`packages/contracts/src/events.ts:20-34` stores prompt text inside the delivery.
The planned seam items 13 and 14 add withdrawal and wrapping, not a membership revalidation rule (`inputs/rulings.md:13-14`).

Suggested fix: State when channel revocation becomes effective for every unsent copy and for future answers.
Recheck current membership before forwarding a closing reply.
Define whether removed addressees are cancelled, removed from an all-reply set, or reported as unable to answer.
For unsent wakes, define how affected posts are removed while preserving posts from channels the target may still read.
Coordinate that transition with dispatch so the policy survives a race and a restart.
Do not promise to erase text already accepted by a harness.
If the owner chooses enqueue-time grants instead, document that exception to channel privacy explicitly.
This finding concerns removal and retained delivery rights.
It does not re-file known gap 3, which concerns admission through a widening group label.

## Risk register

The scores use the launched product, including ordinary agent mistakes.
They do not assume a deliberately hostile process reading the owner's files.
The deadline column records the normal risk band separately from this run's owner override.
No individual finding is marked accepted or fixed.

| Finding | Severity score and reason | Fallout score and reason | Probability score and reason | Score and normal band | Evidence | Owner | Decision and deadline | Closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TM-1. A cross-channel reply forwards private text. | 6. Private text reaches an agent outside its permitted channel. | 7. Delivered text cannot be unseen or reliably removed from its conversation. | 6. A valid caller can choose a reply reference and a different channel in one ordinary posting action. | 252, fix before release. | The missing reference constraint is confirmed in the plan. | Board units 2b and 3a. | Deferred by owner rule 8. The normal deadline is before release to real users; this run sets no individual follow-up date. The manager must track it. | None; a revised rule and subsequent implementation evidence are required. |
| TM-2. Membership revocation does not govern derived deliveries. | 6. A removed member can receive private text written after removal. | 7. A delivered answer remains exposed in the recipient's conversation. | 6. Removing a member during an outstanding question is an ordinary lifecycle action. This is the worst plausible probability while the boundary is unresolved. | 252, fix before release. | The revocation policy is unresolved. | Board units 2b, 3a and 3b, with seam support as needed. | Deferred by owner rule 8. The normal deadline is before release to real users; this run sets no individual follow-up date. The manager must track it. | None; the policy must be decided before a check can establish compliance. |

## Trace of the six responsibilities

### Isolation and access

The board is a single-owner system with multiple agent identities.
Paired devices have the owner's board rights by explicit contract (`inputs/client-api-contract.md:198-240`).
Separate provider accounts are not separate board owners.
The board's ordinary read and post rules are membership-based (`shepherd-message-board/contract.md:159-167`).
Its events are owner-only, including for agent subscriptions (`shepherd-message-board/plan.md:225-231`).
That prevents the board events themselves from becoming a second agent read route.
TM-1 and TM-2 identify gaps in the derived delivery routes.

The parent's access to a child's conversation is an explicit privacy limit, rather than an undisclosed promise of channel secrecy (`shepherd-message-board/contract.md:145-147`).
`board.status` separately grants a holder access to the listed status information (`shepherd-message-board/contract.md:166`).
Its implementation should return the declared status projection and should not silently expand that into arbitrary channel history.

### Identity across sessions

The board adds no login, owner-switch or device-cache implementation.
It uses the authenticated command path and records a device post as the owner with the device recorded in the envelope (`shepherd-message-board/plan.md:374-380`).
Agent identity is inherited from the engine's token check.
At the recorded commit, `packages/engine/src/commands/CommandHandler.ts:201-213` verifies the credential before retrieving a receipt.
The existing socket also rechecks revocation and invalidates device or agent connections (`packages/engine/src/api/server.ts:111-126`).
The new board still needs composed-route verification of those properties.
A sign-out or credential revocation does not imply deletion of an already received conversation.
No new cross-person sign-in flow is promised by this board slice.

### Integrity

Posts, closes and queued wakes are planned in the same command transaction (`shepherd-message-board/plan.md:304-322`).
At the recorded commit, `packages/engine/src/log/EventLog.ts:242-277` serializes writes and publishes committed events after applying them to the views.
The board adds rebuild comparisons, duplicate-close checks and dispatch-race checks (`shepherd-message-board/plan.md:272-273`, `335-340`, `433-440`).
No new independent writer is proposed.
Read-position handling for a partially included backlog still needs implementation evidence, as listed below.

### Confidentiality, copies and deletion

The planned data copies are the board post events, copies of text in queued delivery events, receipt data, the in-memory board view and wake index, and replies returned to callers.
The view and wake index are specified at `shepherd-message-board/plan.md:257-264`.
The existing log writes event JSON and receipt JSON in separate tables (`packages/engine/src/log/EventLog.ts:172-185`, `210-214`).
Board text also reaches the recipient harness through the shared delivery interface (`shepherd-message-board/contract.md:109-124`).
Harness conversation storage and any caller-side captures are downstream copies that a channel removal cannot retract.
Owner devices receive board events through the owner stream.
External alerts must carry only fixed text and a link, rather than board contents (`inputs/client-api-contract.md:487-492`).

The board defines no physical deletion command.
A closed or withdrawn post is a logical status, not erasure.
The engine's indefinite event retention is already recorded in `docs/issues.md:20-32` and is outside the engine plan's scope (`.plans/plans/shepherd-engine/decisions.md:8`).
This review does not re-file it.
Any future erasure feature must address delivery copies and receipts as well as the original post.

The board adds no listener or transport of its own (`shepherd-message-board/plan.md:138-146`).
The required encrypted remote channel remains the client API's responsibility under `SECURITY.md:85-87`.
Local file protection is inherited from the engine's file-mode policy (`.plans/plans/shepherd-engine/decisions.md:41`).
That policy is not evidence of encryption at rest.
No board-specific encryption mechanism is proposed, and this review makes no claim that all downstream stores are encrypted.

### Secrets and dependencies

Every board event is required to pass through the engine redactor.
The wake builder also has an explicit stored-secret test (`shepherd-message-board/plan.md:333-334`).
At the recorded commit, `packages/engine/src/log/EventLog.ts:247-254` redacts events before commit.
`packages/engine/src/identity/redactor.ts:208-223` traverses nested string values and keys.
The combined-wake check remains necessary because the board constructs new text from several posts.

Service authors are in-process identities with no wire credential (`inputs/client-api-contract.md:243-275`).
The board explicitly tests that a socket payload cannot forge one (`shepherd-message-board/plan.md:378`).
The plan introduces no named external dependency or copied implementation.
The two package manifests are already known gap 4.
There is no additional dependency finding.

## Proposed post-build checks

These checks verify a decided implementation.
They do not replace the deferred access decisions in TM-1 and TM-2.

| Id | Scenario | Expected result and required evidence | Responsible area |
| --- | --- | --- | --- |
| SEC-BOARD-1 | B posts in C2 with a reply reference to Q in C1, then retries the request. Include an owner caller and a guessed post identifier. | After the suggested TM-1 fix, the command is refused without a post, close or delivery. Preserve public API responses and the committed event batch. If the owner chooses bridging, test its explicit disclosure rule instead. | Board units 2b and 3a. |
| SEC-BOARD-2 | Remove an original asker before its answer arrives. Separately remove a busy or paused recipient before its queued wake sends. Exercise explicit removal, group-label removal, restart and concurrent dispatch. | After the TM-2 policy is decided, future replies and unsent wakes comply with it. Preserve delivery contents and event ordering. Show that retained posts from other channels still arrive. | Board units 2b, 3a and 3b, plus seam dispatch. |
| SEC-BOARD-3 | Use invalid and revoked agent tokens and device credentials for every board command on the composed transports. Revoke a credential on an existing connection. Attempt to supply an agent or service author in a payload. | Refused requests disclose no board data and create no forged author. Record public responses and absence of board effects. Verify the socket and network routes when each exists. | Board unit 4 and client API authentication. |
| SEC-BOARD-4 | Read a direct channel as a non-member through channel reads, channel listings and status calls, and subscribe from unrelated agents. Query a child's status as its non-member holder. | Non-members cannot obtain channel text through an undeclared projection. Holder status contains only its expressly permitted fields. Board events remain absent from agent streams. Preserve response bodies and stream captures. | Board units 2b, 4 and 5. |
| SEC-BOARD-5 | Plant registered raw and encoded secrets in posts and combined wakes. Include metadata, repeated posts and the split-post scenario already named by the plan. Generate an owner alert. | No complete planted secret occurs in stored events, receipt replies, wake bodies or service output. External alert content has no post text. Preserve scan output for each surface. | Board units 3a and 5, plus client alerts. |
| SEC-BOARD-6 | Give an agent 25 unread informational posts, then a question newer than all of them. Accept a wake carrying the question and at most 20 informational posts. Restart before reading the remainder. | The five omitted posts remain unread and retrievable. A single channel cursor does not silently mark them consumed. Preserve status results, read pages and live-versus-rebuilt comparison. | Board units 3a and 3b. |

## Refused checks

None.
No model policy prevented a check.

## Noted, not filed

- A process deliberately reading the owner's credential or database is inside the owner-accepted same-user limitation (`SECURITY.md:34-44`). It is not a new board finding.
- Group-label admission can widen channel access. This is already known gap 3. The security consequence is correctly scoped to the board's admission boundary, so it remains on the existing register without a duplicate here.
- The hold-unsettled hook is present in the supplied frozen client API contract at `inputs/client-api-contract.md:588-595`. Known gap 2's older wording does not create a new finding.
- The package manifests, seam items 13 and 14, and the pending owner answer remain the supplied known gaps. The review uses the lead's binding addendum for items 13 and 14.
- Deliberate escape from a self-imposed user limit is not the basis of either finding.
