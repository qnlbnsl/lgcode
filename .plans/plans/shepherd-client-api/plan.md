---
topic: shepherd-client-api
status: ready for review
tier: L
created: 2026-11-03
updated: 2026-11-03
epic: shepherd-foundation
---

# Build Shephrd's client API: the web page, alerts, remote access and the pane viewer

## Overview

This plan builds the second of Shephrd's four pieces, the client API. When
it is done, the owner gets an alert on the phone when an agent needs them,
taps it to open the agent's conversation on a web page, answers its
permission request there, and reads any thread from outside the house
through the owner's own proxy. The same conversations can be read and
answered in a pane inside Herdr. That is epic row 2, except pairing, which
the owner deferred.

Today the engine runs agents and records everything they do, but only the
owner's own terminal can reach it, through a private socket file on the
machine. Nothing sends an alert, and there is no web page. The engine
already has the parts this plan builds on: it records when the owner is
needed, it can stream every event to a client, and it has a slot for
device credentials that nothing fills yet.

The work starts with edits to the engine itself. The engine's list of
commands, its list of event kinds and its two kinds of caller are all
fixed, and the message board and the foundry roles need the same changes.
The owner said to edit the engine directly (2026-11-03). So the plan's
first two units change the engine's lists so that each later piece adds
its own commands, events and views to them, and add a narrow caller for
Shephrd's own background services. Each change to something the engine
already does is named in the contract, with the tests it updates.

The rest is built on those engine edits, in this order:

- the shared definitions every client uses;
- reads that suit a phone: a snapshot, a roster, a paged thread, and a
  filtered live stream;
- a web server on the machine's own loopback address, open for now;
- alerts, from "owner needed" to a phone notification through ntfy;
- the web page and the pane viewer;
- remote access through the owner's own reverse proxy;
- an end-to-end check, and one check by the owner on a real phone.

The owner settled the design questions on 2026-11-03, in design talk 1
(`docs/specs/2026-11-03-client-api-design.md`). The web server listens only
on loopback, and the owner's own proxy, such as Caddy, carries remote access
over WireGuard. Alerts go through the owner's ntfy server, behind one
sender interface so the carrier can change later. There is no own-user
unit and no pairing unit in this plan: the owner wants Shephrd in use
first, and both come later. The web server starts with no authentication,
by the owner's choice, and is built so that pairing slots in later.

The main risks are security risks, because this piece opens Shephrd to a
network for the first time. While the web server is open, any agent on the
machine, and anyone who reaches the owner's proxy, can act with the owner's
full control (SECURITY.md, rule 2, suspended for the web server by the
owner). The plan limits that where it can without adding authentication:
three commands work only at the computer, the web server refuses a
connection from an agent's process, other websites cannot use the page,
the proxy path accepts only the owner's own networks, and phone alerts carry
no thread text, only an agent's name and team, cut short. The engine units,
the reads, the web server, the alert carrier, the thread view and remote access
each get an attack pass.

## Key decisions

- **Edit the engine directly, first.** Every later piece needs the same
  engine edits, so this plan makes them before any piece unit. The
  alternative, a board or a watcher that talks to the engine as the owner,
  would make the record say "the owner" for things the owner never did.
  The owner chose direct edits on 2026-11-03.
- **Shephrd's own services get a narrow caller.** The sheepdog, which
  watches for stalled agents, may nudge, compact and resume, and nothing
  else. A standing rule's allow is written inside the engine's permission
  path, under the rule's own name, not by a service command. A service
  exists only inside Shephrd's process, so there is no credential for it to
  leak, and the record names it, not the owner. This is the lead's ruling.
- **A loopback web server, reached from outside through the owner's
  proxy.** Shephrd builds no encryption, relay or Tailscale support of its
  own. The owner chose this.
- **The web server is open for now, and pairing slots in later.** Every
  request passes through one function that decides the caller, so adding
  pairing changes that function only. The engine's own socket keeps its
  authentication. The owner chose this.
- **Three commands work only at the computer:** creating a pairing code,
  changing the web server's settings, and adding a standing permission
  rule. Each outlives a moment's access. The owner chose this.
- **The web server refuses a connection from an agent's process.** This
  stops an agent that simply runs `curl` against it. It is a guard, not a
  wall, and SECURITY.md says so.
- **The proxy path has limits of its own.** In proxy mode the web server
  accepts only the owner's named client networks, over HTTPS, and another
  local user's process only if it is the proxy's. The owner's reason for an
  open server was "only me on my network", and this makes that true. It adds
  no authentication. This is the lead's ruling, from the first review.
- **Phone alerts carry no thread text,** and go through one sender
  interface, with ntfy first. An alert says what kind of thing needs the
  owner, and names the agent and its team, each cut short and under a fixed
  label. The owner reads the details on the page. A thread's text in a
  notification could talk the owner into tapping Allow.
- **A phone alert arrives at least once, and keeps trying.** A restart never
  loses one, and it can occasionally arrive twice. A push and a record in the
  log cannot be one step, so the plan chooses the fault that is safer. An open
  alert keeps retrying every 10 minutes, so a home server that is down for an
  hour does not lose it. This is the lead's ruling, from the second review.
- **The owner approves the action, not a title.** The agent's title for an
  action may not describe it. So the page shows the action's input before
  "Allow" can be tapped, and shows a fixed warning when the input cannot be
  seen. This is the lead's ruling, from the second review.
- **One answer is pending the owner: "Allow always" from the phone.** The
  plan is written as the recommended answer, which refuses it from the web
  server for now. "Allow once" and "Deny" work from the phone. The owner's
  question 6 decides it, and the other answer removes one engine edit and one
  check.
- **A holder approves the action too.** An agent that holds a request receives
  the same redacted input, or a fixed warning, and so does a holder that it moves
  to. This is the lead's ruling, from the third review.
- **A client that subscribes uses two connections.** One carries the stream and
  one carries every other command, so a large reply cannot cost the stream its
  acknowledgement. This is the lead's ruling, from the third review.
- **One piece's mistake cannot stop the engine.** Every call into a piece's table
  goes through one guard, with a stated fallback. This is the lead's ruling, from
  the third review.
- **React for the web page, Ink for the pane viewer.** Both use React, so
  they share state code; Ink is React for terminals.
- **The engine's own `wait` stays agents-only.** The owner's terminal waits
  with a new `shephrd client wait`, built on the live stream, as owner
  choice A10 asked.

Full log → `decisions.md`. The design decisions →
`docs/specs/2026-11-03-client-api-design.md`. The contract the other two
plans build on is `contract.md`, version 13.

## Workstreams

### Later pieces can add to the engine's own lists

The engine's fixed lists of commands, events, views, visibility rules,
background reactors and alert sources become lists that each later piece
adds itself to. The engine also records which client acted, gains the
narrow service caller, lets a piece queue its own kind of delivery, and
lets a piece keep an agent "not finished" while it waits on a board reply.
The risk is breaking the engine that already works. Every change to
existing behaviour is named in the contract, every existing test passes,
and an attack pass checks both units. The owner sees nothing new yet; the
proof is a test piece that adds a command and an event end to end.

### One definition of the whole API for every client

Each piece's commands and events are combined into one definition that the
command-line tool, the agents' tools, the web page and the pane viewer all
use. A test makes sure no two pieces use the same name, because the
library would silently let one replace the other. A client that meets an
event it does not know skips it instead of breaking. The client library also
gets a browser entry, because today it runs only on Node.js.

### Reads that suit a phone

A client gets the current picture in one call, then only newer events. A
phone can ask for only some agents or some kinds of event, and still keeps
its place. A roster lists the agents, and a paged read returns one agent's
conversation. The owner's terminal can wait for agents to finish through
the same stream, and a wait ends correctly when an agent crashes or needs
the owner. The risk is a snapshot and the stream disagreeing; a test replays
the whole record and compares, and another forces a snapshot into the
moment between a write and its publication.

### Pairing a phone, later

The owner deferred pairing. This plan builds the slot for it: one function
decides every web request's caller, the page sends its credential header
from one place, and the engine already stores per-device credentials. A
later plan adds the pairing commands and changes that one function.

### A web server on the machine itself

Shephrd starts a small web server on the loopback address, which only the
machine itself can reach. It serves the web page and the API, with no
login for now. It checks that every connection comes from Shephrd's own
page, refuses a connection from an agent's process or another user's,
refuses the three computer-only commands, limits message size and connection
count, and keeps idle connections alive. If its port is taken, Shephrd keeps
running without it and alerts the owner. The risk is another website or a local
program using it; the origin checks, the agent check and the attack pass
guard what they can, and SECURITY.md states what they cannot.

### Alerts that reach the owner's phone

When the engine records that the owner is needed, or another piece raises
an alert, Shephrd records an alert, sends it to the owner's ntfy topic, and
clears it when the matter closes. A tap opens the agent's thread on the
page. Each alert kind can be switched between "push to the phone" and
"show in the page only". The risk is an alert lost across a restart. The log
holds what is still to be sent, so a restart never loses one, though a crash
at the wrong moment can send one twice. The ntfy token is written at the
computer, is bound to its server, and is never read back.

### The web page

A phone-friendly page with three parts: a situation view (what needs the
owner, what is working, what is idle), a thread view where the owner reads
an agent's conversation, answers its requests and sends it a message, and
pages for alerts and settings. Its look is decided in an owner session from
a mock. The risk is an agent's text being run as code in the page; every
agent string is shown as text, and the page forbids inline scripts. An
alert for a board post opens the thread, with the post in a panel the board's
plan fills.

### Threads in a Herdr pane

`shephrd view` opens a list of agents and their threads inside a Herdr
pane, live, and lets the owner answer and prompt from there. It uses the
owner's terminal credential, with the engine's check that it is not running
inside an agent.

### Shephrd's own user, later

The owner deferred Shephrd's own Unix user until Shephrd is in daily use.
Until then, any agent can read Shephrd's private files, as SECURITY.md
says.

### Remote access through the owner's proxy

The owner's own reverse proxy, such as Caddy, takes the phone's requests
over WireGuard, adds the encryption, and passes them to the loopback web
server. The example setup binds only the WireGuard address. Shephrd also
checks that each request comes from a network the owner named, and over
HTTPS. A test by the owner shows that a phone off WireGuard, and another
device at home, are refused.

### Proof on a real phone

An automated test drives the whole flow in a phone-sized browser. Then the
owner gets a real alert on a real phone, opens it, answers a real
permission request, and reads the thread.

## Rollout order

1. **The design decisions are made** (2026-11-03, design talk 1). The
   owner's answer on engine edits came the same day (row 63).
2. **The lead adds the new packages and dependencies** in one change
   (decision row 52), adds their test projects and the browser test setup
   (row 111), and writes the new scopes (row 53).
3. **The shared engine edits** (units 1a, then 1b) on the `engine` branch,
   each with an attack pass. Nothing else starts until every engine test
   passes on top of them, because the board and roles plans build on them
   too.
4. **The shared definitions** (unit 2).
5. **Reads and the alert reactor** (units 3 and 6a), which can be built
   side by side.
6. **The web server** (unit 5), then **the web page** (units 7a to 7c) and
   **the pane viewer** (unit 8). The page's situation view needs unit 3's reads,
   so unit 3 comes first. The page and the viewer wait on the
   owner's mock session.
7. **The alert channel** (unit 6b). The owner sets the ntfy server and
   topic.
8. **Remote access** (unit 10). The owner points the reverse proxy at the
   web server.
9. **The proof** (unit 11): the automated phone flow, then the owner's
   check on a real phone.

### Rolling back

The recorded engine reads the log only until the first new event or caller
form is written, because it decodes a closed list of both. After that, an older
build cannot start on this log. So a rollback keeps the new schemas and turns
behaviour off instead (row 127):

- Turn the web server off with its `enabled` setting, at the computer.
- Clear the ntfy server and topic with `client.alerts.carrier.set` and "none",
  so that nothing more is pushed. Pending
  alerts stay in the log and in the clients.
- Fix forward with a corrected build. Nothing deletes events, and nothing
  restores an old database.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

Conventions for every unit. Paths are relative to the Shephrd repository
root. Anchors are at engine commit `9e386b0`, and `scouting.md` records the first scouting at `8ff4c9b`. "Rows" are
rows of this plan's `decisions.md`; "engine rows" are rows of
`.plans/plans/shepherd-engine/decisions.md`. "The contract" is
`contract.md` in this folder, version 13; where a
unit and the contract disagree, the unit reports it to the lead. A test id
is a Vitest file path, run from the repository root with
`pnpm vitest run <path>`; Playwright tests run with
`pnpm playwright test <path>`. Effect code is written from Effect
4.0.5's documentation or installed source, looked up, never from memory
(AGENTS.md, "Language"). Every unit records a problem it finds in
`docs/issues.md` in the same change (AGENTS.md rule 3). No unit edits
`package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml` (row 52). Tests
set their own `SHEPHRD_HOME` under `/tmp` (engine row 54). Abbreviations:
RPC (remote procedure call), MCP (Model Context Protocol), CSP (Content
Security Policy, a header that tells the browser which scripts may run),
TTL (time to live), QA (a manual check on a real host or device).

Engine edits (rows 63, 64, 67): units 1a and 1b edit the engine directly,
as contract section 6 lists, edits E1 to E23 and E27 to E31. Existing engine behaviour
changes only where section 6 names the change. An existing test changes
only where section 6 names it, and then only as section 6 says. The check,
for every unit that touches `packages/engine`, `packages/contracts`,
`packages/client`, `packages/cli` or `packages/mcp`: the root `pnpm check`
exits 0 and its Vitest summary shows that tests ran (row 111),
and each existing file in `git diff --stat engine...HEAD --
'packages/*/test/**'` is one that section 6 names for that unit's edits.

**WS-1: Later pieces can add to the engine's own lists**

Purpose: make the engine's closed lists into lists that pieces 2 to 4 edit
directly, and build once the caller, delivery and wait rules that carry the
security properties, so the record always names the real actor. Units: 1a
the lists; 1b the callers and the delivery and wait rules. Contract
section 6, edits E1 to E23 and E27 to E31.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | Every engine test, the acceptance suite and the rebuild check pass; every existing test file that changed is one contract section 6 names for the unit's edits, changed only as it says | Command: the root `pnpm check` exits 0 with a Vitest summary showing tests ran, and `git diff --stat engine...HEAD -- 'packages/*/test/**'` lists only new files and files named in section 6; the focused reviewer matches each to its edit |
| 1.2 | A fixture piece in a test build has its prefixed command served on the Unix socket, its request id replayed by the receipts, its event stored, redacted and rebuilt into its view field, and its view covered by the rebuild check and `debug.compare-views` | Test id: `packages/engine/test/pieces/fixture-piece.test.ts` |
| 1.3 | Every command name and event tag is unique, every piece name starts with its namespace and a dot, and every command is in exactly one of the planner table and the read table; the check compares each group's declarations before the merge, and a duplicate fixture fails | Test id: `packages/contracts/test/unique.test.ts`; `packages/engine/test/commands/planner-table.test.ts` |
| 1.4 | Access by caller kind: every engine command gives the owner, a device and an agent exactly today's answer, including `debug.compare-views`, which a device is refused; a command whose entry leaves out `device` is refused for a device and allowed for the owner; `pass-up` stays open to the owner and a device for an agent-held row | Test id: `packages/engine/test/commands/authorization.test.ts` (updated per E2); `packages/engine/test/commands/caller-kinds.test.ts` |
| 1.5 | Visibility: `agent-scoped`, `owner-only` and `piece-decided` each give the owner, a device, a service, an agent and its child exactly the contract's answer; the engine's events are filtered as today, except the read rule's effective-holder case (criterion 1.28); an event tag without a class does not compile | Test id: `packages/engine/test/api/subscribe-visibility.test.ts`; `packages/engine/test/api/visibility.test.ts`; command: `pnpm -r typecheck` on a fixture with a missing class fails |
| 1.6 | A piece's planner that returns an engine event the state table refuses gets its whole command refused, and nothing is written | Test id: `packages/engine/test/pieces/engine-events.test.ts` |
| 1.7 | A snapshot taken at sequence N, followed by the events after N, equals a full replay, for the owner and for an agent whose readable set does not change; with publication held open between a commit and the views' update, a snapshot in that gap and on either side of it misses and repeats nothing; the sequence comes from the views value; a piece's `snapshotFor` can leave its section out for one caller and include it for another | Test id: `packages/engine/test/api/snapshot.test.ts` |
| 1.8 | A piece's migrations create only `<namespace>_*` tables; a migration that names another table stops start-up | Test id: `packages/engine/test/log/piece-migrations.test.ts` |
| 1.9 | A piece's reactor resumes after the service is killed between reading an event and writing its reaction, and writes the reaction exactly once; its position is the highest source sequence on its own events and refusals | Test id: `packages/engine/test/pieces/reactors.test.ts` |
| 1.10 | A paged read of one agent's events returns them in order from a cursor, at most the page size and the byte budget, always at least one event, with the next cursor; an owner's pages equal the rebuilt `threads` view, including a queued delivery across a page boundary; an agent's read still hides an envelope with no `agentId`; old rows are filled by the migration; `client.AlertRaised` joins no thread | Test id: `packages/engine/test/log/agent-read.test.ts`; `packages/engine/test/views/apply.test.ts` (new case) |
| 1.11 | A device's command is recorded with `caller: owner` and `device: <id>`; the owner terminal's has no `device`; a device's receipts are in the owner's scope; a read's marks carry `device`; a device's `resume` carries it on the reload's later writes, on both success and a failed reload, and on catch-up | Test id: `packages/engine/test/commands/device-field.test.ts` |
| 1.12 | The service caller: every engine command, called as a listed service, is allowed or refused exactly as the contract's list and the service's own entry say; a service's `subscribe` runs through the read table; a service's `resume` records the service on `reload`'s later writes; `answer` is refused for every service; a standing rule's answer written in the permission path has `PermissionAnswered.answeredBy` `service { service, rule }` | Test id: `packages/engine/test/commands/service-caller.test.ts` |
| 1.13 | No credential format for a service exists: the socket refuses any bearer that is not an owner, device or agent credential, and a service name that is not on the list is refused in process | Test id: `packages/engine/test/api/auth.test.ts` (new case); `packages/engine/test/commands/service-no-wire.test.ts` |
| 1.14 | Every sender but the owner is wrapped as data: an agent as today with its wording unchanged, a service and a piece newly with fixed wording that names them; a leading `/` is escaped; the owner's text is rendered as today | Test id: `packages/engine/test/routing/text-is-data.test.ts` (new cases); `packages/engine/test/routing/sender-wrapping.test.ts` |
| 1.15 | A piece's delivery source: a queued or sent piece-sourced delivery whose target stops or crashes is withdrawn or returned as the piece's source rule says; a returned delivery takes no engine action beyond `DeliveryReturned`; the permission, question and wait sources behave as before | Test id: `packages/engine/test/routing/piece-source.test.ts` |
| 1.16 | The settled test, `holds`, `reasonOf` and the any and all rule live only in `packages/contracts`, and `routing/waits.ts` imports them; a hold-unsettled entry keeps a wait open while it holds and lets it close when it ends | Command: `pnpm -r typecheck` exits 0; test ids: `packages/contracts/test/settled.test.ts`, `packages/engine/test/routing/hold-unsettled.test.ts` |
| 1.17 | A piece may write `DeliveryWithdrawn` only for a delivery whose source is its own namespace and only while it is still queued; withdrawing a sent, accepted, engine-queued or other piece's delivery refuses the whole command | Test id: `packages/engine/test/routing/piece-withdrawal.test.ts` |
| 1.18 | The piece delivery helper takes only a body and the piece's own namespace; its delivery is always wrapped with a fresh marker and its leading `/` escaped; no path lets a piece send a raw prompt | Test id: `packages/engine/test/routing/piece-delivery-text.test.ts` |
| 1.19 | A piece's delivery to a target outside the caller's tree is queued only when the piece's reach check allows it; its sender is the piece, never the owner, and a header built from fixed words and the authenticated caller id names each item's author, even in a merged wake with no caller; the same target stays refused for `stop`, `answer`, `compact`, `resume` and `prompt` from that caller | Test id: `packages/engine/test/routing/piece-reach.test.ts` |
| 1.20 | The reach check sees the views of the same transaction, projected with the command's own batch: a target that leaves the channel in an earlier event of the same batch is refused; a delivery request becomes an event after the planner's own events, so its check sees them | Test id: `packages/engine/test/routing/piece-reach.test.ts` |
| 1.21 | A request-held entry ends a blocking wait with "request held" at open and after a batch | Test id: `packages/engine/test/routing/request-held.test.ts` |
| 1.22 | Unit 1's entries are the refusing ones: a piece-sourced delivery is refused at queue time, every hold-unsettled and request-held entry is false, and every snapshot section is absent; a table without an entry for some namespace does not compile | Test id: `packages/engine/test/pieces/refusing-defaults.test.ts`; command: `pnpm -r typecheck` on a fixture with a missing entry fails |
| 1.23 | The dispatcher re-runs the reach check in the send transaction: a target that left the channel after its delivery was queued gets `DeliveryWithdrawn` and is never sent; deliveries without a piece source are dispatched as today | Test id: `packages/engine/test/routing/piece-reach-at-send.test.ts`; `packages/engine/test/routing/deliveries.test.ts` |
| 1.24 | The reach check runs on every piece-sourced delivery, including one to the caller's own child and one with no caller, and can refuse either | Test id: `packages/engine/test/routing/piece-reach-every.test.ts` |
| 1.25 | The reach check receives the delivery id and piece source; at queue time it sees the command's own earlier events; after a send-time withdrawal the target's next queued delivery is sent in the same pass | Test id: `packages/engine/test/routing/piece-reach-inputs.test.ts` |
| 1.26 | A fixture planner's reply comes from its committed batch through `Plan.reply`; the first reply and a resent reply are equal, with one logical change written; engine commands keep their replies | Test id: `packages/engine/test/commands/transaction-receipts.test.ts` (new cases); `packages/engine/test/log/receipts.test.ts` |
| 1.27 | A read with marks: a lost reply, then a loss of access, then a resend of the same request id is refused; its marks are written with no receipt; the receipts table holds no page text | Test id: `packages/engine/test/api/read-marks.test.ts` |
| 1.28 | The read rule: for an orchestrator, a lead and a worker, the orchestrator reads the worker only while the lead is unavailable (any state but idle or working), and the read ends when the lead recovers, live and on catch-up; the lead keeps its read of the worker; management stays `holderAbove` | Test id: `packages/engine/test/api/subscribe-visibility.test.ts` (7.3 changed, new three-generation cases); `packages/engine/test/api/visibility.test.ts` |
| 1.29 | Every piece event has `keep` in all seven states in the lifecycle table, the table stays exhaustive with no fallback, and the existing state-machine test passes unchanged | Test id: `packages/contracts/test/state-machine.test.ts`; command: `pnpm -r typecheck` |
| 1.30 | The full caller (with a service's rule) and the device survive the log: live, catch-up, rebuilt and paged-read envelopes are equal for every caller kind, including after a restart; old rows decode with no rule and no device | Test id: `packages/engine/test/log/caller-durable.test.ts`; `log/append.test.ts`, `log/subscribe-gapless.test.ts`, `views/rebuild.test.ts` (new cases) |
| 1.31 | A piece delivery returned through the real failed-send path, before and after acceptance, writes `DeliveryReturned` with the piece as sender and builds no notice to an agent sender | Test id: `packages/engine/test/routing/deliveries.test.ts` (new cases); `packages/contracts/test/events-roundtrip.test.ts` |
| 1.32 | The piece batch path: a fixture planner, read and reactor whose batch breaks any of its five checks commits none of its events, deliveries, marks or side rows, and writes exactly the contract's refusal record; a raw `DeliveryQueued` from a piece is refused; check 2 uses the snapshot projected with the batch; a reactor builds its batch inside the transaction and writes as `piece { namespace }`; marks use the calling caller; no piece folder imports the log writer | Test id: `packages/engine/test/pieces/piece-batch.test.ts`; boundary test `packages/engine/test/pieces/piece-imports.test.ts` |
| 1.33 | Every engine `afterCommit` still runs: `start` starts the runner and records its session, `stop` stops it, `resume` reloads and dispatches, `answer` delivers its option, each in order and in its send lane; a replayed request runs none of them; a piece's planner has no such field | Test id: `packages/engine/test/commands/lifecycle.test.ts` and `packages/engine/test/routing/permissions.test.ts` (unchanged expectations); `packages/engine/test/commands/transaction-receipts.test.ts` (replay case); command: `pnpm -r typecheck` on a fixture planner that sets it fails |
| 1.34 | A web caller's path: only `webCaller`'s constructor builds the `open-web` credential; the socket's `authenticate` can never produce it; a command through it is recorded with `caller: owner` and `device: open-web`; `open-web` is refused by `DeviceAdded`'s schema and by the `sideRows.devices` insert, with no pairing plan needed, and the envelope's `device` field still accepts it; `preemptStart` uses the same resolver: an open-web stop cancels a start whose setup never returns, promptly, with one `AgentStopped`, no later `SessionOpened` and no later spawn; an invalid device credential cannot preempt, and a refused stop keeps the start's cleanup rules | Test id: `packages/engine/test/client/web-caller-path.test.ts`; boundary test in the same file; `packages/engine/test/api/auth.test.ts` (new case); `packages/engine/test/commands/start-setup.test.ts` (new case; l.55 and l.83 keep their expectations) |
| 1.35 | The access check runs before the receipt lookup: a device presenting an owner-only command's request id and body is refused, gets no stored reply, and leaves no receipt the owner could replay; an agent's refusal is as today | Test id: `packages/engine/test/commands/authorization.test.ts` (new cases) |
| 1.36 | A reactor waits for recovery: with recovery held open, a fixture reactor writes nothing, and the batch path refuses it; afterwards it runs | Test id: `packages/engine/test/pieces/reactor-start.test.ts` |
| 1.37 | A reactor's first start on a log with history writes one first-start event at the log's head, replays nothing, and later resumes from its recorded position | Test id: `packages/engine/test/pieces/reactor-start.test.ts` |
| 1.38 | A reactor's failures: a refused batch writes `CommandRefused` with its `sourceSequence`, the reactor counts it as handled, and no event between is skipped; on `LogWriteFailed` it stops without advancing; a defect is logged with no event text, and the reactor restarts from its position | Test id: `packages/engine/test/pieces/reactor-failures.test.ts` |
| 1.39 | Secret collection runs only at start-up and keeps a piece's slot: a token used by no account survives a restart; an unselected or cleared value is removed; removing an account leaves the token; abandoned and replaced account secrets are still removed. With `accounts set-secret` held after its store and before its commit, clearing the token leaves the account's secret resolvable; clearing and at once setting a token leaves the new value; `removeCarrierValue` can name only a carrier value; an account's environment value under `secret:client.` is refused, the runner refuses to resolve one, and collection does not keep one | Test id: `packages/engine/test/recovery/restart.test.ts` (6.7 R22, extended); `packages/engine/test/accounts/carrier-value-removal.test.ts` (real writer and file-backed store, with barriers) |
| 1.40 | A secret-setting command from the `secretCommands` table keeps its value out of its receipt, its events and its body hash, as `accounts set-secret` does | Test id: `packages/engine/test/commands/secret-commands.test.ts` |
| 1.41 | Pending the owner's question 6 (row 95): for a device caller, `answer` refuses a persistent, always-allow or unknown-kind option, and on a settings-write request accepts only a non-persistent reject; the request stays open; the owner's terminal and agents are unchanged; the refusal's reason, "option not allowed from the web", reaches the client | Test id: `packages/engine/test/routing/permissions.test.ts` (new cases) |
| 1.42 | A permission request carries its action: for each tool kind, `PermissionRequested` holds `toolKind` and the redacted `toolInput`, at most 8 KiB encoded, with `inputRedacted` and `inputTruncated` true when they apply; the fields are absent when the adapter omits them; `toolInput` is not in the snapshot; old logs rebuild unchanged; the holder's delivery holds the fields inside the envelope, with the engine's lines first and the title last, one-line JSON that a title cannot forge a line above, and the fixed words when the input is absent, redacted or cut; a moved request delivers the same text, the row's `action` part is dropped when the row closes, and a planted input appears in no snapshot or other client read; a secret across the 8 KiB boundary does not survive the cut; `locations` are bounded and redacted; a Codex-shaped request with `locations` and no input is recorded; the input goes through `cleanStructure` with its coverage check, and a secret in a field named `_tag` is redacted | Test id: `packages/engine/test/runner/permission-fields.test.ts`; the rebuild check; `routing/text-is-data.test.ts`, `routing/permissions.test.ts`, `routing/moving-requests.test.ts` (changed where they read the delivered text); `live-check/rendered-prompts.test.ts` (new lines); `packages/testing/src/fakeAgent.ts` gains the fields |
| 1.43 | A withdrawal that leaves its target in the reloaded state, with nothing queued or sent, writes `StateChanged idle` in the same batch before the wait checks, and a wait on it closes; it holds for a dispatcher's withdrawal and a reactor's; it holds for any batch with a `DeliveryWithdrawn`, including the engine's own, such as an answered question's delivery to a reloaded holder | Test id: `packages/engine/test/routing/withdraw-reloaded.test.ts` (real recovery events) |
| 1.44 | One piece's throw cannot stop the engine: a fixture piece throws from its reducer, its reach check, hold-unsettled, request-held, source rule, secret keep list and `snapshotFor`, and each gives contract section 1's fallback; the log holds no event text from the failure; commands and `stop` still run, an adapter's request is still recorded, a queue behind a throwing reach check goes on, a restart finishes, nothing is deleted by a throwing keep list, and the rebuild check passes after a throwing reducer; a boundary test finds no direct call into a table; `guardPiece` covers table functions only, and the roles' matcher and capacity-hold condition are the two named exceptions, tested by the roles plan | Test id: `packages/engine/test/pieces/throwing-piece.test.ts`; boundary test in the same file; the rebuild check |
| 1.45 | `stop` writes `PermissionCancelled` with the reason "agent stopped", and a withdrawal, for each open request the stopped agent asked; questions stay open; it moves what the agent held; after a resume no stale row remains, an owner's wait is not ended by one, and a parent's wait closes; `failure-4-no-answerer` keeps its expectations | Test id: `packages/engine/test/commands/stop-cancels-requests.test.ts`; `packages/engine/test/acceptance/failure-4-no-answerer.test.ts` (unchanged expectations) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a.0 | E2's move of the access check above the receipt lookup, with the device refusal's missing receipt | `CommandHandler.ts` (receipt lookup l.277-298, `planCommand` l.260, access check l.70, refusal append l.303) |
| 1a.1 | E1 and E10: `CommandsRpcGroup` as the merge point, `engineCommandNames`, the uniqueness test, and dotted names in the command-line registry | `packages/contracts/src/commands.ts` (`commandNames` l.10, `CommandsRpcGroup` l.44, `.merge` l.137); `packages/cli/src/commands/registry.ts:10`; `packages/contracts/src/namespaces.ts` (new) |
| 1a.2 | E2: the caller-kind access table, the check by credential kind, and the MCP tool list | `commands.ts` (`ownerOnlyCommands` l.16, `commandAccess` l.20); `packages/engine/src/commands/CommandHandler.ts` (l.45, l.70, l.246); `packages/mcp/src/tools.ts:7` |
| 1a.3 | E3 and E4: the planner table with `Plan.reply`, every engine `afterCommit` kept, and the read table with reads with marks and the debug gate | `CommandHandler.ts` (`supported` l.54, `planCommand` l.67, `replyFor` l.97, receipt append l.308); `packages/engine/src/commands/internal.ts:43` (`Plan`); hooks `commands/start.ts:59-103`, `commands/stop.ts:20`, `commands/resume.ts:45-56`, `routing/permissions.ts:49-54`; `packages/engine/src/api/server.ts` (l.38, l.85, l.153-168); targets `commands/planners.ts`, `api/reads.ts` |
| 1a.4 | E5 and E6: the event union, `threadAgent` limited to engine tags, the lifecycle table's piece rows, piece view fields, piece reactors with their start-up and failure rules, and the rebuild check | `packages/contracts/src/events.ts:88`; `packages/contracts/src/stateMachine.ts:79` (`eventTable`); `packages/engine/src/views/apply.ts` (`emptyViews` l.114, `apply` l.338); `packages/engine/src/service.ts`; `packages/engine/test/support/rebuildCheck.ts`; `views/apply.ts:122-123`; `recovery.whenReady` as in `accounts/available.ts:84`; reactor pattern T3 `apps/server/src/orchestration-v2/DelegatedTaskQuestionReactor.ts` (engine plan 5c.1) |
| 1a.5 | E7: piece migrations and side rows | `packages/engine/src/log/migrations.ts`; `packages/engine/src/log/EventLog.ts` (`sideRows`, l.200-205) |
| 1a.6 | E8: the visibility function with the read rule (lead ruling L29), and the class table | `server.ts:155-159` (inline `Stream.filterEffect`); targets `packages/engine/src/api/visibility.ts`, `packages/contracts/src/visibility.ts` |
| 1a.7 | E9 and E21: the snapshot from one views value with its section table and wait-state section, and the paged read of one agent's events with the `thread_agent_id` column and its migration | `packages/engine/src/views/Views.ts:41-44`; `views/apply.ts:342`; `packages/engine/src/log/subscribe.ts:58` (`subscribe`, `PAGE_SIZE`); `EventLog.ts:176`; targets `packages/engine/src/api/snapshot.ts`, `packages/engine/src/log/agentRead.ts` |
| 1a.8 | E22, and the service builder taking the lists as arguments with the engine's own as the default, so tests run a fixture piece | `packages/engine/src/routing/holders.ts` (`holderAbove`); `packages/engine/src/service.ts`; target `packages/engine/test/support/fixturePiece.ts` |
| 1a.9 | E30: `guardPiece` and its sink, first, so that each later table's edit calls it | Target `packages/engine/src/pieces/guardPiece.ts`; `views/apply.ts:336-338`; precedent: the roles plan's matcher, its criterion 7.2 |
| 1b.1 | E11 and E12's durable form: `Caller` with `service` and `piece`, the open web credential shape and reserved id, the receipts key, the `caller_rule` and `device_id` columns, `append` taking the full caller, and one row decoder | `events.ts:8` (`Actor`), l.184 (`EventEnvelope`); `EventLog.ts:117` (`callerKey`), l.146 (`commit`), l.183; `log/subscribe.ts:36-38` (`decodeRow`); `views/rebuild.ts:26`; `migrations.ts:15-16` |
| 1b.2 | E12: the optional `device` field, `Input.callerKind`, and the reserved id's checks | `events.ts:184`; `CommandHandler.ts:246`; `EventLog.ts:203-206`; `commands/internal.ts:38-42` |
| 1b.3 | E13 and E14: the service list, the in-process path with its `subscribe`, `reload`'s caller, the service rights, and `PermissionAnswered.answeredBy` | Target `packages/engine/src/commands/services.ts`; `server.ts:87` (`authenticate`); `commands/resume.ts:47`; `recovery/reload.ts:105`; `events.ts:132`; `views/apply.ts:45`; `routing/permissions.ts:47` |
| 1b.4 | E15: `Sender` on all three sender fields, wrapping every sender but the owner with wording by sender, and the piece delivery helper | `events.ts:23`, l.112, l.162; `packages/engine/src/routing/envelope.ts:14-23`; `routing/deliveries.ts:46-52`; target `routing/pieceDelivery.ts` |
| 1b.5 | E16 and E17: the piece source, its rule table, and own-namespace withdrawal | `events.ts:30` (`Delivery.source`); `routing/deliveries.ts:62`; `CommandHandler.ts` (batch checks) |
| 1b.6 | E18: the reach check table, at queue time with the projected batch, and at send time with withdraw-and-continue | Target `packages/engine/src/routing/reach.ts`; `routing/waits.ts:110` (`withWaitChecks`, the projection pattern); `routing/deliveries.ts` (dispatcher) |
| 1b.7 | E19 and E20: the settled test and member rule moved to contracts, the hold-unsettled and request-held tables | `routing/waits.ts` (`holds` l.33, `settled` l.39, `reasonOf` l.49, blocking check l.83, closing rule l.92); target `packages/contracts/src/settled.ts` |
| 1b.8 | E23: the piece batch path, delivery requests, the new per-event state check, the `piece` log caller, the reactor's batch built in the transaction, the refusal table, and the import boundary test | Target `packages/engine/src/commands/pieceBatch.ts`; `routing/waits.ts:110` (`withWaitChecks`); `packages/contracts/src/stateMachine.ts:122` (`eventEffect`); `events.ts:180` (`CommandRefused`); pattern `packages/engine/src/accounts/available.ts:59-66` (a follower's `log.transact`, which a piece must not use directly) |
| 1b.9 | E27: `collectSecrets` moved and kept at start-up only, each piece's keep entry, `removeCarrierValue`, the reserved prefix, and the `secretCommands` table | `recovery/restart.ts:139-147`; `accounts/SecretStore.ts:51`; `CommandHandler.ts` (the two `accounts set-secret` cases); `commands/accounts.ts:68-82`; target `packages/engine/src/accounts/collectSecrets.ts` |
| 1b.10 | E28, pending the owner: the answer's refusal for a device caller and its named reason | `commands/internal.ts:38-42`; `CommandHandler.ts:244-246`; `routing/permissions.ts:35-44`; `identity/ceiling.ts:387-394`; `packages/contracts/src/permission.ts:12` |
| 1b.11 | E29: the permission request's tool fields, for every tool kind | `runner/AcpRunner.ts:569-574`, `cleanStructure` l.173; `runner/Runner.ts:58`; `events.ts:121`; `views/apply.ts:216` |
| 1b.12 | E29's delivery: the holder's text, the fixed words, the row's `action` part for a move, and the fake agent's new fields | `routing/holders.ts` (`routedDelivery` l.45-55, `move` l.88); `routing/permissions.ts:22-30`; `views/apply.ts:216-230`; `packages/testing/src/fakeAgent.ts:293-294` |
| 1b.13 | E31: `stop` cancels the asker's open requests. E17's reloaded-state rule moves into `withWaitChecks`' first step | `commands/stop.ts:10-18`; `recovery/crash.ts:58-63`; `routing/waits.ts:110` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| One piece's mistake stops every command, or poisons the log | High | One guard with stated fallbacks (criterion 1.44, row 161). |
| An edit changes engine behaviour that contract section 6 does not name | High | Criterion 1.1 on every commit, with each changed existing test matched to its edit; attack pass on 1a and 1b. |
| A piece gains rights the engine would refuse | High | Criteria 1.4, 1.5, 1.6, 1.12; the engine checks every engine event a piece returns; attack pass on 1a and 1b. |
| A piece's or a service's text reaches an agent unwrapped | High | Criteria 1.14 and 1.18; the renderer wraps every sender but the owner. |
| A service becomes a way in from outside | High | No service credential exists (criterion 1.13); services are listed in code and reached in process only. |
| A piece's delivery reaches an agent before its plan writes its reach check | High | Unit 1's refusing entries (criterion 1.22). |
| A piece's reactor writes around the engine's checks | High | The piece batch path is the only write path, with an import boundary test (criterion 1.32). |
| The edit that moves planners drops an engine action | High | Criterion 1.33 runs the lifecycle and permission tests with unchanged expectations. |
| A client's snapshot silently misses an event | High | One views value and its own sequence, with a held-publication test (criterion 1.7). |
| A device gets a stored reply by replaying a request id | Low | Criterion 1.35. |
| A read page, or other record text, is kept in the receipts table | High | Reads are never deduplicated and reads with marks write no receipt (criterion 1.27). |
| An audit identity is lost on a read of the log | Medium | One row decoder and the equality test (criterion 1.30). |
| A piece's view drifts from the log | Medium | Pieces' views join the rebuild check (criterion 1.2). |
| The unit is too big for one build | Medium | Split into 1a and 1b, each with its own criteria. |

**Verify:** criteria 1.1-1.45; environment QA: none.

**Rollout detail:** rollout step 3. Unit 1a merges before 1b starts. The
board and roles plans start their engine-facing units only after 1b merges.

**WS-2: One definition of the whole API for every client**

Purpose: put the client API's own commands and events into the engine's
lists, make clashes and unknown events safe for every client, and give the
client library its browser entry. Contract edits E24, E25, E26 and E32. Unit 2. It defines the group's schemas and
installs its events. Each later unit installs the commands it handles (row 172).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | With the `client` group defined and its events added, every command name and every event tag, across `CommandsRpcGroup`, the client group and `Event`, is unique | Test id: `packages/contracts/test/unique.test.ts` (from unit 1a) |
| 2.2 | Every `client` command and event tag starts with `client.`; no engine name contains a dot except `debug.compare-views` | Test id: `packages/contracts/test/unique.test.ts` |
| 2.3 | Every `client` command's payload, reply and error carries a non-empty `requestId` | Test id: `packages/contracts/test/client/request-id.test.ts` |
| 2.4 | Real encoded frames from a newer server reach an older client: an event tag it does not know becomes an unknown event, its cursor moves past it, the next known event and a reconnect both work, and a known tag that fails to decode is an error; the engine's log validation stays strict | Test id: `packages/client/test/unknown-event.test.ts` (real RPC frames, not a decoded object) |
| 2.5 | Every command in `CommandsRpcGroup` is a `shephrd` subcommand, and the MCP server offers exactly the commands whose access includes `agent`, less every stream and every secret-setting command, and that list is pinned as an exact list in `commands.test.ts`; `client.alerts.dismiss` is not a tool; each unit that installs commands updates the pin, and the client group's entries are `client.snapshot`, `client.roster`, `client.thread` and `client.event` | Test id: `packages/cli/test/parity.test.ts` and `command-inventory.test.ts` (updated per E2 and E10) |
| 2.6 | Each piece's stated largest event and page, as real encoded RPC messages with chunk wrappers and escaping, fit the page budget in contract section 5; a stated event over 256 KiB reaches a filtered stream as a marker | Test id: `packages/contracts/test/size-limits.test.ts` |
| 2.7 | Through the public client connection, against a fixture server, `subscribe` and `client.subscribe` each call their own RPC; a filter survives a dropped connection; the cursor advances on an event, a checkpoint and an oversized marker; a client that subscribes opens two connections, carries every other command on the read connection and reconnects each on its own, and a client that never subscribes opens one, on the Unix socket and in the browser | Test id: `packages/client/test/stream-dispatch.test.ts`; `packages/client/test/two-connections.test.ts`; `packages/client/test/concurrent-reconnect.test.ts` (unary expectations unchanged) |
| 2.8 | `core.ts` and `browser.ts` reach no `node:` import; the root entry still gives the command-line tool, the MCP server and the pane viewer today's behaviour | Test id: `packages/client/test/entry-boundaries.test.ts`; existing client tests with unchanged expectations |
| 2.9 | Every `client` command's definition has the access in contract section 5, and every `client` event is `owner-only`; through the visibility function, an agent caller never sees an alert | Test id: `packages/contracts/test/client/access-table.test.ts`; `packages/engine/test/client/client-visibility.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2.1 | `packages/contracts/src/client/`: `ClientRpcGroup`'s definitions (prefixed `client.`), in parts by the unit that installs them, the client events, their access and visibility entries, the alert types | Target `packages/contracts/src/client/`; pattern `packages/contracts/src/commands.ts`, `events.ts` |
| 2.2 | Merge the client events into `Event`. No command joins `CommandsRpcGroup` here | `commands.ts` (`.merge`, l.137); `events.ts:88` |
| 2.3 | E24 and E25: stream dispatch by tag, and the tolerant wire group at the RPC boundary | `packages/client/src/index.ts` (`RpcClient.make` l.97, `subscribe` helper l.190-212, `CommandsRpcGroup.requests` l.218); Effect `rpc/RpcClient.ts:733-755`, l.811-818; target `packages/contracts/src/wire.ts` |
| 2.5 | E26: the client library's three modules, with the root re-exporting Node's | `packages/client/src/index.ts` (l.1-3, l.19-22, l.32, l.120-138); targets `packages/client/src/core.ts`, `node.ts`, `browser.ts` |
| 2.4 | The size-limit test over each piece's stated maxima | Target `packages/contracts/test/size-limits.test.ts` |
| 2.6 | E32: two connections from a client that subscribes | `packages/client/src/index.ts` (`connect` l.142-174, `subscribe` helper l.190-212); Effect `rpc/RpcClient.ts:350`, l.577-581 |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A later piece's command silently replaces another | Medium | Criterion 2.1, run in `pnpm check`. |
| An older page breaks on a newer event | Medium | Criterion 2.4. |
| An owner-only piece command is offered to agents as a tool | High | Criterion 2.5. |
| An alert or a setting leaks to an agent | High | Criterion 2.9. |
| A browser build pulls in Node code | Medium | Criterion 2.8, and unit 7a's production build. |
| A unit merges commands with no handlers, so the exact handler check fails or invites a stub | Medium | Unit 2 installs no command, and each later unit installs its own (row 172). |

**Verify:** criteria 2.1-2.9; environment QA: none.

**Rollout detail:** rollout step 4.

**WS-3: Reads that suit a phone**

Purpose: let a client start from a snapshot, follow only what it needs,
list agents, page a thread, and wait, without replaying the whole log.
Contract section 3. Unit 3.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | `client.snapshot` then `subscribe` from its sequence gives the same views as a full replay, for the owner, a device and an agent; all of it comes from one views value and that value's sequence; the wait-state section holds open deliveries and non-blocking waits, and each agent's `reloadable` flag, for the owner, a device and a service, and an agent's snapshot leaves it out; a request's and a question's identity row is present for all of them, and the newest 256 have a display part of at most 4 KiB, filled to its limits in the test; the account section holds names and flags, and a plain value under a name that does not look secret appears in no snapshot; an agent entry's name and team are cut; an agent's snapshot holds identity rows and no display part, and no account, device, alert or wait-state section; a display part is measured as encoded, with a long option id, a long kind, escaped and multibyte text: it never passes 4 KiB, an option id is never cut, an unknown kind shows as "unknown", and an option or part left out is counted; a snapshot on the large fixture team stays under 4 MiB; the size test sets `capacityHeld` on every agent once roles unit 11b adds it, and an agent's snapshot leaves it out | Test id: `packages/engine/test/client/snapshot.test.ts`; `packages/engine/test/client/snapshot-size.test.ts` |
| 3.2 | `client.roster` returns the contract's fields, filters by group, role and parent, shows an agent itself and its children, shows its grandchildren only while their parent is unavailable and it is their effective holder, and names its parent | Test id: `packages/engine/test/client/roster.test.ts` |
| 3.3 | `client.thread` pages one agent's thread, at most 500 events and 900 KiB a page, always at least one event, with `next` absent on the last page, under the visibility rule; a 2 MiB event arrives whole in its own page; to an agent caller, a page is inside the data envelope with a fresh marker and an escaped leading slash; the reply to an agent is `{ requestId, data }`, and the MCP tool and the command line return `data` unchanged | Test id: `packages/engine/test/client/thread.test.ts` |
| 3.4 | `client.subscribe` filters by agent, group and event kind; a group filter uses the current views, live and on catch-up; an agent filter includes a queued delivery by its target; a checkpoint carrying the last scanned sequence arrives at least every 30 seconds while events are skipped (test clock), and a reconnect from it skips nothing unscanned; an event over 256 KiB arrives as a `client.Oversized` marker, and the cursor moves past it; each row of the contract's filter table holds, live and on catch-up; an empty list is refused; a phone that filters by agent still receives an account's alert | Test id: `packages/engine/test/client/filtered-subscribe.test.ts` |
| 3.5 | `waitForAgents` with "any" and "all" gives the result in the contract's member table for every row, against the engine's own function, applying every piece's hold-unsettled entry; a delivery, a non-blocking wait and a roles capacity hold opened before the snapshot still count; a member that goes back to working stops counting; the client's fold of the wait inputs, replayed against the engine's `apply`, is equal at every sequence; the helper's completion, not only its fold, agrees with the engine at a batch's end (criterion 3.10) | Test id: `packages/client/test/wait-for-agents.test.ts`; `packages/contracts/test/wait-input-fold.test.ts` (property test) |
| 3.6 | `shephrd client wait --block` exits with engine row 26's codes: exit 1 with a stopped or crashed member, exit 2 with a paused member, and exit 2 at once when a waited member's request, question or piece condition is held by the owner, with no hang; the engine's `shephrd wait` keeps its behaviour and its tests; each row of the contract's held-rule table holds; opened while a member is working, a board post to the owner written afterwards ends the wait with exit 2 while the member never becomes idle; a descendant's owner-held request does not end it; each exit passes the gate (criterion 3.10) | Test id: `packages/cli/test/client-wait.test.ts`; `packages/cli/test/wait-exit-codes.test.ts`; `packages/client/test/owner-held-event.test.ts` |
| 3.7 | `shephrd thread export <agent> --out <file>` writes the caller's file from paged reads, with mode 0600; the service writes no file | Test id: `packages/cli/test/thread-export.test.ts` |
| 3.8 | `client.event` returns one event whole by sequence, under the visibility rule, including an event in no thread; through the client library, a marker over `AgentStarted`, `PermissionRequested`, `QuestionAsked`, `DeliveryQueued`, `HarnessChanged` or `AccountChanged` is read and applied before anything later, and the cursor passes it only then; a failed read reconnects from before the marker; a marker over a content-only tag moves the cursor at once; a tag not on the list is treated as state-bearing; an agent caller recovers a visible child's start and request over `client.event`, under the read rule and in the data envelope, and then later events apply in order; a sibling's event, an event with no `agentId` and an owner-only piece event stay unavailable, with one refusal for a hidden and a missing sequence; a read rule that changes mid-recovery ends with no loop; the reply carries the event with its envelope, including `occurredAt` and the sequence, for the owner, a device, a service's in-process path, and inside an agent's `data` | Test id: `packages/engine/test/client/event-read.test.ts`; `packages/client/test/oversized-state.test.ts` (real RPC frames) |
| 3.9 | A read never stalls behind its own paused stream: with a state event over 256 KiB, a stream backlog beyond the client's queue and a delayed reply, in real encoded frames, the event is recovered and applied before later state, and the cursor advances only then; the same holds for the wait helper's nested read of a piece's lists; a recovery that outlasts the stream connection's five seconds costs a reconnect and not the read, with no repeated loop; a cancelled recovery leaves the cursor before the marker; a live chunk closes at 256 KiB, with at least one event | Test id: `packages/client/test/oversized-state.test.ts` (new cases, real RPC frames); `packages/engine/test/client/subscribe-chunks.test.ts` |
| 3.10 | The gate: real encoded frames split one committed batch, live and on a catch-up page, at each of these places, and the helper never ends the wait on the prefix: a reload's `SessionOpened`, `DeliveryQueued` and `StateChanged working` (no exit 0 while mid-turn); `WaitSatisfied` then `DeliveryQueued` (no exit 0 on a waiter about to work); a standing rule's `PermissionRequested` then `PermissionAnswered` (no exit 2 with nothing to answer); and, with a lead as holder and no board or roles sections, `QuestionAnswered` then `DeliveryQueued` (no exit 0), for "any" and "all". With no piece, the read is `client.sequence`, and with a piece, its lists. A read below S is repeated, a read above S is applied up to L and no further, and a failed read ends nothing. `client.sequence` returns the views value's own sequence, and an agent is refused it | Test id: `packages/client/test/wait-gate.test.ts` (real RPC frames); `packages/engine/test/client/sequence-read.test.ts`; `packages/engine/test/routing/waits.test.ts` and `packages/engine/test/acceptance/capability-05-wait.test.ts` (unchanged expectations) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3.1 | Install the read commands into `CommandsRpcGroup`. `client.snapshot` with its rows and encoded budget, `client.roster`, `client.thread`, `client.event` with the agent reply, `client.sequence` and `client.subscribe` handlers with the chunk limit, and the content-only tag list | Target `packages/engine/src/client/reads/`; the engine's snapshot and agent read (1a.7) |
| 3.2 | `waitForAgents` helper, with `ownerHeld` and the one gate | Target `packages/client/src/waitForAgents.ts`; member rule from `packages/contracts` (1b.7) |
| 3.3 | `shephrd client wait`, `shephrd thread export` | Target `packages/cli/src/commands/`; pattern `packages/cli/src/commands/wait.ts:reportWait` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A snapshot and the stream disagree, so the page shows a wrong state | High | Criterion 3.1. |
| A roster or thread shows an agent more than `subscribe` would | High | Criteria 3.2, 3.3 use the same visibility function. |
| A filtered stream never moves its cursor, so a reconnect re-scans | Low | Criterion 3.4. |
| A large event closes a phone's stream on every reconnect | Medium | The oversized marker (criterion 3.4). |
| A marker costs the page an open request or an agent | Medium | Automatic recovery with `client.event` (criteria 3.8, 7.14). |
| An agent reads injected text through a thread page | Medium | The data envelope for an agent caller (criterion 3.3). |
| The owner's wait hangs on a crashed member or on the owner's own answer | Medium | Criteria 3.5, 3.6. |

**Verify:** criteria 3.1-3.10, and unit 3's attack pass; environment QA: none.

**Rollout detail:** rollout step 5.

**WS-4: Pairing a phone, deferred to a later plan**

The owner deferred pairing and authentication on 2026-11-03 (rows 80, 81,
86). This plan builds no pairing unit. It builds the slot that pairing
fills later, and each part of the slot is a criterion of another unit:

- One function, `webCaller`, decides the caller of every web server
  request (criterion 5.2).
- The web page sends its credential header from one place in its client,
  empty for now (criterion 7.1).
- The engine's per-device credentials in
  `packages/engine/src/identity/devices.ts` stay as they are, as the
  credential that pairing will issue.
- The pairing-code command's name, `client.pair.create`, is on the
  computer-only list from the start (criterion 5.5).

Rows 47 (the cookie), 48 (the code) and 49 (pairing completion) are kept
for the later plan, deferred. That plan also adds the devices page and
device revocation.

**WS-5: A web server on the machine itself**

Purpose: serve the web page and the API on the loopback address, open for
now, with the checks a browser needs and a guard against agents' processes.
SECURITY.md rule 1, and rule 2 as the owner suspended it. Rows 36, 76, 80,
81, 82, 84, 90, 92, 113, 119. Unit 5.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | The web server binds `127.0.0.1` on the configured port, 8787 by default; no setting can name another address; `enabled` off closes it at once | Test id: `packages/engine/test/client/web-bind.test.ts` |
| 5.2 | Every request's caller comes from `webCaller`, and from nowhere else: while the server is open it is access kind `device`, actor owner, and envelope `device: open-web`; a command over the web server is recorded with `device: open-web`; no route builds a caller of its own | Test id: `packages/engine/test/client/web-caller.test.ts`; boundary test `packages/engine/test/client/web-caller-imports.test.ts` |
| 5.3 | A request that presents the owner credential or an agent token, as a bearer or a cookie, gets HTTP 401 before any RPC message | Test id: `packages/engine/test/client/web-host-credentials.test.ts` |
| 5.4 | Only Shephrd's own page may drive the web server (row 90): a request whose `Host` does not name `127.0.0.1` at the port gets HTTP 403, and a `Host` or `Origin` naming `localhost` or `[::1]` is refused; Shephrd prints and links only `http://127.0.0.1:<port>`; a WebSocket upgrade, or any request but a `GET` or `HEAD` of a static file, whose `Origin` is missing or does not name the page gets HTTP 403; a page served from another origin in a real browser cannot open the WebSocket; the public address is allowed only in proxy mode (criterion 10.1) | Test id: `packages/engine/test/client/web-origin.test.ts`; `packages/web/e2e/cross-origin.spec.ts` (Playwright, a second page on another port) |
| 5.5 | The computer-only commands are refused over the web server by name, whatever the caller: `client.pair.create`, `client.web.settings.set` and `roles.rules.add`; `debug.compare-views` is refused by name too; a fixture command added to the list is refused; each that exists still works over the Unix socket with the owner credential | Test id: `packages/engine/test/client/web-host-only.test.ts` |
| 5.6 | The guard: a connection from a process in a recorded agent adapter's process group, or descended from an adapter, is refused at upgrade; a socket held by both an agent's process and another is refused; a same-user process that is not an agent passes; a peer owned by another user id is refused, unless proxy mode is on and it matches the proxy user id; a same-user peer whose process cannot be found is refused | Test id: `packages/engine/test/client/web-guard.test.ts` (a real child of a fake adapter over real loopback, and a fixture `/proc` tree for the shared-socket, other-user and not-found cases) |
| 5.7 | The guard runs once per connection, never per message, after the `Host` and `Origin` checks, and reads nothing outside `/proc` | Test id: `packages/engine/test/client/web-guard.test.ts` (a counting fake of the lookup) |
| 5.8 | An inbound message over 1 MiB closes the connection; the limit does not apply to what the server sends | Test id: `packages/engine/test/client/web-size.test.ts` |
| 5.9 | A heartbeat is sent at the configured interval, 25 seconds by default | Test id: `packages/engine/test/client/web-heartbeat.test.ts` |
| 5.10 | Static files are served with `Content-Security-Policy: default-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` and no inline script; a request using `..`, an encoded path or a symbolic link gets nothing outside the page's build folder | Test id: `packages/engine/test/client/web-static.test.ts` |
| 5.11 | Connections are capped at 32 in total; a new connection at the cap closes the oldest; a refused connection does not count; a connection that misses two heartbeats closes; a client's stream connection and read connection each count, and each has its own heartbeat | Test id: `packages/engine/test/client/web-limits.test.ts` |
| 5.12 | A test piece's command works over the web server with no web server code of its own | Test id: `packages/engine/test/client/web-generic.test.ts` |
| 5.13 | The engine's Unix socket keeps its authentication: its existing tests pass with their expectations, and it still refuses a connection with no credential | Test id: `packages/engine/test/api/auth.test.ts` (one new case, per E12 and E13) |
| 5.14 | During recovery the web server answers HTTP 503 and serves no command or stream | Test id: `packages/engine/test/client/web-recovery.test.ts` |
| 5.15 | When its port cannot be bound, the engine keeps running and the Unix socket works; one `client.WebServerDown` is written, a `client.web-down` alert is raised, the bind is retried every 30 seconds (test clock), and on success `client.WebServerUp` clears the alert; held before recovery is ready, its first record is written after it; a port taken across restarts writes one `client.WebServerDown`; `enabled` off closes the outage and its alert | Test id: `packages/engine/test/client/web-bind-failure.test.ts` |
| 5.16 | `client.web.settings.set` validates the record as contract section 5 says: a `publicAddress` that is not `https` or not in canonical form is refused, and proxy mode on with no public address or no allowed networks is refused; any change closes every web connection, so a reconnect is judged under the new settings | Test id: `packages/engine/test/client/web-settings.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5.1 | The HTTP server: static files and the WebSocket RPC on one loopback port | Target `packages/engine/src/client/web/`; pattern `packages/engine/src/api/server.ts` (`listen`, l.52; `makeProtocolWithHttpEffectWebsocket`, l.128; `boundedProtocol`, l.130); Effect `http/HttpStaticServer.ts:layer` (l.242) |
| 5.2 | `webCaller`: the one caller function, the refusal of host credentials, and the guard | Target `packages/engine/src/client/web/webCaller.ts`; pattern `server.ts:authenticate` (l.87); the ancestry rule `packages/engine/src/api/ancestry.ts`; peer lookup target `packages/engine/src/client/web/peer.ts` (`/proc/net/tcp`, `/proc/net/tcp6`, `/proc/<pid>/fd`), taking the `/proc` root as an argument so tests use a fixture tree |
| 5.3 | The computer-only list, `Origin` and `Host` allow-lists, inbound size limit, heartbeat, connection cap, HTTP 503 during recovery and the failed-bind path | Target `packages/contracts/src/client/hostOnly.ts`; `packages/engine/src/client/web/guards.ts` |
| 5.4 | Install the web settings commands. `client.web.settings` and `client.web.settings.set`, the record in contract section 5, with `set` at access `owner` only | Target `packages/engine/src/client/settings.ts`; access table `packages/contracts/src/commands.ts` (`commandAccess`, l.20) |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An agent on the machine acts as the owner through the open web server | High | Accepted by the owner while the server is open (row 80, SECURITY.md rule 2). The guard refuses an agent's process (criterion 5.6), the three computer-only commands are refused (criterion 5.5), and SECURITY.md states that the guard is not a boundary. Attack pass. |
| Another local user or service gets the owner's control | High | Refused, unless it is the proxy's named user id (criterion 5.6, row 92). |
| Another website uses the page (cross-site WebSocket hijacking) | High | The `Origin` and `Host` checks (criterion 5.4); attack pass. |
| A route builds its own caller, so pairing later misses it | Medium | Criterion 5.2's boundary test. |
| The guard refuses the owner's own browser on the host | Medium | A same-user process that is not an agent passes (criterion 5.6); post-build check PB-4 confirms the lookup works on the owner's host. |
| Another local program holds the `localhost` name and serves a page with a trusted origin | High | Only `127.0.0.1` is named or linked (criterion 5.4, row 134). |
| A client the owner shut out keeps its open connection | Medium | A settings change closes every connection (criterion 5.16). |
| A slow or huge client exhausts memory | Medium | Criteria 5.8 and 5.11, and the engine's backlog bound (issue 41). |
| A reconnect loop locks the owner's phone out | Medium | Criterion 5.11. |

**Verify:** criteria 5.1-5.16; environment QA: none.

**Rollout detail:** rollout step 6.

**WS-6: Alerts that reach the owner's phone**

Purpose: turn "owner needed" and other pieces' alert sources into
recorded alerts, send them through one sender interface, and clear them.
Contract section 4. Rows 18, 20, 28, 35, 77, 79, 83, 87, 88, 93, 94, 98, 106,
107, 108, 114, 115, 130, 131, 136, 138, 139, 144, 145. Units: 6a the reactor; 6b the sender interface and the ntfy
carrier.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | Each of the engine's three `OwnerNeeded` producers, provoked in a test service, raises an alert of the contract's kind; an account alert is raised from the event that names the account, and from `OwnerNeeded` only when the agent's account has no row; an unknown reason raises kind `other`; on a rescan after a restart, an event whose subject has closed raises nothing | Test id: `packages/engine/test/client/alert-sources.test.ts` |
| 6.2 | One alert is open per key; every row of the contract's closing table holds, including a stop with an owner-held request, a stopped asker, a failed reload, a removed account, and a sign-out after a usage limit, which gives two alerts with the right remedies; dismissing clears one in the planner's batch; dismissing a closed alert succeeds with no event; a dismiss racing a close writes one clear; when a stopped or crashed asker resumes, its open owner-held question raises a new alert with the same key, and a request does not; a dismiss writes no source sequence and moves no position; a stopped asker's request closes by `PermissionCancelled`, and an old log's row counts as closed when its agent is stopped or crashed | Test id: `packages/engine/test/client/alert-life.test.ts` |
| 6.3 | Killing the service between an event and its alert gives exactly one alert after restart | Test id: `packages/engine/test/client/alert-reactor-restart.test.ts` |
| 6.4 | A test piece's alert source raises and ends its own kind; its result can name no title; a piece's alert source or `openMatters` that throws raises nothing, and the reactor goes on (row 161) | Test id: `packages/engine/test/client/alert-piece-source.test.ts`; command: `pnpm -r typecheck` on a fixture source with a title fails |
| 6.5 | An agent string planted in a request, a question, a crash and a piece's event appears in no `AlertRaised` event and no sent payload; the agent's name and its group labels each travel in their own field under a fixed label, with control and formatting characters and line breaks removed; a name is cut to 64 characters, and a team to 8 labels and 128 characters; neither is ever inside the title | Test id: `packages/engine/test/client/alert-no-agent-text.test.ts` |
| 6.6 | Each kind's push setting has the contract's default and can be changed by the owner and the web caller; the setting is read at send time | Test id: `packages/engine/test/client/alert-settings.test.ts` |
| 6.7 | The alert rules call only `AlertSender`: with a fake sender, every raised alert that is pushed by its kind's setting reaches the fake, with its kind, name, team, title and link; a clear calls `clear` once; no alert module imports a carrier | Test id: `packages/engine/test/client/alert-sender.test.ts`; boundary test `packages/engine/test/client/alert-sender-imports.test.ts` |
| 6.8 | With no ntfy server or topic set, nothing is pushed, nothing fails, and the alert stays in the clients; setting a carrier later makes every open alert that is not `baseline` pending in the new generation; the code and the default settings hold no ntfy address | Test id: `packages/engine/test/client/alert-ntfy-unset.test.ts`; command: `grep -rn "ntfy\.sh\|192\.168\." packages/engine/src packages/contracts/src` prints nothing |
| 6.9 | ntfy: an alert is posted to the configured server and topic with its title, kind, agent name, team and link, and its alert id as the sequence id; a clear deletes it by that id; a token, when set, is sent as the bearer | Test id: `packages/engine/test/client/alert-ntfy.test.ts` (against a local fake ntfy server) |
| 6.10 | The link opens the agent's thread at the public address setting, carries no credential and no command; the alert has a link only with proxy mode on and a public address set | Test id: `packages/engine/test/client/alert-link.test.ts` |
| 6.11 | Delivery is at least once: killing the service before a send, after the carrier's acceptance and before the local record, and during backoff gives one alert record and one or two sends, never none; attempts and waits survive the restart; a timeout and a lost response are failed attempts; an alert cleared in backoff is not sent; one alert's backoff delays no other; a failed send never stops the reactor. A carrier that is down for an hour and then returns gets the open alert, with `final` shown as still failing and retries at the 10-minute cap. Generations: delivered to topic A, then a change to topic B, makes it pending for B; a result from A that arrives after the change settles nothing; five authorization failures and then a new token on the same server recover the alert; a new token does not resend a delivered one; all of this holds across a restart | Test id: `packages/engine/test/client/alert-delivery.test.ts`; `packages/engine/test/client/alert-generation.test.ts` (a fake carrier with fault injection and a test clock) |
| 6.12 | The ntfy token appears in no event, no receipt, no reply and no service log | Test id: `packages/engine/test/client/alert-ntfy-secret.test.ts` |
| 6.13 | The carrier resolves only the active slot name: a payload that names an account's reference, or a value equal to one, sends no account key; a boundary test finds no other `resolve` call in the client folder; no read returns the token; an account's environment that names the slot cannot read it or keep it (criterion 1.39); the one exception, tested exactly: for the warning about a carrier change or a token clear, the carrier may resolve the name just cleared, and sends it only to the origin in that value's own `client.AlertCarrierTokenSet`; the boundary test allows this path and no other | Test id: `packages/engine/test/client/alert-carrier-token.test.ts`; boundary test in the same file |
| 6.14 | The token is bound to its server: changing to another origin clears it in the same batch, and the old value is removed; the carrier sends a token only for its recorded origin; `set-token` has access `owner` alone, rotates, and reads its value from standard input; `clear-token` removes it; `set-token` names the origin, and a mismatch or no server is refused; its terminal form shows the current server first; a failed log write after the store leaves the earlier token active and working, for both a first token and a rotation; the worker removes only the old generation's value; "none" clears the token in the same batch, so a restart and a later set of the same server do not report a token that is gone; an active reference with no value is a failed attempt, shown as "token missing", and is never a send with no token | Test id: `packages/engine/test/client/alert-carrier-token.test.ts`; `packages/cli/test/carrier-token.test.ts` |
| 6.15 | The carrier's transport: an `http` server is refused unless its host is a private address literal; a redirect is never followed and is a failed attempt, so no token crosses an origin or falls to plain text; at most 64 KiB of a response is read; the server is parsed by the URL standard's parser, so user information, a path, a query and a fragment are refused, forms such as `http://127.1` and `http://[::ffff:192.168.1.1]` are judged on the parsed host, and the canonical origin is what is stored; a topic outside `[-_A-Za-z0-9]` or over 64 characters is refused; `client.alerts.carrier.set` takes "none" | Test id: `packages/engine/test/client/alert-carrier-transport.test.ts` |
| 6.16 | The first start on a log with history and a set carrier pushes nothing; an alert is raised, marked `baseline`, for each matter still open; a later matter is pushed; an open board and an open roles matter, from a fixture `openMatters`, get `baseline` alerts and closed ones do not; a close committed after the scan closes its alert; a kill inside the first start leaves all or none | Test id: `packages/engine/test/client/alert-first-start.test.ts` |
| 6.17 | A change to a lasting setting with `device: open-web` raises a `client.lasting-setting` alert, pushed by default, which ends only when dismissed; the same change from the owner's terminal raises none; `client.AlertSettingsChanged` and `client.AlertCarrierTokenCleared` are sources; a device caller cannot switch off this kind's push; the alert about a carrier change also reaches the old carrier, before the old token's value goes; `shephrd client alerts list --all` shows a record dismissed from the web; against a deny-all fake server, the alert about `client.AlertCarrierTokenCleared` reaches the server with the cleared value, up to five attempts, and the value is removed only after they end, with the cleanup worker raced against the retries; a device caller's dismiss of this kind before the send does not cancel it, a dismiss after it does not call `clear`, and neither stops the warning attempts; a terminal dismiss works as for any kind | Test id: `packages/engine/test/client/alert-lasting-setting.test.ts` |
| 6.18 | Once the alert commands are installed, an agent caller is refused `client.alerts.dismiss`, and it is not an MCP tool | Test id: `packages/engine/test/client/client-visibility.test.ts`; `packages/cli/test/parity.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6a.1 | Install the alert commands. The alert reactor, with its two tables called through `guardPiece`, under section 1's reactor rules, alert events, the keys and level closing table, the return of a question's alert, the first-start scan with each piece's `openMatters`, dismiss in its planner, the title table, the lasting-setting source, push settings | Target `packages/engine/src/client/alerts/`; producers `packages/engine/src/routing/holders.ts:49`, `recovery/crash.ts:69`, `routing/deliveries.ts:194` |
| 6b.1 | `AlertSender` with `send` and `clear`, delivery derived from the log by generation, the carrier settings with no default, the link builder, and the ntfy carrier with its transport rules | Target `packages/engine/src/client/alerts/AlertSender.ts`, `packages/engine/src/client/alerts/delivery.ts`, `packages/engine/src/client/alerts/carriers/ntfy.ts`; ntfy publishing documentation (sequence id, delete); post-build check TM-PB-4 |
| 6b.2 | Install the carrier commands. The token slot, with the warning's one exception: `client.alerts.carrier.set-token` and `clear-token`, the `shephrd` form, and the client's keep entry | Target `packages/engine/src/client/alerts/token.ts`; `accounts/SecretStore.ts`; E27 (1b.9); pattern `commands/accounts.ts:68-82` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An alert is lost across a restart | High | At-least-once delivery, derived from the log (criteria 6.3, 6.11). A duplicate is the accepted fault. |
| A stored secret leaves the host through the carrier | High | One logical slot, bound to its origin, with no reference in the settings, and a token set only for the origin the owner names (criteria 6.13 to 6.15). |
| Clearing a token deletes another secret | High | Collection is at start-up only, and the clear removes one name (criterion 1.39, row 130). |
| A home server's outage loses the alert | High | An open alert keeps retrying at the 10-minute cap (criterion 6.11). |
| A resumed agent's question has no alert | Medium | The level rule that raises it again (criterion 6.2). |
| The token is lost at restart, so alerts stop | High | Edit E27 (criterion 1.39). |
| Every old matter is pushed at the first start | Medium | Criterion 6.16. |
| A stale alert stays open for ever | Medium | The level closing table (criterion 6.2). |
| Agent text in a notification steers the owner | High | Criterion 6.5; titles come from a fixed table; name and team are short and under fixed labels. |
| The owner's server address is written into the code | Medium | Criterion 6.8. |
| A later carrier needs the alert rules changed | Low | Criterion 6.7's boundary test. |
| One call silences the phone, or a dismiss erases the warning | High | The warning uses the cleared value, and a device caller's dismiss does not cancel it (criterion 6.17, rows 164, 165). |
| A parsing or redirect mistake sends the token to the wrong place | High | Criteria 6.12 to 6.15, and unit 6b's attack pass (row 169). |
| A caller of the open web server redirects alerts | Medium | Accepted while the server is open (row 88); such a caller could already answer requests, and the token does not follow (criterion 6.14). The change raises an alert (criterion 6.17). Recorded as a known gap. |

**Verify:** criteria 6.1-6.18; environment QA: on the owner's phone, an alert arrives (unit 11).

**Rollout detail:** 6a at rollout step 5; 6b at step 7, when the owner sets the ntfy server and topic.

**WS-7: The web page**

Purpose: give the phone and any browser the owner's view: what needs the
owner, every thread, and the answer and prompt actions. Units: 7a shell
and situation view; 7b thread view, answering and prompting; 7c alerts and
settings.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 7.1 | The page's RPC client sends its credential header from one module, empty for now; no other module sets a credential | Test id: `packages/web/test/credential-header.test.ts`; boundary test `packages/web/test/credential-imports.test.ts` |
| 7.2 | The situation view sorts agents into "needs you", "working" and "idle" from snapshot and stream, and resumes from its cursor after a dropped connection | Test id: `packages/web/test/situation.test.tsx` |
| 7.3 | At 360 pixels wide, no page scrolls sideways | Test id: `packages/web/e2e/layout.spec.ts` (Playwright) |
| 7.4 | The thread view shows text, plans, tool calls, file changes and requests; a planted `<img src=x onerror=...>`, a `javascript:` link and Markdown in agent text are shown as text and run nothing; an oversized marker loads its event on a tap; a placeholder appears only for a content-only tag | Test ids: `packages/web/test/thread.test.tsx`, `packages/web/test/agent-text.test.tsx` |
| 7.5 | Answering a request sends one `answer` with one request id; a double tap acts once | Test id: `packages/web/test/answer.test.tsx` |
| 7.6 | The owner can prompt an agent from the thread view | Test id: `packages/web/test/prompt.test.tsx` |
| 7.7 | The alerts page lists open and cleared alerts, and a tap opens the alert's thread | Test id: `packages/web/test/alerts.test.tsx` |
| 7.8 | The settings page changes alert settings and offers no computer-only action: no pairing code, no web server setting, no standing rule | Test id: `packages/web/test/settings.test.tsx` |
| 7.9 | An alert's thread link opens that thread and sends no command | Test id: `packages/web/test/thread-link.test.tsx` |
| 7.10 | An unknown event does not break any page | Test id: `packages/web/test/unknown-event.test.tsx` |
| 7.11 | The production bundle builds with no Node import and no shim, runs in a real browser, and carries one command through `device: open-web`; the page keeps no thread data in `localStorage`, `sessionStorage` or IndexedDB | Command: `pnpm --filter web build`; test id: `packages/web/e2e/production.spec.ts` (Playwright, the production artifact) |
| 7.12 | The owner approves the action: a permission request's full text and its tool input are visible, unfolded, before "Allow" can be tapped, and agent text looks different from Shephrd's controls. A request whose title and input disagree shows both. When the input is absent, redacted or cut, the page shows Shephrd's fixed warning that the input is not visible. A request whose options are all refused for the web says so, with no button that cannot work; a Codex-shaped request, with `locations` and no input, shows the locations and the thread items with the same `toolCallId` unfolded above "Allow", with no warning, and the warning appears only when neither exists; `toolInput` with bidirectional controls or long whitespace cannot hide its meaning on a 360-pixel screen, which unit 7b's attack pass also tries | Test id: `packages/web/test/request-whole.test.tsx`, with a title-and-input case, an absent-input case and an all-refused case |
| 7.13 | The thread page's subject panel shows a table entry for a known namespace, and for any other shows the fallback that names the subject; opening a link runs no state-changing command | Test id: `packages/web/test/subject-panel.test.tsx` |
| 7.14 | A page never loses control state to a marker: with the page subscribed, another client starts an agent with a 300 KiB prompt, then opens a request over 256 KiB, and a `HarnessChanged` over 256 KiB follows; the roster, the request list and the counts converge with no tap and no reload, the request can be answered, and a reconnect loses nothing; on a link throttled to 500 kilobits per second, with a 1 MiB state event and live events flowing, the page converges, with no reconnect loop of the same read, and the request can still be answered; the production bundle's real Effect protocol is used, not a fixture with no pinger: the read connection's configured `pingInterval` and `pingTimeout` are recorded, it stays open through the whole 1 MiB reply, the read completes once, and the stream connection keeps Effect's default | Test id: `packages/web/e2e/oversized-state.spec.ts` (Playwright, the production artifact, real encoded frames) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 7a.1 | Vite and React app, over `packages/client`'s browser entry (E26), with the one credential module; `client.subscribe` as its stream; situation view | Target `packages/web/src/`; `packages/client/src/browser.ts`; Effect `socket/Socket.ts:layerWebSocketConstructorGlobal` (l.877), `rpc/RpcClient.ts:layerProtocolSocket` (l.1293); pattern Synapse `web/` (research, "The web server skeleton") |
| 7b.1 | Thread view, thread links, answering, prompting, and the subject panel with its fallback | Target `packages/web/src/thread/`; events from `ApiEvent` |
| 7c.1 | Alerts and settings pages | Target `packages/web/src/admin/` |

**Design artifact:** mock gate: owner session. The mock must decide: the
situation view's lanes and what each row shows; how a permission request's
options are laid out on a phone (Allow once, Deny, and how the page shows an
option the owner's question 6 keeps at the computer, row 95); how a request's
whole text and its tool input stay visible before Allow, how the fixed warning
looks, and how agent text is told apart from Shephrd's controls (rows 118, 132); how a long tool call or file change is
folded; the thread view's prompt box; the subject panel; and the alerts and
settings pages.
No unit of WS-7 starts before the owner approves the mock.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Agent text runs as code in the page (cross-site scripting) | High | Criterion 7.4; React text rendering only, no raw HTML; the CSP of criterion 5.10; an attack pass on unit 7b. |
| The owner approves a title that does not describe the action | High | The tool input is shown first, with a fixed warning when it is not visible (edit E29, criterion 7.12). A prompt injection can still shape what the input means, so the owner reads it. |
| A board alert cannot be answered from the page | Medium | The subject panel; the board's plan owns the end-to-end test (row 112). |
| A double tap answers twice | Medium | Criterion 7.5. |
| A link in an alert acts without the owner | Medium | Criterion 7.9. |
| The page is unusable on a phone | Medium | Criterion 7.3; the mock gate. |
| A slow link makes the page lose its stream for ever | High | Two connections and the chunk limit (criteria 7.14, 3.9). The remaining limit is in the known gaps. |

**Verify:** criteria 7.1-7.14, and unit 7b's attack pass; environment QA: the owner's real phone in unit 11.

**Rollout detail:** rollout step 6.

**WS-8: Threads in a Herdr pane**

Purpose: read and answer threads where the owner already works (lead ruling
L4, row 46). Unit 8.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 8.1 | `shephrd view` lists agents, opens a thread, and updates live | Test id: `packages/viewer/test/view.test.tsx` (Ink's test renderer) |
| 8.2 | The owner can answer a request and prompt an agent from the viewer; terminal control characters in agent text are stripped; before an answer, the viewer reads the request with `client.event` and shows its input, the thread items with the same `toolCallId` when it has no input, or the fixed warning | Test id: `packages/viewer/test/actions.test.tsx`; `packages/viewer/test/request-action.test.tsx` |
| 8.3 | The viewer uses the owner credential over the Unix socket, and is refused when run inside an agent's process tree | Test id: `packages/viewer/test/identity.test.ts` |
| 8.4 | A Herdr plugin action opens the viewer in a pane | On-host step: `herdr plugin action list --plugin shephrd` lists `view`; running it opens a pane showing the agent list |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 8.1 | The Ink app over `packages/client` | Target `packages/viewer/src/`; client `packages/client/src/index.ts:connect` (l.117); control-character stripping per engine criterion 7.7 (`packages/cli/test/control-chars.test.ts`) |
| 8.2 | The plugin action | `herdr-plugin.toml` (`[[actions]]`); post-build check PB-3 |

**Design artifact:** mock gate: owner session, in the same session as
WS-7. The mock must decide the pane's layout at Herdr's usual pane sizes
its keys for moving, answering and prompting, and how a request's input or its
warning shows before an answer.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Agent text moves the cursor or rewrites the terminal | Medium | Criterion 8.2. |
| An agent runs the viewer to act as the owner | High | The engine's ancestry check (criterion 8.3). |

**Verify:** criteria 8.1-8.4; environment QA: criterion 8.4 on the owner's Herdr host.

**Rollout detail:** rollout step 6.

**WS-9: Shephrd's own Unix user, deferred**

The owner deferred Shephrd's own Unix user on 2026-11-03 (row 78). This
plan has no unit 9, and remote access does not wait for one. SECURITY.md's
paragraph "Agents can read Shephrd's own files" says that the setup is
still planned, and that until then any agent can read Shephrd's state
folder.

**WS-10: Remote access through the owner's proxy**

Purpose: let the phone reach the page through the owner's own reverse
proxy over WireGuard, with the encryption at the proxy. Rows 76, 84, 89, 91,
92, 113, 115, 116, 133, 134, 141. Unit 10.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 10.1 | In proxy mode, the web server accepts the public address setting's `Host` and `Origin` whatever the proxy does with `Host`, and a request that is not public keeps the loopback names, and still binds only loopback; outside proxy mode the public address is refused | Test id: `packages/engine/test/client/web-proxy.test.ts` |
| 10.2 | Every row of contract section 5's proxy table holds: with proxy mode off, a request with any forwarded header is refused; a peer matching the proxy user id is always public, so it never reaches a loopback row; a public request with a missing last `X-Forwarded-For`, or one that is the host's own or outside the allowed networks, or whose `X-Forwarded-Proto` is not `https`, or that names no public address, is refused; addresses are compared in normal form, including IPv4-mapped IPv6; a direct connection that forges a header still meets the guard first; a settings change closes open connections; a public request with `Host` set to the public address and a loopback `Origin` is refused, and the pair for a proxy that rewrites `Host` is accepted | Test id: `packages/engine/test/client/web-proxy-table.test.ts` |
| 10.3 | `docs/remote-access.md` describes the setup: WireGuard to the host; an example Caddyfile whose site uses `bind` on the WireGuard address and a `remote_ip` matcher for the WireGuard network, and proxies to the loopback port; the web server's four proxy settings; that the proxy must set both `X-Forwarded-For` and `X-Forwarded-Proto` and should run as its own user; that the page is at `127.0.0.1`; the warning to store a secret with `accounts set-secret`; the ntfy server's deny-all setup; the guard's limits; and a "lost phone" section; that a `client.web-down` alert means the page must not be opened; and the limit of a squatter on the loopback port | Command: `grep -q 'bind ' docs/remote-access.md && grep -q remote_ip docs/remote-access.md && grep -q reverse_proxy docs/remote-access.md && grep -qi 'lost phone' docs/remote-access.md && grep -qi deny-all docs/remote-access.md && grep -q X-Forwarded-Proto docs/remote-access.md && grep -q 127.0.0.1 docs/remote-access.md && grep -q 'accounts set-secret' docs/remote-access.md && grep -q 'client.web-down' docs/remote-access.md` |
| 10.4 | From a phone on mobile data with WireGuard on, through the owner's proxy, the page opens and shows the situation view. With WireGuard off on mobile data, and from another device on the home network, the upgrade fails | On-device step: the owner's phone and a second device, rollout step 8 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 10.1 | Proxy mode in the web server's settings, the public allow-list, and the forwarded address and protocol table | Target `packages/engine/src/client/web/proxy.ts`; WS-5's guards and `webCaller`; the host's addresses from Node's `os.networkInterfaces()` |
| 10.2 | The setup document with the example Caddyfile, which names the settings the owner sets to match the proxy's site address and WireGuard network | Target `docs/remote-access.md`; Caddy's `bind` and `remote_ip` documentation; post-build check PB-2 |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Anyone who reaches the proxy has the owner's control | High | Enforced, not assumed (row 91): the example binds only WireGuard, the web server checks the client's network, and the owner checks the negative steps (criteria 10.2 to 10.4). Attack pass. |
| An agent reaches the web server through the proxy's public address | Medium | Criterion 10.2. |
| The example sends the API without encryption | Medium | The example terminates TLS at Caddy, the web server never binds a non-loopback address, and a public request must carry `X-Forwarded-Proto: https` (criteria 5.1, 10.1, 10.2). |

**Verify:** criteria 10.1-10.4; environment QA: the owner's phone.

**Rollout detail:** rollout step 8; the owner points the proxy at the web server.

**WS-11: Proof on a real phone**

Purpose: show the epic's second "done when" end to end, without pairing.
Unit 11.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 11.1 | In a phone-sized headless browser: a fake agent asks permission, the alert reaches a fake ntfy server with a thread link, the link opens the thread, the owner answers, the agent is released, and the thread reads back | Test id: `packages/web/e2e/phone-flow.spec.ts` |
| 11.2 | The owner gets a real alert on a real phone through ntfy, opens its link through the proxy, answers a real permission request, and reads the thread | On-device step: the owner's phone, recorded in the run's result file |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 11.1 | The Playwright flow | Target `packages/web/e2e/`; fake agent `packages/testing/` (engine unit 8a) |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The flow passes headless but fails on a real phone | Medium | Criterion 11.2 by the owner. |

**Verify:** criteria 11.1-11.2; environment QA: criterion 11.2.

**Rollout detail:** rollout step 9.

Post-build checks (code-level worries a plan cannot settle):

- PB-1: confirm Effect 4.0.5's Node HTTP server lets the web server set
  the inbound WebSocket message size limit (criterion 5.8); if not, enforce it in
  the protocol wrapper, as `boundedProtocol` does for backlogs.
- PB-2: on the owner's real proxy, confirm what the web server receives:
  `X-Forwarded-For` with a client-sent value, `X-Forwarded-Proto`, and `Host`.
  A missing forwarded header is a failed check, and the owner fixes the proxy's
  settings before relying on it. Caddy's documentation, read 2026-11-03, says it
  "sets or augments" the first, ignores incoming values by default, and passes
  `Host` through, but the owner said "a caddy or something".
- PB-3: confirm how a Herdr plugin action opens a new pane (Herdr 0.9.x
  plugin manual) before unit 8's action is written.
- PB-4: confirm, on the owner's host, that a process running as the owner
  can read the `/proc/<pid>/fd` links of the owner's other processes. A
  `hidepid` mount option or a hardened kernel setting could hide them. Then
  the guard refuses every same-user peer, including the owner's own
  browser on the host. Also measure a scan's time with a busy writer, so it
  does not block the service's event loop for long.
- PB-5: confirm that the owner's ntfy server honours the sequence id and the
  delete by it, and record the server's version. If it does not, a duplicate
  shows as two notifications and `clear` does nothing, which are both accepted
  faults.
- PB-6: from a real phone, sleep the page, answer a request from another
  client, reconnect, and try the stale action. The page shows the resolved
  request and shows the refusal plainly.
- PB-7: rebuild a migrated database that holds every caller form, and confirm
  that the views equal the live ones.
- PB-8: with a burst of alerts against ntfy's visitor limits, confirm that a
  limited send counts as a failed attempt, that retries recover it, and that the
  limit's `Retry-After` causes no tight loop. Also confirm that a non-ASCII agent
  name does not fail a send, and that a name holding a URL is not a tappable link.
- PB-9: confirm that the page's content policy allows `wss` through the proxy on
  the owner's phone.
- PB-10: confirm that `thread export` over an existing file keeps mode 0600 or
  refuses, and that the service's log holds neither refused credentials nor
  forwarded addresses.
- PB-11: confirm that the built `open-web` credential has an opaque brand,
  because a plain `{ _tag: "open-web" }` would compile anywhere in TypeScript.
- PB-12: queue three deliveries, the first failing its reach check, in one send
  pass. The first is withdrawn, the second is sent, and the third stays queued.
- PB-13: run the delivery worker with the log writer latched, after the carrier
  accepted a send. It stops with no tight resend loop.
- PB-14: record real permission requests, per harness and per tool kind, with their
  `kind`, `rawInput`, `locations` and `content`. Report how often the fixed warning
  would appear, because a warning on every request teaches the owner to tap past it.
- PB-15: from a real phone on a link throttled to 500 kilobits per second, with
  agents writing, open a 900 KiB thread page and meet a 1 MiB state event. Both finish
  with no reconnect loop. Keep a browser trace and the server's connection log.
- PB-16: reconnect a page after an hour asleep on a busy log. It catches up, or it
  takes a new snapshot. Catch-up costs one round trip per event, and the 2,048 backlog
  rule may close it repeatedly, so record the time and the count of reconnects.
- PB-17: change the carrier with 500 open alerts. Retries converge at the cap, with no
  event burst beyond one per attempt.
- PB-18: run the fixture piece that throws from each table on a copy of a real log.
  Commands, restart and the rebuild check all pass.
- PB-19: bring WireGuard up after the service has started. The host's own addresses
  must not be stale, so the table's "one of the host's own addresses" row still refuses.
- PB-20: send an inbound frame that inflates past 1 mebibyte under WebSocket
  compression. It closes the connection, and the server's memory stays bounded.
- TM-PB-4: against a fake carrier that answers with a huge body or a slow
  stream, confirm that reads stay bounded and that the reactor keeps running.
- TM-PB-6, for the interactive mode plan: interactive agents do not descend
  from an adapter, so that plan must record them so that the guard still
  applies.

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: epic `shepherd-foundation` row 2 and its second "done
when"; the engine design's capabilities 6, 8 and 9 and "What this spec
leaves open" (client API); `docs/features.md` section 3 ("Threads where the
owner already works") and section 4; `docs/research/t3-code.md` items 9 to
12; `docs/issues.md` issues 65, 75 and 164; owner choice A10; lead rulings
L1 to L4, L10, L11, L13, L15, L16, L19, L22, L23, L26, L28, L29 and L30;
the owner's answer on engine edits (2026-11-03); the owner's decisions in
design talk 1 (2026-11-03, `docs/specs/2026-11-03-client-api-design.md`);
the lead's rulings on review rounds 1, 2 and 3 (`attack/round-1-findings.md`,
`attack/round-2-findings.md`, `attack/round-3-findings.md`);
the roles planner's requests 1 to 6 and the board planner's R1 items 1 to
6; SECURITY.md security rules 1 to 7.

| Source item | Workstream | Status |
|---|---|---|
| Epic row 2: device pairing | WS-4 | deferred by the owner (rows 80, 86); the slot is built (criteria 5.2, 5.5, 7.1) |
| Epic row 2: phone alerts | WS-6 | planned |
| Epic row 2: encrypted remote access | WS-10 | planned; the encryption is at the owner's proxy (row 76) |
| Epic row 2: the web page | WS-5, WS-7 | planned |
| Epic row 2: thread viewer in a Herdr pane | WS-8 | planned |
| Epic done-when 2: answer and read from a paired phone | WS-11 | planned without pairing; the lead reworded the epic, so done-when 2 no longer names pairing |
| Engine capability 6: read any thread live from any client | WS-3, WS-7, WS-8 | planned |
| Engine capability 8: owner needed becomes a phone alert | WS-6 | planned |
| Engine capability 9: talk to any agent remotely | WS-7, WS-10 | planned |
| Engine design: client API needs its own design round | rows 76-89; `docs/specs/2026-11-03-client-api-design.md` | done |
| Design decision 1: loopback web server, the owner's proxy | WS-5, WS-10 | planned (row 76) |
| Design decision 2 and addendum: ntfy behind one sender interface | WS-6 | planned (rows 77, 83) |
| Design decision 3: no own-user unit | WS-9 | deferred by the owner (row 78) |
| Design decision 4: links open the thread | WS-6 (6.10), WS-7 (7.9) | planned (row 79) |
| Design decision 5 and condition: open web server, pairing slots in | WS-4, WS-5 (5.2), WS-7 (7.1) | planned (rows 80, 81) |
| Design decision 6: three computer-only commands | WS-5 (5.5), WS-7 (7.8) | planned (row 82) |
| Same-machine guard | WS-5 (5.6, 5.7), WS-10 (10.2) | planned (rows 84, 89) |
| Manager's attack-list entry A11 (lead, board #201): `Host` and `Origin` name the server | WS-5 (5.4), WS-10 (10.1) | planned (row 90) |
| Features §3: threads where the owner already works (pane viewer) | WS-8 | planned |
| Features §3: VS Code extension | none | not built; WIDENED, open until the scope is confirmed (rows 51, 121) |
| Features §4: one authenticated API for every client | WS-1, WS-2, WS-5 | planned; the web server is open for now (row 80) |
| Features §4: device pairing | WS-4 | deferred (row 86) |
| Features §4: live updates | WS-3 | planned |
| Features §4: updates that survive a sleeping phone | WS-3, WS-5 (heartbeat) | planned |
| Features §4: browser terminal | none | out of scope (lead L2, row 5) |
| Features §4: four phone alerts | WS-6 | planned |
| Features §4: Shephrd runs as its own user | WS-9 | deferred by the owner (row 78) |
| Features §4: macOS support | none | out of scope (owner, 2026-11-01, Linux only) |
| Features §4: herding names | none | shelved by the owner |
| Research item 9 | WS-3 | planned |
| Research item 10 (browser terminal) | none | out of scope (row 5) |
| Research item 11 | WS-6 | planned |
| Research item 12 (signed links) | none | not adopted by the owner (row 79) |
| Issue 65 (owner alert withdrawal) | WS-6 | planned (derived ends, row 18) |
| Issue 75 (no owner waiter) | WS-3 | planned (client wait, rows 4, 50) |
| Issue 164 (agent-less events hidden from agents) | WS-1 | stands (contract section 3) |
| Owner choice A10 | WS-3 | planned |
| Lead L1 | WS-3 | planned |
| Lead L2 | none | out of scope |
| Lead L3 | WS-7 (phone uses the page) | planned |
| Lead L4 | WS-8 | planned |
| Lead L10 | WS-1 (criterion 1.16) | planned |
| Lead L11 | WS-1 (criteria 1.17, 1.18) | planned |
| Lead L13 | WS-1 (criterion 1.19) | planned |
| Lead L15 | WS-1 (1.7, 1.17, 1.20, 1.21), WS-2 (2.6), WS-3 (3.5), WS-6 (6.5) | planned |
| Lead L16 | WS-1 (criterion 1.19) | planned |
| Lead L19 | WS-1 (criterion 1.23) | planned |
| Lead L22 | WS-1 (criteria 1.21, 1.24) | planned |
| Lead L23 | WS-1 (criterion 1.25) | planned |
| Owner answer on engine edits (2026-11-03) | WS-1 (units 1a, 1b) | planned (row 63) |
| Lead L26 | WS-1 (criteria 1.1, 1.22), WS-2 | planned (row 64) |
| Lead L28 | WS-1, WS-3 (3.5) | planned (contract section 1) |
| Lead's round 4, S1 to S6 | WS-1 (criteria 1.26-1.32) | planned (rows 68, 70-73) |
| Lead L29 | WS-1 (criterion 1.28) | planned (row 69) |
| Lead L30 (board Q6 changes 1 to 4) | WS-1, WS-3 (3.5) | planned (contract v5) |
| Lead's rulings on round 1, 1 to 7 | WS-1, WS-2, WS-3, WS-5, WS-6, WS-7, WS-10 | planned (rows 91 to 128; `attack/round-1-findings.md`) |
| Lead's rulings on round 2, 1 to 14 | WS-1, WS-2, WS-3, WS-5, WS-6, WS-7, WS-10 | planned (rows 130 to 157; `attack/round-2-findings.md`) |
| Lead's rulings on round 3, 1 to 8 | WS-1, WS-2, WS-3, WS-5, WS-6, WS-7, WS-8, WS-10 | planned (rows 158 to 175; `attack/round-3-findings.md`) |
| Lead's v12 note, two lines and a ruling | WS-1 (1.44), WS-3 (3.1, 3.8) | planned (rows 176 to 178); roles unit 11b writes the capacity-hold clause |
| Lead's final rulings, R4-A1 and the re-anchor to `9e386b0` | WS-1 (1.34, 1.42), WS-2, WS-7 (7.14) | planned (rows 179 to 181; `attack/round-4-findings.md`) |
| Owner question 6 | WS-1 (1.41, E28) | pending the owner (row 95) |
| Roles requests 1-6 | WS-1, WS-3, WS-6; contract section 7 | planned |
| Board R1 items 1-6 | WS-1, WS-2, WS-5, WS-6; contract section 7 | planned |
| SECURITY.md rules 1-7 | Guardrails fold | planned; rule 2 suspended for the web server by the owner |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| AGENTS.md rule 1: never push to `vitalysim/herdr-synapse` | Every unit pushes to `qnlbnsl/sheprd` only. |
| AGENTS.md rule 2: credit copied code | No code is copied in this plan. A unit that copies any (for example from Synapse's web page) follows rule 2 under `third_party/`. |
| AGENTS.md rule 3: keep the lists current | Each unit records problems in `docs/issues.md`; this planner's finds go to the lead in the result file. |
| AGENTS.md rule 4: SECURITY.md is binding | Rule 1: criterion 5.1. Rule 2: suspended for the loopback web server by the owner on 2026-11-03 (row 80), with SECURITY.md's text owner-approved (row 85); the Unix socket keeps it (criterion 5.13), and the web server refuses the host's credentials (criterion 5.3). Rules 3 and 4: deferred with pairing (row 86). Rule 5: the web server binds loopback only, the proxy carries the encryption, and a public request must be HTTPS from an allowed network (criteria 5.1, 10.1, 10.2). Rule 6: criteria 1.39, 1.40, 3.1, 6.5, 6.12 to 6.15. Rule 7: rows 19, 37, 87, 101, 140; criteria 1.13, 3.3, 7.4, 7.12; the suspension paragraph states that approval over the open server needs no credential. |
| AGENTS.md rule 5: the API is the product's surface | Every owner action is an API command. Rule 5 is narrowed by the owner for three computer-only commands (rows 82, 85; criterion 5.5). Contract section 2 lists every exception in one place (row 142): the owner's three, the carrier token (row 94), `debug.compare-views` (row 99), the lasting-setting push (row 139), and the persistent answers of question 6 if the owner agrees (row 95). `shephrd client wait` runs on the API (row 50). |
| AGENTS.md rule 6: team shapes do not belong here | No team shape or workflow is defined; alert kinds and services are mechanisms. |
| AGENTS.md rule 7: commit only when asked | The run's team rules allow commits; units commit per the lead. |
| AGENTS.md, "Language": TypeScript, Effect 4, Node.js 26 | All code is TypeScript with Effect 4.0.5; Effect claims checked against the installed source (rows 24, scouting). |
| AGENTS.md, "How agents are run": one delivery interface | The client API reads events and roster fields that do not depend on run mode; piece deliveries go through the engine's delivery path (contract edit E16). |
| Owner answer, 2026-11-03: edit the engine directly (row 63); lead ruling L26 (row 64) | Units 1a and 1b make contract section 6's edits; each change to existing behaviour is named with its tests (rows 64, 67; criterion 1.1). |
| Owner decisions, design talk 1 (2026-11-03) | Folded as rows 76 to 90; the contract carries them; the owner's words are quoted in `docs/specs/2026-11-03-client-api-design.md`. |
| Run team rule 6: scope | This planning run writes the plan folder, the design note, and the SECURITY.md and AGENTS.md text the owner approved (row 85). |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its harness-session skill)
at launch; this section names none (owner, 2026-10-16).

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1a Engine lists: commands, access, planners, reads, events, views, migrations, visibility, snapshot | backend | engine/backend | high | Changes the engine's only entry point, its access check and its log. | yes | rollout step 2 |
| 1b Engine callers and rules: caller schema, device field, service caller, sender wrapping, piece source, withdrawal, reach check, wait conditions, secret collection, the question 6 refusal, the permission request's tool fields | backend | engine/backend | high | Adds a caller kind and authorization rules, and changes the prompt renderer and the dispatcher. | yes | 1a |
| 2 Client contracts, stream dispatch, tolerant wire form, browser entry, two connections | contracts | client-api/contracts | medium | New schemas on the contracts package's pattern, and a refactor of the client library behind its existing tests. | no | 1b |
| 3 Reads, filtered stream, client wait | backend | client-api/backend | medium | Handlers over the engine's snapshot and read, with a shared visibility function. | yes | 2 |
| 5 Loopback web server, `webCaller`, the guard and its settings | backend | client-api/backend | high | A new network entry point with no authentication, a process lookup and the browser checks. | yes | 2 |
| 6a Alert reactor and alert events | backend | client-api/backend | medium | A reactor on the engine's reactor pattern, with fixed tables and a first-start scan. | no | 2 |
| 6b `AlertSender`, delivery and the ntfy carrier with its token slot | backend | client-api/backend | medium | One interface and one outbound HTTP carrier, with durable retries and one secret slot. | yes | 6a |
| 7a Web page: shell, credential module, situation view | mobile-ui | client-api/mobile-ui | medium | A new screen set from an approved mock, on the client's browser entry. | no | 2, 3, 5, mock session |
| 7b Web page: thread view, links, answer, prompt, subject panel | mobile-ui | client-api/mobile-ui | medium | Screens from the mock, rendering untrusted text as text. | yes | 7a |
| 7c Web page: alerts and settings | mobile-ui | client-api/mobile-ui | medium | Screens from the mock over existing commands. | no | 7a, 6a |
| 8 Pane viewer | mobile-ui | client-api/mobile-ui | medium | A terminal screen set over the client library. | no | 3, mock session |
| 10 Remote access through the owner's proxy | backend | client-api/backend | medium | One truth table of settings and headers on top of unit 5's guards, and a setup document. | yes | 5 |
| 11 Phone flow and owner check | backend | client-api/backend | medium | One end-to-end test plus an owner step. | no | 6b, 7b, 10 |

Load: 13 build units. At the sheet's builder, test writer and focused
reviewer for each unit, that is 39 launches, plus 14 for the seven attack
passes on units 1a, 1b, 3, 5, 6b, 7b and 10 (one attacker and one verifier each),
53 in all. Unit 6b's pass has criteria 6.12 to 6.15 as its scope (row 169). From the sheet's
tables: the medium backend and contracts units (2, 3, 6a, 6b, 10, 11) build
on the OpenAI vendor; the medium `mobile-ui` units (7a, 7b, 7c, 8) build on
the Anthropic vendor; the provisional high backend units (1a, 1b, 5)
alternate between the two. That is roughly 7 to 8 builds on OpenAI and 5
to 6 on Anthropic, with test writers and reviewers on the other vendor,
and the attackers on the sheet's attack tier: about 25 to 26 OpenAI and 27
to 28 Anthropic launches. The planner cannot read the remaining weekly
allowance; the lead checks each vendor's limit before launching (known
gap).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|
| 1 | 1 / 39 / 34 | Six reviews of `ae967bf`, grades 5 to 6, no refusals. All folded as contract v8 and rows 91 to 128. Every finding, its fix and its criterion are in `attack/round-1-findings.md`. One item is pending the owner (row 95). |
| 2 | 1 / 18 / 30 | Six reviews of `04e1f83`, grades 5 to 7, no refusals. All folded as contract v10 and rows 130 to 157. Every finding, its fix and its criterion are in `attack/round-2-findings.md`. |
| 3 | 0 / 9 / 18 | Six reviews of `a7f1c9f`, grades 6 to 7, no refusals. The nine majors are five distinct ones. All folded as contract v11 and rows 158 to 175. Every finding, its fix and its criterion are in `attack/round-3-findings.md`, whose first section puts each major's fold plainly for the owner. The owner decides whether another round runs. |
| v12 | — | No review round, by the lead's note. `client.event`'s reply names its envelope, a capacity hold keeps an agent unsettled, and `guardPiece` names its two exceptions (rows 176 to 178). |
| 4 | 0 / 1 / 5 | Four Codex Sol reviews of `8a34e59`, by the owner's Codex-only final round, no refusals. The major and the re-anchor item are folded as contract v13 and rows 179 to 181, and the plan is re-anchored to engine `9e386b0`. The other three minors are in `attack/known-gaps.md`, not folded, by the manager's rule. |

</details>
