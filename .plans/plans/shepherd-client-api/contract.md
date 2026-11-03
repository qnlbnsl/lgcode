---
topic: shepherd-client-api
kind: contract
status: v2, awaiting the lead's freeze; the extension seam is pending the owner
version: 2
updated: 2026-11-03
---

# The client API contract that the other pieces build on

## What this document is

This document fixes the surface that Shephrd's message board (piece 3) and
foundry roles (piece 4) build on. It covers seven things:

1. How a piece adds its own commands and events.
2. The four kinds of caller, and what each may do.
3. How a client subscribes, reads, and what it sees.
4. How an "owner needed" event becomes an alert.
5. Request ids, cursors and the transports.
6. What the engine must offer for all of this to work.
7. What the other two pieces asked for, and where each is answered.

It does not depend on the four open design questions: how the phone reaches
Shephrd from outside the house, how phone alerts are carried, whether
Shephrd's own Unix user comes first, and whether an alert link can answer a
question by itself. Where one of those touches this contract, the contract
leaves a named slot and says so.

The decision log is `decisions.md` in this folder. Row numbers below refer to
it. The engine anchors are in `scouting.md`. Everything here is a plan; none
of it is built.

Abbreviations: RPC means remote procedure call, one request and its reply.
MCP means the Model Context Protocol, the way agents get Shephrd's tools. CLI
means the `shephrd` command-line tool.

## One part depends on an answer from the owner

The engine, as built at commit `8ff4c9b`, has no way for another piece to add
a command or an event. Its server, client library, command-line tool and
command handler each list the engine's sixteen commands by hand, and its
event union is closed (scouting, scout 1, items 1 and 2). The engine also
knows only two callers, the owner and agents, so it cannot record a
Shephrd service under its own name.

The engine's design says the other pieces are built "on top of the engine
without changing it" (owner-approved design, 2026-11-01). So this contract
assumes one engine unit, **the extension seam**, built first, as the first
unit of the client API plan. The lead sent the seam, the service caller and
the board's matching question to the owner as one question, on 2026-11-03,
recommending it under this rule (row 31):

> No existing command, event, state, reply, rule or test changes.

The seam keeps that rule. Where it adds a variant to an existing schema,
section 6 says so, and every existing test still passes unchanged.

This contract is written on the assumption that the owner agrees. If the
owner refuses, sections 1, 2 and 6 change, and the lead receives a revised
contract before anyone builds on it.

## 1. How a piece adds its own commands and events

### Namespaces

Each piece owns one namespace (row 11):

| Piece | Namespace |
| --- | --- |
| 2. The client API | `client` |
| 3. The message board | `board` |
| 4. The foundry roles | `roles` |
| Engine test commands (existing) | `debug` |

The engine's own commands and events keep their current names, with no
namespace.

- A piece's command is named `<namespace>.<name>`, such as `board.post` or
  `client.pair`. The piece builds its command group without the prefix and
  applies it with Effect's `RpcGroup.prefix("<namespace>.")`.
- A piece's event tag is `<namespace>.<PascalName>`, such as
  `board.PostAdded`. The event's `_tag` field holds the full name.
- An engine name never contains a dot, except the existing
  `debug.compare-views`.
- Effect's `RpcGroup.merge` silently replaces a command whose name is
  already present (Effect 4.0.5, `RpcGroup.ts:269`). So a test in the
  composition package asserts that every command name and every event tag in
  the full API is unique.

### Where the schemas live

Each piece has one contracts package (row 12):

| Package | Owner | Depends on |
| --- | --- | --- |
| `packages/contracts` | The engine (exists) | Effect only |
| `packages/client-contracts` | Piece 2 | `packages/contracts` |
| `packages/board-contracts` | Piece 3 | `packages/contracts`, and `packages/client-contracts` only for its alert types |
| `packages/roles-contracts` | Piece 4 | `packages/contracts`, and the board's or client's contracts where it needs their types |
| `packages/api` | Piece 2 | All four contracts packages |

A piece's contracts package exports exactly these five things:

1. **`<Namespace>RpcGroup`**: its commands, already prefixed. Every payload
   has a `requestId` field, and every reply and error carries it back, as
   the engine's commands do (`packages/contracts/src/commands.ts:24`).
2. **`<Namespace>Event`**: one Effect Schema union of its event structs, each
   with a namespaced `_tag`.
3. **`<namespace>Access`**: for every command, the set of caller kinds that
   may call it, out of `owner`, `device`, `agent` and `service` (section 2).
4. **`<namespace>Visibility`**: for every event tag, its visibility class
   (section 3).
5. **`<namespace>AlertSources`**: the events that raise or end an owner
   alert, if any (section 4). This is optional.

`packages/api` is the composition package. It exports these four things:

- **`ApiRpcGroup`**: the engine's served group merged with every piece's
  group.
- **`ApiEvent`**: the union of the engine's `Event` and every piece's event
  union.
- **`ApiEventEnvelope`**: the engine's envelope with `event: ApiEvent`.
- **`apiAccess`**: the merged access table.

The client library, the command-line tool, the MCP tool server, the web page
and the pane viewer import `packages/api`, not the separate packages.

### What a piece gets for free

Once a piece's group is in `ApiRpcGroup`, it gets four things without more
code:

- **A command-line subcommand.** Each command becomes
  `shephrd <namespace> <name>`. The engine's existing parity test is
  extended to the full API.
- **An MCP tool.** Each command whose access includes `agent` becomes one
  of the agents' tools. Commands without `agent` are never offered to
  agents.
- **Request ids and receipts.** The engine's receipts store handles a resent
  request (section 5).
- **Secret removal.** Every event a piece writes passes through the engine's
  redactor before it is stored, as the engine's own events do.

### How a piece's command runs

A piece's handler never writes to the database itself. It runs inside the
engine's command transaction through the seam:

1. The engine identifies the caller and checks the piece's access table.
2. The engine checks the request id against the receipts.
3. The piece's handler reads a consistent snapshot of the views, the
   engine's and its own, and returns the events to write.
4. The engine writes those events, the receipt and any side rows in one
   transaction, after redaction.

A piece's events may include engine events that the engine already knows
how to produce, such as queuing a delivery to an agent, through planning
helpers the seam exports. A piece cannot write an engine event that the
engine's own rules would refuse. The engine checks every engine event a
piece returns against its state table, as it checks its own.

### Views and reactors

- **Views.** A piece may keep its own view: an initial value and a pure
  function that applies one event. The view is rebuilt from the log at
  start-up and is included in the engine's rebuild check, so "the log is the
  whole truth" holds for every piece.
- **Side tables.** A piece that must keep a value outside the log, such as
  a hashed pairing code, keeps it in its own tables, named `<namespace>_*`,
  created by its own migrations, which the seam runs.
- **Reactors.** A piece may react to committed events, for example piece
  2's alert reactor. A reactor reads events in sequence order and writes its
  own events through the same transaction path. It records the last
  sequence it handled in its own view, so after a restart it resumes from
  there. It must be safe to run twice on the same event, because a crash
  can come between reading and writing.

### Paged reads

A piece may offer read commands whose reply is a page of records, such as
the board's `board.read` or the client API's `client.thread` (row 32). Every
paged read follows one shape:

- The request carries `requestId`, an `after` cursor and a `limit`.
- The reply carries `requestId`, the `items`, and `next`, the cursor to
  pass as `after` for the following page. `next` is absent on the last
  page.
- A cursor is opaque to the client. A piece may use a log sequence number
  or its own record id inside it.
- `limit` has a maximum that the piece states. A larger `limit` is reduced
  to the maximum, not refused.
- A paged read applies the same visibility rule as `subscribe` and is not
  deduplicated.

## 2. The four kinds of caller

| Kind | Credential | Reaches Shephrd through | May call |
| --- | --- | --- | --- |
| Owner | The owner credential file in the state folder | The engine's Unix socket only, with the engine's ancestry check | Every command whose access includes `owner` |
| Paired device | Its own device credential, prefix `shp_d_` | The network listener (piece 2), or the Unix socket | Every command whose access includes `device` |
| Agent | Its own agent token, prefix `shp_a_` | The engine's Unix socket only, through MCP or the CLI | Every command whose access includes `agent`, under the engine's tree rules |
| Service (pending the owner) | None. A service exists only inside Shephrd's own process | The seam's in-process command path only | The fixed list under "Services" below, and any piece command whose access includes `service` |

These rules apply to the four kinds:

- **A device has the owner's rights, except for a host-only list.** The
  engine already treats a device as the owner (`CommandHandler.ts:207`), and
  AGENTS.md rule 5 says a web or mobile client is never a second-class
  citizen. The proposed host-only list has two entries: creating a pairing
  code, and changing the network listener's settings. A stolen phone then
  cannot add more devices, which would survive its own revocation. This
  list is open and goes to the lead as question Q2 (row 23). Until the lead
  answers, it is the assumption.
- **The network listener accepts device credentials only** (row 14). The
  owner credential is refused there, because the owner's proof rests on the
  Unix socket and its ancestry check. Agent tokens are refused there,
  because agents always run on the host.
- **The pane viewer is the owner.** The thread viewer in a Herdr pane uses
  the owner credential over the Unix socket, exactly as the owner's terminal
  does (lead ruling L4, row 7).
- **An agent's rights over other agents are the engine's.** A piece's
  agent-callable command that acts on another agent checks the engine's
  rights rule (the agent itself, or an agent it holds a parent's rights
  over), through a helper the seam exports. A piece does not invent its own
  tree rule, with one exception below.
- **One exception: a piece's delivery may reach outside the caller's tree**
  (lead ruling L13). A delivery that a piece queues with its own
  `{ namespace, id }` source (section 6, item 11) may reach a target
  outside the calling agent's tree, but only when that piece's registered
  reach check allows it. For the board, the reach check is channel
  membership, so a worker can message a sibling in the same channel. The
  reach check is a pure function of the caller, the target and the views
  snapshot taken in the same transaction as the delivery, like a
  visibility rule (lead ruling L15). The exception grants no lifecycle right: it never
  allows `stop`, `answer`, `compact`, `resume` or an engine `prompt` on the
  target. A piece's delivery carries the piece's label as its sender (section 6,
  item 14), never "owner". The piece must name each item's true author in
  a header built only from fixed words and the engine-authenticated caller
  id, never from agent text. This holds also for wakes the piece builds
  with no caller, such as one wake that merges several posts (lead ruling
  L16). The text is still wrapped as data
  (section 6, item 14).
- **The engine's own access is unchanged.** `accounts`, `accounts
  set-secret`, `accounts mark-available`, `harnesses` and
  `debug.compare-views` stay owner-only, which includes devices. `ask`,
  `wait` and `pass-up` stay agent-only. Owner choice A10 makes `wait`
  agents-only (row 4).
- **A device acts as the owner, and the log also says which device.**
  Today a device's command is recorded with the caller "owner" (scout 1,
  item 4), and that stays: the envelope's `caller` is still `owner`, and a
  device's receipts stay in the owner's scope. The seam adds one optional
  envelope field, `device`, holding the device's id, so the owner can see
  which phone answered a request (row 33). This is additive: no existing
  value changes, and an envelope written by the owner's terminal has no
  `device` field. A piece that records an author, such as the board's
  post author, records the owner and reuses this field for the device; it
  adds no field of its own.

### Services

A service is Shephrd's own code acting on the owner's behalf with narrow,
fixed rights: the foundry roles' sheepdog and their standing-rule answerer
(lead ruling, row 27). These rules are pending the owner, with the seam:

- **It is in-process only.** A piece registers its services by name when
  the service starts, such as `roles.sheepdog` or `roles.standing-rules`.
  A service calls the command path directly through the seam. No service
  credential exists on the wire or on disk, so there is nothing to steal.
  The Unix socket and the network listener never accept one.
- **The log records it under its own name.** The envelope's `caller` gains
  one new variant, `service { service, rule? }`. For example, an answer
  from standing rule 4 is recorded with the caller
  `{ service: "roles.standing-rules", rule: "4" }`. `PermissionAnswered`
  itself does not change.
- **Its receipts are its own.** They are kept under the key
  `service:<name>`.
- **It may call exactly these engine commands:**
  - `subscribe`, seeing every event, as the owner does;
  - `prompt`, to any agent, as a nudge. The text is wrapped as data, a
    leading `/` is escaped as it is for agents' prompts, and the sender is
    shown as the service;
  - `compact`, on any agent, under the engine's state table;
  - `resume`, on any agent, under the engine's state table;
  - `answer`, with a one-time allow only. The answer is refused when the
    chosen option would save a permission rule ("allow always"), or when
    it is above the asking agent's own permission mode.
- **Everything else is refused,** including `start`, `stop`, `group`,
  `pass-up`, `ask`, `wait`, `accounts`, `harnesses`, `debug.compare-views`,
  and any piece command whose access does not include `service`.
- **Its text is still data.** A service's prompt is never treated as the
  owner's. It cannot change permissions, teams or settings (SECURITY.md
  rule 7).

## 3. How a client subscribes, and what it sees

### Starting, and staying current

1. **Snapshot.** The client calls `client.snapshot`. It returns the current
   picture and the sequence number it was taken at: agents and their
   displayed states, open permission requests and questions, open alerts,
   accounts without secrets, devices without credentials, and each piece's
   own snapshot section under its namespace (row 15). A piece supplies its
   section through a per-caller hook, `snapshotFor(caller, view)`, which
   may leave the section out (lead ruling L15). The board's section is its
   whole view for the owner, devices and services, and absent for an
   agent.
2. **Subscribe.** The client calls the engine's `subscribe` with
   `after` set to that sequence number. It receives every later event it
   may see, in order, with no gaps, then each new event as it is written.
3. **Resume.** After a dropped connection, the client subscribes again from
   the last sequence it received. The engine's client library already does
   this. If the engine answers that the cursor is ahead of the log's head,
   the client takes a new snapshot.

A client that cannot use the whole stream, such as a phone on a mobile
network, calls `client.subscribe` instead (row 16). It takes the same `after`
cursor plus a filter: a list of agents, a list of group labels, and a list
of event kinds. A group filter is checked against the agent's groups in the
views at the moment of each event, so an agent that joins a group later is
included from that event on (row 30). It sends
only the events that pass both the visibility rule and the filter. While it
skips events, it sends a `client.Checkpoint` carrying the latest sequence at
least every 30 seconds. So the client's cursor keeps moving, and a reconnect
does not re-scan what was skipped.

The transport closes a subscription that falls 2,048 events behind, or that
leaves a chunk unacknowledged for five seconds (issue 41). The client
reconnects from its cursor. The network listener also sends a heartbeat,
more often than a reverse proxy's idle timeout, which is set in piece 2's
settings.

### What each caller sees

Every event has one visibility class, set by the piece that owns it:

| Class | Who sees it |
| --- | --- |
| `agent-scoped` | The owner, every device and every service. An agent sees it only when the envelope's `agentId` is the agent itself or an agent it holds a parent's rights over. This is the engine's existing rule. |
| `owner-only` | The owner, every device and every service. Never an agent. |
| `piece-decided` | The owner, every device and every service. An agent sees it when the owning piece's pure rule says so, given the caller, the envelope and the views. |

The engine's own events keep their current behaviour. An engine event with
an `agentId` is `agent-scoped`. An engine event without one is `owner-only`
(issue 164 stands).

An event with no visibility class declared is `owner-only`. The board's
events are `owner-only` (row 34): owner devices see them in their live
stream, and agents read the board through the board's own commands, not
through `subscribe`. The client API never widens the engine's agent filter
for another piece's events. `piece-decided` stays available to any piece
that needs it later.

Two rules apply to every piece:

- **A piece-decided rule is a pure function of the caller, the envelope and
  the views.** It reads no clock and no file. So a snapshot, a live
  subscription and a rebuilt log always agree on what a caller sees.
- **A snapshot is filtered by the same rule as the stream.** An agent's
  snapshot holds only what its subscription would show.

### Reading the roster and a thread

Two read commands serve callers that need the current picture or one
agent's history without holding a subscription open. Both are reads, so
they are not deduplicated, and both use the same visibility rule as
`subscribe`.

**`client.roster`** (row 25) lists agents. Each entry holds:

- the agent's id, name, role and groups;
- its parent's id and name;
- its lifecycle state and its displayed state;
- its counts of open permission requests and open questions;
- its harness, account id, model, effort and permission mode;
- its folder, its ACP session id, and its start time.

The request may filter by group, by role, and by parent. Access is
`owner`, `device`, `agent` and `service`:

- The owner, every device and every service see every agent.
- An agent sees itself and every agent it holds a parent's rights over,
  which is the engine's own visibility rule. Its own entry names its
  parent, so `orient` can answer "who is my parent" without seeing the
  parent's record.
- An agent does not see its grandchildren. The roles planner asked for a
  whole subtree. That is wider than what the engine lets an agent
  subscribe to, and a roster that shows more than `subscribe` would let
  the two disagree. A lead that needs its workers' workers asks its
  workers, as the engine's design says.

**`client.thread`** (row 26) reads one agent's thread events, in order,
from a sequence number, one page at a time. A page holds at most 500
events and returns the cursor for the next page. It follows the
paged-read shape in section 1. Access is `owner`, `device`, `agent` and
`service`, with the same visibility rule. Exporting a thread
to a file is a client-side feature: `shephrd thread export <agent> --out
<file>` pages through `client.thread` and writes the file on the caller's
side. The service never writes a file on a caller's behalf, because a
remote caller must not be able to choose a path on the host.

### Events a client does not know

A client decodes the envelope first and the event second. An event whose tag
it does not know becomes an "unknown event" record, holding the tag, the
namespace and the sequence. The client moves its cursor past it and never
fails on it (row 17). So a web page built before the board exists keeps
working once the board writes events.

### Waiting, for owners and devices

There is no `wait` command for the owner or a device (row 4, lead ruling L1).
The client library offers a helper, `waitForAgents`, that takes a set of
agents and "any" or "all". It takes a snapshot, subscribes, and finishes when
the agents meet the same "settled" test the engine uses for agent waits. The
seam moves that test from the engine into the engine's contracts package,
so the helper and the engine share one copy and cannot disagree. The helper
also applies every registered hold-unsettled condition (section 6, item
12), so the owner's wait and an agent's wait agree (lead ruling L15). Each
piece exports its condition from its contracts package as a pure function
over its own snapshot section. So the helper needs a caller whose snapshot
holds those sections: the owner, a device or a service. The owner's
terminal waits with a new subcommand, `shephrd client wait`, which runs
this helper over `subscribe`. The engine's own `shephrd wait` and its
owner-choice A10 test stay as they are.

## 4. From "owner needed" to an alert

### Where alerts come from

The engine writes `OwnerNeeded { agentId, reason, subject? }` in three
places (scouting, planner's checks):

| Engine reason | When | Alert kind |
| --- | --- | --- |
| "request needs the owner", with a permission subject | A permission request's holder becomes the owner | `approval` |
| "request needs the owner", with a question subject | A question's holder becomes the owner | `question` |
| "agent crashed" | An agent whose holder is the owner crashes | `failure` |
| "account needs sign-in" | An account is signed out | `account` |
| "account is out of usage, no reset time known" | An account runs out of usage with no reset time | `account` |

A contract test pins these five reasons. If an engine reason changes, the
test fails, instead of an alert being lost quietly. An unknown reason still
raises an alert, of kind `other` (row 20).

Other pieces raise alerts by declaring an alert source. A source is a pure
function that takes one envelope and returns either nothing, a request to
raise an alert, or a request to end one. For example, the foundry roles
would declare that their "stall reached the owner" event raises an alert of
kind `roles.stall`. A piece's alert kinds are namespaced. A piece never
sends a phone alert itself, and a piece never writes the engine's
`OwnerNeeded` event (row 35). If a piece wrote `OwnerNeeded` and declared
its own source, the owner would get two alerts for one matter.

The message board declares one kind, `board.post` (row 35). It is raised by
the board's own event for a post that needs a reply from the owner, with
the key `post:<postId>`, and it ends when the board records that post as
answered or closed. Its alert carries the post's id as its subject, so a
tap opens the post. The board asked instead for a `post` subject on the
engine's `OwnerNeeded`. That is refused, because it would change an
existing engine event, which the additive rule forbids, and because the
alert source gives the same result. `board.post` is pushed to the phone by
default.

A piece raises an owner alert only for a matter that has reached the
owner. A notice meant for an agent, such as a lead, goes through the board,
not through alerts.

The foundry roles declare four kinds (row 28). Whether each one is pushed
to the phone, or only shown inside the clients, is the owner's alert
setting. Its defaults are:

| Kind | Raised when | Pushed to the phone by default |
| --- | --- | --- |
| `roles.stall` | A stall has reached the owner | Yes. Research item 11 names it. |
| `roles.replace` | The sheepdog asks the owner to replace a worker | Yes. It needs an owner decision. |
| `roles.runaway` | Work has run far past its expected length | No. It is shown in the clients. |
| `roles.rule-first-use` | A standing permission rule is used for the first time | Yes. An automatic allow is security-relevant, so the owner sees its first use. |

The engine's own kinds (`approval`, `question`, `failure`, `account`) are
pushed by default.

### The alert's life

Piece 2's alert reactor reads committed events in order (row 18):

1. **Raise.** When a source asks for an alert, the reactor writes
   `client.AlertRaised { alertId, key, kind, agentId?, subject?, title,
   sourceSequence }`. The `key` names what the alert is about, such as
   `permission:<id>`, `question:<id>`, `crash:<agentId>:<sequence>` or
   `account:<id>`. Only one alert is open for each key at a time.
2. **Deliver.** Piece 2 sends the alert to the owner's phone by a channel
   that the design round chooses. Each attempt is recorded as
   `client.AlertDelivered` or `client.AlertDeliveryFailed`, with the
   channel and the attempt number, never the channel's credentials.
3. **Clear.** The reactor writes `client.AlertCleared { alertId, cause }`
   when the alert's subject closes, or when the owner dismisses it with
   `client.alerts.dismiss`.

An alert's subject closes in these ways:

| Kind | Closes when |
| --- | --- |
| `approval` | `PermissionAnswered` or `PermissionCancelled` for that request |
| `question` | `QuestionAnswered` for that question |
| `failure` | The crashed agent is resumed or stopped |
| `account` | `AccountAvailable` for that account |
| A piece's kind | The end its own source declares |

This answers issue 65 without an engine change: an alert ends when its
subject closes, and the client API writes that end into the log. A request
never moves back down from the owner (engine row 51), so a move never ends
an alert.

### What an alert may carry

An alert that leaves the host carries only four things: its kind, the
agent's name, a title that Shephrd writes from fixed text, and a link to
the page (row 19). It never carries any other agent text, tool output, file
contents or any secret. The owner reads the details inside an
authenticated client.

The agent's name is agent-chosen text: the agent's parent chose it (lead
ruling L15). So it is treated as data. It travels in its own field, marked
as the agent's name, never inside Shephrd's title. Control and formatting
characters and line breaks are removed, and it is cut to 64 characters.

Whether that link can answer a question by itself is one of the four
design questions. This contract leaves a named slot for it,
`AlertRaised.actions`, which stays empty until the design note decides.

## 5. Request ids and cursors

**Request ids** (row 21):

- Every command payload carries `requestId`. Clients mint a random UUID
  (universally unique identifier) for each action the owner takes, such as
  one tap on Allow, and reuse it on every resend of that action.
- Receipts are kept per caller: the owner (which includes every device,
  as today), each agent, and each service.
- The same caller sending the same id with the same body gets the first
  reply again, and nothing acts twice. The same id with a different body is
  refused with "request id reused".
- A piece's commands use the same receipts, through the seam.
- `subscribe`, `client.subscribe` and `client.snapshot` are reads, and are
  not deduplicated.
- A command's reply carries its `requestId`. It does not carry the
  sequence number it committed (`commands.ts:26`). A client learns the
  effect of its command from the stream.

**Cursors:**

- A cursor is an `EventSequence`, a whole number of zero or more. Zero
  means "from the start".
- Sequence numbers are gapless and increase by one. One number covers the
  engine's events and every piece's events, because they share one log.
- A client resumes after the last sequence it received.
- A cursor that is negative, not a whole number, or ahead of the log's head
  is refused, and the client takes a new snapshot.
- `client.Checkpoint` carries a cursor too. It is not an event in the log;
  it is a marker in a filtered stream.

**Transports** (row 36):

- **Every command on every transport.** The engine's Unix socket and piece
  2's network listener both serve the whole `ApiRpcGroup`, generically. A
  piece's command needs no transport code of its own. The engine's socket
  already dispatches every command in its group this way
  (`api/server.ts`, `application`).
- **Message size.** The network listener sets an explicit limit of 1
  mebibyte (1,048,576 bytes) for one message. The limit is sized against
  the largest single event or reply any piece can produce, not against a
  post's text (lead ruling L15). Each piece states its largest event and
  its largest page. The board caps a wake body at 256 KiB and a
  `board.read` page at 512 KiB of encoded text, so its largest message,
  with its envelope, stays under 1 MiB. A test in `packages/api` checks
  every piece's stated maxima, plus the envelope, against the limit. The
  engine's socket sets no explicit limit today (scouting, planner's
  checks) and the seam does not add one there.

## 6. What the engine must offer (the extension seam, pending the owner)

These are the engine changes the contract assumes. They follow the
additive rule: no existing command, event, state, reply, rule or test
changes, and every existing engine test, the acceptance suite and the
rebuild check pass unchanged. Items 6, 10 and 11 add a variant or an
optional field to an existing schema; no existing value changes meaning.

1. **A registry of pieces at service start-up.** The service is built from
   the engine plus a list of pieces. Each piece supplies its group, events,
   access table, visibility table, handlers, view, migrations, reactors and
   alert sources.
2. **The composed group served.** The server, the command handler's
   supported list, the client library, the CLI and the MCP tool list read
   the composed group instead of the engine's group alone.
3. **Transactions for pieces.** A piece's handler runs inside the engine's
   transaction, with the snapshot, the receipts and the redactor, as in
   section 1.
4. **Events from pieces in the log.** The log accepts and stores a piece's
   namespaced events. The engine's own views ignore tags they do not own,
   and each piece's view is folded and included in the rebuild check.
5. **Visibility from pieces.** The subscription filter uses each event's
   visibility class (section 3).
6. **The acting device.** The envelope gains an optional `device` field.
   The `caller` stays `owner`, and a device's receipts stay in the owner's
   scope (section 2).
7. **A view snapshot at a sequence number,** consistent with the log, for
   `client.snapshot`.
8. **Exported helpers:** the rights rule and the engine planners a piece
   may call, such as queuing a delivery. The settled test moves into
   `packages/contracts`, so the client library can use it without
   importing the engine.
   The settled test keeps a re-export at its old place, so existing tests
   are unchanged.
9. **A paged read of one agent's events** from a sequence number, for
   `client.thread`, using the log's existing per-event agent column.
10. **The service caller.** The `caller` union gains a `service { service,
    rule? }` variant, the command handler gains the service rights in
    section 2, and the seam's in-process command path accepts registered
    services only.
11. **A delivery source from a piece.** A delivery a piece queues names
    its source as `{ namespace, id }`, a new variant of the delivery's
    `source`, so the piece's rule decides what happens to it when its
    target stops. The board needs this for posts. Existing sources
    (permission, question, wait) keep their rules.
12. **A registered "hold unsettled" condition** (lead ruling L10, from the
    board's question Q2, added at the freeze of v2). A piece may register
    a condition that the engine's settled test in `routing/waits.ts`
    consults: while the condition holds for an agent, that agent is not
    settled. The board registers one: an agent with an open post of its
    own that needs a reply is not settled. The condition is a pure
    function of the agent and the views, like a visibility rule. With
    nothing registered, the settled test behaves exactly as today.
13. **A piece may withdraw its own queued delivery** (lead ruling L11,
    from the board's request, board post #37). A piece's handler may
    return the engine's existing `DeliveryWithdrawn` event for a delivery
    whose source is the piece's own namespace, and only while that
    delivery is still queued (narrowed by lead ruling L15). The engine checks both conditions inside the transaction and
    refuses the whole command otherwise. A delivery that was sent or
    accepted cannot be withdrawn this way, and a piece can never withdraw
    another piece's or the engine's delivery.
14. **The delivery helper takes a piece's body and sender label**
    (lead ruling L11). A piece queues a delivery through the seam's helper
    with its text body and a sender label, such as "board". The label is
    shown as the piece, never as the owner or an agent. The engine always
    wraps the body in its agent-text envelope, with a fresh random marker,
    and escapes a leading `/`. A piece can never send a raw prompt.
15. **A piece's reach check** (lead ruling L13). A piece may register one
    reach check. The engine consults it only for a delivery the piece
    queues with its own source, when the target is outside the calling
    agent's tree (section 2). Its inputs are the caller, the target and the
    views snapshot of the same transaction, never an earlier read (lead
    ruling L15). It grants no other right.
    The engine checks it twice (lead ruling L19). It checks it first when
    the piece queues the delivery. The delivery dispatcher checks it again
    inside the send transaction, against the views snapshot at send time.
    A delivery that fails the second check is withdrawn with
    `DeliveryWithdrawn` and never sent. With nothing registered, dispatch
    is unchanged, and every existing engine test passes unchanged.
16. **A registered "request held" condition** (lead ruling L15), the
    incoming twin of item 12. The engine already ends a blocking `wait`
    with "request held" when the waiter holds an engine request or
    question (`routing/waits.ts`, `holds`). A piece may register a matching
    condition; the board's is "the waiter is an addressee of an open post
    that needs its reply and has not answered it". The engine checks it
    when the wait opens and after every batch, as it checks `holds`. With
    nothing registered, behaviour is unchanged.
17. **A per-caller snapshot hook** (lead ruling L15). Each piece supplies
    its `client.snapshot` section through `snapshotFor(caller, view)`,
    which may return nothing for a caller (section 3).

The planner estimates this as one engine unit of high complexity, built
before any piece unit, with an attack pass, because it changes the engine's
only entry point. If the attack pass or the lead finds it too large, it
splits into two medium units: the registry, served group, transactions,
events, views and visibility (items 1 to 5, 7 and 9), then the callers and
helpers (items 6, 8, 10 and 11).

## 7. What the other pieces asked for, and where each is answered

The lead asked for each request from the other two planners to be taken in
or refused with a reason.

### The foundry roles

The foundry roles planner listed six needs, in
`.plans/plans/shepherd-foundry-roles/requests.md` on its branch, section
"From the client API".

| # | Need | Answer |
| --- | --- | --- |
| 1 | A roster query | Taken in as `client.roster` (section 3, row 25). Refused in part: an agent sees itself and the agents it holds a parent's rights over, not its whole subtree, so the roster never shows more than `subscribe` does. |
| 2 | A thread read, and an export to a file | Taken in as `client.thread`, a paged read (section 3, row 26). The export is a client-side command that writes the caller's own file. The service never writes a file for a caller. |
| 3 | A narrow caller kind for Shephrd's own services (the sheepdog, the standing-rule answerer) | Taken in as the service caller, in-process only, with the lead's narrow rights (section 2, "Services", row 27). It needs an engine change, which is in the extension seam and pending the owner (section 6, item 10). A scoped device credential was not used: it would put a token for an in-process service on disk for no gain. |
| 4 | Owner commands for the roles' settings: standing rules, the sheepdog's thresholds, snoozing one group | Taken in as a rule, not as commands: piece 4 defines them in its own `roles.` group with access `owner` and `device` (section 1). Adding a standing rule creates an automatic allow that outlives a stolen phone's revocation, so it is a candidate for the host-only list in question Q2 (row 29). |
| 5 | Alert kinds the roles raise | Taken in: four namespaced kinds with default phone settings (section 4, row 28). A notice for a lead stays on the board. |
| 6 | Subscribe filters by group and by event kind | Taken in: `client.subscribe` filters by agent, group and event kind (section 3, row 30). |

### The message board

The message board planner listed six needs, in section R1 of
`.plans/plans/shepherd-message-board/lead-questions.md` on its branch.

| # | Need | Answer |
| --- | --- | --- |
| 1 | Board commands on every client transport, generically | Taken in: both transports serve the whole `ApiRpcGroup` with no per-command code (section 5, "Transports", row 36). |
| 2 | Board events in the owner's live stream, not widened for agents | Taken in: board events are `owner-only`; the client API never widens the agent filter for them (section 3, row 34). |
| 3 | An alert for a post addressed to the owner, ideally with a `post` subject on `OwnerNeeded` | Taken in through an alert source, kind `board.post`, keyed by the post, opening the post (section 4, row 35). Refused in part: no `post` subject on `OwnerNeeded`, because that changes an existing engine event, and the board does not write `OwnerNeeded` at all, so one matter raises one alert. |
| 4 | Paged reads with a cursor | Taken in: one paged-read shape for every piece (section 1, "Paged reads", row 32). |
| 5 | The owner posts from any device as the owner, reusing any device field | Taken in: the caller stays `owner`; the envelope's optional `device` field records the device, and the board adds no field of its own (section 2, row 33). |
| 6 | A transport message limit of at least a 16,384-character post plus its envelope | Taken in: the network listener's limit is 1 mebibyte, sized against each piece's largest event and page (lead ruling L15); the engine's socket keeps its current behaviour (section 5, rows 36, 58). |

The board's delivery source for posts, from its question Q1, is section 6,
item 11.

## What this contract does not settle

These belong to the design round or to the full plan:

- The network listener's address, its encryption, and how the phone reaches
  it from outside the house (design questions 1 and 3).
- The alert channel (design question 2).
- Whether an alert link can answer by itself (design question 4).
- How a browser presents its device credential. A browser's WebSocket cannot
  set an `Authorization` header, so the web page needs another way, such as
  a cookie set at pairing. The plan decides this. It does not change what
  the other pieces build on.
- The pane viewer's technology (lead ruling L4).
