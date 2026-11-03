---
topic: shepherd-client-api
kind: contract
status: v9, lead ruling L31
version: 9
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
6. The shared engine edits that the client API plan's first unit makes.
7. What the other two pieces asked for, and where each is answered.

The owner settled the client API's design questions in design talk 1 on
2026-11-03. The decisions are in `docs/specs/2026-11-03-client-api-design.md`
(rows 76 to 90). This contract follows them: a loopback web server that is
open for now, alerts through ntfy behind one sender interface, and three
commands that work only at the computer. Version 8 folds review round 1
(rows 91 to 128). One of its rules, edit E28, is pending the owner's
question 6 (row 95).

The decision log is `decisions.md` in this folder. Row numbers below refer to
it. The engine anchors are in `scouting.md`. Everything here is a plan; none
of it is built.

Abbreviations: RPC means remote procedure call, one request and its reply.
MCP means the Model Context Protocol, the way agents get Shephrd's tools. CLI
means the `shephrd` command-line tool.

## The pieces edit the engine directly

The engine, as built at commit `8ff4c9b`, has no way for another piece to add
a command or an event. Its server, client library, command-line tool and
command handler each list the engine's sixteen commands by hand, and its
event union is closed (scouting, scout 1, items 1 and 2). The engine also
knows only two callers, the owner and agents, so it cannot record a
Shephrd service under its own name.

The owner answered this on 2026-11-03, as relayed by the manager (row 63):

> "dude. change it. that is the whole point of a phased build. why do we
> want to work around something when we can edit it."

Lead ruling L26 follows from that answer (row 64). There is no extension
seam and no rule that existing behaviour stays the same. The client API
plan's first unit makes the shared engine edits in section 6, directly in
the engine's own code. The board and roles plans then add their own
commands, events, views and conditions to the engine's lists directly, in
their own units. Where an edit changes something the engine already does,
section 6 names the change, its file, the existing tests it updates, and
its decision row.

The security properties of lead rulings L13 and L16 to L25 stay exactly as
ruled. They are now properties of engine code. Section 6 states each one
next to the edit that carries it.

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
  `client.roster`. The piece builds its command group without the prefix and
  applies it with Effect's `RpcGroup.prefix("<namespace>.")`.
- A piece's event tag is `<namespace>.<PascalName>`, such as
  `board.PostAdded`. The event's `_tag` field holds the full name.
- An engine name never contains a dot, except the existing
  `debug.compare-views`.
- Effect's `RpcGroup.merge` silently replaces a command whose name is
  already present (Effect 4.0.5, `RpcGroup.ts:269`). So a test in
  `packages/contracts` asserts that every command name and every event tag
  in the full API is unique.

### Where a piece's code lives

A piece's code lives in a folder named after its namespace, inside the
engine's two existing packages (row 65):

| Folder | Holds |
| --- | --- |
| `packages/contracts/src/<namespace>/` | The piece's command group, event structs, access entries, visibility entries, alert sources, view types, and its pure hold-unsettled and request-held conditions (edits E19 and E20). It imports only `effect` and the rest of `packages/contracts`. The conditions live here because E19's table is in `packages/contracts`, which cannot import the engine (lead ruling L28). |
| `packages/engine/src/<namespace>/` | The piece's command planners, view reducer, reactors, migrations and reach check. It may import any engine module. |

The web page (`packages/web`) and the pane viewer (`packages/viewer`) stay
packages of their own, because the web page is built for a browser (row
44). No separate contracts package and no composition package exist.

A piece adds itself to the engine's own lists, which section 6 makes:

1. **Its commands** join `CommandsRpcGroup` in
   `packages/contracts/src/commands.ts`, already prefixed. Every payload has
   a `requestId` field, and every reply and error carries it back, as the
   engine's commands do (`packages/contracts/src/commands.ts:24`).
2. **Its events** join the `Event` union in
   `packages/contracts/src/events.ts`, each with a namespaced `_tag`. The
   envelope stays one schema, `EventEnvelope`.
3. **Its access entries** join the access table: for every command, the set
   of caller kinds that may call it, out of `owner`, `device`, `agent` and
   `service` (section 2).
4. **Its visibility entries** join the visibility table: for every event
   tag, its visibility class (section 3).
5. **Its alert sources** join the alert source list, if it has any
   (section 4).

The client library, the command-line tool, the MCP tool server, the web page
and the pane viewer import `packages/contracts`, as they do today.

### What a piece gets for free

Once a piece's group is in `CommandsRpcGroup`, it gets four things without
more code:

- **A command-line subcommand.** Each command becomes
  `shephrd <namespace> <name>`. The engine's existing parity test is
  extended to the full API.
- **An MCP tool.** Each command whose access includes `agent` becomes one
  of the agents' tools, except a stream and a secret-setting command (edit
  E2, row 97). Commands without `agent` are never offered to agents.
- **Request ids and receipts.** The engine's receipts store handles a resent
  request (section 5).
- **Secret removal.** Every event a piece writes passes through the engine's
  redactor before it is stored, as the engine's own events do.

### How a piece's command runs

Every command is exactly one of two kinds, and the kind decides how it
runs (lead's round 4, S1; row 68):

- **A planner** writes events and returns a small reply: identifiers, counts
  and fixed values taken from its own batch, such as a new channel's id or
  a new post's id. Its reply never holds post text, thread text or any
  other record read from the views. It is deduplicated by its request id.
- **A read** returns records, such as a page of posts, a roster or a
  snapshot. It is never deduplicated. It is checked against the caller's
  current access on every request, including a resent one. A read may also
  write marks of its own namespace, such as the board's read marks, but it
  never stores its reply (edit E4).

A command that must both return records and write events is a read with
marks. So `board.read` is a read with marks. `board.open` and `board.post`
are planners. The board's and roles' plans classify their other commands
by this rule, and a test in `packages/engine` checks that every command is
in exactly one of the two tables (edit E3).

A piece's handler never writes to the database itself. A planner is in the
engine's planner table, and it runs inside the engine's command
transaction, as the engine's own planners do:

1. The engine identifies the caller and checks the access table, before it
   looks at any receipt (edit E2, row 100).
2. The engine checks the request id against the receipts.
3. The piece's planner reads a consistent snapshot of the views, the
   engine's and its own, and returns the events to write and its reply
   function (edit E3).
4. The engine runs the batch checks of edit E23, then writes those events,
   the receipt and any side rows in one transaction, after redaction. The
   receipt holds the batch's envelopes and the redacted reply, and a resent
   request gets that same reply.

A piece may ask for a delivery to an agent by returning a delivery
request, which the engine turns into its own `DeliveryQueued` (edit E23).
The only engine event a piece returns itself is the withdrawal of its own
queued delivery (edit E17). A piece cannot write an engine event that the
engine's own rules would refuse. The engine checks every engine event in a
piece's batch against its state table, as it checks its own.

### Views and reactors

- **Views.** A piece may keep its own view: an initial value and a pure
  function that applies one event. The view is rebuilt from the log at
  start-up and is included in the engine's rebuild check, so "the log is the
  whole truth" holds for every piece.
- **Side tables.** A piece that must keep a value outside the log, such as
  a hashed pairing code, keeps it in its own tables, named `<namespace>_*`,
  created by its own migrations, which it adds to the engine's migration
  list.
- **Reactors.** A piece may react to committed events, for example piece
  2's alert reactor. A reactor reads events in sequence order. It writes
  only through the engine's piece batch path (edit E23), recorded with the
  caller `piece { namespace }`, so its batch passes the same checks as a
  planner's. It never appends to the log directly. It must be safe to run
  twice on the same event, because a crash can come between reading and
  writing. These rules apply to every reactor (row 108):
  - **It waits for recovery.** A reactor starts only after the engine's
    `recovery.whenReady`, as the engine's own followers do
    (`accounts/available.ts:84`, `routing/deliveries.ts:317`). The piece
    batch path refuses a reactor's batch before then.
  - **Its position.** A reactor with a position records, in its own view,
    the highest source sequence named on its own events and on its refusal
    records. After a restart it resumes from there. A reactor whose rules
    are all level rules over the current views, such as the board's, keeps
    no position instead: it runs over what each batch touches, and over the
    whole state at start-up.
  - **Its first start.** A reactor with a position writes one event of its
    own at its first start, recording the log's head as its first position.
    It never replays history. A matter that is already open at that moment
    is found by a level scan over the current views.
  - **A failed write.** On `LogWriteFailed`, the reactor stops at the
    unhandled event and does not advance. The writer has latched by then
    (`EventLog.ts:141-143`), so every later write fails too. A restart
    resumes from the recorded position. A reactor never logs a warning and
    moves on past an event.
  - **A defect.** A defect in a reactor is logged at error level with no
    event text, and the reactor restarts from its recorded position after a
    pause. It never dies silently.

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
- A page also closes at the byte budget in section 5, "Message size". A
  page always holds at least one item, so a cursor always moves forward.
- A paged read applies the same visibility rule as `subscribe`, is checked
  against the caller's current access on every request, and is not
  deduplicated. A resent request computes a fresh page.

## 2. The four kinds of caller

| Kind | Credential | Reaches Shephrd through | May call |
| --- | --- | --- | --- |
| Owner | The owner credential file in the state folder | The engine's Unix socket only, with the engine's ancestry check | Every command whose access includes `owner` |
| Web caller (a device) | None while the web server is open (row 80). Pairing will later give each device its own credential, prefix `shp_d_` | The loopback web server (piece 2) | Every command whose access includes `device` |
| Agent | Its own agent token, prefix `shp_a_` | The engine's Unix socket only, through MCP or the CLI | Every command whose access includes `agent`, under the engine's tree rules |
| Service | None. A service exists only inside Shephrd's own process | The engine's in-process command path only | The fixed list under "Services" below, and any piece command whose access includes `service` |

The log also names a fifth caller, `piece { namespace }`, on the batches a
piece's own reactors write (edits E11 and E23). It is not a kind of caller
in the sense of this table: it has no credential, no access entry, and
calls no command.

These rules apply to the four kinds:

- **A device has the owner's rights, except for three commands.** The
  engine already treats a device as the owner (`CommandHandler.ts:207`).
  The owner chose three commands that work only at the computer, over the
  engine's Unix socket with the owner credential (row 82). Each is tagged
  **computer-only** in the access table, and the web server also refuses
  them by name. AGENTS.md rule 5 is narrowed for these three:
  - `client.pair.create`, creating a pairing code. The name is reserved in
    the computer-only list now, and the later pairing plan builds it.
  - `client.web.settings.set`, changing the web server's settings.
  - `roles.rules.add`, adding a standing permission rule. The roles plan
    defines it with access `owner` alone and cites this list.
- **The carrier token also leaves out `device`.** The command that writes
  the alert carrier's token, `client.alerts.carrier.set-token`, has access
  `owner` alone, by lead ruling (rows 93, 94). It is not on the web server's
  named list, and it is listed for the owner because it narrows AGENTS.md
  rule 5 further.
- **The answers a web caller may not give, pending the owner** (row 95, edit
  E28). The engine refuses `answer` from a device caller for a persistent or
  always-allow option. On a settings-write request, it accepts from a device
  caller only a non-persistent reject option. So the phone can answer
  "Allow once" and "Deny" on an ordinary request, and "Deny" on a
  settings-write request. The owner's question 6 decides this rule.
- **Every web server request is a web caller, decided in one place.** The
  web server is open for now (row 80, SECURITY.md rule 2 suspended for it
  by the owner). One function, `webCaller`, decides the caller of every
  request. While the server is open it answers the web caller: access kind
  `device`, actor owner, and the envelope field `device: open-web`, a
  reserved id that is never minted for a real device. So the log always
  shows that an act came through the web server. Its path into the command
  handler is one in-process credential shape that only `webCaller` can
  build, with no wire or disk form (edit E12, row 96). Pairing later changes
  only this function (row 81). The engine's Unix socket keeps its
  authentication unchanged.
- **The web server refuses the host's own credentials.** A request that
  presents the owner credential or an agent token is refused there, because
  the owner's proof rests on the Unix socket and its ancestry check, and
  agents always run on the host.
- **The web server refuses an agent's process, and other users' processes.**
  At connection open, `webCaller` finds the loopback peer's process and
  refuses it when any process holding that socket descends from an agent,
  by the engine's ancestry rule (row 84). A peer owned by another user id
  passes only in proxy mode, and only when it matches the computer-only
  "proxy user id" setting (row 92). A same-user peer that cannot be found is
  refused. The checks of the next two rules run first, so a refused
  connection costs no process scan (row 119). This is a guard against
  accidents and simple misuse, not a security boundary.
- **Only Shephrd's own page may drive the web server** (row 90). A
  request is accepted only when its `Host` names the web server, and, for
  anything but a `GET` or `HEAD` of a static file, its `Origin` names the
  page. The allowed names are `127.0.0.1` and `localhost` at the web
  server's port, plus, in proxy mode only, the public address setting. A
  WebSocket upgrade, or any
  other request that changes state, with no `Origin` is refused. This
  stops a web page in the owner's browser and DNS rebinding. It does not
  stop a local program, which can send any header.
- **Remote access comes through the owner's proxy.** The web server binds
  loopback only, also in proxy mode (row 76). Proxy mode has four
  computer-only settings: the public address, the allowed client networks,
  the proxy user id, and whether it is on (rows 91, 92). Section 5,
  "The web server's settings", gives the full table. Outside proxy mode the
  web server ignores forwarded headers (row 89).
- **`debug.compare-views` is the owner's terminal only.** Its access is
  `owner`. It stays behind the engine's debug flag, and the web server
  refuses it by name (row 99).
- **The pane viewer is the owner.** The thread viewer in a Herdr pane uses
  the owner credential over the Unix socket, exactly as the owner's terminal
  does (lead ruling L4, row 7).
- **An agent's rights over other agents are the engine's.** An agent may
  manage agent X when it is X's effective holder: X's nearest available
  ancestor, as `holderAbove` finds it (`routing/holders.ts:21`), where an
  available agent is one that is idle or working (l.14). This is the
  management rule, and it is unchanged. A piece's agent-callable command
  that acts on another agent checks it through the engine's rights helper
  (section 6). A piece does not invent its own tree rule, with one
  exception below. What an agent may read is a separate rule (section 3,
  "The read rule and the management rule").
- **One exception: a piece's delivery may reach outside the caller's tree**
  (lead ruling L13). A delivery that a piece queues with its own
  `{ namespace, id }` source (section 6, edit E16) may reach a target
  outside the calling agent's tree, but only when that piece's reach check
  allows it (edit E18). For the board, the reach check is channel
  membership, so a worker can message a sibling in the same channel. The
  reach check is a pure function of the caller, the target, the delivery
  being judged and the views snapshot taken in the same transaction as
  the delivery, like a visibility rule (lead rulings L15, L23). The exception grants no lifecycle right: it never
  allows `stop`, `answer`, `compact`, `resume` or an engine `prompt` on the
  target. A piece's delivery carries the piece as its sender (section 6,
  edit E15), never "owner". The piece must name each item's true author in
  a header built only from fixed words and the engine-authenticated caller
  id, never from agent text. This holds also for wakes the piece builds
  with no caller, such as one wake that merges several posts (lead ruling
  L16). The text is still wrapped as data
  (section 6, edit E15).
- **The engine's own commands keep their access.** `accounts`, `accounts
  set-secret`, `accounts mark-available` and `harnesses` stay owner-only,
  which includes devices. `debug.compare-views` stays with the owner
  credential alone, as `server.ts:163-165` has it today. `ask`,
  `wait` and `pass-up` stay agent-only. Owner choice A10 makes `wait`
  agents-only (row 4).
- **A device acts as the owner, and the log also says which device.**
  Today a device's command is recorded with the caller "owner" (scout 1,
  item 4), and that stays by choice: the envelope's `caller` is still
  `owner`, and a device's receipts stay in the owner's scope. Every engine
  rule that tests for the owner, such as who holds a request and who may
  answer it, then treats a device exactly as the owner with no edit of its
  own. Edit E12 adds one optional envelope field, `device`, holding the
  device's id, so the owner can see which phone answered a request (rows
  33, 66). An envelope written by the owner's terminal has no `device`
  field. A piece that records an author, such as the board's
  post author, records the owner and reuses this field for the device; it
  adds no field of its own.

### Services

A service is Shephrd's own code acting on the owner's behalf with narrow,
fixed rights: the foundry roles' sheepdog and their standing-rule answerer
(lead ruling, row 27). Edits E11, E13 and E14 build these rules:

- **It is in-process only.** A piece adds each of its services by name to
  the engine's service list, such as `roles.sheepdog` or
  `roles.standing-rules`. A service calls the engine's in-process command
  path directly. No service credential exists on the wire or on disk, so
  there is nothing to steal. The Unix socket and the web server never
  accept one.
- **The log records it under its own name.** The envelope's `caller` gains
  one new variant, `service { service, rule? }`. A standing rule's answer
  is not a command: the engine writes it inside the permission request's
  own transaction, through the roles' matcher in the permission path, and
  `PermissionAnswered.answeredBy` names the service and the rule, such as
  `{ service: "roles.standing-rules", rule: "4" }` (edit E14).
- **Its receipts are its own.** They are kept under the key
  `service:<name>`.
- **It may call at most these engine commands.** Each service's entry in
  the service list names the commands it may call, out of this list and
  the piece commands whose access includes `service`. The roles plan adds
  one engine command, `release`, in its own unit, and gives it to the
  sheepdog (roles plan WS-7b, row 120):
  - `subscribe`, seeing every event, as the owner does;
  - `prompt`, to any agent, as a nudge. The text is wrapped as data, a
    leading `/` is escaped as it is for agents' prompts, and the sender is
    shown as the service;
  - `compact`, on any agent, under the engine's state table;
  - `resume`, on any agent, under the engine's state table.
- **Everything else is refused,** including `answer` (row 75), `start`,
  `stop`, `group`,
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
   section through a per-caller function, `snapshotFor(caller, view)`, in
   the engine's snapshot section table (edit E9), which may leave the
   section out (lead ruling L15). The board's section is a
   bounded summary with no post text for the owner, devices and services,
   and absent for an agent (lead ruling L23). For the owner, devices and
   services, the snapshot also holds an engine wait-state section: the open
   deliveries (id, target, status and source kind, with no text) and the
   open non-blocking waits (the waiter and the wait id). Each agent entry
   holds its lifecycle state and `reloadable` flag. Every part of the
   snapshot comes from one views value, and the snapshot's sequence is that
   value's own (edit E9, row 103).
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
of event kinds. An agent filter matches an event by the thread membership
rule of edit E21. A group filter is checked against the agent's groups in
the current views, as the read rule is. So on a live stream, an agent that
joins a group is included from about that event on. On a catch-up after a
reconnect, the filter sees the groups as they are now, not as they were at
each old event. A client that needs an exact history reads the thread
(row 124, which narrows row 30). The stream sends only the events that pass
both the visibility rule and the filter. While it skips events, it sends a
`client.Checkpoint` carrying the last sequence it has scanned, never the
log's head, at least every 30 seconds. So the client's cursor keeps moving,
and a reconnect neither re-scans what was skipped nor skips what was not
scanned.

The transport closes a subscription that falls 2,048 events behind, or that
leaves a chunk unacknowledged for five seconds (issue 41). The client
reconnects from its cursor. The web server also sends a heartbeat,
more often than a reverse proxy's idle timeout, which is set in piece 2's
settings.

### The read rule and the management rule

These are two different rules (lead ruling L29, row 69):

- **The management rule** says which agent may stop, prompt, compact,
  resume, group or answer for agent X. It is X's effective holder, as in
  section 2. It is unchanged.
- **The read rule** says which agent may see X's events and records. An
  agent may read X when X is the agent itself, when the agent is X's
  structural parent, or when the agent is X's effective holder because X's
  parent is unavailable.

So reads always cover management rights. A caller can always see an agent
it may act on, and reading grants no right to act. Three cases show the
rule, for an orchestrator O, its lead L, and L's worker W:

- **While L is available,** O reads L but not W, and L reads W, as today.
- **While L is unavailable,** which means any state but idle or working
  (`routing/holders.ts:14-17`), O is W's effective holder, so O reads W and
  manages W. L keeps its structural read of W, so it can
  catch up when it resumes. L's management of W passes to O, as today.
- **When L recovers,** O's read of W ends. The filter is evaluated against
  the current views, so O's live stream stops carrying W's events, and a
  catch-up from an earlier cursor no longer returns them.

This gives O no new capability. O may stop L today, and then holds the
management rights over W that the read rule follows. A sibling or a
stranger never reads X under this rule.

A read that ends gives the client no event. So when O's read of W ends, W
stays frozen in O's earlier picture. An agent caller refreshes
`client.roster` when a child's parent becomes available again, which is an
event it can see (row 123).

The read rule is a pure function of the caller, the envelope's `agentId`
and the current views. One function applies it (edit E8), and every
agent read uses that function: `subscribe`, `client.subscribe`,
`client.snapshot`, `client.roster`, `client.thread`, and the roles' orient
and hand-off reads, which are built on the roster and the thread.

### What each caller sees

Every event has one visibility class, set by the piece that owns it:

| Class | Who sees it |
| --- | --- |
| `agent-scoped` | The owner, every device and every service. An agent sees it only when the envelope's `agentId` names an agent it may read, by the read rule above. |
| `owner-only` | The owner, every device and every service. Never an agent. |
| `piece-decided` | The owner, every device and every service. An agent sees it when the owning piece's pure rule says so, given the caller, the envelope and the views. |

The engine's own events keep their current behaviour. Every engine event is
`agent-scoped`. An `agent-scoped` envelope with no `agentId` is hidden from
agents, so an engine event without one is seen only by the owner, devices
and services, as today (issue 164 stands, edit E8).

Every event tag has a declared class. The visibility table is typed over
the whole event union, so an event added without a class does not compile
(edit E8). A piece that has no reason to choose writes `owner-only`. The
board's events are `owner-only` (row 34): owner devices see them in their live
stream, and agents read the board through the board's own commands, not
through `subscribe`. The client API never widens the engine's agent filter
for another piece's events. `piece-decided` stays available to any piece
that needs it later.

Two rules apply to every piece:

- **A piece-decided rule is a pure function of the caller, the envelope and
  the views.** It reads no clock and no file. So a snapshot, a live
  subscription and a rebuilt log agree on what a caller sees, for as long as
  the set of agents that caller may read stays the same (row 123).
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
- An agent sees every agent it may read, by the read rule. Its own entry
  names its parent, so `orient` can answer "who is my parent" without
  seeing the parent's record.
- An agent does not see its grandchildren while their parent is available.
  It sees them while their parent is unavailable and it is their effective
  holder.
  The roles planner asked for a whole subtree. That is wider than what the
  engine lets an agent subscribe to, and a roster that shows more than
  `subscribe` would let the two disagree. A lead that needs its workers'
  workers asks its workers, as the engine's design says.

**`client.thread`** (row 26) reads one agent's thread events, in order,
from a sequence number, one page at a time. A page holds at most 500
events, closes at the byte budget in section 5, and returns the cursor for
the next page. It follows the paged-read shape in section 1. Access is
`owner`, `device`, `agent` and `service`, with the same visibility rule.
Which events belong to a thread is the rule of edit E21, so an owner's page
agrees with the engine's `threads` view, including a queued delivery.
Exporting a thread
to a file is a client-side feature: `shephrd thread export <agent> --out
<file>` pages through `client.thread` and writes the file on the caller's
side, with file mode 0600. The service never writes a file on a caller's behalf, because a
remote caller must not be able to choose a path on the host.

### Events a client does not know

A client decodes the envelope first and the event second. An event whose tag
it does not know becomes an "unknown event" record, holding the tag, the
namespace and the sequence. The client moves its cursor past it and never
fails on it (row 17). So a web page built before the board exists keeps
working once the board writes events.

This happens at the RPC boundary, because Effect's RPC client decodes each
chunk with the command's success schema before the application sees it
(Effect 4.0.5, `rpc/RpcClient.ts:733-755`). So the client library uses a
tolerant wire form of the envelope, in which the event and the caller are
unknown values (edit E25, row 109). It then decodes known events above that
boundary. The engine keeps its strict `EventEnvelope` for everything it
writes, stores and rebuilds.

### Waiting, for owners and devices

There is no `wait` command for the owner or a device (row 4, lead ruling L1).
The client library offers a helper, `waitForAgents`, that takes a set of
agents and "any" or "all". It takes a snapshot, subscribes, and finishes by
the same member rule the engine uses for agent waits, which is more than
the settled test (row 104). Edit E19 moves that rule from the engine into
`packages/contracts`, so the helper and the engine share one copy and cannot
disagree. Each member has one result, read from its current state:

| Member's state and conditions | Result | What the helper does |
| --- | --- | --- |
| Idle, with no engine or piece hold | `settled` | The member counts as resolved. |
| Idle, with a queued or sent delivery, an open request or question, a hold, or an open non-blocking wait | None | It keeps waiting. |
| Idle, with a piece's hold at the agreed sequence | None | It keeps waiting. |
| Starting or working | None | It keeps waiting. |
| Crashed or stopped | `crashed` or `stopped` | The member counts as resolved. Exit 1 when the wait closes. |
| Paused | `paused` | The member counts as resolved. Exit 2, unless another member requires exit 1. |
| Interrupted, not reloadable | `interrupted` | The member counts as resolved. Exit 2, unless another member requires exit 1. |
| Interrupted, reloadable | None | It keeps waiting, because recovery can restore it. |

"Any" closes on one resolved member. "All" closes when every member is
resolved now, so a member that went back to working stops counting, as the
engine's rule says (`routing/waits.ts:92`). The exit codes are engine row
26's.

**The owner's own "request held".** A blocking wait must not wait for an
answer only its caller can give. So the helper ends early, with exit 2, when
a waited member has an open request or question whose holder is the owner.
A piece whose condition can wait on the owner lists those agents too, in the
same section and read that hold its other lists, under the name `ownerHeld`.
For the board, those are agents with an open post that needs the owner's
reply. This is the owner's form of edit E20, and it is checked at open and
after every batch the helper applies. A piece's `ownerHeld` list is read with
its other lists. So the helper acts on it at open and at each such read, and
never on a result older than the stream it has applied.

The test applies
every piece's hold-unsettled condition, so the owner's wait and an agent's
wait agree (lead ruling L15). Each piece writes its condition in its
folder in `packages/contracts` as
a pure function (lead ruling L28). A client does not hold a piece's full
view. So a piece whose condition reads its view, such as the board's,
carries in its snapshot section the ids of the agents for which its
condition holds and the sequence they were computed at, and offers a
read that returns the same lists at the current sequence (for the board,
`board.status` with no agent). The helper never ends a wait on a piece
result older than the stream it has applied. Whenever the engine's part
of the settled test says the waited agents are settled, it reads each
such piece's lists. If they are newer than the stream it has applied, it
applies the stream up to their sequence and decides again. It ends the
wait only when the engine's part and every piece's lists agree at one
sequence. No timer and no polling are added. So the helper needs a
caller whose snapshot holds those sections and who may make those reads:
the owner, a device or a service. The owner's terminal waits with a new
subcommand, `shephrd client wait`, which runs this helper over
`subscribe`. The engine's own `shephrd wait` stays agents-only, by owner
choice A10, and its A10 test keeps its expectations.

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

`OwnerNeeded` names no account (`events.ts:143-150`). So an account alert is
raised from the event that does name one, `AccountNeedsSignIn` or
`AccountOutOfUsage` with no reset time. The `OwnerNeeded` row is used for an
account reason only when the agent's account has no row, which the engine
allows (`routing/deliveries.ts:176-196`) (row 107). The engine's own sources
are part of the reactor, and they read the envelope and the current views.
A piece's source stays a pure function of one envelope.

Other pieces raise alerts by declaring an alert source. A source is a pure
function that takes one envelope and returns either nothing, a request to
raise an alert, or a request to end one. A request to raise names a kind, a
key, and optionally an agent and a subject. It never names a title: each
kind's title comes from a fixed table in `packages/contracts`, typed over
the kinds (row 114). For example, the foundry roles
would declare that their "stall reached the owner" event raises an alert of
kind `roles.stall`. A piece's alert kinds are namespaced. A piece never
sends a phone alert itself, and a piece never writes the engine's
`OwnerNeeded` event (row 35). If a piece wrote `OwnerNeeded` and declared
its own source, the owner would get two alerts for one matter.

The message board declares one kind, `board.post` (row 35). It is raised by
the board's own event for a post that needs a reply from the owner, with
the key `post:<postId>`, and it ends when the board records that post as
answered or closed. Its alert carries the post's id as its subject. A tap
opens the post's author's thread, as every alert link does, and that page
shows the post in a subject panel (row 112, "The subject panel" below). The
board asked instead for a `post` subject on the
engine's `OwnerNeeded`. That is refused, because the alert source gives
the same result, and because `OwnerNeeded` stays the engine's own signal,
so one matter raises one alert (row 35). `board.post` is pushed to the
phone by default.

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
pushed by default. The client API adds two kinds of its own, both pushed by
default: `client.lasting-setting` (row 98) and `client.web-down` (row 113).

Some settings outlast a moment's access but stay open to the web server,
because they grant no access and widen no exposure beyond what a caller who
reaches the server already has: a harness's adapter path and arguments, an
account's environment and secrets, the alert carrier's server and topic, and
the roles' role file and settings (row 98). A caller who changes one can
make later agent starts run other code, and the change stays after that
caller is gone. So none moves to the computer-only list, and a change that
arrives with `device: open-web` raises a `client.lasting-setting` alert. It
is a pure source over `HarnessChanged`, `AccountChanged`,
`client.AlertCarrierChanged` and the roles' two events, keyed by sequence,
and it ends only when dismissed. The later pairing plan reviews every such
record when the server closes.

### The alert's life

Piece 2's alert reactor reads committed events in order (row 18). It follows
section 1's reactor rules. Its first-start event is
`client.AlertBaseline { position }`, and its scan raises an alert for each
matter already open then, marked `baseline`, which is never pushed (row 108).

1. **Raise.** When a source asks for an alert, the reactor writes
   `client.AlertRaised { alertId, key, kind, agentId?, subject?, title,
   sourceSequence, baseline? }`. The `key` names what the alert is about,
   such as `permission:<id>`, `question:<id>`, `crash:<agentId>:<sequence>`,
   `account:<id>:sign-in`, `account:<id>:usage` or
   `agent-account:<agentId>`. Only one alert is open for each key at a time.
2. **Deliver.** Piece 2 sends the alert to the owner's phone through one
   interface, `AlertSender`, so the push carrier can change later without
   changing these rules (row 83). ntfy is the only carrier this plan
   builds. Each attempt is recorded as `client.AlertDelivered` or
   `client.AlertDeliveryFailed`, with the carrier's name and the attempt
   number, never the carrier's credentials. "The delivery guarantee" below
   gives the rules.
3. **Clear.** The reactor writes `client.AlertCleared { alertId, cause,
   sourceSequence }` when the alert's subject closes. The planner of
   `client.alerts.dismiss` writes the clear itself, in its own batch. The
   reactor checks the alert view inside the writer transaction, so a dismiss
   and a close cannot both write a clear. Dismissing an alert that is
   already closed succeeds and writes nothing (row 107).

An alert's subject closes by a level test over the current views, which the
reactor runs after each batch that touches the subject (row 107):

| Kind and key | Closes when |
| --- | --- |
| `approval` | The request's row is no longer open, or its agent is stopped or crashed. `stop` writes no `PermissionCancelled` (`commands/stop.ts:10-16`). |
| `question` | The question's row is no longer open, or its asker is stopped or crashed. |
| `failure` | The agent is stopped, or next reaches idle or working. A failed reload keeps it open. |
| `account:<id>:sign-in` | The account's row is gone, or its status is no longer `needs-sign-in`. |
| `account:<id>:usage` | The account's row is gone, or its status is no longer `out-of-usage`. |
| `agent-account:<agentId>` | The agent is stopped, or next reaches idle or working. |
| A piece's kind | The end its own source declares. |
| `client.lasting-setting` | Only when dismissed. |
| `client.web-down` | The web server binds. |

This answers issue 65 without an engine change: an alert ends when its
subject closes, and the client API writes that end into the log. A request
never moves back down from the owner (engine row 51), so a move never ends
an alert. Engine question rows from a stopped asker stay open in the views,
and answering one queues a delivery to a dead agent. The closing rule stops
the alert asking for that answer, and the engine gap goes to
`docs/issues.md`.

### The delivery guarantee

A push to a network server and a log commit cannot be one atomic step. So
delivery is **at least once**: a notification is never lost to a restart,
and it can arrive twice (rows 106, 83).

- **Pending is derived from the log.** An alert is pending when it is open,
  is not `baseline`, its kind is pushed by the setting read at send time, a
  carrier is set, it has no `client.AlertDelivered`, and it has fewer than
  five attempts since the carrier last changed. So a restart finds its work
  from the views after `recovery.whenReady`.
- **A stable identity.** Each send carries the alert's id as the carrier's
  message identity. On ntfy, this is the sequence id, and a second publish
  with the same id replaces the first on the phone (ntfy's publishing
  documentation, read 2026-11-03). A carrier or an older server that does
  not honour it shows a duplicate, which is the accepted fault.
- **An attempt.** One attempt has a 10-second limit. A timeout, a lost
  response, a redirect or an error status is a failed attempt. A crash
  between the carrier's acceptance and the local record causes one more
  send, never none.
- **Retry.** Attempts wait 5 seconds, 30 seconds, 2 minutes and 10 minutes,
  counted from the last failure's recorded time, so the wait survives a
  restart. Each alert retries on its own path. One alert's backoff never
  delays another's raise, clear or send, and no send runs inside the writer
  transaction.
- **A cleared alert is not sent.** An alert that clears during backoff is
  skipped.
- **Exhaustion.** The fifth failure is recorded with `final: true`. The
  clients show that alert as not delivered. A failed send never stops the
  reactor.
- **A carrier set later.** Setting the carrier makes every open alert that
  is not `baseline` pending, once.
- **Clearing on the phone.** `AlertSender` has two operations, `send` and
  `clear`. `clear` runs once when an alert clears, as a best effort, and a
  failure is logged with no text. On ntfy it deletes the notification by its
  sequence id. A clear never proves that a copy is gone from the server or
  the phone (section 5, "Stored copies").

A refused alert batch is not itself alerted. It is a defect that each
piece's tests rule out, and it stays visible as a `CommandRefused` in the
log (row 108).

### The subject panel

The link opens the agent's thread (row 79). A subject of another piece, such
as a board post, needs a way to be read and answered from there, and an
engine `answer` or `prompt` does not reply to a post (row 112). So the
thread page has a subject panel, with a table keyed by namespace.

- The client API's unit 7b builds the panel and its fallback, which names
  the subject and says that it is answered from a terminal.
- The board's plan writes the board's entry, in
  `packages/web/src/thread/subjects/board.tsx`. It reads the post with
  `board.read`, and replies with `board.post`, tied to the post's id.
- The entry reads the post only when the owner taps it, because `board.read`
  is a read with marks and opening a link runs no state-changing command.
- The board's plan owns the test that follows a notification, reads, replies,
  and sees the post and its alert close.

Whichever unit is built second connects the two. A client API release built
before the board's entry shows the fallback.

### What an alert may carry

An alert that leaves the host carries only five things: its kind, the
agent's name, the agent's team (its group labels), a title that Shephrd
writes from fixed text, and a link to the agent's thread on the page (row
87). It never carries any other agent text, tool output, file contents or
any secret. The owner reads the details on the page.

The agent's name and its group labels are agent-chosen text: the agent's
parent chose them (lead ruling L15). So they are treated as data. Each
travels in its own field, never inside Shephrd's title, and is shown under a
fixed label. Control and formatting characters and line breaks are removed.
A name is cut to 64 characters. A team holds at most 8 labels and at most
128 characters in all (row 114).

The link opens the thread, and the owner answers there (row 79). It never
answers by itself, and opening it runs no command. The link is built from
the page's public address, which is one of the web server's settings and
so works only at the computer (row 88). An alert has a link only while proxy
mode is on and a public address is set (row 113).

### The alert carrier's settings and its token

The carrier's server and topic are alert settings with no default value in
code (row 77). The owner and the web caller may change them (row 88). The
owner's server address is a value the owner sets. The token works by these
rules (rows 93, 94):

- **One fixed slot.** No setting holds a secret reference. The carrier has
  one token slot, at the fixed reference `secret:client.alerts.carrier`, in
  the engine's `secrets.json`, so the redactor knows the value
  (`service.ts:81-85`). The carrier resolves only that reference, and a
  boundary test checks that nothing in the client folder resolves any other.
  So an account's key can never be sent as the token.
- **Written, never read back.** `client.alerts.carrier.set-token` writes the
  slot, at the computer, with access `owner` alone. It takes a redacted value
  and a nonce, as `accounts set-secret` does, and replaces any earlier value.
  The command-line form is `shephrd client alerts carrier set-token`, which
  reads the value from standard input. No read returns the value. A client
  sees only whether a token is set.
- **Bound to its server.** `client.AlertCarrierTokenSet { origin }` records
  the origin the token was set for. Changing the server to another origin
  clears the token in the same batch, with
  `client.AlertCarrierTokenCleared`. The carrier sends the token only when
  the recorded origin equals the current server's. The stored value is then
  removed by the secret collection of edit E27.
- **Rotation and revocation.** Running `set-token` again rotates the token.
  `client.alerts.carrier.clear-token`, with access `owner` and `device`,
  removes it. Revoking it at the ntfy server is the owner's step, and a
  revoked token only makes attempts fail. Neither path puts a value in a log.
- **It survives restarts.** Edit E27 keeps the slot through the engine's
  secret collection while a token is set.
- **Encrypted, or private.** The server must be `https`, unless its host is a
  private address literal: loopback, link-local, RFC 1918 or an IPv6 unique
  local address. The owner's home server may use this exception.
- **No redirects.** The carrier never follows a redirect, so a credential
  cannot cross origins or fall to plain text. A redirect is a failed attempt.
  It reads at most 64 KiB of a response.

`docs/remote-access.md` also tells the owner to set the ntfy server's default
access to deny-all, with a write-only token for Shephrd and a read-only one
for the phone (row 115). By default, ntfy lets anyone who knows a topic read
and publish to it, including a fake alert with a lookalike link.

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
- A piece's commands use the same receipts, through the engine's command
  handler.
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
  2's loopback web server both serve the whole `CommandsRpcGroup`,
  generically. A
  piece's command needs no transport code of its own. The engine's socket
  already dispatches every command in its group this way
  (`api/server.ts`, `application`).
- **Message size** (row 105). The engine's events hold unbounded text, tool
  output and diffs (`events.ts:61-76`), so no limit on what the server sends
  can be promised without losing records. The rules are:
  - **Inbound.** The web server limits a message a client sends to 1 mebibyte
    (1,048,576 bytes). Going over it closes the connection. This protects
    the server.
  - **A page.** A paged read closes at 900 KiB of encoded items, or at its
    item limit, whichever comes first. It always holds at least one item.
    So one item larger than the budget is sent whole, in a page of its own,
    and is never cut.
  - **A filtered stream.** A chunk that must be acknowledged within five
    seconds cannot carry a very large event to a phone on a slow network, and
    the same event would then close the stream on every reconnect. So
    `client.subscribe` replaces an event whose encoded size is over 256 KiB
    with a `client.Oversized { sequence, tag, agentId?, bytes }` marker. Like
    a checkpoint, the marker is not an event in the log. The cursor moves
    past it, and the client reads the event whole with `client.thread`. The
    engine's `subscribe` is unchanged. The web page uses `client.subscribe`.
  - **A snapshot.** A snapshot is one reply, with no thread text. A test
    measures its encoded size on a large fixture team, 200 agents and 100
    open requests with every piece's largest section, and fails above 4 MiB.
  - **A piece's stated maxima.** Each piece states its largest event and its
    largest page, and a test in `packages/contracts` checks them against the
    budgets above. The board caps a wake body at 256 KiB and a `board.read`
    page at 512 KiB of encoded text (lead ruling L15).
  - **The tests measure real frames.** They encode actual RPC messages,
    including chunk wrappers and escaping, and do not add up constants.
  - The engine's socket sets no explicit limit today (scouting, planner's
    checks). This plan does not add one there, because only the owner's
    terminal, the pane viewer and the host's own agents reach that socket.

### The client group's access and visibility

Every `client` command has one entry, and every `client` event has the class
`owner-only` (row 97). So no agent sees an alert, a setting or a carrier
change, and `client.alerts.dismiss` is never an MCP tool.

| Command | Kind | Access | Purpose |
| --- | --- | --- | --- |
| `client.snapshot` | read | owner, device, agent, service | The current picture (section 3). |
| `client.roster` | read | owner, device, agent, service | The agents (section 3). |
| `client.thread` | read | owner, device, agent, service | One agent's thread (section 3). |
| `client.subscribe` | read, stream | owner, device, agent, service | The filtered stream (section 3). A stream is never an MCP tool. |
| `client.alerts.list` | read | owner, device | Open and cleared alerts, paged. |
| `client.alerts.dismiss` | planner | owner, device | Clears one alert. |
| `client.alerts.settings` | read | owner, device | Each kind's push setting, the carrier's server and topic, and whether a token is set. Never the token. |
| `client.alerts.settings.set` | planner | owner, device | Changes one kind's push setting. |
| `client.alerts.carrier.set` | planner | owner, device | Changes the carrier's server and topic. |
| `client.alerts.carrier.set-token` | planner, secret-setting | owner | Writes the token slot. Lead ruling, rows 93 and 94. |
| `client.alerts.carrier.clear-token` | planner | owner, device | Removes the token. |
| `client.web.settings` | read | owner, device | The web server's settings. |
| `client.web.settings.set` | planner | owner, **computer-only** | Changes the web server's settings. |
| `client.pair.create` | reserved | owner, **computer-only** | Not built. The later pairing plan builds it. |

The client's events are `client.AlertBaseline`, `client.AlertRaised`,
`client.AlertDelivered`, `client.AlertDeliveryFailed`, `client.AlertCleared`,
`client.AlertSettingsChanged`, `client.AlertCarrierChanged`,
`client.AlertCarrierTokenSet`, `client.AlertCarrierTokenCleared`,
`client.WebSettingsChanged`, `client.WebServerDown` and
`client.WebServerUp`. `client.Checkpoint` and `client.Oversized` are markers
in a filtered stream, not events.

All settings live in the log as these events, and the client's view folds
them, so they survive a rebuild. None holds a secret. The token is the only
value outside the log, in its slot (section 4).

### The web server's settings

The settings are one record, changed only by `client.web.settings.set`
(rows 82, 88, 91, 92, 113):

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | On | Off closes the web server at once. Alerts keep running. |
| `port` | 8787 | The loopback port. A change applies at the next service start. |
| `heartbeatSeconds` | 25 | The heartbeat interval. |
| `proxyMode` | Off | Whether the settings below apply. |
| `publicAddress` | None | The page's address through the proxy, in one canonical form: `https://host` or `https://host:port`, in lower case, with no path and no default port. A form that is not `https` is refused. |
| `allowedClientNetworks` | None | The networks a remote client may come from, such as the WireGuard network. |
| `proxyUserId` | None | The user id a proxy runs as, when it is not the owner's. |

The command refuses proxy mode on without a public address and at least one
allowed client network. So a request reaches these rows only with all of them
set:

| Proxy mode | The request names | Last `X-Forwarded-For` entry | `X-Forwarded-Proto` | Result |
| --- | --- | --- | --- | --- |
| Off | Loopback | Ignored | Ignored | Accepted, after the guard |
| Off | The public address | Ignored | Ignored | Refused, HTTP 403 |
| On | The public address, in `Host` or `Origin` | Missing | Any | Refused |
| On | The public address | One of the host's own addresses | Any | Refused |
| On | The public address | Outside the allowed networks | Any | Refused |
| On | The public address | Inside the allowed networks | Not `https` | Refused |
| On | The public address | Inside the allowed networks | `https` | Accepted, after the guard |
| On | Loopback | Missing | Any | Accepted, after the guard, as a local browser |
| On | Loopback | Present | Any | Judged by the same address rows, so a proxy that rewrites `Host` gains nothing |

Addresses are compared in a normal form, with IPv4-mapped IPv6 forms and zone
suffixes removed. The last entry is the one the proxy adds. Caddy's
documentation, read 2026-11-03, says that it "sets or augments" the header,
ignores incoming values by default, and passes `Host` through. Post-build
check PB-2 tests this on the owner's own proxy.

The web server answers HTTP 503 during recovery, as the engine's socket does
(`server.ts:99`). If its port cannot be bound, the engine keeps running without
it, and the Unix socket keeps working. The web server writes one
`client.WebServerDown` with a fixed reason, raises a `client.web-down` alert,
retries every 30 seconds, and writes `client.WebServerUp` when it binds
(row 113).

Connections are capped at 32 in total. A new connection at the cap closes the
oldest one, so the owner is not locked out by stale connections. A refused
connection never counts, and a connection that misses two heartbeats is closed
(row 119).

### Stored copies

These are all the copies of the owner's data that this plan creates or
touches (row 116):

| Where | What it holds | How it goes away |
| --- | --- | --- |
| The event log, its write-ahead log, the receipts and side tables | Everything written, after redaction | It is kept. Nothing here deletes history. |
| The views, in memory | What the log folds to | They are rebuilt at each start. |
| `secrets.json`, mode 0600 | Account keys and the carrier token, not encrypted | By secret collection (edit E27). |
| The ntfy server's cache | An alert's five fields | By the server's own retention, 12 hours by ntfy's default, and by the carrier's best-effort `clear`. |
| The phone's notifications | An alert's five fields | By the carrier's best-effort `clear`, or the owner. |
| The browser's memory | The snapshot and the threads it read | When the page closes. The page keeps no thread data in browser storage. |
| The browser's file cache | The page's static files only | By the browser. |
| A thread export file, mode 0600 | One agent's thread | By the owner. |
| The harness's own session files | The agent's conversation | Outside this plan. |

`docs/remote-access.md` has a "lost phone" section: remove the phone's
WireGuard peer, and rotate the ntfy token. While the server is open, there is
nothing on the page to sign out of.

## 6. The shared engine edits (the client API plan's first unit)

The client API plan's first unit edits the engine directly (lead ruling
L26, row 64). It does two things. It turns the engine's closed lists into
lists that a later plan extends by editing them, and it builds once the
delivery and caller rules that carry the security properties. The board
and roles plans then add their own entries to these lists, in their own
units. Engine edits are reviewed like engine units, with an attack pass
(row 63).

Each edit below names its files, what it changes in the engine's current
behaviour, and the existing tests it updates. "Existing tests" means the
tests at engine commit `8ff4c9b`. A test "keeps its expectations" when only
its imports, fixtures or setup change.

The piece namespaces are one fixed list, `PieceNamespace`, which is
`client`, `board` or `roles`, in `packages/contracts/src/namespaces.ts`.
Every per-piece table below is typed over that list, so a table without an
entry for some piece does not compile. Unit 1 writes each piece's entry in
its most refusing form, and each piece's plan replaces its own entry. So no
table ever has a missing entry, and no rule depends on whether a piece has
been built.

The service builder (`packages/engine/src/service.ts`), the command
handler, the views and the dispatcher take these lists and tables as
arguments, with the engine's own as the default. So unit 1's tests run a
fixture piece before any real piece is built. Production code always uses
the engine's own lists.

### The engine's lists that a piece adds itself to

**E1. One command group.** In `packages/contracts/src/commands.ts`,
`CommandsRpcGroup` becomes the engine's sixteen commands merged with each
piece's prefixed group, in a fixed order: `client`, `board`, `roles`. Each
piece defines its group in `packages/contracts/src/<namespace>/commands.ts`
and adds one `.merge` line here in its own unit. `ServiceRpcGroup` stays
`CommandsRpcGroup.omit("debug.compare-views")`. `commandNames` is renamed
`engineCommandNames` and keeps the sixteen engine names.

- Behaviour change: none in unit 1. The group grows as the pieces add
  commands.
- Tests updated: in `packages/contracts/test/commands.test.ts`, "lists
  exactly the sixteen commands" checks `engineCommandNames`. The checks of
  the group sizes (15, 16 and 1) and of "exactly ten commands for the MCP
  server" become checks that the engine's commands are present with their
  current shape. A new test, `packages/contracts/test/unique.test.ts`,
  asserts that every command name and every event tag is unique and that
  every piece name starts with its namespace and a dot.

**E2. Access by caller kind, checked before the receipts.** In `commands.ts`, `ownerOnlyCommands` (l.16)
and `commandAccess` (l.20), whose values are "agent-callable" or
"owner-only", become one table. It maps every command in the group to the
caller kinds that may call it, out of `owner`, `device`, `agent` and
`service`. It is typed over the whole group, so a command without an entry
does not compile.

- The engine's commands keep today's access exactly. An owner-only command
  gets `owner` and `device`. An agent-callable command gets `owner`,
  `device` and `agent`. The planners of `ask`, `wait` and `pass-up` keep
  refusing the owner as they do today. Edit E13 adds `service` to
  `subscribe`, `prompt`, `compact` and `resume`. `answer` gets no
  `service` (row 75).
- A device is checked as a device. The command handler reads the caller
  kind from the wire credential (`CommandHandler.ts:45`) before it maps a
  device to the owner actor (`CommandHandler.ts:207`). The host-only list
  (row 55) is then a matter of leaving `device` out of a command's entry.
  Today every engine command that the owner may call, a device may call
  too, so no engine command changes.
- `debug.compare-views` gets `owner` alone, which is today's answer
  (`server.ts:163-165`), so a device is refused it (row 99).
- The access check at `CommandHandler.ts:70` (`owners.has(name) &&
  actor._tag !== "owner"`) becomes a lookup of the caller kind in the
  table. It moves out of `planCommand` to before the receipt lookup (l.238),
  because a device shares the owner's receipts. So a caller without access
  can never get a stored reply by presenting a request id and body (row 100).
  An agent's access refusal is written as today, with a receipt under its own
  key. A device's access refusal writes `CommandRefused` with no receipt, so
  it can never be replayed to the owner.
- The MCP tool list (`packages/mcp/src/tools.ts:7`) offers the commands
  whose entry includes `agent`, less every stream and the secret-setting
  commands (row 97).
- Behaviour change: none for the engine's commands, except that a device's
  access refusal has no receipt, and no engine command refuses a device today.
- Tests updated: in `commands.test.ts`, "tags every command agent-callable
  or owner-only" is rewritten for the caller-kind table.
  `packages/cli/test/parity.test.ts` (P02) reads the new table.
  `packages/engine/test/commands/authorization.test.ts` keeps its
  expectations and gains device and service cases, and a case that a device
  replaying an owner-only request id and body is refused.
  `packages/engine/test/api/compare-views-rpc.test.ts` gains a device case.

**E3. A planner table instead of the `supported` set.** In
`packages/engine/src/commands/CommandHandler.ts`, the hard-coded
`supported` set (l.54) and the `planCommand` switch (l.67) become one
table of planners by command name, in
`packages/engine/src/commands/planners.ts`. A piece adds its planners,
written in `packages/engine/src/<namespace>/`, to this table. Every command
in the group is in exactly one of this table and the read table (edit E4),
and a test asserts this. Section 1, "How a piece's command runs", gives the
rule for which table a command belongs to.

- **The reply.** `Plan` (`packages/engine/src/commands/internal.ts:41`)
  gains one field, `reply`, a function from the committed, redacted batch
  of envelopes to the command's reply. The handler passes it to the
  receipt writer in place of `replyFor` (`CommandHandler.ts:269`), so the
  receipt stores that reply. The handler then decodes the stored reply
  against the command's success schema, as it does today (l.249). A resent
  request returns the stored reply (l.254), with no second write. A piece's
  planner must set `reply`. An engine planner leaves it unset, and the
  handler keeps using `replyFor` (l.97) for it.
- **`afterCommit` stays for the engine's planners** (row 102). It does two
  different things today, and both stay. It runs an external action after the
  commit: `start` starts the runner and records its session
  (`commands/start.ts:53-79`), `stop` stops it (`commands/stop.ts:20`),
  `resume` reloads and dispatches (`commands/resume.ts:45-56`), and `answer`
  delivers the selected option (`routing/permissions.ts:49-54`). For the
  blocking `wait` alone, it also replaces the immediate reply with a later
  one. Every engine hook keeps its order and its send lane. A replayed request
  runs no hook. A piece's planner never sets `afterCommit`, so `Plan` for a
  piece has no such field.
- **What a reply may hold.** Identifiers, counts and fixed values taken from
  the planner's own batch. Never text from an event, and never a record
  read from the views. The receipt writer already redacts the reply
  (`EventLog.ts:210-220`).
- Behaviour change: none for the engine's commands. The engine's fourteen
  transactional commands map to the same planners, the same replies and the
  same after-commit actions as today.
- Tests updated: `packages/engine/test/commands/handler.test.ts`,
  `authorization.test.ts`, `lifecycle.test.ts` (the start and stop assertions
  at l.65-84 and l.153-177), `packages/engine/test/routing/permissions.test.ts`
  and `transaction-receipts.test.ts` keep their expectations. `transaction-receipts.test.ts` gains fixture-piece cases:
  the first reply and every resent reply are equal, and one logical change
  is written. `packages/engine/test/log/receipts.test.ts` gains a case that
  a piece's receipt holds its reply.

**E4. A read table at the server.** `packages/engine/src/api/server.ts`
handles `subscribe` and `debug.compare-views` inline (l.153 to 168). Both
move into `packages/engine/src/api/reads.ts`, a table of read handlers by
command name. A piece adds its reads there, such as `client.snapshot`,
`client.thread`, `client.subscribe`, `board.read` and `board.status`. A
read checks the caller's access and applies the visibility rule (edit E8)
on every request, including a resent one, so a caller that lost access
since its first try is refused. It holds no writer permit while it builds
its reply, and it is never deduplicated.

- **Reads with marks.** A read entry may also return mark events of its own
  namespace, such as `board.Read`. The read builds its reply from one views
  snapshot, then writes the marks through the piece batch path (edit E23),
  as the calling caller, under a fresh internal request id, with no receipt
  (the writer's existing `receiptResult: false`, `EventLog.ts:210`). The
  reply is returned to the caller and stored nowhere. A resent request
  computes a fresh page and writes its marks again, so marks must be safe
  to write twice, such as a read watermark that only moves forward.
- The server's hard-wired group (l.85) and handler type (l.38) follow
  `CommandsRpcGroup`, which now includes every piece.
- `debug.compare-views` stays behind the debug flag in this table (l.85,
  l.163-165). The web server refuses it by name (row 99).
- Behaviour change: none for the engine's commands.
- Tests updated: `packages/engine/test/api/compare-views-rpc.test.ts` and
  `subscribe-visibility.test.ts` keep their expectations. A new test,
  `packages/engine/test/api/read-marks.test.ts`, covers a lost reply
  followed by a loss of access and a resend of the same request id, which
  is refused, and checks that the receipts table holds no page text.

**E5. One event union.** In `packages/contracts/src/events.ts`, the
`Event` union (l.88) becomes the engine's events plus each piece's union,
defined in `packages/contracts/src/<namespace>/events.ts`. The envelope
stays one schema, `EventEnvelope` (l.184). The log writer's decode
(`EventLog.ts`, near l.182) needs no edit of its own. Every engine view
ignores a piece's tags. That includes the threads view: `threadAgent`
(`views/apply.ts:122-123`) tests for a field by name, and it is limited to
engine tags, so an event such as `client.AlertRaised`, which has an `agentId`,
never joins a thread. `packages/engine/test/views/apply.test.ts` gains that
case. `CommandRefused` gains an optional `sourceSequence` (edit E23).

- **The lifecycle table.** `eventTable` in
  `packages/contracts/src/stateMachine.ts:79` is typed over every event
  tag, so a new event without a row does not compile. Each piece's events
  enter it through one spread per piece, `...keepInEveryState(<namespace>
  event tags)`, which gives every piece event the effect `keep` in all
  seven states. A piece event never changes an agent's lifecycle state. A
  new engine event, such as the roles plan's `DeliveryHeld` and
  `DeliveryReleased`, gets its own explicit row, decided cell by cell by
  the plan that adds it. No fallback for unknown tags is added, and
  `eventEffect` (l.122) is unchanged.
- **The tests that list every tag.**
  `packages/contracts/test/state-machine.test.ts` (l.285, l.333) already
  enumerates the whole union and keeps its expectations.
  `packages/engine/test/api/subscribe-visibility.test.ts` checks at l.149
  that its samples cover every tag, so each piece adds one sample per
  event, and test 7.3 (l.154) chooses its expected rows by each tag's
  visibility class (edit E8), keeping its expectations for the engine's
  tags.
- Behaviour change: none. Every existing event still decodes.
- Tests updated: `packages/contracts/test/events-roundtrip.test.ts` gains
  each piece's events; `state-machine.test.ts` and
  `subscribe-visibility.test.ts` as above.

**E6. Piece views inside the engine's views.** In
`packages/engine/src/views/apply.ts`, the views `State` gains one field per
piece, named after its namespace. `emptyViews` (l.114) starts each piece's
view, and `apply` (l.338) calls each piece's reducer after the engine's
own. So start-up rebuild, `debug.compare-views` and the rebuild check
(`packages/engine/test/support/rebuildCheck.ts`) cover every piece with no
more code, and "the log is the whole truth" holds for every piece.

- A piece's reactors join the engine's followers of committed events,
  started in `packages/engine/src/service.ts`. A reactor reads events in
  sequence order, writes only through the piece batch path (edit E23), and
  follows section 1's rules: it starts after `recovery.whenReady`, keeps its
  position by source sequence, writes one first-start event, and stops at an
  event it could not write (row 108). A new test, with a fixture reactor,
  holds recovery open and checks that no piece batch is written before
  `whenReady`.
- Behaviour change: the views state gains fields, and `debug.compare-views`
  reports differences in them.
- Tests updated: `packages/engine/test/views/apply.test.ts`,
  `rebuild.test.ts`, `compare-views.test.ts` and
  `test/support/viewFixtures.ts` gain the new fields. Their expectations
  for the engine's own fields stay.
  `test/support/every-file-registers-rebuild.test.ts` covers the piece
  folders.

**E7. Piece migrations and side rows.** In
`packages/engine/src/log/migrations.ts`, the migration list runs each
piece's migrations after the engine's. A piece's migrations create only
tables named `<namespace>_*`, and a test asserts this. Side rows that a
piece writes in the command transaction go through `sideRows`
(`EventLog.ts:199-204`), which gains one entry per piece table.

- Behaviour change: none for the engine's tables.
- Tests updated: `packages/engine/test/log/append.test.ts` and
  `receipts.test.ts` keep their expectations.

**E8. One visibility function.** The subscription filter written inline at
`server.ts:155-159` moves to `packages/engine/src/api/visibility.ts`, as a
pure function of the caller, the envelope and the views. A class table in
`packages/contracts/src/visibility.ts` gives every event tag its class
(section 3). It is typed over the whole union, so an event without a class
does not compile. Every engine tag is `agent-scoped`, and an
`agent-scoped` envelope with no `agentId` is hidden from agents. A piece's
`piece-decided` rules sit in a table keyed by tag, in its engine folder.
`subscribe`, `client.subscribe`, `client.snapshot`, `client.roster`,
`client.thread` and every paged read call this one function.

- **The read rule** (section 3, lead ruling L29). Today's filter
  (`server.ts:155-159`) lets an agent see only itself and its structural
  children. The function adds one case: the agent is the envelope agent's
  effective holder, by `holderAbove` (`routing/holders.ts:21`), because
  that agent's parent is unavailable. It is evaluated against the current
  views, as today's filter is.
- Behaviour change: an agent now also sees the events of an agent whose
  parent is unavailable and whose effective holder it is. Everything else
  is filtered as today.
- Tests updated: `packages/engine/test/api/subscribe-visibility.test.ts`
  changes. Test 7.3 (l.154) says an agent's `subscribe` "never" returns a
  grandchild's events. Its sample events change the child's and the
  subscriber's lifecycle states (l.60, l.81, l.84), so under the read rule
  its expected rows are computed from the read rule against the views at
  each delivery, not fixed. 7.3 becomes "a grandchild's events only while
  the child is unavailable and the subscriber is its effective holder", in
  catch-up and live. The engine design's sentence on what `subscribe`
  shows an agent (`docs/specs/2026-11-01-engine-design.md`, section 3) is
  updated to match. New cases
  cover three generations through a pause, a crash and a recovery, and
  check that the read ends when the child recovers, both live and on
  catch-up. 7.3 also chooses its expected rows by each tag's visibility
  class (edit E5), and gains a service case.

**E9. The snapshot and its sections.** A new module,
`packages/engine/src/api/snapshot.ts`, serves `client.snapshot`. It reads one
value from `views.snapshot` and builds every part of the reply from it. Its
sequence is that value's own `sequence` (`views/apply.ts:342`), and it never
reads the log's head. A SQL read transaction could not make the two agree,
because the views are an in-memory reference published after the commit
(`views/Views.ts:41-44`, `EventLog.ts:136-140`) (row 103). The reply is built
after the value is read, and holds no writer permit. Every piece's section and
the wait-state section (section 3) use the same value. A section table, typed over `PieceNamespace`,
holds each piece's `snapshotFor(caller, view)`, which returns the piece's
section or nothing (lead ruling L15). Its `view` is that one views value, not
only the piece's own field. Unit 1 writes each entry as "no
section". The board's plan writes its bounded summary with no post text,
and nothing for an agent (lead ruling L23).

- Behaviour change: none. This is a new read.
- Tests: a new test holds publication open between a commit and the views'
  update, and takes a snapshot in that gap and on both sides of it. Every
  transition appears in the snapshot or the later stream, exactly once.

**E10. Command-line names.** `packages/cli/src/commands/registry.ts:10`
already lists every command in the group. It maps `<namespace>.<name>` to
`shephrd <namespace> <name>`, and splits a dotted name, such as
`client.alerts.dismiss`, into words. `debug.compare-views` keeps its present
form.

- Behaviour change: none for the engine's commands.
- Tests updated: `packages/cli/test/command-inventory.test.ts` and
  `parity.test.ts` keep their expectations for the engine's commands and
  cover the whole group.

### Callers

**E11. The caller schema.** `Actor` (`events.ts:8`) stays `owner` or
`agent`, because it also types a request's holder and an agent's parent,
and a service is never either. A new union, `Caller`, is `owner`, `agent`,
`service { service, rule? }`, or `piece { namespace }`. It types the
envelope's `caller` (`events.ts:184`). The `piece` variant is written only
by a piece's own reactors, through the piece batch path (edit E23). A read's
marks are written under the calling caller. The `piece` variant has no
credential, no access entry, and calls no command.

- **The receipts key.** `callerKey` (`EventLog.ts:116`) gains
  `service:<name>` and `piece:<namespace>`, without the rule. The handler's
  own copy of the key (`CommandHandler.ts:237`) is replaced by a call to
  `callerKey`.
- Behaviour change: the envelope's `caller` schema widens. Every existing
  envelope still decodes.
- Tests updated: `events-roundtrip.test.ts` and
  `packages/engine/test/log/receipts.test.ts` gain service and piece cases.

**E12. The acting device.** `EventEnvelope` gains one optional field,
`device`, holding a `DeviceId`. The command handler sets it from the device
credential and keeps `caller: owner` (`CommandHandler.ts:207`). This keeps
every engine rule that tests for the owner working for a device with no
edit of its own (row 66).

- **The open web caller's path** (row 96). `Credential`
  (`CommandHandler.ts:45-48`) gains one in-process shape,
  `{ _tag: "open-web" }`. A value of it can be built only by the exported
  constructor in `packages/engine/src/client/web/webCaller.ts`, and a
  boundary test checks that nothing else imports that constructor. It has no
  wire or disk form, and the socket's `authenticate` (`server.ts:87-96`) can
  never produce it. `execute` treats it as access kind `device`, verifies
  nothing, maps it to the owner actor, and sets `device: open-web`. The
  per-connection credential recheck (`server.ts:119-127`) does not apply to it.
- **The reserved id.** `open-web` is refused as the id of a real device, in
  `mintDeviceCredential` (`identity/devices.ts:12`) and by `DeviceAdded`'s
  planner. So no real credential can ever be recorded under it.
- Behaviour change: an envelope written for a device carries `device`.
- Tests updated: `packages/engine/test/commands/handler.test.ts` gains a
  device case and an open-web case. `packages/engine/test/api/auth.test.ts`
  gains a case that no credential maps to it.
  `packages/engine/test/api/per-request-credential.test.ts` keeps its
  expectations. New test: `packages/engine/test/client/web-caller-path.test.ts`.

**E11 and E12 together: one durable form of the caller and the device**
(lead's round 4, S4; row 71). Today the `events` table stores only the
receipts key in `events.caller` (`migrations.ts:16`), and the log reader
rebuilds the caller from that string alone (`log/subscribe.ts:36-38`). So
a service's rule and a device's id would be lost on every read of the log.
The edits are:

- **The migration.** A new engine migration adds two nullable columns to
  `events`: `caller_rule` (a standing rule's id) and `device_id`. Old rows
  have neither, and decode as today. `events.caller` keeps the receipts key
  form: `owner`, `agent:<id>`, `service:<name>` or `piece:<namespace>`.
- **The append path.** `append` (`EventLog.ts`, the `commit` function,
  l.145) takes the full `Caller` and the optional device, in place of an
  `Actor`. It writes `caller`, `caller_rule` and `device_id` for every
  event of the batch, and builds the live envelope (l.182) from the same
  values.
- **One row decoder.** `decodeRow` (`log/subscribe.ts:36`) reads the three
  columns and rebuilds the full caller and the device. It accepts each of
  the four key forms and refuses any other. Catch-up (`log/subscribe.ts`),
  the rebuild (`views/rebuild.ts:26`) and the paged agent read (edit E21)
  all select the three columns and call this one decoder.
- **Equality.** For every caller kind, with and without a rule and a
  device, the live envelope, the catch-up envelope and the rebuilt envelope
  are equal.
- Behaviour change: the `events` table gains two columns. Every existing
  row still decodes, with no rule and no device.
- Tests updated: `packages/engine/test/log/append.test.ts`,
  `log/subscribe-gapless.test.ts`, `log/receipts.test.ts` and
  `packages/engine/test/views/rebuild.test.ts` gain service, rule, piece
  and device cases. A new test, `packages/engine/test/log/caller-durable.test.ts`,
  compares live, catch-up and rebuilt envelopes, including after a restart.

**E13. The in-process service path and its rights.** A new module,
`packages/engine/src/commands/services.ts`, holds the service list, a fixed
list of names in code, which the roles plan edits. Its entry point runs a
command as a named service and is reachable only from inside the process.
It refuses a name that is not on the list. The server's `authenticate`
(`server.ts:87`) gains no service branch, so no wire credential can ever
become a service. The service's rights are those of section 2, enforced in
code:

- the command's access entry must include `service` (edit E2), and the
  service's own entry in the service list must name the command;
- the engine's rights helper lets a service `prompt`, `compact` and
  `resume` any agent, under the engine's state table;
- a service's `subscribe` runs through the read table of edit E4, by an
  in-process call in the same module, because `subscribe` is a read and not a
  handler command (row 126);
- `resume` passes its caller to `reload`, whose later writes run after the
  commit (`commands/resume.ts:47`, `recovery/reload.ts:104`, l.134, l.138).
  `reload`'s parameter changes from `Actor` to `Caller`, so a service's resume
  records the service on those writes too (row 126);
- `answer` is refused for every service (row 75), because no service calls
  it: a standing rule's answer is written inside the engine's permission
  transaction instead (edit E14);
- everything else is refused.

- Behaviour change: none for the owner, devices and agents.
- Tests updated: `packages/engine/test/api/auth.test.ts` keeps its
  expectations and gains a case that no credential maps to a service. A new
  test, `packages/engine/test/commands/service-caller.test.ts`, covers each
  right and each refusal.

**E14. A service's answer names its rule.** In `events.ts:132`,
`PermissionAnswered.answeredBy` changes from `Actor` to `Caller`. The
permission view (`views/apply.ts:45`) follows. The answer planner
(`routing/permissions.ts:47`) sets it from the caller, which for the
`answer` command is the owner or an agent. When the roles' standing-rule
matcher answers inside the permission request's own transaction (roles
plan, WS-7a), the engine sets it to the standing-rule service and its
rule. So the event itself records "standing rule 4", not the owner. `QuestionAnswered.answeredBy`
stays `Actor`, because a service never answers a question.

- Behaviour change: an existing event field widens. Every existing event
  still decodes.
- Tests updated: `packages/engine/test/routing/permissions.test.ts` and
  `events-roundtrip.test.ts` gain a service case.

### Deliveries from a piece

**E15. Who a delivery is from, and the envelope for every sender but the
owner.** In `events.ts`, every field that carries a delivery's sender
changes from `Actor` to `Sender`, which is `owner`, `agent`,
`service { service }` or `piece { namespace }`. There are three such
fields, and no others (lead's round 4, S5; row 72):

- `Delivery.sender` (l.23), which `DeliveryQueued` carries;
- `PromptSent.sender` (l.112);
- `DeliveryReturned.sender` (l.162), which the return builder copies from
  the delivery (`routing/deliveries.ts:46`).

The planners that set a sender from the caller (`commands/prompt.ts:10`,
`commands/compact.ts:8`, `commands/start.ts:44`, `routing/questions.ts:30`)
map a service caller to `service { service }`. The prompt text function,
`agentText` (`routing/envelope.ts:22-23`), today wraps only an agent's
text (`sender._tag === "agent"`). It changes to wrap every sender except
the owner: an agent, a service and a piece. The wrapping is the engine's
agent-text envelope, with a fresh random marker, and a leading `/` is
escaped (lead ruling L11). The envelope's fixed text
(`routing/envelope.ts:14-18`) says "Data from another agent". It takes the
sender, so an agent's wording is unchanged, and a service or a piece gets
fixed wording that names it (row 126).

- A piece queues a delivery only by returning a delivery request, which
  the piece batch path (edit E23) passes to one helper,
  `packages/engine/src/routing/pieceDelivery.ts`. The helper takes a text
  body and the piece's own namespace, never a sender, a raw prompt or a
  content kind. So a piece can never send unwrapped text.
- The delivery is shown as from the piece, by its namespace in fixed text,
  such as "board", never "owner" (lead ruling L16).
- The piece names each item's true author in a header built only from
  fixed words and the engine-authenticated caller id, never from agent
  text. This holds also for a wake the piece builds with no caller (lead
  ruling L16).
- A returned delivery (`routing/deliveries.ts:46-52`) whose sender is a
  service or a piece gets only its `DeliveryReturned`, as an owner's does
  today (l.47). No "not delivered" notice to an agent sender is built. For
  a delivery with a piece source, the piece's source rule (edit E16) and
  its reactor then act on that `DeliveryReturned`.
- Behaviour change: none for the owner's and agents' deliveries.
- Tests updated: `packages/contracts/test/events-roundtrip.test.ts` gains
  service and piece senders on all three events, and keeps the owner and
  agent encodings. `packages/engine/test/routing/text-is-data.test.ts`,
  `packages/engine/test/live-check/rendered-prompts.test.ts` and
  `routing/deliveries.test.ts` keep their expectations and gain service and
  piece cases. `deliveries.test.ts` returns a piece delivery through the
  real failed-send path (l.130), before and after acceptance.

**E16. A piece's delivery source.** In `events.ts:30`, `Delivery.source`
gains a fourth variant, `piece { namespace, id }`. `routing/deliveries.ts:62`
asks the piece's source rule, in a table typed over `PieceNamespace`, one
question: when the delivery's target stops or crashes while it is queued, is
the delivery withdrawn or returned? Unit 1 writes each entry as "withdraw". A
delivery that is returned is already finished, so no rule applies to it. The
engine writes `DeliveryReturned`, and the piece's reactor acts on that event
(row 126). The permission, question and wait sources keep their rules.

- Behaviour change: none for the existing sources.
- Tests updated: `routing/deliveries.test.ts` keeps its expectations.

**E17. A piece withdraws only its own queued delivery.** A piece's planner
or reactor may return `DeliveryWithdrawn` only for a delivery whose source
is `piece` with the piece's own namespace, and only while that delivery is
still queued (lead rulings L11, L15). The piece batch path (edit E23)
checks both inside the transaction and refuses the whole batch otherwise. So a piece
can never withdraw a sent or accepted delivery, another piece's delivery,
or the engine's. The engine's own withdrawals, for moved and cancelled
requests, are unchanged.

- Tests updated: `routing/move-withdrawal.test.ts` keeps its expectations.
  A new test, `packages/engine/test/routing/piece-withdrawal.test.ts`,
  covers each refusal.

**E18. The reach check, at queue time and at send time.** A table typed
over `PieceNamespace`, in `packages/engine/src/routing/reach.ts`, holds
each piece's reach check. Unit 1 writes each entry as "refuse", so no
piece can deliver until its own plan writes its check. The board's plan
writes the board's (lead rulings L13, L15, L19, L22, L23).

- **Which deliveries.** Every delivery with a `piece` source is judged: to
  a target inside the calling agent's tree or outside it, and one the
  piece builds with no caller. "Outside the calling agent's tree" limits
  only what the check may allow. It is the one case where the check lets
  through a delivery that the engine's tree rule alone would not.
- **Inputs.** The caller, when there is one; the target; the delivery
  being judged, as its delivery id and its source `{ namespace, id }`; and
  the views snapshot of the same transaction, never an earlier read.
- **At queue time,** that snapshot is projected with the command's own
  batch of events, as the engine's `withWaitChecks` does
  (`packages/engine/src/routing/waits.ts:110`). So the check sees the
  effect of the same command's earlier events. A delivery that fails is
  never queued, and the piece batch path (edit E23) refuses the batch that
  carries it, whether a planner, a read's marks or a reactor built it.
- **At send time,** the delivery dispatcher in `routing/deliveries.ts`
  runs the check again inside the send transaction, against the views
  snapshot at send time. A delivery that fails is withdrawn with
  `DeliveryWithdrawn` and never sent. The dispatcher then goes on to the
  target's next queued delivery in the same pass, so one withdrawn delivery
  never holds up the ones behind it. The withdrawal runs the engine's
  wait checks (`withWaitChecks`, `routing/waits.ts:110`), as the
  failed-send batch does
  (`routing/deliveries.ts:259`), so a wait on the target is judged again
  in the same batch.
- **Purity.** The check is a pure function of its inputs. It reads no clock
  and no file.
- **No other right.** An allow lets the delivery through and nothing else.
  `stop`, `answer`, `compact`, `resume` and an engine `prompt` on the
  target stay under the engine's rights helper.
- The dispatcher's functions take the tables as arguments, so unit 1's
  tests use their own checks without a built piece.
- Behaviour change: none for deliveries without a `piece` source.
- Tests updated: `routing/deliveries.test.ts` and
  `packages/engine/test/accounts/carry-on-dispatch.test.ts` keep their
  expectations. New tests cover each bullet above.

### Waiting

**E19. The settled test and the member rule move to `packages/contracts`,
with each piece's hold condition.** `settled` (`routing/waits.ts:39`), `holds`
(l.33), `reasonOf` (l.49) and the "any" and "all" closing rule (l.92) move to
`packages/contracts/src/settled.ts` (row 104). They become pure functions
over a small input type defined there, which the engine builds from its
views and the client library builds from `client.snapshot` and the stream.
The input includes the agents' states with `reloadable`, the open requests and
questions with their holders, the open deliveries and the open non-blocking
waits, all of which the snapshot holds (section 3).
`waits.ts` imports them, with no re-export at the old place. A
hold-unsettled table, typed over `PieceNamespace`, holds each piece's
condition: while it holds for an agent, that agent is not settled (lead
ruling L10). Unit 1 writes each entry as "never". The input carries the
engine's deliveries with their status by delivery
id. A piece's entry also takes the piece's own view, which the engine
passes. The board's plan writes the board's entry, a function of both,
because its third clause asks whether a queued or sent board wake
carries a post (board contract, "Settled and waiting"). The client
helper `waitForAgents` applies the engine's part of the test itself, and
each piece's part through that piece's results (section 3).

- Behaviour change: none in unit 1. The settled test changes for agents
  that use the board once the board's plan writes its entry.
- Tests updated: `packages/engine/test/routing/waits.test.ts` and
  `packages/engine/test/acceptance/capability-05-wait.test.ts` keep their
  expectations. Their imports change where they import `settled`.

**E20. "Request held" for blocking waits, with each piece's condition.**
The engine ends a blocking `wait` with "request held" when the waiter holds
an engine request or question (`routing/waits.ts:83`). A request-held
table, typed over `PieceNamespace`, holds each piece's matching condition
(lead ruling L15). The engine checks it when the wait opens and after every
batch, as it checks `holds`. Unit 1 writes each entry as "never". The
board's plan writes the board's: the waiter is an addressee of an open post
that needs its reply and has no disposition for it (lead ruling L22).

- Behaviour change: none in unit 1.
- Tests updated: `routing/waits.test.ts` keeps its expectations.

### Reads and helpers

**E21. A paged read of one agent's events,** from a sequence number, for
`client.thread` and `client.subscribe`'s agent filter. It is a new function in
`packages/engine/src/log/`. The existing agent column misses a
`DeliveryQueued`, whose target is inside the delivery (`EventLog.ts:175`,
issue 31), so a read by that column would differ from the engine's `threads`
view (row 125). So a new engine migration adds a nullable column,
`thread_agent_id`, indexed, and fills old rows: the agent column, or the
delivery's target for a `DeliveryQueued`. `append` fills it from `threadAgent`,
which is exported from `views/apply.ts`. The read selects the caller and
device columns and decodes each row with the one row decoder of edits E11
and E12. It applies the visibility function to each row, so an agent still
does not see an envelope with no `agentId` (issue 164 stands).

- Behaviour change: the `events` table gains one column.
- Tests updated: none existing. A new test compares an owner's paged thread
  with the rebuilt `threads` view, with a queued delivery across a page
  boundary, and checks that an agent's read still hides it.

**E22. The helpers a piece calls.** The engine's rights helper (the
management rule: the target's effective holder, `mayActForHolder` and
`holderAbove` in `routing/holders.ts`) and the read rule of edit E8 are
exported from `packages/engine/src/routing/` for the pieces' planners and
reads. They compute and never write. A piece gets an engine delivery only
by returning a delivery request (edit E23). A piece cannot return an
engine event that the engine's own rules would refuse: the piece batch
path (edit E23) checks every engine event a piece returns against the
state table. Nothing existing changes.

**E23. The piece batch path** (lead's round 4, S6; row 73). One function,
in a new module `packages/engine/src/commands/pieceBatch.ts`, checks every
batch that a piece's code produces, inside the writer transaction and
before `append`. There are three such batches: a planner's batch, a read's
marks, and a reactor's batch. A piece's code has no other way to write to
the log. A reactor gives the path a function from the views to its batch, so
its batch is built inside the same transaction, from the same views the checks
read (row 122). The path refuses a reactor's batch before `recovery.whenReady`
(row 108). The checks run in this order:

1. **Own events only.** Every piece event in the batch has the piece's own
   namespace. The only engine event a piece may return is
   `DeliveryWithdrawn`, under edit E17. A piece asks for a delivery by
   returning a delivery request: a target, a text body and its own source
   id. The batch path itself turns each request into a `DeliveryQueued`
   through the piece delivery helper (edit E15), with the piece as sender
   and the body in the agent-text envelope. A raw `DeliveryQueued`, or any
   other engine event, in a piece's batch is refused. A later plan that
   needs another engine event adds it to this list in its own unit, with a
   decision row. A piece never writes `OwnerNeeded` (section 4).
2. **The state table.** This check is new, because the handler checks
   commands by state, not events (`CommandHandler.ts:74`). Each engine event
   is checked with `eventEffect` against the lifecycle table (edit E5), for its
   agent's state in the snapshot projected with the batch so far. A
   `DeliveryQueued` and a `DeliveryWithdrawn` use the delivery's target. A
   piece event has no check here, because its effect is `keep`.
3. **Withdrawal.** Edit E17's own-namespace and still-queued check.
4. **Reach at queue time.** Edit E18's check, on the views snapshot
   projected with the batch.
5. **Wait checks.** `withWaitChecks` (`routing/waits.ts:110`) is applied to
   the batch, as it is for the engine's planners today
   (`CommandHandler.ts:269`).

Each batch is written under one caller and one request id:

| Batch | Caller | Request id | Receipt |
| --- | --- | --- | --- |
| A planner's | The calling caller | The command's own | The envelopes and the reply (edit E3) |
| A read's marks | The calling caller | A fresh internal id | None |
| A reactor's | `piece { namespace }` | A fresh internal id | None |

A refused batch commits none of its piece events, deliveries, marks or side
rows. What each refusal does write is fixed (row 122):

| Refused batch | What is written | What the caller gets |
| --- | --- | --- |
| A planner's | `CommandRefused`, with its receipt, as today | The refusal |
| A read's marks | Nothing | The refusal, and no reply |
| A reactor's | `CommandRefused { command: "<namespace>.reactor", reason, sourceSequence }`, under the caller `piece { namespace }` | Nothing |

The `sourceSequence` names the event the reactor was handling. A reactor with
a position counts it as handled, so a restart does not retry it forever and
no event between it and the refusal is skipped (row 108). A reactor with level
rules instead tries that duty again only after a later batch touches it, or
at start-up. Because the batch is built in the transaction, each piece's tests
can show that its reactor never builds a refused batch.

- Behaviour change: none for the engine's commands and the engine's own
  followers, which keep writing as they do today.
- Tests updated: `events-roundtrip.test.ts` gains the optional field. A new
  test, `packages/engine/test/pieces/piece-batch.test.ts`, gives a fixture
  planner, a fixture read and a fixture reactor each a batch that breaks
  each of the five checks, and asserts the exact writes in the table above. A
  boundary test checks that no file under `packages/engine/src/<namespace>/` imports
  the log writer (`log/EventLog.ts`) or the delivery helper's internals, so
  the batch path is the only way in.

### The client library

**E24. Streams dispatch by their own command** (row 109). In
`packages/client/src/index.ts`, every streaming command gets the same
`subscribe` function (l.218), which always calls
`connection.client.subscribe` (l.199). So `client.subscribe` would call the
wrong RPC. The helper takes the command's tag, keeps its filter across
reconnects, and takes its cursor from an event, a `client.Checkpoint` or a
`client.Oversized`.

- Behaviour change: none for `subscribe`.
- Tests updated: the client's existing subscribe tests keep their
  expectations. A new test drives both streams through the public client
  connection, with a filter, a checkpoint and a dropped connection.

**E25. A tolerant wire form at the client's RPC boundary** (row 109). In
`packages/contracts`, a client group mirrors `CommandsRpcGroup`, with every
stream's and page's envelope replaced by `WireEnvelope`, whose `event` and
`caller` are unknown values and whose sequence is strict.
`RpcClient.make` (`packages/client/src/index.ts:97`) uses the client group.
Above that boundary, the client library decodes each event with `Event`. A tag
it does not know becomes the unknown-event record, and the cursor moves on. A
known tag that fails to decode is an error. The server keeps encoding with the
strict group, and the engine's log validation stays strict.

- Behaviour change: none for known events.
- Tests: a test feeds real encoded frames from a newer server into an older
  client: an unknown event, then a known one, then a reconnect. A helper test
  handed a decoded object does not count.

**E26. A browser entry for the client library** (row 110). The library's root
imports Node modules and resolves a local credential
(`packages/client/src/index.ts:1-3`, l.19-22, l.120-138), so a Vite build
cannot use it. It splits into three modules, with one package:

- `packages/client/src/core.ts`, with no Node import: the wire decoding, the
  retry and cursor policy, the stream dispatch, `waitForAgents`, and a
  connection built from an RPC protocol layer.
- `packages/client/src/node.ts`: today's Unix socket, identity and ancestry
  checks. The root entry re-exports it, so the command-line tool, the MCP server
  and the pane viewer change nothing.
- `packages/client/src/browser.ts`: a connection over a browser WebSocket,
  through Effect's `layerWebSocketConstructorGlobal`, with the one credential
  module (criterion 7.1).

- Behaviour change: none for Node callers.
- Tests: a boundary test checks that `core.ts` and `browser.ts` reach no
  `node:` import. Unit 7a's production build is the real proof.

### Secrets and the web caller's answers

**E27. Secret collection keeps a piece's own slot, and secret-setting commands
are a table** (row 94). `collectSecrets` (`recovery/restart.ts:139-147`) keeps
only references that accounts name, and removes everything else at start-up. So
it would delete the carrier token. It moves to
`packages/engine/src/accounts/collectSecrets.ts`, and its keep set also takes
each piece's entry in a table typed over `PieceNamespace`, a pure function from
the views to references. Unit 1 writes each entry as "none". The client's
entry returns the fixed slot while a token is set for the current origin. The
alert worker calls it after a token is cleared, so a cleared value goes at once.

The handler's two special cases for `accounts set-secret`
(`CommandHandler.ts`, the label and the body hash) become a lookup in a
`secretCommands` table, so `client.alerts.carrier.set-token` gets the same
treatment. Its planner stores the value before committing, as `setSecret`
does (`commands/accounts.ts:38-50`).

- Behaviour change: none for accounts.
- Tests updated: `packages/engine/test/recovery/restart.test.ts`, test `6.7 R22
  issue 119` (l.606-626), keeps its abandoned and replaced secret checks and
  gains: a token used by no account survives a restart, an authenticated push
  works after it, a cleared token is removed, and removing an account leaves
  the token.

**E28. The web caller's answers. Pending the owner's question 6** (row 95).
Fold as the recommended answer. If the owner chooses the other answer, this edit
and criterion 1.41 are removed, and nothing else depends on them.

- `Input` (`commands/internal.ts:36-40`) gains `callerKind`, which `execute`
  sets before it maps a device to the owner actor (`CommandHandler.ts:205-207`).
- `answer` (`routing/permissions.ts:35-44`) refuses, for `callerKind: device`,
  an option that is persistent by its flag or its kind (`ceiling.ts:387-394`,
  `permissionForOptionKind`), and an option of an unknown kind. On a request
  with `settingsWrite`, it accepts from that caller only a non-persistent
  reject option.
- The refused request stays open, so the owner can finish it at the computer.
- The later pairing plan decides whether a paired device keeps this rule.
- Behaviour change: a device caller loses those answers. The owner's terminal
  and agents are unchanged.
- Tests updated: `packages/engine/test/routing/permissions.test.ts` keeps its
  expectations and gains a case for each option kind, for a device caller and
  for the owner.

### What the later plans then add

- **The client API's later units** add the `client` group, events, reads,
  snapshot entries and alert reactor (section 4).
- **The board's plan** adds the `board` group, events, view, migrations,
  reads, alert source, and its entries in the reach-check, source-rule,
  hold-unsettled, request-held and snapshot-section tables.
- **The roles' plan** adds the `roles` group, events, view, alert sources,
  snapshot entry, and its two services on the service list. Its
  standing-rule matcher stays as ruled.

### Size, and the order of the two units

The plan builds these edits as two engine units of high complexity, each
with an attack pass, before any piece unit:

- **Unit 1a, the lists:** edits E1 to E10, E21 and E22.
- **Unit 1b, the callers and the delivery and wait rules:** edits E11 to
  E20, E23, E27 and E28. It changes the prompt renderer and the dispatcher, which carry the
  security properties, so its attack pass covers lead rulings L13 and L16
  to L25 by name.

Edits E24, E25 and E26 change the client library, not the engine, and are part
of unit 2.

## 7. What the other pieces asked for, and where each is answered

The lead asked for each request from the other two planners to be taken in
or refused with a reason.

### The foundry roles

The foundry roles planner listed six needs, in
`.plans/plans/shepherd-foundry-roles/requests.md` on its branch, section
"From the client API".

| # | Need | Answer |
| --- | --- | --- |
| 1 | A roster query | Taken in as `client.roster` (section 3, row 25). Refused in part: an agent sees only the agents it may read by the read rule (section 3, lead ruling L29), not its whole subtree, so the roster never shows more than `subscribe` does. |
| 2 | A thread read, and an export to a file | Taken in as `client.thread`, a paged read (section 3, row 26). The export is a client-side command that writes the caller's own file. The service never writes a file for a caller. |
| 3 | A narrow caller kind for Shephrd's own services (the sheepdog, the standing-rule answerer) | Taken in as the service caller, in-process only, with the lead's narrow rights (section 2, "Services", row 27). Unit 1 edits the engine to add it (section 6, edits E11, E13 and E14). A scoped device credential was not used: it would put a token for an in-process service on disk for no gain. The roles plan adds `release` for the sheepdog in its own unit (row 120). |
| 4 | Owner commands for the roles' settings: standing rules, the sheepdog's thresholds, snoozing one group | Taken in as a rule, not as commands: piece 4 defines them in its own `roles.` group with access `owner` and `device` (section 1). Adding a standing rule creates an automatic allow that outlives a moment's access, so `roles.rules.add` is **computer-only**: its access entry is `owner` alone, and the web server refuses it by name (section 2, rows 29, 82). The roles' two setting events also raise `client.lasting-setting` when they come through the open web server (row 98). |
| 5 | Alert kinds the roles raise | Taken in: four namespaced kinds with default phone settings (section 4, row 28). A notice for a lead stays on the board. |
| 6 | Subscribe filters by group and by event kind | Taken in: `client.subscribe` filters by agent, group and event kind (section 3, row 30). |

### The message board

The message board planner listed six needs, in section R1 of
`.plans/plans/shepherd-message-board/lead-questions.md` on its branch.

| # | Need | Answer |
| --- | --- | --- |
| 1 | Board commands on every client transport, generically | Taken in: both transports serve the whole `CommandsRpcGroup` with no per-command code (section 5, "Transports", row 36). |
| 2 | Board events in the owner's live stream, not widened for agents | Taken in: board events are `owner-only`; the client API never widens the agent filter for them (section 3, row 34). |
| 3 | An alert for a post addressed to the owner, ideally with a `post` subject on `OwnerNeeded` | Taken in through an alert source, kind `board.post`, keyed by the post. A tap opens the post's author's thread, with the post in the subject panel, whose board entry the board's plan writes (section 4, rows 35, 112). Refused in part: no `post` subject on `OwnerNeeded`, because the alert source gives the same result, and the board does not write `OwnerNeeded` at all, so one matter raises one alert. |
| 4 | Paged reads with a cursor | Taken in: one paged-read shape for every piece (section 1, "Paged reads", row 32). |
| 5 | The owner posts from any device as the owner, reusing any device field | Taken in: the caller stays `owner`; the envelope's optional `device` field records the device, and the board adds no field of its own (section 2, row 33). |
| 6 | A transport message limit of at least a 16,384-character post plus its envelope | Taken in: the web server's inbound limit is 1 mebibyte, and each piece's largest event and page is checked against the budgets (lead ruling L15, row 105); the engine's socket keeps its current behaviour (section 5, rows 36, 58). |

The board's delivery source for posts, from its question Q1, is section 6,
edit E16.

## What this contract does not settle

These are left to later plans:

- Authentication and pairing for the web server, including how a browser
  presents its device credential. The owner deferred both (rows 80, 86).
  They slot into `webCaller` and do not change what the other pieces build
  on.
- Shephrd's own Unix user (row 78).
- Whether a web caller may give a lasting answer. The owner's question 6 decides
  it, and edit E28 is written as the recommended answer (row 95).
