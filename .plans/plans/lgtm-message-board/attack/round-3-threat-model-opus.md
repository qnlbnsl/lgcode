revise
Grade: 7  B/M/m: 0/2/4  Flags: none

# Threat-model review of the message board plan, round 3

Lens: security threat model. The plan under review is version 3
(`lgtm-message-board/plan.md`), with `decisions.md`, `contract.md`
version 4 and `scouting.md`. Code claims are checked at commit `8ff4c9b`
in the read-only worktree and cited `file:line`, with paths relative to
the repository root. "The client API contract" means
`inputs/client-api-contract.md`. "Design" means
`docs/specs/2026-11-01-engine-design.md`. "Row N" is a row in the board's
`decisions.md`, which sits at line N + 10 of that file.

Team rule 8 says security does not block in this run, and that fixes for
security findings are deferred to `docs/issues.md` and the manager's
attack list. The labels and scores below are still the consequences as
this lens sees them. Two of the findings are unresolved access
boundaries, and the lens rules make those pre-build decisions, not
post-build checks. Whether they wait under rule 8 is for the lead to
decide.

## Summary

Version 3 answers round 2 well. The bounded owner snapshot, the ceiling
taken from `AgentStarted`, the anchor for owner-opened group channels,
the encoded-size wake cap, the fixed-field `board.status` reply, the
id-only header and the receipt inventory each hold. I checked each one
against the code, and the table below says which hold.

Two new problems are major, and neither is a blocker:

1. The send-time reach check, which answers round 2's R2-TM-1 through
   lead ruling L19, cannot be built as written. The client API contract
   gives the check only the caller, the target and the views snapshot. It
   never says which delivery is being sent, so the board cannot judge the
   posts that this one wake carries (T3-1).
2. "The channel's current manager" is a member of every group channel,
   but the plan never fixes who that is. The contract moves manager
   rights only on a stop or a crash. The engine rights helper that the
   plan builds on moves them on a pause or an interruption too. So an
   ordinary usage pause changes a group channel's members, which lead
   ruling L18 forbids. When the paused agent comes back, the agent that
   held the rights leaves the channel, and its open questions there are
   closed for good (T3-2).

Four minor points follow. A completion always passes the send-time check,
even when it carries reply text from a channel its author has left
(T3-3). No test refuses an anchor that an agent names (T3-4). The bounded
snapshot cannot feed one clause of `holdsUnsettled` (T3-5). The literal
wording of that clause lets any channel member hold another agent
unsettled for as long as the question stays open (T3-6).

## Round 2 answers, checked

| Round 2 finding | Answer in version 3 | Holds? |
|---|---|---|
| Opus S1 and Sol R2-TM-2: the snapshot carries every post's text | Row 71, `contract.md:342-351`, criterion 5.9, post-build check 13 | Holds. A residual about the condition inputs is T3-5. |
| Opus S2: the ceiling rule names no field | Row 73, `contract.md:48-50`, criterion 2.9 | Holds. The ceiling is `AgentStarted.permission` (`packages/contracts/src/events.ts:99`). `ModeChanged` overwrites only the view's current level (`packages/engine/src/views/apply.ts:190-191`). The exemption for a descendant is sound: `start` caps a child's level at its parent's current level (`packages/engine/src/commands/start.ts:19`), and the current level never passes the parent's ceiling, because a mode above the ceiling becomes `ModeRefused` (`packages/engine/src/commands/CommandHandler.ts:153-157`). |
| Opus S3: an owner-opened group channel admits any carrier | Row 66, `contract.md:70-73`, criterion 2.6 | Holds for the owner's door. The same hole stays open through the agent's door, untested: T3-4. |
| Opus S4: membership follows the chain of holders | Row 65 under L18 and L21, `contract.md:74-83` | Holds for carriers, which are now judged by `parent` links. Fails for the "current manager" term: T3-2. |
| Opus m1 and Sol R2-TM-3: the wake cap is measured before JSON encoding | Row 72, criterion 3.8, post-build check 9 | Holds. JSON means JavaScript Object Notation. |
| Opus m2: `board.status` may show post text | Row 74 (1), `contract.md:383`, criterion 5.6 | Holds. |
| Opus m3: the header holds an agent-chosen channel name | Row 74 (2) and (3), `contract.md:257-263` | Holds. The slug pattern matches `packages/contracts/src/ids.ts:24`. |
| Opus m4: the ceiling claim is too wide | Row 73, `contract.md:146-150` | Holds. |
| Opus m5 and Sol R2-TM-4: receipts are missing from the inventory | Row 75, `contract.md:357-363`, criterion 5.11 | Holds. Receipts are redacted with nested strings (`packages/engine/src/log/EventLog.ts:212`, `220-226`). |
| Sol R2-TM-1: a queued wake can be sent after reach is lost | Row 67 under L19 and L22, client API contract item 15 (lines 648-664), criterion 4.9 | Fails as specified. The re-check exists, but it has no delivery to judge (T3-1), and completions skip it (T3-3). |

Round 2's proposed post-build check TM2-6, that a withdrawn wake's text
never reaches its target through a thread read, was not carried into
version 3. It is proposed again below as TM3-3. Without it, nothing tests
whether the text that the send-time check withholds still reaches the
agent another way.

## Findings

### T3-1. The send-time reach check is never told which delivery it is judging, so it cannot judge each carried post

- **Severity:** MAJOR. **Category:** Security (isolation between
  agents); Design (the shared contract). **Responsibility:** 1,
  isolation; 3, access.
- **Scenario:** Worker W is busy, and W's never-sent board wake W1
  carries two posts from group channel C. The lead removes C's label from
  W with `group`. W's turn ends before the reactor's batch runs. The
  dispatcher re-runs the board's reach check in the send transaction, as
  L19 requires. The engine passes the check the target W and the views
  snapshot, but not W1's id or source. The board's view may hold more
  than one board wake for W, since a requeued wake can sit beside a
  never-sent one (`contract.md:268-274`). So the board cannot tell which
  wake's posts to judge.

  A builder must then choose. It can judge "may any board wake reach W",
  which passes because W is still in other channels, and W receives C's
  text after losing access to it. That is R2-TM-1 again. Or it can fail
  the check whenever any board wake for W carries a failing post. The
  engine also runs the check when a piece queues a delivery (L22). So a
  new post to W would then be refused because of an old wake, which
  breaks the rule that "an old carried post never causes a new command to
  be refused" (`contract.md:140`).
- **Evidence:** The check's inputs are "the caller, when there is one,
  the target and the views snapshot of the same transaction" (client API
  contract lines 655-657, also lines 233-235). The board's check "judges
  each post a wake carries on its own" (`contract.md:120-122`; row 67
  (2); criterion 2.11). It needs the wake's carried posts, which only
  `board.WakeBuilt` records, keyed by wake id (plan lines 379-380). The
  dispatcher can only withdraw a failing delivery (client API contract
  lines 660-663). Criterion 4.9 assumes a per-wake judgement. At queue
  time there is a second gap. The snapshot "of the same transaction" may
  not yet hold the batch's own `board.WakeBuilt`, so the engine's
  queue-time call cannot see the new wake's posts either. Post-build
  check 5 raises this "projected with the same batch" question only for
  wait checks.
- **Suggested fix:** Decide this before the build, through the lead,
  because it changes seam item 15's signature. Recommended: the check also
  receives the delivery's piece source `{ namespace, id }` and its
  delivery id. At queue time it reads the board's view as projected with
  the command's own batch. The board then looks up the wake through
  `board.WakeBuilt` and judges exactly its carried posts. Add a case to
  criterion 4.9: W has a requeued wake that passes and a never-sent wake
  that fails, and only the failing wake is withdrawn.

### T3-2. "The current manager" is undefined, and the engine's rights rule moves it on a pause, so a usage pause changes a group channel's members

- **Severity:** MAJOR. **Category:** Security (access); Security
  (integrity: dispositions and closes are permanent). **Responsibility:**
  3, access; 4, integrity.
- **Scenario A, a pause:** Lead L opens group channel C for its workers.
  L carries no label, and this is allowed, because "the current manager is
  always a member" (`contract.md:78-79`). L's account runs out of usage,
  and L is paused. The plan computes manager rights "through the seam's
  rights helper, which wraps `holderAbove`" (plan line 408). In the
  engine, a parent's rights pass up "while the parent is crashed, stopped,
  paused or interrupted" (design lines 509-511). The rights helper does
  the same: `mayActForHolder` hands an unavailable holder's rights to
  `holderAbove` (`packages/engine/src/routing/holders.ts:28-33`).

  So while L is paused, L's parent O is the current manager, and is
  therefore a member, and L is not. When L resumes, O stops being the
  manager and leaves C. Under the outcome table, an author who leaves the
  channel has its open posts closed `withdrawn`, and an addressee who
  leaves is resolved `removed`. Both results are permanent: "A
  disposition is set once" (`contract.md:187`). So O's questions in C, and
  any question in C that waits on O, are destroyed by an ordinary pause.
  The reactor's triggers do not include a pause or a resume (plan lines
  534-544; `contract.md:142-144`). So the reactor would not even run, and
  the view and the queued wakes go stale. The engine's dispatcher check
  would then judge reach on a membership that nothing has reconciled.
- **Scenario B, a crash and a resume:** L crashes, and its rights pass to
  O, which becomes a member (L21). L is then resumed. Nothing says
  whether L takes the rights back. If the manager is a stored value, L
  stays out of its own channel, because it carries no label. It loses
  `board.read` there, and the reactor treats that as leaving, which
  withdraws L's open posts. If the manager is recomputed, O leaves
  instead, with the losses of scenario A.
- **Evidence:** The contract says rights pass "when a manager stops or
  crashes" (`contract.md:64-66`; criterion 2.5). It also says "a pause,
  crash or resume of the manager changes no one's membership"
  (`contract.md:82-83`), but L21 makes a crash add the inheriting manager.
  Criterion 2.6 asserts that membership is "unchanged when the manager
  pauses, crashes and is resumed", which L21's own crash case
  contradicts. L18 (rulings) says "a pause or account change never
  changes" membership. The view lists `manager` as a channel field (plan
  line 371), but nothing says whether it is stored or derived.
- **Suggested fix:** Decide this before the build. Recommended: the view
  stores the manager. It changes only when the current manager's
  `AgentStopped` or `AgentCrashed` is folded, and it moves to the nearest
  ancestor by `parent` links that is not stopped or crashed, with
  availability playing no part. Say whether a resumed opener takes the
  rights back. If it does, say that the inheritor stays a member, so that
  a resume removes no one. Do not use the engine's `mayActForHolder`
  for manager rights. Fix `contract.md:82-83` and criterion 2.6 to match
  L21. Add test cases for a paused opener, a paused inheritor, and a
  crashed-then-resumed opener with no label.

### T3-3. A completion always passes the send-time check, so it can carry reply text from a channel its author has left

- **Severity:** MINOR. **Category:** Security (isolation between
  agents). **Responsibility:** 1, isolation.
- **Scenario:** Worker A asked a question in group channel C. The
  question closes while A is busy, and A's queued wake carries the
  completion with the replies' text. The lead removes C's label from A.
  A's turn ends before the reactor rebuilds the wake. At send time, the
  completion "always passes rules 1 to 4" (`contract.md:131-132`), so A
  receives replies that were posted in C after A lost access to it. The
  text condition, "only if the author is still a member", is judged when
  the wake is built, not when it is sent.
- **Evidence:** `contract.md:131-132`; row 69 (7); criterion 2.11 ("a
  completion to its author always passes but carries reply text only
  while the author is a member"). The reactor's rebuild for a group label
  change runs later, "in the reactor's batch" (`contract.md:289-293`).
- **Suggested fix:** At send time, judge a completion's reply text under
  rule 1, as if it were a post in its channel. If the author is no longer
  a member, fail the wake, so the reactor rebuilds it with the completion
  but without the reply text. Add this case to criterion 4.9.

### T3-4. No test refuses an anchor that an agent names, which would reopen round 2's S3 through the agent's door

- **Severity:** MINOR. **Category:** Security (isolation between
  agents; access). **Responsibility:** 1, isolation; 3, access.
- **Scenario:** `board.open` must take an anchor field for the owner.
  An agent calls `board.open` with a label and names the root agent as
  the anchor. If the handler honours the field, the channel takes in
  every carrier in the tree, which is round 2's S3 opened by an agent
  instead of the owner. The rule that a label must be carried in the
  agent's own subtree does not stop this. That rule checks the opener's
  subtree, not the anchor's.
- **Evidence:** "In a channel an agent opened, the anchor is the opener"
  (`contract.md:70-71`). A group channel carries an anchor id (criterion
  1.1). The command table gives `board.open` to "the owner, or any agent"
  (`contract.md:377`). Criterion 2.6 tests no agent-named anchor. WS-2
  promises that "each rule has a test that tries the forbidden case"
  (plan lines 176-177).
- **Suggested fix:** Refuse `board.open` from an agent caller when it
  carries an anchor other than the caller itself. Add the case to
  criterion 2.6.

### T3-5. The bounded snapshot cannot feed the third clause of `holdsUnsettled`

- **Severity:** MINOR. **Category:** Bug (timing); Design.
  **Responsibility:** 3, access (the owner's client surface).
- **Scenario:** The owner runs `lgtm client wait` on worker W. The
  helper evaluates `holdsUnsettled` over the board's snapshot section.
  The third clause asks whether a queued or sent board wake carries a
  given post to W. The section holds only "the queued board wakes' ids"
  (`contract.md:349`). It holds no carried posts and no sent wakes. So the
  helper cannot decide the clause. It either reports W settled during the
  gap between a return and the re-queue, which is the case row 69 (8)
  exists to cover, or it holds W unsettled until the next event.
- **Evidence:** The clause is at `contract.md:309-312` and plan lines
  546-550. Criteria 1.7 and 5.9 demand "the same answers as the full
  view" over the bounded section. The section's fields are at
  `contract.md:344-349`. The client API contract (lines 305-307) still
  says the board's section is "its whole view". L21 says no client API
  change is needed, so that line is stale.
- **Suggested fix:** Add the condition inputs to the section: for each
  queued or sent board wake, its target and its must-reply post ids. Or
  state that the helper reads `board.status` for this clause. Ask the
  lead to correct the stale sentence in the client API contract.

### T3-6. The literal third clause of `holdsUnsettled` lets any channel member keep another agent unsettled until it answers

- **Severity:** MINOR. **Category:** Security (access: a sibling outside
  the tree controls a parent's wait); Bug (timing). **Responsibility:**
  3, access.
- **Scenario:** Sibling X asks worker W a question in a shared channel,
  and rule 4 allows it. W's wake is accepted. W ends its turn without
  answering. No queued or sent wake now carries the post, so the clause
  "an addressee with no disposition of an open must-reply post that no
  queued or sent board wake carries to it" holds from then on. W's parent
  L waits on W, and that wait does not end until W answers or X withdraws
  the question. L cannot withdraw it with `board.close` unless L is the
  channel's manager (`contract.md:380`). The contract gives "the moment
  between a return and the reactor's re-queue" as the purpose of the
  clause (`contract.md:311-312`), but the wording covers every moment
  after acceptance too.
- **Evidence:** Plan lines 546-550; `contract.md:305-312`; row 69 (8).
  The engine's own settled test ends a wait once the target is idle with
  no queued or sent delivery (`packages/engine/src/routing/waits.ts:40-45`).
- **Suggested fix:** Narrow the clause to an addressee whose last board
  wake carrying the post was returned and not yet re-queued, for example
  "no board wake carrying it has been accepted since it was written". Or,
  if the wider meaning is intended, say so, and give the waiting parent a
  repair path, for example by letting `board.close` be called by any
  holder of an addressee.

## Risk register

Scores follow `risk-score.md`: severity × fallout × probability. No
finding has severity 9 or 10, so no severity floor applies. An
unresolved finding is scored at its worst plausible probability.
Decision, deadline, acceptance and closing evidence are for the owner and
the lead. Team rule 8 defers security fixes in this run.

| Id | Description | Severity | Fallout | Probability | Score, band | Evidence status | Owner |
|---|---|---|---|---|---|---|---|
| T3-1 | The send-time reach check has no delivery to judge, so a wake carrying a lost channel's posts can be sent | 6: private channel text shown to another agent | 7: delivered text cannot be recalled | 6: removing a busy member is ordinary use; scored at the worst plausible builder choice | 252, fix before release | Unresolved; confirmed in contract text | Client API seam (item 15) and board unit 2b |
| T3-2 | The current manager moves on a pause, so membership changes and open questions are closed for good | 6: a core flow is wrong until it is repaired by hand | 5: lost questions must be noticed and asked again | 4: needs a usage pause plus questions involving the inheritor, or a crash | 120, schedule (an access boundary: decide before the build) | Unresolved; confirmed in contract text, design and code | Board units 2b and 3c |
| T3-3 | A completion carries reply text past a label removal at send time | 6: private text shown to another agent | 7: cannot be recalled | 2: needs a queued completion, a label removal and a send before the reactor | 84, schedule | Confirmed in contract text | Board unit 2b, with the seam |
| T3-4 | An agent-named anchor could widen a group channel to the whole tree | 6 | 7 | 2: needs the handler to honour the field | 84, schedule | Unresolved; no test covers it | Board unit 2b |
| T3-6 | A sibling's unanswered question holds the addressee's parent's wait open | 4: wrong until answered or withdrawn | 3: repaired by the agents | 6: an ignored question is ordinary | 72, schedule | Confirmed in plan text | Board unit 3b |
| T3-5 | The bounded snapshot lacks inputs for one clause of `holdsUnsettled` | 4: the owner's wait is wrong for a while | 3 | 4: needs a returned wake | 48, record | Confirmed in contract text | Board unit 4 |

## The six responsibilities, traced

- **Isolation.** Board events have no top-level `agentId`, so the agent
  stream hides them: the log's agent column comes only from that field
  (`packages/engine/src/log/EventLog.ts:174-177`), and `subscribe` drops
  an envelope without one (`packages/engine/src/api/server.ts:155-158`).
  An agent's snapshot has no board section (criterion 5.9). Queued wake
  text in `DeliveryQueued` is hidden from the agent stream. The engine's
  own views do file it under the target's thread
  (`packages/engine/src/views/apply.ts:119-123`, `341-346`), so TM3-3 is
  needed. Sent text in `PromptSent` reaches the target and its parent, as
  row 55 states. Open: T3-1, T3-3, T3-4.
- **Identity across sessions.** LGTM Studio has one owner. Devices act as the
  owner (`CommandHandler.ts:203-207`), and revoking a device is piece 2's
  job. A stopped or crashed agent's token is refused
  (`CommandHandler.ts:209-212`; criterion 5.2). The board adds no sign-in
  path.
- **Access.** Every board command runs through the engine's command
  handler, with identity, receipts and one transaction (criteria 5.1,
  5.2). Service authors are in-process only (criterion 5.5; client API
  contract lines 266-270). The ceiling rule now compares start ceilings.
  Open: T3-1, T3-2, T3-4, T3-6.
- **Integrity.** One transaction holds a post and its wakes. The reactor
  re-reads status before it writes (row 62). Completions are durable
  (row 69). Open: T3-2, where a pause can close questions for good.
- **Confidentiality.** The local socket carries no network traffic.
  Encryption on the network listener is piece 2's job, under SECURITY.md
  rule 5. The state folder is unencrypted, which the owner accepted on
  2026-11-01 (design lines 605-612). The owner's alert carries no post
  text (client API contract lines 517-520; post-build check 10). The store
  inventory is complete, receipts included (`contract.md:357-363`).
  Services see every board event through `subscribe` (client API contract
  line 279), and `contract.md:340-341` states this. Open: none new.
- **Secrets and dependencies.** Every event, and every receipt with its
  nested strings, passes the engine's redactor before it is written
  (`EventLog.ts:212`, `220-226`, `250`). Agent and device credential
  prefixes are probed (`packages/engine/src/identity/redactor.ts:76`).
  Control characters are removed before redaction, so a secret split by
  escape codes is joined again before the redactor sees it (plan lines
  428-430). Post-build checks 3 and 6 cover combined text and harness
  login tokens. The plan adds no third-party dependency. The two new
  workspace packages are known gap 5.

## Judgement on the known gaps

- **Gap 8 is stale.** Its part (a) is closed by L22. The supplied client
  API contract's item 15 now consults the check "for a target inside the
  calling agent's tree as well as outside it, and for a delivery the
  piece builds with no caller" (lines 649-655). Its part (b) is closed
  too: item 16 reads "has no disposition for it" (line 669). T3-1 is a
  separate gap in the same item.
- **Gaps 1, 5, 6, 7 and 9** have no security consequence that I can see.
  Gap 5 adds no third-party dependency.
- **Row 9 (the owner's answer on the seam) stays open.** Every finding
  above assumes the seam exists.

## Proposed post-build checks

These need code to answer. They do not replace the decisions above.

- **TM3-1.** The dispatcher's send-time check judges the delivery being
  sent: with a passing requeued wake and a failing never-sent wake queued
  for one target, only the failing wake is withdrawn, and the reactor's
  rebuild keeps every passing post. Evidence: a reactor test. Area: the
  seam (item 15) and board unit 3c.
- **TM3-2.** A board wake sent again by `resume --fresh` or by restart
  recovery passes the send-time reach check first. `resume --fresh`
  requeues accepted deliveries (`packages/engine/src/commands/resume.ts:27-36`),
  so a member removed since then must not be sent the channel's text
  again. Evidence: an acceptance test. Area: the seam and board unit 5.
- **TM3-3.** Carried from round 2's TM2-6. The text of a queued or
  withdrawn board wake never reaches its target, or the target's parent,
  through `subscribe`, `client.subscribe`, `client.thread` or
  `client.snapshot`. The engine's views file `DeliveryQueued` under the
  target's thread (`apply.ts:119-123`), so a thread read built on the views
  instead of the log's agent column would leak it. Evidence: an
  acceptance test with a real agent token, after a label removal that the
  dispatcher catches. Area: the seam (item 9) and board unit 5.
- **TM3-4.** A paused opener, a paused inheriting manager, and a crashed
  then resumed opener each leave group-channel membership and
  plain-channel manager rights exactly as T3-2's decision says. Evidence:
  access tests and reactor tests. Area: board units 2b and 3c.
- **TM3-5.** An agent's `board.open` that names an anchor other than
  itself is refused. Evidence: a handler test. Area: board unit 2b.
- **TM3-6.** After its author's label is removed, a completion is sent
  without the replies' text. Evidence: a reactor test. Area: board unit
  2b.

## Refused

None. No check was stopped by a model policy.

## Noted, not filed

- **The ceiling exemption reaches every ancestor.** A narrower agent may
  oblige any ancestor that shares a channel with it, not only its holder.
  The engine's `ask` reaches only the holder. An ancestor already has
  authority over the asker, so this widens cost, not access.
- **Turn-cost amplification.** Within rule 4, a confused agent can keep
  posting must-reply questions to a sibling and withdrawing them, which
  costs the sibling a turn each time. The open-post cap limits the posts
  that are open at once, not the rate. This is a cost and availability
  concern, outside the six responsibilities.
- **Format characters.** Control characters are removed, but Unicode
  format characters such as bidirectional overrides are not. Headers are
  built from fixed words and ids, and the command-line tool sanitizes its
  output. Rendering in the web page and the pane viewer is piece 2's job.
- **The total snapshot size is a sum.** The board's 256 KiB cap bounds
  only its own section. The whole `client.snapshot` reply must fit within
  1 MiB together with the engine's part and every other piece's part,
  which the client API's size test must sum.
- **The reactor's caller is still unstated.** If the reactor writes as
  `owner`, as the engine's own followers do
  (`packages/engine/src/commands/CommandHandler.ts:148`), the log names
  the owner as the cause of reactor withdrawals. A service caller under
  seam item 10 would keep the audit trail true. This was noted in round
  2 too.
- **Rebuilt wakes copy text again.** Each merge or rebuild writes a new
  `DeliveryQueued` with the full body, so the stored copies of a post's
  text grow with the number of merges. The inventory already covers
  them.
- **Self-imposed limits.** The board has none, so that exemption does
  not apply.
