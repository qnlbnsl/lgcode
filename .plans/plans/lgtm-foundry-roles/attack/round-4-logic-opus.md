revise
Grade: 6  B/M/m: 0/3/6  Flags: none

# Plan review, round 4: lgtm-foundry-roles, lens: logic and failure policy

Reviewer: logic and failure policy (Opus). Plan v5 (`plan.md`, byte-identical
to `attack/plan-v5.md`). Code claims are checked at commit `8ff4c9b` in the
read-only worktree; paths without a prefix are relative to it. `PLAN` is
`plan.md`, `DEC` is `decisions.md`, `CAPI` is `inputs/client-api-contract.md`
(v3), `BOARD` is `inputs/board-contract.md`, and `FOUNDRY` is
`~/.claude/plugins/marketplaces/founder-os/plugins/harness-sessions/skills/software-foundry`.
Each risk score is severity × fallout × probability, from `risk-score.md`.

The round 3 answers hold, and the L26 rework moved code without dropping an
earlier rule (see "Earlier answers" below). The three majors are new. Two of
them come from reading the plan's rules against the Foundry's real shape.
First, the cache rule skips every agent that is "waiting on others", and
since round 3 that means every lead with a working worker and the
orchestrator while any worker works. Those are exactly the agents that
`context-keeper.sh` compacted, so the replacement drops the script's main
job. Second, the engine treats any path with a `.claude` segment as a
protected settings path, and the Foundry puts its worktrees under
`<repo>/.claude/worktrees/`. So every edit request from such a worker
already goes to the owner's phone today, and WS-7a's resolved-path check
would refuse every standing-rule match there. Third, WS-7a's "second write"
lets the first write's wait checks cancel the lead's blocking wait with
"request held", for a request that a rule then answers. The six minors are
failure policies and edge rules.

## Findings

### R4-L1. The cache rule skips every lead with a working worker, which is the case `context-keeper.sh` exists for (MAJOR)

- **Category:** Bug (timing), and Design (the replacement drops the
  replaced script's main behaviour). Interacting rules: transitive waiting
  × cache timing.
- **Rule as written:** "Two minutes before the expiry, for an idle agent
  that is not waiting on others and has nothing queued", flush or compact
  (PLAN:820-825). Since row 74, "waiting on others" means that some party
  reachable through "waits on" links is busy, and a child is such a link
  (PLAN:721-730). Criterion 5.3 also refuses any agent with an open wait
  (PLAN:833).
- **Scenario:** A lead starts two workers and collects them either way the
  recipe offers: an `all`-mode hand-off post, or an engine `wait`
  (PLAN:1085). The lead goes idle at 250,000 tokens. Its workers work for
  an hour. The lead reaches a working worker through its child link and
  through its own open post, so it is "waiting on others" for the whole
  hour, and with an engine `wait` it also fails 5.3. Its cache expires
  unflushed and uncompacted. When the workers finish, the completion wakes
  the lead at the full uncached price of 250,000 tokens. The orchestrator is
  in the same position whenever any worker anywhere is working.
- **What the plan replaces:** `context-keeper.sh` "Compacts every idle
  Claude lead, relayer and manager whose context is at least CTX_TOKENS"
  (`FOUNDRY/scripts/context-keeper.sh:3`), whatever its workers are doing.
  The script's own history says why: an earlier copy failed silently, and
  "leads sat at 300k-390k tokens for hours" (`context-keeper.sh:23`). The
  traceability table maps the script to WS-5 (PLAN:1092), and WS-8 retires
  it. In the Foundry's shape the plan's rule compacts almost nobody: workers
  are stopped when done, and leads and the orchestrator always have a busy
  descendant while a run is live.
- **Why earlier rounds missed it:** the guard has read "not waiting on
  others" since v2 (`attack/plan-v2.md:652`), when the test already counted
  a busy child (`plan-v2.md:572-575`). Row 74 made it transitive, which
  extends the gap from leads to the orchestrator.
- **Suggested fix:** Drop "not waiting on others" from the cache guard.
  Keep the direct guards that mean "work is arriving now": a delivery
  queued or sent to the agent, an open request or question the agent itself
  asked, an open blocking `wait` (which keeps the agent's turn open), a
  compaction under way, or a last turn that was a compaction. Allow an open
  non-blocking wait and an open post of the agent's own: the completion
  arrives later as a queued wake, and the moment-of-sending re-check in 5.3
  already stops a compaction that would collide with it. Add CM tests: an
  idle lead with a working worker and 200,000 tokens is compacted at
  T + 58 minutes; an idle orchestrator over working teams likewise.
- **Risk:** severity 4 (every lead wake re-reads a large uncached context;
  context grows toward the model's limit), fallout 3 (one run; the owner can
  compact by hand), probability 8 (every lead in every run) = **96,
  schedule.**

### R4-L2. A Foundry worktree under `.claude/worktrees/` is a protected settings location to the engine, so routine requests go to the owner and no standing rule can match (MAJOR)

- **Category:** Bug (write ownership: who answers a request), and Design
  (a fail-closed check that disables the feature in the owner's real
  layout). This is also a problem for `docs/issues.md` under AGENTS.md
  rule 3.
- **Code at `8ff4c9b`:** `isHarnessSettings` marks a path as harness
  settings when any segment, compared without case, is `.claude`, `.codex`,
  `.gemini` or `.cursor` (`packages/engine/src/identity/ceiling.ts:317-322`).
  `canAnswerOption` applies it to the whole resolved path
  (`ceiling.ts:396-400`). The runner's `settingsWrite` runs that test on
  every location of a permission request, resolved against the agent's
  folder (`packages/engine/src/runner/permissions.ts:25-31`,
  `packages/engine/src/runner/AcpRunner.ts:416`). A request with
  `settingsWrite` true is routed to the owner, not the lead
  (`packages/engine/src/routing/permissions.ts:21`), and no agent may answer
  it (`permissions.ts:40`).
- **The Foundry's layout:** the skill tells the manager to "Find the repo's
  gitignored worktree root ... (for Enkra: `.claude/worktrees/`)"
  (`FOUNDRY/SKILL.md:66`), and every lead and worker runs in a worktree
  below it (`SKILL.md:105`, `:199`). This review's own checkout is
  `.claude/worktrees/review-8ff4c9b`.
- **Probe:** a verbatim copy of `isHarnessSettings` gives `true` for
  `/home/u/repo/.claude/worktrees/foundry-a-w/src/x.ts`, for `.../test` and
  for `.../package.json`, and `false` for the same file under
  `/home/u/repo-wt/foundry-a-w/` (scratch probe, run with Node 26, deleted).
- **Consequence one, today's engine:** a worker in `ask` mode inside such a
  worktree has every file-edit request routed to the owner as an `approval`
  alert, pushed to the phone by default (CAPI §4), and its lead cannot
  answer it. The recipe says "other requests reach the holder through the
  engine" (PLAN:1087), and the live check 8.4 runs on real worktrees.
- **Consequence two, WS-7a:** the resolved-path check refuses a match when
  a word "resolves into a protected settings location" (PLAN:571-578,
  :966). Each word is resolved against the working folder, so in such a
  worktree every word, including a missing one such as `pnpm`, resolves to
  a path with a `.claude` segment. If a harness qualifies, no standing rule
  ever matches in the Foundry's worktrees. This fails closed, so it is not
  a security hole, but the acceptance test (8.2), run in a temporary
  folder, would not see it.
- **Suggested fix:** Decide where the protected test applies. The cheap
  fix: `docs/foundry.md` (criterion 8.1) requires a worktree root with no
  harness-settings segment in its path, such as `<repo>-worktrees/`, and the
  live check 8.4 runs there; the lead files the engine behaviour in
  `docs/issues.md`. The engine fix, which needs the attack pass of unit
  11a: judge the segments of the resolved path below the agent's own
  folder, and judge a path outside the folder by its full path, so
  `<folder>/.claude/settings.json` and `<folder>/../../settings.json` stay
  protected. Either way, add an M test and a 7.2 test run in a folder under
  a `.claude/worktrees/` path.
- **Risk:** severity 4 (the owner answers every routine edit by phone and
  the lead is bypassed; standing rules answer nothing), fallout 3 (moving
  the worktrees undoes it), probability 8 (the skill's own example layout,
  every request with a location) = **96, schedule.**

### R4-L3. WS-7a's "second write" lets the first write cancel the lead's blocking wait with "request held", for a request a rule then answers (MAJOR, if standing rules are built)

- **Category:** Bug (ordering). Interacting rules: standing-rule answer ×
  blocking wait.
- **Rule as written:** 7.2: when the rule's answer passes the engine's
  checks, "`PermissionAnswered` is appended in the same transaction as
  `PermissionRequested`, as a second write whose envelope caller is the
  service" (PLAN:966). Today the runner-event transaction's `write` helper
  adds the wait checks to each append, computed on that append's own
  projection (`packages/engine/src/commands/CommandHandler.ts:147-149`;
  `packages/engine/src/routing/waits.ts:110-119`). CAPI E20 keeps that
  check "after every batch".
- **Scenario:** Lead L starts worker W and calls `wait --block` on it, the
  recipe's engine-wait option (PLAN:1085; 4.4 tests "a lead in a blocking
  `wait` on working workers", PLAN:771). W asks to run `pnpm test`, and a
  rule matches. The first write appends `PermissionRequested` with holder L
  (`holderAbove`). Its wait checks project that event, so L now "holds" an
  open request, and the blocking-wait rule writes
  `WaitCancelled { reason: "request held" }` for L's wait
  (`waits.ts:33-35`, `:83`). The second write then answers the request.
  L's `wait` returns `request-held` (`waits.ts:133-136`), L's model takes a
  step, finds no request to answer, and must wait again.
- **Consequence:** every rule-answered request costs the lead a model step
  over its whole context, which is the cost standing rules exist to remove
  ("so the lead is not woken at all", PLAN:93-95). Criterion 8.3 counts
  only deliveries (FR13, PLAN:1003), so it passes while this happens.
- **Related:** for an asker whose holder is the owner, today's routing
  writes `OwnerNeeded` (`packages/engine/src/routing/holders.ts:48-50`),
  which raises an `approval` alert that the second write then clears. 7.2
  says only that "no delivery to the holder is queued".
- **Suggested fix:** State in 7.2 that the rule-answered path writes no
  routed delivery and no `OwnerNeeded`, and that the wait checks run once,
  on the projection of both writes, so a request answered in its own
  transaction never counts as held. Add PC tests: a holder in a blocking
  wait on the asker stays waiting; an owner-held asker raises no alert.
  Let FR13 count blocking-wait returns as well as wakes.
- **Risk:** severity 4 (a wasted lead step per matched request), fallout 3,
  probability 6 (every matched request while its lead waits blocking) =
  **72, schedule.** Conditional on a harness qualifying (lead ruling L27).

### R4-L4. The capacity-hold condition has no failure policy, and a throw drops the reply and leaves a delivery "sent" for ever (MINOR)

- **Category:** Bug (failures). Whether failure permits or denies.
- **Rule as written:** 7.2 makes the standing-rule matcher a total function
  whose error means "no match" (PLAN:966). 7.3 calls the roles'
  capacity-hold condition inside the reply's transaction (PLAN:967) and
  says nothing about an error.
- **Scenario:** the condition throws, for example on an agent missing from
  the roles view. The transaction fails, and the runner-event handler drops
  the whole event with "runner event dropped: processing failed"
  (`CommandHandler.ts:174-177`). The runner's next event for the same turn,
  `turnEnded` (`AcpRunner.ts:178`), still matches the current turn, so the
  engine writes `TurnEnded` and the agent goes idle
  (`packages/engine/src/routing/deliveries.ts:92-97`). The delivery is never
  returned or held, and stays `sent`. A `sent` row keeps the agent
  unsettled for ever (`waits.ts:39-41`), so any wait on it never ends, the
  roles count it busy, its ancestors are always "waiting on others", and
  its sender is never told.
- **Suggested fix:** Call the condition as a total function, as 7.2 does
  for the matcher: an error or a malformed result is logged without content
  and read as "no", so the delivery returns as today. Add a K test with a
  throwing condition.
- **Risk:** severity 6 (an agent and its waiters stuck until stopped by
  hand), fallout 3, probability 2 (a defect plus a capacity error) = **36,
  record.**

### R4-L5. The waiting test counts the sheepdog's own nudges as "busy", so in the plan's deadlock the worker is advised replaced before the lead that owes the answer is nudged once (MINOR)

- **Category:** Bug (timing). Interacting rules: stall clock × waiting
  test × nudge.
- **Rules as written:** an agent is busy when it is working or has a
  delivery queued or sent (PLAN:717-718), which includes a nudge's wake
  and turn. A clock "restarts from zero the next time it runs" after any
  stop, and after a turn ends (PLAN:738-740). Limits are 10 minutes for a
  worker and 20 for a lead (PLAN:741-742). Team idleness already ignores
  sheepdog turns (PLAN:768); the waiting test does not.
- **Timeline (4.3's own case, PLAN:770):** lead L posts hand-off H to
  worker W; W posts question Q back; both are idle.
  - t=0: neither reaches a busy agent, so both clocks run.
  - t=10: W's episode 1 nudges W. W is busy, so L reaches a busy agent and
    L's clock stops at 10 minutes. After W's nudge turn, both clocks
    restart from zero.
  - t≈21: W's episode 2 nudges W and tells L, flushed. L's clock, at about
    10 minutes, restarts again.
  - t≈32: W's episode 3 sends `ReplaceAdvised` to L.
  - L, who owes the answer to Q, is first nudged at about t=53, after the
    sheepdog has told it to replace a worker whose only fault was waiting
    for L.
- **Truth table** (A owes a reply to P; B is reachable from A):

  | B is | Plan v5: A's clock | Should be |
  |---|---|---|
  | in ordinary work, or has an ordinary delivery queued | stopped | stopped |
  | in a sheepdog turn, or has only a sheepdog wake queued | **stopped, and restarted from zero** | runs, as for team idleness |
  | held for capacity, or paused with a known reset | stopped | stopped |
  | idle, and reaches nothing busy | runs | runs |

- **The related policy left open in round 3:** a busy descendant also
  excuses A from a reply owed to an asker blocked only on A (worker W1 asks
  its idle lead while sibling W2 works; W1 waits up to W2's two-hour age
  limit, and team idleness cannot fire because W2 is busy). Row 74 accepts
  this; it is not re-filed, but the fix below can cover it.
- **Suggested fix:** For the waiting test, count an agent as busy only for
  work the sheepdog did not cause, as team idleness does. Optionally, let
  the clock for (P, A) also run when P's author reaches nothing busy except
  through A. Add an ST test for the timeline above: L is nudged about Q
  before W's `ReplaceAdvised`.
- **Risk:** severity 4 (a healthy worker is advised replaced; the real
  blocker is chased late), fallout 3, probability 4 (a question back to an
  idle lead, which 4.3 itself names) = **48, record.**

### R4-L6. A usage-limit pause with no known reset counts as neither busy nor the owner, so its team is reported idle every hour, which 4.7 forbids (MINOR)

- **Category:** Bug (timing). Contradicting criteria: 4.1 × 4.7.
- **Code:** a limit pause keeps `resetAt` only when the provider gave one
  (`deliveries.ts:152-155`); without it the engine writes `OwnerNeeded`
  "account is out of usage, no reset time known" (`deliveries.ts:193-196`),
  and no timer will resume the agent.
- **Rule as written:** busy includes a limit pause "with a known reset",
  and a signed-out agent "counts as the owner" (PLAN:717-721). A limit
  pause with no reset is neither. 4.1 reports a group with a live, unpaused
  member and none busy (PLAN:768). 4.7 says usage-limit pauses are "never
  counted as stalls or team idleness" (PLAN:774).
- **Scenario:** an idle lead and its worker paused for a limit with no
  reset time. The group is reported idle after 60 minutes and every hour,
  flushed to the lead and its holder, until the owner acts on the alert
  the owner already has. A lead whose only child is in that pause is also
  not "waiting on others", so its owed replies stall.
- **Suggested fix:** Count a limit pause without a reset as the owner, as
  a sign-out is, and add TI and ST tests for it.
- **Risk:** severity 4 (hourly flushed full-context wakes), fallout 3,
  probability 4 (a provider that gives no reset time) = **48, record.**

### R4-L7. A capacity outage ends only at a clean turn end, so a give-up leaves the count spent, and the give-up itself has no defined trigger (MINOR)

- **Category:** Bug (periods; failures).
- **Rules as written:** the count is the agent's `DeliveryHeld` and
  `DeliveryReleased` events since its last `TurnEnded` without a capacity
  error (PLAN:967). After the last release, the next capacity error returns
  the delivery "as today", and `GaveUp { cause: capacity }` tells the
  holder (PLAN:772). Task 4d says only "release timer and the give-up"
  (PLAN:785).
- **Scenario A, the count:** a returned turn writes no `TurnEnded`, because
  `failed` makes the agent idle before the runner's `turnEnded` arrives
  (`deliveries.ts:130-134`, `:94`). After a give-up, the agent's count stays
  at its limit until some later turn ends cleanly. If its next delivery,
  hours later, meets a new outage, it gets no retries and is returned at
  once. A non-capacity error after a release leaves the count spent in the
  same way.
- **Scenario B, the trigger:** "as today" writes `DeliveryReturned` whose
  reason is the provider's redacted error text (`deliveries.ts:171`,
  `:46`). Nothing marks it as a capacity return, so the sheepdog must guess
  from a later return of any kind, or read error text, which the plan
  otherwise keeps out of its rules.
- **Also unclear:** whether the count is the holds alone or holds plus
  releases. Counting both halves the retries.
- **Suggested fix:** When the condition says no because the count is spent,
  let the engine write the return with a fixed reason, or a capacity flag,
  and treat that return as the end of the outage, so the count resets.
  State that the count is the number of holds. Add CP tests for a give-up
  followed by a later outage, and for a non-capacity error after a release.
- **Risk:** severity 4, fallout 3, probability 4 = **48, record.**

### R4-L8. The capacity class has no named source for its phrases, and WS-7's change lists omit the runner files that carry the new fields (MINOR)

- **Category:** Design (feasibility of the named test changes); whether a
  wrong classification permits or denies.
- **The phrases:** `classifyError` matches recorded, harness-specific
  phrases (`packages/engine/src/runner/classify.ts:3-10`), and its test
  checks that every harness with a fixture has exactly the two recorded
  kinds (`packages/engine/test/runner/classify-errors.test.ts` "every
  harness with a fixture has both kinds"; fixtures in
  `packages/testing/fixtures/errors/`, four harnesses). 7b adds a third
  class and says that test "covers the third class" (PLAN:948-949), but no
  task records a capacity error for any harness. The Foundry's phrases are
  screen text from interactive panes (`FOUNDRY/scripts/capacity-retry.sh:14`,
  `:20`), not ACP error frames. A missing phrase fails safe (today's
  return); a loose one holds and retries a deterministic error for an hour.
- **The change lists:** 7b's new outcome is emitted by the runner's
  `finish`, which maps a classification to `pause` or `error`
  (`AcpRunner.ts:166-176`), through the runner event's outcome union
  (`packages/engine/src/runner/Runner.ts:89-95`); the test support's
  `fakeRunner.ts` scripts these outcomes. 7a's new fields and 7c's usage
  also pass through `Runner.ts`, and 7c's usage reaches `TurnEnded` in
  `deliveries.ts:turnEnded`. None of these files is named in WS-7's lists
  (PLAN:930-959), which the owner's rule asks for (row 80).
- **Suggested fix:** Name the source of each harness's capacity phrase
  (a recorded ACP error frame per harness, or a harness kept on today's
  return until one is recorded), and say how the "both kinds" test handles
  a harness with no capacity sample. Add the runner files to 7a, 7b and 7c.
- **Risk:** severity 2, fallout 3, probability 4 = **24, record.**

### R4-L9. The context size that decides compaction has no defined basis, and the adapter's turn usage may be a sum over the turn (MINOR)

- **Category:** Bug (numbers: the token base).
- **Rule as written:** `TurnEnded` carries usage "for the turn's last model
  request" (7.5, PLAN:969), and compaction runs when "the agent's context
  is at least its role's floor" (PLAN:823-825). The plan does not say which
  numbers make up "context".
- **Evidence:** the Claude fixture has two sources: `usage_update` with
  `used` (the context size, 43,916) and `size`
  (`packages/testing/fixtures/claude.ndjson:17`, `:19`), and `state_update`
  with a `usage` block (`claude.ndjson:20`). In this one-request turn they
  agree. Whether `state_update.usage` is the last request's or the turn's
  sum is not shown. If it is a sum, a ten-request turn over a 100,000-token
  context reports about a million, and the agent is compacted far below the
  floor.
- **Suggested fix:** Define context as the adapter's reported context size
  (`usage_update.used`) when present, otherwise the last request's input,
  cache-read and cache-write tokens, never a turn's sum. Record a
  multi-request turn in 2g's live run, or in post-build check 2, to settle
  it.
- **Risk:** severity 4 (needless compaction loses working detail), fallout
  3, probability 4 (unresolved, scored at the plausible worst) = **48,
  record.**

## Earlier answers: do they hold?

- **Round 3, all hold.** R3-L1: waiting is transitive with a visited set
  (PLAN:721-733; 4.3's three-agent cases). R3-L2: a held queue is neither
  "requeued" nor "carried", which matches `reloadedEvents`
  (`packages/engine/src/recovery/reload.ts:84-98`), and the live-process
  return path, `returnAgents`, already leaves an idle held agent idle
  (`packages/engine/src/accounts/available.ts:40-55`); start-up with the
  sheepdog off releases every hold (3.10). R3-L3: the engine counts its own
  `DeliveryHeld` and `DeliveryReleased` in the same transaction, per agent
  and outage, with every release counted (7.3); R4-L7 covers its end. R3-L4:
  a limit pause with a known reset is busy (row 74); R4-L6 covers the case
  without a reset. R3-L5: a blocking wait is left out of the turn limit
  (4.4). R3-L6: a sheepdog compaction is a sheepdog turn (3.11). R3-L7: a
  post in a nudge's turn is not progress (4.2, row 78). R3-L8: a rule is
  checked as a whole and the snapshot is filled by encoded size (1.3a,
  row 70). R3-L9: any `ModeRefused` blocks matching, and protected names
  are compared without case (2.6, 2.8).
- **The L26 rework kept every earlier answer.** A diff of v4 and v5 shows
  relocation (the roles' code moves into `packages/contracts/src/roles/`
  and `packages/engine/src/roles/`), the removal of question 4 and the
  "if the owner allows" branches, and WS-7's new change lists. No rule from
  rounds 1 to 3 was dropped. Criterion 2.13's "without WS-7a" case became
  the unsupported-harness case, which matches lead ruling L27.
- **The named engine changes against the code.** 7b's anchors resolve:
  acceptance at `deliveries.ts:109-116`, the pause's carry-on at
  `deliveries.ts:136-156`, the reload's rows at `reload.ts:84-98`, the
  return and recovered dispatch at
  `packages/engine/src/recovery/restart.ts:184-210` and `:272-298`. A
  capacity error today is unclassified and returned by `failed`
  (`deliveries.ts:130-134`), as 7b says. 7a's anchors resolve:
  `AcpRunner.ts:400-417`, `CommandHandler.ts:138-176`, the resolver at
  `ceiling.ts:341` and its use at `:396-400`. 7c's anchors resolve:
  `packages/engine/src/runner/translate.ts` ignores `usage_update` and
  `state_update` today (`translate.ts:15-43`). Every existing test file the
  lists name exists, except `packages/contracts/test/unique.test.ts`
  (criterion 1.2), which CAPI's unit 1 is to create; the critic's lane.
  The files the lists miss are in R4-L8.

## Risk register

| Id | Description | Sev | Fall | Prob | Score | Band | Evidence | Owner |
|---|---|---|---|---|---|---|---|---|
| R4-L1 | The cache guard skips every lead with a working worker | 4: uncached large wakes, context growth | 3: one run | 8: every lead, every run | 96 | Schedule | Confirmed (PLAN:721-730, :820-825, :833; `context-keeper.sh:3`, `:23`) | roles planner, unit 9 |
| R4-L2 | Worktrees under `.claude/worktrees/` are protected settings paths | 4: owner answers routine edits; rules never match | 3: undone by moving worktrees | 8: the skill's example layout | 96 | Schedule | Confirmed (`ceiling.ts:317-322`, `:396-400`; `runner/permissions.ts:25-31`; `routing/permissions.ts:21`; `SKILL.md:66`; probe) | roles planner (recipe, 8a) and engine owner; lead files the issue |
| R4-L3 | The first write cancels the holder's blocking wait for a rule-answered request | 4: wasted lead step per match | 3 | 6: each match while the lead waits | 72 | Schedule | Confirmed by reading (`CommandHandler.ts:147-149`; `waits.ts:83`, `:110-119`; PLAN:966) | roles planner, unit 11a |
| R4-L5 | Sheepdog nudges count as busy, so the deadlock blames the worker | 4: healthy worker advised replaced | 3 | 4 | 48 | Record | Confirmed (PLAN:717-742, :768, :770) | roles planner, unit 7 |
| R4-L6 | A limit pause without a reset makes its team idle | 4: hourly flushed wakes | 3 | 4 | 48 | Record | Confirmed (`deliveries.ts:152-155`, `:193-196`; PLAN:717-721, :768, :774) | roles planner, units 6 and 7 |
| R4-L7 | The outage ends only at a clean turn end; give-up trigger undefined | 4: no retries in a later outage; holder not told | 3 | 4 | 48 | Record | Confirmed (`deliveries.ts:46`, `:94`, `:130-134`, `:171`; PLAN:772, :785, :967) | roles planner, units 8 and 11b |
| R4-L9 | Compaction's context basis is undefined | 4: needless compaction | 3 | 4: unresolved | 48 | Record | Unresolved (`claude.ndjson:17-20`; PLAN:823-825, :969) | roles planner, units 9 and 11c |
| R4-L4 | A throwing hold condition leaves a delivery `sent` for ever | 6: agent and waiters stuck | 3 | 2: a defect plus a capacity error | 36 | Record | Confirmed (`CommandHandler.ts:174-177`; `AcpRunner.ts:178`; `deliveries.ts:92-97`; `waits.ts:39-41`) | roles planner, unit 11b |
| R4-L8 | Capacity phrases unsourced; runner files missing from WS-7's lists | 2: a held deterministic error, or no hold | 3 | 4 | 24 | Record | Confirmed (`classify.ts:3-10`; `classify-errors.test.ts`; `Runner.ts:89-95`; `AcpRunner.ts:166-176`; PLAN:930-959) | roles planner, units 11a to 11c |

No row reaches the severity floor (no severity 9 or 10).

## Proposed post-build checks

- **PB-R4-1. Compaction of a waiting lead.** Scenario: in the acceptance
  test, a lead idle at 200,000 tokens collects two working workers through
  an `all`-mode post, and again through an engine `wait`. Expected: a
  compaction request two minutes before the computed expiry, and none
  while a completion wake is queued. Evidence: CM and FR tests on the test
  clock. Area: units 9 and 13.
- **PB-R4-2. A worktree under `.claude/worktrees/`.** Scenario: the live
  check 8.4 runs with its worktrees under a `.claude/worktrees/` path, and
  again outside it. Expected: an `ask`-mode worker's edit request reaches
  its lead in both, or the recipe forbids the first layout; a qualifying
  harness's matching request is answered by its rule in the permitted
  layout. Evidence: the live check's report. Area: units 12 and 14.
- **PB-R4-3. A rule answer and a blocking wait.** Scenario: a lead in
  `wait --block` on its worker; the worker's request matches a rule; also
  an owner-held asker. Expected: the lead's wait stays open, no
  `WaitCancelled` is written, and no owner alert is raised. Evidence: PC
  test over the real runner-event transaction. Area: unit 11a.
- **PB-R4-4. The sheepdog's reactor dies alone.** Scenario: kill the
  sheepdog's reactor fiber with the switch on, then cause a capacity
  error. Expected: CAPI §1's reactor supervision restarts it and the hold
  is released on time, or the hold condition says no while the reactor is
  down. Evidence: a K test that interrupts only the reactor. Area: units 5
  and 11b. (Noted in round 3, not yet answered.)
- **PB-R4-5. A multi-request turn's usage.** Scenario: a recorded Claude
  turn with several model requests. Expected: the context used for the
  floor equals the adapter's last reported context size. Evidence: a
  recorded fixture in 2g's run. Area: units 9 and 11c.

## Noted, not filed

- WS-7a's path resolution uses the ceiling's synchronous resolver
  (`ceiling.ts:341-376`, `lstatSync` and `readlinkSync`) inside the serial
  runner-event stream (`CommandHandler.ts:177`), for every word of every
  `execute` request. A hung mount in an agent's folder would stall every
  agent's events. Today's `settingsWrite` already runs the same resolver
  there, so the kind of risk is not new; only its frequency is.
- A notice to a lead whose own queue is held for capacity waits behind the
  hold, and if the lead's outage ends in a give-up, the board resolves the
  notice's post as `undeliverable` after two returns (BOARD, "Returned
  wakes"). The sheepdog re-routes a notice only when its recipient crashes
  or stops (3.7). Leads and workers usually run on different vendors, so
  this needs two correlated outages.
- A turn started by the engine's carry-on after the sheepdog's `release`
  is not a sheepdog turn under 3.11, so it ends a `roles.stall` alert. A
  stall alert cannot normally be open on a held agent, because the stall
  clock does not run while a delivery is queued.
- Round 3's notes still stand: the release timer of a hold ended by a
  crash or stop is refused with "not held" (7.4) and should be dropped on
  that end; a lead that is both sender and holder is woken twice for one
  capacity give-up.
- Known gaps 5, 6, 13 to 21 were not re-filed. R4-L2's consequence two is
  not known gap 14 or 17: it applies to any harness, in a qualifying one
  too.
- Lens questions: there are no money bases. Periods and bases: R4-L7 (the
  outage boundary), R4-L9 (the token base). Write ownership and
  tie-breaking: R4-L2 (who answers a request), R4-L5 (whose clock runs in a
  deadlock). Whether failure permits or denies: R4-L4 (the hold condition
  fails into a stuck delivery), R4-L2 (fails closed, which disables the
  feature), R4-L8 (a wrong phrase). Durable repair: R4-L7. Lock and
  enforcement lifecycle: R4-L3 (a held request that is never really held),
  R4-L4. Interacting rules: R4-L1, R4-L3, R4-L5 (truth table). No check
  was refused.
