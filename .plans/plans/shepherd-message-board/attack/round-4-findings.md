# Round 4 findings and where each is folded

Round 4 reviewed plan version 5 (`attack/plan-v5.md`) and contract version
6 (`attack/contract-v6.md`). Six reviews came in: architecture, critic,
logic (two models) and threat model (two models). Together they filed 0
blockers, 22 majors and 19 minors, all with grade 6, and no refusals. The
lead grouped them into ten problems (`board-r4-majors.md`). The reviews
are copied here as `attack/round-4-*.md`.

Every finding is folded into plan version 6 and contract version 7. "Row" means a row in
`decisions.md`; "criterion" means a criterion in `plan.md`.

Groups 5, 6, 7 and 9, and the write path of group 3, were gaps in the
client API's shared engine edits. Its planner fixed them in the client API
contract version 4 (`8e80a13`), and the board builds on that. The board's
own fixes change its contract, and four of them change the client API's
text. Those were asked of the lead as question Q6, with the exact text,
and approved as ruling L30 (row 120). The client API changes are in its
contract version 5 (`09018d6`).

## The ten groups, for the owner

### Group 1: the owner's wait could end too early, or never end

**Findings:** logic M1, architecture R4-A3, logic R4-L1.

**The issue.** The owner's phone or terminal waits for agents with a
helper. The helper knew whether the board still held an agent "not
finished" only from a result the board gave it, and it asked again only
after a board event. But engine events, such as a returned message or an
accepted one, change that answer with no board event. So the owner's wait
could end while an answer was still owed, or keep waiting after the
answer had arrived, until some unrelated board event happened.

**The fix.** The board can now answer, in one small read, which agents
are not finished, at one point in the log. Whenever the engine's own part
of the test says the agents are finished, the helper makes that read. It
ends the wait only when both parts agree at the same point in the log. It
never polls on a timer.

**Decision:** row 103, approved as L30. **Proved by:** criterion 5.9;
post-build check 19.

### Group 2: a question that did not fit in a wake was never sent

**Findings:** logic M2, critic C4-03, logic R4-L2, threat V4-3.

**The issue.** A wake has a size limit. A question left out of a full wake
stayed waiting, and nothing ever sent it, so its addressee counted as "not
finished" forever. Reading the question with `board.read` did not count as
receiving it. The rule that decides "not finished" also could not see
whether a wake was still waiting to be sent.

**The fix.** A question counts as received once a wake carrying it is
accepted, or once the agent reads it with `board.read`. The board's
background reactor sends any question that has not been received in the
agent's next wake. The "not finished" rule now also reads the engine's
record of which messages are waiting.

**Decision:** row 104. **Proved by:** criteria 1.7, 3.8, 4.6.

### Group 3: the reactor could lose work in a restart, and wrote around the engine's checks

**Findings:** logic M3, threat V4-2.

**The issue.** The reactor reacts to events, such as an agent leaving a
channel. It acted only at the moment each event arrived, and recorded no
progress. A restart at the wrong moment lost the work for good. It also
wrote to the log directly, past the checks the engine runs on every
command.

**The fix.** Every reactor rule now looks at the current state, not at a
single event. So after a restart, the reactor finds any unfinished work
and does it. The client API's planner added one path for every write a
piece makes, with the engine's checks, and the reactor writes only through
it, under the board's own name.

**Decision:** rows 105 and 119. **Proved by:** criteria 4.5, 4.10, 6.4;
post-build check 18.

### Group 4: a short crash moved a channel's manager for good

**Findings:** logic M4, critic C4-02, and threat V4-4 (minor).

**The issue.** When a channel's manager crashed, its rights passed to its
parent for good, and the parent joined the channel. A crash is usually
recovered in seconds. So a short crash left the parent in the channel,
reachable by every member, and left the opener without its rights. In a
direct channel between two agents, it made a third member.

**The fix.** Only a stop moves the manager seat. While the manager is
crashed, its nearest ancestor may act for it, without joining the channel.
The agent that opens a plain channel stays a member whatever happens to
the seat. A direct channel has no manager, and always has exactly two
members.

**Decision:** row 106, approved as L30. **Proved by:** criteria 2.5, 2.6, 2.7.

### Group 5: the board's commands had no way to return their results

**Findings:** architecture R4-A2, threat R4-TM-3, logic R4-L4.

**The issue.** The engine's list of commands had no way for a board
command to return, for example, the id of the channel it had opened.

**The fix.** The client API's planner added a reply to every command plan.
The board's replies hold ids and counts only, never post text.

**Decision:** row 107. **Proved by:** criterion 3.14.

### Group 6: every page an agent read would have been stored

**Findings:** threat V4-1, threat R4-TM-1.

**The issue.** The engine stores each command's reply, so a repeated
request gets the same answer. For `board.read`, that would have stored a
copy of every page of posts that any agent read, for ever. A repeated read
could also return a page after the agent had lost access to the channel.

**The fix.** `board.read` is now a read that stores nothing. It checks the
agent's access on every request, and records only which posts were read.

**Decision:** row 108. **Proved by:** criterion 5.11.

### Group 7: a returned board message did not fit the log's format

**Findings:** critic C4-01, threat R4-TM-2, logic R4-L3.

**The issue.** When an agent cannot take a board message, the engine
records it as returned. That record could name only the owner or an agent
as the sender, not the board.

**The fix.** The client API's planner widened that record to name the
board, a service or an agent.

**Decision:** row 109. **Proved by:** criterion 4.3.

### Group 8: a closing notice could still be too large

**Findings:** architecture R4-A4, logic R4-L8.

**The issue.** Round 3 limited the text in a closing notice, but the
notice still had to list the id of every reply. Many short replies to one
question would make that list larger than the notice's limit.

**The fix.** The notice now names, for each addressee, only the one reply
that decided its part, plus the total number of replies. That is at most
17 ids. Every reply can still be read page by page.

**Decision:** row 111, approved as L30. **Proved by:** criteria 1.5, 3.13.

### Group 9: one engine table was missing from the list of changes

**Findings:** architecture R4-A1; logic m2, logic R4-L5 and threat
R4-TM-5 (minors).

**The issue.** The engine has a table that says how each event changes an
agent's state, and it must list every event. Adding the board's events
without adding them there would stop the build. One engine test also needs
a sample of each new event.

**The fix.** The board adds one line to that table, saying its events
never change an agent's state, and one sample per event to the test.

**Decision:** row 112. **Proved by:** criterion 1.10.

### Group 10: two of round 3's proposed checks were dropped

**Findings:** threat V4-5 (minor).

**The issue.** Round 3 proposed two checks to run after the build. Neither
was kept or answered.

**The fix.** Both are restored as post-build checks 16 and 17, and one is
also a case of criterion 6.3.

**Decision:** row 113. **Proved by:** criterion 6.3; post-build checks 16
and 17.

## The minor findings

| Finding | Review | Folded as |
|---|---|---|
| m1. A return after an accept re-queued without limit | Logic, first model | Row 110: not re-queued, as the engine does; criterion 4.3 |
| m2. The lifecycle table was missing from B2 | Logic, first model | Row 112 (group 9) |
| m3. Engine change B8's anchor was wrong | Logic, first model | Row 117 |
| m4. With the board off, the owner's wait lost its input | Logic, first model | Row 116; criterion 5.10 |
| m5. A stopped agent that is resumed rejoined with no join point | Logic, first model | Row 114; criterion 2.3 |
| m6. A rebuilt wake could carry a completion already discharged | Logic, first model | Row 115; criterion 3.15 |
| m7. A send-time withdrawal skipped the engine's wait checks | Logic, first model | Row 118, approved as L30; criterion 4.9 |
| m8. Dropping a stopped agent's completions had no writer | Logic, first model | Row 114; criterion 2.1 |
| R4-L5. The lifecycle table was missing from the inventory | Logic, second model | Row 112 (group 9) |
| R4-L6. Dropping a stopped agent's completions had no fold | Logic, second model | Row 114 |
| R4-L7. A completion could be packed twice | Logic, second model | Row 115; criterion 3.15 |
| R4-A5. The fold's list ignored the stop | Architecture | Row 114 |
| C4-04. The fold's list ignored the stop | Critic | Row 114 |
| C4-05. "board disabled" would be shown as "command refused" | Critic | Row 116: engine change B10; criterion 5.10 |
| C4-06. The client API named `board.read` as a read while the board made it a planner | Critic | Rows 108 and 117: client API v4 makes it a read with marks |
| V4-4. The service grant was stated two ways | Threat, first model | Row 117: "while T is not stopped"; criterion 2.7 |
| V4-5. Two proposed checks were dropped | Threat, first model | Row 113 (group 10) |
| R4-TM-4. Dropping a stopped agent's completions had no fold | Threat, second model | Row 114 |
| R4-TM-5. The lifecycle table and a visibility sample were missing | Threat, second model | Row 112 (group 9) |

## Every major finding

| Finding | Review | Group | Row |
|---|---|---|---|
| M1 | Logic, first model | 1 | 103 |
| M2 | Logic, first model | 2 | 104 |
| M3 | Logic, first model | 3 | 105 |
| M4 | Logic, first model | 4 | 106 |
| R4-L1 | Logic, second model | 1 | 103 |
| R4-L2 | Logic, second model | 2 | 104 |
| R4-L3 | Logic, second model | 7 | 109 |
| R4-L4 | Logic, second model | 5 | 107 |
| R4-L8 | Logic, second model | 8 | 111 |
| R4-A1 | Architecture | 9 | 112 |
| R4-A2 | Architecture | 5 | 107 |
| R4-A3 | Architecture | 1 | 103 |
| R4-A4 | Architecture | 8 | 111 |
| C4-01 | Critic | 7 | 109 |
| C4-02 | Critic | 4 | 106 |
| C4-03 | Critic | 2 | 104 |
| V4-1 | Threat, first model | 6 | 108 |
| V4-2 | Threat, first model | 3 | 105, 119 |
| V4-3 | Threat, first model | 2 | 104 |
| R4-TM-1 | Threat, second model | 6 | 108 |
| R4-TM-2 | Threat, second model | 7 | 109 |
| R4-TM-3 | Threat, second model | 5 | 107 |
