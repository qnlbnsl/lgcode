---
topic: shepherd-client-api
status: assemble
tier: L
created: 2026-11-03
updated: 2026-11-03
epic: shepherd-foundation
---

# Build Shephrd's client API: pairing, alerts, the web page and the pane viewer

## Overview

This plan builds the second of Shephrd's four pieces, the client API. When
it is done, the owner can pair a phone with a one-time code, get an alert
on that phone when an agent needs them, open a web page on the phone to
read any agent's conversation and answer its permission request, and read
the same conversations in a pane inside Herdr. That is epic row 2, and it
delivers the epic's second "done when": "The owner answers a permission
request and reads a thread from a phone that was paired with a one-time
code."

Today the engine runs agents and records everything they do, but only the
owner's own terminal can reach it, through a private socket file on the
machine. Nothing pairs a phone, nothing sends an alert, and there is no web
page. The engine already has the parts this plan builds on: it records
when the owner is needed, it can stream every event to a client, and it
has a slot for device credentials that nothing fills yet.

The work has one surprise. The engine was meant to be extended "without
changing it", but it cannot be: its list of commands, its list of event
kinds and its two kinds of caller are all fixed. The message board and the
foundry roles hit the same wall. So the plan starts with one engine unit,
the extension seam, that lets each later piece register its own commands,
events and views, and adds a narrow caller for Shephrd's own background
services. It follows a strict rule: nothing the engine already does
changes, and every existing engine test passes unchanged. The lead has put
this to the owner as question 1; the plan assumes the owner agrees.

The rest is built on that seam, in this order:

- the shared definitions every client uses;
- reads that suit a phone: a snapshot, a roster, a paged thread, and a
  filtered live stream;
- pairing and per-device credentials, with revocation;
- a web listener on the machine's own loopback address;
- alerts, from "owner needed" to a phone notification;
- the web page and the pane viewer;
- Shephrd running as its own Unix user, then remote access from outside
  the house;
- an end-to-end check, and one check by the owner on a real phone.

Four product choices belong to the owner and are still open, in a short
design round held beside this plan: how the phone reaches Shephrd from
outside the house, how alerts are carried, whether Shephrd's own Unix user
comes before remote access, and whether an alert's link can answer a
question by itself. The plan is written on the design partner's recommended
option for each: the owner's own WireGuard and reverse proxy, the ntfy
notification service, the own-user setup first, and no answering from a
link. Units 5, 6b, 9 and 10 change if the owner chooses otherwise; the
rest does not. When the owner decides, a short design note records the
decisions, and this plan is updated to match.

The main risks are security risks, because this piece opens Shephrd to a
network for the first time. Anyone who reaches the API with a valid
credential can, in effect, run code on the machine (SECURITY.md). The plan
answers that with: device credentials only on the network, a pairing code
that cannot be guessed in its five attempts, a cookie the page's own
scripts cannot read, checks that stop another website from using it, phone
alerts that never carry an agent's text, and an attack pass on every unit
that outsiders can reach.

## Key decisions

- **One engine unit first, under an "add only" rule.** Every later piece
  needs it. The alternative, a board or a watcher that talks to the engine
  as the owner, would make the record say "the owner" for things the owner
  never did. This waits on the owner's answer to question 1.
- **Shephrd's own services get a narrow caller.** The sheepdog, which
  watches for stalled agents, may nudge, compact, resume and give a
  one-time allow, and nothing else. It exists only inside Shephrd's
  process, so there is no credential for it to leak, and the record names
  it, not the owner. This is the lead's ruling.
- **A paired device acts as the owner, minus three host-only commands.**
  A phone can do everything the terminal can, except create a pairing code,
  change the network settings, or add a standing permission rule. Each of
  those would outlive a stolen phone's revocation. This narrows AGENTS.md
  rule 5, so the owner decides it in the design talk; the plan assumes yes.
- **The web page holds its credential in a cookie its scripts cannot
  read,** and every connection must come from Shephrd's own page.
- **Phone alerts carry no agent text.** An alert says what kind of thing
  needs the owner and which agent; the owner reads the details on the page.
  An agent's text in a notification could talk the owner into tapping
  Allow.
- **React for the web page, Ink for the pane viewer.** Both use React, so
  they share state code; Ink is React for terminals.
- **The engine's own `wait` stays agents-only.** The owner's terminal waits
  with a new `shephrd client wait`, built on the live stream, as owner
  choice A10 asked.

Full log → `decisions.md`. The contract the other two plans build on is
`contract.md`, frozen at `75ab185` with addenda `cd1d836` and `a8fcea5`.

## Workstreams

### Later pieces can add to the engine without changing it

The engine gains a registry: at start-up it accepts a list of pieces, each
with its own commands, events, views, visibility rule, background reactors
and alert sources. It also records which phone acted, gains the narrow
service caller, lets a piece queue its own kind of delivery, and lets a
piece keep an agent "not finished" while it waits on a board reply. The
risk is breaking the engine that already works; the rule that every
existing engine test passes unchanged, plus an attack pass, guards it. The
owner sees nothing new yet; the proof is a test piece that adds a command
and an event end to end.

### One definition of the whole API for every client

Each piece's commands and events are combined into one definition that the
command-line tool, the agents' tools, the web page and the pane viewer all
use. A test makes sure no two pieces use the same name, because the
library would silently let one replace the other. A client that meets an
event it does not know skips it instead of breaking.

### Reads that suit a phone

A client gets the current picture in one call, then only newer events. A
phone can ask for only some agents or some kinds of event, and still keeps
its place. A roster lists the agents, and a paged read returns one agent's
conversation. The owner's terminal can wait for agents to finish through
the same stream. The risk is a snapshot and the stream disagreeing; a test
replays the whole record and compares.

### Pairing a phone with a one-time code

The owner runs `shephrd pair` in the terminal and types the eight-character
code into the phone's browser within ten minutes. The phone gets its own
credential, which the owner can list, rename and revoke on its own;
revoking closes its connections within a second. The risk is someone
guessing a code; five wrong tries kill it.

### A web listener on the machine itself

Shephrd starts a small web server on the loopback address, which only the
machine itself can reach. It serves the web page and the API, accepts only
device credentials, checks that every connection comes from Shephrd's own
page, limits message size and connection count, and keeps idle connections
alive. The risk is another website or program using it; the origin checks
and the attack pass guard that.

### Alerts that reach the owner's phone

When the engine records that the owner is needed, or another piece raises
an alert, Shephrd records an alert, sends it to the phone, and clears it
when the matter closes. Each alert kind can be switched between "push to
the phone" and "show in the page only". The risk is an alert lost or sent
twice across a restart; the alert's record in the log prevents both.

### The web page

A phone-friendly page with three parts: a situation view (what needs the
owner, what is working, what is idle), a thread view where the owner reads
an agent's conversation, answers its requests and sends it a message, and
pages for alerts, devices and settings. Its look is decided in an owner
session from a mock. The risk is an agent's text being run as code in the
page; every agent string is shown as text, and the page forbids inline
scripts.

### Threads in a Herdr pane

`shephrd view` opens a list of agents and their threads inside a Herdr
pane, live, and lets the owner answer and prompt from there. It uses the
owner's terminal credential, with the engine's check that it is not running
inside an agent.

### Shephrd runs as its own user, then remote access

Shephrd's private files move to their own Unix user, so the agents, which
run as the owner, can no longer read the account keys and the record. Only
after that, the page is opened to the owner's phone outside the house,
through the owner's own WireGuard and reverse proxy. Both wait on the
owner's design decisions.

### Proof on a real phone

An automated test drives the whole flow in a phone-sized browser. Then the
owner pairs a real phone, answers a real permission request from it, and
reads a thread.

## Rollout order

1. **The owner answers question 1 (the seam) and the four design
   questions.** The seam unit cannot start before question 1, and units 6b,
   9 and 10 follow the design decisions.
2. **The lead adds the new packages and dependencies** in one change
   (decision row 52), and writes the new scopes (row 53).
3. **The extension seam** (units 1a, then 1b) on the `engine` branch, each
   with an attack pass. Nothing else starts until every existing engine test
   passes unchanged on top of it, because the board and roles plans build on
   it too.
4. **The shared definitions** (unit 2).
5. **Reads, pairing and the alert reactor** (units 3, 4 and 6a), which can
   be built side by side.
6. **The web listener** (unit 5), then **the web page** (units 7a to 7c)
   and **the pane viewer** (unit 8). The page and the viewer wait on the
   owner's mock session.
7. **The alert channel** (unit 6b). The owner installs the ntfy app and
   chooses a server and topic.
8. **Shephrd's own user** (unit 9). The owner runs its setup with
   administrator rights once.
9. **Remote access** (unit 10). The owner points the reverse proxy at the
   listener.
10. **The proof** (unit 11): the automated phone flow, then the owner's
    check on a real phone.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

Conventions for every unit. Paths are relative to the Shephrd repository
root. Anchors are at engine commit `8ff4c9b` (`scouting.md`). "Rows" are
rows of this plan's `decisions.md`; "engine rows" are rows of
`.plans/plans/shepherd-engine/decisions.md`. "The contract" is
`contract.md` in this folder, frozen at `75ab185` plus `cd1d836` and `a8fcea5`; where a
unit and the contract disagree, the unit reports it to the lead. A test id
is a Vitest file path, run with `pnpm vitest run <path>`; Playwright tests
run with `pnpm playwright test <path>`. Effect code is written from Effect
4.0.5's documentation or installed source, looked up, never from memory
(AGENTS.md, "Language"). Every unit records a problem it finds in
`docs/issues.md` in the same change (AGENTS.md rule 3). No unit edits
`package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml` (row 52). Tests
set their own `SHEPHRD_HOME` under `/tmp` (engine row 54). Abbreviations:
RPC (remote procedure call), MCP (Model Context Protocol), CSP (Content
Security Policy, a header that tells the browser which scripts may run),
TTL (time to live), QA (a manual check on a real host or device).

The additive rule (rows 31, 39): no existing command, event, state, reply,
rule or test changes. For every unit that touches `packages/engine`,
`packages/contracts`, `packages/client`, `packages/cli` or `packages/mcp`,
the check is: `git diff --stat engine...HEAD -- 'packages/*/test/**'` lists
only new files, and `pnpm -r test` passes.

**WS-1: Later pieces can add to the engine without changing it**

Purpose: give pieces 2 to 4 one registered way into the engine's commands,
log, views and callers, so none of them edits the engine's server or
command handler, and the record always names the real actor. Units: 1a the
registry and pieces' data; 1b callers and helpers. Contract section 6,
items 1 to 17.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | Every existing engine test, the acceptance suite and the rebuild check pass, and no existing test file changed | Command: `pnpm -r test` exits 0, and `git diff --stat engine...HEAD -- 'packages/*/test/**'` shows only added files |
| 1.2 | A test piece registered at start-up has its prefixed command served on the Unix socket, its request id replayed by the receipts, its event stored, redacted and rebuilt into its view, and its view included in the rebuild check | Test id: `packages/engine/test/extension/registry.test.ts` |
| 1.3 | Two pieces with a clashing command name or event tag stop the service at start-up with the clashing name | Test id: `packages/engine/test/extension/unique-names.test.ts` |
| 1.4 | Visibility classes: `agent-scoped`, `owner-only` (also the default) and `piece-decided` each give the owner, a device, a service, an agent and its child exactly the contract's answer | Test id: `packages/engine/test/extension/visibility.test.ts` |
| 1.5 | A piece's handler that returns an engine event the state table refuses gets its whole command refused, and nothing is written | Test id: `packages/engine/test/extension/engine-events.test.ts` |
| 1.6 | A snapshot taken at sequence N, followed by events after N, equals a full replay, for the owner and for an agent | Test id: `packages/engine/test/extension/snapshot.test.ts` |
| 1.7 | A piece's migrations create only `<namespace>_*` tables; a migration that names another table stops start-up | Test id: `packages/engine/test/extension/migrations.test.ts` |
| 1.8 | A reactor resumes after the service is killed between reading an event and writing its reaction, and writes the reaction exactly once | Test id: `packages/engine/test/extension/reactors.test.ts` |
| 1.9 | A paged read of one agent's events returns them in order from a cursor, at most the page size, with the next cursor | Test id: `packages/engine/test/extension/agent-read.test.ts` |
| 1.10 | A device's command is recorded with `caller: owner` and `device: <id>`; the owner terminal's has no `device`; a device's receipts are in the owner's scope | Test id: `packages/engine/test/extension/device-field.test.ts` |
| 1.11 | The service caller: every engine command, called as a registered service, is allowed or refused exactly as the contract's list says; `answer` accepts a one-time allow, and refuses a persistent option and an option above the asker's mode; the record's caller is `service { service, rule }` | Test id: `packages/engine/test/extension/service-caller.test.ts` |
| 1.12 | No credential format for a service exists: the socket refuses any bearer that is not an owner, device or agent credential, and an unregistered service name is refused in process | Test id: `packages/engine/test/extension/service-no-wire.test.ts` |
| 1.13 | A service's prompt is wrapped as data, its leading `/` escaped, and its sender shown as the service | Test id: `packages/engine/test/extension/service-prompt.test.ts` |
| 1.14 | A piece's delivery source: a delivery queued by a piece to a target that stops follows the piece's rule; existing sources behave as before | Test id: `packages/engine/test/extension/delivery-source.test.ts` |
| 1.15 | A registered hold-unsettled condition keeps a wait open while it holds and lets it close when it ends; with none registered, every existing wait test passes | Test id: `packages/engine/test/extension/hold-unsettled.test.ts`, plus criterion 1.1 |
| 1.16 | The settled test lives in `packages/contracts` and is re-exported from its old place | Command: `pnpm -r typecheck` exits 0; test id: `packages/contracts/test/settled.test.ts` |
| 1.17 | A piece may write `DeliveryWithdrawn` only for a delivery whose source is its own namespace and only while it is still queued; withdrawing a sent, accepted, engine-queued or other piece's delivery refuses the whole command | Test id: `packages/engine/test/extension/piece-withdraw.test.ts` |
| 1.18 | A piece's delivery is always wrapped in the engine's agent-text envelope with a fresh marker, its leading `/` escaped, and its sender shown as the piece's label; no helper sends a raw prompt | Test id: `packages/engine/test/extension/piece-delivery-text.test.ts` |
| 1.19 | A piece's delivery to a target outside the caller's tree is queued only when the piece's reach check allows it; its sender is the piece's label, never the owner, and a header built from fixed words and the authenticated caller id names each item's author, even in a merged wake with no caller; the same target stays refused for `stop`, `answer`, `compact`, `resume` and `prompt` from that caller | Test id: `packages/engine/test/extension/piece-reach.test.ts` |
| 1.20 | The reach check sees the views of the same transaction: a target that leaves the channel in an earlier command of the same batch is refused | Test id: `packages/engine/test/extension/piece-reach.test.ts` |
| 1.21 | A registered "request held" condition ends a blocking wait at open and after a batch; with none registered, every existing wait test passes | Test id: `packages/engine/test/extension/request-held.test.ts`, plus criterion 1.1 |
| 1.22 | A piece's `snapshotFor` hook can leave its section out for a caller; an agent's snapshot has no board-like test section, the owner's has it | Test id: `packages/engine/test/extension/snapshot-hook.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a.1 | The piece interface: name, namespace, group, events schema, access table, visibility table, handlers, view, migrations, reactors, alert sources, services, delivery-source rules, hold conditions | Target `packages/engine/src/extension/Piece.ts`; types in `packages/contracts/src/extension.ts` |
| 1a.2 | The service is built from the engine plus a list of pieces; names checked unique | `packages/engine/src/service.ts` (service entry); pattern `packages/contracts/src/commands.ts:CommandsRpcGroup` (`.merge`, l.135) |
| 1a.3 | Serve the composed group: replace the hard-wired group and the handler's `supported` set with the registry, keeping every engine command's path unchanged | `packages/engine/src/api/server.ts` (l.85 group choice, l.153 `toHandlers`); `packages/engine/src/commands/CommandHandler.ts` (`supported`, l.~56; `planCommand`) |
| 1a.4 | Run a piece's handler inside the command transaction, with receipts and the redactor | `packages/engine/src/commands/CommandHandler.ts` (`execute`, receipts check l.~237-257); `packages/engine/src/log/EventLog.ts` (`append`, l.247) |
| 1a.5 | The log stores namespaced events; engine views ignore foreign tags; pieces' views fold and join the rebuild check | `packages/engine/src/log/EventLog.ts` (decode on write, about l.182); `packages/engine/src/views/apply.ts`; the rebuild check in `packages/engine/test/support/` |
| 1a.6 | Visibility classes in the subscription filter | `packages/engine/src/api/server.ts:155-159` (inline `Stream.filterEffect`) |
| 1a.7 | Snapshot at a sequence; paged read of one agent's events | `packages/engine/src/log/subscribe.ts:58` (`subscribe`, `PAGE_SIZE`); views snapshot |
| 1a.8 | Pieces' migrations and reactors | `packages/engine/src/log/migrations.ts`; reactor pattern T3 `apps/server/src/orchestration-v2/DelegatedTaskQuestionReactor.ts` (engine plan 5c.1) |
| 1b.1 | Optional `device` on the envelope, set from the device credential | `packages/contracts/src/events.ts:184` (`EventEnvelope`); `CommandHandler.ts:207` |
| 1b.2 | `Actor` gains `service { service, rule? }`; the service rights table; receipts key `service:<name>`; the in-process command path | `packages/contracts/src/events.ts:8` (`Actor`); `CommandHandler.ts:45` (`Credential`), :70 (owner-only check) |
| 1b.3 | A piece's delivery source variant | `packages/contracts/src/events.ts:30` (`Delivery.source`); `packages/engine/src/routing/deliveries.ts` |
| 1b.4 | Hold-unsettled conditions; move the settled test to contracts with a re-export | `packages/engine/src/routing/waits.ts` (`settled`) |
| 1b.5 | Export the rights rule and the delivery planner for pieces, with the piece's body and sender label always enveloped (contract item 14), and the own-delivery withdrawal check (item 13) | `packages/engine/src/routing/holders.ts` (`holderAbove`); `packages/engine/src/routing/deliveries.ts` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The seam changes something the engine already does | High | Criterion 1.1 on every commit; the additive-rule check in the conventions. |
| A piece gains rights the engine would refuse | High | Criteria 1.4, 1.5, 1.11; the engine checks every engine event a piece returns; attack pass on 1a and 1b. |
| A service becomes a way in from outside | High | No service credential exists (criterion 1.12); services are registered in process only. |
| A piece's view drifts from the log | Medium | Pieces' views join the rebuild check (criterion 1.2). |
| The unit is too big for one build | Medium | Split into 1a and 1b, each with its own criteria. |

**Verify:** criteria 1.1-1.22; environment QA: none.

**Rollout detail:** rollout step 3. Unit 1a merges before 1b starts. The
board and roles plans start their engine-facing units only after 1b merges.

**WS-2: One definition of the whole API for every client**

Purpose: give every client one import for the whole API, and make clashes
and unknown events safe. Unit 2.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | Every command name and every event tag in `ApiRpcGroup` and `ApiEvent` is unique | Test id: `packages/api/test/unique.test.ts` |
| 2.2 | Every piece command and event tag starts with its namespace and a dot; no engine name contains a dot except `debug.compare-views` | Test id: `packages/api/test/names.test.ts` |
| 2.3 | Every piece command's payload, reply and error carries a non-empty `requestId` | Test id: `packages/api/test/request-id.test.ts` |
| 2.4 | A client that receives an event tag it does not know records an unknown event and moves its cursor past it | Test id: `packages/client/test/unknown-event.test.ts` |
| 2.5 | Every command in `ApiRpcGroup` is a `shephrd` subcommand, and the MCP server offers exactly the commands whose access includes `agent` | Test id: `packages/cli/test/api-parity.test.ts` (new; the engine's `parity.test.ts` is unchanged) |
| 2.6 | Every piece's stated largest event and largest page, plus the envelope, fit under the 1 MiB listener limit | Test id: `packages/api/test/size-limits.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2.1 | `packages/client-contracts`: `ClientRpcGroup` (prefixed `client.`), `ClientEvent`, `clientAccess`, `clientVisibility`, the alert types | Target `packages/client-contracts/src/`; pattern `packages/contracts/src/commands.ts`, `events.ts` |
| 2.2 | `packages/api`: `ApiRpcGroup`, `ApiEvent`, `ApiEventEnvelope`, `apiAccess` | Target `packages/api/src/index.ts`; pattern `commands.ts:CommandsRpcGroup` (`.merge`) |
| 2.3 | The client library, CLI registry and MCP tool list read `ApiRpcGroup` | `packages/client/src/index.ts:218`; `packages/cli/src/commands/registry.ts:10`; `packages/mcp/src/tools.ts:7` |
| 2.4 | Unknown-event decoding in the client's subscribe helper | `packages/client/src/index.ts` (`subscribe` helper, resume from cursor) |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A later piece's command silently replaces another | Medium | Criterion 2.1, run in `pnpm check`. |
| An older page breaks on a newer event | Medium | Criterion 2.4. |
| An owner-only piece command is offered to agents as a tool | High | Criterion 2.5. |

**Verify:** criteria 2.1-2.6; environment QA: none.

**Rollout detail:** rollout step 4.

**WS-3: Reads that suit a phone**

Purpose: let a client start from a snapshot, follow only what it needs,
list agents, page a thread, and wait, without replaying the whole log.
Contract section 3. Unit 3.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | `client.snapshot` then `subscribe` from its sequence gives the same views as a full replay, for the owner, a device and an agent | Test id: `packages/client-api/test/snapshot.test.ts` |
| 3.2 | `client.roster` returns the contract's fields, filters by group, role and parent, shows an agent itself and its children but not its grandchildren, and names its parent | Test id: `packages/client-api/test/roster.test.ts` |
| 3.3 | `client.thread` pages one agent's thread, at most 500 events a page, with `next` absent on the last page, under the visibility rule | Test id: `packages/client-api/test/thread.test.ts` |
| 3.4 | `client.subscribe` filters by agent, group and event kind; an agent that joins a group mid-stream is included from that event on; a checkpoint arrives at least every 30 seconds while events are skipped (test clock) | Test id: `packages/client-api/test/filtered-subscribe.test.ts` |
| 3.5 | `waitForAgents` with "any" and "all" finishes exactly when the engine's settled test says so, applying every registered hold-unsettled condition from the pieces' contracts | Test id: `packages/client/test/wait-for-agents.test.ts` |
| 3.6 | `shephrd client wait --block` exits with engine row 26's codes; the engine's `shephrd wait` is unchanged | Test id: `packages/cli/test/client-wait.test.ts`; criterion 1.1 |
| 3.7 | `shephrd thread export <agent> --out <file>` writes the caller's file from paged reads; the service writes no file | Test id: `packages/cli/test/thread-export.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3.1 | `client.snapshot`, `client.roster`, `client.thread`, `client.subscribe` handlers | Target `packages/client-api/src/reads/`; seam snapshot and agent read (1a.7) |
| 3.2 | `waitForAgents` helper | Target `packages/client/src/waitForAgents.ts`; settled test from `packages/contracts` (1b.4) |
| 3.3 | `shephrd client wait`, `shephrd thread export` | Target `packages/cli/src/commands/`; pattern `packages/cli/src/commands/wait.ts:reportWait` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A snapshot and the stream disagree, so the page shows a wrong state | High | Criterion 3.1. |
| A roster or thread shows an agent more than `subscribe` would | High | Criteria 3.2, 3.3 use the same visibility function. |
| A filtered stream never moves its cursor, so a reconnect re-scans | Low | Criterion 3.4. |

**Verify:** criteria 3.1-3.7; environment QA: none.

**Rollout detail:** rollout step 5.

**WS-4: Pairing a phone with a one-time code**

Purpose: add devices safely and let the owner remove any one of them.
SECURITY.md rules 3 and 4. Rows 23, 47, 48, 49. Unit 4.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | `shephrd pair` (owner only, from the host) prints an eight-character code and its expiry; the code is stored only as a SHA-256 hash, lives 10 minutes and works once | Test id: `packages/client-api/test/pairing-code.test.ts` |
| 4.2 | A connection presenting a pairing code can call only `client.pair.complete`; completing it returns a device credential once, writes `DeviceAdded` with the device name, and sets the browser cookie per row 47; the credential appears in no event, reply other than that one, or service log | Test id: `packages/client-api/test/pairing-complete.test.ts` |
| 4.3 | Five wrong codes invalidate the live code; attempts are rate-limited per connection source | Test id: `packages/client-api/test/pairing-limits.test.ts` |
| 4.4 | `client.devices` lists, renames and revokes devices; revoking writes `DeviceRevoked` and closes that device's open connections within one second, leaving others open | Test id: `packages/client-api/test/devices.test.ts` |
| 4.5 | The host-only commands (create a pairing code, change listener settings, add a standing rule) are refused for a device | Test id: `packages/client-api/test/host-only.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 4.1 | Pairing codes in a `client_pairing_codes` side table, hashed; attempts counted | Target `packages/client-api/src/pairing/`; pattern `packages/engine/src/identity/credential.ts:sha256Hex` (l.62) |
| 4.2 | Device minting and storage through the seam | `packages/engine/src/identity/devices.ts:mintDeviceCredential` (l.12); `EventLog.ts` `sideRows.devices` (l.202-204), `revokeDevices` (l.199-200) |
| 4.3 | Revocation closing connections | `packages/engine/src/api/server.ts:119-126` (re-check on each batch and every 100 ms) |
| 4.4 | `shephrd pair`, `shephrd devices` | Target `packages/cli/src/commands/`; generated from `ApiRpcGroup` (2.3) |

**Design artifact:** the pairing screen is part of WS-7's mock.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A code is guessed | High | 40 bits, five attempts, ten minutes (row 48); criterion 4.3; attack pass. |
| A stolen phone adds more devices | High | Pairing codes are host-only (criterion 4.5, row 55, pending the owner). |
| A credential leaks into the record | High | The redactor registers device credentials (`service.ts:87`); criterion 4.2. |

**Verify:** criteria 4.1-4.5; environment QA: none.

**Rollout detail:** rollout step 5.

**WS-5: A web listener on the machine itself**

Purpose: serve the web page and the API to devices, on loopback by default,
with the checks a browser needs. SECURITY.md rules 1, 2, 5. Rows 14, 36,
40, 47. Unit 5.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | The listener binds `127.0.0.1` on the configured port by default; binding any other address is refused unless unit 10's setting allows it | Test id: `packages/client-api/test/listener-bind.test.ts` |
| 5.2 | It accepts device credentials and pairing codes only; the owner credential and agent tokens get HTTP 401 before any RPC message | Test id: `packages/client-api/test/listener-auth.test.ts` |
| 5.3 | A WebSocket upgrade whose `Origin` or `Host` is not on the allow-list is refused with HTTP 403 | Test id: `packages/client-api/test/listener-origin.test.ts` |
| 5.4 | The browser cookie is `HttpOnly`, `SameSite=Strict`, `Path=/`, and `Secure` when the request came over HTTPS; a non-browser client may send `Authorization: Bearer` | Test id: `packages/client-api/test/listener-cookie.test.ts` |
| 5.5 | A message over 1 MiB closes the connection | Test id: `packages/client-api/test/listener-size.test.ts` |
| 5.6 | A heartbeat is sent at the configured interval, 25 seconds by default | Test id: `packages/client-api/test/listener-heartbeat.test.ts` |
| 5.7 | Static files are served with `Content-Security-Policy: default-src 'self'; script-src 'self'; frame-ancestors 'none'` and no inline script | Test id: `packages/client-api/test/listener-static.test.ts` |
| 5.8 | Connections are capped per device and in total | Test id: `packages/client-api/test/listener-limits.test.ts` |
| 5.9 | A test piece's command works over the listener with no listener code of its own | Test id: `packages/client-api/test/listener-generic.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5.1 | The HTTP server: static files and the WebSocket RPC on one port | Target `packages/client-api/src/listener/`; pattern `packages/engine/src/api/server.ts` (`listen`, l.52; `makeProtocolWithHttpEffectWebsocket`, l.128; `boundedProtocol`, l.130); Effect `http/HttpStaticServer.ts:layer` (l.242) |
| 5.2 | Authentication at upgrade: cookie or bearer, device or pairing code | `server.ts:authenticate` (l.87); Effect `HttpServerResponse.setCookie` (l.732) |
| 5.3 | Origin and Host allow-lists, size limit, heartbeat, connection caps | Target `packages/client-api/src/listener/guards.ts` |
| 5.4 | Listener settings (port, allow-lists, heartbeat) as host-only commands | Target `packages/client-api/src/settings.ts` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Another website uses the owner's cookie (cross-site WebSocket hijacking) | High | `SameSite=Strict` and the Origin check (criteria 5.3, 5.4); attack pass. |
| A local program reaches the listener without pairing | High | Device credentials only (criterion 5.2). |
| A slow or huge client exhausts memory | Medium | Criteria 5.5, 5.8, and the engine's backlog bound (issue 41). |

**Verify:** criteria 5.1-5.9; environment QA: none.

**Rollout detail:** rollout step 6.

**WS-6: Alerts that reach the owner's phone**

Purpose: turn "owner needed" and other pieces' alert sources into
recorded alerts, push them, and clear them. Contract section 4. Rows 18,
19, 20, 28, 35, 41. Units: 6a the reactor; 6b the channel.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | Each of the engine's three `OwnerNeeded` producers, provoked in a test service, raises an alert of the contract's kind; an unknown reason raises kind `other` | Test id: `packages/client-api/test/alert-sources.test.ts` |
| 6.2 | One alert is open per key; each kind clears on the contract's closing event; `client.alerts.dismiss` clears one | Test id: `packages/client-api/test/alert-life.test.ts` |
| 6.3 | Killing the service between an event and its alert gives exactly one alert after restart | Test id: `packages/client-api/test/alert-reactor-restart.test.ts` |
| 6.4 | A test piece's alert source raises and ends its own kind | Test id: `packages/client-api/test/alert-piece-source.test.ts` |
| 6.5 | An agent string planted in a request, a question and a crash appears in no `AlertRaised` event and no pushed payload; the agent's name travels in its own field, with control and formatting characters and line breaks removed, cut to 64 characters, never inside the title | Test id: `packages/client-api/test/alert-no-agent-text.test.ts` |
| 6.6 | Each kind's push setting has the contract's default and can be changed by the owner and a device | Test id: `packages/client-api/test/alert-settings.test.ts` |
| 6.7 | ntfy: an alert is posted to the configured server and topic with its title, kind, agent name and link; the access token comes from the secrets store by reference | Test id: `packages/client-api/test/alert-ntfy.test.ts` (against a local fake ntfy server) |
| 6.8 | A failed push is recorded as `client.AlertDeliveryFailed`, retried with backoff a bounded number of times, and never stops the reactor | Test id: `packages/client-api/test/alert-ntfy-retry.test.ts` |
| 6.9 | The ntfy token appears in no event and no service log | Test id: `packages/client-api/test/alert-ntfy-secret.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6a.1 | The alert reactor, alert events, the key and closing tables, dismiss, settings | Target `packages/client-api/src/alerts/`; producers `packages/engine/src/routing/holders.ts:49`, `recovery/crash.ts:69`, `routing/deliveries.ts:194` |
| 6b.1 | The channel interface and the ntfy channel | Target `packages/client-api/src/alerts/channels/ntfy.ts`; secret references per engine row 19 (`secrets.json`) |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An alert is lost or sent twice across a restart | High | Criterion 6.3. |
| Agent text in a notification steers the owner | High | Criterion 6.5; titles come from a fixed table. |
| A public ntfy topic reveals alert titles | Medium | Titles hold no thread text; the owner may use a self-hosted server or an access token (design question 2). |

**Verify:** criteria 6.1-6.9; environment QA: on the owner's phone, an alert from rollout step 7 arrives (unit 11).

**Rollout detail:** 6a at rollout step 5; 6b at step 7, after the owner picks a server and topic.

**WS-7: The web page**

Purpose: give the phone and any browser the owner's view: what needs the
owner, every thread, and the answer and prompt actions. Units: 7a shell,
pairing and situation view; 7b thread view, answering and prompting; 7c
alerts, devices and settings.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 7.1 | The pairing screen completes pairing against a test service and lands on the situation view | Test id: `packages/web/test/pairing.test.tsx` |
| 7.2 | The situation view sorts agents into "needs you", "working" and "idle" from snapshot and stream, and resumes from its cursor after a dropped connection | Test id: `packages/web/test/situation.test.tsx` |
| 7.3 | At 360 pixels wide, no page scrolls sideways | Test id: `packages/web/e2e/layout.spec.ts` (Playwright) |
| 7.4 | The thread view shows text, plans, tool calls, file changes and requests; a planted `<img src=x onerror=...>` in agent text is shown as text and runs nothing | Test ids: `packages/web/test/thread.test.tsx`, `packages/web/test/agent-text.test.tsx` |
| 7.5 | Answering a request sends one `answer` with one request id; a double tap acts once | Test id: `packages/web/test/answer.test.tsx` |
| 7.6 | The owner can prompt an agent from the thread view | Test id: `packages/web/test/prompt.test.tsx` |
| 7.7 | The alerts page lists open and cleared alerts, and a tap opens the alert's subject | Test id: `packages/web/test/alerts.test.tsx` |
| 7.8 | The devices page lists and revokes devices, and shows no "create pairing code" on a device | Test id: `packages/web/test/devices.test.tsx` |
| 7.9 | An unknown event does not break any page | Test id: `packages/web/test/unknown-event.test.tsx` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 7a.1 | Vite and React app; the RPC client over a browser WebSocket; pairing; situation view | Target `packages/web/src/`; Effect `socket/Socket.ts:layerWebSocketConstructorGlobal` (l.877), `rpc/RpcClient.ts:layerProtocolSocket` (l.1293); pattern Synapse `web/` (research, "The web server skeleton") |
| 7b.1 | Thread view, answering, prompting | Target `packages/web/src/thread/`; events from `ApiEvent` |
| 7c.1 | Alerts, devices, settings pages | Target `packages/web/src/admin/` |

**Design artifact:** mock gate: owner session. The mock must decide: the
situation view's lanes and what each row shows; how a permission request's
options are laid out on a phone (Allow once, Deny, and whether "allow
always" appears at all); how a long tool call or file change is folded;
the thread view's prompt box; and the alerts, devices and settings pages.
No unit of WS-7 starts before the owner approves the mock.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Agent text runs as code in the page (cross-site scripting) | High | Criterion 7.4; React text rendering only, no raw HTML; the CSP of criterion 5.7. |
| A double tap answers twice | Medium | Criterion 7.5. |
| The page is unusable on a phone | Medium | Criterion 7.3; the mock gate. |

**Verify:** criteria 7.1-7.9; environment QA: the owner's real phone in unit 11.

**Rollout detail:** rollout step 6.

**WS-8: Threads in a Herdr pane**

Purpose: read and answer threads where the owner already works (lead ruling
L4, row 46). Unit 8.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 8.1 | `shephrd view` lists agents, opens a thread, and updates live | Test id: `packages/viewer/test/view.test.tsx` (Ink's test renderer) |
| 8.2 | The owner can answer a request and prompt an agent from the viewer; terminal control characters in agent text are stripped | Test id: `packages/viewer/test/actions.test.tsx` |
| 8.3 | The viewer uses the owner credential over the Unix socket, and is refused when run inside an agent's process tree | Test id: `packages/viewer/test/identity.test.ts` |
| 8.4 | A Herdr plugin action opens the viewer in a pane | On-host step: `herdr plugin action list --plugin shephrd` lists `view`; running it opens a pane showing the agent list |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 8.1 | The Ink app over `packages/client` | Target `packages/viewer/src/`; client `packages/client/src/index.ts:connect` (l.117); control-character stripping per engine criterion 7.7 (`packages/cli/test/control-chars.test.ts`) |
| 8.2 | The plugin action | `herdr-plugin.toml` (`[[actions]]`); post-build check PB-3 |

**Design artifact:** mock gate: owner session, in the same session as
WS-7. The mock must decide the pane's layout at Herdr's usual pane sizes
and its keys for moving, answering and prompting.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Agent text moves the cursor or rewrites the terminal | Medium | Criterion 8.2. |
| An agent runs the viewer to act as the owner | High | The engine's ancestry check (criterion 8.3). |

**Verify:** criteria 8.1-8.4; environment QA: criterion 8.4 on the owner's Herdr host.

**Rollout detail:** rollout step 6.

**WS-9: Shephrd runs as its own Unix user** (pending design question 3, row 42)

Purpose: move the state folder, the account keys and the record out of the
agents' reach before remote access opens the page to the network.
SECURITY.md, "What Shephrd protects". Unit 9.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 9.1 | `shephrd setup own-user`, run once with administrator rights, creates the `shephrd` user and group, moves the state folder, and installs the service to run as that user | On-host step: the command exits 0, and `stat -c '%U %a' <state folder>` prints `shephrd 700` |
| 9.2 | A process running as the owner cannot read `secrets.json`, the event database or the devices table | On-host step: `scripts/own-user-check.sh` exits 0 |
| 9.3 | The owner's `shephrd` command still connects, through the socket's group permission, and the ancestry check still applies | Test id: `packages/cli/test/own-user-socket.test.ts`; on-host step: `shephrd client roster` succeeds as the owner |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 9.1 | Setup command, state-folder move, socket group permission | Target `packages/cli/src/commands/setup.ts`; state folder resolution `packages/engine/src/identity/ownerCredential.ts` (l.105), client `packages/client/src/identity.ts:48` |
| 9.2 | The check script | Target `scripts/own-user-check.sh` |

**Design artifact:** none. The unit's own design (where the owner
credential lives, how Herdr starts a service under another user) is
settled in the design note before the unit starts.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The service cannot start after the move | High | A dry-run mode and a reverse command; criterion 9.1. |
| The owner credential is still readable by agents | Medium | Accepted limit per SECURITY.md; the ancestry check stays; recorded as a known gap. |

**Verify:** criteria 9.1-9.3; environment QA: on the owner's host.

**Rollout detail:** rollout step 8; the owner runs the setup command.

**WS-10: Remote access from outside the house** (pending design question 1, row 40)

Purpose: let the phone reach the page through the owner's own WireGuard
and reverse proxy, with TLS at the proxy. SECURITY.md rule 5. Unit 10.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 10.1 | In proxy mode, the listener accepts the configured public Host and Origin, requires the proxy's `X-Forwarded-Proto: https`, and sets the cookie `Secure` | Test id: `packages/client-api/test/listener-proxy.test.ts` |
| 10.2 | Binding a non-loopback address is allowed only for an address on a WireGuard interface, and plain HTTP is never offered to it without the proxy | Test id: `packages/client-api/test/listener-bind-remote.test.ts` |
| 10.3 | `docs/remote-access.md` describes the proxy and WireGuard setup with one example | Command: `test -s docs/remote-access.md` |
| 10.4 | From a phone on mobile data, through the owner's proxy, the page opens and shows the situation view | On-device step: owner's phone, rollout step 9 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 10.1 | Proxy mode settings and checks | Target `packages/client-api/src/listener/proxy.ts`; WS-5's guards |
| 10.2 | The setup document | Target `docs/remote-access.md` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The API is exposed without encryption | High | Criteria 10.1, 10.2; attack pass. |
| A spoofed forwarding header from a local program | Medium | Proxy headers are trusted only from the configured proxy address. |

**Verify:** criteria 10.1-10.4; environment QA: the owner's phone.

**Rollout detail:** rollout step 9, after unit 9.

**WS-11: Proof on a real phone**

Purpose: show the epic's second "done when" end to end. Unit 11.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 11.1 | In a phone-sized headless browser: pair with a code, see a fake agent's permission request, answer it, see the agent released, read the thread, and see the alert reach a fake ntfy server | Test id: `packages/web/e2e/phone-flow.spec.ts` |
| 11.2 | The owner pairs a real phone, gets a real alert, answers a real permission request from it, and reads the thread | On-device step: the owner's phone, recorded in the run's result file |

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

**Rollout detail:** rollout step 10.

Post-build checks (code-level worries a plan cannot settle):

- PB-1: confirm Effect 4.0.5's Node HTTP server lets the listener set the
  WebSocket message size limit (criterion 5.5); if not, enforce it in the
  protocol wrapper, as `boundedProtocol` does for backlogs.
- PB-2: confirm a browser sends the `SameSite=Strict` cookie on the page's
  own WebSocket upgrade behind the owner's proxy.
- PB-3: confirm how a Herdr plugin action opens a new pane (Herdr 0.9.x
  plugin manual) before unit 8's action is written.

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: epic `shepherd-foundation` row 2 and its second "done
when"; the engine design's capabilities 6, 8 and 9 and "What this spec
leaves open" (client API); `docs/features.md` section 3 ("Threads where the
owner already works") and section 4; `docs/research/t3-code.md` items 9 to
12; `docs/issues.md` issues 65, 75 and 164; owner choice A10; lead rulings
L1 to L4, L10, L11, L13, L15 and L16; the roles planner's requests 1 to 6 and the board
planner's R1 items 1 to 6; SECURITY.md security rules 1 to 7.

| Source item | Workstream | Status |
|---|---|---|
| Epic row 2: device pairing | WS-4 | planned |
| Epic row 2: phone alerts | WS-6 | planned |
| Epic row 2: encrypted remote access | WS-9, WS-10 | planned, pending design questions 1 and 3 |
| Epic row 2: the web page | WS-5, WS-7 | planned |
| Epic row 2: thread viewer in a Herdr pane | WS-8 | planned |
| Epic done-when 2: answer and read from a paired phone | WS-11 | planned |
| Engine capability 6: read any thread live from any client | WS-3, WS-7, WS-8 | planned |
| Engine capability 8: owner needed becomes a phone alert | WS-6 | planned |
| Engine capability 9: talk to any agent remotely | WS-7, WS-10 | planned |
| Engine design: client API needs its own design round | rows 8, 40-43; design note after the decisions | in progress |
| Features §3: threads where the owner already works (pane viewer) | WS-8 | planned |
| Features §3: VS Code extension | none | out of scope (row 51) |
| Features §4: one authenticated API for every client | WS-1, WS-2, WS-5 | planned |
| Features §4: device pairing | WS-4 | planned |
| Features §4: live updates | WS-3 | planned |
| Features §4: updates that survive a sleeping phone | WS-3, WS-5 (heartbeat) | planned |
| Features §4: browser terminal | none | out of scope (lead L2, row 5) |
| Features §4: four phone alerts | WS-6 | planned |
| Features §4: Shephrd runs as its own user | WS-9 | planned, pending design question 3 |
| Features §4: macOS support | none | out of scope (owner, 2026-11-01, Linux only) |
| Features §4: herding names | none | shelved by the owner |
| Research item 9 | WS-3 | planned |
| Research item 10 (browser terminal) | none | out of scope (row 5) |
| Research item 11 | WS-6 | planned |
| Research item 12 (signed links) | WS-6 | not adopted, pending design question 4 (row 43) |
| Issue 65 (owner alert withdrawal) | WS-6 | planned (derived ends, row 18) |
| Issue 75 (no owner waiter) | WS-3 | planned (client wait, rows 4, 50) |
| Issue 164 (agent-less events hidden from agents) | WS-1 | stands (contract section 3) |
| Owner choice A10 | WS-3 | planned |
| Lead L1 | WS-3 | planned |
| Lead L2 | none | out of scope |
| Lead L3 | WS-7 (phone uses the page) | planned |
| Lead L4 | WS-8 | planned |
| Lead L10 | WS-1 (criterion 1.15) | planned |
| Lead L11 | WS-1 (criteria 1.17, 1.18) | planned |
| Lead L13 | WS-1 (criterion 1.19) | planned |
| Lead L15 | WS-1 (1.17, 1.20-1.22), WS-2 (2.6), WS-3 (3.5), WS-6 (6.5) | planned |
| Lead L16 | WS-1 (criterion 1.19) | planned |
| Roles requests 1-6 | WS-1, WS-3, WS-6; contract section 7 | planned |
| Board R1 items 1-6 | WS-1, WS-2, WS-5, WS-6; contract section 7 | planned |
| SECURITY.md rules 1-7 | Guardrails fold | planned |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| AGENTS.md rule 1: never push to `vitalysim/herdr-synapse` | Every unit pushes to `qnlbnsl/sheprd` only. |
| AGENTS.md rule 2: credit copied code | No code is copied in this plan. A unit that copies any (for example from Synapse's web page) follows rule 2 under `third_party/`. |
| AGENTS.md rule 3: keep the lists current | Each unit records problems in `docs/issues.md`; this planner's finds go to the lead in the result file. |
| AGENTS.md rule 4: SECURITY.md is binding | Rule 1: WS-5 criterion 5.1. Rule 2: rows 14, 49; criteria 5.2, 4.2. Rule 3: row 48; criteria 4.1, 4.3. Rule 4: criterion 4.4. Rule 5: WS-10; criterion 10.2. Rule 6: criteria 4.2, 6.5, 6.9. Rule 7: rows 19, 37; criteria 1.13, 7.4. |
| AGENTS.md rule 5: the API is the product's surface | Every owner action is an API command; devices have the owner's rights except the host-only list (row 55, pending the owner); `shephrd client wait` runs on the API (row 50). |
| AGENTS.md rule 6: team shapes do not belong here | No team shape or workflow is defined; alert kinds and services are mechanisms. |
| AGENTS.md rule 7: commit only when asked | The run's team rules allow commits; units commit per the lead. |
| AGENTS.md, "Language": TypeScript, Effect 4, Node.js 26 | All code is TypeScript with Effect 4.0.5; Effect claims checked against the installed source (rows 24, scouting). |
| AGENTS.md, "How agents are run": one delivery interface | The client API reads events and roster fields that do not depend on run mode; piece deliveries go through the engine's delivery path (seam item 11). |
| Engine design: built on the engine without changing it | The additive rule (row 31), pending the owner. |
| Run team rule 6: scope | This planning run writes only the plan folder and, later, the design note. |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its harness-session skill)
at launch; this section names none (owner, 2026-10-16).

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1a Seam: registry, pieces' commands, events, views, visibility, snapshot | backend | engine/backend | high | Changes the engine's only entry point and its log, under a rule that nothing existing may change. | yes | owner question 1, rollout step 2 |
| 1b Seam: device field, service caller, delivery source, hold conditions, helpers | backend | engine/backend | high | Adds a caller kind and authorization rules. | yes | 1a |
| 2 Composed contracts and client parity | contracts | client-api/contracts | medium | New schema packages on the engine's existing pattern. | no | 1b |
| 3 Reads, filtered stream, client wait | backend | client-api/backend | medium | Handlers over the seam's snapshot and read, with a shared visibility function. | no | 2 |
| 4 Pairing and devices | backend | client-api/backend | high | Authentication and credential creation. | yes | 2 |
| 5 Loopback web listener | backend | client-api/backend | high | A new network entry point with browser authentication. | yes | 4 |
| 6a Alert reactor and alert events | backend | client-api/backend | medium | A reactor on the seam's pattern, with fixed mapping tables. | no | 2 |
| 6b ntfy channel | backend | client-api/backend | medium | One outbound HTTP channel with retries and a secret reference. | no | 6a, design question 2 |
| 7a Web page: shell, pairing, situation view | mobile-ui | client-api/mobile-ui | medium | A new screen set from an approved mock. | no | 5, mock session |
| 7b Web page: thread view, answer, prompt | mobile-ui | client-api/mobile-ui | medium | Screens from the mock, rendering untrusted text as text. | no | 7a |
| 7c Web page: alerts, devices, settings | mobile-ui | client-api/mobile-ui | medium | Screens from the mock over existing commands. | no | 7a, 6a |
| 8 Pane viewer | mobile-ui | client-api/mobile-ui | medium | A terminal screen set over the client library. | no | 3, mock session |
| 9 Own Unix user | infra | client-api/infra | high | Moves secrets and changes how the service runs on the host. | yes | 5, design question 3 |
| 10 Remote access through the owner's proxy | backend | client-api/backend | medium | Settings and checks on top of unit 5's guards. | yes | 9, design question 1 |
| 11 Phone flow and owner check | backend | client-api/backend | medium | One end-to-end test plus an owner step. | no | 6b, 7b, 10 |

Load: 15 build units. At the sheet's builder, test writer and focused
reviewer for each unit, that is 45 launches, plus 12 for the six attack
passes (one attacker and one verifier each), 57 in all. From the sheet's
tables: the medium backend and contracts units (2, 3, 6a, 6b, 10, 11) build
on the OpenAI vendor; the medium `mobile-ui` units (7a, 7b, 7c, 8) build on
the Anthropic vendor; the provisional high backend and infra units (1a, 1b,
4, 5, 9) alternate between the two. That is roughly 8 to 9 builds on
OpenAI and 6 to 7 on Anthropic, with test writers and reviewers on the
other vendor, and the attackers on the sheet's attack tier: about 27 to 29
OpenAI and 28 to 30 Anthropic launches. The planner cannot read the
remaining weekly allowance; the lead checks each vendor's limit before
launching (known gap).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|
| — | — | Not run yet. The lead starts the four lenses when the plan is frozen. |

</details>
