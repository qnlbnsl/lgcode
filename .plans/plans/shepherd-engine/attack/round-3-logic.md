# Round 3: logic and failure policy review of plan-v3

Reviewer seat: logic and failure policy (isolated, round 3, the final round).
Target: `attack/plan-v3.md`, decision rows 50 to 53 and 62 (lines 902 to 905 and 914) and the criteria they produced (5.4 to 5.9, 6.6, 6.7, 6.10, 7.4, 7.6, 7.10).
Context: `docs/specs/2026-11-01-engine-design.md`, section "Changes after the plan review" (line 452 onward), and failure rule 2 (lines 340 to 347).
Known gaps 1 to 6 are not re-reported. The owner's ruling to keep fully automatic recovery (row 49) is taken as fixed; every finding below is about what still breaks inside it.

Abbreviations: ACP is the Agent Client Protocol; MCP is the Model Context Protocol; RPC is a remote procedure call.

Line numbers refer to `attack/plan-v3.md` unless a file is named. "Row N" is decision N in the appended log.

## Verdict

**REVISE.** Most of round 2's findings are fixed as written. The new recovery order in row 52, however, re-checks every wait at step 9 before step 10 queues the carry-on prompts and re-sends. A reloaded agent that was in the middle of a turn therefore looks settled at step 9, so its waiter is woken early. Because the waiter then settles in turn, a single restart can report a whole team as finished while every worker is still carrying on. This is round-2 F1 case 2, which the folded text did not fix and, by moving the carry-on after the re-check, made certain rather than possible.

Six findings are MAJOR and the rest are MINOR. None is a BLOCKER.

---

## Findings

### R3-1 (MAJOR). Step 9 re-checks waits before step 10 queues carry-ons, so reloaded mid-turn agents settle falsely

Evidence: row 52 (line 904) reloads in step 7, re-checks every open wait in step 9, and only in step 10 re-sends or sends a carry-on. Row 52 never says which state a successful reload leaves the agent in, but step 9's "holder stayed interrupted" only makes sense if a reloaded agent leaves the interrupted state, and spec line 343 says a reloaded agent "goes back to idle". Row 50's settled predicate (line 902) is idle, no unaccepted delivery, no request held or asked, no open non-blocking wait.

At step 9, a reloaded agent that was mid-turn is idle and has no unaccepted delivery. Its delivery was accepted before the crash, or row 51's replay scan has just marked it accepted at step 7. In scenario (a), the worker's permission request was also cancelled at step 6, so it holds nothing either. The predicate is true, the lead's wait on the worker resolves, and a wake "worker settled" is queued to the lead. At step 10 the worker receives its carry-on and carries on working, while the lead reviews half-done work or reassigns it. In scenario (b), when the replay finds the lead's wake delivery, that delivery is marked accepted at step 7, so the lead settles at step 9 and the orchestrator is woken early. In scenario (d), the false wake travels up the tree.

If the implementer instead keeps reloaded agents interrupted until step 10, step 9 moves every question they hold to the owner, which is round-2 F5's flood again. Neither reading works.

Fix: state that a successful reload sets the agent's state in the same transaction that records the reload. In that transaction, also queue its carry-on at the head of its queue, or return its unaccepted delivery to queued at the head. The predicate is then false at step 9. Step 10 only sends what is queued. Add "worker mid-turn at SIGKILL, lead waiting: no wake until the carry-on turn ends" and "wake delivery found in replay: orchestrator not woken" to criteria 5.8 and 6.7.

### R3-2 (MAJOR). Automatic pass-up misses a request delivered in a turn that a restart cut off

Evidence: row 50 passes a request up only at the "turn ended" of "the turn in which a request or question was delivered". Row 52 step 6 keeps questions open and lets an interrupted holder keep holding. Step 10 sends a carry-on, which is a new turn.

Take a lead that was delivered a worker's question and was mid-turn when the service died. The original turn never writes "turn ended". The carry-on turn is not the turn in which the question was delivered. If the lead ends the carry-on turn without answering, nothing passes the question up. The lead is idle and holds an open question, so it is never settled, and its parent's wait never wakes. The owner is never alerted, because the owner never becomes the holder. This is round-2 F3's silent stall, reopened by a restart.

Fix: at every "turn ended", pass up each open request or question that the agent holds and whose delivery to it was accepted, whichever turn that was in. Add "question delivered, SIGKILL mid-turn, carry-on turn ends without an answer: passed up" to criteria 5.6 and 6.7.

### R3-3 (MAJOR). Paused agents are reloaded, sent to and returned at the wrong steps

Evidence: row 52 step 7 reloads agents that are "interrupted or paused", and on failure "the agent stays interrupted". Step 8 writes an overdue "account available", which under rows 28 and 53 returns paused agents, releases their deliveries and sends carry-ons. Step 10 then acts "for each reloaded agent".

Scenario (c) shows three faults:

1. A signed-out account is the account most likely to fail `session/load`. The failure turns the paused agent into an interrupted one. When the owner later runs `accounts mark-available`, the agent is not paused any more, so it is not returned. "Pauses survive a restart" (spec line 523) fails for exactly the signed-out case.
2. Step 10 sends a carry-on or re-send to an agent that is still paused. That send gets an out-of-usage error, which requeues it, may write a second pause and a second "owner needed", and is followed by row 53's own carry-on when the account returns.
3. An overdue return at step 8 sends prompts before step 9 has re-evaluated holders and before commands are served. Requests raised in those turns skip interrupted ancestors and go to the owner. Step 10 then sends the agent a second carry-on, because step 10's "mid-turn" test does not know about the return that already happened.

Fix: do not reload paused agents at step 7. A pause's return path already opens a session for an agent that has none (row 53). Extend it so that a return reloads the session and then runs step 10 once for that agent. Writing an overdue "account available" at step 8 only changes state; the reload and sends run in step 10. Add these cases to criterion 6.10.

### R3-4 (MAJOR). "An error reply requeues at the head" contradicts "unrecognised errors crash", and read literally it loops forever

Evidence: row 51 (line 903) says "An error reply puts the delivery back at the head of the agent's queue", with no condition on the kind of error. Criterion 5.9 (line 500) repeats it. The risk table (line 597) says "unrecognised errors are reported as crashes with their text, never retried".

Take an error that is neither out of usage nor signed out, such as a prompt that is too long or an adapter's internal error. Under row 51, the delivery goes back to the head of the queue. If the agent returns to idle, the delivery is sent again, gets the same error, and is requeued again. This is a hot loop that blocks the head of the queue. While it lasts, the delivery is never accepted, so the agent never settles and its waiter never wakes. If the agent instead stays working, nothing ever sends the delivery again, and the queue stalls.

Fix: requeue at the head only on errors that cause a pause (out of usage, signed out). Any other error reply returns the delivery to its sender with the error text. The agent stays idle, or a crash is recorded under line 597, and the plan says which. Add "unclassified error reply: returned once, not re-sent" to criterion 5.9.

### R3-5 (MAJOR). A crash cancels the waiter's waits, and `resume` never restores them

Evidence: row 50 writes "wait cancelled" when the waiter "stops or crashes" and withdraws its wake. Row 24 allows `resume` on a crashed agent. Row 52 says `resume` runs step 10, which only re-sends or sends a carry-on. Interrupted waiters keep their waits, so crash and interruption behave differently.

Take a lead that ended its turn waiting on two workers, and whose adapter then crashes while it is idle. Stopping or crashing an agent does not stop its children (row 27), so the workers continue. The orchestrator gets the crash notice and resumes the lead. The lead was not mid-turn, so it gets no carry-on, and it has no wait any more. When the workers finish, nobody is woken. The resumed lead is idle and settled, so the orchestrator's wait on it resolves at once: a false completion, and the workers' results are never collected.

Fix: on a crash, suspend the waiter's non-blocking waits instead of cancelling them, and withdraw only the queued wake. On `resume`, re-open the suspended waits and re-check them at once. Cancel only on `stop`. Add "waiter crashes, is resumed, workers finish: one wake" to criterion 5.8.

### R3-6 (MAJOR). `resume` on an agent that cannot reload is undefined, and a carry-on there loses the message

Evidence: criterion 6.7 (line 565) says "non-reloadable agents stay interrupted; `resume` on one of them later runs step 10". The spec's command table (spec line 167) defines `resume` as starting the agent "again from its saved session", which an adapter without reloading cannot do.

If `resume` opens a fresh session, step 10 sends that session "carry on". The fresh session has no history, so it does not know what to carry on with, and any delivery accepted before the crash, which a mid-turn agent always has, is lost. If `resume` is refused, criterion 6.7 cannot pass.

Fix: decide the rule. For an adapter without reloading, `resume` opens a new session and re-sends every delivery accepted since the agent's last "turn ended", in order, followed by its unaccepted deliveries, with no carry-on. The view records that the history was lost. Otherwise, `resume` is refused with "cannot reload" and the parent is told. Test whichever is chosen in criterion 6.7.

### R3-7 (MINOR). The replay scan commits before the reload is known to succeed, and its matching is underspecified

Evidence: row 51 says "a found id marks that delivery accepted". Row 52 step 7 writes "agent reload failed" on failure, and does not say whether the acceptances found by the scan are kept.

If `session/load` streams part of its history and then fails, the delivery stays accepted, but the agent has no session. A later `resume` that cannot reload (R3-6) then has nothing to re-send, so the message is lost. Separately, an id split across two `user_message_chunk` updates, or one that appears only in an agent's own message, could produce a miss or a false match.

Fix: hold the scan's results in memory, and write them in the same transaction as the successful reload. On failure, discard them, so the delivery stays unaccepted. Match only within user-message updates, after joining the chunks of each message.

### R3-8 (MINOR). "Mid-turn" is undefined now that "working" begins at "sent"

Evidence: row 50 makes the state working at "delivery sent". Row 53 records "whether the agent was mid-turn" on a pause and gives a returning mid-turn agent a carry-on. Row 51 requeues an errored delivery at the head. Row 29's rule that a carry-on goes only to an agent "with no unaccepted delivery" is not repeated in row 53.

An out-of-usage error on a fresh delivery pauses an agent that is "working" but whose turn never started. If "mid-turn" is read from the state, the return sends a needless carry-on in front of the requeued delivery. Criterion 6.10 asserts both actions without ordering them.

Fix: define mid-turn as "a delivery was accepted and no 'turn ended' followed it". Apply row 29's rule to returns: send the carry-on only when nothing is unaccepted.

### R3-9 (MINOR). A crash can wake one waiter two or three times

Evidence: row 50 says "A crashed member's notice is delivered at once and listed again in the final wake". Criterion 6.6 (line 564) says waiters get an immediate notice and "the parent is told". Row 25 had merged these.

When a crash closes an "any" wait, or is the last open member of an "all" wait, the waiter receives the immediate notice and the final wake in the same transaction. If the waiter is also the parent, it receives the parent notice as well. This breaks the "wakes exactly once" promise in criterion 5.8.

Fix: send the immediate notice only when the wait stays open after the crash. Merge the parent notice into the waiter's delivery when they go to the same agent.

### R3-10 (MINOR). "Reason at close" can report "working", and an "all" wait closes while a member is working

Evidence: row 50 says "A member's reason is its state when the wait closes, not when it first resolved". Criterion 5.8 includes "a member paused then returned (reported as its state at close)".

A paused member counts as resolved. When it returns and starts working, row 50 does not say whether it stops counting as resolved. If it still counts, the "all" wait closes when the last other member settles and reports this one as "working", which is not a resolution reason, and nobody is woken when it later finishes.

Fix: a resolved member that returns to working before the wait closes stops counting as resolved. Report each member's state at close only among the resolution reasons.

---

## Further MINOR findings (in the report only)

- **M-a. Blocking waits open at the crash are never cancelled.** Row 50 cancels a blocking wait when its connection closes, but a `SIGKILL` writes nothing, and row 52 has no step that cancels them. Fix: step 6 writes "wait cancelled" for every open blocking wait, since no connection survives a restart.
- **M-b. Cancelling a request at step 6 leaves the holder's sent copy to be re-sent.** Row 27 withdraws only a *queued* delivery when a request closes. If the holder's delivery of a cancelled permission request was sent but not accepted, step 10 re-sends it, and the holder's `answer` is refused. Fix: closing a request withdraws its delivery at any step before acceptance.
- **M-c. The compact clause in row 50 contradicts "current state only".** "The end of a compact turn restores the settled status from before it" makes the predicate depend on history. If a request the agent held is answered during the compaction, the restored status is "not settled" while the predicate says settled. Fix: delete the clause. "Not in a compact turn" plus the predicate is enough.
- **M-d. Some deliveries carry no id, so the replay can never find them.** Row 58 puts the delivery id in the envelope, which wraps child text. Owner prompts (not escaped, and presumably not wrapped) and compact commands carry no id, so every one of them is re-sent after a restart. Fix: every delivery except compact carries an id line. Compact is re-sent, and a repeated compact is harmless.
- **M-e. A starting agent at the restart needs a manual `resume`.** Step 6 interrupts starting agents, which have no session to reload, so they stay interrupted. Row 53 already opens a session automatically for a pause that happened before the session opened. Fix: treat a starting agent the same way, starting it fresh at step 10 with its queued first prompt.
- **M-f. A delivery to a stopped target is withdrawn silently.** Row 62 withdraws a delivery to a stopped agent, while criterion 5.9 returns a delivery to the sender when the target crashed. When the owner stops a child, the parent's queued prompt disappears without telling the parent. Fix: return it to the sender, as for a crash.

---

## Per-question verdicts

1. **Round-2 fixes:** F4-F8, F10, F12 and M1-M6 are fixed as written. F1 case 2 is not fixed, and row 52's step order makes it worse (R3-1). F3 reopens across a restart (R3-2). F9 is only partly fixed for paused agents (R3-3). F11 is undefined for agents that cannot reload (R3-6). F7's fix adds a loop on unclassified errors (R3-4). F2's fix is correct apart from a history-dependent clause (M-c).
2. **SIGKILL walk:** In (a), the request is cancelled correctly, but the worker settles falsely at step 9 (R3-1, M-b). In (b), when the replay finds the wake, the orchestrator is woken early (R3-1); when it does not, the wake arrives once. In (c), the pause can be lost, an extra send goes to an agent that is still paused, and a second carry-on is sent (R3-3). In (d), the orchestrator is woken once, but the false completions below it travel up (R3-1), and dead blocking waits linger (M-a). "Owner needed" is not flooded, but it is missed for a question stranded after a restart (R3-2).
3. **Settled plus pass-up:** pass-up cannot livelock, because requests move only upward. Unclassified errors do livelock (R3-4). The owner is not flooded beyond the design, although a holder must now answer in the same turn. One wait never wakes when a crashed waiter is resumed (R3-5), and another when a held request survives a restart (R3-2).
4. **Replay scan:** when the replay omits a message, the delivery is re-sent, so nothing is lost, but it is duplicated. The spec's promise that a message "is not sent again" (spec line 536) should say "where the harness replays it", as PB-A12 already allows. A scan followed by a failed reload must not commit its acceptances (R3-7). A message is lost only on `resume` without reloading (R3-6).
5. **Contradictions:** row 51 contradicts plan line 597 (R3-4). Row 50's "no open non-blocking wait" contradicts the spec's "it has no open wait" (spec line 482). Row 52's step 6 includes starting agents, which the spec's step 6 leaves out. Row 50 withdraws a wake to a crashed waiter, while criterion 5.9 returns a delivery to a crashed target's sender. Row 50's compact clause contradicts its own "current state only" (M-c).
