revise
Grade: 6  B/M/m: 0/3/0  Flags: none

## Review basis

This reviews message-board plan version 3 and contract version 4 against the supplied client API contract and owner and lead rulings.
The checkout is at `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`.
References beginning `board/` resolve in this review batch's `lgtm-message-board/` directory.
References beginning `inputs/` resolve in the sibling inputs directory.
Repository source references resolve in the assigned checkout.
API means application programming interface.
JSON means JavaScript Object Notation.
KiB means kibibyte, or 1,024 bytes.
MiB means mebibyte, or 1,048,576 bytes.

Most round 2 answers hold as plan decisions.
Three gaps remain in their interaction with completion delivery and bounded reads.
R3-TM-1 is a security finding deferred under run `team-rules.md`, rule 8.
It does not block this planning phase.
R3-TM-2 and R3-TM-3 concern ordinary failures of promised client and collection flows and request plan revision.
The lead records these findings in `docs/issues.md` in the integrated change and sends the security finding to the manager's attack list.
This reviewer changes no repository document.

## Findings

### R3-TM-1. The completion exemption lets a stale reply-bearing wake pass the send-time check

Severity: MAJOR.
Category: Security, access and confidentiality; Design.
Responsibilities: 1, isolation; 3, access; 5, confidentiality.
Evidence status: Confirmed contradiction between the specified completion exemption and content revocation; no implementation failure is claimed.
Responsible builder: Board access and reach unit 2b, wake unit 3a and membership unit 3c, with the seam dispatcher owner.

Scenario: Agent A is an ordinary labelled member of group channel C, not its manager.
A asks a question and then becomes busy with other work.
B replies in C, closing the question and queuing a completion to A with B's reply text.
Before that wake is sent, the owner removes C's label from A.
The engine commits the removal, but the board reactor has not processed it yet.
A ends its current turn, and the dispatcher checks the queued completion on the new snapshot.
The completion always passes the four reach rules, even though A is no longer a member.
Its stored body still contains B's text.
The send is reserved after revocation, so the exception for already-sent text does not cover it.
The same hole remains when the board reactor is switched off.

Evidence: `board/contract.md:115` requires a send-time reach check.
However, `board/contract.md:131` says a completion to its author always passes rules 1 to 4, while allowing reply text only while the author remains a member.
`board/decisions.md:79`, row 69(7), repeats that unconditional reach exemption.
Group cleanup runs in the later reactor batch at `board/contract.md:289` and `board/plan.md:534`.
The seam's reach hook is a pure authorization function of the transaction snapshot (`inputs/client-api-contract.md:233`), and its send-time operation withdraws a failing delivery (`inputs/client-api-contract.md:658`).
It does not rewrite a passing delivery's text.
The board's off switch retains that check but stops its reactor (`board/contract.md:419`).
At the recorded commit, reservation takes the stored delivery row and subsequently passes that delivery to the runner (`packages/engine/src/routing/deliveries.ts:239`, `packages/engine/src/routing/deliveries.ts:251`, `packages/engine/src/routing/deliveries.ts:255`).
That is the existing path the seam extends, rather than a body reconstruction at send.

Why the earlier answer does not fully hold: Row 67 and L19 answer R2-TM-1 for ordinary carried posts.
Row 69 introduces a durable completion that bypasses the membership check.
Checking every delivery under L22 does not help when this delivery is specified to pass unconditionally.
The text-only-while-member sentence states the desired result but conflicts with the predicate and delayed rebuilding that must enforce it.
This finding concerns that newly explicit exemption, not the answered general requirement to register and re-run reach checks.

Suggested fix: Separate permission to notify the author from permission to send the completion's captured text.
At send time, reject a queued wake containing reply text its target can no longer read.
Let the reactor replace it with a completion containing only the outcome and removal reason, while preserving its durable obligation.
Alternatively, specify an equivalent atomic content check and reconstruction before reservation.
A completion without reply text may retain the unconditional notification grant.
State the behavior while the board is off and add a completion-only case to criterion 4.9.
This is an access-boundary decision before implementation, not only a race test.

### R3-TM-2. Snapshot truncation falls back to replies that have no size bound

Severity: MAJOR.
Category: Design; Bug, failures.
Responsibility: 3, reliable access to the owner's client surface.
Evidence status: Confirmed missing bound in the specified fallback.
Responsible builder: Board contracts unit 1 and registration unit 4, with the client wait-helper owner.

Scenario: A plain channel contains 49 agents with compatible ceilings.
Forty-eight authors each have 64 open `all` questions addressed to busy agent W and 15 other eligible members, excluding the author.
Every post respects the author and addressee limits.
W has no disposition on these 3,072 posts.
The snapshot truncates and the client follows the prescribed fallback to `board.status(W)`.
The reply must include each incoming post's addressees, among other metadata.
For 36-character agent ids, JSON containing only those `to` arrays and minimal per-item objects is already 1,944,577 ASCII bytes.
That lower bound excludes post ids, channel ids, modes, dispositions, counts and the response envelope.
It exceeds the network's 1 MiB message limit.
The device cannot complete the fallback, and `waitForAgents` cannot obtain the inputs L21 requires from it.

Evidence: The plain-member limit is 64 (`board/contract.md:66`).
The per-author limit is 64 open questions, and a post may have 16 addressees (`board/contract.md:162`, `board/contract.md:171`).
The fallback is `board.channels` and `board.status` (`board/contract.md:349`; `board/decisions.md:81`, row 71).
`board.status` returns all the specified open-post metadata, including addressees, in its reply (`board/contract.md:383`).
Neither that command nor `board.channels` has a cursor, page limit or encoded-size policy in the command table (`board/contract.md:382`).
Only `board.read` has the bounded paged-read policy (`board/contract.md:324`).
The transport limit applies to every reply (`inputs/client-api-contract.md:570`).
The engine mints agent ids as random UUIDs (`packages/engine/src/commands/start.ts:34`), so 36-character ids are a concrete source-supported case.
The byte lower bound was calculated in memory with JSON serialization; it is not a network test.
Unlimited accumulated channel listings and owed completions provide additional growth paths.

Why the earlier answer does not fully hold: Row 71 and L21 bound the initial snapshot and authorize the fallback.
They do not bound the replies used to retrieve the omitted information.
R2-TM-2 and S1 are answered for the initial snapshot's historical text, but the replacement flow can still exceed the same transport limit with legal current metadata.
This does not reopen the approved choice of a small snapshot or request a larger finite transport limit.

Suggested fix: Define bounded pagination for the channel and status detail lists.
Give the wait helper a bounded per-agent condition summary, or a complete paged protocol, that preserves its snapshot and event-sequence consistency.
State maxima for these replies in the board contract and the composition size test.
Add a criterion that forces snapshot truncation and completes the actual fallback with many incoming questions and accumulated channel history.

### R3-TM-3. One completion can exceed the entire wake cap, with no overflow or discharge policy

Severity: MAJOR.
Category: Design; Bug, failures.
Responsibilities: 3, reliable access; 4, correctness of the promised completion flow.
This is not classified as permanent data corruption because the replies remain in the log.
Evidence status: Confirmed incompatible limits and missing failure policy.
Responsible builder: Board contracts unit 1, wake unit 3a and completion lifecycle unit 3b.

Scenario: A lead asks 16 addressees for an `all` collection.
Each sends one valid 16,384-character ASCII reply.
When the final reply closes the collection, the completion owes the lead every reply and every disposition.
The reply text alone totals 262,144 bytes, exactly the entire encoded wake-body budget.
Headers, markers, outcomes and dispositions necessarily make the completion larger.
Quotes and backslashes make this overflow possible with fewer replies.

The plan gives no partial-completion representation, continuation cursor or bounded summary-and-read policy.
Sending every reply violates the cap.
Leaving this completion out keeps it owed, and the hold-unsettled condition remains true without any defined way to fit the item into a later wake.
Truncating it silently and then accepting the wake discharges the whole obligation without delivering the promised result.
The two-return failure rule does not address an item that cannot be constructed within the cap.

Evidence: The text and addressee limits are at `board/contract.md:161` and `board/contract.md:162`.
A completion includes every disposition and the replies (`board/contract.md:53`; `board/plan.md:471`).
It is discharged only by acceptance of a wake naming the completion (`board/plan.md:310`).
The wake body is capped at 256 KiB encoded and places completions first (`board/plan.md:453`).
The documented overflow hint is exclusively for posts needing the target's reply (`board/plan.md:457`), and `incoming` reads those open questions (`board/contract.md:328`).
A closed collection owed to its author is not such an incoming question.
An owed completion that has not failed twice holds the author unsettled (`board/plan.md:546`).
No completion overflow case appears in criteria 3.8, 4.2 or 4.3 (`board/plan.md:476`, `board/plan.md:560`).

Why the earlier answer does not fully hold: Row 69 answers the merge, crash and return cases of R2-A2, C2-02 and R2-L4 with durable obligations.
It does not define how that obligation makes progress when a single result exceeds the body cap.
R2-L4 explicitly requested preservation through byte packing; the new lifecycle alone cannot establish it.
The corrected encoded-byte calculation of row 72 is sound and is not re-filed.

Suggested fix: Decide how a large completion is represented before the build.
A bounded notification can name the closed post and direct the author to a paged read of its replies, with an explicit rule for when that notification discharges the obligation.
Alternatively, define partial completions with durable progress and acceptance per part.
Keep the member check on retrieved text.
Specify what the wake carries if even its first completion cannot fit, and test one oversized completion as well as several ordinary completions.

## Risk register

Scores are severity × fallout × probability.
No severity floor applies.
Decisions and individual risk acceptance belong to the owner.
No finding is marked accepted or fixed by this review.

| Id | Severity score and reason | Fallout score and reason | Probability score and reason | Score and band | Evidence | Owner | Decision and deadline | Acceptance and closing evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R3-TM-1 | 6. Private reply text reaches an agent after its API membership is revoked. | 7. Delivered text cannot be recalled. | 6. Removing a busy member is ordinary specific use; the unresolved scheduling boundary is scored at its worst plausible probability. | 252, fix before release. | Confirmed plan contradiction. | Board reach, wakes and membership, with seam dispatch. | Security fix deferred under run rule 8; lead and manager track it. Normal deadline: before release to real users. | No individual acceptance or closing evidence. |
| R3-TM-3 | 6. A promised collection result or its settled state requires intervention. | 3. The owner can recover retained replies through authenticated history. | 6. A collection with several substantial answers is ordinary specific use; no unrelated faults are required. | 108, schedule. | Confirmed incompatible limits. | Board contracts, wakes and completion lifecycle. | Unset; within this phase or a dated follow-up with an owner. | None. |
| R3-TM-2 | 6. The device fallback and wait helper fail for an affected deployment. | 3. Bounded reads can recover the retained state. | 4. Large simultaneous incoming work or long channel history is a less frequent but permitted state. | 72, schedule. | Confirmed missing bound. | Board contracts and registration, with client wait helper. | Unset; within this phase or a dated follow-up with an owner. | None. |

## Round 2 answers checked

The table groups every finding in `board/attack/round-2-findings.md` by its shared decision.
A statement that an answer holds means the plan now supplies the decision, not that unbuilt tests passed.

| Earlier findings | Answer and assessment |
| --- | --- |
| C2-01, R2-L3, logic M2, S4 | Rows 65 and 83, criterion 2.6: fixed ancestry and anchor, with current-manager membership. Holds under L18 and L21. The approved inherited-manager exception is explicit. |
| S3 | Row 66, criterion 2.6: owner names an anchor. Holds. Admission controlled by parents within that subtree is a stated edge. |
| C2-04, R2-TM-1, logic M3 | Row 67, criteria 2.11 and 4.9: per-post checks and send-time withdrawal, including while disabled. Holds for ordinary posts; R3-TM-1 identifies the completion-text exemption. L22 in the supplied API resolves known gap 8(a). |
| R2-A4, C2-03, R2-L2 | Row 68, criteria 2.7 and 4.4: ending the last direct grant resolves obligations; another remaining shared channel preserves it. Holds. Readable direct history is explicitly retained. |
| R2-A2, C2-02, R2-L4, logic m1 and m5 | Row 69, criteria 3.3, 3.5, 4.2 and 4.3: durable completions, acceptance discharge and bounded retries. Holds for the named merge, crash and return cases. R3-TM-3 covers the unanswered packing case. |
| R2-A3, R2-L1, logic M4 and m3 | Row 70, criteria 3.12, 4.1 and 6.5: non-reloadable interruption and catch-up resolve `gone`; a late reply can upgrade it while open. Holds as a plan rule. |
| R2-A1, S1, R2-TM-2 | Rows 71 and 83, criterion 5.9: no historical text, cap and truncated fallback. Initial snapshot bound holds; fallback completeness and size fail under R3-TM-2. |
| C2-05, threat m1, R2-TM-3 | Row 72, criterion 3.8: JSON-encoded body budget and control removal. Holds for the original encoding-expansion problem. |
| S2, logic m7, threat m4 | Row 73, criterion 2.9: start ceilings with the ancestry exception; narrower no-reply text remains data. Holds. The separately recorded engine ceiling concern is not re-filed. |
| Threat m2 and m3 | Row 74, criteria 1.5 and 5.6: status has ids, counts and states; wake headers omit channel names. Holds for text exposure and header provenance. |
| Threat m5, R2-TM-4 | Row 75, criterion 5.11: receipts added to inventory and scans. Holds. The existing receipt writer stores committed envelopes at `packages/engine/src/log/EventLog.ts:210`. |
| Logic m2 | Row 77, criterion 4.7: incoming condition counts only addressees without a disposition. Holds; supplied seam item 16 also uses that wording. |
| Logic m4 and m6 | Rows 78 and 79, criteria 3.12 and 2.3: self-address refused and join watermark defined. Holds as written. |
| R2-L5 | Row 80, criterion 3.8: `incoming` reads omitted questions needing the caller's reply. Holds for those questions; it does not solve completion overflow. |
| C2-06 | Row 81, criterion 6.3: hidden board events plus an explicit own/child thread control. Holds. The existing stream's own/direct-child predicate is at `packages/engine/src/api/server.ts:155`. |
| Logic M1 | Row 82, criterion 3.5: one addressee's resolution cleans only that addressee's wake; closure cleans all. Holds. |

L17's service direct pair is present in criteria 2.7 and 2.8.
L19's dispatcher transaction and L22's application to every piece delivery are explicit in the supplied API contract.
The pending owner seam decision remains a prerequisite, not an assumed approval.
L21 controls the board's bounded snapshot despite the older whole-view wording still present at `inputs/client-api-contract.md:305`.
That ruled wording difference is not a new finding.

## Trace of the six security responsibilities

1. Isolation. This is one owner's installation with separate agent identities. Devices intentionally have owner rights. Board events are owner-only, agent snapshots omit the board, reads require membership, replies stay in their channel, and status omits text. R3-TM-1 concerns a derived copy after access removal. Accepted same-user disk access and the documented parent-thread exception remain separate limits.
2. Identity across sessions. The board adds no second-owner login system. It inherits caller identity and device credentials. The existing command handler verifies an agent or device before receipt lookup (`packages/engine/src/commands/CommandHandler.ts:201`). The socket rechecks credentials and invalidates connections (`packages/engine/src/api/server.ts:111`). Device-cache clearing after sign-out or pairing to another installation remains client-area implementation evidence. Provider sign-out pauses delivery rather than changing who owns the board; the existing dispatcher checks signed-out account state (`packages/engine/src/routing/deliveries.ts:230`).
3. Access. Every board command uses the seam's authenticated transaction path. Service identity is in-process only, and network payloads cannot choose the author. Start ceilings and current channel reach are explicit. R3-TM-1 is the remaining completion-content boundary. R3-TM-2 and R3-TM-3 are ordinary bounded-flow failures. Owner-alert limits and namespace-only queued withdrawal remain required.
4. Integrity. Posts and wakes share the command transaction. The board view rebuilds from events; resolutions and reactor work are idempotent. Sparse read tracking and completion obligations are explicit. R3-TM-3 leaves notification progress undefined but establishes no permanent loss of stored replies. External sends may repeat without replay proof, under the stated engine guarantee.
5. Confidentiality and deletion. The inventory covers post events, delivery and prompt events, receipt envelopes, the memory view, device caches and harness session files (`board/contract.md:352`). Closure deletes none of them. Event-log retention remains existing issue 1 (`docs/issues.md:20`). The board introduces no encryption-at-rest design, and inherited file permissions do not establish that property. This review does not certify encryption of the database, caches or harness files. Remote-channel encryption belongs to piece 2 under SECURITY.md rule 5. External alerts permit no post text (`inputs/client-api-contract.md:515`).
6. Secrets and dependencies. Posts are redacted before wake construction, and every stored event uses the seam redactor. Receipt, combined-wake and harness-login-token scans remain necessary. Fixed author headers and random data markers preserve text provenance. No new external dependency or copied implementation is proposed; package registration remains known gap 5.

## Proposed post-build checks

These checks verify decided properties and the eventual decisions resolving the findings.
They do not substitute for the missing pre-build rules above.

| Id | Scenario | Expected result | Required evidence | Responsible area |
| --- | --- | --- | --- | --- |
| R3-PB-1 | Queue a completion-only wake containing reply text for a busy non-manager group member. Remove its label, delay the reactor, and end its turn. Repeat with the board off and after restart. | A reservation after revocation sends no inaccessible reply text. The outcome-only completion remains recoverable under the chosen lifecycle. | Mutation and reservation order, queued-body content, runner input and rebuilt completion state. | Board reach, wakes and membership; seam dispatch. |
| R3-PB-2 | Force snapshot truncation with 48 authors' legal incoming questions and with a large channel listing. Initialize a paired device and run the actual owner wait helper. | Every fallback reply fits its bound, all required detail is retrievable, and wait conditions agree with the engine at the chosen sequence boundary. | Fully encoded response sizes, cursors, condition inputs and device results. | Board registration/contracts and client wait helper. |
| R3-PB-3 | Close one 16-addressee collection with maximum replies, then close several collections before the author becomes idle. Repeat with quotes and backslashes. | The chosen bounded completion policy makes progress, retains every reply for authorized retrieval, and never discharges unrepresented work or strands settlement. | Body sizes, continuation or summary fields, acceptance/discharge events and waiter outcomes. | Board wake and lifecycle units. |
| R3-PB-4 | Revoke a device credential or agent token on an established connection, then exercise every composed board read and mutation. Try socket/network author and service overrides. | Revoked credentials yield no new effects or reads. Caller identity cannot be forged, and services exist only in-process. | Responses, connection closure and committed events. | Seam identity, board registration and client listener. |
| R3-PB-5 | Plant registered raw, encoded, split-post and harness-login secrets. Post, merge, read, notify and retry commands. | Secrets are absent from events, receipts, wakes, logs and external alerts. Alerts contain no post text. | Separate scans of each stored and transmitted copy. | Board wake builder, engine redactor and client alerts. |
| R3-PB-6 | Read and subscribe as a member, a removed member, its parent, an unrelated agent and a service. Include direct history after grant loss. | Command membership rules and the stated direct-history exception hold. Board events and snapshot sections stay absent for agents; own/child thread visibility follows the documented exception. | Authenticated response bodies and both subscription streams. | Board access and acceptance units. |
| R3-PB-7 | Sign out a device, then pair the same browser to a different installation. Revoke a provider account while a board delivery waits. | Prior installation data is absent from device caches and rendered views after identity change. Signed-out provider work waits without changing board ownership. | Client storage inspection, visible state and delivery events. | Client device/cache area and engine account area. |

Retain the plan's existing merge/send, restart, namespace-withdrawal, rebuild, wait-projection and maximum-wire-message checks.
No application test or post-build check is claimed to have passed.

## Refused checks

None.

## Noted, not filed

The accepted same-user filesystem limit, inherited manager membership and parent-thread visibility are not new findings.
No finding relies on a user deliberately escaping a self-imposed limit.
Posts are explicitly non-deletable; closure is not presented as erasure.
The existing retention issue and inherited encryption-at-rest uncertainty are not presented as newly introduced board defects.
The package/scoping setup, vendor allowance, pending seam authorization and four WIDENED exclusions remain the supplied known gaps.
Known gap 8's two seam wording points are resolved in the supplied inputs by L22.
No engine wait change or reopening of the owner's agent-only wait decision is requested.

The repository was clean at the recorded commit before writing this result.
Node.js 26.13.0 was selected with `nvm use`.
Only document/source inspection and in-memory size calculations ran.
One calculation initially used unavailable `TextEncoder` in the tool isolate; it was rerun using string lengths for ASCII-only JSON, producing the byte counts cited above.
Some broad reads exceeded the tool output budget; finding evidence was reread in focused numbered ranges.
No application tests, attack tests, dependency installation, commits, pushes or team messages ran.
The assigned scratch folder was never created and was confirmed absent.
Only this result file was written.
