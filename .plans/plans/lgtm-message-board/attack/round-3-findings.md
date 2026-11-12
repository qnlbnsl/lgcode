# Round 3 findings and where each is folded

Round 3 reviewed plan version 3 (`attack/plan-v3.md`) and contract version
4 (`attack/contract-v4.md`). Six reviews came in: architecture, critic,
logic (two models) and threat model (two models). Together they filed 0
blockers, 18 majors and 13 minors, with grades of 6 to 7. The lead grouped
the majors into seven problems (`board-r3-majors.md`). The reviews are
copied here as `attack/round-3-*.md`.

Every finding is folded into plan version 4 and contract version 5.
"Row" means a row in `decisions.md`; "criterion" means a criterion in
`plan.md`. Groups 5 and 6 needed a small change to the client API contract.
It was asked of the lead as question Q5 with its exact text (board post
#113), approved as ruling L23, and is in the client API contract at
`ced973b`. The lead approved contract version 5 as ruling L24 (row 98).

## The seven groups, for the owner

### Group 1: a crash both kept and withdrew a group member's questions

**Findings:** architecture R3-A3, critic C3-01, logic R3-L1, logic M1.

**The issue.** A group channel counted only "live" label carriers as
members, and a crashed agent is not live. So when a labelled worker
crashed, two rules fired at once. The crash rule kept its open questions,
so it could collect the answers after it was resumed. The leaving rule
withdrew them, because the worker had "left" the channel. A worker that
crashed while being asked something was also marked both "gone" and
"removed", and only "gone" lets a later answer count.

**The fix.** A crash no longer takes anyone out of a channel. Membership
counts every label carrier that is not stopped. Crashes, interrupts, pauses
and resumes are handled by the lifecycle rules alone. Only a stop, a label
change or an explicit removal changes who is in a channel. A crashed
author's questions stay open; a crashed addressee is "gone", and its answer
after resume still counts. A stop is one rule: its posts are withdrawn and
nothing is owed to it.

**Decision:** row 84. **Proved by:** criteria 2.6, 2.7, 4.1, 4.4.

### Group 2: one closing notice could be larger than a whole wake

**Findings:** architecture R3-A1, critic C3-02, logic R3-L2, threat
R3-TM-3.

**The issue.** When a question closes, its asker is sent a closing notice
with every answer. Sixteen full-length answers are larger than the 256 KiB
limit on a whole wake. The notice could then never be sent, and it would
keep the asker "not finished" forever.

**The fix.** A closing notice has its own limit of 64 KiB. It always names
the outcome, every addressee's result and the id of every answer. It
includes the answers' text only while it fits; it names the rest, which the
asker reads page by page with `board.read` and `repliesTo`. Closing
notices take at most half of a wake, so new questions still fit, and any
others wait for the next wake.

**Decision:** row 88. **Proved by:** criteria 3.3, 3.13.

### Group 3: the phone's fallback lists had no size limit

**Findings:** architecture R3-A2, critic C3-03, logic R3-L3, threat
R3-TM-2.

**The issue.** Round 2 made the phone's start-up summary small, and said
that if it was cut short, the phone should ask `board.status` and
`board.channels` for the rest. But those two replies had no limit. One
agent being asked 3,000 questions by many others would produce a status
reply larger than the network's 1 MiB message limit.

**The fix.** `board.status` now returns a small summary of fixed size by
default: counts, the wake state, and whether the agent counts as finished.
Its lists, and the channel list, come in pages of at most 512 KiB. The
start-up summary always begins with which agents count as not finished,
which is short and never cut. The owner's wait helper reads that, then
re-reads the small status summaries as board events arrive, ignoring any
summary older than one it has already seen.

**Decision:** row 89. **Proved by:** criteria 1.7, 5.6, 5.9, 5.12.

### Group 4: a pause could change who was in a channel

**Findings:** logic M2, threat T3-2.

**The issue.** When a channel's manager stopped or crashed, its rights
passed to its "holder", the nearest ancestor that is awake. The new manager
was then a member. But "nearest awake ancestor" changes whenever an
ancestor pauses for usage limits, so a pause could move the manager seat
and add or remove a member. The lead's ruling L18 says a pause must never
change membership.

**The fix.** The manager is recorded. It changes only when the current
manager stops or crashes, and then moves to the nearest ancestor in the
family tree that is not stopped or crashed, whatever its usage state. A
new event, `board.ManagerChanged`, records the move. Rights never move back
when an earlier manager is resumed. The opener stays a member as the
channel's anchor, so it can still use its own channel.

**Decision:** row 85. **Proved by:** criteria 2.5, 2.6.

### Group 5: the check at the moment of sending could not tell which wake it judged

**Findings:** logic M3, threat T3-1, and logic m4 (minor).

**The issue.** Round 2 added a check, made at the moment a wake is sent,
that the target may still read every post in it. But the client API gives
that check only the target and the current state, not the wake being sent.
An agent can have two board wakes waiting, so the check could not know
which posts to judge. It would either let a wake through that it should
stop, or stop a good wake because of another wake's post.

**The fix.** The client API's item 15 passes the check the delivery being
judged, by its id and its board source. When the check runs at queue time,
it also sees the board's own record of the wake just built. After a wake is
stopped at sending, the engine goes on to the agent's next waiting
message. This changes the shared client API contract, so the exact text was
asked of the lead as Q5, and approved as ruling L23.

**Decision:** rows 86 and 98. **Proved by:**
criteria 2.11, 4.9; post-build checks 14 and 15.

### Group 6: a closing notice could carry answers from a channel its asker had left

**Findings:** threat R3-TM-1, threat T3-3 (minor).

**The issue.** A closing notice always passed the check at sending, so
that an asker is always told how its question ended. But the notice can
carry the answers' text. If the asker was removed from the channel while
the notice waited, it would still receive answers from a channel it may no
longer read.

**The fix.** Telling the asker is separated from sending it the text. A
notice with no answer text always passes. A notice with answer text is
judged at sending like a post of its channel. If the asker is no longer a
member, the wake is stopped, and the notice is rebuilt with the outcome and
the reason, without the text.

**Decision:** row 87. **Proved by:** criterion 4.9.

### Group 7: one silent agent could stall every wait on it

**Findings:** logic M4; threat T3-6 and T3-5 (minors).

**The issue.** Round 2 added a rule that an agent asked a question is "not
finished" while no wake carrying the question is waiting. Its purpose was
the short moment between a failed send and the retry. As written, it also
held an agent that had received its question and ended its turn without
answering. That is a common thing for a model to do. Anyone waiting on that
agent would then wait forever.

**The fix.** The rule now holds only while the question has never reached
the agent: no wake carrying it has been accepted, and none is waiting. An
agent that received its question and ended its turn counts as finished, as
the engine would say. Its asker still waits on its own open question, and
the stall watch or the owner deals with the silence.

**Decision:** row 90. **Proved by:** criterion 4.6.

## The minor findings

| Finding | Review | Folded as |
|---|---|---|
| R3-A4. The condition criteria demand full answers from a cut-short summary | Architecture | Row 89: the summary carries the conditions' results; criteria 1.7, 5.9 |
| C3-04. Pure-function equality is required from a snapshot that omits its inputs | Critic | Row 89; criteria 1.7, 5.9 |
| C3-05. The overflow test expects a narrower query than the contract defines | Critic | Row 97; criterion 3.8 |
| m1. A wake accepted and then returned has no rule | Logic, first model | Row 91; criterion 4.3 |
| m2. A completion that failed twice is re-queued forever, and cannot be repaired | Logic, first model | Row 92; criterion 4.3 |
| m3. Late replies from `undeliverable` and re-added `removed` addressees are lost | Logic, first model | Row 93; criterion 3.12 |
| m4. After a send-time withdrawal, the next queued delivery waits | Logic, first model | Row 86, approved as L23; post-build check 14 |
| m5. A service can be named as an addressee but never resolves | Logic, first model | Row 94; criterion 3.12 |
| m6. Completions owed to a stopped agent build up | Logic, first model | Row 95 |
| T3-3. A completion carries reply text past the send-time check | Threat, first model | Row 87 (group 6) |
| T3-4. No test refuses an anchor named by an agent | Threat, first model | Row 96; criterion 2.6 |
| T3-5. The bounded snapshot cannot feed the third condition clause | Threat, first model | Rows 89 and 90 (groups 3 and 7) |
| T3-6. The third clause lets any member keep another agent unsettled | Threat, first model | Row 90 (group 7) |

## Every major finding

| Finding | Review | Group | Row |
|---|---|---|---|
| R3-A1 | Architecture | 2 | 88 |
| R3-A2 | Architecture | 3 | 89 |
| R3-A3 | Architecture | 1 | 84 |
| C3-01 | Critic | 1 | 84 |
| C3-02 | Critic | 2 | 88 |
| C3-03 | Critic | 3 | 89 |
| M1 | Logic, first model | 1 | 84 |
| M2 | Logic, first model | 4 | 85 |
| M3 | Logic, first model | 5 | 86 |
| M4 | Logic, first model | 7 | 90 |
| R3-L1 | Logic, second model | 1 | 84 |
| R3-L2 | Logic, second model | 2 | 88 |
| R3-L3 | Logic, second model | 3 | 89 |
| T3-1 | Threat, first model | 5 | 86 |
| T3-2 | Threat, first model | 4 | 85 |
| R3-TM-1 | Threat, second model | 6 | 87 |
| R3-TM-2 | Threat, second model | 3 | 89 |
| R3-TM-3 | Threat, second model | 2 | 88 |
