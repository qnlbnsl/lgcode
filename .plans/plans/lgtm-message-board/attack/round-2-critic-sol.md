revise
Grade: 6  B/M/m: 0/5/1  Flags: none

## Review basis

This is the round 2 plan-critic review of plan version 2 and contract version 3. Code anchors were checked in the clean checkout at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. In citations, `board/` means the supplied `board-r2/lgtm-message-board/` folder, and `inputs/` means the supplied `board-r2/inputs/` folder. Other paths are relative to the recorded checkout.

The verdict follows the functional gaps below. The security finding C2-04 follows the owner's security-deferral ruling and does not independently block this planning phase. No finding reopens the pending owner decision about the extension seam or the known scope exclusions.

## Findings

### C2-01. MAJOR. A group-channel manager cannot use the channel it opens

Category: Design; Bug (access). Evidence status: confirmed contract contradiction. Responsible builder: board units 2a and 2b, with the board planner.

Scenario: Lead L has workers W1 and W2 carrying label `build`. L opens a group channel bound to that label. This satisfies the rule that an agent in L's subtree carries the label. The new contract admits only label carriers whose holder chain passes through L. L is not a label carrier in this example, so L is not a member. The manager can neither post the hand-off to its workers nor read their responses. Giving L the label does not clearly repair the rule: the engine's holder traversal starts above the agent, so L's own holder chain does not pass through L.

Evidence: `board/contract.md:56` defines the computed membership, and `board/contract.md:61` requires both the label and the holder chain through the manager. The owner is the stated universal read/post exception at `board/contract.md:35`. The command table permits `board.post` for the owner, a member or a service, and `board.read` for the owner or a member, at `board/contract.md:279` and `board/contract.md:281`. Criterion 2.8 expressly refuses a non-member's read and post at `board/plan.md:348`. Today's `holderAbove` starts at `snapshot.agents[id]?.parent`, at `packages/engine/src/routing/holders.ts:21` and `packages/engine/src/routing/holders.ts:23`.

Why round 1 did not close this: decisions row 27 explicitly included the manager in addition to computed members (`board/decisions.md:37`). The later narrowing in row 45 (`board/decisions.md:55`), criterion 2.6 (`board/plan.md:346`) and contract version 3 no longer preserves that exception. The subtree restriction answers the original admission problem, but its new wording excludes the channel's own agent manager.

Suggested fix: State the manager's membership and read/post rights explicitly while retaining the subtree restriction for other agents. Restore the manager exception if that is the intended behavior. Add a criterion in which an agent with no matching label opens the group channel and posts an `all` collection to its labeled children. Cover the replacement manager's rights as well.

### C2-02. MAJOR. Completion wakes have no durable lifecycle after they are queued

Category: Design; Bug (failures). Evidence status: confirmed omission in the specified lifecycle. Responsible builder: board units 2a, 3a and 3b.

Scenario A: A question closes and queues its result to its busy author A. A crashes before the result is sent. The board's source rule withdraws the queued wake and never returns it. The reactor suspends only A's open posts. This question is already closed, and its close was queued before the crash, so the stated rule for a close owed while the author is crashed never records a replacement. A resumes and never receives the promised result.

Scenario B: A receives the completion wake, but its adapter returns an unclassified error. The reactor retries only still-open must-reply posts. A completion concerns a closed question and imposes no reply obligation on A, so it has no surviving entry in that retry set. The author again loses its completion notification. The same distinction matters when cleanup or merging replaces a mixed wake: an unrelated pending completion remains a reason to wake even when there are no remaining must-reply posts.

Evidence: The completion guarantee is `board/plan.md:276` and criterion 3.3 at `board/plan.md:413`. The wake index contains carried posts and must-reply posts, but no completion obligation, at `board/plan.md:331`. Task 3a.3 withdraws a crashed target's wake without returning it (`board/plan.md:429`). The reactor suspends the author's open posts and retries returned wakes with still-open must-reply posts at `board/plan.md:453` through `board/plan.md:458`. Contract cleanup replaces a wake only if other posts still need a reply (`board/contract.md:203`), and the returned-wake rule has the same limitation (`board/contract.md:209`). At the recorded commit, an ordinary error can return a delivery and leave its target idle (`packages/engine/src/routing/deliveries.ts:130`), and target loss withdraws pending deliveries (`packages/engine/src/routing/deliveries.ts:73`).

Why round 1 did not close this: row 46 correctly fixes the canonical delivery-status source and retries unanswered questions. Row 49 correctly covers a question that closes while its author is already crashed. Neither covers a completion that was queued before the crash, nor a failed delivery of an already-closed result. Criterion 4.2 tests only the former ordering (`board/plan.md:476`). This finding is the remaining completion case, not a repeat of the corrected delivery-state projection.

Suggested fix: Treat a completion as a durable reason to wake, distinct from an obligation to reply. Reuse the wake index and owed-close state where possible. Define how a completion survives merge, cleanup, return, target crash and resume, and when acceptance discharges it. Decide what a second failure of a completion delivery reports. Include the complete replies and dispositions in its packing rule rather than relying on the twenty ordinary unread-post slots.

### C2-03. MAJOR. Revoking the shared-channel relationship strands existing direct questions

Category: Design; Bug (failures). Evidence status: confirmed missing transition. Responsible builder: board units 2b, 3a and 3c.

Scenario: A and B share plain channel C. They have no holder/held relationship. A asks B a question in their implicit direct channel D while B is busy. The manager removes B from C. D still has exactly its original two members, but its authorization predicate is now false. B's queued wake in D is not cleaned by the rule that removes C's posts. If B receives it, B cannot answer: every new post in D is now refused. If another board operation tries to rebuild it, the reach check refuses that wake too. A remains held unsettled until someone manually withdraws the question or restores the relationship.

Evidence: A direct channel has exactly two members and each later post requires the holder/held or shared-channel relationship, at `board/contract.md:72` through `board/contract.md:77`. The reach check independently requires that relationship at `board/contract.md:89`. The removal rule withdraws a leaving author's posts in that channel and rebuilds the leaving agent's wakes without that channel's posts (`board/plan.md:459` through `board/plan.md:463`; `board/decisions.md:60`). Neither agent has left D, so those rules do not resolve D's pending question. The outgoing-question condition continues to hold A unsettled at `board/plan.md:465`.

Why round 1 did not close this: row 45 answers threat M2 by rechecking direct access on every post. Rows 49 and 50 answer C03 and L5 for membership loss in the question's own channel. Their combination creates a new state: a direct question remains open although the relationship authorizing every possible answer has disappeared. Rechecking the next post alone detects the denial but supplies no terminal outcome.

Suggested fix: Include loss of a direct channel's supporting relationship in the lifecycle rules. Recompute affected direct pairs when the last shared non-direct channel or holder relationship ceases to authorize them. Apply a stated withdrawal/removal outcome to outstanding questions and clean their queued wakes. Retaining readable history can be a separate decision. Test both loss of the last supporting channel and loss of one of two supporting channels.

### C2-04. MAJOR. Group revocation can commit before the reactor removes an unsent copy

Category: Security (isolation); Design. Evidence status: confirmed coordination gap in the plan and seam contract. Responsible builder: board unit 3c and the extension-seam owner. The plans lead records the deferred security issue for the manager.

Scenario: B has an unsent wake containing a group channel's posts. An authenticated `group` removes B's label. Computed membership denies B immediately. Before the board reactor processes `AgentGrouped`, B becomes idle and the engine dispatcher sends the stored wake. The text was still queued when revocation committed, so the stated exception for text already sent does not cover it.

Evidence: Group membership is computed at every check (`board/contract.md:56`), but cleanup for a label change happens in the later reactor batch (`board/contract.md:212` through `board/contract.md:215`; `board/plan.md:459`). The claimed post-build invariant requires membership at both queue and send (`board/plan.md:590`). Frozen seam item 15 checks reach when a piece queues a delivery, not when the dispatcher sends it (`inputs/client-api-contract.md:648`). The existing group planner writes `AgentGrouped` alone (`packages/engine/src/commands/group.ts:3`). Today's dispatcher selects by lifecycle/account state and a queued delivery (`packages/engine/src/routing/deliveries.ts:230`), commits `DeliverySent` and calls the runner (`packages/engine/src/routing/deliveries.ts:238` through `packages/engine/src/routing/deliveries.ts:255`). Its event follower dispatches independently (`packages/engine/src/routing/deliveries.ts:294` through `packages/engine/src/routing/deliveries.ts:328`). No specified barrier makes that dispatcher wait for the board's revocation reactor.

Why round 1 did not close this: row 50 resolves explicit board membership changes atomically, but assigns engine label changes to an asynchronous reactor. The original TM-2 also required coordination with dispatch. Saying that the reactor's own batch is atomic does not make it atomic with the earlier label change. A post-build check can test a chosen ordering guarantee; it cannot supply the missing guarantee.

Suggested fix: Ask the lead to choose and contract the coordination mechanism, such as a piece validation hook in the dispatch reservation transaction or a guaranteed cleanup step before dispatch becomes eligible. Preserve the engine's existing behavior without registered pieces. Any addition to the frozen seam goes through the lead. Record this finding under the existing security deferral rather than silently changing the revocation promise or treating it as implemented.

### C2-05. MAJOR. The UTF-8 wake cap does not bound the JSON event to one mebibyte

Category: Design; Bug (failures). Evidence status: confirmed size counterexample; network failure has not been executed. Responsible builder: board unit 3a and the client API composition/seam owner.

Scenario: Fifteen required posts each contain 16,384 null characters. Each post meets its character limit. Their text occupies 245,760 bytes in UTF-8, leaving 16,384 bytes under the 256 KiB body cap for short headers and markers. In JSON, each null character requires the six ASCII bytes `\u0000`. The text alone therefore occupies 1,474,560 encoded bytes, before the surrounding event or remote procedure call envelope. The body meets the chosen cap while the event exceeds the promised 1,048,576-byte message limit. Quotes and backslashes also expand, so four-byte Unicode is not the worst serialized case.

Evidence: Posts are unrestricted text apart from the stated character limit (`board/contract.md:110`). The wake cap explicitly measures UTF-8 body bytes (`board/plan.md:397`), whereas the read-page criterion measures encoded text (`board/plan.md:521`). Post-build check 9 tests four-byte characters only (`board/plan.md:595`). The frozen client contract requires the largest single event or reply, including its envelope, to fit the one-mebibyte message limit and claims these caps establish that result (`inputs/client-api-contract.md:570` through `inputs/client-api-contract.md:577`). The current engine transport selects JSON serialization at `packages/engine/src/api/server.ts:128`; stored event text is also serialized with `JSON.stringify` at `packages/engine/src/log/EventLog.ts:178`.

Why round 1 did not close this: row 53 and lead ruling L15 correctly switch attention to bytes and the largest event, but the wake budget is still for the unencoded body. That does not establish the serialized-event bound requested by threat M5. The arithmetic above was checked directly; no service or future board test was run.

Suggested fix: Pack against the encoded delivery/event budget with room for the full protocol envelope, or choose a conservative body limit that covers worst-case escaping. Add controls, quotes and backslashes to the maxima checks, alongside multi-byte Unicode. Keep the existing rule that omitted required posts remain pending and unread.

### C2-06. MINOR. The privacy acceptance criterion contradicts the stated thread exception

Category: Design (acceptance criteria). Evidence status: confirmed overstatement. Responsible builder: board planner and acceptance unit 5.

Scenario: A direct message reaches B. B quotes it in its normal thread output. B and B's parent can see that allowed thread event. Criterion 6.3 says a direct message never appears in any agent's stream, which would reject this intended behavior. Interpreting the criterion as covering only the board's own event tags gives a feasible test, but that qualification is absent.

Evidence: `board/plan.md:552` says a direct message never appears in any agent's `subscribe`, `client.subscribe` or `client.snapshot` reply. The contract explicitly permits a member's parent to see what that member was sent through its thread (`board/contract.md:255` through `board/contract.md:260`). The frozen API preserves agent-scoped engine events (`inputs/client-api-contract.md:339` through `inputs/client-api-contract.md:350`). Today's engine filter permits the agent's own events and its direct child's events (`packages/engine/src/api/server.ts:154` through `packages/engine/src/api/server.ts:158`); `ThreadItem` carries thread text (`packages/contracts/src/events.ts:113`).

Suggested fix: Make criterion 6.3 assert that `board.*` events and the board snapshot section are absent for agents, and that an unrelated non-member cannot obtain the direct message through board reads or unrelated threads. Add a positive control for the documented own/child thread exception. Preserve the engine's existing visibility rules.

## Risk register

Scores use launched behavior. Severity, fallout and probability each use the required 1-to-10 scale. A normal risk band does not override this run's security deferral. Decisions remain with the owner or lead. No finding is accepted or closed by this review.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and normal band | Evidence | Responsible area | Decision, deadline and closing evidence |
|---|---|---|---|---|---|---|---|
| C2-04 | 6: revoked channel text reaches a former member | 7: delivered text cannot be recalled | 4: one scheduling delay lets dispatch win | 168, fix before release | Confirmed plan gap | Board membership; seam; lead | Deferred by run rule 8; manager tracks follow-up. No individual date or closing evidence supplied. |
| C2-02 | 6: a promised completion is lost until manual intervention | 3: the owner can recover the result from board history | 4: one adapter failure or author crash during pending delivery | 72, schedule | Confirmed plan gap | Board view, wakes and lifecycle | Unset; within this phase or a dated owned follow-up. Closing evidence absent. |
| C2-01 | 6: the opener cannot run its group conversation | 3: the owner can recreate or manage the channel | 6: an ordinary agent-opened worker-label channel | 108, schedule | Confirmed contradiction | Board access and planner | Unset; within this phase or a dated owned follow-up. Closing evidence absent. |
| C2-03 | 6: an open direct question becomes unanswerable without closing | 3: the author or owner can withdraw it manually | 6: an ordinary removal of the last shared relationship | 108, schedule | Confirmed missing transition | Board access and membership | Unset; within this phase or a dated owned follow-up. Closing evidence absent. |
| C2-05 | 6: the promised event-size bound can fail on the owner client surface | 3: the owner can use the local surface while the bound is repaired | 4: an unusual but allowed text payload | 72, schedule | Confirmed size counterexample | Board wakes; API composition | Unset; within this phase or a dated owned follow-up. Closing evidence absent. |
| C2-06 | 1: the test expectation exceeds the stated privacy contract | 1: development and verification only | 10: the written criterion always overstates the rule | 10, record | Confirmed | Planner; acceptance tests | Unset; review at phase end. Closing evidence absent. |

## Round 1 reconciliation and gate assessment

The following checks cover the supplied finding-to-decision mapping. They distinguish a written correction from implementation proof.

| Round 1 group | Assessment of the version 2 answer |
|---|---|
| A1, C05, L6; threat M1, M2, M3 | The frozen seam now has the narrow reach exception, same-transaction snapshot and permission check. The original contract conflict is answered. C2-01 identifies the manager lost by the new group rule. C2-03 identifies outstanding direct questions after that relationship is revoked. |
| A2, C02, L1; logic M2 and m1; threat M6 | Reading engine delivery status and distinguishing never-sent from requeued wakes answers the projection and ordering findings. C2-02 identifies completion wakes left outside the repair rule. |
| A3, C04, L4 | Closed recipient demands are explicitly removed, including mixed wakes. C2-02 requires preserving an unrelated completion reason when such a wake is rebuilt. |
| A4, C07, L2; logic M5; read-state part of threat m3 | Row 48 defines exact acknowledgements with a watermark and sparse read ids, one fold writer and restart coverage. No remaining design contradiction found for that answer. |
| A5 and A6 | Rows 58 and 59 define disablement and distinguish one logical wake from external delivery attempts. No repeat finding. |
| C01, C06 and C09 | Test-runner registration is now explicitly known gap 5; widened exclusions stay open under L14; row 60 assigns document changes to the lead. No repeat finding. |
| C08 | Criterion 4.6 is limited to idle settlement and includes a pause control. No repeat finding. |
| L3; logic M3, m2 and m3 | The outcome table resolves mixed dispositions and live-agent wake eligibility. The additional closed-before-author-crash case is C2-02. |
| C03; logic M4; L5; TM-2; threat m6 | `board.close`, removal dispositions and same-channel cleanup answer ordinary explicit removal. C2-03 and C2-04 identify the remaining derived-direct and asynchronous-group cases. |
| Logic M1, L7 and m4; threat M0 | Incoming request-held cancellation, client wait conditions and agent snapshot omission are in the frozen seam and the board criteria. No repeat finding. |
| Threat M4 | Row 63 removes all agent-chosen names from author headers and names original authors in reactor wakes. L16 is binding; no sender-label contradiction remains. |
| Threat M5 | Byte budgets and API maxima tests are now required, but C2-05 shows that the chosen wake metric does not establish the encoded bound. |
| Threat m1, m2, remaining m3, m4 and m5; logic m5 | The owner-question cap, same-user privacy limit, store inventory, no-deletion statement, names scoped per manager, group-size rule and service-read refusal are explicit. No repeat finding. |
| TM-1; logic m6; threat m7 | Same-channel `replyTo` and retained membership are explicitly checked before writing. No repeat finding. |

For the ten gates: gates 1, 2 and 6 need the findings above resolved in the plan. Gate 3 needs no screen artifact. Gate 4 names its source universe and maps the supplied findings. Gate 5 provides risk and mitigation tables for every workstream. Gate 7 is this review round. The inspected gate 8 code anchors resolve at the recorded commit; board targets remain clearly greenfield. Gate 9 keeps the document handoff and engine regression guardrails explicit. Gate 10's missing scopes, package setup and vendor limits remain disclosed launch dependencies, not new findings. The pending seam authorization and WIDENED exclusions remain governed by the supplied rulings.

## Proposed post-build checks

These checks require implementation evidence after the design choices above are written. They supplement the existing eleven checks rather than replacing them.

| Id | Scenario | Expected result | Required evidence | Responsible area |
|---|---|---|---|---|
| R2-PB-01 | An unlabeled lead opens a channel for its labeled workers, reads it and posts a collection. Repeat after manager inheritance. | The chosen manager rule permits the promised conversation; unrelated label carriers remain excluded. | Real agent-token command replies, computed members and wake recipients. | Board access |
| R2-PB-02 | Close a question while its author is working; crash the author before sending its result; resume. Repeat with a returned result wake, a mixed wake and cleanup of another question. | Each completion survives until discharged under the chosen rule, with all replies and dispositions; unrelated cleanup does not remove it. | Ordered post, wake and delivery events, adapter inbound bodies, and rebuild equality. | Board view, wakes and lifecycle |
| R2-PB-03 | Remove the last shared channel that authorizes an outstanding direct question; repeat while a second shared channel remains. | The former case follows its stated terminal/cleanup rule without an indefinite hold; the latter remains usable. | Public membership/post calls, question dispositions, queued deliveries and settled results. | Board membership |
| R2-PB-04 | Hold the board reactor behind a committed label removal, then make the former member idle. Repeat across restart. | No delivery still queued when revocation committed crosses the chosen authorization boundary. | Controlled ordering trace showing membership commit, validation/cleanup and dispatch reservation, plus actual runner inputs. | Board membership and seam; deferred security work |
| R2-PB-05 | Build maximum bodies using controls, quotes, backslashes and multi-byte Unicode, and serialize the full event and protocol message. | Every encoded message fits the declared transport bound; omitted obligations remain open and unread. | Actual encoded byte lengths and a device catch-up through those events. | Board wakes and API composition |
| R2-PB-06 | Deliver a direct message, make the recipient quote it, and subscribe as recipient, parent and unrelated agent. | Board events remain hidden from agents; the documented thread exception works; an unrelated agent receives no channel data. | Event tags and bodies from both subscription surfaces, plus board reads and snapshots. | Acceptance and API visibility |

## Noted, not filed

- Known gaps 1 through 8 were considered. Missing scopes, manifests/test-project setup, vendor allowance checks, owner seam authorization and WIDENED exclusions are not re-filed. Approved seam items 15 through 17 and L16 are present in the supplied frozen inputs.
- No additional scope rule was found that needs a new owner-confirmation finding beyond the disclosed row 44 exclusions. The review does not convert a planner's implementation choice into an owner ruling.
- Current official [Effect RpcGroup documentation](https://effect.website/docs/v4/api/effect/rpc/RpcGroup), checked on 2026-11-03, documents `make`, `merge`, `omit` and `prefix`. That page identifies version 4.1.1, so it does not independently prove pinned 4.0.5 implementation behavior. Existing repository usage of `make`, `merge` and `omit` resolves at `packages/contracts/src/commands.ts:44`, `packages/contracts/src/commands.ts:135` and `packages/contracts/src/commands.ts:137`. No new Effect code or undocumented library behavior is proposed here.
- Node.js 26.13.0 was selected with `nvm use`. Verification consisted of plan/contract review, source inspection and the JSON-size calculation. No application tests, future board tests, dependency installs or live-agent calls were run. No refusal or blocked check occurred.
- Repository files remain unchanged. No commits, pushes, team-board messages, session report, journal entry or issue-list edits were made. The plans lead owns issue-list updates. The assigned scratch folder was never created and was confirmed absent before writing this result.
