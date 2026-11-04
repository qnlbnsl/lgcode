revise
Grade: 6  B/M/m: 0/5/1  Flags: none

## Review basis

This is the architect review of the frozen board plan, round 1. Code anchors below were checked in the read-only checkout at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. `plan.md`, `contract.md` and `decisions.md` mean the supplied `shepherd-message-board/` files. `inputs/client-api-contract.md` means the supplied frozen client API contract. Evidence marked confirmed establishes a contradiction or omission in the plan; it does not claim that unbuilt board code has been run.

## Findings

### A1. MAJOR — Design: Channel messaging conflicts with the frozen caller rule

Scenario: A parent joins sibling leads A and B to a channel. A posts a question to B, or opens the direct channel that shared membership permits. The board authorizes this, but the frozen API contract says that an agent-callable piece command acting on another agent must check that the target is itself or an agent over which it holds parental rights. B is neither for A. The contracts therefore disagree about a central promised board flow.

Evidence: `plan.md:81`, `plan.md:277` and `contract.md:55` permit communication between shared-channel peers. `inputs/client-api-contract.md:222` requires the engine's tree rule for piece commands and expressly forbids a piece from inventing its own tree rule. Today's engine checks the holder before allowing an agent's targeted command at `packages/engine/src/commands/CommandHandler.ts:73`; `holderAbove` walks ancestors at `packages/engine/src/routing/holders.ts:21`. Neither provides sibling authority.

Suggested fix: Have the lead reconcile the frozen contract before implementation. State a narrow channel-membership authorization rule for board communication, including replies and direct channels, and distinguish it from lifecycle authority over an agent. Name which check the delivery helper performs. Keep the existing engine command rights intact. This needs a shared contract decision, not a builder's interpretation of “acts on another agent.”

Evidence status: confirmed. Responsible builder: the board planner and the client API seam owner, through the lead.

### A2. MAJOR — Design, Bug: The wake index ignores retry and return transitions

Scenario: A board wake is sent but the adapter reports a usage limit before accepting it. The engine requeues it. A second board post arrives while that agent is paused. The board's specified fold still considers the first wake sent, so its merge rule queues another wake instead of combining with the existing queued delivery. The promised one-queued-board-wake invariant fails. An ordinary delivery error also leaves a stale sent entry because the terminal return event is ignored.

Evidence: `plan.md:261` defines a separate wake index. Criterion 2.1 at `plan.md:272` enumerates `DeliveryQueued`, `DeliverySent`, `DeliveryAccepted` and `DeliveryWithdrawn`, and says to ignore every other event. `plan.md:312` merges only still-queued wakes. The engine emits `DeliveryRequeued` on a pre-acceptance pause at `packages/engine/src/routing/deliveries.ts:150` and during restart recovery at `packages/engine/src/recovery/reload.ts:94`. An ordinary error emits `DeliveryReturned` at `packages/engine/src/routing/deliveries.ts:130`. The canonical delivery view handles both transitions at `packages/engine/src/views/apply.ts:284` and `packages/engine/src/views/apply.ts:287`.

Suggested fix: Prefer reading delivery status from the engine's canonical delivery view and keeping only board-specific membership in the board index. Otherwise fold every delivery transition explicitly. Define what a returned board wake means for its open posts and how the sender or supervising service learns that answering never started. A source rule for a stopped target alone does not cover an ordinary adapter error.

Evidence status: confirmed. Responsible builder: board units 2a, 3a and 3b.

### A3. MAJOR — Design, Bug: Closing a post leaves obsolete wakes queued

Scenario: A question in `any` mode targets A and B. A answers while B is busy and its board wake is still queued. The question closes and the asker is notified, but the described transaction does nothing to B's wake. When B becomes idle, it spends a turn on a question that needs no further answer. Likewise, withdrawing an author's open posts can leave their recipients' queued wakes behind.

Evidence: The post algorithm at `plan.md:307` closes the original post, then computes a wake set containing the new post's addressees and the original asker at `plan.md:310`. It only withdraws and replaces wakes for that wake set. The remaining original addressees are absent. Criteria 3.3 and 3.9 at `plan.md:330` and `plan.md:336` contain no pruning rule. The engine dispatcher sends a queued delivery based on target readiness at `packages/engine/src/routing/deliveries.ts:230`; it does not know board post closure. The approved piece source rule covers target stop or crash, not post closure (`inputs/client-api-contract.md:583`).

Suggested fix: On every post closure, remove that post's obsolete reply demand from each still-queued recipient wake in the same transaction. Withdraw an empty wake and rebuild a mixed wake while retaining its other required posts. Define the outcome for an already-sent wake, which cannot be recalled. Seam item 13 already supplies the necessary queued-withdrawal capability; another mechanism is unnecessary.

Evidence status: confirmed. Responsible builder: board units 3a and 3b.

### A4. MAJOR — Design: One read cursor cannot represent a partially delivered backlog

Scenario: A channel has 21 unread informational posts followed by a question addressed to an agent. Its wake contains the question and only 20 informational posts. Acceptance must mark the carried posts read while leaving the omitted informational post unread. Advancing the single channel cursor to the question skips the omitted post. Keeping the cursor before the gap leaves the accepted question beyond the read position. The plan does not define how to represent this hole.

Evidence: `plan.md:260` specifies read positions per member and channel; `decisions.md:29` explicitly chooses one cursor per member per channel. `plan.md:317` caps incidental unread posts at 20 while including every required post. Criterion 3.10 at `plan.md:337` and `contract.md:141` say that the wake's posts become read on acceptance. `board.status` and `board.flush` consume this read state (`contract.md:166`). A live-versus-rebuilt equality check can agree on the same incorrect cursor, so criterion 2.2 alone does not resolve this design question.

Suggested fix: Separate the pagination cursor from read tracking. Define a read position plus acknowledged exceptions, or derive exact read membership from durably recorded wake membership and explicit reads. State how a wake's post identifiers are recovered from the log, including after a merge and a restart. A plain high-water cursor is sufficient only if delivery is a contiguous prefix, which the required-post-plus-digest rule does not guarantee.

Evidence status: confirmed omission; the implementation outcome remains unbuilt. Responsible builder: the board planner, then units 2a and 3b.

### A5. MAJOR — Design: Rollback is unsupported once board records enter the shared log

Scenario: The board is deployed, writes a post and queues its piece delivery, then its code or registration is rolled back to the pre-board composition. That composition lacks the board event schemas and piece delivery source. Rebuilding the existing state can fail before the service serves any commands. Having separate tables does not make that rollback reversible.

Evidence: `plan.md:173` says nothing is irreversible because the events and tables are new, but supplies no rollback procedure or minimum compatible version. The frozen composition includes each piece's schemas (`inputs/client-api-contract.md:117`), and the source is an added delivery variant (`inputs/client-api-contract.md:583`). At the recorded commit the event and delivery unions are closed (`packages/contracts/src/events.ts:20`, `packages/contracts/src/events.ts:88`). Stored rows are decoded against the envelope schema at `packages/engine/src/log/subscribe.ts:35`; startup rebuild uses that decoder at `packages/engine/src/views/rebuild.ts:34` and is required by `packages/engine/src/views/Views.ts:41`. The client's planned unknown-event handling does not establish a server rollback decoder.

Suggested fix: Declare the earliest server version that can read a board-bearing log. Define rollback as disabling board writes and reactors while retaining its schemas and the required delivery-source handling, or specify an explicitly approved backup restoration procedure and its data-loss boundary. State how queued wakes and unsettled conditions are handled during disablement. Assign this prerequisite to the seam/release owner before the first board write.

Evidence status: confirmed omission. Responsible builder: the board planner and the client API seam/release owner.

### A6. MINOR — Design: The board promises a stronger restart guarantee than its delivery dependency

Scenario: The service dies after the adapter receives a board wake but before acceptance is committed, and the reloaded history does not contain the delivery marker. Recovery sends the wake again. This is an explicitly allowed engine outcome, while the board overview promises delivery exactly once and its restart criterion is unqualified.

Evidence: `plan.md:36` promises “exactly once”; `plan.md:413` requires one delivery after restart. The approved engine design expressly allows a resend when replay lacks the message (`docs/specs/2026-11-01-engine-design.md:536`). The implementation classifies every sent delivery absent from replay as unaccepted and requeues it (`packages/engine/src/recovery/reload.ts:78`, `packages/engine/src/recovery/reload.ts:94`). Existing issue 194 records the engine behavior (`docs/issues.md:2722`).

Suggested fix: Distinguish one committed logical wake and idempotent board commands from external delivery attempts. Scope the once-only restart test to a queued-before-send boundary or replay-proven receipt, and add a separate test for the permitted uncertain resend. Do not change the accepted engine recovery rule implicitly. This finding concerns the new board guarantee; it does not re-file issue 194 as an engine defect.

Evidence status: confirmed. Responsible builder: the board planner and acceptance unit 5.

## Risk register

The scores are severity × fallout × probability. Decisions and acceptance remain for the owner; none is assumed here. Closing evidence is pending a revised plan and its re-review for every row.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Owner | Decision | Deadline |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | 6: a core peer messaging flow is refused | 5: requires a contract correction | 8: shared-channel peer messaging is ordinary use | 240, fix before release | Confirmed | Board planner and seam owner | Pending | Before release to real users |
| A5 | 6: the service cannot start after an incompatible rollback | 5: requires operator recovery | 4: a rollback is an uncommon operational event | 120, schedule | Confirmed omission | Board planner and seam/release owner | Pending | This phase, or a dated follow-up with an owner |
| A4 | 6: unread state and flush behavior need a model correction | 3: affects the owner's team and can be repaired from retained posts | 6: a backlog exceeding the digest limit is an ordinary specific case | 108, schedule | Confirmed omission | Board planner and units 2a, 3b | Pending | This phase, or a dated follow-up with an owner |
| A3 | 4: unnecessary turns occur until the queue clears | 3: affects one team and clears through dispatch | 8: one responder beating a busy peer is common | 96, schedule | Confirmed | Units 3a, 3b | Pending | This phase, or a dated follow-up with an owner |
| A2 | 6: queue and status invariants require correction | 3: state is reconstructible once the fold is fixed | 4: one pause or delivery failure suffices | 72, schedule | Confirmed | Units 2a, 3a, 3b | Pending | This phase, or a dated follow-up with an owner |
| A6 | 4: an uncertain send can repeat a turn | 3: one agent is affected; the log retains its logical identity | 4: one crash at the send/accept boundary | 48, record | Confirmed | Board planner and unit 5 | Pending | Review at phase end |

## Proposed post-build checks

These checks require implementation evidence. They supplement the plan corrections above.

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| ARCH-PB-1 | Parent joins sibling leads to a channel; one posts to the other and receives a reply. An unrelated non-member repeats it. | The permitted peer exchange succeeds; the non-member is refused under the reconciled contract. | Real agent tokens through the public API, delivery targets, replies and refusal events. | Board access and seam |
| ARCH-PB-2 | A sent board wake hits a usage pause; another post arrives before recovery. Repeat with an ordinary delivery error. | At most one queued board wake after merging; status agrees with the engine; an error follows the chosen failure-notification policy. | Full delivery transition trace and a rebuild comparison after restart. | Board view, wake builder and reactor |
| ARCH-PB-3 | In `any` mode, A replies before busy B receives its queued wake. Include an unrelated required post in B's wake. Repeat with the author stopping. | The obsolete demand does not cause a turn; unrelated required posts remain deliverable once. | Committed closure and withdrawal/replacement batches, plus actual runner call counts. | Board units 3a, 3b |
| ARCH-PB-4 | At least 21 informational posts precede a required question; accept the digest, restart, then read and flush. | Only carried posts are read; omitted posts remain discoverable; pagination and unread counts agree. | Exact delivered post identifiers, status/read replies and the rebuilt view. | Board view and read tracking |
| ARCH-PB-5 | Deploy the board, create open questions and queued wakes, then perform the documented supported rollback or disablement. | The service restarts on the existing log with the documented treatment of wakes and unsettled conditions. | Real state directory, version/registration identities, startup logs and successful authenticated commands. | Seam and release |
| ARCH-PB-6 | Kill after queue commit, after send with replay proof, and after receipt without replay proof. | One logical wake; the external attempts follow the accepted engine guarantees at each boundary. | Adapter inbound frames as well as delivery events; counting `DeliveryQueued` alone is insufficient. | Acceptance and recovery |

## Noted, not filed

- Known gaps 1 through 7 were considered. The hold-unsettled hook is present as item 12 in the supplied frozen contract. Rulings approve items 13 and 14 despite their absence from that text. The pending owner approval remains a launch dependency; this review does not re-open it.
- Known gap 4 needs a wider prerequisite than manifests and workspace entries. `vitest.config.ts:4` and `vitest.config.ts:22` enumerate existing package projects, so the two new packages' tests are not included by today's configuration. Assign test-project registration and type-check discovery to the lead's package setup work before unit 1. This is an extension of that known gap, not another finding.
- Group-label membership widening is already known gap 3. No security clearance is implied here. The owner/lead ruling defers security fixes; findings must go through the lead's issue list.
- Using the engine transaction, delivery interface and source helpers is the simpler fit. No separate board process, credentials or dispatch loop is needed. The main architectural work is completing the shared authorization and lifecycle contracts.
- Current Effect documentation was queried through Context7 on 2026-11-03. The official [RpcGroup reference](https://effect.website/docs/v4/api/effect/rpc/RpcGroup), checked the same day, documents `make`, `merge`, `omit` and `prefix`; it currently describes 4.1.2, so it does not independently verify pinned 4.0.5 behavior. Existing usage is checked at `packages/contracts/src/commands.ts:44` and `packages/contracts/src/commands.ts:135`. No claim about duplicate-name replacement in 4.0.5 is certified by this review. The composition uniqueness test remains necessary.
- Verification was a plan/contract and source review. Node.js 26.13.0 was selected with `nvm use`. No application tests or dependency installation ran; the checkout has no `node_modules`. An initial read helper used unavailable `python`; it was rerun with `python3`. The pinned-version documentation URLs did not resolve, so the limitation is recorded above rather than inferred from newer documentation.
- The repository remains unchanged. No commits, pushes, board messages, session report or issue-list edits were made. The assigned scratch directory was never created and is absent.
