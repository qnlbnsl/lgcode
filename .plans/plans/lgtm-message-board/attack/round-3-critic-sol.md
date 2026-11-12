revise
Grade: 6  B/M/m: 0/3/2  Flags: none

## Review basis

This is the round 3 plan-critic review of plan version 3 and board contract version 4. The checkout is at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. In citations, `board/` means the supplied `board-r3/lgtm-message-board/` folder, and `inputs/` means its sibling inputs folder. Other paths are relative to the recorded checkout. These are findings about specified decisions and acceptance criteria, not claims that future implementation tests have failed.

The pending extension-seam approval, package setup, scopes, vendor allowances and four widened exclusions are known gaps. They are not filed again. No finding requires reopening the owner's security-deferral ruling.

## Findings

### C3-01. MAJOR. A group member's crash both preserves and withdraws its authored questions

Category: Design; Bug (failures). Evidence status: confirmed contradiction. Responsible builder: board access and membership units 2b and 3c, with lifecycle unit 3b and the planner.

Scenario: Labelled worker W is a non-manager member of group channel C. W asks another member a question, then crashes before the answer. The lifecycle rule leaves W's authored question open so that replies can still be recorded. However, a live agent explicitly excludes a crashed agent, and only live label carriers are group members. W therefore leaves C on the same crash. The membership reactor withdraws every leaving author's open question in that channel. W's question cannot both stay open and close as withdrawn. A later answer is either collected or rejected as an answer to a closed question, depending on which rule the builder chooses.

Evidence: `board/contract.md:44` defines live agents; `board/contract.md:74` requires a live label carrier. `board/plan.md:307` withdraws an author's posts on channel exit, while `board/plan.md:308` preserves them on author crash. Unit 3b repeats preservation at `board/plan.md:519`; unit 3c explicitly includes crashes that change computed membership and withdraws leaving authors' posts at `board/plan.md:534`. The contract repeats the preservation promise at `board/contract.md:202`.

There is also a recovery edge within the same membership decision. W becomes live again on resume without receiving another initial start event or label change. At the recorded commit, `SessionOpened` updates the existing agent's lifecycle and session at `packages/engine/src/views/apply.ts:185`. The planned membership-event list omits that event, and the join-watermark rule names only `AgentStarted` and `AgentGrouped` (`board/contract.md:332`). It does not define W's return to the group or its read position.

Why the round 2 answer fails: Row 65 correctly removes holder availability from ancestry, and L21 fixes the anchor. It retains the live-agent restriction, while asserting that a crash changes no one's membership (`board/decisions.md:75`; `board/contract.md:80`). Thus C2-01's manager exception and the pause case are answered, but the lifecycle reconciliation represented by R2-L3, logic M2 and threat S4 remains incomplete. The opener's manager exception does not protect an ordinary member author.

Suggested fix: Reconcile membership, crash preservation and re-entry in one explicit lifecycle table. State whether a crash suspends membership or removes it, which rule controls authored questions, and which recovery events restore membership and initialize or preserve read state. Carry the L18/L21 promises through that table; take any necessary change to the lead. Test a non-manager author as well as the manager and recipient cases.

### C3-02. MAJOR. One completion can exceed the entire wake budget

Category: Design; Bug (failures). Evidence status: confirmed incompatible payload requirements. Responsible builder: board contracts, wake builder and lifecycle units 1, 3a and 3b.

Scenario: A lead sends an `all` collection to sixteen workers. Each worker replies once with 16,384 backslashes. These are allowed posts and survive the stated control-character removal. The reply text alone occupies 524,288 bytes when JSON encodes it: sixteen times 16,384 times two. Headers, dispositions and markers add more. A completion carrying every reply cannot fit a 262,144-byte wake body, even when it is the only completion owed.

Evidence: `board/contract.md:161` allows the post length, and `board/contract.md:162` allows sixteen addressees. A completion includes every disposition and the replies at `board/contract.md:53` and `board/decisions.md:79`. `board/plan.md:471` requires the asker to receive every reply at close. The encoded body cap and completion-first packing are `board/plan.md:453`. The overflow rule only leaves posts open and unread and points to an incoming-open-post query (`board/contract.md:249`). A completion concerns a closed post, so that rule does not define its overflow behavior.

Why the round 2 answer fails: Row 69 fixes durability through crash, return, merge and cleanup, but adds no representation for an oversized completion. Row 72 fixes how bytes are counted, not whether the minimum required completion can fit. This is the remaining byte-packing case of C2-02/R2-A2/R2-L4, rather than a repeat of the repaired UTF-8-versus-JSON calculation. Omitting the completion violates its debt; treating a partial result as a complete one violates the every-reply promise. Retrying cannot make this payload smaller.

Suggested fix: Define a bounded completion representation. For example, deliver the outcome, dispositions and reply references once, then fetch reply text through authorized paged reads. Alternatively, specify durable chunks and exactly when each obligation is discharged. State how overflow is shown, how it is recovered, and how the body cap interacts with several owed completions. Add a maximum-sized sixteen-worker collection criterion.

### C3-03. MAJOR. The bounded snapshot falls back to unbounded replies

Category: Design; Bug (failures). Evidence status: confirmed missing response bounds. Responsible builder: board contract and registration units 1 and 4, with the client-helper owner.

Scenario: Fifty authors each have their permitted sixty-four open questions. Every question names the same target T and fifteen other agents. A `board.status(T)` reply includes 3,200 incoming question records and their addressee lists. With the engine's ordinary 36-character agent ids, those addressee strings alone occupy 1,843,200 bytes before JSON punctuation, post ids or dispositions. That exceeds the 1,048,576-byte network limit. Each author respects the cap. The group-channel size has no board limit.

Evidence: The per-author cap is `board/contract.md:171`; the per-post addressee cap is `board/contract.md:162`; unbounded group membership is `board/contract.md:89`. The full incoming question metadata, including addressees and dispositions, is required in `board.status` at `board/contract.md:383`. It has no pagination, byte limit or continuation rule. `board.channels` likewise lists all readable channels without a bound (`board/contract.md:382`). The snapshot cap and fallback are `board/contract.md:342`. The network limit applies to the largest single event or reply at `inputs/client-api-contract.md:570`. Today's engine generates agent ids with `randomUUID()` at `packages/engine/src/commands/start.ts:34`.

Why the round 2 answer fails: R2-A1/S1/R2-TM-2 are answered for the initial board section: removing history and adding a cap prevents that section from growing without bound. Row 71 and L21 then depend on `board.status` and `board.channels` for recovery and owner waits (`board/decisions.md:81`, `board/decisions.md:93`). Neither fallback is bounded. The 64-post cap is per author, while status fan-in is per recipient; it therefore does not bound this response. The snapshot fix moves the same transport failure into the named recovery path.

Suggested fix: Bound every fallback reply. Page channel lists and potentially large status collections, or provide a compact per-agent condition summary separately from paged detail. Define how `waitForAgents` obtains complete condition inputs without downloading every incoming question. Extend the maxima and recovery criteria to exercise these replies over the network with more than one author's quota.

### C3-04. MINOR. Pure-condition equality is required from a snapshot that omits its inputs

Category: Design (acceptance criteria). Evidence status: confirmed mismatch between the specified representation and its test. Responsible builder: board contracts and registration units 1 and 4.

Scenario: The condition must determine whether an incoming unresolved question has no queued or sent board wake carrying it. The full view records each wake's target and carried posts. The snapshot specifies only queued wake ids, with no carried-post mapping or sent wake entries. A pure function of that section cannot distinguish which incoming questions those ids carry. Truncation may also omit an agent's open question or completion metadata.

Evidence: The full wake index is `board/plan.md:379`. The condition is `board/plan.md:546`. Snapshot fields and truncation are `board/contract.md:345`. Nevertheless, criteria 1.7 and 5.9 require the same pure-condition answers from the bounded section and the full view (`board/plan.md:343`, `board/plan.md:610`). Row 83 instead says the client helper reads status when truncated (`board/decisions.md:93`); that extra read is not an input to the pure function.

Suggested fix: Specify sufficient compact condition inputs, or make the partial result explicit and test the snapshot-plus-status recovery algorithm. Qualify the equality criterion for complete inputs. Do not require a pure function to infer omitted metadata. This finding concerns the acceptance contract; C3-03 separately covers the fallback's transport feasibility.

### C3-05. MINOR. The overflow test expects a narrower query than the contract defines

Category: Design (acceptance criteria). Evidence status: confirmed inconsistency. Responsible builder: board wake unit 3a and its test writer.

Scenario: A capped wake carries Q1 and leaves Q2 out. Both remain open and neither has a disposition for the target. Under the new `incoming` definition, a subsequent read returns both questions. Criterion 3.8 instead requires it to return exactly the left-out ones.

Evidence: `incoming` selects open unresolved questions needing the caller's reply, without an unread or omitted-from-wake restriction (`board/contract.md:328`; `board/decisions.md:90`). `board/plan.md:476` requires “exactly the left-out ones.” Merely carrying Q1 in a wake does not resolve its addressee.

Why the round 2 answer otherwise holds: Row 80 fixes R2-L5's wrong-direction query. The omitted questions are now retrievable. Only the new exact-set assertion contradicts that corrected query.

Suggested fix: Assert that the pages contain every omitted question and preserve authorization, allowing already-carried unanswered questions too. Add a new filter only if the product actually needs that narrower result.

## Risk register

Scores use launched behavior. Each score is severity × fallout × probability. No finding is accepted, deferred or closed by this reviewer.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and band | Evidence | Responsible area | Decision, deadline and closing evidence |
|---|---|---|---|---|---|---|---|
| C3-01 | 6: a promised collection can be withdrawn instead of preserved | 3: the owner can recreate the question | 4: one member-author crash | 72, schedule | Confirmed contradiction | Board membership and lifecycle | Unset; within this phase or a dated owned follow-up. No closing evidence. |
| C3-02 | 6: a valid completed collection has no defined deliverable result | 3: stored replies can be read manually | 4: an unusually large but allowed collection | 72, schedule | Confirmed payload conflict | Board wake builder and contracts | Unset; within this phase or a dated owned follow-up. No closing evidence. |
| C3-03 | 6: status recovery and owner waits fail on the remote surface | 3: the owner can use the local surface pending repair | 4: a large allowed fan-in | 72, schedule | Confirmed missing bound | Board queries; client helper | Unset; within this phase or a dated owned follow-up. No closing evidence. |
| C3-04 | 1: the equality criterion lacks sufficient inputs | 1: verification and development | 10: the stated shape always omits the necessary mapping | 10, record | Confirmed | Board contracts and registration | Unset; review at phase end. No closing evidence. |
| C3-05 | 1: the written expected set contradicts the query | 1: verification and development | 10: the specified overflow scenario exposes the mismatch | 10, record | Confirmed | Board wakes and tests | Unset; review at phase end. No closing evidence. |

No severity-floor adjustment applies. Security deferral does not explain away the functional contradictions.

## Round 2 answer audit

“Answered” below means the decision is now specified consistently for the original scenario. It does not mean implementation proof exists.

| Round 2 findings | Assessment of the version 3 answer |
|---|---|
| C2-01; manager-membership part of R2-L3, logic M2 and threat S4 | The manager exception and fixed anchor answer the original missing-manager and availability-dependent ancestry cases. C3-01 identifies the remaining live-member crash and recovery interaction. |
| Threat S3 | The owner names an anchor and unrelated subtrees are excluded. Answered by rows 65 and 66 and criterion 2.6. |
| C2-04, R2-TM-1; logic M3 | Per-post rebuild behavior and send-time validation are specified. The supplied seam item 15 now covers inside/outside-tree and callerless deliveries under L22. Answered for the original queue/send race. |
| R2-A4, C2-03, R2-L2; direct-grant part of logic M2 | Row 68 supplies a terminal transition and readable history when the last grant ends. Criterion 4.4 covers loss of the last of two supporting channels. Answered. |
| R2-A2, C2-02, R2-L4, logic m1 and m5 | Row 69 preserves debt through crash, cleanup and return, includes other-party withdrawal, and covers the reactor gap in settlement. Those original orderings are answered. Oversized completion representation remains C3-02. |
| R2-A3, R2-L1, logic M4 and m3 | Row 70 uses the interrupted/non-reloadable state immediately, includes startup catch-up, refuses new impossible requests and permits the specified late-reply upgrade. Answered. |
| R2-A1, threat S1, R2-TM-2 | The initial snapshot is bounded; its fallback and condition criteria remain incomplete under C3-03 and C3-04. |
| C2-05, threat m1, R2-TM-3 | Row 72 measures JSON-encoded bytes and strips the stated controls. Answered for individual wake/event escaping. C3-02 concerns a completion's minimum required content instead. |
| Threat S2, logic m7 and threat m4 | Start ceilings are retained explicitly, ancestry exceptions are stated, and the digest claim is narrowed. Answered. |
| Threat m2 and m3 | Status contains no post text or channel name; wake headers use channel ids; channel names use the explicit slug pattern. Answered for the original text surfaces. |
| Threat m5, R2-TM-4 | Receipts are included in the store inventory and secret scan. Answered. |
| Logic m2 and m4 | Incoming holds require no disposition, and self-addressing is refused. Answered. |
| Logic m6 | Initial joins start at the channel head. That original backlog case is answered; C3-01 includes the distinct crash/rejoin event gap. |
| R2-L5 | The incoming query fixes retrieval direction. C3-05 corrects its overstrict acceptance set. |
| C2-06 | Criterion 6.3 now distinguishes board events from the documented own/child thread exception and adds a positive control. Answered. |
| Logic M1 | Row 82 and criterion 3.5 preserve the other worker's queued demand in an open all-mode collection. Answered. |
| Lead L17, L18, L19 and L21 | Service direct pairs, anchored membership, send-time checks and bounded initial summaries are incorporated. C3-01 and C3-03 concern unresolved consequences, not requests to undo those rulings. |

## Gate and feasibility assessment

The scope audit finds no additional unmarked exclusion beyond row 44's already-known WIDENED list. Rows 2 to 5 tie the main scope and run-mode boundary to the epic and repository instructions. L14 expressly permits the four marked exclusions to await confirmation at acceptance.

| Gate | Assessment |
|---|---|
| 1. Decisions | Pending seam approval and widened exclusions remain explicit known dependencies. C3-01 and C3-02 require reconciled behavior decisions. |
| 2. Acceptance | Observations are named. C3-04 and C3-05 identify inconsistent expected observations. |
| 3. Design artifacts | No screen or changed visual hierarchy is proposed. |
| 4. Traceability | The source universe and both prior-round maps are present. The audit above covers all 39 round 2 entries. |
| 5. Risks | Each workstream has a risk table. This report adds the remaining consequences. |
| 6. Verification | Named test files are future targets. Rollout is centralized. Existing acceptance and fake-agent patterns support the proposed public-API scenarios. |
| 7. Adversarial review | Prior rounds are recorded. This report supplies the critic result for round 3, not clearance from the other lenses. |
| 8. Anchors | The cited engine wait, holder, view, id-generation and fake-agent patterns resolve at the recorded commit. No new broken code anchor is filed. |
| 9. Guardrails | The table covers the applicable repository rules and lead-owned documentation updates. No new house-rule breach is confirmed. |
| 10. Sizing | Eight units and 27 launches are stated. Scopes, package registration and remaining vendor allowances stay known launch prerequisites. |

The fake agent's `exec` step runs Node with its supplied arguments and inherited agent environment (`packages/testing/src/fakeAgent.ts:203`). A test can therefore invoke the CLI TypeScript entry through Node; it should not pass the shell launcher itself as a JavaScript module. This is feasible with the existing harness and does not require a new test mechanism. The acceptance harness already documents real-socket calls with real owner credentials and agent tokens (`packages/engine/test/support/acceptance.ts:22`).

## Proposed post-build checks

These checks verify decisions after the findings above are reconciled. They do not choose the missing policies.

| Id | Scenario | Expected result | Required evidence | Responsible area |
|---|---|---|---|---|
| C3-PB1 | A non-manager group member authors a question, crashes, resumes and receives a reply; repeat with label removal and manager inheritance. | Each transition follows the reconciled membership table. Author crash has the chosen preservation outcome, and re-entry/read state is deterministic. | Ordered lifecycle and board events, allowed/denied replies, read positions and live/rebuilt equality. | Board 2b, 3b and 3c. |
| C3-PB2 | Sixteen maximum-length escaped replies complete one collection; several such completions accumulate for a busy author. | Every completion has a bounded notification and a working route to all replies. Acceptance discharges exactly the promised debt. | Encoded full bodies, completion ids, exact recovery calls and debt before/after acceptance and restart. | Board 1, 3a and 3b. |
| C3-PB3 | The initial snapshot truncates on a fifty-author workload with maximum fan-in, and the owner uses the documented recovery and wait helper. | Every reply fits the network cap, all pages are recoverable, and owner waits agree with agent waits. | Actual network frames, continuation cursors, condition inputs and paired wait results. | Board queries/registration and client helper. |
| C3-PB4 | A wake carries some unresolved questions and omits others; execute and page the exact incoming-query hint. | Every omitted question is returned; other still-unanswered incoming questions may also appear under the current filter. | Packed and omitted post-id sets, exact query payloads and complete authorized page union. | Board 3a and acceptance. |
| C3-PB5 | Delay the membership reactor while removing a busy target's label; repeat with the board disabled and with a callerless rebuilt wake. | The send-time reach check prevents revoked queued text from being sent. | Transaction barriers, dispatcher withdrawals, runner-delivered bodies and rebuilt view equality. | Board 3c and seam dispatcher. |

## Noted, not filed

- Known gap 8's seam wording has been resolved in the supplied input: item 15 applies to every piece delivery at queue and send, and item 16 uses “has no disposition” (`inputs/client-api-contract.md:648`, `inputs/client-api-contract.md:664`). It is not another finding.
- Same-user file access, parent thread visibility, indefinite retention and uncertain external resend remain stated boundaries. Existing engine issues 152, 164, 193, 194 and 195 are not filed again.
- No new external-library behavior claim is needed for these findings. This review writes no Effect code and claims no future board test has run.
- Review execution: Node.js 26.13.0 was selected with `nvm use`. The checkout was clean at the final read-only check. No application tests, installs, repository edits, commits, pushes, delegation or team-board messages were performed.
- Some broad reads exceeded output limits. Finding evidence was checked in subsequent focused, numbered reads. No read failure changed a file.
- The assigned scratch folder was never created and was absent at the final check. This result is the only file written. The plans lead owns issue-list and feature-list integration.
