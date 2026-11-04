revise
Grade: 6  B/M/m: 0/3/5  Flags: none

# Plan review of `shepherd-client-api`, round 3, lens: logic and failure policy

This review covers client API contract version 10, the fold of round 2. Engine
paths are relative to the repository at commit `8ff4c9b`. `contract.md` and
`plan.md` are the files beside `attack/`. "Board" means
`inputs/board-contract.md`, and "roles" means `inputs/roles-plan.md`. "Effect"
means the installed 4.0.5 source, at
`node_modules/.pnpm/effect@4.0.5/node_modules/effect/src/` in the main checkout.

I read code and ran nothing. The task's checkout is read-only, and no finding
rests on a test run.

## Summary of the verdict

The folds of round 2 hold against the code, and I found no blocker. The delivery
generation, the start-up-only collection, the marker rule and the withdrawal rule
each do what their rows say.

Three majors remain, and earlier rounds did not reach them:

1. The five-second acknowledgement deadline shares one socket with large replies,
   so the marker recovery can loop for ever on a slow phone.
2. The owner's wait is promised "after every batch", but the stream shows no
   batch, so the wait can end on a state that never existed.
3. The pieces' pure functions run inside the engine's core with no failure policy,
   so one thrown error can stop every command and prevent a restart.

All three score in the "schedule" band, because each needs a specific condition.
The owner decides what to do with them, as the lead's round 2 rule says.

## Findings

### MAJOR 1. The acknowledgement deadline shares a socket with large replies, so marker recovery can loop for ever

- **Category:** Bug (timing, failures). Design, because the contract's reasoning is
  wrong about the transport.
- **Where:** `contract.md:522-524` (the five-second rule), `contract.md:1130-1149`
  (the marker rules), row 137, and `plan.md:553` (unit 5.1 copies `boundedProtocol`).
- **What the contract assumes:** Section 5 says a chunk with a five-second
  acknowledgement cannot carry a very large event to a slow phone, so the event
  becomes a marker. It then says that "a reply to `client.event` is one item, sent
  whole, and is not a stream chunk" (`contract.md:1148-1149`). Row 137 gives this
  as the reason the read is safe.
- **Why that is not enough:** The reply and the stream's chunks use one WebSocket.
  - The deadline starts when the server hands a chunk to the socket
    (`packages/engine/src/api/server.ts:136-140`).
  - The client acknowledges a chunk only after it has received and decoded that
    chunk (Effect `rpc/RpcClient.ts:577-581`).
  - One socket delivers frames in order, so a chunk sent during a large reply
    arrives after that reply.
  - A missed deadline closes the whole connection, not one stream
    (`server.ts:143-145`, l.169). The reply in flight dies with it.
- **Scenario:** A phone has a 1 megabit per second link, and agents are writing
  events.
  1. A lead starts a worker with a 1 MiB first prompt, so `AgentStarted` arrives
     as a marker.
  2. The client library calls `client.event`. The reply takes about 8 seconds.
  3. The next stream chunk goes out behind it, and its deadline passes at 5 seconds.
  4. The server closes the connection, and the read fails.
  5. The contract's rule says to reconnect from before the marker
     (`contract.md:1145-1146`), so the same steps repeat.
- **Result:** The cursor can never pass that sequence. The page stays frozen, and
  a new permission request never appears on it. The rule "a marker never costs a
  client its state" fails in the case it was written for.
- **How slow a link is affected:**

  | Reply on the shared socket | Size | Link at which it passes 5 seconds |
  | --- | --- | --- |
  | A `board.read` page | 512 KiB | About 840 kilobits per second |
  | A `client.thread` page | 900 KiB | About 1.5 megabits per second |
  | A `client.event` reply | Not capped (`contract.md:1120-1122`) | 5 MiB needs about 8.4 megabits per second |

  The 256 KiB marker limit implies a floor of about 420 kilobits per second. Every
  row above breaks that floor. A thread page or a tapped placeholder fails the
  same way, though it costs only that one read.
- **A related gap:** The contract bounds an event, not a chunk. A live chunk is
  whatever has queued (Effect `Channel.ts:1471-1474`, through
  `log/subscribe.ts:94`), and the server holds the next chunk until the last is
  acknowledged (Effect `rpc/RpcServer.ts:443-448`). So events queue during a wait,
  and the next chunk can hold many events of up to 256 KiB each. This one recovers,
  because catch-up sends one event per chunk (`log/subscribe.ts:89`, Effect
  `Stream.ts:2228-2230`). It still costs a reconnect, and criterion 2.6 does not
  measure it.
- **Evidence status:** Confirmed by reading the code. Criterion 7.14 uses real
  frames but no throttled link, so it would pass.
- **Suggested fix:**
  - Give the page two WebSockets: one for `client.subscribe`, and one for reads.
    The read socket carries no chunks, so it has no acknowledgement deadline. The
    stream socket then carries only frames within the budget.
  - Count both sockets in the connection cap, and keep the heartbeat on each.
  - Close a live chunk at 256 KiB of encoded events, with at least one event.
  - Extend criterion 7.14 with a throttled link, such as 500 kilobits per second, a
    1 MiB state event and live events flowing. The page must converge.
  - State the remaining limit: an event large enough to miss two heartbeats on the
    read socket is still unreadable on that link.
  - A simpler option is to serve `client.event` and page reads over plain HTTP.
    Decide that with the later pairing plan's credential in mind.

### MAJOR 2. The stream shows no batch, so the owner's wait can end on a state that never existed

- **Category:** Bug (timing). It is also a conflict between contract v10 and the
  roles plan.
- **Where:** `contract.md:703-710` ("the helper applies its part of this rule after
  every batch it applies"), `contract.md:695-701` (exit 2 at once), and
  `contract.md:1869-1872` (the fold, tested "at every sequence").
- **What is true of the engine:** The engine judges a wait on a batch's whole result
  (`routing/waits.ts:110-120`). A batch reaches the views whole
  (`log/EventLog.ts:245-266`, `views/Views.ts:44`).
- **What the client can see:** The client has no boundary to work with.
  - Catch-up emits one event per chunk (`log/subscribe.ts:89`), and its pages can
    split a batch (`PAGE_SIZE`, l.53).
  - An envelope's `requestId` does not mark the end of a batch. The helper cannot
    know a batch has ended until a later event arrives, which may never happen.
  - The roles' standing-rule answer is a second write with its own caller, in the
    same transaction (roles l.1036-1042, criterion 7.2).
- **Three states that exist only inside a batch:**

  | Batch | The state inside it | Wrong result | Saved by the list read? |
  | --- | --- | --- | --- |
  | A reload of a mid-turn agent: `SessionOpened`, `DeliveryQueued` (carry-on), `StateChanged working` (`recovery/reload.ts:92-98`) | After `SessionOpened`, the agent is idle with nothing queued (`stateMachine.ts`, `SessionOpened`: `starting` to `idle`) | Exit 0, "settled", while the agent is mid-turn | Only if a piece offers lists |
  | A wait closes and wakes its waiter: `WaitSatisfied`, then `DeliveryQueued` (`routing/waits.ts:93-95`) | The waiter has no open wait and no queued wake | Exit 0 on a waiter about to work | Only if a piece offers lists |
  | A standing rule answers: `PermissionRequested` with holder owner, then `PermissionAnswered` (roles 7.2) | An open row that the owner holds | Exit 2 at once, with nothing for the owner to answer | No |

- **Why the existing read does not close this:** The rule in `contract.md:741-746`
  has the helper read the piece's lists when the engine's part says settled. That
  read returns a sequence at a batch's end, so the helper catches up and decides
  again. This saves the first two rows once the board exists. It does not save them
  in the release before the board, when every table entry is "never" and no piece
  has lists. It never saves the third row, because the exit-2 path reads nothing
  when the engine's rows decide it.
- **The roles' conflict:** Roles l.1041-1042 promises that "the request never counts
  as held" for a rule-answered request. That holds for an agent's wait. It does not
  hold for the owner's wait, when the waited agent's holder is the owner.
- **Evidence status:** Confirmed by reading. Criterion 3.5 replays a log by sequence
  and would not catch it, and criterion 3.6 tests no such batch.
- **Suggested fix:** State one gate.
  - Before the helper ends a wait for any reason (settled, resolved or owner-held),
    it reads something at sequence L, where L is at least the stream's sequence S.
    It applies the stream up to L and decides again.
  - The read is the piece's lists when a piece has them. Otherwise it is a small
    read that returns the views' sequence, or `client.snapshot`.
  - Views publish whole batches, so L is always at a batch's end.
  - This adds no timer and no polling, because a read happens only at a candidate
    result. It widens lead ruling 6's sequence rule to exit 2, so name that in a
    decision row.
  - Add three tests with real frames, one for each row of the table, including a
    catch-up page that splits a batch.

### MAJOR 3. The pieces' pure functions run inside the engine's core with no failure policy

- **Category:** Bug (failures). Design, because a failure policy is a pre-build
  decision.
- **Where:** Section 1 defines a defect only for a reactor (`contract.md:228-230`).
  Nothing covers a piece's view reducer (`contract.md:190-193`, edit E6), its reach
  check (E18), its hold-unsettled and request-held conditions (E19, E20), its source
  rule (E16), its secret keep list (E27), its alert source or its `openMatters`.
- **What the engine does today:** Its own functions are total by design.
  - `views/apply.ts:336-337` says "Pure and total", and `views/Views.ts:15-17` says
    a defect in `apply` is a defect and never a failed append.
  - That was safe while one team's reviewed code filled these places.
  - Later plans now add code to them, and the contract states no rule.
- **What happens if one of them throws:**

  | Function that throws | Where it runs | Result |
  | --- | --- | --- |
  | Hold-unsettled or request-held condition | `withWaitChecks`, in nearly every write (`CommandHandler.ts:148`, l.269) | While the state lasts, every command fails, `stop` included. Runner events are dropped (`CommandHandler.ts:174-176`), so a permission request from an adapter is lost. |
  | The same condition, at restart | `reevaluate` runs `withWaitChecks` before `ready` (`recovery/restart.ts:266-270`, l.294-295) | Recovery does not finish, so the socket stays at "recovering" (`server.ts:99`). |
  | A piece's reducer | `apply`, after COMMIT (`log/EventLog.ts:136-140`), and in `rebuild` (`views/rebuild.ts:36`) | The event is committed, so the live views stop matching the log. The next start fails while rebuilding, and it fails the same way every time. The log holds a poison event, and only a code change gets the engine running again. |
  | Reach check, at send time | Inside the send transaction (E18) | The head delivery is never sent or withdrawn. `dispatchCommitted` logs a warning (`routing/deliveries.ts:304-306`), so the target's whole queue is stuck. |

- **Scenario:** The board's hold condition looks up a delivery status, as board
  l.416-420 says it does. One malformed or unexpected row makes it throw on a
  `.status` of `undefined`. From then on, no command runs, and a restart does not
  help.
- **Precedent:** Roles criterion 7.2 already wraps its matcher: "the engine calls it
  as a total function, so an error or a malformed result is logged without request
  content and treated as no match". The same rule belongs in the contract, for every
  table.
- **Evidence status:** The paths are confirmed by reading. No such defect exists yet,
  because the functions are not written. So the probability is low, and the
  consequence is a total outage with no way out but a code change.
- **Suggested fix:** In unit 1, every per-piece table call goes through one wrapper
  that logs with no event text and returns a stated fallback. The fallback is the
  refusing form:

  | Table | Fallback on a thrown error |
  | --- | --- |
  | Reach check | Refuse, so at send time the delivery is withdrawn and the queue goes on |
  | Hold-unsettled | Holds, so the agent is not settled |
  | Request-held | Does not hold |
  | Source rule | Withdraw |
  | Secret keep list | Skip collection at this start, so nothing is deleted |
  | `snapshotFor` | The section is left out, with a mark |
  | Alert source, `openMatters` | Nothing raised |
  | View reducer | The piece's view stays as it was |

  A reducer's fallback is deterministic, so a live fold and a rebuild still agree.
  Add a fixture piece that throws from each table, and show that the engine still
  runs commands, restarts, and passes the rebuild check.

### MINOR 1. An agent may call `client.subscribe` but not `client.event`, so a marker can loop

- **Category:** Bug (failures).
- **Where:** The access table gives `client.subscribe` to agents
  (`contract.md:1178`), and `client.event` to the owner, devices and services only
  (`contract.md:651`, l.1179).
- **Scenario:** A parent starts a child with a 300 KiB first prompt, then runs
  `shephrd client subscribe` with its agent token. The child's `AgentStarted` is
  visible to the parent, and it arrives as a marker. It is state-bearing, so the
  client library reads it with `client.event`. The read is refused, and the rule says
  to reconnect from before the marker (`contract.md:1145-1146`). The agent never gets
  past that sequence.
- **Limit:** A stream is never an MCP tool, and the roles plan does not use this. So
  it needs an agent using the command line directly.
- **Suggested fix:** Give `client.event` agent access under the same read rule, inside
  the data envelope, as `client.thread` does. Or, for an agent caller, move the cursor
  past the marker and point at `client.thread`. Add the case to criterion 3.8.

### MINOR 2. The old-carrier alert contradicts the rule that the carrier resolves only the active token

- **Category:** Design.
- **Where:** `contract.md:841-846` sends the alert "with the previous token".
  `contract.md:1026-1028` says "The carrier resolves only that name", with a boundary
  test. `contract.md:1049-1050` says the token is sent only when its recorded origin
  equals the current server's. Criterion 6.13 tests the second rule, and criterion
  6.17 tests the first.
- **Scenario:** A web caller moves the carrier to another origin.
  - The same batch clears the token, so the old name is no longer the active one.
  - Under `contract.md:1026-1028`, the carrier cannot resolve it, and the alert goes
    with no token.
  - `contract.md:1075-1078` advises a deny-all server, so that send fails every time,
    even with no restart. The known gap blames only a restart.
- **Also unstated:** `contract.md:956-957` says a cleared alert is not sent. If that
  applies here, the caller being watched can dismiss the alert and stop the retries
  to the old server.
- **Suggested fix:** Name the one exception. For this alert only, the carrier may
  resolve the name just cleared, and it sends that value only to the origin in that
  value's `AlertCarrierTokenSet`. A dismiss does not stop these attempts. Change the
  boundary test and criterion 6.13 to allow exactly this path.

### MINOR 3. After a stop and a resume, a stale request ends every owner's wait, with no alert

- **Category:** Bug (failures). This names a consequence of a stated gap and does not
  re-open it.
- **Where:** `contract.md:721` (a live member with an owner-held row exits 2 at once),
  `contract.md:915-917` (the row is "meaningless", and no alert returns), and row 146.
- **What the code does:** `stop` writes no `PermissionCancelled`
  (`commands/stop.ts:10-16`), and issue 74 records that as open. `crashEvents` and
  restart do cancel (`recovery/crash.ts:58-63`, `recovery/restart.ts:127-131`), so
  the only source of a stale row is a stopped asker.
- **Scenario:** The owner stops a worker that is waiting on an approval, then resumes
  it. The alert closed at the stop and does not return. The row stays open and the
  owner holds it, so `shephrd client wait` on that worker exits 2 at once, every time.
  The engine's own `settled` is also false for ever (`routing/waits.ts:42`), so a
  parent's wait on that worker hangs.
- **Why row 146 does not cover this:** Its reason protects only a stopped member.
  Once the member is live again, the same row ends every wait.
- **Suggested fix:** Since the owner's rule is to edit the engine, make `stop` write
  `PermissionCancelled` with a withdrawal for the asker's open requests, as a crash
  does. That removes the stale row, simplifies the closing table and the held-rule
  table, and closes this part of issue 74. Test `failure-4-no-answerer.test.ts:71`
  stops a holder, not the asker, so it keeps its expectations. Name any test that
  stops an asker with an open request.

### MINOR 4. The snapshot's display part is not bounded by construction

- **Category:** Design.
- **Where:** `contract.md:473-477` claims "at most 4 KiB", and lead ruling 8 asks for a
  bound by construction, not by a fixture.
- **The gap:** It cuts the preview and each option's name, but not the option's `id`,
  its `kind` or `toolKind`. All three come from the adapter. `AcpRunner.ts:405-407`
  only redacts them, and `kind` is any string (`packages/contracts/src/permission.ts:18-19`).
- **Suggested fix:** Show a `kind` or `toolKind` outside the known list as "unknown".
  Leave out any option whose id is over 128 bytes, and count it as not shown. The page
  already reads the whole event before an answer. Add one case to the snapshot's test.

### MINOR 5. The withdrawal rule leaves out the engine's own withdrawals

- **Category:** Bug (timing).
- **Where:** `contract.md:1800-1809` fixes a withdrawal by a piece or by the dispatcher.
  It also says "the engine's own withdrawals ... are unchanged".
- **Scenario:** A holder's routed question delivery was sent but not accepted, so a
  reload requeues it and writes `working` (`recovery/reload.ts:84-86`, l.94, l.98).
  Before the head is sent, the owner answers the question. `answerQuestion` withdraws
  the delivery (`routing/questions.ts:27`, `routing/holders.ts:62-67`). The holder is
  now `working` with nothing to send, which is the hang that row 143 closed for pieces.
- **How likely:** The window is short, unless the account is signed out, because
  `ready` then holds the send (`routing/deliveries.ts:233`). This exists today and is
  not new. Row 143 now has a rule that could cover it.
- **Suggested fix:** Apply the reloaded-state rule to any batch that holds a
  `DeliveryWithdrawn`, in one place, so that later plans inherit it. Add one test to
  criterion 1.43.

## The folds of round 2, checked

| Finding and row | Does the fold hold? |
| --- | --- |
| R2-L1, the blocker, and the three majors with it, row 130 | Holds. Collection stays in recovery (`recovery/restart.ts:288`). The narrow removal cannot name an account's secret. A rotation has a fresh name, and `secrets.json` is rewritten under one semaphore (`accounts/SecretStore.ts:38-64`). The dots in the name also keep it out of `account.secret`, because `SecretReference` refuses them (`contracts/src/accounts.ts:4`), so the planner's refusal is needed only for `environment`, as written. |
| R2-A2, R2-L3, R2-TM-2, Opus major 3, row 131 | Holds. I walked a carrier change, a token change, a change of origin with both events in one batch, a late result, and a carrier set to "none". Each ends in the stated pending state. The one problem is MINOR 2. |
| TM2-1, row 132 | Holds. Redaction comes before the cut, so a secret is not left half visible. Roles criterion 2.6 refuses a redacted or cut input, so a cut command cannot match a prefix rule. Existing runner tests use `toMatchObject` or field checks (`runner/permission-hold.test.ts:73`, `runner/hardening.test.ts:135`), so the new optional fields break none. |
| TM2-2, TM2-3, rows 133, 134 | Holds, in my walk of the truth table. A peer matching `proxyUserId` with no forwarded address is refused. A forged header with proxy mode off refuses only the forger. |
| R2-A3, row 136 | Holds. The scan and the first-start event are one batch. Its position is the views' own head. A close after the scan is a later event. |
| C2-01, R2-L2, Opus major 4, row 137 | Holds in its logic. MAJOR 1 is the transport hole beneath it, and MINOR 1 and MINOR 4 are its smaller gaps. |
| C2-02, row 138 | Holds. The planner runs in the writer transaction, so it knows the head, and a failed write latches the writer. So a name cannot be reused before start-up collection removes it. |
| C2-03, row 135 | Holds for its stated case, a working member that posts to the owner. MAJOR 2 is the wider problem. |
| Opus major 2, row 143 | Holds. `failed` already writes the same `StateChanged idle` (`routing/deliveries.ts:133`), and `readyAfter` then dispatches (l.277). The rule needs the agent's state to be `working`, because `reloaded` reads only the thread (l.222-227). Criterion 1.43's wording covers that. MINOR 5 is the case left out. |
| Opus major 5, row 144 | Holds. Questions survive a crash (`recovery/crash.ts:58-63` cancels only requests). A failed reload leaves `interrupted`, and the question's alert stays open, which is right. MINOR 3 is the request's side. |

## Edits E1 to E29, checked against the board and the roles

| Edits | Result |
| --- | --- |
| E2, E3 | Moving the check before the receipts works. An agent's repeated refusal finds its receipt in `commit` (`EventLog.ts:157-170`), so it writes nothing twice. A device's refusal with no receipt leaks nothing: an owner receipt with another body gives "request id reused", which reveals only that the id exists. |
| E5, E23 | `DeliveryQueued` is `invalid` for a crashed or stopped target (`stateMachine.ts`), so one stopped addressee refuses a whole batch. The board must queue wakes only for live addressees. It builds its wakes in the batch, so it can. This is a check for the board's own review. |
| E6, E18 | `project` uses a placeholder envelope with caller owner and time zero (`routing/waits.ts:28-31`). The board's `author` is a field of its event (board l.208), so its reach check is not misled. See "Noted, not filed". |
| E8 | The read rule matches `holderAbove` and `available` (`routing/holders.ts:14-32`). |
| E12, E28 | The truth table is complete for the four known kinds, an unknown kind and either flag: `permissionForOptionKind` treats any unknown kind as persistent (`contracts/src/permission.ts:18-19`). |
| E15, E16, E17 | The three sender fields are the only ones, and `returnTo` already sends nothing more for a non-agent sender (`routing/deliveries.ts:47`). |
| E19, E20 | The member table matches `reasonOf` row by row (`routing/waits.ts:49-59`). An older list read cannot strand the helper, because the event that made it older already triggered another read. |
| E21 | The backfill rule equals `threadAgent` for every engine tag (`views/apply.ts:122-123`, `EventLog.ts:175`). |
| E27 | Named tests exist: `restart.test.ts` 6.7 R22 is at l.606-626. |
| E29 | `Roles` needs `execute` fields only, and gets a superset. The board needs nothing from it. |

**A real conflict with what the others need:** one, in MAJOR 2, with the roles' promise
at l.1041-1042. Other differences I saw are the lag the lead's ruling excludes, such as
board l.416-420 still reading deliveries by delivery id after row 147 and board l.441-442
still stating the older read rule.

**Existing tests:** Every test path named in section 6 exists, except the ones the
contract names as new. I spot-checked for unnamed breakage around E2, E11, E15, E21, E27
and E29, and I found none. I did not trace every test for every edit. The `SELECT *` uses
in `transaction-receipts.test.ts` and `lifecycle.test.ts` are worth a look when E11 and
E21 add columns, and only a build can settle that.

## Risk register

Each band is my proposal. The owner sets each decision.

| Id | Description | Severity | Fallout | Probability | Score and band | Status | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MAJOR 1 | A large reply on the shared socket closes the connection, and marker recovery loops | 5: the page is frozen on that link, and it recovers on a better one | 3: one person, undone by a better network | 6: a slow phone, active agents and one large event or page | 90, schedule | Confirmed by reading | Client API, units 5 and 7a |
| MAJOR 2 | The owner's wait ends on a state inside a batch | 4: a wrong exit, and a re-run fixes it | 3: one person | 6: a resume or a wake during an owner's wait | 72, schedule | Confirmed by reading | Client API, unit 3 |
| MAJOR 3 | A thrown error in a piece's function stops the engine, and a reducer's stops every start | 6: the core feature is down until fixed by hand | 5: needs a code fix | 2: needs a defect in reviewed, pure code | 60, schedule | Paths confirmed, defect hypothetical | Client API, unit 1 |
| MINOR 3 | A stale request after a stop and resume ends every owner's wait | 4: wrong until the owner answers the row | 3: one person | 6: an ordinary stop and resume | 72, schedule | Confirmed by reading | Client API, unit 1 |
| MINOR 1 | An agent's marker over a state-bearing tag loops | 4: one stream stuck | 3: one person | 2: an unusual setup | 24, record | Confirmed by reading | Client API, unit 3 |
| MINOR 2 | The old-carrier alert cannot use its token | 4: the alert does not arrive | 3: one person | 2: a web caller's change on a deny-all server | 24, record | Confirmed by reading | Client API, unit 6 |
| MINOR 5 | An engine withdrawal strands a reloaded agent | 4: stuck until a stop and resume | 3: one person | 2: a short window, or a signed-out account | 24, record | Confirmed by reading | Client API, unit 1 |
| MINOR 4 | The snapshot's display part has unbounded fields | 2: a larger reply | 3: one person | 2: an unusual adapter | 12, record | Confirmed by reading | Client API, unit 3 |

MINOR 3 scores above MAJOR 3 on purpose. I label by consequence and score by likelihood,
as `rules/finding-labels.md` and `rules/risk-score.md` say.

## Proposed post-build checks

| Id | Scenario | Expected result | Evidence needed | Area |
| --- | --- | --- | --- | --- |
| R3-PB-1 | From a real phone on a throttled link, 500 kilobits per second, with agents writing, open a 900 KiB thread page and hit a 1 MiB state event | Both finish, with no reconnect loop | A browser trace and the server's connection log | Web server |
| R3-PB-2 | Reconnect a page after an hour asleep, on a busy log | It catches up, or it says it should take a new snapshot. Catch-up costs one round trip per event, and the 2,048 backlog rule may close it repeatedly | The time to catch up, and the count of reconnects | Client library |
| R3-PB-3 | Send a carrier change with 500 open alerts | Retries converge at the cap, with no event burst beyond one per attempt. PB-8 covers the rate limit and not this count | The log's event count | Alerts |
| R3-PB-4 | Run the fixture piece that throws from each table on a copy of a real log | Commands, restart and the rebuild check all pass | The test's output | Engine |

## Answers to the task's questions

- **Does each fold of round 2's blocker and majors hold, and did any break something
  else?** Each holds. None broke an earlier rule. The table above gives the checks,
  and MINOR 2 is the one contradiction a fold introduced.
- **What did earlier rounds not reach?** MAJOR 1, MAJOR 2 and MAJOR 3.
- **Do E1 to E29 meet the consumers' needs?** Yes, except MAJOR 2's conflict with the
  roles.
- **Are the plan's changes to existing behaviour true of the code, and are the tests
  named?** Those I checked are true, and the named tests exist. The limit is stated
  above.
- **Do the SECURITY.md and AGENTS.md changes raise a logic issue?** I found none under
  this lens. I read the contract's list of exceptions (`contract.md:284-297`), and I
  did not review `inputs/security-agents-changes.diff` line by line, because the task
  says the owner approved those changes in the design talk.
- **Refusals:** none.

## Noted, not filed

- **A disclosure about isolation.** While I searched the attack folder for earlier
  discussion, a grep printed one line of `attack/round-3-logic-sol.md`, a file another
  reviewer was writing at the same time. It mentioned a filtered stream's recovery that
  an allowed caller cannot perform, and evaluation after a batch. I did not open the
  file. I had already reasoned out both points in my own working by then, and I wrote
  them up from the code. Treat MINOR 1 and MAJOR 2 as weaker evidence of independent
  convergence than usual.
- **Placeholder envelopes.** `project` gives a piece's reducer the caller owner, no
  device and time zero (`routing/waits.ts:28-31`). A reducer that read those on a
  projection would be wrong, and a reach check on it could permit too much. The board
  keeps `author` in its event, so nothing fails today. One sentence in E6 would make it
  a rule: a piece's reducer reads the event and the sequence only. Round 1 noted this
  too.
- **The filter and pieces' events.** An event in no thread passes every agent and group
  filter (`contract.md:518`). So a phone that filters to one agent still gets every
  board post and every alert delivery record. It can narrow by kinds only by listing
  all the kinds it wants. Row 148 gave accounts as its reason, and pieces' events were
  not weighed. It costs traffic and loses nothing.
- **A service's access refusal.** E2 states what an agent's and a device's refusal write,
  and not a service's. E13's "everything else is refused" covers the outcome.
- **A late send after a clear.** A send in flight when an alert clears can land after
  `clear` runs, so a stale notification can stay on the phone. The contract already says
  a clear proves nothing.
- **Two alerts for one change.** A web carrier change to another origin raises one
  `client.lasting-setting` alert for each of its two events. That is noisy, and harmless.
- **The stale `reloaded` read.** A signed-out account already holds a reloaded agent at
  `working` with no later dispatch, even with no withdrawal (`routing/deliveries.ts:233-234`,
  `accounts/available.ts:42-47`). This is an engine gap beyond this plan, and it may
  deserve an issue.
