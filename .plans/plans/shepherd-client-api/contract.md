---
topic: shepherd-client-api
kind: contract
status: v7, design talk 1 folded
version: 7
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
(rows 76 to 89). This contract follows them: a loopback web server that is
open for now, alerts through ntfy behind one sender interface, and three
commands that work only at the computer.

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
  `client.pair`. The piece builds its command group without the prefix and
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
  of the agents' tools. Commands without `agent` are never offered to
  agents.
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

1. The engine identifies the caller and checks the piece's access table.
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
  planner's. It never appends to the log directly. It records the last
  sequence it handled in its own view, so after a restart it resumes from
  there. A reactor whose rules are all level rules over the current
  views, such as the board's, keeps no position instead: it runs over what
  each batch touches, and over the whole state at start-up. It must be safe to run twice on the same event, because a crash
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
  engine's Unix socket with the owner credential: creating a pairing code,
  changing the web server's settings, and adding a standing permission rule
  (row 82). Their access entries leave out `device`, and the web server
  also refuses them by name. AGENTS.md rule 5 is narrowed for these three.
- **Every web server request is a web caller, decided in one place.** The
  web server is open for now (row 80, SECURITY.md rule 2 suspended for it
  by the owner). One function, `webCaller`, decides the caller of every
  request. While the server is open it answers the web caller: access kind
  `device`, actor owner, and the envelope field `device: open-web`, a
  reserved id that is never minted for a real device. So the log always
  shows that an act came through the web server. Pairing later changes only
  this function (row 81). The engine's Unix socket keeps its
  authentication unchanged.
- **The web server refuses the host's own credentials.** A request that
  presents the owner credential or an agent token is refused there, because
  the owner's proof rests on the Unix socket and its ancestry check, and
  agents always run on the host.
- **The web server refuses an agent's process.** At connection open,
  `webCaller` finds the loopback peer's process and refuses it when it
  descends from an agent, by the engine's ancestry rule (row 84). This is a
  guard against accidents and simple misuse, not a security boundary.
- **Remote access comes through the owner's proxy.** The web server binds
  loopback only, also in proxy mode (row 76). In proxy mode it accepts the
  public address's `Host` and `Origin`, and refuses a request whose last
  `X-Forwarded-For` entry is one of the host's own addresses. Outside proxy
  mode it ignores forwarded headers (row 89).
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
  set-secret`, `accounts mark-available`, `harnesses` and
  `debug.compare-views` stay owner-only, which includes devices. `ask`,
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
  the piece commands whose access includes `service`:
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
   and absent for an agent (lead ruling L23).
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
- **While L is paused, crashed or stopped,** O is W's effective holder, so
  O reads W and manages W. L keeps its structural read of W, so it can
  catch up when it resumes. L's management of W passes to O, as today.
- **When L recovers,** O's read of W ends. The filter is evaluated against
  the current views, so O's live stream stops carrying W's events, and a
  catch-up from an earlier cursor no longer returns them.

This gives O no new capability. O may stop L today, and then holds the
management rights over W that the read rule follows. A sibling or a
stranger never reads X under this rule.

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
- An agent sees every agent it may read, by the read rule. Its own entry
  names its parent, so `orient` can answer "who is my parent" without
  seeing the parent's record.
- An agent does not see its grandchildren while their parent is available.
  The roles planner asked for a whole subtree. That is wider than what the
  engine lets an agent subscribe to, and a roster that shows more than
  `subscribe` would let the two disagree. A lead that needs its workers'
  workers asks its workers, as the engine's design says.

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
the agents meet the same "settled" test the engine uses for agent waits.
Edit E19 moves that test from the engine into `packages/contracts`, so the
helper and the engine share one copy and cannot disagree. The test applies
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
pushed by default.

### The alert's life

Piece 2's alert reactor reads committed events in order (row 18):

1. **Raise.** When a source asks for an alert, the reactor writes
   `client.AlertRaised { alertId, key, kind, agentId?, subject?, title,
   sourceSequence }`. The `key` names what the alert is about, such as
   `permission:<id>`, `question:<id>`, `crash:<agentId>:<sequence>` or
   `account:<id>`. Only one alert is open for each key at a time.
2. **Deliver.** Piece 2 sends the alert to the owner's phone through one
   interface, `AlertSender`, so the push carrier can change later without
   changing these rules (row 83). ntfy is the only carrier this plan
   builds. The ntfy server and topic are settings with no default value in
   code (row 77). Each attempt is recorded as `client.AlertDelivered` or
   `client.AlertDeliveryFailed`, with the carrier's name and the attempt
   number, never the carrier's credentials.
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

An alert that leaves the host carries only five things: its kind, the
agent's name, the agent's team (its group labels), a title that Shephrd
writes from fixed text, and a link to the agent's thread on the page (row
87). It never carries any other agent text, tool output, file contents or
any secret. The owner reads the details on the page.

The agent's name and its group labels are agent-chosen text: the agent's
parent chose them (lead ruling L15). So they are treated as data. Each
travels in its own field, never inside Shephrd's title. Control and
formatting characters and line breaks are removed, and each is cut to 64
characters.

The link opens the thread, and the owner answers there (row 79). It never
answers by itself, and opening it runs no command. The link is built from
the page's public address, which is one of the web server's settings and
so works only at the computer (row 88); with none set, an alert has no
link. The ntfy server, topic and token reference are alert settings, which
the owner and the web caller may change (row 88).

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
- **Message size.** The web server sets an explicit limit of 1
  mebibyte (1,048,576 bytes) for one message. The limit is sized against
  the largest single event or reply any piece can produce, not against a
  post's text (lead ruling L15). Each piece states its largest event and
  its largest page. The board caps a wake body at 256 KiB and a
  `board.read` page at 512 KiB of encoded text, so its largest message,
  with its envelope, stays under 1 MiB. A test in `packages/contracts`
  checks every piece's stated maxima, plus the envelope, against the limit.
  The engine's socket sets no explicit limit today (scouting, planner's
  checks). This plan does not add one there, because only the owner's
  terminal, the pane viewer and the host's own agents reach that socket.

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

**E2. Access by caller kind.** In `commands.ts`, `ownerOnlyCommands` (l.16)
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
- The access check at `CommandHandler.ts:70` (`owners.has(name) &&
  actor._tag !== "owner"`) becomes a lookup of the caller kind in the
  table.
- The MCP tool list (`packages/mcp/src/tools.ts:7`) offers the commands
  whose entry includes `agent`, less `subscribe` and the secret-setting
  commands, as today.
- Behaviour change: none for the engine's commands.
- Tests updated: in `commands.test.ts`, "tags every command agent-callable
  or owner-only" is rewritten for the caller-kind table.
  `packages/cli/test/parity.test.ts` (P02) reads the new table.
  `packages/engine/test/commands/authorization.test.ts` keeps its
  expectations and gains device and service cases.

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
  handler keeps using `replyFor` (l.97) for it. `afterCommit` stays for the
  blocking `wait` only; a piece's planner never sets it.
- **What a reply may hold.** Identifiers, counts and fixed values taken from
  the planner's own batch. Never text from an event, and never a record
  read from the views. The receipt writer already redacts the reply
  (`EventLog.ts:210-220`).
- Behaviour change: none for the engine's commands. The engine's fourteen
  transactional commands map to the same planners and the same replies as
  today.
- Tests updated: `packages/engine/test/commands/handler.test.ts`,
  `authorization.test.ts` and `transaction-receipts.test.ts` keep their
  expectations. `transaction-receipts.test.ts` gains fixture-piece cases:
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
  (the writer's existing `receiptResult: false`, `EventLog.ts:205`). The
  reply is returned to the caller and stored nowhere. A resent request
  computes a fresh page and writes its marks again, so marks must be safe
  to write twice, such as a read watermark that only moves forward.
- The server's hard-wired group (l.85) and handler type (l.38) follow
  `CommandsRpcGroup`, which now includes every piece.
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
ignores a piece's tags.

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
  records
  the last sequence it handled in its own view (section 1, "Views and
  reactors").
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
`packages/engine/src/api/snapshot.ts`, serves `client.snapshot`. It reads
the views and the log's head in one read transaction, so the snapshot and
its sequence number agree. A section table, typed over `PieceNamespace`,
holds each piece's `snapshotFor(caller, view)`, which returns the piece's
section or nothing (lead ruling L15). Unit 1 writes each entry as "no
section". The board's plan writes its bounded summary with no post text,
and nothing for an agent (lead ruling L23).

- Behaviour change: none. This is a new read.

**E10. Command-line names.** `packages/cli/src/commands/registry.ts:10`
already lists every command in the group. It maps `<namespace>.<name>` to
`shephrd <namespace> <name>`, and splits a dotted name, such as
`client.pair.complete`, into words. `debug.compare-views` keeps its present
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
by a piece's own reactors and its reads' marks, through the piece batch
path (edit E23). It has no credential, no access entry, and calls no
command.

- **The receipts key.** `callerKey` (`EventLog.ts:116`) gains
  `service:<name>` and `piece:<namespace>`, without the rule. The handler's
  own copy of the key (`CommandHandler.ts:236`) is replaced by a call to
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

- Behaviour change: an envelope written for a device carries `device`.
- Tests updated: `packages/engine/test/commands/handler.test.ts` gains a
  device case. `packages/engine/test/api/per-request-credential.test.ts`
  keeps its expectations.

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
escaped (lead ruling L11).

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
asks the piece's source rule, in a table typed over `PieceNamespace`, what
happens to the delivery when its target stops or crashes, or when it is
returned. Unit 1 writes each entry as "withdraw". The permission, question
and wait sources keep their rules.

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

**E19. The settled test moves to `packages/contracts`, with each piece's
hold condition.** `settled` (`routing/waits.ts:39`) and `holds` (l.33)
move to `packages/contracts/src/settled.ts`. They become pure functions
over a small input type defined there, which the engine builds from its
views and the client library builds from `client.snapshot` and the stream.
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
`client.thread`. It is a new function in `packages/engine/src/log/`, using
the log's existing per-event agent column. It selects the caller and
device columns and decodes each row with the one row decoder of edits E11
and E12. Nothing existing changes.

**E22. The helpers a piece calls.** The engine's rights helper (the
management rule: the target's effective holder, `mayActForHolder` and
`holderAbove` in `routing/holders.ts`) and the read rule of edit E8 are
exported from `packages/engine/src/routing/` for the pieces' planners and
reads. They compute and never write. A piece gets an engine delivery only
by returning a delivery request (edit E23). A piece cannot return an
engine event that the engine's own rules would refuse: the piece batch
path (edit E23) checks every engine event a piece returns against the
state table, as the handler checks the engine's own. Nothing existing
changes.

**E23. The piece batch path** (lead's round 4, S6; row 73). One function,
in a new module `packages/engine/src/commands/pieceBatch.ts`, checks every
batch that a piece's code produces, inside the writer transaction and
before `append`. There are three such batches: a planner's batch, a read's
marks, and a reactor's batch. A piece's code has no other way to write to
the log. The checks run in this order:

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
2. **The state table.** Each engine event is checked against the lifecycle
   table (edit E5), as the handler checks the engine's own (edit E22).
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

A refused planner batch refuses the command and writes `CommandRefused`,
as today. A refused read's marks refuse the read, and its reply is not
returned. A refused reactor batch is not written. The engine instead
writes one `CommandRefused { command: "<namespace>.reactor", reason }`
under the caller `piece { namespace }`, and the reactor counts that event
as handled, so a restart does not retry it forever. A reactor with level
rules instead tries that duty again only after a
later batch touches it, or at start-up. Each piece's tests show
that its reactor never builds a refused batch.

- Behaviour change: none for the engine's commands and the engine's own
  followers, which keep writing as they do today.
- Tests updated: none existing. A new test,
  `packages/engine/test/pieces/piece-batch.test.ts`, gives a fixture
  planner, a fixture read and a fixture reactor each a batch that breaks
  each of the five checks, and checks that nothing is written. A boundary
  test checks that no file under `packages/engine/src/<namespace>/` imports
  the log writer (`log/EventLog.ts`) or the delivery helper's internals, so
  the batch path is the only way in.

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
  E20 and E23. It changes the prompt renderer and the dispatcher, which carry the
  security properties, so its attack pass covers lead rulings L13 and L16
  to L25 by name.

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
| 3 | A narrow caller kind for Shephrd's own services (the sheepdog, the standing-rule answerer) | Taken in as the service caller, in-process only, with the lead's narrow rights (section 2, "Services", row 27). Unit 1 edits the engine to add it (section 6, edits E11, E13 and E14). A scoped device credential was not used: it would put a token for an in-process service on disk for no gain. |
| 4 | Owner commands for the roles' settings: standing rules, the sheepdog's thresholds, snoozing one group | Taken in as a rule, not as commands: piece 4 defines them in its own `roles.` group with access `owner` and `device` (section 1). Adding a standing rule creates an automatic allow that outlives a moment's access, so it works only at the computer: its access entry leaves out `device` (rows 29, 82). |
| 5 | Alert kinds the roles raise | Taken in: four namespaced kinds with default phone settings (section 4, row 28). A notice for a lead stays on the board. |
| 6 | Subscribe filters by group and by event kind | Taken in: `client.subscribe` filters by agent, group and event kind (section 3, row 30). |

### The message board

The message board planner listed six needs, in section R1 of
`.plans/plans/shepherd-message-board/lead-questions.md` on its branch.

| # | Need | Answer |
| --- | --- | --- |
| 1 | Board commands on every client transport, generically | Taken in: both transports serve the whole `CommandsRpcGroup` with no per-command code (section 5, "Transports", row 36). |
| 2 | Board events in the owner's live stream, not widened for agents | Taken in: board events are `owner-only`; the client API never widens the agent filter for them (section 3, row 34). |
| 3 | An alert for a post addressed to the owner, ideally with a `post` subject on `OwnerNeeded` | Taken in through an alert source, kind `board.post`, keyed by the post, opening the post (section 4, row 35). Refused in part: no `post` subject on `OwnerNeeded`, because the alert source gives the same result, and the board does not write `OwnerNeeded` at all, so one matter raises one alert. |
| 4 | Paged reads with a cursor | Taken in: one paged-read shape for every piece (section 1, "Paged reads", row 32). |
| 5 | The owner posts from any device as the owner, reusing any device field | Taken in: the caller stays `owner`; the envelope's optional `device` field records the device, and the board adds no field of its own (section 2, row 33). |
| 6 | A transport message limit of at least a 16,384-character post plus its envelope | Taken in: the web server's limit is 1 mebibyte, sized against each piece's largest event and page (lead ruling L15); the engine's socket keeps its current behaviour (section 5, rows 36, 58). |

The board's delivery source for posts, from its question Q1, is section 6,
edit E16.

## What this contract does not settle

These are left to later plans:

- Authentication and pairing for the web server, including how a browser
  presents its device credential. The owner deferred both (rows 80, 86).
  They slot into `webCaller` and do not change what the other pieces build
  on.
- Shephrd's own Unix user (row 78).
