# Round 2: logic and failure policy review of plan-v2

Reviewer seat: logic and failure policy (isolated, round 2).
Target: `attack/plan-v2.md` (decisions.md rows 20 to 48 appended at lines 761 to 789).
Context: `docs/specs/2026-11-01-engine-design.md`, section "Changes after the plan review (2026-11-01)" (lines 452 to 554), which wins over earlier sections.
Scope: the round-1 patches (rows 20 to 48 and the criteria they produced) and the mechanisms marked UNREVIEWED MECHANISM in `round-1-findings.md`. Known gaps 1 to 8 are not re-reported.

Abbreviations: ACP is the Agent Client Protocol; MCP is the Model Context Protocol.

Line numbers below refer to `attack/plan-v2.md` unless a file is named. "Row N" is decision N in the appended log. "Spec" means the design document.

## Verdict

**REVISE.** The shape of every patch is right, but the definitions that make them work are incomplete, and several patches interact badly with each other at restart time.

The top finding is that "settled" (row 25) counts only *queued* deliveries. Row 29 then splits a delivery into queued, sent and accepted. Between "sent" and "accepted", and between a mid-turn agent's reload and its carry-on prompt, the member is idle with nothing queued. Because row 25 re-checks waits inside every event's transaction, the wait resolves early in exactly the multi-level flow the patch was written to fix.

No finding is a BLOCKER. Eleven are MAJOR, and the rest are MINOR.

---

## Findings

### F1 (MAJOR). "Settled" has three early-wake gaps

Evidence: row 25 (line 766) defines settled as "idle, with no open waits, requests, questions or queued deliveries". Row 29 (line 770) makes "queued", "sent" and "accepted" three separate steps. Row 25 also says each wait "is checked ... in the same transaction as every event that can resolve a member". Row 24 (line 765) does not say when an agent's lifecycle state moves from idle to working.

Three moments satisfy the predicate as written while the agent still has work in hand:

1. **Sent but not accepted.** When the engine writes "delivery sent" for an idle agent, the delivery has left the queued step. If the state only becomes working at "turn started" or at "accepted", the agent is idle with nothing queued for that one transaction, so a wait on it resolves. This is the orchestrator → lead → worker flow: the lead's wake delivery is sent, and the orchestrator is woken before the lead has read it.
2. **Reload before carry-on.** Row 31 (line 772) reloads sessions in step 6 and sends carry-on prompts in step 7. If the reload event returns a mid-turn agent to idle and the carry-on is queued in a later transaction, the re-check at the reload event finds it settled.
3. **Start with a first prompt.** The plan never says how a first prompt given to `start` is recorded. If "session opened" moves the agent to idle before the first prompt is queued as a delivery, a lead that called `start` and then `wait` is woken before the worker has done anything.

Fix: define settled as "idle with no delivery that is not yet accepted". Move the lifecycle state to working when "delivery sent" is written. Queue the first prompt as a delivery inside the "agent started" transaction. Make the reload event for a mid-turn agent queue its carry-on (or mark its unaccepted delivery for re-send) in the same transaction. Add all three cases to criterion 5.8 (line 434).

### F2 (MAJOR). A wait opened during a compact turn never resolves

Evidence: row 25 excludes "a compact turn" from settled. Row 24 allows `compact` only on an idle agent.

A natural pattern is: the parent compacts a lead, then waits on it so that it can prompt it afterwards. The wait opens while the compact turn is running, so the member is working. When the compact turn ends, the end is excluded, so the member does not resolve. No later event concerns that agent, so the wait never wakes. Recovery's re-check (row 31, step 8) cannot be relied on either, because it is unclear whether "not a compact turn" is a fact about the last event or a fact about the state.

Fix: define settled as a predicate on the current state only, and record on the "turn ended" event whether it was a compact turn. A compact turn's end restores whatever settled status the agent had before the compaction. Add "compact, then wait" to criterion 5.8.

### F3 (MAJOR). Settled ignores requests the member holds, so a worker can stall silently

Evidence: row 25 counts the member's *own* requests and questions. Row 27 (line 768) makes any idle ancestor a valid holder.

Take a lead L that is delivered its worker W's permission request and ends that turn without calling `answer` or `pass-up`, which agents often do. L is idle, so it stays the holder under row 27, and nothing moves the request. L is also settled, so the orchestrator's wait on L resolves and reports L as finished. W is held forever, and the owner is never alerted, because the owner never became the holder.

Fix: settled also requires that the member holds no open request or question. When a holder ends the turn in which a request was delivered without answering it or passing it up, the engine passes it up automatically in the "turn ended" transaction. Test both in criteria 5.6 and 5.8.

### F4 (MAJOR). Waits can never be cancelled, and the blocking wait's early return may be edge-triggered

Evidence: the event list in task 3d (line 360) has "wait opened", "wait member resolved" and "wait satisfied", but nothing that closes a wait without satisfying it. Row 26 (line 767) says a blocking wait "creates no delivery", but not whether it is recorded as an open wait.

If a `shepherd wait --block` is recorded as an open wait, then it stays open when its process dies, for example when a harness's shell-tool timeout kills it (Claude Code's limit is minutes) or the owner presses Ctrl-C. Under row 25 the caller then always has an open wait, so it is never settled, and its own parent's wait on it never wakes. The same thing happens to the open waits of a waiter that stops or crashes. When such a wait is satisfied later, the wake goes to a stopped agent, and row 24 defines no cell for a delivery to a stopped agent.

Row 26 also says the blocking wait returns early "when a request or question is routed to the caller". If that is triggered by the routing *event*, a request the caller already held before it called `--block` never triggers the return, so the round-1 deadlock is still there.

Fix: add a "wait cancelled" event. Write it when a blocking wait's connection closes, and when the waiter stops or crashes. Either leave blocking waits out of the settled predicate or cancel them on disconnect. Make the early return level-triggered, so the wait returns at once if the caller already holds an open request or question. Add both cases to criterion 7.6 (line 535).

### F5 (MAJOR). At every restart, every open question moves to the owner, and none moves back

Evidence: row 31, step 5 (line 772), marks every running agent interrupted. Row 27 makes the holder the nearest idle-or-working ancestor. Criterion 5.6 (line 432) says a question whose holder "is interrupted moves up". Criterion 6.7 (line 480) closes open permission requests on restart but says nothing about questions, so questions survive.

At step 5 every agent in a team is interrupted in the same pass, so no question has an idle or working ancestor left. Every open question moves to the owner, and "owner needed" is written for each one. At step 6 the leads are reloaded and become idle again. Nothing moves a question back, and row 27 refuses an `answer` from anyone except the holder or the owner. So every restart creates a flood of owner alerts and takes every open question away from the lead that was handling it.

Fix: treat "interrupted, reload pending" as able to hold during recovery. Re-evaluate holders once, at step 8, and move only those whose holder stayed interrupted. Assert in criterion 6.7 that a restart with an open question writes no "owner needed".

### F6 (MAJOR). Adapters and turns start while the socket is still closed

Evidence: row 31 reloads sessions with new tokens in step 6 and sends prompts in step 7, but opens the socket in step 9 (line 772; spec lines 522 to 529).

A reload passes `mcpServers` again, so each adapter starts a fresh `shepherd mcp` during step 6. If `shepherd mcp` connects at startup, it fails, because the socket is not open yet. Harnesses do not retry a failed MCP server, so the reloaded agent loses Shepherd's tools for the rest of its session. Turns that begin in step 7 can also call Shepherd tools before step 9. Nothing in task 7b.3 (line 548) requires `shepherd mcp` to tolerate an engine that cannot yet be reached.

Fix: either open the socket before step 6, refusing commands until recovery finishes, or move steps 6 and 7 after the socket opens. Require `shepherd mcp` to connect lazily and to retry until the socket answers. Test it in criterion 6.7.

### F7 (MAJOR). An error reply counts as "accepted", so the message is lost when the agent pauses

Evidence: row 29 counts a delivery as accepted at "the adapter's first `session/update` for that turn, or the prompt's reply, whichever comes first". Row 28 (line 769) releases only *queued* deliveries when "account available" is written.

If the account is out of usage or signed out, the reply to `session/prompt` is an error, and under row 29 that error counts as acceptance. The agent pauses with the message marked accepted although the model never processed it. When the account becomes available, the message is not queued, so it is never sent again. A related weakness: ACP's `session/update` carries no turn id, and adapters send unrelated updates such as `available_commands_update` without being asked. A stray update arriving just after "sent" would mark the delivery accepted.

Fix: count only a successful reply, or a content update (message chunk, plan, tool call) that arrives after the send. An error reply puts the delivery back to queued at the head of the agent's queue. Add the case "out of usage on delivery, then account available" to criterion 6.10 (line 483).

### F8 (MAJOR). A re-sent delivery can reach the agent twice, and nothing de-duplicates it

Evidence: row 29 and row 31, step 7, re-send every delivery that was sent but not accepted. Neither says anything about de-duplication by the agent.

The adapter may have received the prompt, written it to its own session file and started work before the engine recorded any update; the engine then dies. On restart, `session/load` restores that history, including the message, and the engine sends it again. The agent sees the instruction twice and may redo work it had already started. The carry-on prompt would have been the right choice here. The `session/load` history replay also arrives as `session/update` notifications, so it can be mistaken for acceptance of the re-sent delivery, or recorded a second time as new thread events.

Fix: put the delivery id inside the envelope that row 38 already requires. During reload, scan the replayed history for that id. If it is found, mark the delivery accepted and send a carry-on instead. Tag replayed updates so that they produce no thread events and no acceptance. Cover this in criterion 6.7.

### F9 (MAJOR). A pause does not survive a restart, and the "account available" timer is not re-armed

Evidence: row 31, step 5, marks "running agents" interrupted without defining which agents count as running. The account picker in row 28 counts paused agents as live. Row 28's timer exists only in memory, and row 31 has no step that rebuilds it.

If paused agents count as running, a restart marks them interrupted, and step 6 reloads them as idle. They then take deliveries into an account that is still out of usage, and the later "account available" event skips them, because they are no longer paused. Whether or not they count, nothing restarts the timer after a restart, and a reset time that passed while the service was down never produces "account available". A paused agent with a known reset time can therefore stay paused until the owner notices.

Fix: keep a paused agent paused through recovery (reload its session but keep the state). In recovery, rebuild timers from logged reset times that have no later "account available". Write an overdue "account available" before step 7. Compute the deadline from wall-clock time and re-check it periodically, so that a suspended host does not delay it. Add a restart case to criterion 6.10.

### F10 (MAJOR). Coming back from a pause loses the turn, and some pauses are silent

Evidence: row 28 says "account available" "moves the account's paused agents to idle and releases their queued deliveries". Row 25 resolves a wait member once, with the reason "paused".

There are four problems:

- An agent that ran out of usage in the middle of a turn returns to idle with its task half done, and nothing tells it to carry on. Row 31 does send a carry-on in the same situation after a restart.
- An out-of-usage pause with no reset time writes no "owner needed". Only signed-out pauses do (row 28). Such an agent stays paused with nobody told.
- The timer's "account available" also returns agents paused because the account signed out. They fail again and repeat "account needs sign-in" and "owner needed".
- Under an "all" wait, a member that paused and then came back and finished is still reported as "paused" when the wait closes. Its waiter may then reassign work that is already done.

Fix: record on the pause whether the agent was mid-turn, and send a carry-on when it comes back. Write "owner needed" for an out-of-usage pause with no reset time. Make "account available" carry the reason it clears, so that only the owner clears a signed-out pause. Report each member's state as it is when the wait closes, or let a paused member's reason be replaced while the wait is still open.

### F11 (MAJOR). `resume` skips row 29's re-send and carry-on, and a failed reload leaves no record

Evidence: row 31, step 7, is the only place unaccepted deliveries are re-sent and carry-on prompts are sent. Row 24 allows `resume` on interrupted agents. Row 25 resolves a member that is "interrupted and not reloadable". The event list (line 360) has no event for a failed reload.

An agent that cannot be reloaded at step 6, whether its adapter lacks reloading (known gap 3 says the Codex adapter may lack it) or the reload simply fails, stays interrupted. Its sent but unaccepted delivery stays "sent" forever: it is not re-sent, not returned and not accepted. When the owner or the parent later calls `resume`, nothing re-sends it or sends a carry-on. Because no event records that the reload failed, "not reloadable" is not a fact the views can rebuild from the log. So a wait on that agent may not resolve when the reload fails, and a rebuild may reach a different answer from the live view.

Fix: add an "agent reload failed" event, written in step 6 with its reason. Make `resume` run the same step as step 7: re-send the unaccepted delivery, otherwise send a carry-on if the agent was mid-turn. Test it in criteria 5.8 and 6.7.

### F12 (MINOR). Moving a request leaves the old holder's delivery queued and never moves back

Evidence: row 27 and criterion 5.6 withdraw a queued delivery only when a request is *closed*. The spec's `pass-up` row (spec line 163) still says "the routed agent's own parent, or the owner".

When a paused lead's request moves up to the orchestrator, the lead's queued delivery of that request stays. When the lead comes back, it spends a turn on the request, and its `answer` is refused because it is no longer the holder. Row 27 also never says whether a request moves back to an ancestor that becomes idle again. As a result, a request that reached the owner while the lead was briefly paused stays with the owner, even though the lead could answer it. A `pass-up` aimed at a paused parent has no defined target.

Fix: a move withdraws the old holder's delivery in the same transaction. State that a request never moves back. Make `pass-up` use the holder rule, starting from the holder's parent.

---

## Further MINOR findings (in the report only)

- **M1. The lifetime lock does not lock as written** (row 31, step 1, an UNREVIEWED MECHANISM). In SQLite's `locking_mode=EXCLUSIVE`, the lock is taken only on the first read (a shared lock) or the first write (the exclusive lock), not when the file is opened. Two instances that only open the file, or only read it, both run. Fix: after setting the pragma, run `BEGIN EXCLUSIVE` followed by a write, with `busy_timeout` 0, and treat `SQLITE_BUSY` as "already running". Unlink a stale `engine.sock` only after the lock is held. Criterion 7.4 would catch the first part, but the decision should be written correctly.
- **M2. Unassigned cells in the state machine** (row 24, criterion 3.5 at line 351). These cells have no answer anywhere:
  - `prompt` to a starting agent. Only the old rule 6 covers paused and interrupted agents.
  - `group` in any state.
  - A wake or other delivery to a stopped waiter.
  - Out of usage or signed out before the session opens. The agent pauses with no session, and "account available" then makes it idle with no session.
  - Exit-code precedence in row 26 when one member crashed and another paused.
  - Row 26's exit 2 for any interrupted member, while row 25 resolves only members that cannot be reloaded.

  Criterion 3.5 cannot enumerate cells that nobody has decided.
- **M3. A merged crash notice is delayed** (row 25). Under an "all" wait, a crash is reported only when the last member finishes, possibly hours later. Meanwhile the crashed agent's children's requests already go to the waiter under row 27, so the waiter handles them without knowing their parent crashed. Fix: send the crash notice at once, and still list it in the final wake.
- **M4. `debug.compare-views` can report false differences** (row 43, an UNREVIEWED MECHANISM). Rebuilding while the writer appends (timer events, delivery steps) compares two different points in the log. Fix: rebuild up to a fixed sequence number N under the writer's semaphore, and compare against the live view at N.
- **M5. The decision log contradicts itself.** Row 15's fallback is "an HTTP MCP endpoint on the loopback address", but row 21 says "No TCP listener in this plan", criterion 7.1 forbids one, and task 7b.3 falls back to the Unix socket. Row 16 still says "WebSocket on 127.0.0.1". Neither row is marked as superseded. Fix: mark rows 15 and 16 as superseded by rows 21 and 48.
- **M6. Owner "mark account available" has no command.** Row 28 allows it, but criterion 3.1's exact command list has no such command. Fix: name it, for example as an `accounts` sub-action.

---

## Per-question verdicts

1. **State machine truth table: not closed.** Row 24 leaves cells empty (M2), and rows 25, 26 and 28 disagree about paused and interrupted members (F10, M2). Paused across a restart is undefined (F9).
2. **Settled waits: unsafe.** A wait can wake early (F1), never wake (F2, F4, F11), carry a stale "paused" reason (F10), or be delivered twice through a re-send (F8). The late-open case and "any" versus "all" are otherwise sound.
3. **Rights passing up: partly sound.** A chain where every ancestor is paused correctly ends with the owner. But a restart floods the owner and strands questions (F5), a move does not withdraw the old holder's delivery and never moves back (F12), and a request held by an idle agent stalls silently (F3). Races are safe inside the single writer.
4. **Deliveries and restart order: a message can be lost** through error-reply acceptance (F7) or a resume (F11), **or repeated** with no de-duplication by the agent (F8). Turns start before the socket opens (F6).
5. **The "account available" timer: not durable.** It is lost on restart and not caught up afterwards (F9), it is not robust to clock jumps (F9), and on an account that is still exhausted it can lose the message (F7) or clear sign-outs (F10).
6. **Blocking wait: deadlock remains** when a request was already held before `--block` started (F4). A killed blocking wait strands the caller's parent (F4).
7. **Contradictions:** rows 27 and 31 collide at restart (F5), rows 28 and 29 (F7), rows 25 and 26 on "interrupted" (M2), and rows 15 and 16 against rows 21 and 48 (M5). There is no contradiction with the spec amendment section beyond these.
