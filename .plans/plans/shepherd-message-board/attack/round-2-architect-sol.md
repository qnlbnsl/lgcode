revise
Grade: 6  B/M/m: 0/4/0  Flags: none

## Review basis

This is the architect review of plan version 2 and board contract version 3. Repository claims were checked at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. The checkout was clean.

In citations, `plan.md`, `contract.md`, `decisions.md` and `attack/` mean the supplied `board-r2/shepherd-message-board/` files. `inputs/` means the supplied `board-r2/inputs/` directory. Other paths are relative to the assigned repository checkout. API means application programming interface.

The in-process piece, shared schemas, engine transaction and existing delivery interface remain a suitable architecture. Four decisions need correction before builders can implement a consistent contract. None requires a separate board process or another dispatcher.

## Findings

### R2-A1. MAJOR — The full board snapshot defeats the transport size limit

Category: Design; Bug (failures). Evidence status: confirmed contract conflict. Responsible builder: the board planner and client API snapshot/seam owner, through the lead.

Scenario: A board accumulates 65 posts containing 16,384 ordinary ASCII characters each. Their text alone occupies 1,064,960 bytes, exceeding 1,048,576 bytes before any record, view or response framing. Every post is individually permitted. The owner's next `client.snapshot` nevertheless includes the board's entire view. The response cannot meet the network contract's one-mebibyte message limit. The snapshot is the prescribed first step for initial synchronization and recovery, so bounded channel pages do not supply an alternative bootstrap.

Evidence: `plan.md:325` places posts and their text, replies, read state and the wake index in the view. `contract.md:250` explicitly returns the whole board view to the owner, devices and services. `inputs/client-api-contract.md:299` requires snapshot-first synchronization, and `inputs/client-api-contract.md:570` requires the message budget to cover each piece's largest event or reply. Criteria 3.8 and 5.8 bound wake bodies and channel pages (`plan.md:418`, `plan.md:521`), while criterion 5.9 requires the owner's snapshot to hold the board view (`plan.md:522`). No snapshot budget, pagination or chunking is specified. This is a contradiction in the planned responses, rather than a claim about an unbuilt listener's implementation.

Suggested fix: Reconcile the snapshot shape and transfer protocol with the lead. A smaller snapshot containing current board metadata, with history fetched through the existing paged read, is the simpler option. Preserve the data needed by the exported wait conditions. If a complete view must cross the wire, specify bounded chunks and a consistent sequence for the whole transfer. Measure the complete encoded response, rather than treating the wake and page caps as a bound on every board response.

Round 1: The snapshot isolation answer to threat M0 holds: agents receive no board section. The byte-cap answer to threat M5 covers wakes and pages but misses this separate response, newly fixed as the whole view. This does not re-file an unfiltered agent snapshot or reopen the approved transport limit.

### R2-A2. MAJOR — Returned completion wakes lose the answer they owe the asker

Category: Design; Bug (failures). Evidence status: confirmed omission in the specified return policy. Responsible builder: board units 3a and 3b, with unit 2a for the durable wake representation.

Scenario: A asks B a question. B answers, the post closes, and the board queues A's completion wake with the answer. Sending that wake fails with an unclassified adapter error. The reactor's retry rule retains only still-open posts requiring the target's reply. A's question is closed, and A is its author rather than an unanswered addressee. There is therefore no required post for this rule to retain. The question stays closed, and there is no specified pending completion that can produce the promised answer wake later. A second-return rule that resolves an addressee also has no applicable addressee here.

Evidence: `plan.md:276` promises an author wake at every non-withdrawn close. The wake set includes the original asker at `plan.md:382`. However, the durable index lists carried posts and must-reply posts (`plan.md:331`), and the return algorithm at `plan.md:455` requeues only still-open must-reply posts, then resolves an addressee on the second return. `contract.md:209` repeats that restriction. The body recipe also specifies required questions and incidental unread posts, without a separate required completion contribution (`plan.md:397`). Today's engine can return either a sent or accepted delivery after an ordinary error: `packages/engine/src/routing/deliveries.ts:121` and `packages/engine/src/routing/deliveries.ts:130`. A board completion is not an engine question answer; the engine cannot reconstruct its board outcome.

Suggested fix: Represent the closed posts whose completion is still owed as durable reasons for a wake, alongside unanswered incoming questions. Closed-post identifiers in `board.WakeBuilt` can be sufficient; another queue or event family is unnecessary. Carry those reasons and their outcome summaries through merging, replacement, return and crash/resume, and state when the obligation is acknowledged. Define a visible terminal failure and repair path if the completion retry budget is exhausted. Keep these notifications out of the optional 20-post digest. Apply the unsettled guard while an owed completion has not yet been queued.

Round 1: A2 and the returned-wake findings from both logic and threat reviews are answered for an incoming question wake. Their answer fails for the other required wake class, the asker's completion. The source-of-truth fix for delivery status remains valid.

### R2-A3. MAJOR — An unreloadable interrupted addressee need not emit the event the reactor watches

Category: Design; Bug (failures). Evidence status: confirmed mismatch with the recorded engine. Responsible builder: the board planner and reactor unit 3b.

Scenario: An unanswered addressee has a session recorded as nonreloadable and is working when the engine restarts. Recovery marks it interrupted. The adapter cannot reload it, so recovery skips the reload attempt and leaves it interrupted. There is no `AgentReloadFailed`. The board reactor's enumerated triggers never resolve its obligation as `gone`, although the outcome table requires that result. An `all` collection can remain open until someone repairs it manually.

Evidence: The required outcome is “interrupted and cannot reload” at `plan.md:261` and `contract.md:126`. The reactor observes `AgentStopped`, `AgentCrashed` and `AgentReloadFailed` while interrupted at `plan.md:451`; it does not assign handling to `AgentInterrupted` or a recovery reconciliation step. The engine writes `AgentInterrupted` at `packages/engine/src/recovery/restart.ts:123`. For a previously working or idle agent, `reloadInterrupted` returns without attempting a reload when its session is not reloadable (`packages/engine/src/recovery/restart.ts:158`, `packages/engine/src/recovery/restart.ts:159`). The failed-reload event is constructed only after that return (`packages/engine/src/recovery/restart.ts:161`). The engine's own wait predicate recognizes nonreloadable interrupted members directly at `packages/engine/src/routing/waits.ts:55`.

Suggested fix: Define board reconciliation for agents that remain interrupted without a reload attempt. Distinguish these from reloadable agents still recovering and from an interrupted initial start that recovery starts afresh. Specify when the reactor evaluates that state, including startup catch-up, and resolve the affected obligations through the existing outcome function. Ask the lead for a seam hook only if the existing event/reactor lifecycle cannot provide that point. No change to the engine's existing recovery events is needed merely to create a failure event the board expected.

Round 1: Decision row 49 resolves the crash/resume ambiguity in logic M3 and L3. Its claimed coverage of unreloadable interruption does not hold against this real engine path. This is not issue 152: that existing issue concerns a paused agent's failed account return, whereas this scenario has a working agent becoming interrupted.

### R2-A4. MAJOR — Revoking a direct channel's grant strands an existing direct question

Category: Design; Bug (failures). Evidence status: confirmed missing lifecycle decision. Responsible builder: access unit 2b and reactor units 3b/3c, with the lead for the contract amendment.

Scenario: Siblings A and B share plain channel C. They open direct channel D, and A asks B a question in D. The manager removes B from C while that question remains unanswered. Neither sibling holds the other, and C was their only shared non-direct channel. Every subsequent post in D, including B's answer, is now refused. D still has its two members, so nobody has left D. The removal rules resolve obligations in C, not the outstanding obligation in D. A's question remains open and holds A unsettled until an owner, manager or service notices and closes it.

Evidence: `contract.md:72` defines the permanent two-member direct channel and requires its external grant on every later post. The reach check also requires that grant at `contract.md:89`. The membership cleanup at `plan.md:459` resolves addressees leaving a channel and withdraws authors' posts “in that channel.” It does not invalidate dependent direct-channel obligations when their last shared-channel grant disappears. No row of the outcome table at `plan.md:258` covers this loss of reach while both direct members stay live and listed. Criterion 2.7 tests refusing the next direct post (`plan.md:347`), while criterion 4.4 tests leaving the affected channel (`plan.md:478`); neither specifies the outstanding direct question's disposition.

Suggested fix: Include loss of the direct-channel grant in the board's obligation lifecycle. On the transition, resolve or withdraw existing obligations explicitly and clean their queued wakes, while keeping future posts refused. Define an authorized path for any terminal notification, since the existing reach check would also reject a new wake carrying D's posts after the grant ends. History need not be deleted, and this does not grant lifecycle authority over either sibling.

Round 1: Threat M2's every-post grant check is implemented in the revised contract and prevents continued peer posting. Its interaction with rows 49 and 50 is incomplete: revoking posting authority does not terminate the already-created obligation. This finding preserves the ruling and identifies its unaddressed consequence.

## Risk register

Scores are severity × fallout × probability. Each factor describes launched use. No risk is accepted by this review. Decisions remain for the owner or lead, and closing evidence is pending a revised plan and re-review.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Owner | Decision | Deadline |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R2-A1 | 6: device bootstrap cannot meet its contract until repaired | 5: retained history requires a protocol or projection correction | 8: accumulating this amount of board history is common in active use | 240, fix before release | Confirmed | Board planner and API snapshot owner | Pending | Before release to real users |
| R2-A4 | 6: an open direct question needs manual repair | 3: an authorized close can release it | 6: removing a member during outstanding work is an ordinary specific action | 108, schedule | Confirmed omission | Board access and reactor | Pending | This phase, or a dated follow-up with an owner |
| R2-A2 | 6: an asker misses its promised completion until intervention | 3: retained posts permit manual recovery | 4: one ordinary adapter failure on the completion wake suffices | 72, schedule | Confirmed omission | Board wake representation and reactor | Pending | This phase, or a dated follow-up with an owner |
| R2-A3 | 6: a collection needs manual repair | 3: an authorized close or owner intervention releases it | 4: one restart while a supported nonreloadable session has outstanding work | 72, schedule | Confirmed | Board reactor | Pending | This phase, or a dated follow-up with an owner |

## Round 1 answer audit

These are design-level conclusions, not claims that the unbuilt criteria have passed. Finding identifiers retain the prefixes used in their source reports.

| Round 1 findings | Result against version 2 |
| --- | --- |
| Architecture A1; critic C05; logic-sol L6 | Addressed by the explicit delivery exception, same-transaction reach check and L13/L15. Ordinary engine management rights remain separate. |
| Architecture A2; critic C02; logic-sol L1; logic-opus M2 and m1; threat-opus M6 | Canonical delivery status and the requeued/fresh distinction address stale projection. Returned incoming questions have a policy. Completion returns remain R2-A2. |
| Architecture A3; critic C04; logic-sol L4 | Terminal cleanup now removes queued demands. The combined requeued/fresh replacement check below is still needed. |
| Architecture A4; critic C07; logic-sol L2; logic-opus M5; threat-opus m3's read-growth concern | Watermark plus acknowledged exceptions represents sparse reads. One fold owns acknowledgements, paging never unreads, and no-op reads do not append. |
| Architecture A5 and A6 | Disablement retains schemas, view and source rule, with queued sends and early waits expressly disclosed. Restart language now permits the engine's uncertain resend. |
| Critic C01 | Explicit dependency and criterion 1.9 address test discovery. Infrastructure ownership remains known gap 5, not a new finding. |
| Critic C03; logic-opus M4; logic-sol L5; threat-sol TM-2; threat-opus m6 | Close authority and plain/group membership outcomes are defined. Dependent direct obligations remain R2-A4. Dispatch/revocation coordination needs the retained implementation checks. |
| Critic C06 | WIDENED exclusions remain open under binding L14. No duplicate scope finding. |
| Critic C08 and C09 | Criterion 4.6 preserves pause/failure reasons; row 60 assigns both document lists to the lead. |
| Logic-opus M1 and m4; logic-sol L7; threat-opus M0 | Incoming cancellation, exported hold conditions, owner wait integration and per-caller snapshots are in seam items 12, 16 and 17. Snapshot isolation holds as a decision; response sizing remains R2-A1. |
| Logic-opus M3, m2 and m3; logic-sol L3 | Immutable recipient dispositions, live-agent filtering, crash suspension and one close table remove the prior ambiguity. Skipped unreloadable interruption remains R2-A3. |
| Logic-opus m5; threat-opus m4 | Plain channels alone have the member cap; names are per manager and commands use ids. |
| Logic-opus m6; threat-opus m7; threat-sol TM-1 | Same-channel reply references and current posting membership address cross-channel forwarding. |
| Threat-opus M1, M2 and M3 | Empty labels, subtree admission, every-post direct grants and the permission comparison are explicit. R2-A4 concerns existing obligations after the direct grant ends, rather than reopening those boundaries. |
| Threat-opus M4 | Fixed author kinds and authenticated ids, without display names, follow L16. |
| Threat-opus M5 | Wake and channel-page byte caps address the reported surfaces. The full snapshot remains R2-A1. |
| Threat-opus m1, m2, m3's storage concern, and m5 | The three-open-owner-question limit, same-user/privacy disclosure, storage inventory/no deletion statement and service read refusal are explicit. The purge question remains a lead handoff; no unseen handoff is assumed verified. |

## Proposed post-build checks

These require implementation evidence after the decisions above are corrected.

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| R2-PB-1 | Build more than one mebibyte of permitted board history, then connect a fresh device and reconnect from a new snapshot. Include open questions used by the wait helper. | Initial synchronization completes within the agreed frame budgets at a consistent head. Wait conditions remain accurate. | Actual encoded network frames, snapshot/page or chunk boundaries, stream continuation and wait results. | Board snapshot and API transport |
| R2-PB-2 | Return an asker's completion wake before acceptance and after a content update. Also crash the asker after close but before delivery, then resume it. Mix an incoming question into the same wake. | Completion reasons survive independently of incoming reply obligations; the chosen retry/failure policy is visible; unrelated questions survive. | Wake membership, committed return/replacement events, complete received bodies, acknowledgements and rebuilt view. | Board view, wake builder and reactor |
| R2-PB-3 | Restart with an unanswered nonreloadable working addressee. Compare a reloadable idle addressee and an interrupted initial start that recovery restarts. Delay reactor catch-up until after another recipient replies. | Only the specified unrecoverable obligation becomes gone, exactly once; the collection reaches the selected result without a failed-reload event being required. | Recorded session capabilities, full recovery and board event trace, final outcome and rebuild comparison. | Board reactor and acceptance |
| R2-PB-4 | A requeued wake carries Q1 and Q2. A fresh queued wake carries Q3. Close Q1 through another recipient, forcing replacement of the requeued wake. Repeat with a returned wake and an owed close while a fresh wake exists. | At most one never-sent board wake remains, with every surviving reason. Any retained requeued wake follows row 46; a replacement takes the documented new queue position. | Exact delivery ids/statuses, per-wake contribution sets, send order and runner call count. | Board wake builder and reactor |
| R2-PB-5 | Revoke the only shared-channel grant while a direct question is open. Run once before its wake sends and once after acceptance. Repeat while another shared channel still grants the pair reach. | The newly selected invalidation policy closes or resolves only obligations whose grant actually ended, without restoring unauthorized posting. | Public agent-token calls, direct/ordinary membership, post dispositions, terminal notification path and delivered text. | Board access and membership reactor |
| R2-PB-6 | Resume an author with an owed completion and open a parent or owner wait at the first idle transition, before the reactor queues the notice. | No false settled result occurs before the owed work is represented by a pending delivery or the corrected hold condition. | Controlled commit barriers, wait events/results, completion queue commit and client-helper result. | Board hold condition, reactor and seam |
| R2-PB-7 | Run ordinary sibling exchange, sparse reads, close cleanup, blocking-wait cancellation, disabled restart and uncertain-send recovery through the composed public API. | Revised criteria and the existing engine rules agree, with old engine tests unchanged. | Authentication identities, actual deliveries, command results, root test discovery, rebuild equality and unchanged-test diff. | Seam, board and acceptance |

R2-PB-4 is not a fifth confirmed defect. The global one-fresh-wake invariant already specifies the required result (`contract.md:196`; decision row 46 at `decisions.md:56`). The local cleanup/retry recipes do not demonstrate how their implementations compose. The builder can enforce that existing invariant with one shared coalescing function; the test must exercise the combination, rather than only the separate criteria 3.4 and 3.5.

## Noted, not filed

- All supplied known gaps were considered. Owner approval of the additive seam and confirmation of the WIDENED exclusions remain with their assigned owners. L15/L16 settle the seam and sender-label questions for this review. No new approval request or owner ruling is invented.
- Package/test registration remains known gap 5. Today's projects are enumerated in `vitest.config.ts:4` and `vitest.config.ts:22`. The new packages need that dependency before their verification can count. No manifests, lock files or scopes were edited.
- The existing engine source supports the principal architectural anchors: targeted rights use `holderAbove` (`packages/engine/src/commands/CommandHandler.ts:73`); dispatch reserves the send in a transaction before invoking the runner (`packages/engine/src/routing/deliveries.ts:239`, `packages/engine/src/routing/deliveries.ts:255`); delivery status includes requeue and return (`packages/engine/src/views/apply.ts:284`, `packages/engine/src/views/apply.ts:287`); and the log redacts events before commit (`packages/engine/src/log/EventLog.ts:250`). No second writer or mode-specific board runner is needed.
- No independent board database migration is required by the stated event-derived model. The seam must provide the composed decoder and view fold before the first board write. The disablement rule answers server rollback; it intentionally does not make a pre-board binary able to decode board history (`contract.md:317`).
- Current documentation was queried through Context7 on 2026-11-03 for Effect and the Agent Client Protocol. The Effect 4.0.4 query did not return the requested RPC reference. The official [RpcGroup reference](https://effect.website/docs/v4/api/effect/rpc/RpcGroup), checked the same day, documents make, merge, omit and prefix but identifies itself as 4.1.2. Pinned usage of make, merge and omit is visible at `packages/contracts/src/commands.ts:44`, `packages/contracts/src/commands.ts:135` and `packages/contracts/src/commands.ts:137`; the catalog pins 4.0.5 at `pnpm-workspace.yaml:6`. This review does not certify duplicate-name replacement in 4.0.5 from newer documentation. That limitation is already known gap 8, and the composition uniqueness check remains required.
- The official [prompt-turn documentation](https://agentclientprotocol.com/protocol/v1/prompt-turn), checked on 2026-11-03, describes the v1 turn model; current documentation also distinguishes a v2 draft. This review relies on the recorded engine's readiness rule, which queues behind active work at `packages/engine/src/routing/deliveries.ts:230`, rather than treating a broad statement about every protocol version as independently proven. Mid-turn steering remains outside the approved board slice.
- No security acceptance is implied. Existing same-user access and parent-thread visibility are disclosed limits. Security findings remain subject to the owner's deferral and the lead's issue-list/manager handoff. The four findings here concern contract and core-flow failures; no model policy prevented a check.
- Review execution: `nvm use` selected Node.js 26.13.0. This was document and source review; no application tests or dependency installation ran, and no unbuilt board behavior is claimed verified. The checkout remained unchanged. The assigned scratch directory was never created and was confirmed absent. Only this result file is written; there are no commits, pushes, team messages, issue-list edits, session reports or journal entries.
