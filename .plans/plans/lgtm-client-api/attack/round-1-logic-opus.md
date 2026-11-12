revise
Grade: 6  B/M/m: 0/8/12  Flags: none

# Round 1 review of the client API plan: logic and failure policy

This review covers `plan.md`, `contract.md` (version 7) and `decisions.md`.
The lens is write ownership, ordering, whether a failure permits or denies,
durable repair, enforcement lifecycle, and truth tables for rules that
interact. Every code claim was checked at commit `8ff4c9b`. In citations,
`contract.md` and `plan.md` mean the files in the plan folder, and code paths
are relative to the repository root.

## Summary of the verdict

The plan's structure is sound, and no finding blocks the design. Eight
findings need a change to the plan before the build, because the plan as
written cannot produce its own criteria. Most of them sit in two places: the
owner's wait, and the life of an alert across failures and restarts. Twenty
small changes to the contract text would close everything below.

## Findings

### LOGIC-1. The owner's wait cannot compute "settled" from the snapshot (major)

- **Category:** correctness, cross-plan contract.
- **Risk:** 108 = S6 × F3 × P6.
  - S6: the wait reports finished work that is not finished, until the owner
    notices by hand.
  - F3: one person, who can check and run the wait again.
  - P6: an ordinary action, because a lead with an open non-blocking wait is
    a normal shape.
- **Scenario 1:** A lead takes a non-blocking wait on its workers and ends its
  turn, so it is idle. The owner then runs `lgtm client wait`. The engine
  calls the lead unsettled, because of its open non-blocking wait. The helper
  takes a snapshot with no waits in it, so it calls the lead settled and
  finishes at once.
- **Scenario 2:** The roles plan holds a queue after a capacity error. The
  roles plan relies on this rule: "a held queue already leaves its agent
  unsettled through the engine's own deliveries" (`inputs/roles-plan.md`, the
  paragraph before "Services"). An idle agent's queued delivery was written
  before the snapshot, so the helper never learns of it and calls the agent
  settled.
- **Evidence:**
  - `settled` reads deliveries, requests, questions, holds and open
    non-blocking waits (`packages/engine/src/routing/waits.ts:39-45`).
  - E19 says the client builds its input "from `client.snapshot` and the
    stream" (`contract.md:1188-1189`).
  - The snapshot's list holds agents, open requests and questions, alerts,
    accounts, devices and piece sections (`contract.md:365-369`). It holds no
    deliveries and no waits.
  - The stream starts after the snapshot's sequence, so nothing earlier can
    arrive by that route (`contract.md:375-377`).
  - Criterion 3.5 says "exactly when the engine's settled test says so"
    (`plan.md:395`). A test using only post-snapshot events would pass and
    hide this.
- **Suggested fix:** Add to `client.snapshot`, for callers allowed the helper,
  the open deliveries (id, target and status, no text) and the open
  non-blocking waits (waiter only). Add to criterion 3.5 two cases where the
  delivery and the wait predate the snapshot.

### LOGIC-2. The helper has no equivalent of `reasonOf`, so a stopped member hangs the wait (major)

- **Category:** correctness, cross-plan contract.
- **Risk:** 108 = S6 × F3 × P6.
  - S6: a scripted wait never ends, and only a person can clear it.
  - F3: one person, who can interrupt it.
  - P6: an ordinary action, because a stopped or crashed team member is common.
- **Scenario 1:** The owner runs `lgtm client wait --block --all` on three
  workers, and one crashes. `settled` is false for a crashed agent forever, so
  the helper never finishes. The contract's only stated finish condition is
  that "the agents meet the same 'settled' test" (`contract.md:517-518`).
  Criterion 3.6 requires row 26's exit codes, and exit 1 needs "any crashed or
  stopped", which the helper has no way to compute.
- **Scenario 2:** A member's permission request sits with the owner. The
  member is not settled. `holds` tests only agent holders
  (`packages/engine/src/routing/waits.ts:33-35`), so "waiting on the caller"
  has no meaning for an owner caller. The owner's blocking wait hangs on a
  decision only the owner can make. Row 26 exists to prevent exactly this
  deadlock for agents, by exit 2.
- **Evidence:**
  - The engine's wait resolves members through `reasonOf`, not `settled`
    (`packages/engine/src/routing/waits.ts:49-59`, used at l.86).
  - `reasonOf` also treats paused as resolved, and treats an interrupted agent
    by its `reloadable` flag, which the helper therefore needs too.
  - E19 moves only `settled` and `holds` (`contract.md:1186-1187`).
  - Criterion 3.6 is at `plan.md:396`.
  - Exit codes are in `packages/cli/src/commands/wait.ts:13-31`.
- **Suggested fix:** Move `reasonOf` to `packages/contracts/src/settled.ts` in
  E19, and base the helper on it. Define "waiting on the caller" for the owner
  and devices as "a member's open request or question has the owner as its
  holder", with exit 2. Add a stopped member, a crashed member, and an
  owner-held request to the cases for criterion 3.6.

### LOGIC-3. The alert closing table leaves alerts open forever, and closes one too early (major)

- **Category:** truth table, durable repair.
- **Risk:** 108 = S6 × F3 × P6.
  - S6: the alert list is wrong until the owner dismisses each entry by hand,
    and one failure case leaves no alert at all.
  - F3: one person, who can dismiss.
  - P6: an ordinary action, because the owner stops agents routinely.
- **Evidence and scenarios, by row of `contract.md:620-626`:**

| Kind | Stated close | Case the table misses | Evidence |
| --- | --- | --- | --- |
| `approval` | `PermissionAnswered` or `PermissionCancelled` | The owner stops an agent with an owner-held request. `stop` writes no `PermissionCancelled`, so the alert never closes. | `packages/engine/src/commands/stop.ts:10-16`. The only writers are `recovery/crash.ts:60` and `recovery/restart.ts:129`. |
| `question` | `QuestionAnswered` only | The asker stops or crashes. No event closes a question, so the alert never closes. Answering it queues a delivery to a dead agent, which the state table calls invalid. | `stop.ts:10-16`; `recovery/crash.ts:57-62`; `views/apply.ts:52`; `routing/questions.ts:28-33`; `contracts/src/stateMachine.ts:102` |
| `failure` | "resumed or stopped" | No "resumed" event exists. The nearest is `StateChanged { starting }`. If the alert closes there and the reload fails, the agent sits interrupted with no alert and no `OwnerNeeded`. | `commands/resume.ts:26`, `commands/resume.ts:51-54` |
| `account` | `AccountAvailable` | The account is removed by `AccountChanged` with no account, so the alert never closes. An agent with no account row still raises `OwnerNeeded`, and no `AccountAvailable` can ever follow. | `contracts/src/events.ts:172`; `routing/deliveries.ts:176-183` and `:193-196` |
| `account` (one key) | "Only one alert is open for each key" | An open "out of usage" alert swallows the later "needs sign-in" alert, because both use `account:<id>`. The owner keeps a title naming the wrong remedy. | `contract.md:604-606`; `routing/deliveries.ts:177-179` |

- **Suggested fix:** Replace the table with a level test over the views, which
  the reactor applies after each batch that touches the subject:
  - An `approval` or `question` closes when its row is no longer open, or when
    its agent is stopped or crashed.
  - A `failure` closes on stop, or when the agent next reaches `idle` or
    `working`, so a failed reload keeps it open.
  - An `account` closes when the account row is gone or its status is
    `available`, and the alert's title follows the current status.
  - Name the question gap to the engine as well. It may deserve its own event,
    as a new decision row.

### LOGIC-4. The snapshot's "one read transaction" does not exist, and it can lose an event for good (major)

- **Category:** ordering.
- **Risk:** 72 = S6 × F3 × P4.
  - S6: a client never shows the missed event until it takes another snapshot.
  - F3: one person, who can reload the page.
  - P4: one rare fault, a snapshot landing in the short gap after a commit.
- **Scenario:** A commit writes sequence N+1. The views are updated only after
  the commit returns. `client.snapshot` runs in that gap and reads the log's
  head as N+1 and the views as of N. The client subscribes after N+1, so it
  never receives N+1. If that event is a `PermissionRequested` or an
  `AlertRaised`, the owner's page does not show the request.
- **Evidence:**
  - E9 reads "the views and the log's head in one read transaction"
    (`contract.md:948-950`).
  - The views are an in-memory reference (`packages/engine/src/views/Views.ts:42-45`).
  - They are published after the commit
    (`packages/engine/src/log/EventLog.ts:136-140`, l.266). No SQL transaction
    can include them.
  - Criteria 1.7 and 3.1 would not catch this, because neither forces a read
    into the gap.
- **Suggested fix:** Take the sequence from the same `views.snapshot` value
  that supplies the data, because the state already carries it
  (`packages/engine/src/views/apply.ts:342`). Never read the head separately.
  Add one test that holds publication open across a snapshot. The board's
  lists "and the sequence they were computed at" (`contract.md:526-528`) rest
  on the same value.

### LOGIC-5. Phone delivery has no defined guarantee, and the plan claims one that cannot hold (major)

- **Category:** failure policy, durable repair.
- **Risk:** 72 = S6 × F3 × P4.
  - S6: the owner is not told of a stuck agent, and it stays stuck until
    noticed.
  - F3: one person.
  - P4: one rare fault, a restart or a carrier outage during a send.
- **Scenario:**
  - The risk text says "the alert's record in the log prevents both" lost and
    double sends (`plan.md:163-164`). A push to a network server and a log
    commit cannot be one atomic step. If the service dies between the POST and
    `AlertDelivered`, the restart either sends again or leaves the alert unsent.
  - The risk row points to criterion 6.3 (`plan.md:528`), which covers only
    the record of the alert: "gives exactly one alert after restart"
    (`plan.md:504`). No criterion covers the send.
- **Undefined rules:**
  - What "pending" means after a restart, and whether retry state survives it.
    Criterion 6.11 is at `plan.md:512`.
  - Whether an alert cleared during backoff is still pushed, which would send a
    stale phone alert for a closed matter.
  - Whether "push or page only" is read when the alert is raised or when it is
    sent.
  - What happens when retries run out: its final state, and what the owner
    sees. A grep of both files finds no rule for this.
  - Whether one alert's backoff delays other alerts, since criterion 6.11 says
    only that it "never stops the reactor".
  - Whether setting the carrier later pushes every open alert, or none.
    Criterion 6.8 covers only the unset state (`plan.md:509`).
- **Suggested fix:**
  - Choose at-least-once, and reword `plan.md:163-164` and the risk row to say so.
  - Derive pending from the log: an open alert, of a kind pushed by the setting
    at send time, with no `AlertDelivered` and fewer than the limit of attempts.
  - Skip a cleared alert.
  - Record exhaustion as the last `AlertDeliveryFailed`, shown in the clients.
  - Send each alert on its own retry path.
  - Add a criterion that kills the service between the POST and the record, and
    asserts a duplicate is the only possible fault.

### LOGIC-6. The alert reactor has no starting position on a log that already has history (major)

- **Category:** ordering, rollout.
- **Risk:** 72 = S4 × F3 × P6.
  - S4: a burst of false alerts, which ends by itself or by dismissal.
  - F3: one person.
  - P6: an ordinary action, the first start after this feature ships.
- **Scenario:** The owner upgrades an engine that has been running. The
  reactor's view is empty, so its position is zero. It replays every historic
  `OwnerNeeded` as a raise. Most then clear. Those with no closing event stay
  open forever (LOGIC-3), such as a question from a long-stopped agent. If
  delivery is keyed on the raise, the phone receives the entire history.
- **Evidence:**
  - Section 1 gives a resume rule and no initial rule (`contract.md:199-200`).
  - A grep of `contract.md` and `plan.md` for "baseline", "first start" and
    "existing log" finds nothing.
  - The roles plan's stall watch stream position has the same gap
    (`inputs/roles-plan.md:534`, l.726).
- **Suggested fix:** A piece reactor with a position records its first position
  as the log's head at its first start, by one event. Open matters that already
  exist at that moment get alerts from a level scan over the current views, with
  no history replay and no phone push.

### LOGIC-7. The reactor's refusal record cannot be built, and no failure policy covers a failed write (major)

- **Category:** failure policy, write ownership.
- **Risk:** 72 = S6 × F3 × P4.
  - S6: alerts stop or vanish while the rest of the engine looks healthy.
  - F3: one person.
  - P4: one rare fault, such as a full disk.
- **Scenario 1, refused batch:** A reactor's batch is refused at source sequence
  S. The engine writes `CommandRefused { command, reason }` at sequence R, and
  "the reactor counts that event as handled" (`contract.md:1275-1278`). That
  event has no source sequence (`packages/contracts/src/events.ts:180`). There
  are two possible builds, and both are wrong:
  - If the position stays at S, every restart retries and writes another
    `CommandRefused`, which is what the rule says it prevents.
  - If the position moves to R, every event between S and R is skipped, including
    other alerts' raises.
- **Scenario 2, the position:** "The last sequence it handled in its own view"
  works only through events carrying a source. `client.AlertRaised` carries
  `sourceSequence` (`contract.md:603-604`), and `client.AlertCleared { alertId,
  cause }` does not (`contract.md:614`). Replay from the last raise is safe only
  if every close is a no-op on replay. The contract does not state that this is
  how the position is defined.
- **Scenario 3, write failure:** The reactor's write fails with `LogWriteFailed`.
  The writer then latches and refuses all later writes for the service's life
  (`packages/engine/src/log/EventLog.ts:141-143`, l.273-275). The existing
  follower pattern logs a warning and moves on
  (`packages/engine/src/accounts/available.ts:86-88`). A reactor that copies this
  moves past the event and loses the alert. A reactor that dies stops all alerts
  silently. A grep of both files for `LogWriteFailed` finds nothing. Criterion
  6.11 covers only a failed send.
- **Who else this touches:** A refused raise is also a lost alert, with nothing
  told to the owner. The roles stall watch keeps a position by the same rule.
- **Suggested fix:**
  - Add an optional source sequence to the refusal record, and define the
    position as the highest source sequence recorded, on raises, clears and
    refusals.
  - State the policy: on a write failure a reactor stops at the unhandled event
    and does not advance; on a defect the service reports it to the same place
    as a latched writer.
  - Raise an alert for a refused alert batch by a route that cannot itself be
    refused, or say plainly that it is not raised.

### LOGIC-8. Nothing makes a reactor wait for recovery (major)

- **Category:** ordering, lifecycle.
- **Risk:** 72 = S4 × F3 × P6.
  - S4: a wrong write on stale views, which later batches usually repair.
  - F3: one person.
  - P6: every restart gives it the chance.
- **Scenario:** The engine restarts, and the views still show agents as they
  were before the crash. Recovery has not yet written its interruptions and
  cancellations. A level-rule reactor runs "over the whole state at start-up"
  (`contract.md:203`) and acts on those views. The board's level rules, which
  mark agents as gone or wake them, read exactly this state
  (`inputs/board-contract.md:546-567`).
- **Evidence:**
  - Commands are refused during recovery
    (`packages/engine/src/commands/CommandHandler.ts:199`).
  - The existing followers wait for `recovery.whenReady`
    (`packages/engine/src/accounts/available.ts:84`;
    `packages/engine/src/routing/deliveries.ts:317`).
  - E6 says reactors "join the engine's followers" (`contract.md:886-887`).
    E23's batch path has no recovering check (`contract.md:1244-1263`).
    `whenReady` appears in neither `contract.md` nor `plan.md`.
- **Same gap at the web server:** The socket server answers 503 during recovery
  (`packages/engine/src/api/server.ts:99`). Nothing requires the new web server
  to do the same. No rule says what the engine does when the web port cannot be
  bound, such as whether the engine stops or runs without a page.
- **Suggested fix:** Add to E6 and E23 that a reactor starts only after
  `whenReady`, and that the batch path refuses before then. Add one test with a
  fixture reactor during recovery. Add two web server criteria: 503 during
  recovery, and one chosen behaviour for a failed bind.

### LOGIC-9. E22 and E23 rest on a check the handler does not make (minor)

- **Category:** false premise, unresolved anchor.
- **Risk:** 48 = S4 × F3 × P4.
  - S4: a reactor's other duties are late, and a later batch repairs them.
  - F3: one person.
  - P4: one rare fault, a target crashing in a short window.
- **Scenario:**
  - A reactor builds a batch with wakes for two targets. One target crashes
    before the writer transaction. `DeliveryQueued` is invalid on crashed
    (`packages/contracts/src/stateMachine.ts:102`), so check 2 refuses the whole
    batch, and the live target's wake is lost too until "a later batch touches
    it" (`contract.md:1279-1280`).
  - The rule "Each piece's tests show that its reactor never builds a refused
    batch" (`contract.md:1280-1281`) cannot hold if a reactor's batch is built
    outside the writer transaction. The contract does not say where it is built.
- **Evidence:**
  - E22 and E23 say "as the handler checks the engine's own"
    (`contract.md:1236`, l.1257).
  - The handler checks commands by state at
    `packages/engine/src/commands/CommandHandler.ts:74`, and does not check
    events. `eventEffect` is used only in `packages/engine/src/views/apply.ts:153`.
  - The engine's own `routing/questions.ts:28-33` queues to an asker in any state.
  - The contract does not say which agent's state applies to each event, nor
    whether the state is read on the projected batch.
- **Suggested fix:** State that check 2 is new, and define it per event against
  the projected snapshot. Say a reactor's batch is built inside the writer
  transaction. Change the batch path to drop a request for a target that is gone
  rather than refusing the whole batch, or state that the whole batch is refused
  and why.

### LOGIC-10. The read rule's "always agree" and its text do not survive a transition (minor)

- **Category:** truth table. Lead ruling L29 binds; this names consequences only.
- **Risk:** 72 = S4 × F3 × P6.
  - S4: an orchestrator's picture of a worker is stale until its next snapshot.
  - F3: one person.
  - P6: an ordinary action, a lead recovering.
- **Scenario:**
  - The orchestrator takes a snapshot while its lead is paused, and the snapshot
    includes the worker. The lead recovers. The stream stops carrying the worker
    (`contract.md:420-422`), and no event tells the client that its read ended.
    The worker stays frozen in the client's picture. A replay would no longer
    show it.
  - So "a snapshot, a live subscription and a rebuilt log always agree"
    (`contract.md:460-462`) and criteria 1.7 and 3.1 hold only with no such
    transition. Those criteria read "for an agent" (`plan.md:272`, l.391).
- **Text that disagrees with the code:**
  - The contract and criterion 1.28 say "paused, crashed or stopped"
    (`contract.md:417`, `plan.md:293`). `available` means idle or working
    (`packages/engine/src/routing/holders.ts:14-17`), so starting and interrupted
    also count, and "only" would make the test contradict "reads always cover
    management" (`contract.md:412`).
  - Criterion 3.2 says "not its grandchildren" (`plan.md:392`), while the contract
    allows them while their parent is unavailable (`contract.md:486-489`).
- **Suggested fix:** Limit the agreement claim to a fixed set of readable agents,
  and say an agent caller refreshes `client.roster` when a child's parent becomes
  available. Change the two criteria to the `available` wording and to the
  conditional form.

### LOGIC-11. The filtered stream's group rule and checkpoint are wrong on catch-up (minor)

- **Category:** ordering.
- **Risk:** 72 = S6 × F3 × P4.
  - S6: a phone can lose events for good if a checkpoint moves past unscanned ones.
  - F3: one person, who can reload.
  - P4: one rare fault, a dropped connection during a group change or a long scan.
- **Scenario 1:** "Views at the moment of each event" (`contract.md:386-388`) is
  true only live. On catch-up the filter sees only the current views. A phone that
  reconnects after an agent has left a group loses that agent's events from before
  the leave, and gets pre-join events for an agent that has joined. This also
  contradicts row 30's "from that event on".
- **Scenario 2:** A `client.Checkpoint` "carrying the latest sequence"
  (`contract.md:390`), read as the log's head, jumps the cursor past rows not yet
  scanned. A reconnect then skips them.
- **Evidence:** The existing filter reads the current views at delivery
  (`packages/engine/src/api/server.ts:155-159`).
- **Suggested fix:** Say a checkpoint carries the last sequence scanned. For
  groups, either accept current-views filtering and say so, as the read rule does,
  or have the filter apply `AgentGrouped` events as it scans.

### LOGIC-12. E21 and E5 disagree with the views about which events belong to an agent (minor)

- **Category:** correctness.
- **Risk:** 60 = S2 × F3 × P10.
  - S2: a missing line in the thread, or a stray entry.
  - F3: one person.
  - P10: every thread read.
- **Scenario 1:** E21 reads "the log's existing per-event agent column"
  (`contract.md:1223-1224`). That column is filled by `"agentId" in event`
  (`packages/engine/src/log/EventLog.ts:175`), so `DeliveryQueued` is left out
  (`docs/issues.md`, issue 31). `client.thread` then differs from the engine's
  `threads` view, which includes it (`packages/engine/src/views/apply.ts:122-123`).
  The owner's thread shows no queued prompts.
- **Scenario 2:** `client.AlertRaised` has a top-level `agentId?`
  (`contract.md:603`). `threadAgent` uses the same field test, so that event joins
  `threads` (`apply.ts:122-123`, l.344-346). E5 says "Every engine view ignores a
  piece's tags" (`contract.md:852-853`) and does not name this line or a test for it.
- **Suggested fix:** Decide issue 31 in E21: filter by the existing view rule or
  fill the column. Name `threadAgent` in E5, limit it to engine events, and name
  the test in `packages/engine/test/views/apply.test.ts`.

### LOGIC-13. The contract says access runs before receipts, and E2 leaves it after (minor)

- **Category:** ordering, enforcement lifecycle.
- **Risk:** 12 = S4 × F3 × P1.
  - S4: a stored reply shown to a caller who may not make that command.
  - F3: one person.
  - P1: it needs a request id and exact body reuse.
- **Scenario:** The owner runs a computer-only command at the socket. A web caller,
  which has access kind `device` and the receipts key `owner`, sends the same
  request id and body. The replay at `CommandHandler.ts:254-259` returns before
  `planCommand` (l.260), and the access check lives inside `planCommand` (l.70). So
  the stored reply comes back with no access check. In the other direction, a
  device's refusal is stored under `owner` (l.264), and it is replayed to the owner.
- **Evidence:**
  - Section 1 puts access first (`contract.md:168-169`). The roles plan relies on
    that for reads.
  - E2 says only that the check at l.70 "becomes a lookup" (`contract.md:774-776`).
  - The planner's `Input` holds `actor` and `snapshot`, with no caller kind
    (`packages/engine/src/commands/internal.ts:36-40`).
- **Suggested fix:** Move the check above the receipt lookup in E2, and add one
  test: a device replaying an owner-only request id is refused.

### LOGIC-14. `open-web` has no credential path, and no criterion guards the reserved id (minor)

- **Category:** ownership of a value.
- **Risk:** 36 = S2 × F3 × P6.
  - S2: a build-time puzzle, or a mislabelled log entry.
  - F3: one person.
  - P6: every web request depends on it.
- **Scenario:** E12 says "The command handler sets it from the device credential"
  (`contract.md:990-991`). A web caller has no credential. The handler's
  `Credential` union and its verify step need a real credential
  (`packages/engine/src/commands/CommandHandler.ts:45-48`, l.205-207). `webCaller`
  needs a new variant that only it can build, and neither E2 nor E12 names it. The
  server's rechecks also use a raw credential
  (`packages/engine/src/api/server.ts:119-127`). "Never minted for a real device"
  (`contract.md:252`) has no criterion I could find, and `DeviceId` accepts the
  value (`packages/contracts/src/ids.ts:18`).
- **Suggested fix:** Name the internal variant in E12, say which recheck it skips,
  and add a test that a device add refuses the reserved id.

### LOGIC-15. Public address and proxy mode have no complete truth table (minor)

- **Category:** truth table.
- **Risk:** 48 = S4 × F3 × P4.
  - S4: remote access or links fail until the owner fixes the setting.
  - F3: one person, who can change it.
  - P4: a rare setting mistake.

| Proxy mode | Public address | Web server behaviour | Link in the alert | Problem |
| --- | --- | --- | --- | --- |
| Off | Set | Public `Host` refused (10.1) | Still built (6.10) | The phone gets a dead link with a 403. |
| On | Unset | Every proxied request refused | None | Nothing refuses this setting, and the page cannot explain it. |
| On | Set with a differing form | Depends on normalisation | Built | The form of the setting is undefined: scheme, port, trailing slash, compared with `Origin` and `Host`. |

- **Evidence:** `plan.md:455`, l.511, l.643; `contract.md:264-276`, l.647-650.
- **Also:** A browser at `localhost:<port>` is refused if only `127.0.0.1` is on the
  allow-list (`plan.md:455` says "the loopback address"). The contract does not say
  which names count.
- **Suggested fix:** Add this table to the contract. Build the link only in proxy
  mode with a public address. Have `client.web.settings` refuse "proxy mode on, no
  public address". Define one canonical form, and list the loopback names allowed.

### LOGIC-16. E16's "withdraw" has no meaning for a returned delivery (minor)

- **Category:** truth table.
- **Risk:** 36 = S2 × F3 × P6.
  - S2: a builder has to guess, and a test settles it.
  - F3: one person.
  - P6: every failed send of a piece delivery.
- **Scenario:** The source rule says what happens "when its target stops or crashes,
  or when it is returned", and unit 1 writes "withdraw" for each
  (`contract.md:1120-1122`). A returned delivery is already terminal, since
  `DeliveryReturned` is written first (`contract.md:1104-1108`). E17 allows a
  withdrawal only while queued (`contract.md:1129-1131`). Criterion 1.15 therefore
  has no defined expected result for "returns it" (`plan.md:280`). The board needs
  "withdrawn and never returned" on a stop or crash
  (`inputs/board-contract.md:369-371`), and it counts returned wakes
  (l.355-363), so the two cases must differ.
- **Suggested fix:** Give the rule two questions: on stop or crash, withdraw or
  return; on return, no engine action, with the piece's reactor acting on
  `DeliveryReturned`.

### LOGIC-17. Three service paths are unnamed (minor)

- **Category:** engine edit coverage.
- **Risk:** 36 = S2 × F3 × P6.
  - S2: found at compile time, or as a wrong label in the log.
  - F3: one person.
  - P6: every stall watch use.
- **Scenario and evidence:**
  - The stall watch's list includes `subscribe` (`inputs/roles-plan.md`, criterion
    3.4). `subscribe` is not a handler command: it is written inline at
    `packages/engine/src/api/server.ts:154`, and E13's entry point "runs a command"
    (`contract.md:1035`). The in-process read path has no named owner.
  - `commands/resume.ts:47` passes `actor` to `reload`, which writes under it after
    the commit (`packages/engine/src/recovery/reload.ts:104`, l.134, l.138). A
    grep of the contract for `resume.ts` and `reload` finds nothing. So a service's
    resume has no stated caller for those later writes.
  - E15 wraps service and piece text in the agent-text envelope
    (`contract.md:1088-1091`), whose fixed text says "Data from another agent"
    (`packages/engine/src/routing/envelope.ts:14-18`). The contract says it is shown
    as from the piece (`contract.md:1098-1099`). The envelope takes no sender.
- **Suggested fix:** Name each one in E13 and E15, with the tests that change:
  `packages/engine/test/routing/text-is-data.test.ts` and the live rendered-prompt
  test expect the current fixed wording.

### LOGIC-18. Two writers of `AlertCleared`, and dismiss on a closed alert, are undefined (minor)

- **Category:** write ownership.
- **Risk:** 24 = S2 × F3 × P4.
  - S2: a duplicate record or a confusing refusal.
  - F3: one person.
  - P4: a rare race.
- **Scenario:** The contract says the reactor writes the clear on a dismiss
  (`contract.md:614-616`). `client.alerts.dismiss` is a command, so its planner
  must write in its own batch, or its receipt has nothing to record. A dismiss
  and a subject close can then race. Neither a second clear nor a dismiss on a
  closed alert has a stated result.
- **Suggested fix:** Have the planner write the dismiss clear. Have the reactor
  check the alert view inside the writer transaction. Make dismiss of a closed
  alert a success with no event.

### LOGIC-19. An alert's account key cannot be computed from what the reactor is given (minor)

- **Category:** cross-plan contract.
- **Risk:** 48 = S4 × F3 × P4.
  - S4: the alert names the wrong account, until the next event.
  - F3: one person.
  - P4: a rare account change mid-replay.
- **Scenario:** `OwnerNeeded` has no account id
  (`packages/contracts/src/events.ts:143-150`). So `account:<id>` needs the agent's
  account from the views, and the contract's reactor text says only that it "reads
  committed events" (`contract.md:600`). On replay after a restart, those views are
  later than the event and the agent's account may have changed. The purity rule
  at `contract.md:561-563` limits piece sources to one envelope, and the roles plan
  depends on it ("an alert source sees one event", `inputs/roles-plan.md:394`), so
  the rule for the engine's own reasons must be stated apart from it.
- **Suggested fix:** Key on `AccountNeedsSignIn` and `AccountOutOfUsage`, which do
  carry the id, and keep the `OwnerNeeded` row for the case with no account. Or
  state the reactor's inputs explicitly.

### LOGIC-20. Anchors and stale text (minor)

- **Category:** unresolved anchor.
- **Risk:** 10 = S1 × F1 × P10. Tooling only, for each reader.
- **Evidence:**
  - `CommandHandler.ts:236` (`contract.md:982`) is really l.237.
  - `EventLog.ts:205` (`contract.md:835`) is really l.210.
  - `EventLog.ts:210-220` (`contract.md:810`) does not hold the redaction, which is
    at l.212 and l.221-231.
  - `plan.md:246` and l.260 say "E1 to E22", while E23 exists.
  - `contract.md:26` says rows 76 to 89, while row 90 exists, and `plan.md:807` says
    row 90 is folded.

## Risk register, sorted by score

No finding reaches the 150 band. Each major is still a change the plan needs before
its unit is built, because its criterion cannot pass as written.

| Score | Band | Finding | Severity |
| --- | --- | --- | --- |
| 108 | schedule | LOGIC-1, the owner's wait lacks input | major |
| 108 | schedule | LOGIC-2, the helper has no `reasonOf` | major |
| 108 | schedule | LOGIC-3, the alert closing table | major |
| 72 | schedule | LOGIC-4, the snapshot's sequence | major |
| 72 | schedule | LOGIC-5, phone delivery guarantee | major |
| 72 | schedule | LOGIC-6, the reactor's first position | major |
| 72 | schedule | LOGIC-7, reactor refusal and write failure | major |
| 72 | schedule | LOGIC-8, reactors and recovery | major |
| 72 | schedule | LOGIC-10, read rule transitions | minor |
| 72 | schedule | LOGIC-11, filtered stream on catch-up | minor |
| 60 | schedule | LOGIC-12, agent column and thread view | minor |
| 48 | record | LOGIC-9, the check the handler does not make | minor |
| 48 | record | LOGIC-15, public address truth table | minor |
| 48 | record | LOGIC-19, the account key | minor |
| 36 | record | LOGIC-14, the `open-web` path | minor |
| 36 | record | LOGIC-16, "withdraw" on return | minor |
| 36 | record | LOGIC-17, unnamed service paths | minor |
| 24 | record | LOGIC-18, dismiss ownership | minor |
| 12 | record | LOGIC-13, access and receipts order | minor |
| 10 | record | LOGIC-20, anchors | minor |

## Proposed post-build checks

These need the built code, so they are not claims about it.

| Check | Scenario | Expected result | Evidence needed |
| --- | --- | --- | --- |
| PC-1 | A second process holds the same socket inode as the browser, and one holder descends from an agent. | The guard refuses the connection. | Test output from a shared-descriptor fixture. |
| PC-2 | Kill the service between the phone POST and `AlertDelivered`. | One alert record, and one or two pushes, never zero. | The log rows and the fake carrier's count. |
| PC-3 | An alert clears while its retry is in backoff. | No push after the clear. | The fake carrier's timestamps. |
| PC-4 | A snapshot runs in the commit-to-publish gap. | No event is missing from snapshot plus stream. | A test with a held publish. |
| PC-5 | A phone reconnects across a group change, with a checkpoint in the middle of a long scan. | The agreed rule holds, and no unscanned row is skipped. | Test output listing delivered sequences. |
| PC-6 | A fixture reactor runs during recovery. | No piece batch is written before `whenReady`. | Log order in a restart test. |
| PC-7 | `lgtm client wait --block` runs with one stopped member and with one owner-held request. | Exit 1 and exit 2, with no hang. | Command-line test output. |
| PC-8 | First start on a log with history and a set carrier. | No historic pushes, and an alert for each matter still open. | The fake carrier's count and the alert view. |
| PC-9 | The owner answers a question from a stopped agent. | One stated result: refused, or accepted and closed, with no delivery to a dead target. | Test output. The state table has no `answer` row, so this could not be settled by reading. |

## Noted, not filed

- **Known gap, possibly narrower than scoped:** Row 88's "adds no new power" holds
  for an open-web caller changing the carrier, because that caller can already read
  the state folder or answer requests. A token reference plus a changeable server
  could still send any stored secret to any host. Limiting that reference to an
  alert-only secret would be cheap. This belongs to the security lens.
- **A guard case not in known gaps:** An orphan of a dead adapter passes the guard,
  because `outsideAdapters` skips rows whose process is no longer live
  (`packages/engine/src/api/ancestry.ts:33-36`). It adds no new class of bypass to
  the accepted list, and I am naming it for completeness.
- **Notices with no alert:** A crash notice to a holder that crashes first is
  returned with sender owner, and raises no alert
  (`packages/engine/src/recovery/crash.ts:74-78`;
  `packages/engine/src/routing/deliveries.ts:47`). `AgentReloadFailed` and
  interrupted also raise no alert. Both may be intended, and the plan does not say.
- **Dead event:** `PromptSent` has no writer in `packages/engine/src` by grep. E15
  still widens its sender, which is harmless.
- **Placeholder envelopes:** `project` builds placeholder envelopes with the caller
  owner (`packages/engine/src/routing/waits.ts:28-31`). A piece's reducer run on the
  projection would see placeholder sequences. The piece condition should not read
  those.
- **Read cost:** `waitForAgents` makes a read per event while the engine's part stays
  settled (`contract.md:530-535`). That is correct, and could be busy on a large team.
- **Caller on wait checks:** `withWaitChecks` events in a piece batch are written
  under the `piece` caller. That looks acceptable, because check 5 runs after check 1.
- **Client reconnect:** The client reconnects three times (scouting item 7), which a
  sleeping phone uses up quickly. The web page's behaviour after that is a user
  interface question.
- **Checked and correct:**
  - The five reasons and three producers of `OwnerNeeded`
    (`routing/holders.ts:49`, `recovery/crash.ts:69`, `routing/deliveries.ts:193-196`).
  - "A request never moves back down from the owner"
    (`packages/engine/test/routing/moving-requests.test.ts:190`).
  - The lead ruling L29 claim that an orchestrator may stop its lead today.
  - The receipts mechanism for a planner's reply.
  - The other anchors I followed resolved.
- **Process:** No test-gaming, stubs or scope creep were found, and no process
  allegation is made. The other reviewers' files in this folder were not opened.
