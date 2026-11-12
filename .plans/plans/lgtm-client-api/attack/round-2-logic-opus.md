revise
Grade: 6  B/M/m: 0/5/15  Flags: none

# Plan review of `lgtm-client-api`, round 2, lens: logic and failure policy

This review covers client API contract version 8, the fold of round 1. Engine
paths are relative to the repository at commit `8ff4c9b`. `contract.md` and
`plan.md` are the files beside `attack/`. "Board" means
`inputs/board-contract.md`, and "roles" means `inputs/roles-plan.md`.

## Summary of the verdict

The fold of round 1 is mostly sound, and I found no blocker. The snapshot
sequence, the `afterCommit` correction, the move of the access check, and the
reactor start rules all hold against the code.

Five majors remain. One is an engine change that breaks an engine invariant,
which is edit E27's collection of secrets at run time. One is an engine change
that can strand an agent, which is edit E18's withdrawal on the recovered send
path. Three are holes in round 1's folds: delivery exhaustion, oversized
state-bearing events, and a question alert that never returns after a resume.

## Findings

### MAJOR 1. Edit E27's run-time collection can delete a secret that was just stored

- **Category:** Security (integrity), and Bug (timing).
- **Where:** E27 says, "The alert worker calls it after a token is cleared, so
  a cleared value goes at once" (`contract.md:1818-1825`). The token section
  says the same (`contract.md:894-895`).
- **Why it breaks:** Today, collection runs only in recovery, and the store's
  interface states that condition: "Restart recovery calls it, before any
  command can store a new value" (`packages/engine/src/commands/SecretStore.ts:13-15`,
  `packages/engine/src/recovery/restart.ts:288`).
  `setSecret` writes the value before the commit, under a fresh reference
  (`packages/engine/src/commands/accounts.ts:38-50`), and its comment promises
  "never a committed reference with no value" (l.44). `retainOnly` removes
  every entry that is not in the keep set, under a semaphore of the store alone
  (`packages/engine/src/accounts/SecretStore.ts:49-64`). It does not hold the
  log's writer permit. E27 also makes `set-token` store before commit.
- **Scenario A:** The owner clears the token while `accounts set-secret` is
  running. The set-secret command has stored its value but has not committed.
  The worker computes the keep set from the views, and the new reference is not
  in it. `retainOnly` deletes the value. The command then commits. The account
  now has a committed reference with no value, and its agent starts fail.
- **Scenario B:** The owner changes the server's origin and at once runs
  `set-token`, which are the two setup commands in order. The origin change
  clears the token. The worker reacts to the clear, computes a keep set with no
  slot, and deletes the fixed slot after `set-token` has stored the new value.
  `set-token` then commits. The log says that a token is set, and the slot is
  empty. On a deny-all server, every alert then fails.
- **Behaviour-change gap:** E27 says "Behaviour change: none for accounts", and
  this scenario changes accounts. Its named tests do not cover a concurrent
  store.
- **Suggested fix:** Keep `retainOnly` at start-up only, where the interface
  comment already places it. Add a narrow `remove(reference)` to the secret
  store for the one fixed slot. Run that removal inside a writer transaction
  that first confirms, from the views of that transaction, that no token is
  set. Make `set-token`'s store and commit hold the same order, for example by
  storing inside the transaction, or by using a fresh reference per token value
  so that a stale removal cannot touch a newer value. Add a test for each of
  the two scenarios.
- **Risk:** severity 8 × fallout 3 × probability 4 = **96, schedule.**
  - Severity 8: a stored secret is permanently lost.
  - Fallout 3: the owner can enter the value again without help.
  - Probability 4: it needs one rare timing between two commands.

### MAJOR 2. A withdrawal on the recovered send path leaves an agent `working` with nothing sent

- **Category:** Bug (failures).
- **Where:** E18's send-time withdrawal (`contract.md:1608-1616`) and E17's
  withdrawal by a piece (`contract.md:1574-1580`).
- **How the code gets there:** After a reload, `reloadedEvents` writes
  `StateChanged working` when a requeued delivery exists
  (`packages/engine/src/recovery/reload.ts:73-74,86,98`). Recovery then runs
  `dispatchQueued` with `recovered: true`
  (`packages/engine/src/recovery/restart.ts:276-281`), and `resume` does the
  same (`packages/engine/src/commands/resume.ts:56`). The send clears the
  "working" state only by way of a sent delivery and a later turn end.
  `turnEnded` writes nothing when no turn matches
  (`packages/engine/src/routing/deliveries.ts:81-97`).
- **Scenario:** A board wake is sent, and the service then restarts. The wake
  is requeued, so the reload writes `working`. While the service was down, or
  before the send, the target's membership changed, so E18's check fails at
  send time. The dispatcher withdraws the wake. No delivery is behind it. No
  `DeliverySent` follows, and no turn exists to end. The agent shows `working`
  with an idle adapter until someone stops it. Every wait on it hangs, because
  `settled` never becomes true. A board reactor that withdraws a requeued wake
  after the reload batch has the same result, because E17 allows a withdrawal
  while the delivery is queued.
- **Why round 1 did not reach this:** The withdrawal rule states that it "runs
  the engine's wait checks" and goes on to the next delivery. It says nothing
  about the state that `reload` wrote in advance. E18 says "Behaviour change:
  none for deliveries without a `piece` source", which is true, but it does not
  name the new way into this state. The roles plan depends on the same property
  in its capacity hold (criterion 7.3, roles `:1065`).
- **Suggested fix:** Add a rule to E17 and E18. When a withdrawal leaves an
  agent in the reloaded state, with nothing queued or sent, the same batch
  writes `StateChanged idle` before the wait checks. Reuse the `reloaded`
  test at `deliveries.ts:222-227`. Add a criterion for it, with both a dispatcher
  withdrawal and a reactor withdrawal.
- **Risk:** severity 6 × fallout 3 × probability 4 = **72, schedule.**
  - Severity 6: a core feature stays wrong until it is fixed by hand.
  - Fallout 3: the owner can stop and resume the agent alone.
  - Probability 4: it needs a restart together with a reach change.

### MAJOR 3. Delivery exhaustion loses the phone alert for good, while the matter stays open

- **Category:** Bug (failures), and Design. This is a hole in the fold of
  LOGIC-5, A7 and R4.
- **Where:** "Exhaustion" and "Pending" in `contract.md:794-798,815-817`.
- **The numbers:** The waits are 5 seconds, 30 seconds, 2 minutes and 10
  minutes, which total 12 minutes and 35 seconds, plus at most 50 seconds of
  attempt limits. The fifth failure is final. Pending counts attempts only
  "since the carrier last changed". Nothing else makes a final alert pending
  again.
- **Scenario A:** The owner's home ntfy server is down for 15 minutes, for
  example during a reboot or an update, or the home connection drops. An agent
  asks for an approval during the outage. The alert becomes final and is shown
  as "not delivered" in the clients. The owner is away from those clients, which
  is why the phone alert exists. The server returns, and nothing is sent. The
  agent stays blocked with no word to the owner.
- **Scenario B:** The owner follows the recommended deny-all setup. `carrier.set`
  runs, and the token follows more than 13 minutes later. Alerts raised in
  between get authentication errors and become final. Setting the token does
  not count as a carrier change, so they stay final. A revoked token behaves the
  same way until rotation, and rotation does not reset them either.
- **Why it matters for this promise:** "A notification is never lost to a
  restart" is true, and the same notification is lost to a short outage. A
  restart does not help, because the attempts are derived from the log.
- **Suggested fix:** Keep retrying at the 10-minute cap for as long as the alert
  is open and pushed, and record `final` only as a client-visible "still failing"
  mark. If an attempt limit is wanted for cost reasons, make final alerts pending
  again on the next successful send of any alert, on `set-token` and
  `clear-token`, and at restart. Add a test with a fake carrier that is down for
  an hour and then returns.
- **Risk:** severity 6 × fallout 3 × probability 6 = **108, schedule.**
  - Severity 6: the core alert is lost until the owner notices by hand.
  - Fallout 3: one owner, who can recover alone.
  - Probability 6: a home server outage of 13 minutes is ordinary.

### MAJOR 4. Oversized markers and the snapshot leave the state of open requests undefined

- **Category:** Design, and Bug (numbers). This is a hole in the fold of A6, C03
  and LOGIC-1.
- **Where:** `contract.md:419-433` and `contract.md:964-974`, against
  `packages/contracts/src/events.ts:126` and
  `packages/contracts/src/commands.ts:67,79`.
- **The snapshot's request shape is not stated.** Section 3 says that the
  snapshot holds "open permission requests and questions". Section 5 says that
  it is one reply "with no thread text", under 4 MiB on a fixture. `RequestRow`
  and `QuestionRow` hold an unbounded `description`, `options` and `text`
  (`packages/engine/src/views/apply.ts:34-59`). If the snapshot includes them,
  the 4 MiB bound is a property of the fixture and not of the system. If it
  leaves them out, the page cannot show or answer a request that opened before
  the snapshot without a scan of the thread, and `RequestRow` has no sequence to
  start that scan from. Criterion 7.12 needs the full text before Allow.
- **A marker hides state.** `client.subscribe` replaces any event over 256 KiB
  with a marker of `{ sequence, tag, agentId?, bytes }`. The marker holds no
  identity. So a `PermissionRequested` or `QuestionAsked` over the limit never
  reaches the page's open-request list, and criterion 7.4 fetches the event only
  "on a tap". The same applies to `DeliveryQueued`: a prompt that a person pastes
  at 300 KiB is under the 1 MiB inbound limit, and it becomes a marker. The next
  `DeliverySent` then names a delivery that the page never saw. The contract
  does not tell the client's fold how to treat this.
- **The board's maximum sits on the boundary.** The board caps a wake's body at
  256 KiB as JSON encodes it (Board `:313-315`). The envelope and the delivery
  fields add to that. So a wake at the cap is over the marker's limit of 256 KiB,
  and the "stated maxima" test at `contract.md:975-978` cannot pass as written.
- **A marker for an event in no thread cannot be read.** A marker tells the
  client to read the event with `client.thread`. `HarnessChanged` and
  `AccountChanged` are in no thread, so an oversized one has no read path.
- **Suggested fix:** State the snapshot's row fields: id, agent, holder, options,
  `settingsWrite`, the source sequence, the text's byte size and a bounded
  preview. State which event tags carry state. For those tags, the marker carries
  the identity, or the client fetches the event automatically before it applies
  later events. Name a read by sequence for events that are in no thread. Set the
  board's cap so that the whole encoded event is under the limit, or set the
  marker's limit above the largest stated event.
- **Risk:** severity 6 × fallout 3 × probability 4 = **72, schedule.**
  - Severity 6: an open request can be missing from the page until a reload.
  - Fallout 3: one owner, who can reload alone.
  - Probability 4: a request of this size is rare, although a large prompt is not.

### MAJOR 5. A question alert closes on a crash and never returns after a resume

- **Category:** Design. This is a hole in the fold of LOGIC-3. The known gap
  covers the stopped asker's open row and is not re-filed here. This finding is
  about the consequence of a resume, which that gap does not address.
- **Where:** The closing table says that a question closes when "its asker is
  stopped or crashed" (`contract.md:771`). The row stays open, because neither
  path closes it (`packages/engine/src/recovery/crash.ts:57-69`,
  `packages/engine/src/commands/stop.ts:10-18`). Resume is legal from both states
  (`packages/contracts/src/stateMachine.ts:69-70`), and engine row 67 makes a
  crashed agent's waits re-open on resume.
- **Scenario:** A worker's question has reached the owner, and the phone shows
  it. The worker crashes, and the alert clears from the phone. The owner, or an
  orchestrator, resumes the worker. The question is still open, and the resumed
  worker still needs the answer. No rule raises the alert again, and "one alert
  per key" does not help, because no source fires. If the crashed worker's holder
  was an agent, no `failure` alert was raised either.
- **Truth table of the alert's state, for an owner-held question row:**

  | Asker's state | Row | Alert today | Alert needed |
  | --- | --- | --- | --- |
  | Live | Open | Open | Open |
  | Crashed or stopped | Open | Closed | Closed, or marked |
  | Resumed to live | Open | **Closed** | **Open** |
  | Any | Answered | Closed | Closed |

- **Suggested fix:** Add a level rule. When an agent leaves crashed or stopped,
  the reactor runs the raise test for each open owner-held question it asked, and
  raises a new alert with the same key. Add this to the first-start scan and to
  criterion 6.2. The same test should cover a request row that stays open after
  `stop`, or the contract should state that a resumed session makes that row
  meaningless.
- **Risk:** severity 6 × fallout 3 × probability 4 = **72, schedule.**
  - Severity 6: an agent waits, unseen on the phone, until the owner looks.
  - Fallout 3: one owner, who can answer from the client.
  - Probability 4: it needs a crash with an open owner-held question, then a
    resume.

### MINOR 1. The dismiss planner has no source event, so it can move the reactor's position

- **Category:** Bug (timing). This is a hole in the fold of LOGIC-7.
- **Scenario:** `client.AlertCleared` carries `sourceSequence`
  (`contract.md:759`), and the position is "the highest source sequence named on
  its own events" (`contract.md:209-211`). The planner of `dismiss` has no source
  event. If it writes the current sequence, and the reactor is behind, the
  position jumps forward. A restart before the reactor catches up then skips
  those events, and their alerts are lost.
- **Evidence:** `contract.md:209-211,759-763`.
- **Suggested fix:** Make `sourceSequence` optional and leave it out on dismiss.
  State that only a reactor-written event moves the position.
- **Risk:** severity 6 × fallout 3 × probability 2 = **36, record.** Severity: an
  alert is lost until it is noticed by hand. Fallout: the owner recovers alone.
  Probability: a dismiss during lag and then a restart are two rare events.

### MINOR 2. The owner's "request held" has no precedence over the member table

- **Category:** Design, and Bug (failures). This is a hole in the fold of LOGIC-2,
  A5 and R3.
- **Scenario:** `stop` writes no `PermissionCancelled`, so a stopped agent's
  request row stays open, and the owner stays its holder. Any later `lgtm
  client wait` that names that agent ends at once with exit 2, whatever the other
  members do. The closed alert does not explain why. The member table says exit
  1 for the same member.
- **Evidence:** `contract.md:614,624-631`,
  `packages/engine/src/commands/stop.ts:10-18`.
- **Truth table that the contract should state:**

  | Member | Open owner-held row | Member table says | Held rule says | Proposed |
  | --- | --- | --- | --- | --- |
  | Live | Yes | None | Exit 2 | Exit 2 |
  | Stopped or crashed | Yes | Exit 1 when closed | Exit 2 at once | Member table |
  | Paused | Yes | Exit 2 when closed | Exit 2 at once | Exit 2 at once |
  | Interrupted, reloadable | Yes | Keeps waiting | Exit 2 at once | Exit 2 at once |
  | Any | No | Member table | Not applied | Member table |

- **A second gap in the same rule:** The engine's `holds` covers any request that
  the waiter holds (`packages/engine/src/routing/waits.ts:33-35`). The owner's form
  covers only requests from waited members. So a request from a descendant of a
  waited member, held by the owner, does not end the owner's wait. The owner sees
  the wait hang while the answer is only theirs to give. State whether this is
  intended.
- **Suggested fix:** Limit the held rule to live members, add the table above, and
  decide the descendant case.
- **Risk:** severity 4 × fallout 3 × probability 6 = **72, schedule.** Severity:
  the wait gives a wrong result until the row is dealt with. Fallout: one owner
  alone. Probability: waiting on a stopped member is an ordinary action.

### MINOR 3. "After every batch" contradicts "no timer and no polling" for a piece's list

- **Category:** Design.
- **Scenario:** `contract.md:630-631` checks `ownerHeld` "at open and after every
  batch the helper applies". A client cannot compute a piece's list from the stream
  (`contract.md:637-641`). The later text and the board say that the read happens
  "only when the engine's part says settled" (`contract.md:643-648`, Board
  `:408-421`). A builder who follows the first sentence reads on every batch.
- **Suggested fix:** Say that the engine's held rule is applied after every batch,
  and that a piece's `ownerHeld` list is read when the engine's part says settled.
- **Risk:** severity 2 × fallout 1 × probability 6 = **12, record.** Severity: extra
  reads at most. Fallout: a build detail. Probability: one builder's reading.

### MINOR 4. The board's `board.WakeBuilt` cannot name a delivery that the batch path mints

- **Category:** Design. This is a real conflict, not lag.
- **Scenario:** E23 has a piece return a delivery request of target, body and source
  id, and the batch path turns it into `DeliveryQueued` (`contract.md:1712-1716`).
  The board writes `board.WakeBuilt`, "naming the wake, its delivery, its target"
  (Board `:308-312`), in the same batch, before any delivery id exists. The reach
  check looks the wake up in the `board.WakeBuilt` index (Board `:156-159`), and E18
  projects the batch's "earlier events" (`contract.md:1601-1604`). E23 does not
  state where a request's `DeliveryQueued` falls in the order relative to the
  planner's events. If it falls first, the check finds no wake, and a valid wake is
  refused.
- **Suggested fix:** State that requests are turned into events after the planner's
  own events, and that `board.WakeBuilt` names the source id. Or let the piece's
  helper mint the delivery id before the batch is built.
- **Risk:** severity 4 × fallout 1 × probability 10 = **40, record.** Severity: it
  stops the board's build, and a test would find it. Fallout: internal. Probability:
  every wake.

### MINOR 5. An accepted web connection is not judged again when the proxy settings change

- **Category:** Security (isolation).
- **Scenario:** The owner suspects a problem and narrows `allowedClientNetworks`,
  turns `proxyMode` off, or changes `proxyUserId`. The proxy table and the guard run
  at the upgrade (`contract.md:1039-1049`). E12 takes open-web out of the recheck
  (`contract.md:1423`, `packages/engine/src/api/server.ts:119-127`). Only `enabled`
  closes connections (`contract.md:1027`). A connection accepted under the old rule
  keeps the owner's rights until it drops.
- **Suggested fix:** Close every open-web connection on `client.WebSettingsChanged`,
  so that each client is judged again under the new rule. Add it to the settings
  criterion. Under team rule 8, this may be recorded instead of fixed now.
- **Risk:** severity 6 × fallout 3 × probability 4 = **72, schedule.** Severity: a
  caller keeps control until it is fixed by hand. Fallout: `enabled` off is the
  owner's escape. Probability: it needs a settings change with a connected client.

### MINOR 6. The filter of `client.subscribe` has no combination rule

- **Category:** Design.
- **Scenario:** The filter is three lists (`contract.md:445-448`). The contract does
  not say whether agents and groups combine as a union or an intersection, whether
  kinds intersect with them, or what an empty list means. An agent filter matches by
  thread membership, so an event with no thread agent, such as `AccountChanged` or
  an account's `client.AlertRaised`, does not match. A phone that filters by agent
  therefore never hears of an account alert. Criterion 3.4 does not fix any of this.
- **Suggested fix:** Publish this truth table, and make criterion 3.4 test each row.

  | Event | Agent list | Group list | Kind list | Proposed result |
  | --- | --- | --- | --- | --- |
  | In a named agent's thread | Set | Unset | Unset | Sent |
  | In a named group's agent's thread | Unset or not matching | Set | Unset | Sent, as a union |
  | Matches the agents or groups | Set | Set | Matches | Sent, as an intersection with kinds |
  | Matches the agents or groups | Set | Set | Does not match | Not sent |
  | In no thread | Set | Set | Matches or unset | Sent, if the caller may see it |

  An unset list and an empty list should both mean "no limit", or an empty list
  should be refused.
- **Risk:** severity 4 × fallout 3 × probability 6 = **72, schedule.** Severity: a
  client misses events for a while, and a snapshot repairs it. Fallout: one owner.
  Probability: a filtered phone is the intended use.

### MINOR 7. Edit E16 covers a queued delivery, and the code and the board also need a sent one

- **Category:** Design.
- **Scenario:** E16 asks the source rule what happens "while it is queued"
  (`contract.md:1565`). `targetGone` acts on `pending`, which is queued or sent
  (`packages/engine/src/routing/deliveries.ts:24,73-77`). The board needs a wake to be
  withdrawn "and never returned to anyone" (Board `:369-374`), and a sent wake is the
  common case at a crash. A builder who follows E16's words gives a sent piece
  delivery no rule. The sender is not an agent, so it gets only `DeliveryReturned`
  (`deliveries.ts:45-55`).
- **Suggested fix:** Say "queued or sent" in E16 and criterion 1.15. Test both.
- **Risk:** severity 4 × fallout 3 × probability 4 = **48, record.** Severity: a wake
  is returned, and the reactor can rebuild it. Fallout: one owner. Probability: it
  needs a crash with a sent wake.

### MINOR 8. Edit E2 and section 2 misstate `pass-up`

- **Category:** Design. An engine change's named behaviour does not match the code.
- **Scenario:** Section 2 says that `pass-up` stays "agent-only" (`contract.md:361`).
  E2 says that its planner keeps "refusing the owner" as it does today
  (`contract.md:1148-1149`). The planner refuses only when the holder is already the
  owner (`packages/engine/src/routing/holders.ts:108-114`), and `mayActForHolder` is
  true for the owner. `authorization.test.ts` expects `owner` and `device` to be
  allowed (`packages/engine/test/commands/authorization.test.ts:514-516,560,569`). The
  claim is right for `ask` (`routing/questions.ts:10-11`) and `wait`
  (`routing/waits.ts:183`). E2 also says that `authorization.test.ts` keeps its
  expectations, so a builder who follows the sentence breaks that test.
- **Suggested fix:** Correct both sentences. `pass-up` stays open to the owner and a
  device for an agent-held row. Add this to E28's review if the web should not have
  it.
- **Risk:** severity 2 × fallout 1 × probability 6 = **12, record.** Severity: a
  wrong sentence. Fallout: the build. Probability: a test would catch it.

### MINOR 9. Edit E19 shares the predicate, but the client's fold of its inputs has no home

- **Category:** Design.
- **Scenario:** E19 moves `settled`, `holds`, `reasonOf` and the closing rule, and it
  says that the wait "cannot disagree". Its inputs are the agents' states, the open
  rows, the deliveries and the waits. The engine computes them in
  `packages/engine/src/views/apply.ts`, including `deliveriesAfter` at l.272-295, which
  reads `AgentStarted.firstPromptDelivery`. The client must rebuild these from the
  stream, and no edit names where. A hand-written second fold can miss a case and
  disagree quietly.
- **Suggested fix:** Move those reducers to `packages/contracts`, or add a property
  test that replays a log through both folds and compares them. Criterion 3.5 is the
  natural place.
- **Risk:** severity 4 × fallout 3 × probability 4 = **48, record.** Severity: a wait
  ends wrongly and can be run again. Fallout: one owner. Probability: an uncommon event
  path.

### MINOR 10. The web server's outage events have no writer and no lifetime rule

- **Category:** Design, and Bug (timing).
- **Scenario:** The listener binds before recovery (`packages/engine/src/api/server.ts:50-52`).
  A failed bind at start-up happens before `recovery.whenReady`. E23 has only three kinds
  of batch, and it refuses a reactor's batch before ready (`contract.md:1705-1708`). So
  neither `client.WebServerDown` nor its alert has a named way in at that moment, while
  criterion 5.15 requires "one". The alert delivery worker's records have the same
  unnamed path. "One" across restarts is undefined, so a port taken for days writes one
  event per restart. The alert closes only when "the web server binds", so turning
  `enabled` off during an outage leaves the alert open for good.
- **Suggested fix:** Name the writer. Hold the first record until ready. Keep one open
  outage across restarts by a level test. Close the alert when `enabled` is turned off.
- **Risk:** severity 4 × fallout 3 × probability 4 = **48, record.** Severity: the alert
  is wrong for a while. Fallout: one owner. Probability: a taken port is one rare fault.

### MINOR 11. The rollback's step has no command

- **Category:** Design.
- **Scenario:** The rollback says, "Clear the ntfy server and topic" (`plan.md:259`). The
  access table names `carrier.set`, `set-token` and `clear-token`
  (`contract.md:1001-1003`), and no criterion clears a server. `set-token` with no server
  set has no stated result, although its event records an `origin`.
- **Suggested fix:** Let `carrier.set` take "none", and refuse `set-token` with no server.
  Add both to criterion 6.14.
- **Risk:** severity 2 × fallout 3 × probability 2 = **12, record.** Severity: an
  annoyance. Fallout: one owner. Probability: a rollback is rare.

### MINOR 12. The first-start scan cannot find a piece's open matters

- **Category:** Design. This is a hole in the fold of LOGIC-6.
- **Scenario:** The scan raises an alert "for each matter already open"
  (`contract.md:741-743`). A piece's source is "a pure function of one envelope"
  (`contract.md:680`), so it can say nothing about current state. If the board or
  roles events exist before the reactor's first start, their open matters never get an
  alert.
- **Suggested fix:** Add an optional `openMatters(view)` to each piece's alert source,
  or state that the alert reactor must first start before any piece has events.
- **Risk:** severity 4 × fallout 3 × probability 2 = **24, record.** Severity: a matter
  has no alert. Fallout: one owner, who sees it in the board. Probability: it depends on
  build order and an old log.

### MINOR 13. The lasting-setting alert goes through the setting that it reports

- **Category:** Security (integrity). The known gap is not re-filed, and its scope stands.
  This names an unaddressed consequence.
- **Scenario:** The gap says that a change raises an alert (`contract.md:732-736`). A web
  caller who changes the carrier's server gets that alert sent through the new server, so
  the owner's phone never gets it. `client.AlertSettingsChanged` and `clear-token` are not
  sources, so the same caller can turn off pushes for a kind, or remove the token, with
  no alert. The caller can also dismiss the alert, which is the alert's only end.
- **Suggested fix:** Send the alert about a carrier change to the old carrier too, while
  its token and origin remain valid. Add `client.AlertSettingsChanged` and `clear-token`
  as sources. Show undismissed lasting-setting alerts at the top of the local terminal's
  view. Under team rule 8, this can go on the owner's attack list.
- **Risk:** severity 6 × fallout 3 × probability 4 = **72, schedule.** Severity: alerts
  are silenced until the owner notices. Fallout: one owner. Probability: it needs a
  hostile or confused local caller.

### MINOR 14. Edits E4 and E23 do not say that a read's marks record the device

- **Category:** Design.
- **Scenario:** Section 2 says that the log also says which device acted. Criterion 1.11
  covers commands. The marks batch runs under "the calling caller" with no receipt
  (`contract.md:1738`), so it is not stated that `device` is written on it.
- **Suggested fix:** State it in E23's table, and add a case to criterion 1.11.
- **Risk:** severity 2 × fallout 1 × probability 6 = **12, record.** Severity: a missing
  audit field. Fallout: internal. Probability: an ordinary read.

### MINOR 15. An engine source reads current views on a replay, and E28 leaves a request with no phone answer

- **Category:** Bug (timing), and Design. These two are short and limited, so they share
  one entry.
- **Replay:** The engine's sources "read the envelope and the current views"
  (`contract.md:679`). After a restart, the reactor rescans from its position. An old
  `OwnerNeeded` with an account reason, for an account whose row was removed later, reads
  as "the agent's account has no row" and raises a false `agent-account` alert, which is
  then pushed. Fix: skip a source whose subject has already closed at the current views,
  before the raise.
- **E28, reviewed as folded:** A request whose only options are persistent leaves a web
  caller nothing to choose. The refusal's reason falls to "command refused" unless it is on
  the whitelist at `packages/engine/src/api/server.ts:41-45`, so the page cannot explain
  it. Fix: name the reason, and give the page a state for it.
- **Risk:** severity 2 × fallout 3 × probability 4 = **24, record.** Severity: a false or
  unexplained message. Fallout: one owner. Probability: one rare case for each.

## Round 1's folds, checked against the code

Each row covers a blocker or major that belongs to this lens, or that another lens filed and
this lens touches. Security transport and tooling folds were left to their own lenses.

| Round 1 finding | Fold | Verdict |
| --- | --- | --- |
| LOGIC-4, R2, C02, TM-2 (Sol) | One views value and its sequence | Holds. `apply.ts:342` carries the sequence, `Views.ts:41-44` updates by batch, and `subscribe.ts:75-89` catches up from a cursor. |
| R1, A1 | `afterCommit` stays for engine planners | Holds. `permissions.ts:49-54` still needs it. |
| LOGIC-1 | Wait-state section in the snapshot | Holds for the predicate. Its fold on the client has a gap, MINOR 9. |
| LOGIC-2, A5, R3 | `reasonOf` moves, plus a member table | Holds for the table. It lacks a precedence with the held rule, MINOR 2. |
| LOGIC-3 | Level closing table | Holds for closing. It has no way to reopen, MAJOR 5. |
| LOGIC-5, A7, R4, C07 | At-least-once delivery | The crash window holds. Exhaustion has a hole, MAJOR 3. |
| LOGIC-6 | First-start event and a scan | Holds for the engine's sources. It misses a piece's matters, MINOR 12. |
| LOGIC-7 | `sourceSequence` and a stop on a failed write | Holds for a refusal. `CommandRefused.command` is a non-empty string (`events.ts:180`). Dismiss has a hole, MINOR 1. |
| LOGIC-8 | Reactors after `whenReady`, HTTP 503 | Holds for reactors. An outage record before ready has a hole, MINOR 10. |
| TM-18 (a minor that E2 fixes) | Access check before the receipts | Holds. The receipt path also runs through `EventLog.ts:154-170`, and an existing receipt writes nothing. |
| TM-4 (Opus), TM-1 (Sol), C06 | E27 and `set-token` | The start-up half holds. The run-time half broke an engine invariant, MAJOR 1. |
| A6, C03 | Size budgets and a marker | The budgets hold. The state-bearing events have a hole, MAJOR 4. |
| A2, C04 | E24 | Holds. `client/src/index.ts:217-220` is the one place that sends every stream to one helper. |
| A3, C05 | E25 | Holds for this lens. Persisted decoding stays strict. |

## Edits E1 to E28, checked against the board and roles plans

| Edit | Against consumers and code | Result |
| --- | --- | --- |
| E1, E3, E4 | The board's and roles' planners and reads fit the tables | Nothing found. |
| E2 | Code at `CommandHandler.ts:70,238,264` | The move holds. The `pass-up` wording is wrong, MINOR 8. |
| E5, E6, E7 | `apply.ts`, `migrations.ts` entries are append-only | Nothing found. |
| E8, E9 | `server.ts:155-159` | Nothing found for this lens. The request's row shape is MAJOR 4. |
| E10, E11, E13 | `resume.ts:46`, `reload.ts:124,134,138` | Nothing found. E13 names the actor's later writes correctly. |
| E12 | `server.ts:119-127` | The recheck's removal leaves MINOR 5. |
| E14 | Roles `:990-992,1064` runs the answer after commit | Nothing found. No conflict. |
| E15 | Grep shows the sender and caller uses at the sites named, and the rest are owner constants (`crash.ts:75`, `reload.ts:96`, `available.ts:52`, `waits.ts:65`) | Holds, including "three fields". |
| E16 | `deliveries.ts:24,73-77`, Board `:369-374` | MINOR 7. |
| E17 | Board's withdrawal, `reload.ts:86,98` | MAJOR 2. |
| E18 | Board `:154-160`, `deliveries.ts:217-263`, `readyAfter` at l.269-280 has no withdrawn case | MAJOR 2, and the post-build check PC-2. |
| E19 | Inputs against `apply.ts` | MINOR 9. |
| E20 | Board's condition (L22) | Nothing found for the engine's wait. The owner's form is MINOR 2 and MINOR 3. |
| E21 | `threadAgent` at `apply.ts:122-123`; the backfill matches it | Nothing found. |
| E22 | Roles' `release` at `:1066` needs `mayActForHolder` and `holderAbove` | Nothing found. |
| E23 | Board's `board.WakeBuilt` | MINOR 4 and MINOR 14. |
| E24, E25, E26 | `client/src/index.ts:185-220` | Nothing found for this lens. |
| E27 | `SecretStore.ts`, `accounts.ts:38-50` | MAJOR 1. |
| E28 | Reviewed as folded, per the instruction | MINOR 15. Its pendency is not filed. |

No named existing test is missing for a behaviour that an edit declares. The missing tests
are for the behaviours in MAJOR 1 and MAJOR 2, which the edits do not declare.

## Answers to the task's questions

- **Does each fold hold?** Most do. The tables above give each one, and five have the holes
  filed here.
- **Did a fold break something else?** Yes, one: E27's run-time collection, MAJOR 1. Separately, E18 creates a new way into a stuck
  state, MAJOR 2, which round 1 did not reach.
- **What did round 1 not reach?** The recovered send path, the resume path of an alert, the
  combination rule of the filter, and proxy changes on open connections.
- **Are the engine's changed behaviours named, and their tests?** The tests named exist where I
  checked. E2's `pass-up` sentence is the one wrong claim about today's code, and E27's "none for
  accounts" and E18's scope understate the effect, as filed.
- **Are there anchors that do not resolve?** I found none. `commands/SecretStore.ts:13-15`,
  `CommandHandler.ts:45-48,70,207,238` and `server.ts:119-127,163-165` all resolve.

## Proposed post-build checks

| ID | Scenario | Expected result | Evidence needed |
| --- | --- | --- | --- |
| PC-1 | Reload an agent whose only requeued delivery fails reach at send time. | The agent ends idle, and a wait on it closes. | A recovery test on real events, and the final state in the views. |
| PC-2 | Queue three deliveries, with the first failing reach, in one send pass. | The first is withdrawn, the second is sent, and the third stays queued. The loop reads the projected snapshot, because the views do not update until commit and `readyAfter` has no withdrawn case. | The log's order, and the runner's call record. |
| PC-3 | Run the delivery worker when the log writer has latched, after the carrier accepted a send. | The worker stops without a tight resend loop. | The fake carrier's request count, and the log's last write. |
| PC-4 | Run the first-start scan on a log with an open crash and a future `resetAt`. | The `crash:` key matches the original, and the account's reset time is honoured. | The baseline alerts, compared with the views. |
| PC-5 | Run token removal against concurrent `set-secret` and `set-token` commands, 1,000 times. | No committed reference is ever without a value. | The store's contents after each run. |
| PC-6 | Replay a real log through the client's fold and through `apply`. | The wait inputs are equal at every sequence. | A property test's comparison. |
| PC-7 | Run the filtered stream through every row of the filter table, on live and catch-up paths. | Each row gives its stated result, and the cursor passes every skipped event. | The frames received, and the last cursor. |
| PC-8 | Clear an alert while its send is in flight. | The phone's copy goes, or the record says that `clear` ran before the send completed. | A fake carrier's order of requests. |

## Noted, not filed

- The board's header says version 7, and the task calls it version 8. Its body has the round 4
  fold, and it has no `ownerHeld` list yet. I treated this as lag.
- The wording of `roles.rules.add` in the roles plan lags behind this contract. I treated this as lag.
- A stale open request after `stop` keeps `settled` false. This is an existing engine behaviour.
  MINOR 2 covers the part that this contract adds.
- An interrupted agent that cannot be reloaded raises no alert. This is existing behaviour, with
  the comment "nothing tells the owner" (`restart.ts`, in `interrupt`).
- A reactor's position advances only on its own events, so a restart rescans from the last one.
  This costs time only, because the sources must be safe to run twice.
- A piece's alert keys are not namespaced, such as `post:<id>`. Kinds are, so a collision needs a
  careless piece. A test could enforce it.
- E28's planner refusals hold receipts under the owner's key. Random request ids make this harmless.
- Library and ntfy claims were left to the architect lens, so I made no such claim here.
- Owner question 6 is pending by instruction, and I filed nothing about that.
