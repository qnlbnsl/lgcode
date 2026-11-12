revise
Grade: 7  B/M/m: 0/2/2  Flags: none

# Logic and failure policy review of plan v5

The direct-engine rework preserves the earlier fixes in the cases they covered. Two interactions still need a plan decision: a usage-limit pause without a reset time, and the wait checks between the two writes of an automatic permission answer. Two smaller defects concern mixed completion wakes and a stale task anchor.

Reviewed the frozen roles plan, its decisions, scouting and requests, the three earlier finding maps and their answers, the frozen client application programming interface (API) v3 and board v6 contracts, and the binding rulings. Code references below are to the read-only checkout at 8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5.

For plan references, the review root is:

/home/qnlbnsl/projects/personal/lgtm-studio/.scratch/foundry-runs/foundation-plans-1/review/roles-r4

- P means lgtm-foundry-roles/plan.md under that root.
- D means lgtm-foundry-roles/decisions.md.
- C means inputs/client-api-contract.md.
- B means inputs/board-contract.md.
- R means inputs/rulings.md.
- K means lgtm-foundry-roles/attack/known-gaps.md.

Repository paths are relative to the recorded checkout. References name the frozen inputs rather than a later working copy.

## Findings

### R4-L1. MAJOR: A usage-limit pause without a reset can make its waiting lead look stalled

Category: Bug (timing, failures).
Evidence status: Confirmed contradiction between the decision procedure and the acceptance requirements.
Responsible builder: The roles stall watch rules builder.

Scenario: An orchestrator has an open post that needs its idle lead's reply. The lead's only child met a usage limit after its delivery was accepted. The adapter supplied no reset time. The worker is paused, and it has no queued or sent delivery. The lead is waiting for that worker's work.

P:717-726 counts a usage-limit pause as busy only with a known reset. Only a signed-out agent counts as an owner dependency. An unknown-reset usage pause satisfies neither branch. The transitive search therefore finds nothing busy or owner-held. The lead can accrue stall episodes, receive nudges, and eventually be advised replaced. Its group can also meet the team-idle predicate.

This is a supported engine state. packages/engine/src/routing/deliveries.ts:179-196 preserves an absent reset time and writes OwnerNeeded when it is absent. The accepted mid-turn pause path does not need a pending delivery to keep this scenario alive; see pauseAgent at packages/engine/src/routing/deliveries.ts:142-155.

The resulting classification conflicts with P:768, P:770 and P:774. Those criteria exclude a lead whose only child is usage-paused, and exclude usage-limit pauses from team idleness without limiting the promise to known resets.

Earlier answer checked: Lo-R3-L4, decision row 74. Counting a known-reset pause as busy fixes its stated reset-driven case. It leaves this unknown-reset branch uncovered. This finding does not reopen the known-reset fix.

Suggested fix: Give an unknown-reset usage pause the same owner-dependency treatment as a sign-in pause, or define an equally explicit exclusion for its waiting ancestors and group. Specify when those clocks restart after the account becomes usable. Add an accepted mid-turn case with resetAt absent, so the test cannot pass merely because an unaccepted delivery remains queued. Cover restart and both stall and team-idle rules.

### R4-L2. MAJOR: The two-write permission answer leaves the blocking-wait boundary unresolved

Category: Design; Bug (timing).
Evidence status: Unresolved integration consequence, with the existing cancellation boundary confirmed.
Responsible builder: The workstream 7a engine permission builder, coordinated with the client API waiting builder.

Scenario: A qualifying harness and standing rule exist. A lead is in a blocking wait for a working child. The child requests a permission that the standing rule answers. The lead is the request's ordinary holder.

P:930-939 and P:966 specify PermissionRequested followed by PermissionAnswered as a second write in the same transaction. They suppress a holder delivery, but do not specify when derived wait checks run relative to those two writes.

At the recorded commit, the runner-event write helper adds withWaitChecks to each write, at packages/engine/src/commands/CommandHandler.ts:146-150. The existing permission request routes to its holder at packages/engine/src/routing/permissions.ts:11-26. An open request held by the waiting lead causes WaitCancelled with reason "request held" at packages/engine/src/routing/waits.ts:33-35 and :82-83. Subsequent checks inspect only open waits, at :110-118.

Thus, retaining today's per-write boundary cancels the wait on the first write. Answering in the second write cannot undo that cancellation. Committing both writes together hides an intermediate state from external readers, but still commits the derived WaitCancelled event. The blocking tool call returns and can cause another lead model step despite there being no queued holder delivery.

C:943-953 retains the request-held check after every batch. Nothing there explicitly makes these two writes one batch for that predicate. P:1003's lead-wake check is insufficient if it counts only deliveries.

A read-only probe of the current check function, with a working lead, a working child, and an open blocking wait, produced:

- With an open request held by the lead: WaitCancelled, reason "request held".
- With the same request already answered: no wait event.

The probe evaluated the source predicate in isolation. It did not execute a future automatic-answer implementation or a full engine transaction.

Suggested fix: State that derived wait checks see the combined projected request-and-answer result for a matched rule, while preserving the two required caller envelopes. For an unmatched request, keep today's immediate request-held cancellation. Name the affected existing W19 cases at packages/engine/test/routing/waits.test.ts:343-357 and the capability-05-wait suite in workstream 7a's regression inventory. Add a matched-rule test that asserts the original blocking wait remains open until the child actually finishes, rather than merely asserting that no holder delivery was queued. The same transaction must avoid any intermediate owner-needed or piece request-held consequence.

This is a missing integration decision, not a claim that the unbuilt implementation already has this bug. Deferring workstream 7a under ruling L27 removes the branch until a harness qualifies.

### R4-L3. MINOR: A completion can be mistaken for a stall-watch-only wake

Category: Bug (timing).
Evidence status: Confirmed mismatch between the turn classification and the board payload.
Responsible builder: The roles notices and turn-classification builder.

Scenario: A lead is owed the completion of an all-replies post, including its workers' replies. The next board wake carries that completion and one stall watch notice. Every entry in the wake's posts list is authored by roles.stallWatch, but the completion carries ordinary work.

B:284-294 gives WakeBuilt separate post and completion lists. Completions are real wake content, and do not occupy the ordinary digest slots. P:434-439 and P:684 classify the wake by post authors alone. That makes this mixed wake a stall watch turn.

The lead has resumed ordinary work, but roles.StallEnded does not clear the alert. The team-idle hour is not restarted. A subsequent status post in that turn also fails the outside-stall-watch-turn progress test at P:750-754. The result is a stale alert or misleading later escalation.

Suggested fix: Classify all content that caused the delivery. A wake carrying an ordinary completion must count as an ordinary turn even when every accompanying post is a stall watch notice. State the completion-only case explicitly too. Add a mixed notice-plus-completion case to N13-N18 and the relevant stall and team-idle tests.

Earlier answers checked: Ls-R3-L2 and TS-R3-TM-3 introduced StallEnded, and Lo-R3-L6 correctly classified stall watch compactions. Those mechanisms remain useful. This is an additional payload branch their author-only classification does not cover.

### R4-L4. MINOR: The stall task still points to the abandoned board package

Category: Design.
Evidence status: Confirmed stale anchor.
Responsible builder: The roles plan owner, coordinated with the board and client API plan owners.

P:783 directs task 4b to the pure status export from packages/board and cites Board v5. The frozen board v6 contract puts that export in packages/engine/src/board/ at B:472-473. The accompanying settled reference is also obsolete after C:924-941 moves it to packages/contracts/src/settled.ts with no old re-export.

Suggested fix: Point task 4b at the board v6 engine-folder export and the shared settled function in the contracts package. Mark the old routing function as historical context if it remains useful. The problem is placement and task guidance; board v6 says the behavioral rules are retained, so this is not a new board semantics objection.

## Risk register

Severity, fallout and probability use the required 1-10 scales. Scores assume real use. Decisions remain pending for the responsible owner. No acceptance or closing evidence is claimed.

| Finding | Severity and reason | Fallout and reason | Probability and reason | Product and band | Evidence | Owner | Decision | Deadline |
|---|---|---|---|---|---|---|---|---|
| R4-L1, unknown-reset pause | 6: The recovery flow gives false replacement advice until the owner fixes the account state. | 3: One team; the owner can restore the account. | 6: A valid usage pause lacks an optional deadline; this needs no second fault. | 108, Schedule | Confirmed specification conflict | Roles stall watch builder | Pending owner decision | Within this phase, or a dated follow-up with an owner |
| R4-L2, automatic answer cancels wait | 6: The promised automatic permission flow can return the lead's blocking call and spend another model step. | 3: One run; the lead can wait again. | 6: A matched permission request while its lead waits is an ordinary specific workflow, conditional on a qualifying harness. | 108, Schedule | Unresolved integration boundary; present predicate confirmed | Engine workstream 7a builder | Pending owner decision | Within this phase, before 7a is accepted, or a dated follow-up with an owner |
| R4-L3, completion classification | 4: An ordinary work turn retains a stale stall or idle classification until a later correctly classified turn. | 3: One agent; subsequent activity repairs the state. | 6: A completion and notice can share an ordinary board wake; no fault is required. | 72, Schedule | Confirmed specification mismatch | Roles notices builder | Pending owner decision | Within this phase, or a dated follow-up with an owner |
| R4-L4, stale placement anchor | 1: This is implementation guidance, with no direct user-visible fault. | 1: Development only. | 10: Every implementation following this task encounters the stale path. | 10, Record | Confirmed stale anchor | Roles plan owner | Pending owner decision | Review at the end of the phase |

No severity floor applies. These bands do not independently require a new owner approval flow.

## Truth table for interacting rules

The table records the intended result where the plan is clear. "Gap" identifies a finding above.

| State or input | Required result | Assessment |
|---|---|---|
| No harness qualifies in the recordings | Standing rules and 7a remain deferred; the other roles work continues. | Defined, P:516-519 and P:921-922; L27 retained. |
| Matcher throws, is malformed, sees missing input, or lacks a trustworthy discriminator or sandbox marker | No automatic answer; ordinary holder routing. | Defined, P:531-610 and P:966. |
| Rule matches but the engine rejects the option, mode, persistence or settings-write check | Ordinary holder routing. | Defined, P:966. |
| Rule matches while its holder has a blocking wait | Answer atomically without a holder delivery or a transient request-held return. | Gap R4-L2. |
| Lead waits through an idle sibling chain ending in a working worker | No stall clock at any upstream link. | Defined, P:717-740. |
| Idle dependency cycle has no busy or owner endpoint | Each member that owes a reply can stall; the group can become idle. | Defined, P:727-733 and P:770. |
| Only worker is usage-paused with a known reset | No lead stall and no team-idle notice. | Defined by the busy rule and P:768-770. |
| Only worker is usage-paused without a reset | Owner-dependency treatment must suppress the same false reports. | Gap R4-L1. |
| Every group member is stopped or paused | No team-idle nudge. | Defined, P:768. This does not cover an idle lead plus a paused worker. |
| Capacity occurs before acceptance, with retries left | Hold the whole queue, keep the delivery at the front, remain idle, and keep waits open. | Defined, P:967. |
| Capacity occurs after acceptance | Preserve acceptance, hold a carry-on, and do not replay accepted work as a new delivery. | Defined, P:967; physical runner behavior needs checking. |
| A board wake is withdrawn and replaced during a capacity hold | Replacement remains behind the agent's hold. | Defined, P:967. |
| Owner or holder releases a capacity hold | Count that release in the same per-agent outage budget. | Defined, P:772 and P:967-968. |
| Restart or account return finds a held queue | Reload idle and held, with no working-with-nothing-sent state. | Defined, P:967. |
| Stall watch is off at startup, with open holds | Release each hold once and create no new capacity holds. | Defined, P:683. |
| First current crash, retry setting 1 | Resume once, wait for SessionOpened, send carry-on only if absent, and tell the holder that old posts resolved gone. | Defined, P:773. |
| Retry setting 0, repeat crash, refused resume, or reload failure | Give up, with the specified holder notice or owner alert. | Defined, P:773 and P:776. |
| Board is off | Suspend stall, idle and cache-flush rules; preserve counts; restart their clocks on return; retain the explicit give-up alert exception. | Defined, P:441-450 and P:679. |
| Wake carries only stall watch notices, with no ordinary completions | Stall watch turn; no StallEnded and no false progress reset. | Defined, P:434-439 and P:684. |
| Wake carries stall watch notices plus ordinary work completions | Ordinary turn. | Gap R4-L3. |
| Missed stall, idle or capacity deadline after downtime | Recheck current state and take one step only. | Defined, P:682. |
| Missed cache deadline or unknown cache lifetime | Drop the missed action; do not invent a new lifetime. | Defined, P:805-833. |

## Earlier answers and the direct-engine rework

The round-3 map contains 27 findings. The following groups account for all of them.

| Earlier findings | Answer retained in v5 | Review result |
|---|---|---|
| TO-R3-2 | Record first; build only for qualifying harnesses, P:516-519 and P:921-922; decision 81. | Holds under L27. No request to build an unused pre-check. |
| TO-R3-1 and TO-R3-3 | Adapter-authored shell discriminator and positive sandbox marker; no model-chosen title as proof, P:531-551. | Holds. Actual adapter evidence remains a build gate. |
| TO-R3-4, TO-R3-5 and Lo-R3-L9 | Import the protected-name test; compare without case; any ModeRefused prevents a match, P:563-588. | Holds. |
| TS-R3-TM-1 | Resolve paths with the engine resolver before matching, P:571-578 and P:966. | Existing aliases covered; residual race remains K:22. |
| A-R3-A1 | Record notice post identifiers and derive read state from board and delivery events, P:452-464 and P:680. | Holds as a specified fold; restart/reroute ordering still needs the planned tests. |
| C-R3-C1, A-R3-A2, Ls-R3-L3, Lo-R3-L8 and TS-R3-TM-2 | Whole encoded rule limit and ordered, bounded snapshot fill, P:386-410 and P:487. | Holds. Independent field maxima are no longer promised simultaneously. |
| Lo-R3-L1 | Transitive dependency traversal with a visited set, P:717-733 and P:770. | Holds for the defined busy and owner endpoints; R4-L1 identifies a missing endpoint. |
| Lo-R3-L2, Lo-R3-L3 and Ls-R3-L1 | Whole-queue holds, engine-owned counts, manual releases counted, and idle held reloads, P:683 and P:967. | Holds as the intended engine change. |
| Lo-R3-L4 | Known-reset usage pauses count as busy, P:717-720. | Holds for known resets; R4-L1 explains the remaining branch. |
| Ls-R3-L2 and TS-R3-TM-3 | Durable StallEnded bridges turn classification to the alert source, P:684. | Mechanism retained; R4-L3 identifies a completion classification gap. |
| C-R3-C2 | Roles now live inside existing engine and contracts packages, P:303-339. | The old requirement to register new packages is superseded. vitest.config.ts:4 and :23-27 already discover tests below these packages. |
| C-R3-C3 | Prepare recorder scenarios and mode/output controls before recording, P:642-643. | Holds. The greeting fixture alone is not treated as proof. |
| C-R3-C4 | Board-off GaveUp owner alert exception, P:679. | Holds. |
| C-R3-C5 | Crash retries have values 0 or 1, with explicit zero behavior, P:773. | Holds. |
| Lo-R3-L5 | Open blocking-wait time is excluded from runaway duration, P:771. | Holds. |
| Lo-R3-L6 | Stall-watch-requested compaction is a stall watch turn, P:437 and P:684. | Holds. |
| Lo-R3-L7 | Only file change, reply to the owed post, or a post outside a stall watch turn resets progress, P:750-754. | Holds, subject to R4-L3's turn classification. |

The earlier round-1 and round-2 answer maps were also checked for preservation. The rework keeps fail-closed matcher guards, receipt ownership and stable action identifiers, narrow service rights, inherited available-holder routing, board-off suspension, explicit crash carry-on and gone-post notices, bounded hand-off with lead relay, and switch-off behavior. I found no additional reopened earlier answer beyond the branches identified above.

The direct engine edits were checked against their current consumers rather than treated as future external dependencies:

| Edit | Recorded-code boundary and test inventory | Result |
|---|---|---|
| 7a permission fields and answer | AcpRunner currently emits title, options and settingsWrite at packages/engine/src/runner/AcpRunner.ts:400-417. Permission answering and its after-commit call are at packages/engine/src/routing/permissions.ts:31-56. P:930-939 names the roundtrip, routing, boundary, hold and capability-07 tests. | Field and caller changes are explicit. R4-L2 adds the missing blocking-wait regression and batch decision. |
| 7b capacity | packages/engine/src/runner/classify.ts:1-16 has only usage and sign-in classes. AcpRunner.ts:170-176 currently maps every classification into a pause outcome. The new capacity class must acquire its own non-pause outcome in that consumer. packages/engine/src/recovery/reload.ts:84-98 currently treats requeued or carried work as working. | P:940-955 and P:967 name the classification, delivery, recovery and command tests, and explicitly change held reloads to idle. The runner outcome mapping is a required post-build check below, not an assertion about unwritten code. |
| 7c usage | packages/engine/src/runner/translate.ts:15-26 currently discards updates outside its recognized content variants. | P:956-959 and P:969 explicitly add usage handling, old-log compatibility, and roundtrip/stream tests. |
| Shared command and event changes, C E1-E7 and E10-E15 | The frozen contract names union, routing, access, caller, sender, view and receipt edits and their tests. The current lifecycle table is exhaustive at packages/contracts/src/stateMachine.ts:78-122. | Keep lifecycle effects explicit for the added tags. The existing matrix test at packages/contracts/test/state-machine.test.ts:288-381 derives tags and expects new non-lifecycle events to keep state; it need not have its expected values rewritten. |
| Visibility, C E8-E9 and E21 | Current subscription behavior and exhaustive fixtures are represented at packages/engine/test/api/subscribe-visibility.test.ts:149-164. | The contract names this test. Add owner-only roles event samples and class-aware expected filtering while preserving expectations for engine tags; do not retain an all-tags self/child expectation for roles records. |
| Sources, withdrawals, reach, and waiting, C E16-E20 and E22 | Piece-owned withdrawal, queue/send reach checks, shared settled and request-held predicates are explicit contract edits. | No second waiting semantics should be invented in roles. R4-L2 concerns their ordering, and R4-L4 concerns the moved anchor. |

## Proposed post-build checks

1. Unknown-reset pauses. Drive an accepted worker turn into a usage pause with resetAt absent. Its idle lead owes an orchestrator a reply. Advance through three stall limits and a team-idle hour, then restart and repeat. Expected: no false lead nudge, replacement advice or team-idle event; the account owner-needed signal remains. Recover the account and verify clocks start from the specified new baseline. Evidence: event sequences, delivery state, roles view before and after rebuild. Owner: stall watch rules builder.

2. Automatic answer while blocked. If 7a is built, enter the lead's blocking wait before the child asks a matching permission. Expected: two correctly attributed permission envelopes, one runner answer after commit, no holder delivery, no WaitCancelled/request-held return, and the wait ends only for its actual member condition. Run unmatched and throwing-matcher controls: W19 must still return request-held. Evidence: wait row, blocking call result, log envelopes and runner calls. Owner: 7a builder.

3. Completion wake classification. Build a wake with a stall-watch-only posts list and an ordinary completion, then a completion-only wake. Expected: both start ordinary turns, end an applicable stall alert, and allow ordinary progress accounting. Compare a true notice-only wake and stall watch compaction. Evidence: WakeBuilt lists, DeliverySent, StallEnded and resulting alerts. Owner: notices builder.

4. Capacity through the real runner boundary. Feed recorded capacity errors through AcpRunner.finish, not only a stub classifyError call. Expected: the third class reaches the hold path rather than becoming a usage/sign-in pause or an invalid runner event. Exercise before and after first content, a replaced board wake, a manual release, last retry, restart, account return, crash, and stall-watch-off startup. Evidence: runner events, held queue order, counts, absence of DeliveryReturned during allowed holds, idle state after rebuild, and exactly one carry-on for accepted work. Owner: 7b builder.

5. Durable action repair. Kill between every command and its action record for post, flush, release, resume, carry-on and compaction. Include a notice accepted before the action record and a recipient crash before replay. Expected: stable caller/request/body deduplication, one logical command per action, correct read-state fold, no lost later flush and no extra resumed turn. Check the allowed physical replay limits separately from logical command counts. Evidence: command receipts, log sequence, rebuilt cursor/action view and runner calls. Owner: stall watch base builder.

6. Permission guard precedence and lifecycle. If built, exercise malformed and throwing pre-checks, expired or disabled rules, device revocation, mode refusal, a disallowed persistent option and protected paths. Change relevant state between path resolution and transaction entry. Expected: current transactional guards deny the automatic answer; ordinary holder routing remains usable; diagnostics contain no raw request content. Separately measure the acknowledged post-resolution symbolic-link race. Evidence: input fixtures, service/holder caller envelopes, diagnostic capture and runner options. Owner: permission builder.

7. Event integration and alerts. Add roles events to roundtrip and visibility coverage, run the lifecycle matrix, and compare rebuilt views. Interleave an engine failure alert and GaveUp in the same transaction. Expected: no lifecycle transition from an action record, owner-only role-event visibility, and one applicable alert with the specified clearing event. Evidence: named existing suites, replay/live subscription output and compare-views results. Owner: contracts and stall watch builders.

8. Production timing and bounded delivery. Retain the plan's real child-process stall check with production minutes. Exercise cache reads that renew a mixed-lifetime entry, missing usage, a missed deadline, and waiting agents. Exercise maximum encoded snapshot and hand-off sizes, including cut-part relay by the lead. Expected: no invented cache lifetime, no catch-up compaction, no compaction while blocked, bounded encoded replies, and a usable lead relay. Evidence: real-process timestamps, usage/transcript records, encoded byte counts and the replacement's received content. Owner: cache, hand-off and acceptance builders.

## Noted, not filed

- The owner's direct-engine authorization and rulings L26-L28 are binding. I do not treat workstream 7 as unauthorized, ask for another owner decision on it, or propose an older-engine fallback.
- K:16 and K:18-23 already cover absent adapter fields, absent shell discrimination, the expected lack of a qualifying harness, the alert ordering risk, and the remaining symbolic-link race. Standing-rule deferral is an authorized outcome, not an incomplete feature claim.
- K:17 already records the holder replacement race during automatic crash recovery. The fixed carry-on text and gone-post notice do not eliminate it, and the plan does not claim otherwise.
- Advice about worker behavior remains advice. It is not silently promoted into an enforcement rule. Accepted same-user state-folder access is also not refiled.
- An after-commit permission answer can fail in the current engine; packages/engine/src/routing/permissions.ts:49-56 logs that failure. This existing engine issue is not recast as a new roles defect. The test above verifies the new path uses the existing contract.
- Current official documentation supports the limited clock and cache statements used by this review. The [Effect Vitest documentation](https://github.com/Effect-TS/effect/blob/main/packages/vitest/README.md), checked 2026-11-03, documents test services and TestClock. It does not establish that the future composed service will use that clock on every path. The [Claude prompt-caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), checked 2026-11-03, supports renewal on a cache read and separate cache lifetimes. It does not establish which usage fields an adapter exposes. Those remain post-build evidence requirements.
- No full test suite was run for this plan review, and no future roles test is claimed to pass. Direct imports for the small wait probe were unavailable because the isolated checkout lacked usable dependency resolution. I instead evaluated the existing predicate in memory with supplied state; that proves only the cancellation decision described in R4-L2. A mistaken source-path lookup was corrected to packages/contracts/src/stateMachine.ts before the lifecycle claim was made.
- Node.js 26 was selected. The repository remained clean at the recorded commit. No repository, issue list, feature list, session report or journal was written. No scratch directory was created.
