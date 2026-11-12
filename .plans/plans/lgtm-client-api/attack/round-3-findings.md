# Review round 3 findings and how each was folded

This file lists every finding of review round 3, on commit `a7f1c9f`, with its fix,
its decision row and the criterion that checks it. Six reviewers found 0 blockers, 9
majors and 18 minors, with grades 6 to 7 and no refusals. The nine majors are five
distinct problems. Every fold of round 2 held. Everything is folded as contract version
11, and rows 158 to 175 of `decisions.md` record the choices.

## The five majors, for the owner

Round 3 is where majors go to the owner with their folds, and the owner decides whether
another round runs. Each major is below: what can go wrong, then what the fold does.

### 1. An agent cannot fetch an oversized event

- **What can go wrong:** A lead that follows its child's stream meets a marker for an
  event over 256 KiB, is refused the read, and loops at that point for ever.
- **What the fold does:** An agent may now read that event whole with `client.event`,
  under the same rule as its stream and inside the data envelope, and owner-only events
  stay closed to it.

### 2. The owner's wait can end on a state inside a batch

- **What can go wrong:** `lgtm client wait` can report "settled", or "needs you", on
  a state that existed only halfway through one engine write, because the stream does
  not show where a write ends.
- **What the fold does:** Before the wait ends for any reason, it makes one read that
  returns a sequence at the end of a write, catches up to that sequence, and decides
  again, with no timer and no polling.

### 3. The five-second acknowledgement shares a connection with large replies

- **What can go wrong:** On a phone with a slow link, a large reply delays the stream's
  acknowledgement past five seconds, so the connection closes and the same thing happens
  after every reconnect.
- **What the fold does:** A client that subscribes uses two WebSocket connections, one
  for the stream and one for everything else, and a live chunk closes at 256 KiB, though
  a reply large enough to miss two heartbeats, about 3 mebibytes at 500 kilobits per
  second, still cannot get through.

### 4. A piece's pure function can stop the engine

- **What can go wrong:** One thrown error in a function that the board or the roles add
  can stop every command, including `stop`, or leave an event in the log that stops every
  restart until the code is changed.
- **What the fold does:** Every call into a piece's table goes through one guard, which
  logs with no event text and returns a stated refusing answer, so the engine keeps
  running, and a test with a piece that throws from every table proves it.

### 5. An agent holder approves a title

- **What can go wrong:** A prompt-injected worker asks to run a dangerous command, and
  the lead that holds the request sees only a title such as "Run command", and allows it.
- **What the fold does:** The holder's delivery now includes the redacted input, or fixed
  words saying that it cannot be seen, a moved request gets the same text, and the pane
  viewer shows the same thing before an answer.

## One thing the owner should hear besides the majors

Threat model Opus TM3-6 is a minor, and the ruling says the owner is told. While the web
server is down, another local user can take its port, and serve the phone a long-cached
page that later passes every check against the real server. It is now a stated limit in
SECURITY.md and in the known gaps, and only authentication closes it.

Row 95, the owner's question 6, stays pending.

A finding that several reviewers report shares one decision row and one fix.

## Architect review, Sol (`round-3-architect-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| R3-A1 | major | An agent's stream can show a marker that the agent may not read, so it never gets past it. | `client.event` goes to agents, under the read rule, in the data envelope. | 158 | 3.8 |
| R3-A2 | minor | A display part is not bounded to 4 KiB, because an option's id has no limit. | A budget over the encoded part. An id is never cut, and what does not fit is left out and counted. | 171 | 3.1 |
| R3-A3 | minor | Unit 2 installs commands whose handlers come in later units, so the exact handler check cannot stay green. | Unit 2 defines the schemas and installs the events. Each later unit installs its own commands. Unit 3 comes before unit 7a. | 172 | 2.1, 2.7, 2.9, 3.1, 6.18 |

## Critic review, Sol (`round-3-critic-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| C3-01 | major | An agent cannot fetch an oversized event. | The same fold as R3-A1. | 158 | 3.8 |
| C3-02 | minor | The display fields do not imply a 4 KiB encoded bound. | The same fold as R3-A2. | 171 | 3.1 |

## Logic review, Sol (`round-3-logic-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| R3-L1 | major | An agent's marker recovery is refused. | The same fold as R3-A1. | 158 | 3.8 |
| R3-L2 | major | A split batch can end the owner's wait, on settled or on exit 2. | One gate before any end, with `client.sequence` when no piece has lists. | 159 | 3.10 |
| R3-L3 | minor | The snapshot's display budget is not by construction. | The same fold as R3-A2. | 171 | 3.1 |

## Threat model review, Sol (`round-3-threat-model-sol.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| TM3-1 (Sol) | major | The client cannot identify the committed batches on which its wait decision depends. With a lead as holder and no pieces, it ends on `QuestionAnswered` before `DeliveryQueued`. | The same gate as R3-L2. This reviewer's named test is in criterion 3.10. | 159 | 3.10 |

## Threat model review, Opus (`round-3-threat-model-opus.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| TM3-1 (Opus) | major | An agent holder approves a title, and a moved request and the pane viewer have the same problem. | The holder's delivery holds the input or fixed words. The view keeps the bounded input while the row is open, so a move gets the same text. The viewer shows it. | 162 | 1.42, 8.2 |
| TM3-2 | minor | Every Codex file edit reaches the page as a fixed title and a warning. | Bounded `locations`, and the thread items with the same `toolCallId` shown above Allow. The warning only when neither exists. | 174 | 1.42, 7.12 |
| TM3-3 | minor | `clear-token` silences the phone on the recommended server. | The alert about the clear is sent with the cleared value, up to five attempts. | 164 | 6.13, 6.17 |
| TM3-4 | minor | A dismiss stops or erases the push that a device caller cannot switch off. | A device caller's dismiss of this kind closes it on the page only. | 165 | 6.17 |
| TM3-5 | minor | An agent's snapshot is the remaining unwrapped path, and its sections have no test. | An agent gets identity rows, and no display part. The server wraps, and the reply is `{ requestId, data }`. The sections are tested. | 166 | 3.1, 3.3 |
| TM3-6 | minor | A squatter on the loopback port holds the trusted origin while the server is down. | A stated limit in SECURITY.md, the known gaps and the setup document. The owner is told. | 167 | 10.3 |
| TM3-7 | minor | "None" has no token rule, and a selected token can be missing from the store. | "None" clears the token in the same batch. A missing value is a failed attempt, shown as "token missing". | 168 | 6.14 |
| TM3-8 | minor | Unit 6b has no attack pass. | It has one, with criteria 6.12 to 6.15 as its scope. 53 launches. | 169 | 6.12 to 6.15 |
| TM3-9 | minor | A public request may carry a loopback `Origin`. | `Origin`, when present on a public request, must be the public address. | 170 | 10.1, 10.2 |
| TM3-10 | minor | An agent's filtered stream can stall at a state-bearing marker. | The same fold as R3-A1. | 158 | 3.8 |

## Logic review, Opus (`round-3-logic-opus.md`)

| Finding | Severity | What was wrong | Fix | Row | Criterion |
|---|---|---|---|---|---|
| Major 1 | major | The acknowledgement deadline shares a connection with large replies, so marker recovery can loop for ever on a slow link. | Two connections, a 256 KiB live chunk, both counted in the cap, each with a heartbeat. The remaining limit is in the known gaps. | 160 | 2.7, 3.9, 5.11, 7.14 |
| Major 2 | major | The stream shows no batch, so the owner's wait can end on a state that never existed. | The same gate as R3-L2. This reviewer's three rows are the tests in criterion 3.10. It settles the conflict with the roles' promise. | 159 | 3.10 |
| Major 3 | major | The pieces' pure functions run inside the engine's core with no failure policy. | Section 1's rule, one guard, and the reviewer's fallback table. A fixture piece throws from each table. | 161 | 1.44, 6.4 |
| Minor 1 | minor | An agent may call `client.subscribe` but not `client.event`. | The same fold as R3-A1. | 158 | 3.8 |
| Minor 2 | minor | The old-carrier alert contradicts the rule that the carrier resolves only the active token. | The rule names its one exception, and the boundary test allows exactly that path. | 164 | 6.13 |
| Minor 3 | minor | After a stop and a resume, a stale request ends every owner's wait, with no alert. | `stop` writes `PermissionCancelled` with a withdrawal. This closes the stop part of issue 74. | 163 | 1.45, 6.2 |
| Minor 4 | minor | The snapshot's display part is not bounded by construction. | The same fold as R3-A2. An unknown kind shows as "unknown". | 171 | 3.1 |
| Minor 5 | minor | The withdrawal rule leaves out the engine's own withdrawals. | Any batch with a `DeliveryWithdrawn`, in one place, in `withWaitChecks`' first step. | 173 | 1.43 |

## The reviews' proposed post-build checks

Each proposed check became a criterion, a post-build check, or a case in an existing one.
Row 175 records the choice.

| Proposed check | Where it went |
|---|---|
| Agent marker recovery with real frames (architect, critic C3-PB-01, logic Sol R3-PB-01) | Criterion 3.8 |
| Snapshot encoded budget (architect, critic C3-PB-02, logic Sol R3-PB-03) | Criterion 3.1 |
| Unit composition at each boundary (architect) | Criteria 1.3 and 2.1, at each installing unit |
| Snapshot publication (architect) | Criterion 1.7, already held by edit E9's barrier test |
| Transaction boundaries in owner waits (architect, logic Sol R3-PB-02, Sol TM3-PB2) | Criterion 3.10 |
| Recovery not blocked by its own stream (Sol TM3-PB1, architect, critic C3-PB-03, logic Sol R3-PB-04) | Criteria 3.9 and 7.14 |
| Security folds through the real adapters and page (Sol TM3-PB3, critic C3-PB-08) | Criteria 1.42 and 7.12, with PB-2, PB-4, PB-5 and PB-14 |
| Piece batches and fresh reach (architect, critic C3-PB-06, logic Sol R3-PB-05) | PB-12 and criterion 1.43. The board's and roles' parts go to those plans. |
| Durable callers and migrations (architect) | Criterion 1.30 |
| Token lifecycle (architect, critic C3-PB-04, logic Sol R3-PB-06) | Criteria 1.39, 6.14 and 6.17 |
| Alert generation and outages (architect, critic C3-PB-05) | Criterion 6.11 |
| First start and returning questions (architect, critic C3-PB-07) | Criteria 6.2 and 6.16 |
| Real browser, proxy and pane (architect) | PB-2, PB-3 and PB-9 |
| Real phone on a throttled link (logic Opus R3-PB-1) | PB-15 |
| A page asleep for an hour (logic Opus R3-PB-2) | PB-16 |
| A carrier change with 500 open alerts (logic Opus R3-PB-3) | PB-17 |
| The throwing piece on a real log (logic Opus R3-PB-4) | PB-18 |
| Real permission requests per harness and kind (threat model Opus) | PB-14 |
| A secret across the 8 KiB boundary (threat model Opus) | Criterion 1.42 |
| WireGuard up after the service starts (threat model Opus) | PB-19 |
| A hidden oversized sequence through an agent's stream (threat model Opus) | Criterion 3.8 |
| An inbound frame inflating past 1 mebibyte (threat model Opus) | PB-20 |
| Bidirectional text and whitespace in an input on a 360-pixel screen (threat model Opus) | Criterion 7.12, and unit 7b's attack pass |
| An agent's snapshot sections (threat model Opus) | Criterion 3.1 |

Logic Opus's "noted, not filed" item on placeholder envelopes is folded too: a piece's
reducer reads the event and the sequence only (section 1, edit E6).
