revise
Grade: 6  B/M/m: 0/7/0  Flags: none

## Review basis

This is the logic and failure-policy review of plan v1. The repository was checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. References beginning with `../` resolve from this report. Other code and repository-document references resolve from the recorded checkout. These are plan findings, not claims that an unbuilt board implementation was executed.

The owner’s pending extension-seam decision remains pending. None of the findings silently changes that ruling. The known gaps were excluded from the finding count.

## Findings

### L1. The board omits delivery transitions that its engine already produces

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence status: **Confirmed**. Responsible builder: board units 2a and 3b.

Scenario: The engine sends a board wake, then receives an out-of-usage reply before acceptance. The engine requeues that delivery. Another question arrives for the paused agent. The board still considers the earlier wake sent, so its specified merge rule leaves the real requeued delivery alone and adds another queued board wake. The board now violates its one-queued-wake invariant. An ordinary failed delivery has a related problem: the engine returns it, but the board continues to report a sent wake and has no board-specific repair or notification decision.

Evidence: `../plan.md:272` requires the board fold to handle only `DeliveryQueued`, `DeliverySent`, `DeliveryAccepted` and `DeliveryWithdrawn`, and to ignore every other engine event. The wake index is explicitly part of the board view at `../plan.md:261`. The engine emits `DeliveryRequeued` for an unaccepted usage/sign-in pause at `packages/engine/src/routing/deliveries.ts:147` and for restart recovery at `packages/engine/src/recovery/reload.ts:94`. Its real view handles both requeued and returned states at `packages/engine/src/views/apply.ts:284`. Generic errors return a delivery and leave the target idle at `packages/engine/src/routing/deliveries.ts:130`. The board’s replacement decision depends on the queued/sent distinction at `../plan.md:312`.

Suggested fix: Specify the complete board-wake lifecycle, including requeue and return. Either derive delivery status directly from the engine’s authoritative deliveries view or fold every relevant transition. Decide what a returned board wake does to each unanswered post and how the asker or supervising service learns that delivery failed. Keep the engine’s existing rule that an unclassified error does not automatically retry.

### L2. One per-channel cursor cannot acknowledge the sparse post set in a wake

Severity: **MAJOR**. Category: **Design; Bug (numbers)**. Evidence status: **Confirmed**. Responsible builder: board units 2a, 3a and 3b.

Scenario: A channel has unread informational posts 1–25. Post 26 asks the agent for a reply. Its wake carries post 26 and twenty informational posts. Acceptance must mark precisely those twenty-one posts read. Advancing one channel cursor to 26 also marks five unseen posts read. Leaving the cursor before those gaps leaves the already delivered question unread. Neither value represents the promised state, so unread counts and subsequent flushes can omit unseen messages or resend acknowledged ones.

Evidence: `../decisions.md:29` chooses one cursor per member per channel. `../plan.md:317` includes every required post plus only up to twenty unread informational posts. `../plan.md:337` marks a wake’s posts read on acceptance. The same reading contract appears at `../contract.md:137`. Nothing requires wake contents to be a contiguous prefix.

Suggested fix: Define durable acknowledgements for individual posts or intervals, with a contiguous cursor plus explicit holes if desired. Alternatively, change the packing rule so the acknowledged set is always contiguous without falsely acknowledging omitted posts. Apply the same representation to paged reads, wake acceptance, unread counts and flush. This is a representation decision that can be settled before implementation.

### L3. A partially answered collection has two incompatible outcomes after a crash

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence status: **Confirmed**. Responsible builder: board unit 3b and the board planner.

Scenario: An `all` question names A and B. A replies. B then crashes. Every live addressee has replied, which satisfies the success rule. Every remaining unanswered addressee has crashed, which satisfies the unanswerable rule. If B crashes first and A replies afterward, the post handler instead reaches the live-addressee success rule. The same final replies and agent states can therefore produce different collection results according to which rule runs first.

Evidence: The success rule is “every live addressee has replied” at `../contract.md:80` and criterion 3.4 at `../plan.md:331`. The competing rule closes when “every remaining addressee” stops or crashes at `../contract.md:88` and criterion 3.8 at `../plan.md:335`. These are the completion signal promised to replace work-result collection at `../contract.md:84`.

Suggested fix: Choose one outcome table for mixed replies and unavailable recipients. State whether a death removes an obligation, produces a failed member result, or makes the collection unanswerable. Preserve the original recipient set and each recipient’s disposition in the close result. Define precedence when the author also disappears and whether a resumed recipient can rejoin an unresolved collection. Use the same function for reply handling and the reactor.

### L4. Closing a question does not remove its obsolete queued wakes

Severity: **MAJOR**. Category: **Bug (timing); Design**. Evidence status: **Confirmed omission in the specified lifecycle**. Responsible builder: board units 3a and 3b.

Scenario: An `any` question targets B and C. Both wakes are queued behind active turns. B becomes available first and answers. C’s queued wake still asks C to answer the now-closed question. When C’s current turn ends, C spends another turn on work the board no longer needs. The same omission affects a question whose author stops while recipient wakes remain queued.

Evidence: `../plan.md:307` closes a question and adds the asker to the wake set. The specified withdrawals at `../plan.md:312` replace wakes only for that wake set. There is no invalidation of the other recipients’ queued contributions. `../plan.md:336` closes a vanished author’s questions with “nobody is woken,” but gives no cleanup of already queued recipient wakes. The engine dispatches queued messages after turn end at `packages/engine/src/routing/deliveries.ts:269`; its existing routed-subject helper explicitly withdraws an obsolete queued copy at `packages/engine/src/routing/holders.ts:57`.

Suggested fix: On every terminal post transition, remove that post’s obsolete demand from every still-queued board wake. Withdraw an empty wake or replace a mixed wake while preserving unrelated reasons to wake. Specify that already sent wakes remain immutable, as the plan already requires. This needs a lifecycle rule, not only a dispatcher-race test.

### L5. Membership removal has no policy for queued private text or open obligations

Severity: **MAJOR**. Category: **Security (isolation); Design**. Evidence status: **Unresolved access-boundary decision**. Responsible builder: board units 2b and 3b; plans lead for security deferral.

Scenario: C is busy when a private channel queues a question for C. The manager removes C before the wake is sent. A group-label removal creates the same case. Current membership denies C a board read, but the already queued prompt still contains the private text. If that prompt is suppressed, the question can instead remain open forever because C is live but cannot post its answer in the channel. The plan does not choose either behavior or define a terminal disposition.

Evidence: A manager can remove any member at `../contract.md:45`. Group membership changes with engine labels at `../contract.md:48`. Non-members are refused reads and posts at `../plan.md:278`, and the privacy promise is stated at `../contract.md:145`. The specified reactor handles vanished agents and accepted deliveries at `../plan.md:349`; question closure recognizes stop/crash, not loss of membership, at `../contract.md:88`. Queued wake construction stores the post text in an engine delivery at `../plan.md:314`.

Suggested fix: Define when revocation takes effect for queued text, received history and outstanding replies. For revocation before send, atomically remove inaccessible posts from queued wakes and resolve or reassign the corresponding obligations. If delivery to former members is intentionally grandfathered, state that privacy exception explicitly and route it through the lead under the run’s security-deferral rule. This is distinct from known gap 3, which concerns new members entering through a shared label.

### L6. The frozen caller-rights rule and the board’s sibling messaging rule disagree

Severity: **MAJOR**. Category: **Design**. Evidence status: **Confirmed contract conflict; resolution requires the lead**. Responsible builder: plans lead, client API seam builder and board unit 2b.

Scenario: A parent puts sibling agents A and B in one channel. A asks B a question, or opens their direct channel. The board promises to allow this. The frozen client API contract says that an agent-callable piece command acting on another agent must use the engine’s self/parental-rights rule. A has no such rights over B. Honoring that rule refuses the promised board flow; bypassing it without an explicit exception contradicts the frozen contract.

Evidence: The board expressly permits sibling communication through a shared channel at `../plan.md:81` and direct channels between agents sharing a channel at `../contract.md:55`. The frozen rule is at `../../inputs/client-api-contract.md:222`. Its engine-event helper also cannot produce an event the engine’s own rules would refuse at `../../inputs/client-api-contract.md:157`. Today, the prompt command checks the nearest holder at `packages/engine/src/commands/CommandHandler.ts:73`, and `holderAbove` walks ancestors rather than channel membership at `packages/engine/src/routing/holders.ts:21`.

Suggested fix: Have the lead specify the authority boundary for board-generated deliveries in the frozen seam contract. A narrow exception can make channel-authorized board deliveries possible while keeping ordinary agent prompts under the existing tree rule. Define how the helper distinguishes those cases and rejects attempts to queue arbitrary engine prompts. Do not leave each builder to interpret “acts on another agent” differently.

### L7. A blocking engine wait can deadlock on a child’s board question

Severity: **MAJOR**. Category: **Bug (failures); Design**. Evidence status: **Confirmed interaction missing from the seam plan**. Responsible builder: board unit 3b, client API seam builder and plans lead.

Scenario: Parent A runs the agent-callable `wait --block` on child B during A’s active turn. B posts a board question to A, then ends its turn. The board queues a wake for A and holds B unsettled until the question is answered. A’s blocking wait cannot finish because B is not settled. A cannot receive the queued board question until A’s current turn ends. Neither side can progress.

Evidence: The board registers only “has an open post of its own that needs a reply” at `../plan.md:350` and `../../inputs/client-api-contract.md:588`. The engine already prevents this deadlock for its own questions: `holds` recognizes engine requests/questions at `packages/engine/src/routing/waits.ts:33`, and a blocking wait cancels with “request held” at `packages/engine/src/routing/waits.ts:83`. That recognition does not include board obligations. The blocking loop waits for its wait row to close at `packages/engine/src/routing/waits.ts:162`. Dispatch ordinarily requires an idle target at `packages/engine/src/routing/deliveries.ts:230`.

Suggested fix: Extend the seam’s existing deadlock protection to registered incoming board obligations, including waking an already blocked waiter. This must not remove the board’s outgoing-question settled guard. Decide the hook and cancellation outcome with the lead before building, and preserve unchanged behavior when no piece is registered.

## Truth tables for the interacting rules

These tables distinguish decisions already made from combinations the plan leaves unresolved. “Pending” means the delivery has not been accepted.

| Board wake event | Engine delivery state | Specified board knowledge | Result |
| --- | --- | --- | --- |
| Queued | Queued | Queued | Merging is defined. |
| Sent | Sent | Sent | The wake is immutable. |
| Usage/sign-in pause before acceptance | Queued again | Still sent | L1: the queue index diverges. |
| Ordinary error | Returned | Still sent | L1: failure disposition is missing. |
| Accepted with a noncontiguous post set | Accepted | One channel cursor | L2: exact read state is unrepresentable. |
| Question closes while another recipient wake is pending | Still queued | No specified removal | L4: an obsolete request still wakes. |
| Membership removed while a private wake is pending | Still queued | Read/post permission denied | L5: delivery authority and reply obligation are unresolved. |

For an `all` collection addressed to A and B:

| Replies recorded | Current recipient states | Live-recipient success rule | Remaining-recipient failure rule |
| --- | --- | --- | --- |
| None | A live, B live | False | False |
| A only | A live, B live | False | False |
| A only | A live, B crashed | True | True: B is the remaining unanswered recipient. |
| A only | A crashed, B live | False | False |
| A and B | Both live | True | No unanswered recipient remains. |
| None | Both crashed | Vacuously true unless excluded | True |

L3 needs an explicit, non-overlapping result for the third and sixth rows.

| Parent A | Child B | Board obligation | Can A’s wait end? | Can A receive the question? |
| --- | --- | --- | --- | --- |
| Turn ended, ordinary nonblocking wait | Idle | B waits for A’s answer | No, until answered | Yes, through A’s next turn. |
| Active turn, blocking wait on B | Idle | B waits for A’s answer | No, because B is held unsettled | No, because A’s turn is blocked. L7. |
| Active turn, blocking wait on B | Idle | B asks an engine question held by A | The engine cancels the block as “request held.” | A can answer during its active turn. |

There is no money basis or accounting period in this plan. Request ownership is the seam’s caller-scoped receipt rule. The unresolved enforcement lifecycles are delivery return/requeue, terminal-post cleanup and membership revocation.

## Risk register

Scores are severity × fallout × probability. Each row supplies the reason for each factor. Decisions remain for the owner or lead; this review does not accept risks.

| Id | Severity | Fallout | Probability | Score and band | Evidence | Owner | Decision and deadline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L5 | 6: private channel text reaches a former member | 7: text already disclosed cannot be recalled | 6: membership changes during active turns are ordinary use | **252, fix before release** | Unresolved | Board access/reactor; plans lead | Unset. Security deferral follows team rule 8; record for the manager’s attack list. |
| L6 | 6: sibling board messaging cannot meet both contracts | 3: corrected by a contract and implementation fix | 10: every attempted sibling flow exercises the conflict | **180, fix before release** | Confirmed | Plans lead; seam; board access | Unset; before the next release to real users. |
| L2 | 6: unread/flush behavior remains wrong until manually repaired | 3: the owner can still read the stored posts | 6: a backlog larger than twenty is an ordinary specific workload | **108, schedule** | Confirmed | Board view and wake builder | Unset; within this phase or a dated follow-up with an owner. |
| L7 | 6: the waiting pair requires manual intervention | 3: the owner can answer or stop the blocked work | 6: blocking on a child while it needs clarification is ordinary specific use | **108, schedule** | Confirmed | Board reactor; seam; plans lead | Unset; within this phase or a dated follow-up with an owner. |
| L4 | 4: an unnecessary turn runs and then ends | 3: the agent/app can recover from the obsolete request | 8: first-responder questions with busy recipients are common | **96, schedule** | Confirmed omission | Board post handler/reactor | Unset; within this phase or a dated follow-up with an owner. |
| L1 | 6: failed wake status or delivery requires repair | 3: the owner/service can recover after the policy is defined | 4: one pause, restart or ordinary delivery failure triggers it | **72, schedule** | Confirmed | Board view/reactor | Unset; within this phase or a dated follow-up with an owner. |
| L3 | 6: a collection produces an ambiguous or incomplete completion result | 3: the owner can inspect/reassign the affected work | 4: one recipient failure during collection is sufficient | **72, schedule** | Confirmed | Board reactor/planner | Unset; within this phase or a dated follow-up with an owner. |

No risk has closing evidence yet. No security finding is used here to override the owner’s security-deferral ruling.

## Proposed post-build checks

The fixes above require plan decisions now. These checks verify their eventual implementation.

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| PB-L1 | Pause before accepting a board wake; post another question; return the account. Separately inject an ordinary error. | At most one queued board wake, accurate status, and the decided failure notification/repair behavior. | Committed delivery events, board status, runner prompt counts and live/rebuilt view equality. | Board view/reactor and seam. |
| PB-L2 | Deliver a question after twenty-five unread informational posts. Accept its packed wake, then flush and page the channel. | Every omitted post remains unread; acknowledged posts are not miscounted. | Exact post-id acknowledgement sets before/after acceptance and restart. | Board view/wake builder. |
| PB-L3 | Run each collection truth-table row; reverse reply/crash order; also resume a recipient before closure. | One close, one asker wake and the selected member outcomes, without accidental success through an empty live set. | Full ordered event traces and close payloads. | Board reactor. |
| PB-L4 | Close an `any` question while another recipient is busy. Repeat with a mixed wake and a vanished author. | No queued obsolete question triggers a turn; unrelated wake contributions survive. | Delivery withdrawals/replacements and fake-runner prompt counts. | Board post handler/reactor. |
| PB-L5 | Remove explicit membership and a group label before queued send, including mixed-channel wakes. | The selected revocation policy is enforced, and no open obligation becomes permanently unanswerable merely because posting is denied. | Delivered bodies, access replies, post disposition and restart traces. | Board access/reactor. |
| PB-L6 | Real sibling agent tokens ask and answer through a parent-created channel. Attempt an arbitrary raw prompt through the helper. | Authorized board communication succeeds under the agreed exception; the raw prompt is refused. | Public command results and recorded delivery sources/callers. | Board access and seam. |
| PB-L7 | Parent blocks on child before, and after, the child posts a board question to the parent. | The registered incoming-work rule releases the block once; the answer closes the question; no timer or owner intervention is needed. | Bounded public-API/fake-agent scenario with wait, post and delivery events. | Board reactor and seam. |
| PB-L8 | Race queued-wake replacement against dispatch, and kill after the post/queue transaction commits. | No withdrawn wake is sent; post and queue commit together; replay behavior respects the engine’s documented limits. | Controlled transaction barriers, committed trace and received delivery ids. | Board acceptance and seam. |
| PB-L9 | Replay every reactor-producing event twice, then restart after its input commit but before its output commit. | One durable close/read result, with catch-up from the recorded position. | Reactor checkpoint/output events and rebuilt view comparison. | Board reactor. |

## Noted, not filed

- Known gaps 1–7 remain with their assigned owners. In particular, this review does not re-file group-label widening, package/scoping work, pending owner authorization, or the missing contract text for seam items 13 and 14. Item 12 is present in the supplied frozen client API contract at `../../inputs/client-api-contract.md:588`, so known gap 2 is stale relative to that input.
- The engine permits resend when replay cannot prove receipt. That is already recorded in `docs/issues.md:2716` and `docs/specs/2026-11-01-engine-design.md:530`. The board’s broad “exactly once” language at `../plan.md:37` must be read within this dependency limit. I did not file a new engine defect or reopen that choice.
- A live recipient that never answers is expressly left to the sheepdog at `../plan.md:360`. L5 and L7 concern loss of authority and a deterministic blocking cycle, respectively, rather than that accepted silence policy.
- Parent visibility into a child’s delivered text is expressly disclosed at `../contract.md:145`. It is not a new privacy finding.
- Registered secret redaction, sender labeling and random-marker envelope behavior need implementation evidence. This review makes no new library claim and does not assert those unbuilt checks have passed.
- Review execution: Node.js 26.13.0 was selected with `nvm use`. The checkout matched the recorded commit and remained clean. No application tests were run because the assignment reviews a plan. One guessed recovery filename, `replayScan.ts`, did not exist; file discovery located `recovery/replay.ts` and `recovery/reload.ts`, and the recovery claims above use those checked paths. No scratch files were created, and the assigned scratch folder was absent before completion. Only this result file was written. The plans lead owns any resulting changes to `docs/issues.md` and the manager’s security list.
