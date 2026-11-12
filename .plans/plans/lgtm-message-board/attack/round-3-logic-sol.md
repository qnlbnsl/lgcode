revise
Grade: 6  B/M/m: 0/3/0  Flags: none

## Review basis

This reviews plan version 3 and contract version 4 through the logic and failure-policy lens. The checkout is `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. Repository source references were checked there. References beginning `../` resolve from this result file. The binding rulings include L17, L18, L19, L21 and L22.

The findings concern conflicting or incomplete decisions in the proposed contract. They are not execution results for an implemented board. The pending owner decision about the additive extension seam remains a dependency, not another finding.

## Findings

### R3-L1. A group author's crash simultaneously preserves and withdraws its open questions

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence status: **Confirmed contradiction**. Responsible builder: board units 2b, 3b and 3c, with the planner defining precedence.

Scenario: Labelled worker A belongs to group channel C, managed by its live parent. A asks another member B a question. A crashes before B answers. The lifecycle rule leaves A's question open so that B can answer and A can receive the completion after resuming. However, a group member must be live, and live expressly excludes crashed agents. A therefore also leaves C. The membership reactor withdraws a leaving author's posts, including this question. B's pending demand is removed and its later answer cannot complete the original question. Both prescribed paths apply to the same crash, and they require different terminal states.

The recipient side also conflicts: a labelled addressee's crash requires `gone` under lifecycle handling, but `removed` under membership handling. Dispositions are set once, so the final reason depends on which path acts first unless precedence is decided. The special late upgrade from `gone` to `replied` makes those reasons behaviorally different, not merely different wording.

Evidence: `../contract.md:44` defines live agents; `../contract.md:74` restricts labelled membership to live agents. The outcome table at `../plan.md:307` withdraws an author that leaves, while `../plan.md:308` preserves a crashed author's open post. Unit 3b repeats preservation at `../plan.md:519`; unit 3c explicitly reacts to a crash that changes computed membership and withdraws a leaving author's posts at `../plan.md:534`. Recipient outcomes and their immutability are at `../contract.md:179`, `../contract.md:183` and `../contract.md:187`. The actual engine changes the lifecycle state to crashed without deleting parent links or labels (`packages/engine/src/views/apply.ts:202`, `packages/engine/src/views/apply.ts:205`; the crash transition is `packages/contracts/src/stateMachine.ts:108`). This scenario requires no explicit label revocation.

Why the round 2 answer is incomplete: Rows 65 and 66 correctly replace availability-based ancestry and prevent unrelated subtree admission. This does not re-file the manager-pause defect or reopen L18/L21. The remaining consequence is that live-only membership loss now intersects the separately retained author-crash policy. Row 69's durable completion cannot preserve an open question that the membership path has already withdrawn.

Suggested fix: State a cause-based precedence rule for lifecycle exits versus explicit channel or label removal. For example, a crash can remove access while lifecycle handling exclusively determines the affected post obligations: preserve a crashed author's questions and resolve a crashed addressee `gone`. Explicit removal can retain the withdrawal/`removed` policy. The planner may choose another outcome, but the table, contract, reactor and late-reply rule must agree. Cover a non-manager labelled author as well as a manager, so the manager exception cannot hide the conflict.

### R3-L2. One allowed completion can exceed the entire wake budget, with no completion overflow policy

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence status: **Confirmed size conflict and missing repair decision**. Responsible builder: board units 1, 2a and 3a, with unit 3b for completion scheduling.

Scenario: A posts an `all` collection to six agents. Each replies with 16,384 copies of the ordinary character `漢`. All six replies meet the post limit, and the collection meets the 16-addressee limit. The promised completion includes every reply. The reply text alone needs 294,924 bytes when joined with newlines and JSON-encoded, before author headers, dispositions or markers. A complete wake body may use only 262,144 bytes. A single completion therefore cannot fit, even with no incoming question and no optional digest.

The omission rule only repairs incoming questions: it leaves posts open and unread and directs the recipient to `board.read` with `incoming`. This collection is already closed and belongs to A as author. It cannot appear in that incoming query. Putting completions first does not resolve the impossible size of the first completion. The contract does not choose a bounded summary with a retrieval path, partial completion acknowledgements, or another way to make progress. Discharging the whole completion after accepting a partial body would lose the remaining promised result; retaining an indivisible oversized debt can hold A unsettled indefinitely.

Evidence: The post and addressee limits are `../contract.md:161` and `../contract.md:162`. A completion includes the outcome, every disposition and the replies (`../contract.md:53`; `../decisions.md:79`, row 69). Criterion 3.3 promises every reply at `../plan.md:471`. The encoded body budget and completion-first order are `../plan.md:453` and `../contract.md:249`. The only overflow hint is at `../contract.md:254`, and `incoming` returns unresolved incoming open posts at `../contract.md:328`. Completion discharge is acceptance of a wake naming its post id (`../contract.md:204`, `../contract.md:210`); undispatched completion debt holds its author unsettled at `../contract.md:309`.

The byte calculation was checked with Node.js 26.13.0 using six strings of length 16,384 and `Buffer.byteLength(JSON.stringify(answers.join("\n")))`. This is arithmetic over permitted text, not a run of the future wake builder. No external library behavior is assumed.

Why the round 2 answer is incomplete: Row 69 answers R2-A2/C2-02/R2-L4 for merge, cleanup, return and crash, and row 72 correctly switches to encoded bytes. Their combination still needs a delivery and acknowledgement policy for an oversized completion. This does not reopen the accepted budget or the corrected `incoming` hint for ordinary questions.

Suggested fix: Define bounded completion content and an authorized, paged way to retrieve the remaining closed result, or define durable completion parts and their acknowledgement semantics. State exactly when the completion stops holding the author unsettled. Also handle several individually fitting completions whose combined size exceeds a wake. Keep the chosen once-at-close logical notification policy and the no-timer rule; additional wake behavior would require an explicit decision. Add this case to the completion criteria, not only the incoming-post byte-cap test.

### R3-L3. Snapshot truncation falls back to replies that remain unbounded

Severity: **MAJOR**. Category: **Design; Bug (failures)**. Evidence status: **Confirmed missing response bound**. Responsible builder: board contracts and registration units, with the client wait-helper owner through the lead.

Scenario: Many authors ask questions of the same paused or busy target T. Each agent author stays within its 64-open-post limit. Alternatively, the owner can create these questions, because the stated per-author limit applies to agents. The bounded board snapshot sets `truncated`, so the client must read T's outstanding obligations through `board.status`. That reply contains the metadata for every incoming open question, as well as other lists. No page shape, byte cap or bounded condition summary is specified for it. It eventually exceeds the same network limit that truncation was meant to avoid. The owner's wait helper then cannot obtain its required condition inputs through the contracted fallback.

The limit on simultaneous authored questions does not bound incoming questions from multiple authors, retained failed completions, or the number of channels. `board.channels`, the other truncation fallback, likewise has no stated bound or page contract. Removing post text makes these failures occur later; it does not establish a maximum reply size.

Evidence: Snapshot truncation and its prescribed fallbacks are `../contract.md:342` and `../contract.md:349`. The complete `board.status` lists and the `board.channels` listing are specified at `../contract.md:382` and `../contract.md:383`, without limits or cursors. The 64 limit is explicitly for an agent's own open posts at `../contract.md:171`; group channels have no independent size limit at `../contract.md:89`. Failed completion debts persist at `../contract.md:211`. Row 71 and its L21 confirmation require `waitForAgents` to read `board.status` when truncated (`../decisions.md:81`, `../decisions.md:93`). The network limit applies to every reply at `../../inputs/client-api-contract.md:570`, while the page contract is only specified for `board.read` (`../contract.md:324`).

As an illustrative lower-scale encoding check, 10,000 short metadata records containing only a post id, channel id, reply mode, one addressee and empty dispositions encoded to 1,790,001 bytes in Node.js. This does not assert the future schema's exact encoding. The defect is the absence of any finite bound on those required lists, independent of the precise threshold.

Why the round 2 answer is incomplete: The no-text, 256 KiB snapshot satisfies L21 and directly fixes the original full-history snapshot. R2-A1/S1/R2-TM-2 are therefore answered for that response. The required fallback still cannot guarantee completion. This is a narrower failure of the new repair path, not a request to restore a full snapshot or increase the transport limit.

Suggested fix: Give both fallback listings an encoded response budget and a paged contract, or return a bounded per-agent condition summary separately from paged detail. Define how the wait helper obtains complete condition inputs when detail is paged. Measure every new reply against the listener's full-envelope limit. This can remain inside the board under L21; any necessary seam change goes through the lead.

## Interacting-rule truth table

These are contract evaluations, not implementation test results. There are no money bases or accounting periods in this plan.

| Interacting inputs | Required result or missing decision |
| --- | --- |
| `any`; one recipient replies, another is pending | Close `answered`; remove every obsolete queued demand. Defined at `../plan.md:302`. |
| `all`; W1 replies, W2 is pending | Keep open; prune only W1's own queued demand. Row 82 and criterion 3.5 answer the earlier cleanup defect (`../plan.md:473`). |
| `all`; every recipient has a disposition, at least one replied | Close `answered`, retaining every disposition (`../plan.md:303`). |
| Either mode; every recipient resolved, no reply | Close `unanswerable` and owe the author a completion (`../plan.md:304`, `../plan.md:310`). |
| Owner replies in either mode | Close `answered`, even with other recipients pending (`../plan.md:305`). |
| Author withdraws its own post, or stops | Withdraw; create no new completion debt (`../contract.md:204`). |
| Another authorized caller withdraws, or the author is explicitly removed | Withdraw and owe a reason-only completion when reply text is no longer authorized (`../contract.md:206`, `../contract.md:131`). |
| Plain-channel author crashes | Keep its questions open; retain completion debt through resume (`../plan.md:308`, `../plan.md:315`). |
| Labelled group-channel author crashes | Lifecycle says preserve; membership says withdraw. **R3-L1.** |
| Group recipient crashes | Lifecycle says `gone`; membership says `removed`, and only `gone` permits a later reply upgrade. **R3-L1.** |
| Recipient pauses; parent or manager pauses | No recipient disposition; structural ancestry remains stable. Defined at `../plan.md:297`, `../contract.md:45`. |
| Recipient interrupted and not reloadable | Resolve `gone`, including no-attempt recovery; refuse a new obligation (`../plan.md:292`, `../plan.md:432`). |
| Recipient interrupted and reloadable | Stay pending while recovery tries; reload failure resolves `gone` (`../plan.md:293`). |
| Last shared-channel grant ends for a direct pair | Resolve the open direct obligations `removed`; close by the outcome table; history remains readable (`../contract.md:103`). |
| Old carried post loses reach before send | Dispatcher withdraws; board rebuild omits it or resolves its recipient `removed`; no unrelated new command is refused (`../contract.md:134`; seam item 15 at `../../inputs/client-api-contract.md:648`). |
| Returned incoming wake, first then second return | Retry once; then resolve that recipient `undeliverable` (`../plan.md:523`). |
| Returned completion, first then second return | Retry once; then retain a visible failed debt without independently re-queuing or holding unsettled (`../contract.md:210`, `../contract.md:309`). |
| Mixed wake loses its last incoming question but retains an owed completion | Keep a replacement for the completion (`../plan.md:320`). |
| Required incoming posts exceed the body budget | Leave omitted questions open; retrieve them through `incoming` (`../plan.md:476`). |
| A completion alone exceeds the body budget | No completion-specific progress or acknowledgement policy. **R3-L2.** |
| Snapshot exceeds its section budget | Return `truncated`; fallback must provide complete condition inputs, but its replies have no bound. **R3-L3.** |
| Board disabled; an old delivery loses reach | Reach remains registered and the dispatcher refuses the delivery. Reactor and conditions stop; early waits are an accepted rollback consequence (`../contract.md:417`). |

Write ownership is defined: commands use one seam transaction, receipts are caller-scoped, read acknowledgements belong to the board fold, and the reactor re-reads current post status before writing (`../plan.md:507`). The crash-versus-membership precedence above is the remaining decision-level ordering conflict. Transaction and recovery races that require code are listed below.

## Round 2 answers checked

All 39 mapped round 2 findings are covered here. A written answer is not a claim that its future tests passed.

| Prior findings | Assessment against version 3 / contract version 4 |
| --- | --- |
| C2-01, R2-L3, logic M2, threat S3/S4 | Rows 65/66 and L18/L21 restore manager membership, fixed ancestry and a fixed owner-selected anchor. Pauses no longer empty a team's channel, and inherited management does not admit cousins. The distinct lifecycle/removal conflict is R3-L1. |
| C2-04, R2-TM-1, logic M3 | Row 67 and L19/L22 define send-time checks for every board delivery, including in-tree and callerless wakes, plus per-post rebuild outcomes. The old reach-check gap is answered. |
| R2-A4, C2-03, R2-L2 | Row 68 terminates existing direct obligations when the last grant ends; two supporting channels remain a control case. Answered. |
| R2-A2, C2-02, R2-L4, logic m1/m5 | Row 69 supplies durable completion debt, acceptance-based discharge, bounded return failure, third-party withdrawal notification and unsettled protection. Those lifecycle answers hold. Oversized completion packing remains R3-L2. |
| R2-A3, R2-L1, logic M4/m3 | Row 70 observes `AgentInterrupted` and reloadability directly, adds catch-up and new-post refusal, and allows a late `gone` reply while still open. Answered for the no-reload-attempt path verified at `packages/engine/src/recovery/restart.ts:159`. |
| R2-A1, threat S1, R2-TM-2 | Row 71 bounds the snapshot without text. The new fallback is incomplete as R3-L3; the original full-history response is no longer required. |
| C2-05, threat m1, R2-TM-3 | Row 72 measures JSON encoding and removes the stated controls. The old expansion counterexample is answered. R3-L2 concerns fitting promised content, not measuring the budget. |
| Threat S2/m4, logic m7 | Row 73 explicitly records start ceilings and ancestor/descendant exceptions, while narrowing the claim about informational digests. This avoids the mutable view field at `packages/engine/src/views/apply.ts:190`. Answered. |
| Threat m2/m3 | Row 74 fixes status to metadata only and headers to channel ids. The name pattern is explicit. Answered for access and author-line content. |
| Threat m5, R2-TM-4 | Row 75 adds receipts to the stored-copy inventory and criterion 5.11 to the secret scan. Answered as a plan requirement. |
| Logic M1 | Row 82 limits per-recipient cleanup and preserves other workers' pending demands. Answered. |
| Logic m2 | Row 77 and L22 use no disposition, rather than has not answered, for the incoming condition. Answered. |
| Logic m4 | Row 78 refuses an author in its own addressees. Answered. |
| Logic m6 | Row 79 sets a new member's initial watermark at the join. Answered for the named joins; recovery and inherited-manager joins need the implementation check below. |
| R2-L5 | Row 80 names `incoming`, independently of the caller's authored `open` posts. Answered for omitted incoming questions. |
| C2-06 | Row 81 narrows the privacy criterion and adds the own/child-thread positive control. Answered. |

L17's agent/service direct pair is included, and services remain unwoken and unable to call `board.read`. Known gap 8's seam wording is resolved in the supplied L22 contract (`../../inputs/rulings.md:25`); it is not re-filed as an open authorization gap.

## Risk register

Scores are severity × fallout × probability. No risk is accepted by this reviewer. Decisions and closing evidence remain pending.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Owner | Decision and deadline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R3-L2 | 6: a collection cannot fulfill its promised completion flow | 3: the owner can retrieve retained replies manually | 6: a collection of several large replies is an ordinary permitted workload | **108, schedule** | Confirmed contract conflict | Board contracts, wake builder and lifecycle | Unset; this phase or a dated follow-up with an owner. |
| R3-L1 | 6: a recoverable author's question can be withdrawn instead of completed | 3: the owner can arrange another collection from retained posts | 4: one agent crash while a group question is open | **72, schedule** | Confirmed contradiction | Board access and lifecycle/membership reactor | Unset; this phase or a dated follow-up with an owner. |
| R3-L3 | 6: device recovery and owner waiting cannot obtain complete board state | 3: the owner can inspect or reduce obligations through the local surface | 4: a large accumulated incoming or failed-obligation set | **72, schedule** | Confirmed missing bound | Board read contracts and client wait integration | Unset; this phase or a dated follow-up with an owner. |

No severity-floor adjustment applies. These are functional contract failures; security deferral does not decide their outcomes.

## Proposed post-build checks

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| R3-PB1 | Crash a non-manager labelled author with an open collection. Repeat for a labelled recipient and for the manager. Resume before and after reactor catch-up. | The corrected precedence produces one chosen disposition/close result; a preserved collection completes after resume; explicit label removal still follows its separate policy. | Controlled event order, post status and dispositions, queued wake bodies, completion debts, and rebuilt-view equality. | Board 2b/3b/3c. |
| R3-PB2 | Complete an `all` collection with six 16,384-character BMP replies. Separately accumulate enough fitting completions to exceed one wake. Accept, return and crash during delivery. | Every encoded body respects its cap; the chosen overflow retrieval or part policy makes progress; debt is discharged only according to that policy; no empty retry loop or lost remainder. | Exact encoded sizes, full result reconstructed through the public API, carried completion identifiers/parts, acceptance events and parent wait outcomes. | Board contracts, view, wake builder and reactor. |
| R3-PB3 | Force snapshot truncation and exceed one network message with a single target's incoming obligations and with channel listings. | Every fallback reply fits; the client can traverse all data and obtain complete conditions without silent truncation or changing transport limits. | Actual network frames with envelopes, page cursors, independently enumerated obligation sets and owner wait results. | Board registration/read handlers and client helper. |
| R3-PB4 | Take a truncated snapshot at sequence S while A is idle with an outgoing question. Before status hydration finishes, close it, dispatch and accept A's completion, leaving A working. Also vary the reverse order. | The helper evaluates lifecycle and board conditions at a coherent sequence; it never combines idle at S with later discharged debt to declare A settled prematurely. | Stream/read barriers, snapshot and status observation sequences, actual helper exit point and an engine-wait comparison. The implementation must establish a coherent hydration algorithm; this review does not claim one has been executed. | Board summary/status and client wait-helper integration. |
| R3-PB5 | Reply or remove a member while a board wake is being reserved; include a requeued wake plus an existing fresh wake and an owed completion. | Only still-queued deliveries are withdrawn; one fresh wake retains every valid reason, obsolete demands vanish, and queue position follows the contract. | Transaction barriers, delivery ids and statuses, runner calls, projected wait checks and replay equality. | Board 3a/3c and seam dispatcher. |
| R3-PB6 | Resume a crashed labelled member and transfer management to a previously non-member holder in a channel with history. | Computed membership, initial/read watermarks and reactor outcomes agree with the chosen join semantics. Old history does not unexpectedly consume the first digest. | Engine events actually emitted, join/read positions and live/rebuilt equality. `resume` emits `StateChanged` at `packages/engine/src/commands/resume.ts:26`, rather than a new `AgentStarted`, so exercise that path explicitly. | Board view and membership reactor. |
| R3-PB7 | Delay the reactor across crash, resume and a new question written after resume; replay its input twice. Repeat with remove/rejoin. | Historical terminal events affect the obligations that existed at the relevant transition, not unrelated later questions; an already committed valid reply is not overwritten. | Original event and post creation sequences, transaction snapshots, final dispositions and rebuild equality. | Board reactor. |
| R3-PB8 | Return a wake after an acceptance-producing content update, then compare a return before acceptance. | Already discharged completions are not recreated by a late return; genuinely owed completions and unresolved incoming obligations follow their independent budgets. | Accepted/returned event sequence, debt state and actual subsequent sends. The engine permits an error after acceptance at `packages/engine/src/routing/deliveries.ts:121` and `packages/engine/src/routing/deliveries.ts:130`. | Board view/reactor and seam. |

The plan's existing redaction, namespace ownership, authenticated-author, send-time revocation, maximum-envelope and restart checks remain necessary. None is claimed to have run in this document review.

## Noted, not filed

- Known gaps 1, 5, 6, 7 and 9 remain their named dependencies or limitations. The pending seam authorization, infrastructure ownership, vendor allowances and WIDENED exclusions were not converted into new findings. L22 resolves the supplied wording issue in gap 8.
- Fixed structural ancestry, the owner-selected anchor, inherited-manager membership and universal send-time validation remain binding. R3-L1 asks for the unaddressed obligation precedence; it does not propose widening membership or reopening those rulings.
- The two-return completion terminal state, indefinite silence by a live recipient, owner/service flush authority, no timers for informational posts, and the disclosed disabled-board behavior are explicit policies. They are not independently filed as defects.
- Same-user disk access, parent-thread visibility, permanent post retention and uncertain external resend remain disclosed boundaries. Existing engine issues 113, 152 and 194 were considered and were not re-filed as board defects (`docs/issues.md:1704`, `docs/issues.md:2124`, `docs/issues.md:2716`). The lead owns resulting issue-list updates under `../../inputs/rulings.md:26`.
- Review execution: Node.js 26.13.0 was selected with `nvm use`. The checkout remained clean. No application tests, installations, repository edits, commits, pushes, delegation or board messages ran. The only executable probe calculated encoded sizes in memory; its status-record shape was explicitly illustrative. No Effect or other external library claim is certified by this review.
- Some large document reads were truncated. Relevant sections used as evidence were reread in smaller chunks. One attempted read used the nonexistent `commands/reload.ts` path; the actual module, `recovery/reload.ts`, was subsequently read. Neither event changed a file or supplied an unsupported code anchor.
- The assigned scratch folder was never created and was confirmed absent before writing. Only this result file is written. No model policy prevented a check, and no refusal is recorded.
