---
topic: shepherd-client-api
kind: contract
status: draft, awaiting the lead's freeze
updated: 2026-11-03
---

# The client API contract that the other pieces build on

## What this document is

This document fixes the surface that Shephrd's message board (piece 3) and
foundry roles (piece 4) build on. It covers six things:

1. How a piece adds its own commands and events.
2. The three kinds of caller, and what each may do.
3. How a client subscribes, and what it sees.
4. How an "owner needed" event becomes an alert.
5. Request ids and cursors.
6. What the engine must offer for all of this to work.

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

## One part depends on an answer from the lead

The engine, as built at commit `8ff4c9b`, has no way for another piece to add
a command or an event. Its server, client library, command-line tool and
command handler each list the engine's sixteen commands by hand, and its
event union is closed (scouting, scout 1, items 1 and 2).

The engine's design says the other pieces are built "on top of the engine
without changing it" (owner-approved design, 2026-11-01). So this contract
assumes one small engine unit, **the extension seam**, and the planner has
asked the lead whether it may be planned (row 22, question Q1). The seam
changes no engine command, event or rule. It only lets the service accept
pieces that are registered with it. The section "What the engine must offer"
lists exactly what it adds.

If the lead refuses the seam, sections 1 and 6 change, and the lead will
receive a revised contract before anyone builds on it.

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
   may call it, out of `owner`, `device` and `agent` (section 2).
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

## 2. The three kinds of caller

| Kind | Credential | Reaches Shephrd through | May call |
| --- | --- | --- | --- |
| Owner | The owner credential file in the state folder | The engine's Unix socket only, with the engine's ancestry check | Every command whose access includes `owner` |
| Paired device | Its own device credential, prefix `shp_d_` | The network listener (piece 2), or the Unix socket | Every command whose access includes `device` |
| Agent | Its own agent token, prefix `shp_a_` | The engine's Unix socket only, through MCP or the CLI | Every command whose access includes `agent`, under the engine's tree rules |

These rules apply to the three kinds:

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
  tree rule.
- **The engine's own access is unchanged.** `accounts`, `accounts
  set-secret`, `accounts mark-available`, `harnesses` and
  `debug.compare-views` stay owner-only, which includes devices. `ask`,
  `wait` and `pass-up` stay agent-only. Owner choice A10 makes `wait`
  agents-only (row 4).
- **The log records which device acted.** Today a device's command is
  recorded with the caller "owner" (scout 1, item 4). The seam adds a
  `device` caller to the envelope's `caller` field, so the owner can see
  which phone answered a request. Rights are unchanged. A device's receipts
  are kept under its own caller key, so two devices can never collide on a
  request id.

## 3. How a client subscribes, and what it sees

### Starting, and staying current

1. **Snapshot.** The client calls `client.snapshot`. It returns the current
   picture and the sequence number it was taken at: agents and their
   displayed states, open permission requests and questions, open alerts,
   accounts without secrets, devices without credentials, and each piece's
   own snapshot section under its namespace (row 15).
2. **Subscribe.** The client calls the engine's `subscribe` with
   `after` set to that sequence number. It receives every later event it
   may see, in order, with no gaps, then each new event as it is written.
3. **Resume.** After a dropped connection, the client subscribes again from
   the last sequence it received. The engine's client library already does
   this. If the engine answers that the cursor is ahead of the log's head,
   the client takes a new snapshot.

A client that cannot use the whole stream, such as a phone on a mobile
network, calls `client.subscribe` instead (row 16). It takes the same `after`
cursor plus a filter: a list of agents, and a list of event kinds. It sends
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
| `agent-scoped` | The owner and every device. An agent sees it only when the envelope's `agentId` is the agent itself or an agent it holds a parent's rights over. This is the engine's existing rule. |
| `owner-only` | The owner and every device. Never an agent. |
| `piece-decided` | The owner and every device. An agent sees it when the owning piece's pure rule says so, given the caller, the envelope and the views. The board uses this, so an agent sees posts in the channels it belongs to. |

The engine's own events keep their current behaviour. An engine event with
an `agentId` is `agent-scoped`. An engine event without one is `owner-only`
(issue 164 stands).

Two rules apply to every piece:

- **A piece-decided rule is a pure function of the caller, the envelope and
  the views.** It reads no clock and no file. So a snapshot, a live
  subscription and a rebuilt log always agree on what a caller sees.
- **A snapshot is filtered by the same rule as the stream.** An agent's
  snapshot holds only what its subscription would show.

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
so the helper and the engine share one copy and cannot disagree. The command-line tool's `shephrd wait --block` for the owner uses
this helper.

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
sends a phone alert itself.

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
the page (row 19). It never carries agent text, tool output, file contents
or any secret. The owner reads the details inside an authenticated client.

Whether that link can answer a question by itself is one of the four
design questions. This contract leaves a named slot for it,
`AlertRaised.actions`, which stays empty until the design note decides.

## 5. Request ids and cursors

**Request ids** (row 21):

- Every command payload carries `requestId`. Clients mint a random UUID
  (universally unique identifier) for each action the owner takes, such as
  one tap on Allow, and reuse it on every resend of that action.
- Receipts are kept per caller. Callers are the owner, each device, and
  each agent.
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

## 6. What the engine must offer (the extension seam, pending Q1)

These are the engine changes the contract assumes. None changes an engine
command, event, state rule or permission rule.

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
6. **A device caller.** The envelope's `caller` gains a `device` kind, and
   a device's receipts are kept under its own key (section 2).
7. **A view snapshot at a sequence number,** consistent with the log, for
   `client.snapshot`.
8. **Exported helpers:** the rights rule and the engine planners a piece
   may call, such as queuing a delivery. The settled test moves into
   `packages/contracts`, so the client library can use it without
   importing the engine.

The planner estimates this as one engine unit of high complexity, built
before any piece unit, with an attack pass, because it changes the engine's
only entry point.

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
