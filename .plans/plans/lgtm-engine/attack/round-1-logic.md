# Round 1: logic and failure policy review of plan-v1

Reviewer seat: logic and failure policy (isolated, round 1).
Target: `attack/plan-v1.md`. Context: `docs/specs/2026-11-01-engine-design.md`.
Known gaps 1 to 7 are not re-reported.

Verdict: **REVISE.** Top finding: a wait is satisfied by any "turn ended", so
a lead that parks itself on a wait wakes its own waiter at once. Waiting
through more than one level (orchestrator, then lead, then worker) does not
work.

The plan passes the spec's state, wait, delivery and routing rules through
unchanged ("follow the spec's tables word for word"). The spec has no table
of which command or event is valid in which state. So most findings below
are gaps in the spec that the plan inherits. The plan has to close them
before units 5b, 5c and 6c are built, because tests 5.3, 5.6 and 6.7 cannot
assert behaviour nobody has defined.

Notation: "undefined" means neither the spec nor the plan says what happens.
"Spec" cites a section of the design document. "Plan" cites a criterion or
task id.

---

## Table 1: agent states and events

The rows are the current state. The columns are what arrives. Each cell gives
the next state, or the outcome the plan should define.

States: St = Starting, Wk = Working, Id = Idle, WP = Waiting on a permission,
WA = Waiting on an answer, Pa = Paused for a limit, In = Interrupted,
Cr = Crashed, Sp = Stopped.

### 1a. Events from the runner

| From | session opened | turn ended | permission requested | permission answered or cancelled | out of usage | signed out | adapter exits | service restart |
|---|---|---|---|---|---|---|---|---|
| St | Id, or Wk if a first prompt is queued | n/a | n/a | n/a | Pa (undefined: the session may not be open yet) | **undefined state** | Cr | In (reload has no session id yet, so undefined) |
| Wk | n/a | Id | WP | n/a | Pa | **undefined state** | Cr | In, then reload, then Wk with a carry-on prompt |
| Id | n/a | n/a | n/a | n/a | n/a | n/a | Cr | In, then reload, then Id |
| WP | n/a | n/a | WP (a second, parallel request: the state must be derived from a count, see finding 7) | Wk if no other request is open, else WP | Pa | undefined | Cr; open requests are cancelled | In; requests closed; reload; Wk with carry-on |
| WA | n/a | **depends on the undefined semantics of `ask`** (see the note below) | WP? Both states are true at once | n/a | Pa | undefined | Cr; the question's fate is undefined | In; the question's fate is undefined |
| Pa | n/a | n/a | n/a | n/a | Pa | undefined | Cr | In, then reload, then **Id**. The pause is lost, so the agent takes a delivery into an exhausted account |
| In | reload succeeds: Id or Wk | n/a | n/a | n/a | n/a | n/a | n/a | In (but the "was it mid-turn" fact is lost unless the event records the prior state, finding 10) |
| Cr | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Cr |
| Sp | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Sp |

### 1b. Commands

| From | `prompt` | `stop` | `resume` | `compact` | `answer` (to this agent's request) | `wait` (on this agent) |
|---|---|---|---|---|---|---|
| St | undefined; should queue | undefined; should go to Sp and kill the spawn | should refuse | should refuse | n/a | allowed |
| Wk | queue (spec rule 6) | Sp; ACP cancel, then kill | **should refuse; plan 5.3 does not test it** | undefined: queue or refuse? | n/a | allowed |
| Id | deliver: Wk | Sp | should refuse | Wk (a compact turn, whose end wrongly satisfies waits, finding 1) | n/a | **lost wakeup if the turn already ended (finding 2)** |
| WP | queue | Sp; the request is cancelled? (the spec says this only for crash) | should refuse | undefined | Wk | allowed |
| WA | queue? | Sp; the question is cancelled? undefined | should refuse | undefined | Wk or a delivery (undefined) | allowed |
| Pa | queue "until it can take it": **no event says when** | Sp | **refused by the command table (stopped or crashed only): Pa has no exit (finding 6)** | undefined | n/a | waits forever; no wake reason |
| In | queue (rule 6) | Sp | **allowed by rule 2, refused by the command table (contradiction)** | refuse | n/a | waits forever if the agent cannot reload |
| Cr | return to sender (rule 6) | undefined; should go to Sp, for retirement | St | refuse | n/a; already cancelled | should wake at once with "crashed" |
| Sp | **undefined** | idempotent? undefined | St | refuse | n/a | **never wakes: rule 1 wakes waiters on a crash only** |

### Exits from each state

| State | Exits | Problem |
|---|---|---|
| Paused for a limit | none defined | `resume` excludes it. Nothing writes "account usable again". A usable account depends on the clock, so a view that reads it breaks the rule that views are rebuilt from the log alone. |
| Interrupted, adapter cannot reload | `resume` only | The command table refuses this `resume`. |
| Signed out (this is not a state) | none | There is no state for an agent whose account signed out in the middle of a turn. |
| Crashed | `resume`, maybe `stop` | `stop` on a Crashed agent is undefined. |
| Stopped | `resume` | Deliveries queued for it are undefined. |

### Events valid in a state where they should be refused

The plan has no command-by-state precondition, so each of these passes the
plan's checks:

- `resume` of a Working agent.
- `compact` of a Working or Waiting-on-a-permission agent.
- `prompt` to a Stopped agent.
- `answer` to a request that was moved up, by the agent that held it before (finding 12).

Criterion 5.3 tests caller × command × target, but not × state.

### Note on `ask`

The spec does not say whether `ask` is either of these:

- **A blocking tool call.** The turn stays open and the state is WA. Codex's default MCP tool timeout is short, and a lost or restarted MCP connection loses the call.
- **A message followed by the end of the turn.** The answer then comes back as a delivery, and WA overlaps Idle.

The two choices give different rows above. Criterion 7.6, exit code 2 ("the
target is waiting on an answer"), implies that WA is visible to waiters. The
spec's wait does not.

---

## Table 2: permission request R, from asker W, routed to parent P

The columns:

- **Holder:** who holds R afterwards.
- **Answerable:** whether an answer can be given.
- **Exit:** whether R ever ends.

| Situation | Holder | Answerable | Exit |
|---|---|---|---|
| P stops | P's parent G, then the owner (rule 4) | G answers. Rights follow routing, not parentage. | Yes. But rule 4 moving R to the owner writes no "owner needed": capability 8 names only `pass-up` and `ask`. |
| P crashes | as for a stop | yes | Yes, if the move is in the same transaction as "agent crashed". The plan's reactor (5c.2) does it in a later transaction, so a crash between the two strands R with a dead holder. |
| P interrupted (service restart) | Restart closes all of W's requests, because W was running. | Closed. The owner's tap on a stale "owner needed" is refused. | Yes. W retries after the carry-on prompt, so the owner answers again (minor). |
| P interrupted and cannot reload, and W raises a new request after restart | P, held forever | Only the owner could answer, and is not told | **Never.** Rule 4 covers only stopped or crashed holders. |
| P paused for a limit | P. The delivery is queued "until it can take it". | Only the owner can answer, and is not told | **Never, if no reset time is known.** |
| P's account signed out | P | Only the owner, not told | Never |
| P busy in a long turn | P. The delivery is queued until the turn ends. | Yes, later | Yes |
| P is blocked in `lgtm wait` (CLI, criterion 7.6) on W | P. The delivery waits for P's turn to end. | **No:** P's turn cannot end until W finishes, and W is blocked on R | **Deadlock** |
| Owner and P answer at the same moment | The first writer wins (an "is it open" check inside the transaction) | One answer is taken and the other refused | Yes. But "is it routed to the caller" is checked outside the transaction (finding 12). |
| G answers after R moved up, while a stale P answers too | Same as above | P's answer can pass a stale authorization check | Yes. The wrong answerer may win. |
| W crashes while R is open | R is cancelled (rule 1) | No. An answer is refused. | Yes. But a delivery of R already queued for P is not withdrawn, so P spends a turn on a dead request, and the owner's phone alert is not taken back. |
| W stopped while R is open | undefined (rule 1 speaks only of a crash) | undefined | undefined |
| Service restart, with R open | closed | no | Yes |
| A question (`ask`) whose holder stops or crashes | the holder, unchanged | **No:** rule 4 is written for permission requests only | **Never** |
| R ever times out into a decision | | | Never. That is correct, and it matches rule 4. |

---

## Table 3: waits, deliveries and turns

The scenario: lead L waits on the set {A, B, C}. A crashes, B is interrupted by
a restart, and C finishes. L is busy, then stops.

| Step | What the spec and plan say | What goes wrong |
|---|---|---|
| L calls `wait` after C's turn has already ended | The reactor fires on "turn ended" (5c.2) | **Lost wakeup:** C never ends another turn. |
| A crashes | "Anyone waiting on it is woken once with the reason crashed." Its parent, L, "is told." | For a wait on all of the set, it is undefined whether the wait closes or keeps the crash as an outcome and stays open. L also gets two prompts: the crash notice and the wait wake. |
| The service restarts, and B is mid-turn | B is reloaded and gets a carry-on prompt. "Open waits stay open." | If B's turn had ended, but the service died before the reactor's separate transaction, recovery never re-evaluates the open wait, so the wake is lost. |
| B cannot reload | B stays Interrupted | The wait never wakes, and nobody is told. |
| C finishes | "wait satisfied", with one delivery to L | Correct, for this one level. |
| L is busy | The delivery is queued until L's turn ends | Correct. |
| L has a waiter of its own (its parent O waits on L) | L ends its turn to park on the wait | **O is woken at once** (finding 1). Every turn in which L only handles a delivered permission request also wakes O. |
| L stops before the wait is satisfied | undefined | The wait owned by a stopped L either stays open or closes. When it is satisfied, the delivery goes to a stopped agent, where rule 6 is undefined for stopped agents. |
| A delivery is written as "delivered", then the service dies before ACP takes it | Events are written before acting | **The message is lost while the log says "delivered".** On restart the agent looks mid-turn, so it gets "carry on" for a message it never received. |
| Carry-on prompt and older queued deliveries | undefined | The carry-on prompt either goes ahead of the queue or behind it, and either produces "delivered" or does not. |
| `compact` on a waited-on agent | A compact turn ends, which is a "turn ended" | It satisfies the wait wrongly, with the compaction as the "result". |

Where a wake can be lost: an edge-triggered wait, the reactor's separate
transaction, recovery not re-evaluating waits, a target that is stopped,
paused, signed out or cannot reload, a waiter that stopped, and a delivery
marked "delivered" before ACP accepts it.

Where a wake can be duplicated: the crash notice plus the wait wake, the
blocking CLI `wait` returning plus the delivered wake, a wait on all of the
set that stays open after a crash, and every parked or turn-costing
interstitial turn of a waited-on lead.

---

## Table 4: the "any account" picker

| Case | Spec or plan | Outcome |
|---|---|---|
| Tie on "fewest running agents" | no tie-break | The pick is not deterministic, so test 6.5 cannot be exact. |
| What "running" means | undefined | It is unclear whether Paused, Interrupted, Waiting and Starting agents count. |
| Two `start` calls arrive together | The pick reads the views before `append`. The semaphore guards only the append (4a.2). | Both pick the same account. Only the balance suffers (minor). |
| Every account is paused or signed out | undefined | The start should be refused, with the earliest known reset time. It should not be queued. |
| The account signs out during a turn | "The account is marked as needing sign-in. The owner is told." | **The agent's state is undefined.** No event marks the account usable after the owner signs in again. |
| A paused agent's reset time passes | Nothing writes an event, and nothing resumes the agent | **Inconsistent.** A pause "is not a failure", and rule 6 promises delivery "when it can take it". But no part owns waking it, `resume` excludes Paused, and the engine deliberately does not restart agents. |

---

## Table 5: request-id receipts

The receipts table is keyed by `request_id` alone (plan 4a.1).

| Case | Plan's behaviour | Correct behaviour |
|---|---|---|
| The same id from a different caller | The first caller's result goes to the second caller, and the second command never runs | Key the receipt by caller and request id together. |
| The same id with a different body | The old result is returned silently | Store a hash of the body. Refuse a mismatch with "request id reused". |
| A double tap that arrives concurrently | Both pass the receipt check before the write. The second insert fails on the primary key. If that failure is treated as a database failure (criterion 4.5), the engine refuses every command (rule 8). | Check the receipt inside the writer's critical section. A conflict on the primary key replays the receipt. |
| A refusal for lack of authorization | It is unclear whether a receipt is stored | Never store transient refusals (busy, disk, every account paused). An authorization refusal may be stored only under the caller-and-id key. |
| `start` resent after the agent crashed | It replays `{agentId}` | Acceptable, if documented: a receipt replays the result, not the current state. |

---

## Table 6: restart recovery order

The plan's order (7a.2): build layers, run migrations, run recovery (6c), open
the server. The order inside recovery is not given.

| Step | Required order | Hazard if the order is wrong |
|---|---|---|
| Migrations | first | none |
| Rebuild the views | second | none |
| Sweep orphans (6c.3) | **before any spawn.** Wait for each group to exit. Only sweep rows from earlier boots. | A sweep after the reload either kills an adapter that recovery just started (its start time matches its own row) or leaves the old adapter alive on the same session. Two processes then write to one Codex rollout. |
| Mark interrupted and close requests | before the reload, recording the prior state on the event | If the service crashes during recovery, the second recovery sees Interrupted, cannot tell whether the agent was mid-turn, and skips a reloadable agent or sends no carry-on. |
| Reload sessions and send carry-on prompts | after the sweep, in the background or blocking? | Blocking keeps the API down for N × the adapter's start time, and the pid-plus-port check (7a.3) then treats a live pid without a port as not running, so a second instance starts. In the background, a client's `resume` races the reload and gives two adapters for one agent. |
| Re-evaluate open waits and re-route held requests | missing | Lost wakes (Table 3). |
| Open the API | last | none |

---

## Table 7: parent-only rights

| Right | Lead L crashes or stops. Who acts on its worker W? |
|---|---|
| `answer` W's requests | The orchestrator O. Requests follow routing, so this works. |
| `answer` W's questions | Nobody but the owner. Questions do not move up. |
| `wait` on W | Nobody: O's `wait` covers only its own children. |
| `prompt`, `stop` or `compact` W | Only the owner |
| `resume` W after W crashes | Only the owner. W's crash notice goes to the dead L. |
| Replace L (the sheepdog, piece 4) | Impossible without orphaning L's team. There is no reparent or adopt. |
| Cascade | Undefined. The spec says "stopping or losing an agent cleans up everything under it". If that means child agents, rule 4's move-up never applies. If it does not, the workers are orphaned. |

The answer to question 7: parent-only rights do not break capability 7 for
permission requests, because answering follows routing. They do break it for
questions. They also break capability 10 and capability 2 for the
orchestrator, and they break piece 4's job of replacing a lead. Capability 9
is the owner's and is unaffected.
