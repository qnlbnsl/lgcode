revise
Grade: 6  B/M/m: 0/4/1  Flags: none

## Review basis

This is the round 2 logic and failure-policy review of plan version 2 and board contract version 3. The checkout matches `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. Repository references below resolve in that checkout. References beginning `../` resolve from this result file. The supplied client API contract and the binding rulings were used, including L13 to L16.

The findings establish omissions or contradictions in the proposed rules. They do not claim that the unbuilt board was executed. The pending owner decision about the extension seam remains a dependency, not a new finding.

## Findings

### R2-L1. A non-reloadable interruption does not emit the event selected to resolve its board obligations

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence: **Confirmed**. Responsible builder: board unit 3b.

Scenario: A asks B a question in a plain channel. B has an established session that cannot reload. The service restarts. B is marked interrupted and is deliberately left there without a reload attempt. The specified board reactor never resolves B as gone. The post stays open and A remains held unsettled until somebody repairs it manually, although the outcome table requires a non-reloadable interruption to resolve the addressee.

Evidence: The outcome is required at `../plan.md:261` and `../contract.md:126`. The selected reactor input is `AgentReloadFailed` while interrupted, alongside stop and crash, at `../plan.md:451`. The engine actually writes `AgentInterrupted` at `packages/engine/src/recovery/restart.ts:124`, then returns without writing `AgentReloadFailed` when an established session is not reloadable at `packages/engine/src/recovery/restart.ts:159`. Its own wait test handles an interrupted agent whose stored reloadability is false at `packages/engine/src/routing/waits.ts:55`. No engine change is needed to identify this case.

Round 1 disposition: The mixed-outcome and crash/resume table answers L3 and logic M3 in principle. Its answer fails for this specific interruption path because the event named by unit 3b is absent. This does not re-file the engine's existing paused-session recovery issue 152.

Suggested fix: Specify reconciliation of non-reloadable interrupted agents from `AgentInterrupted` and the recovery snapshot, as well as actual reload failures. Keep a reloadable interruption unresolved while recovery is attempting it. State when a failed attempt becomes terminal and preserve the chosen immutable disposition across a later fresh resume. Add this exact no-attempt case to criterion 4.1.

### R2-L2. Revoking a direct channel's grant strands questions already in that direct channel

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence: **Confirmed omission**. Responsible builder: board units 2b and 3c.

Scenario: Sibling agents A and B share plain channel C, which is their only qualifying relationship. A opens direct channel D with B and asks B a question there. The manager removes A from C while B is working. They are still the two explicit members of D, but the direct-channel rule now refuses B's answer. Neither has left D, so the specified leaving-channel rule does not resolve the direct question or withdraw its wake. A remains unsettled on a question that the board no longer permits B to answer. Restoring the original channel membership or an owner intervention is required.

Evidence: The continuing grant check is explicit at `../contract.md:72` and criterion 2.7, `../plan.md:347`. Each wake must also satisfy that current grant at `../contract.md:89`. Membership repair at `../plan.md:459` removes obligations and text for the channel the agent left; `../decisions.md:60` likewise withdraws an author's posts “in that channel.” D still has exactly its original two members. No rule invalidates pending D obligations when the shared non-direct channel disappears.

Round 1 disposition: Threat M2's fix correctly denies a new post after loss of its grant. Rows 45 and 50 do not address the resulting inability to answer an existing direct question. This is an unaddressed consequence of the approved continuing-grant rule, not a request to restore permanent direct-message authority.

Suggested fix: Reconcile existing direct-channel obligations whenever a membership or holder change removes their last qualifying relationship. Define which disposition or withdrawal applies, remove obsolete queued demands, and preserve unrelated demands. An alternative is an explicit, narrowly defined right to answer an already admitted question, but that would amend the current every-post rule and must go through the lead.

### R2-L3. Group membership changes with holder availability, but its cleanup does not follow those changes

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence: **Confirmed rule mismatch**. Responsible builder: board units 2b and 3c, with the lead deciding the intended membership meaning.

Scenario: Agent manager M is idle and manages a group channel. Its labelled child W is a member because W's holder chain passes through M. Another channel member has an open question for W. M pauses for usage while W remains available on another account. M is no longer in W's chain of available holders, so W ceases to satisfy the group membership test even though its label and structural parent did not change. W cannot answer through the channel. The specified membership reactor receives neither a group-label change nor a start for W, and M's pause is not one of its membership inputs. The outstanding question therefore has no matching removal disposition.

Evidence: “Holder” expressly means an idle or working ancestor at `../contract.md:37`. Group membership uses that chain and the current manager at `../contract.md:61`; criterion 2.6 repeats it at `../plan.md:346`. The existing helper skips unavailable ancestors at `packages/engine/src/routing/holders.ts:14` and `packages/engine/src/routing/holders.ts:29`. A usage pause is a `StateChanged` event at `packages/engine/src/routing/deliveries.ts:152`. Unit 3c's membership inputs at `../plan.md:459` are `ChannelMembersChanged`, `AgentStarted` and `AgentGrouped`. Manager rights are described as passing on stop or crash at `../contract.md:54`, which does not settle the pause case.

There is a related recovery edge: `SessionOpened` can restore a previously unavailable agent without another `AgentStarted` or `AgentGrouped` (`packages/engine/src/views/apply.ts:185`). Admission and cleanup must use the same definition across those transitions.

Round 1 disposition: The label-plus-subtree fix closes the original empty-label and unrelated-subtree admission cases. Its new use of a dynamic holder chain has an additional lifecycle consequence. This does not re-file the old group-label widening gap.

Suggested fix: Clarify whether containment means structural ancestry or the chain of currently available holders. Structural containment can keep membership stable while manager authority follows the holder rule. If dynamic holder-chain membership is intended, enumerate availability, recovery and manager-transfer inputs and reconcile every affected channel. State how that policy interacts with the existing rule that a pause leaves a post waiting. This needs a plan decision; a test cannot choose the meaning.

### R2-L4. Completion notices are not preserved as independent reasons for a wake

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence: **Confirmed omission in cleanup and return rules**. Responsible builder: board units 2a, 3a and 3b.

Scenario: A is busy. Its question Q closes and queues the promised completion wake to A. A separate incoming question R is merged into that still-never-sent wake. R is then withdrawn. The specified cleanup retains a replacement only if other posts still need A's reply. Q's completion requires no reply from A, so that condition can withdraw the whole wake and discard Q's owed result. No new Q close occurs to recreate it.

The return path has the same omission even without a merge: if a completion-only wake is returned, the reactor rebuilds it only from still-open must-reply posts. Q is already closed. There is no completion obligation to retry or report as failed. A crash after the close was queued but before it was received also withdraws that delivery, while the stated owed-close rule only covers a close happening while the author is already crashed.

Evidence: The once-at-close result is required at `../plan.md:276` and `../contract.md:145`. Cleanup at `../contract.md:203` creates a replacement only “if other posts in it still need a reply.” Return recovery at `../plan.md:455` and `../contract.md:209` carries only still-open must-reply posts. The wake index lists carried and must-reply posts at `../plan.md:330`, but names no independent pending completion demand. The crashed-author debt at `../contract.md:142` covers closes that happen meanwhile; `../contract.md:216` withdraws wakes on a target crash. An ordinary return is a real engine path, including after acceptance, at `packages/engine/src/routing/deliveries.ts:121` and `packages/engine/src/routing/deliveries.ts:130`.

Round 1 disposition: Rows 46 and 47 fix returned and obsolete incoming requests. Their answer fails when applied to the other promised reason to wake an agent: delivering a completed result. This is narrower than re-filing the original unanswered-request retry defect.

Suggested fix: Track pending completion notifications independently from incoming reply obligations and informational unread posts. Preserve both kinds of required work through merging, cleanup, byte packing, return and crash/resume. Define when a completion debt is discharged, and its bounded failure policy. Ensure loss of the original question's hold does not allow a waiter to report the author settled while a completion debt is still owed.

### R2-L5. The byte-cap recovery hint reads authored questions instead of incoming questions

Severity: **MINOR**. Category: **Bug (user-facing recovery); Design**. Evidence: **Confirmed contradiction**. Responsible builder: board units 1 and 3a.

Scenario: Enough unanswered questions accumulate for T that their text exceeds the 256 KiB wake budget. The wake counts omitted questions and tells T to use `board.read` with `open` set. That query is defined to return T's own open posts. The omitted questions were written by other agents, so the prescribed recovery action does not retrieve them.

Evidence: `../decisions.md:63` gives the exact “N more posts need your reply; run board.read with open set” rule. `../contract.md:180` describes the cap, and `../contract.md:241` says that `open` returns the caller's open posts. Criterion 3.8 at `../plan.md:418` tests the cap and count, without testing the hinted read.

Suggested fix: Give the incoming-open-question query an unambiguous filter and authorization rule, or direct the agent through `board.status` and the appropriate channel pages. Test the actual recovery command against omitted post ids. Do not change the byte cap or add timer wakes to solve this wording/query mismatch.

## Interacting-rule truth table

These are decision-level results, not execution results. “Pending” means no disposition has been recorded.

| Mode and state | Required outcome under the revised table | Review result |
| --- | --- | --- |
| Any; one replied, one pending | Answered; prune the pending recipient's queued demand. | Defined at `../plan.md:268`; original L3/L4 conflict resolved. |
| All; one replied, one pending | Open. | Defined at `../plan.md:269`. |
| All; one replied, one gone or removed | Answered with both dispositions. | Defined at `../plan.md:269`; original mixed-outcome conflict resolved. |
| Either; every addressee resolved, no reply | Unanswerable; notify the author. | Defined at `../plan.md:270`; notification survival is R2-L4. |
| Owner replies in either mode | Answered, even if other addressees remain pending. | Defined at `../plan.md:271`. |
| Author stops or explicitly leaves its question's channel | Withdrawn; no completion wake. | Defined at `../plan.md:273`. |
| Author crashes in a plain channel; question closes while crashed | Preserve the post and queue its owed close when next idle. | Defined at `../plan.md:274`; the different close-before-crash case is R2-L4. |
| Established non-reloadable addressee becomes interrupted without a reload attempt | Gone, irrespective of a later fresh resume. | Required by the table, but the selected input never arrives: R2-L1. |
| Last shared-channel grant for a direct pair disappears | Further direct posts denied; outstanding obligations must get a terminal policy. | Denial is defined; obligation repair is missing: R2-L2. |
| Group manager pauses; labelled descendant's holder chain skips it | Membership changes under the literal rule. | No matching membership reconciliation input: R2-L3. |
| Question R ends inside a wake also carrying completion Q | Remove R and retain Q's completion reason. | Specified replacement test preserves only reply demands: R2-L4. |
| Required posts exceed the wake byte budget | Keep omitted posts open and unread; provide a working retrieval path. | Storage rule defined; the named read points in the wrong direction: R2-L5. |

There are no money bases or accounting periods in this plan. The seam owns command serialization and caller-scoped receipts. The board view fold is now the single read-state writer. Reactor writes re-read current post state in their own transaction (`../plan.md:447`); implementation checks must still prove that immutable dispositions and concurrent replies use the chosen ordering consistently.

## Round 1 answers checked

| Prior finding family | Assessment of the revised answer |
| --- | --- |
| A1/C05/L6 and permission-ceiling reach | L13/L15 and the supplied API contract now authorize the narrow piece-delivery exception. Current-transaction reach is specified. No general sibling-authority contradiction remains. |
| A2/C02/L1, logic M2 and requeue tracking | Reading canonical delivery status resolves the duplicate projection. Fresh versus previously sent wakes and replacement queue order are explicit. Incoming-request retry is defined; completion preservation remains R2-L4. |
| A3/C04/L4, terminal cleanup | Atomic pruning and mixed incoming-request replacement are defined. The new completion-demand interaction is R2-L4. |
| A4/C07/L2, logic M5 and read holes | Watermark plus explicit read ids, exact carried membership and one writer resolve the representation and paging-back defects. |
| L3, logic M3/m2/m3 and author crash/resume | The outcome table removes the competing collection outcomes, filters delivery targets and suspends crashed authors. R2-L1 and R2-L4 identify the remaining uncovered failure boundaries. |
| C03/L5, logic M4 and explicit membership revocation | Close authority and removal dispositions resolve the original same-channel cases. Direct-grant dependencies and dynamic holder membership remain R2-L2/R2-L3. |
| L7, logic M1/m4 and snapshot filtering | Approved seam items 12, 16 and 17, exported conditions and the owner wait helper resolve the written contract gaps. Projected-batch behavior still needs code evidence. |
| Threat M0 to M4, TM-1/TM-2 and author/channel identity | Agent snapshots exclude the board; cross-channel replies are refused; fixed author ids replace display names; continuing reach checks are written. The lifecycle consequences above remain. |
| Threat M5, logic m5 and limits | Wake/page byte budgets and per-manager names are specified; group size follows labels. R2-L5 concerns the recovery query, not the accepted budgets. |
| A5/A6, rollback and restarts | Disablement retains schemas, view and source handling. The permitted uncertain external resend is now distinguished from logical wake identity. |
| C01/C06/C09 and remaining threat minors | Test-project setup is explicitly known gap 5; widened exclusions remain pending under L14; document updates belong to the lead. Owner-question limits, privacy/storage edges, service read access and same-channel replies have explicit answers. |

These are plan-level dispositions only. No named implementation test is represented as already passing.

## Risk register

Scores are severity × fallout × probability. Decisions remain for the owner or lead. No risk is accepted or closed by this review.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Owner | Decision and deadline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R2-L2 | 6: a permitted conversation cannot finish without intervention | 3: the owner can close or restore access | 6: reassignment during an outstanding direct question is an ordinary specific action | **108, schedule** | Confirmed omission | Board access/membership; lead | Unset; within this phase or a dated follow-up with an owner. |
| R2-L3 | 6: a channel's reply and membership rules diverge until repaired | 3: the owner can close affected questions or restore availability | 6: a manager's usage pause on a different account is an ordinary specific case | **108, schedule** | Confirmed mismatch | Board access/membership; lead | Unset; within this phase or a dated follow-up with an owner. |
| R2-L4 | 6: the promised completion notification is lost until someone intervenes | 3: stored replies remain available to read manually | 6: merged incoming work and completion notices followed by cancellation are ordinary specific use | **108, schedule** | Confirmed omission | Board view/wakes/lifecycle | Unset; within this phase or a dated follow-up with an owner. |
| R2-L1 | 6: an author stays unsettled after an addressee cannot recover | 3: the owner can close the post or resume fresh | 4: one service restart with a non-reloadable session | **72, schedule** | Confirmed | Board lifecycle | Unset; within this phase or a dated follow-up with an owner. |
| R2-L5 | 2: the recovery hint opens the wrong set of posts | 3: status and ordinary channel reads offer manual recovery | 6: a burst of long questions is an ordinary specific workload | **36, record** | Confirmed | Board contracts/wakes | Unset; review at phase end. |

No severity-floor adjustment applies. No closing evidence exists. No security deferral is used to dismiss a functional failure or to override the owner's rulings.

## Proposed post-build checks

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| R2-PB1 | Restart with an established non-reloadable addressee. Separately exercise a reloadable interruption and a failed reload. Resume fresh afterward. | The selected terminal policy runs once; a reloadable recovery is not prematurely resolved; fresh resume does not undo a terminal disposition. | Ordered engine and board events, public status, close results and rebuilt view comparison. | Board 3b and seam recovery integration. |
| R2-PB2 | Revoke a direct pair's only shared channel during an outstanding question. Repeat with label removal and loss of holder relationship. | New posts and pending obligations follow the reconciled policy; no inaccessible question strands its author; unrelated wakes survive. | Real-token command results, disposition/close batches, delivered bodies and restart replay. | Board 2b/3c. |
| R2-PB3 | Pause a group manager on another account, restore it, crash it, and reload it. Keep labelled descendants active throughout. | Membership, access, authority and outstanding obligations follow one declared policy at every transition. | Exact member sets, denied/allowed replies, queued wake contents and live/rebuilt equality. | Board 2b/3c. |
| R2-PB4 | Merge completion Q with incoming R, then withdraw R. Separately return a completion-only wake, and crash its target after closure but before acceptance. | Q's result survives, or the explicit bounded terminal-notification policy is recorded. It does not silently become settled work that nobody reports. | Completion-debt identifiers, withdrawal/replacement/return events, author prompt bodies and waiter results. | Board 2a/3a/3b. |
| R2-PB5 | Exceed the body cap with incoming questions and execute the exact hint as the target agent. | Every omitted question is retrievable through the named authorized path; no wrong-direction authored-post filter hides it. | Encoded sizes, packed/omitted post-id sets, exact command payloads and returned pages. | Board contracts/wakes. |
| R2-PB6 | Race a reply with a delayed crash/removal reactor write, including crash, fresh resume and reply before catch-up. Replay the reactor input twice. | The declared ordering yields one immutable disposition and one close, and does not overwrite an already committed reply. | Transaction barriers, original input sequences, committed output sequences and rebuilt view equality. | Board reactor and seam. |
| R2-PB7 | Race dispatcher reservation with merge and cleanup; recheck waits on the projected board batch. | No queued-withdrawn delivery is sent, and every wait condition sees the batch's final board state. | Controlled transaction traces, runner delivery ids and public wait outcomes. | Board wakes, seam and acceptance. |

The original redaction, sender-label, namespace-withdrawal, snapshot and maximum-message checks remain necessary. This review supplies no new claim about Effect or another external library.

## Noted, not filed

- Known gaps were excluded from the finding count. Package/test-project ownership, scopes, vendor allowances, pending seam authorization and the four widened exclusions remain with the lead.
- The supplied API contract already uses the board sender label at `../../inputs/client-api-contract.md:237`. Known gap 4's statement that the supplied API wording still names the caller is stale relative to this review input. L16 resolves the intended behavior, so this is not another finding.
- A live agent deliberately or accidentally never answering remains the sheepdog's responsibility, with `board.close` as repair. The findings above concern questions made unanswerable by the board's own rules or lost completion notifications.
- Same-user disk access, parent visibility and indefinite retention remain the stated boundaries. Existing engine issues 113, 152 and 194 were considered; none is re-filed as a new engine defect.
- Review execution: `nvm use` selected Node.js 26.13.0. Code anchors were checked at the recorded commit. The working tree was clean at the final read-only check. No application tests, dependency installs, repository edits, commits, pushes, delegation or board messages were performed.
- Some initial multi-file reads exceeded the output budget. Relevant review and source sections were reread in smaller reads before relying on them. No failed probe changed a file.
- The assigned scratch directory was never created and was absent at the final check. Only this result file is written. The plans lead owns any resulting issue-list updates.
