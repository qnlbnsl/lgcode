---
topic: lgtm-foundry-roles
status: attack
tier: L
created: 2026-11-03
updated: 2026-11-03
epic: lgtm-foundation
---

# Build the foundry roles and the stall watch

## Overview

This plan builds the fourth of LGTM Studio's pieces: the roles that let the
owner's Foundry run its teams through LGTM Studio alone. The Foundry is the
owner's method for running teams of coding agents: an orchestrator, a lead
for each area of work, and workers. Today it starts agents with Herdr
commands, approves their prompts by pressing keys in their panes, and keeps
them moving with five shell scripts that read the agents' screens. The
engine, piece 1, already starts, prompts, waits on, stops and resumes agents
through one authenticated connection. What it leaves out, on purpose, is
the rules for each role, the standing permission rules, and the decision to
retry, replace or give up on a failing agent. This plan adds those three.

The first addition is the roles. LGTM Studio learns three kinds of agent: the
orchestrator, a team lead and a worker. Each agent's role names its kind
and, optionally, the team's own name for it, such as `worker:builder`. The
team's own definitions, such as how many workers a lead runs or what a
reviewer is told, stay outside this repository, as the project rules
require. In this version a role's rules are advice. An agent asks LGTM Studio
"who am I" and gets its role, its parent, its children and its role's
rules. The stall watch reports an agent that breaks one to its parent, and
LGTM Studio does not refuse the action. The lead ruled this on 2026-11-03, and
enforcement is recorded as a later idea.

The second addition is standing permission rules. Today a lead answers each
worker's "may I run the tests?" by reading the pane and pressing a key. The
engine already sends that request to the lead as a message, but every
request still costs the lead a turn, and a lead's turn re-reads its whole
context. A standing rule is an owner-approved rule such as "allow exactly
`pnpm test`, run by the shell tool in the worker's own folder". LGTM Studio
answers a matching request by itself with a one-time allow, before the lead
is woken, and the record names the rule that answered. A rule matches only
the harness's own shell tool, only the exact command the owner wrote, and
only plain letters, digits and a few punctuation marks. It never matches a
request that asks to run outside the harness's sandbox, to save a
permission, or to edit a settings file. A rule cannot stop an agent that may
edit files from changing what `pnpm test` runs, so by default a rule applies
only to agents that must ask before they edit. Only the owner adds or
removes a rule, and the owner's phone is told the first time each rule is
used. Standing rules need the first of the engine changes described below.
Without it, the owner can write rules, but nothing is answered by them.

The third addition is the stall watch. It is a small part of the LGTM Studio
service that watches the record of events and keeps every agent moving
without spending their turns. It replaces the Foundry's scripts. It tells a
lead's parent when the lead's team has had nothing running for an hour. It
retries a message five minutes after a "model at capacity" error. It resumes
a crashed agent once, tells it to carry on, and then gives up. It wakes a
worker that sits on an unanswered message, then tells its lead, and tells
the lead to replace a worker that stalls three times. A worker that is
waiting on another agent's answer is not stalled. Just before an idle Claude
agent's prompt cache expires, it delivers any messages waiting for that
agent, or compacts the agent's context, because that is when both are
cheapest. It never decides what the work is. When a worker is replaced,
LGTM Studio builds the replacement's first message from the record of what the
old worker did, so no model turn is spent writing a summary. The owner can
switch the stall watch and the standing rules off from any client.

Two other plans were written at the same time, and this one builds on both
of their contracts, which are now frozen. The client API plan adds one
extension point to the engine. Through it the roles add their own commands
and events, and the stall watch acts as a narrow "service" caller whose actions
the record names as the stall watch's, not the owner's. The client API also
lets an agent list its own team. The message board lets the stall watch post
a notice that no agent can forge, and deliver an agent's waiting messages
at a chosen moment.

One owner decision is open. The lead sent the owner one question on
2026-11-03: the client API plan's extension point, plus three small engine
changes for this plan. The first review round changed two of the three, and
the lead has been asked to send the owner the amended version. The first
change records which tool asked for a permission and exactly what it will
run, and checks standing rules before the request reaches the lead, so the
lead is not woken at all. The second holds a message that met a "model at
capacity" error in its queue, so neither the agent nor its lead is woken
for each one, and adds one command that releases it. The third records how
large each agent's context is, so compaction can be timed for every
harness, not only Claude. The recommendation is to allow these and nothing
more, under the rule that nothing the engine already does changes. If the
owner declines the three changes, the other workstreams still work, but
standing rules answer nothing and some wakes remain. If the owner declines
the extension point itself, both contracts and this plan are rewritten
first.

## Key decisions

- **The roles plug into the engine through one extension point, without
  changing what the engine does.** Pending the owner. The roles add their
  own commands and record their own events through it. The stall watch runs
  inside the LGTM Studio service as a narrow caller that can nudge, compact,
  resume, post notices and release held messages, and nothing else. After a
  restart it reads the record again and knows everything it knew before.
- **Role rules are advice in this version.** The lead's ruling of
  2026-11-03. A confused agent can still do something its role should not,
  but its parent is told. Enforcement can be added later.
- **Standing rules allow one exact shell command at a time.** The lead's
  ruling of 2026-11-03. A rule answers with "allow once" for the shell tool
  only, for the exact words the owner wrote, in the asker's own folder.
  Any character outside a short safe list, any extra word, and any request
  to leave the sandbox means no match. The cost is that the owner writes a
  rule per command, and that rules need the first engine change.
- **The stall watch tells the parent; the parent acts.** It wakes an agent,
  retries a capacity error and resumes a crash once by itself. Replacing a
  worker or giving up is reported to the nearest ancestor that can act,
  which decides. This follows the owner's words of 2026-10-25: "tell the
  lead to recreate it". A matter that reaches the owner becomes a phone
  alert.
- **"Stalled" means an unanswered message and nothing else to wait for.**
  The board does not track work states, so a worker counts as stalled when
  it sits idle with a message that needs its reply, and it is not waiting
  on any other agent. Three stalls on the same message, with no file change
  or post between them, is the signal to replace it.
- **Every limit is a setting, within fixed bounds.** The defaults come from
  the Foundry's own scripts and the owner's earlier words: an hour of team
  idleness, five minutes between capacity retries, ten minutes before a
  worker's unanswered message counts as a stall, two hours for a runaway
  turn or a long-lived worker. The owner can change each from any client,
  inside a minimum and a maximum.
- **Open: the extension point and three engine changes.** Pending the
  owner. The three changes sit in one workstream that is dropped if the
  owner declines them.

Full log → `decisions.md`

## Workstreams

### Agents know their role, their team and their rules

An agent can ask LGTM Studio who it is and get back its role, its parent, its
children and their states, its count of open requests and questions, and
its role's advice, from the command line or as a tool. This replaces
Synapse's `orient` and the Foundry's habit of pasting the same facts into
every brief. The team's role file, kept outside this repository, supplies
the advice text and the limits for each role. The owner loads it from any
client. The risk is a role file used to grant something. The role file's
format has no field that can grant a permission, and LGTM Studio refuses a file
that tries. Done when an agent started as `worker:builder` reads its parent
and its role's advice through `orient`.

### Routine permission requests are answered by owner-approved rules

The owner adds a rule such as "Codex workers may run exactly `pnpm test` in
their own folder". When a request matches, LGTM Studio answers it once, the
record names the rule, and the lead is not asked. The main risk is a rule
that allows more than the owner meant. The matcher refuses any other tool,
any extra word, any unusual character, any request to leave the sandbox,
settings writes, persistent answers, and anything above the asker's mode or
outside its folder. A dedicated attack review checks it. Done when a
worker's matching request is answered by the rule, and requests for
`pnpm test & rm -rf ~` and `pnpm test -- --config x` are not.

### A stall watch keeps every agent moving

The stall watch runs inside the LGTM Studio service, reads the record of events,
and acts through its narrow caller. It is the base the next workstreams'
rules sit on. The risk is a stall watch that nudges the same agent twice after
a restart. Every action it takes is itself recorded, so it reads its own
past actions when it starts and does not repeat them. Done when a service
restarted in the middle of a team's run sends no duplicate nudge, and a
stall watch switched off sends nothing.

### Stalls, crashes and capacity errors are handled without the owner

The stall watch's rules cover a team with nothing running for an hour, a
worker sitting on an unanswered message, the third such stall, a turn or a
worker that runs past two hours, a "model at capacity" error, a crash, and
an agent that breaks its role's advice. Usage-limit pauses never count as
stalls, because the engine already resumes those agents when the limit
resets. The risk is noise: a lead that is told too often stops reading.
Each notice is sent once per event and repeats at most hourly, and the
owner can snooze a team. Done when each rule fires once in its test and
stays quiet in a team that is paused or rightly waiting on another agent.

### Waiting messages and compaction are timed to the prompt cache

Two minutes before an idle Claude agent's prompt cache expires, the
stall watch delivers the messages waiting for it, if there are any, so they
are read at the cheap cached price. If there are none and its context is
large, it asks the agent to compact. The risk is compacting an agent that
is about to receive work. The stall watch skips any agent with something
queued, open or waiting, and it schedules nothing when it cannot tell when
the cache expires. Done when a test shows the delivery or the compact
request two minutes before the computed expiry, and neither for a busy
agent.

### A replacement worker starts from what the old one did

When a lead replaces a worker, LGTM Studio builds the replacement's first
message from the record: the original brief, the last exchange, the
commands it ran and the files it changed, each shortened, with pointers to
the rest. No model turn is spent writing it. The risk is a hand-off that
leaves out the one thing that mattered. It keeps the brief and the last
exchange whole when they fit, cuts them with a clear marker when they do
not, and says where to read what it left out. Done when the hand-off
command returns a hand-off under both its limits, for a small thread and
for one with a very long brief.

### Three small engine changes, if the owner allows them

If the owner agrees, the engine records which tool asked for a permission
and what it will run, and asks the roles' rule matcher before it delivers
the request. It holds a message that met a capacity error in its queue
instead of returning it to the lead, until the stall watch releases it. It
records each turn's token and cache usage. The risk is the same as any
engine change: a regression in a part that is already reviewed. Each
change keeps every existing engine test passing unchanged and adds its
own. If the owner says no, this workstream is dropped and the fallbacks in
the other workstreams apply.

### Proof that the Foundry needs nothing else

A written recipe maps each of the Foundry's Steps 3 to 5 and 8 onto
LGTM Studio's commands. An acceptance test runs a whole Foundry-shaped team
with fake agents through LGTM Studio's public connection alone: an
orchestrator, two leads and their workers, with a standing rule, a stall, a
capacity error, a crash and a wrap-up. A check by hand runs the same flow on
real Claude Code and Codex agents. The Foundry skill itself lives in another
repository, so changing it to use the recipe is the last step, done by the
owner or the manager. Done when the acceptance test passes and the recipe
uses no `herdr agent` command, `collect.sh` or `board-waker.sh`.

## Rollout order

1. **Wait for the extension point.** The client API plan builds it as its
   first unit, once the owner agrees. Until then, the parts with no
   connection to the engine can be built: the role names, the role file
   format, the rule matcher and the hand-off builder. The owner also
   records one short shell-permission sample for each harness, which the
   matcher is checked against.
2. **Build the roles' commands and events,** then `orient` and the
   standing-rule commands, once the extension point and the client API's
   roster have merged.
3. **Build the stall watch's base, then its rules.** The rules that send
   notices need the board's post, flush and status commands, so they follow
   the board's first units.
4. **Build the three engine changes, if the owner allowed them,** each in
   its own pull request into `engine`. Without them, the fallbacks ship,
   and standing rules answer nothing.
5. **Run the acceptance test, then the check by hand.** The check by hand
   spends usage on the owner's accounts, so it runs once, before the owner
   switches the Foundry over.
6. **Switch the Foundry over.** The owner or the manager rewrites the
   Foundry skill's Steps 3 to 5 and 8 from the recipe, in the Founder OS
   repository. Until then the old scripts keep working, because nothing in
   this plan removes them. If the roles must be stopped later, the owner
   switches them off; the engine is never downgraded to a version without
   them once they have written to the record.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

**Sources this plan builds on.** "CAPI §n" is the client API contract,
`.plans/plans/lgtm-client-api/contract.md` on `worker/plans-api` at
`586a7ff` (v2 frozen at `75ab185`, with seam items 12 to 17 and lead rulings
L15, L16, L19 and L22; decision rows 21, 32, 33, 52). "Board" is the message board
contract v3, `.plans/plans/lgtm-message-board/contract.md` on
`worker/plans-board` at `07b3386` (rows 29, 31, 33), with lead ruling L17's
service-to-agent direct pair (row 34). Both assume the extension seam
(CAPI §6), which is pending the owner (rows 19, 24, 30). Engine anchors are
at `8ff4c9b` (scouting.md, Scout E). `FOUNDRY` is
`~/.claude/plugins/marketplaces/founder-os/plugins/harness-sessions/skills/software-foundry`.
Round 1's findings and how each was folded are in
`attack/round-1-findings.md`.

**Conventions for every unit.** TypeScript on Node.js 26 with Effect 4 at
the engine's pinned version. Effect APIs are looked up in the current
documentation before they are written (team rule 7). Timers are tested with
`TestClock` from `effect/testing`, advanced with `TestClock.adjust`, inside
`it.effect` from `@effect/vitest`, which provides the test clock by default
(checked on 2026-11-03 against the Effect 4.0.4 `@effect/vitest` README
through context7). A test clock in the test process does not reach a
service in a child process, so the timer rules are tested in-process, and
the public-socket acceptance test sets its limits to seconds through
`roles.settings.set` (8.2). No unit reads an agent's screen or types into a
pane. Text from an agent, a tool call's input or a file is data: it is
matched, shortened and quoted, never followed. An agent's name, which its
parent chose, is data too: a roles alert's title is fixed text and the name
travels in its own field (CAPI §4). Every notice body is fixed text plus
sanitized agent names; no `stderr`, error reason or post text goes in it.
New problems go into the result file for `docs/issues.md` in the same
change (AGENTS.md rule 3; only the lead writes the list).

**The roles piece, as CAPI §1 shapes it.** Namespace `roles`. Two packages
(row 26): `packages/roles-contracts` (schemas only; depends on
`packages/contracts`, and on the client and board contracts packages for
their types) and `packages/roles` (handlers, view, reactors, services, the
stall watch). Commands and their access:

| Command | Access (CAPI §2) | What it does |
|---|---|---|
| `roles.orient` | agent | The caller's own `client.roster` entry and its children's, plus its role's advice. A read. |
| `roles.handoff` | owner, device, agent, service | A hand-off for one agent; an agent may ask only for an agent it holds a parent's rights over. A read. |
| `roles.role-file.set` | owner, device | Loads a role file from its content (row 22). |
| `roles.role-file.get` | owner, device | Returns the loaded role file and its hash. |
| `roles.rules.list` | owner, device | Lists standing rules, their state and their use counts. |
| `roles.rules.add` | owner, and device unless CAPI's question Q2 makes it host-only (CAPI §7, item 4) | Adds a standing rule. |
| `roles.rules.disable`, `roles.rules.remove` | owner, device | Disables or removes a rule. |
| `roles.settings.get`, `roles.settings.set` | owner, device | The stall watch's limits, within bounds (rows 16, 25, 48), and the two on/off switches (row 46). |
| `roles.snooze` | owner, device | Silences team-idle notices for one group until a time. |
| `roles.record` | service | The two roles services write their own action records (row 41). |

Events, all `owner-only` (CAPI §3), so agents never see them through
`subscribe`: `roles.RoleFileSet`, `roles.RuleAdded` (with the adding
device, if any), `roles.RuleDisabled`, `roles.RuleRemoved`,
`roles.RuleFirstUsed`, `roles.SettingsChanged`, `roles.Snoozed`, and the
stall watch's action records `roles.TeamIdleReported`, `roles.StallSeen`,
`roles.ReplaceAdvised`, `roles.RunawayReported`, `roles.CapacityRetried`,
`roles.CrashRetried`, `roles.GaveUp`, `roles.RoleAdviceBroken`,
`roles.CacheFlushed` and `roles.CompactRequested`. Each action record
carries its subject agent, its recipient (an agent id, or `owner`), the
sequence number of the event that triggered it, its occurrence number, and
whether its notice was sent (`sent`, or `board-off`). Alert sources
(CAPI §4), each only for recipient `owner` (row 39): `StallSeen` and
`TeamIdleReported` raise `roles.stall`; `GaveUp` raises `roles.stall`,
except for a crash, where the engine's own `failure` alert already stands
(CAPI §4); `ReplaceAdvised` raises `roles.replace`; `RunawayReported` raises
`roles.runaway`; `RuleFirstUsed` raises `roles.rule-first-use` for every
rule. `RoleAdviceBroken` raises no alert; the clients show it. Alert ends
(row 40): `roles.stall` ends when its agent next starts a turn the stall watch
did not start, or is stopped; `roles.replace` ends when its agent is
stopped; `roles.runaway` ends when the turn ends or the agent is stopped;
`roles.rule-first-use` ends when the rule is disabled or removed. Every
alert also ends when the owner dismisses it.

Snapshot and sizes (rows 33, 47). The roles' `client.snapshot` section comes
from `snapshotFor(caller, view)`, and is absent for an agent (CAPI §3, seam
item 17). For the owner, devices and services it holds only what a client
shows: the role file's name and hash, the rules, the settings, the
snoozes, the matters of open roles alerts, and the latest action record of
each kind for each live agent. It holds no action history and no tool
input; those stay in the log. The roles' stated maxima, which
`packages/api`'s size test checks against the 1 MiB message limit
(CAPI §5): a role file of at most 64 KiB, so `roles.RoleFileSet` stays
under 72 KiB; a rule of at most 2 KiB, and at most 500 rules, so a
`roles.rules.list` page of 200 rules stays under 400 KiB; a `roles.handoff`
reply of at most 64 KiB, encoded, envelope included; and the roles'
snapshot section at most 256 KiB, with the live agents' share capped at 256
agents of the latest records (older agents' records drop out of the
snapshot first).

Services (CAPI §2, "Services"): `roles.standing-rules` and
`roles.stallWatch`. The standing-rules service does not call the engine's
`answer`: a rule answers through WS-7a's pre-check, inside the engine's
transaction (row 35). The standing-rules service calls only `subscribe`
and `roles.record`. The stall watch calls exactly `subscribe`, `prompt`,
`compact`, `resume`, `roles.record` and, with WS-7b, `release`. Its board
commands are exactly `board.post`, `board.flush` and `board.status`; a
service cannot use `board.read` (Board, "For LGTM Studio's own services"). A
notice to an agent is a `board.post` with a `direct` target to that agent,
which lead ruling L17 allows: the pair is the agent and the service, the
author is `service roles.stallWatch`, and the service still cannot read it
(row 34). There is no engine-prompt fallback for notices. When the board is
switched off, a notice to an agent is not sent: its action record says
`board-off`, the clients show it, and a `GaveUp` or `ReplaceAdvised` is
also raised to the owner as its alert, so a decision never waits on a
switched-off board (row 34). The stall watch's engine `prompt` is used only
for work: the carry-on after a crash (4.6) and the capacity re-send
without WS-7b (4.5).

Recipient of every notice (row 38). A notice about an agent goes to that
agent's holder at the moment the action is recorded: the nearest ancestor
that is idle or working, which is the engine's `holderAbove`
(`packages/engine/src/routing/holders.ts:21`), or the owner when there is
none. The action record names both the subject agent and the recipient. If
the recipient crashes or is stopped while the notice is still unread
(`board.status`), the stall watch sends the notice once more, to the new
holder.

Request ids (row 41). Each action's request id is
`roles:<rule>:<subject>:<trigger sequence>:<action kind>:<recipient>:<occurrence>`,
where the occurrence is the stall episode, the hourly repeat's number, or
the retry's attempt number. Every part comes from the roles view, so a
restart rebuilds the same id, a retry reuses it with the same body, and a
repeat gets a new one.

**WS-1: Agents know their role, their team and their rules**

This work gives LGTM Studio a vocabulary for roles, the roles' contracts
package, the role file, and `orient`. Role names are parsed from the free
`role` string the engine already stores (row 14).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | `parseRole("worker:builder")` gives kind `worker` and name `builder`; `parseRole("")` and `parseRole("chef")` give kind `worker` with an `unknown-kind` flag | `packages/roles-contracts/test/role.test.ts` R01-R03 |
| 1.2 | `RolesRpcGroup` is prefixed `roles.`, every payload has `requestId`, and the composed API's uniqueness test passes with it | `packages/roles-contracts/test/group.test.ts` G01; CAPI §1's uniqueness test in `packages/api` |
| 1.3 | `rolesAccess` equals the command table above, every event in `RolesEvent` is `owner-only` in `rolesVisibility`, and `snapshotFor` returns nothing for an agent caller | `group.test.ts` G02-G04 |
| 1.3a | A role file over 64 KiB is refused; the roles' stated maxima, including a snapshot section built from 500 rules and 256 agents with a year of action records, pass the composed API's size test | `roleFile.test.ts` F06; `packages/roles/test/snapshot.test.ts` SN01; `packages/api` size test (CAPI §5) |
| 1.4 | A role file that fails the schema is refused with the failing path, and the previous file stays loaded | `packages/roles/test/roleFile.test.ts` F01-F04 |
| 1.5 | A role file with a key outside the schema, such as `permission` or `rules`, is refused; so is a limit outside its bounds (row 48) | `roleFile.test.ts` F05, F07 |
| 1.6 | `lgtm roles orient` and the MCP tool, called by an agent, return its name, kind and role name, its parent's id and name, its children with their states, its open-request and open-question counts, and its role's advice; called by the owner, it is refused | `packages/roles/test/orient.test.ts` O01-O04 |
| 1.7 | Advice text is returned inside the engine's data envelope with a fresh marker, and a leading `/` is escaped | `orient.test.ts` O05 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | `parseRole` and the three kinds, with generic advice for each: an orchestrator talks to leads; a lead starts, waits on and answers for its own workers; a worker reports to its lead, does not start agents and does not ask the owner | target `packages/roles-contracts/src/role.ts:parseRole`; pattern `packages/contracts/src/permission.ts:permissionLevels` |
| 1b | `packages/roles-contracts`: `RolesRpcGroup`, `RolesEvent`, `rolesAccess`, `rolesVisibility`, `rolesAlertSources`, and the stated maxima above | CAPI §1, "Where the schemas live"; §5 (stated maxima); pattern `packages/contracts/src/commands.ts:CommandsRpcGroup`, `packages/contracts/src/events.ts:Event` |
| 1c | Role-file schema (role name to advice text and limits, each limit within row 48's bounds), loader from content, `roles.role-file.set` and `get` handlers | target `packages/roles/src/roleFile.ts:loadRoleFile`; pattern `packages/contracts/src/harnesses.ts` |
| 1d | The roles view (role file, rules, settings, switches, snoozes, the stall watch's action records, the stall and retry counters, the reactors' cursors), its bounded `snapshotFor` hook, and its registration on the seam | target `packages/roles/src/view.ts:apply`; pattern `packages/engine/src/views/apply.ts:apply`, `emptyViews`; CAPI §1, "Views and reactors" |
| 1e | `roles.orient` handler over `client.roster` entries (CAPI §3) and the role file | target `packages/roles/src/orient.ts`; envelope rule `packages/engine/src/routing/envelope.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A role file is used to widen what an agent may do | major | The schema has no permission, rule or account fields (1.5); standing rules are separate, owner-only commands (WS-2). |
| An agent edits the owner's copy of the role file on disk, since agents run as the owner's user (engine decision row 47) | minor | The file reaches LGTM Studio only through `roles.role-file.set` from the owner or a device; `RoleFileSet` records its hash; limits are bounded (row 48). The copy on disk is outside LGTM Studio. |
| An agent cannot see its grandchildren (CAPI §3 refusal) | minor | By design: a lead asks its workers. `orient` shows only what the roster shows. |
| The roles' snapshot section grows with use past the message limit | major | The section holds no history (1.3a); its maximum is in the size test. |

**Verify:** `pnpm --filter @lgtm/roles-contracts test`, `pnpm --filter @lgtm/roles test`. Device or environment QA: none.

**WS-2: Routine permission requests are answered by owner-approved rules**

This work adds standing rules: a schema, a parser, a pure matcher, the
owner's commands, and the pre-check that WS-7a registers. The matcher
follows lead ruling L20 (row 35). It reads only the permission request
itself, as WS-7a records it: the tool's kind, the tool's own input from the
request (the input the harness will run, not a streamed copy), the flag
that says whether redaction changed that input, the request's options and
its `settingsWrite` flag. It never reads the asker's thread. A rule matches
only when every one of these holds:

- the tool kind is `execute`, the Agent Client Protocol's kind for a shell
  command;
- every field of the input is in the harness's pinned list of known
  fields (2f), and no field asks to leave the sandbox or widen it: for
  Claude Code, `dangerouslyDisableSandbox` absent or false; for Codex,
  `sandbox_permissions` absent or `use_default`, and no
  `additional_permissions`, `with_escalated_permissions` or `prefix_rule`;
- redaction did not change the input;
- the command contains only ASCII letters, digits, the space and
  `_ . / = : , @ + -`; it is split on spaces into words, and the words equal
  the rule's word list exactly, with nothing added, removed or reordered;
- no word, resolved against the asker's folder, names a protected settings
  path (`packages/engine/src/identity/ceiling.ts:317`), even when
  `settingsWrite` is false;
- the input names a working folder, and it equals the asker's folder; an
  input with no working-folder field does not match, unless the harness's
  pinned fixture proves the command always runs in the session folder (2f);
- the harness, role and group the rule lists all match: every listed
  dimension must match, and an empty or missing list matches nothing;
- the asker's permission mode is at or below the rule's highest asker mode,
  which defaults to `ask`;
- the request offers an `allow_once` option at or below the asker's mode,
  `settingsWrite` is false, and the rule is enabled, unexpired at the
  transaction's time, and not added by a device since revoked.

A request that fails any check goes to its holder, exactly as today. The
match runs inside the engine's transaction for the request (WS-7a), so a
rule disabled, removed or expired in an earlier transaction never answers,
and nothing can change between the match and the answer. The engine then
applies its own checks to the answer, whatever the matcher said (7.2). The
log records the answer's caller as
`{ service: "roles.standing-rules", rule: "<id>" }` (CAPI §2). Role and
group names are chosen by the agents that start agents, so they narrow a
rule only by agreement; the folder, the mode and the exact words are the
real limits. `roles.rules.add`'s reply says so in fixed text, and also
warns, when the rule's highest asker mode is `edit` or `full`, that such an
agent can change what the command runs.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | A request of kind `execute` whose own input is the command `pnpm test` with the asker's folder, from a harness, role and group the rule names, by an asker in `ask` mode, matches, and the matcher returns the request's `allow_once` option id | `packages/roles/test/rules.test.ts` M01 |
| 2.2 | A command containing any character outside the allowed set matches no rule: tested with `&`, `;`, `\|`, a backquote, `$`, `(`, `>`, `<`, `~`, `*`, `?`, `[`, `{`, `%`, a single and a double quote, a backslash, a newline, a tab, a carriage return, a non-ASCII space, and `[REDACTED]` | `rules.test.ts` M02-M22 |
| 2.3 | Words that differ from the rule's list do not match: an extra trailing word (`pnpm test -- --config x`), a missing word, a reordered word, and a doubled space are each tested | `rules.test.ts` M23-M26 |
| 2.4 | A request whose tool kind is not `execute` or is absent does not match, including a Model Context Protocol tool whose input has a `command` field | `rules.test.ts` M27-M28 |
| 2.5 | A request with an unknown input field, with `dangerouslyDisableSandbox: true`, with `sandbox_permissions` other than `use_default`, or with `additional_permissions`, `with_escalated_permissions` or `prefix_rule` does not match | `rules.test.ts` M29-M34 |
| 2.6 | A request with no input, with input that redaction changed, with no working folder, or with a working folder other than the asker's does not match; nor does a command word naming a protected settings path inside the folder | `rules.test.ts` M35-M39 |
| 2.7 | A request with `settingsWrite: true`, one offering no `allow_once` option, one whose `allow_once` level is above the asker's mode, and one whose asker's mode is above the rule's highest asker mode never match | `rules.test.ts` M40-M43 |
| 2.8 | A rule listing a role and a group does not match an agent with only one of them; an empty list matches nothing; a disabled rule, a rule expired at the time passed in, and a rule added by a revoked device do not match; the lowest numeric rule id wins when two match | `rules.test.ts` M44-M49 |
| 2.9 | `roles.rules.add`, `disable` and `remove` are refused for agents and services and accepted for the owner; rule ids are numeric and never reused; the reply carries the fixed warnings above | `packages/roles/test/rulesCommands.test.ts` C01-C04 |
| 2.10 | With WS-7a, a matching request is answered in the request's own transaction with the rule's id in the caller, and no delivery to the holder is queued; a disable committed before the request wins; with no match, the request goes to its holder | `packages/roles/test/precheck.test.ts` P01-P03 |
| 2.11 | A rule's first use writes `roles.RuleFirstUsed` once, which raises one `roles.rule-first-use` alert; the alert ends only when the owner dismisses it or the rule is disabled or removed | `precheck.test.ts` P04-P05 |
| 2.12 | Without WS-7a, the rule commands work, `roles.rules.list` marks every rule `inactive: engine addition missing`, and no request is answered by a rule | `precheck.test.ts` P06 |
| 2.13 | Each harness's recorded shell-permission sample (2g) parses into the matcher's inputs, and its known-field list is pinned from it; a harness with no passing sample is `unsupported`, and its requests never match | `packages/roles/test/fixtures.test.ts` X01-X02 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a | Rule schema: numeric id, harnesses, roles, groups, the exact word list (at most 32 words of at most 256 characters), highest asker mode (default `ask`), folder scope (`own-folder` only in this version), optional expiry, enabled flag, the adding device, owner note (at most 512 characters) | target `packages/roles-contracts/src/rules.ts:StandingRule`; pattern `packages/contracts/src/permission.ts` |
| 2b | Command parser: refuses any character outside the allowed set, then splits on single spaces; nothing is stripped or rewritten | target `packages/roles/src/commandWords.ts:splitCommand`; new code (the CLI's `sanitize.ts` strips characters, which is the opposite, so it is not the pattern) |
| 2c | `matchRule(request, asker, rules, now)`: pure; returns an option id or a reason; uses the engine's option kinds and levels and the protected settings paths | target `packages/roles/src/rules.ts:matchRule`; `packages/contracts/src/permission.ts:acpPermissionOptionKinds`, `permissionForOptionKind`; `packages/engine/src/identity/ceiling.ts` l.239-244, l.317 |
| 2d | Rule commands' handlers and their events; a rule whose adding device is revoked is shown as `suspended` | target `packages/roles/src/rulesCommands.ts`; CAPI §1, "How a piece's command runs"; CAPI §2, the envelope's `device` field |
| 2e | Register `matchRule` as WS-7a's permission pre-check; a reactor on `PermissionAnswered` with a rule caller writes `RuleFirstUsed` through `roles.record` | target `packages/roles/src/precheck.ts`; CAPI §1, "Views and reactors"; WS-7a |
| 2f | Per-harness known-field lists and working-folder field, from 2g's samples | target `packages/roles/src/harnessInputs.ts` |
| 2g | Record one scrubbed shell-permission sample for each harness (Claude Code through `claude-agent-acp`, Codex through `codex-acp`): one plain command, one with each sandbox-escape field the harness supports, and the tool-call frames around them; a short live run on the owner's accounts, approved by the owner | targets `packages/testing/fixtures/claude-shell-permission.ndjson`, `codex-shell-permission.ndjson`; pattern `packages/engine/scripts/live/prompts.ts` and the existing recorder |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A rule is stretched by a crafted command (compound shell, extra arguments, quoting, expansion) | blocker | The allowed character set and the exact word list (2.2, 2.3); nothing is parsed beyond spaces; attack pass on units 3 and 11a. |
| A rule approves a run outside the harness's sandbox | blocker | The known-field list and the escape fields (2.5). |
| A rule meant for the shell approves another tool | major | Tool kind `execute` only, from the request itself (2.4). |
| The matcher approves an input other than the one that runs | major | It reads only the request's own input, and refuses a redacted one (2.6). |
| A rule for a test command lets an `edit`-mode agent run what it wrote | major | The highest asker mode defaults to `ask`; a wider rule is an explicit owner choice with a fixed warning (2.7, 2.9). |
| Claude Code's shell input names no working folder, so Claude agents get no matches | minor | Fail closed by design (2.6); 2g may show otherwise; known gap 14. |
| A rule outlives its purpose | minor | Optional expiry; the first-use alert (2.11); the owner lists rules from any client. |
| A stolen phone adds a rule | major | A rule records its adding device and stops matching when that device is revoked (2.8); CAPI's question Q2 may also make `roles.rules.add` host-only. |

**Verify:** `pnpm --filter @lgtm/roles test`. Device or environment QA: the owner's recording run for 2g.

**WS-3: A stall watch keeps every agent moving**

This work builds the stall watch's base inside the roles piece (row 23): the
service registration, the reactors' cursors, the settings and switches,
snoozes, notices, request ids and timers. The rules in WS-4 and WS-5 plug
into it.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | The roles view rebuilt from the log equals the live view, through the engine's rebuild check | `packages/engine/test/support/rebuildCheck.ts` run over the roles suite; `packages/roles/test/stall-watch/fold.test.ts` S01 |
| 3.2 | After a service restart in the middle of a run, the stall watch sends no nudge, notice, retry or compaction it had already recorded; a kill between a command and its action record, for each action kind, leads to exactly one command | `fold.test.ts` S02-S03 |
| 3.3 | Request ids follow the rule above: an hourly repeat and a stall's later episode get new ids; a retry of one action reuses its id and body; two recipients of one trigger get two ids | `fold.test.ts` S04-S06 |
| 3.4 | The two services call only the commands listed under "Services" above; a test lists their calls and compares | `packages/roles/test/stall-watch/calls.test.ts` K01 |
| 3.5 | A notice to an agent is a `board.post` by `service roles.stallWatch` with a `direct` target and `reply: none`, followed by `board.flush` when it must wake the agent now; its body is fixed text plus sanitized names; a notice to the owner is a roles event that raises its alert | `packages/roles/test/stall-watch/notices.test.ts` N01-N03, N07 |
| 3.6 | With the board switched off, no notice is sent, its action record says `board-off`, and a `GaveUp` or `ReplaceAdvised` raises its owner alert | `notices.test.ts` N06 |
| 3.7 | A notice goes to the subject's nearest idle or working ancestor, or to the owner when there is none; a notice still unread when its recipient crashes is sent once to the new holder | `notices.test.ts` N08-N09 |
| 3.8 | `roles.snooze` silences team-idle notices for that group until the time passes; `roles.settings.set` changes a limit and the next check uses it; a value outside its bounds is refused with its path | `notices.test.ts` N04-N05, N10 |
| 3.9 | Timers are re-armed from the view at start-up; a stall, team-idle or capacity deadline that passed while the service was down is re-checked and fires once, one step only; a cache deadline that passed is dropped | `packages/roles/test/stall-watch/timers.test.ts` T01-T03 (`TestClock.adjust`) |
| 3.10 | With `stallWatch: off`, the stall watch sends nothing, cancels its timers and keeps folding events; with WS-7b it first releases each held delivery once; with `standing-rules: off`, the pre-check matches nothing; switching back on re-arms the timers under 3.9's rules | `packages/roles/test/stall-watch/switch.test.ts` W01-W04 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a | Register `roles.stallWatch` and `roles.standing-rules` on the seam; the reactors' cursors in the roles view; the `roles.record` command for the services | CAPI §2, "Services"; §1, "Views and reactors" |
| 3b | Settings shape, bounds and defaults (rows 16, 25, 48), the two switches (row 46), with per-role overrides from the role file | target `packages/roles/src/stall-watch/settings.ts` |
| 3c | Notices through `board.post` and `board.flush`, the recipient rule, the `board-off` record, owner notices as roles events | target `packages/roles/src/stall-watch/notices.ts`; Board, "For LGTM Studio's own services"; `packages/engine/src/routing/holders.ts:holderAbove` |
| 3d | Timers on Effect's clock, re-armed from the view; each rule declares whether a missed deadline is re-checked or dropped | pattern `packages/engine/src/accounts/timers.ts:startAccountTimers` (and its re-check of deadlines crossed during a tick, issue 210) |
| 3e | Action request ids (row 41) | CAPI §5, "Request ids" |
| 3f | The on/off switches and their effect on timers, held deliveries and the pre-check | target `packages/roles/src/stall-watch/switch.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Duplicate or lost actions across a restart | major | 3.2 and 3.3; the reactor is safe to run twice on the same event (CAPI §1). |
| The service callers' rights are wider than they need | major | 3.4. |
| A notice is read by the lead as an instruction from another agent | minor | Only an in-process service can be a post's author, and the wake's header names it as `service roles.stallWatch` from fixed words (Board, "How a wake reaches an agent"); the notice text is fixed by LGTM Studio. |
| A notice reaches a holder that cannot act | major | 3.7. |
| The board is switched off | minor | 3.6: decisions reach the owner as alerts; the rest is recorded. |
| A defect in the roles needs them stopped while the engine keeps running | major | 3.10; the engine is never downgraded once roles events exist (row 46). |

**Verify:** `pnpm --filter @lgtm/roles test`. Device or environment QA: none.

**WS-4: Stalls, crashes and capacity errors are handled without the owner**

Each rule is a pure function from the roles view, the engine's views, the
board's status and the clock to a list of actions, so each is tested alone.
An agent is "waiting on others" when it has an open engine wait, an open
request or question of its own, an open post of its own that needs a reply
(the board's hold-unsettled condition), or a child that is starting,
working, or has a delivery queued or sent.

The stall rule is a small state machine for each pair of an open post P and
one addressee A (row 37). Its clock runs only while A is idle, no delivery
to A is queued or sent, P is open and needs A's reply, A is not waiting on
others, and A is not paused. When the clock stops for any other reason, it
restarts from zero the next time it runs, so time spent waiting on others
never counts. A turn that ends restarts it too. When the clock reaches A's
role limit L (10 minutes for a worker, 20 for a lead or orchestrator), an
episode begins:

- episode 1: A is nudged;
- episode 2: A is nudged again, and A's holder is told that A stalled
  twice on P;
- episode 3: `ReplaceAdvised` tells A's holder to replace A, offering
  `roles.handoff`, and the stall watch stops nudging A about P.

The episode count resets to zero when A makes progress (a thread item that
records a file change, or a board post by A), when P closes, or when A's
part of P is resolved. Tool calls alone are not progress. The count lives in
the roles view as `StallSeen` records, so a restart continues it. Each
episode needs the clock to run its full limit again, so a stall never steps
twice at once.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Team idle: a group with at least one live, unpaused member, whose live members are all idle and none is waiting on others, for 60 minutes, gets one nudge to each of its top agents (each member whose parent is outside the group) and one notice to each distinct holder of those; then hourly; turns the stall watch started do not restart the hour; a group whose members are all stopped or paused gets nothing; a snoozed group gets nothing | `packages/roles/test/stall-watch/rules/teamIdle.test.ts` TI01-TI08 |
| 4.2 | Stall: the state machine above, through three episodes on a simulated clock: nudge, nudge and holder notice, `ReplaceAdvised`; a file change or a post resets the count; tool calls alone do not; P closing resets it; the count survives a restart | `rules/stall.test.ts` ST01-ST08 |
| 4.3 | A lead that holds an open `all` post to its working workers, and a worker with an open wait or an open question of its own, are not stalled; when the awaited agent itself stalls, only that agent's own stall fires | `rules/stall.test.ts` ST09-ST11 |
| 4.4 | Runaway: a turn longer than the role's turn limit (default 120 minutes, not counting time paused or holding an open permission request) tells the holder once per turn; an agent older than the role's age limit (default 120 minutes from `AgentStarted`, the Foundry's worker cap) tells the holder once, suggesting a hand-off | `rules/runaway.test.ts` RW01-RW04 |
| 4.5 | Capacity: with WS-7b, a held delivery is released after 5 minutes, at most 12 times in one outage, then the holder is told once to move the work to another model and the delivery stays held; an outage ends, and the count resets, when a turn ends with no capacity error; without WS-7b, only a returned delivery whose source is an engine `prompt` from an agent or the owner, and whose reason matches the capacity patterns, is re-sent on the same schedule, with the original sender's engine id in a fixed header outside the data envelope, and only if the target has not started a turn and its sender has sent it nothing since; board wakes, compactions, permission, question and wait deliveries are never re-sent | `rules/capacity.test.ts` CP01-CP08 |
| 4.6 | Crash: on the first `AgentCrashed` for an agent within an hour, the stall watch checks that the crash is still current, calls `resume` once, and after `SessionOpened`, if the engine queued no carry-on, sends one `prompt` with fixed carry-on text; it then tells the holder that the agent was resumed, that the holder's posts to it resolved as `gone` and must be posted again if still needed, and not to replace it unless told the stall watch gave up; a refused `resume`, an `AgentReloadFailed`, or a second crash within the hour writes `GaveUp` and tells the holder at once | `rules/crash.test.ts` CR01-CR06 |
| 4.7 | Usage-limit and sign-in pauses are never nudged and never counted as stalls or team idleness | `rules/stall.test.ts` ST12; `rules/teamIdle.test.ts` TI04 |
| 4.8 | Role advice: a worker that itself starts an agent, posts to the owner, or passes a question up is reported to its holder once per kind of break; a question moved by an ancestor's `pass-up` or by the holder chain is not reported | `rules/roleAdvice.test.ts` RA01-RA04 |
| 4.9 | A notice whose recipient is the owner raises the alert in the table above instead of a post: one test per action kind, and none for `GaveUp` after a crash or for role advice | `rules/ownerAlerts.test.ts` OA01-OA07 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 4a | Team idle rule over engine groups, per top agent and per holder | target `packages/roles/src/stall-watch/rules/teamIdle.ts`; groups from `AgentStarted.groups` and `AgentGrouped` (`packages/contracts/src/events.ts:Event`); own open posts from `board.status` |
| 4b | Stall state machine, with its counter per post and addressee (row 37) | target `rules/stall.ts`; Board, `board.status` ("open posts waiting for its reply") and its pure-function export from `packages/board`; the "waiting on others" test above, on the pattern of `packages/engine/src/routing/waits.ts:settled` |
| 4c | Runaway rule from `TurnStarted`, `TurnEnded`, pauses and permission requests; age rule from `AgentStarted` | target `rules/runaway.ts`; `FOUNDRY/scripts/context-keeper.sh` (`WORKER_MAX_MIN`) |
| 4d | Capacity rule with one pattern table: `Selected model is at capacity`, `API Error: 529`, `overloaded_error`, `model is currently overloaded`; matched after the engine's redaction | target `rules/capacity.ts`; patterns from `FOUNDRY/scripts/capacity-retry.sh` `CAPACITY_RE` (scouting.md, Scout S); `DeliveryReturned {sender, reason}`; `packages/engine/src/routing/deliveries.ts` l.126-128; WS-7b's `DeliveryHeld` |
| 4e | Crash rule: re-check, one `resume`, the carry-on prompt, then give up | target `rules/crash.ts`; `AgentCrashed` from `packages/engine/src/recovery/crash.ts:64`; `packages/engine/src/recovery/reload.ts:reloadedEvents` (when the engine queues its own carry-on) |
| 4f | Role-advice rule over the envelope's caller | target `rules/roleAdvice.ts`; `parseRole` (WS-1); `AgentStarted.parent`, `QuestionMoved` and its caller |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Notices wake leads so often that they cost more than they save | major | One notice per event; hourly repeats at most; `reply: none` posts that wake only when flushed; snooze. The acceptance test counts lead wakes (8.3). |
| A lead or worker rightly waiting on another agent is treated as stalled | major | The "waiting on others" test (4.3). |
| Without WS-7b, a capacity outage on a board wake ends that addressee's part of the post | minor | The board owns its wakes' retries (Board, returned wakes); the stall watch never re-sends them; known gap 6. |
| A crash loop on resume | major | One retry per hour per agent (row 17). |
| The engine's own crash notice wakes the holder before the stall watch's notice, and the holder starts a replacement anyway | minor | The stall watch's notice says what it did; known gap 15. |

**Verify:** `pnpm --filter @lgtm/roles test`. Device or environment QA: none.

**WS-5: Waiting messages and compaction are timed to the prompt cache**

A prompt cache's life starts when a model request starts, and a request
that reads the cache renews it (row 45; Claude prompt-caching documentation,
read through context7 on 2026-11-03). The stall watch therefore takes, for the
last model request of an agent's last turn, its start time and the cache
lifetimes it read or wrote. The start time is the request's own if the
usage source gives it, and otherwise the turn's `TurnStarted`, which is
earlier and therefore safe. The lifetime is one hour when the request wrote
only one-hour cache tokens, and five minutes when it wrote any five-minute
tokens or only read the cache. When the source gives no split between the
two lifetimes, the owner's per-harness `cacheLifetime` setting is used; it
has no default, so nothing is scheduled until the owner sets it. The expiry
is the start time plus the lifetime. If it has already passed, or is
unknown, nothing is scheduled. Two minutes before the expiry, for an idle
agent that is not waiting on others and has nothing queued: if
`board.status` shows unread posts, the stall watch calls `board.flush`
(row 28); otherwise, if the agent's context is at least its role's floor
(default 150,000 tokens; a role file may switch compaction off for a role),
it asks for a compaction.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | A last request that started at time T, wrote only one-hour cache tokens, and left 200,000 context tokens, with no unread posts, gives a compact request at T + 58 minutes | `packages/roles/test/stall-watch/rules/cache.test.ts` CM01 (`TestClock.adjust`) |
| 5.2 | The same with two unread posts gives a `board.flush` at T + 58 minutes and no compaction | `cache.test.ts` CM02 |
| 5.3 | Nothing is sent when the agent has a queued delivery, an open request, question or wait, is compacting, or its last turn was a compaction; a newer turn replaces the timer; the guard is checked again at the moment of sending | `cache.test.ts` CM03-CM07 |
| 5.4 | No compaction below the floor, with compaction off for the role, or with an unknown expiry | `cache.test.ts` CM08-CM10 |
| 5.5 | A four-minute turn on a five-minute cache, timed from `TurnStarted`, schedules nothing, because the deadline has passed; a request with both lifetimes uses five minutes; a read-only request uses five minutes; with no lifetime split and no `cacheLifetime` setting, nothing is scheduled | `cache.test.ts` CM11-CM14 |
| 5.6 | With WS-7c, usage comes from `TurnEnded`; without it, from the Claude transcript, and a missing transcript schedules nothing | `cache.test.ts` CM15-CM16 |
| 5.7 | The transcript reader refuses a session id outside the expected format, opens one expected path without following a symbolic link, reads at most a bounded tail, keeps only numbers and timestamps, and never logs or records text it read | `packages/roles/test/stall-watch/usage.test.ts` U01-U04 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5a | Expiry rule and schedule | target `packages/roles/src/stall-watch/rules/cache.ts`; design read from T3 Code `apps/server/src/orchestration-v2/IdleCompaction.ts` (read, not copied; copying invokes AGENTS.md rule 2) |
| 5b | Usage source: `TurnEnded` (WS-7c) or the transcript reader, hardened as in 5.7 | target `packages/roles/src/stall-watch/usage.ts`; fields from `FOUNDRY/scripts/context-keeper.sh:last_call` (`.message.usage.input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; scouting.md, Scout S answer b), plus `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`; reader pattern `packages/engine/src/identity/ceiling.ts` l.97-120 (`O_NOFOLLOW`) |
| 5c | `board.flush` and `compact` through the service caller | Board, "For LGTM Studio's own services"; `packages/engine/src/runner/compact.ts:compactPrompt` (read only) |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The Claude ACP adapter writes no transcript, or writes it elsewhere | major | Post-build check 2 and the live check; without a transcript nothing is scheduled, which is today's cost. |
| The transcript reader leaks a credential from the account's configuration folder | major | 5.7; with WS-7c the reader is not used. |
| A compaction lands just as work arrives | minor | 5.3; the engine refuses `compact` on an agent that is not idle. |
| Codex and other harnesses get no timing without WS-7c | minor | Known gap 5. |

**Verify:** `pnpm --filter @lgtm/roles test`; live check 8.4. Device or environment QA: the live check.

**WS-6: A replacement worker starts from what the old one did**

`roles.handoff` pages through the agent's thread with the seam's paged read
(CAPI §6, item 9) and returns a budgeted hand-off (row 47). Two limits hold
at once: 16,000 tokens, counted as the UTF-8 byte length divided by three
and rounded up, which over-counts English text and so is safe without a
tokenizer; and 64 KiB for the whole encoded reply, envelope included. The
hand-off is filled in this order:

1. The first prompt, up to 24 KiB. A longer one is cut at a character
   boundary, followed by a fixed marker that gives its sequence number, so
   the replacement can read it whole through `client.thread`. A thread with
   no first prompt says so.
2. The last exchange, up to 24 KiB. Its tool calls' input and output are
   shortened first, then its messages are cut, each with the same marker.
3. The most recent tool calls and file changes, each shortened to 240
   characters, while both limits allow.
4. The sequence numbers of everything left out, as ranges.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | For a 5,000-item thread with small items, the hand-off contains the first prompt and the last exchange whole and stays under both limits | `packages/roles/test/handoff.test.ts` H01-H02 |
| 6.2 | For a 100 KiB first prompt, a last exchange with a 200 KiB tool output, and multibyte text, the hand-off stays under both limits, cuts each with a marker that names its sequence, and never splits a character | `handoff.test.ts` H03-H05 |
| 6.3 | It lists the sequence numbers it left out | `handoff.test.ts` H06 |
| 6.4 | The old agent's text is inside a data envelope, and text the log redacted stays redacted | `handoff.test.ts` H07 |
| 6.5 | An agent may ask only for an agent it holds a parent's rights over, checked when the read commits | `handoff.test.ts` H08 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6a | Budgeted selection over `PromptSent` and `ThreadItem` events, with both limits measured on the encoded reply | target `packages/roles/src/handoff.ts:buildHandoff`; `packages/contracts/src/events.ts:ThreadContent` |
| 6b | `roles.handoff` handler with the seam's rights helper and paged read | CAPI §2 ("An agent's rights over other agents are the engine's"); §6 items 8 and 9 |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The hand-off drops the detail the replacement needed | minor | The brief and last exchange are whole when they fit, and otherwise cut with a marker that says where to read them whole. |
| The old agent's text instructs the replacement | major | Data envelope and escaped leading `/` (6.4). |

**Verify:** `pnpm --filter @lgtm/roles test`. Device or environment QA: none.

**WS-7: Three small engine changes, if the owner allows them**

Rows 11, 19, 24, 30 and 53: pending the owner. Round 1 changed 7a and 7b;
the lead has been asked to send the owner the amended version (row 53). If
declined, this workstream is dropped. Each change follows CAPI §6's
additive rule, "No existing command, event, state, reply, rule or test
changes", and every existing engine test, the acceptance suite and the
rebuild check pass unchanged.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 7.1 | 7a, fields: `PermissionRequested` gains three optional fields from the request's own tool call: `toolKind` (the protocol's `kind`), `toolInput` (its `rawInput`, after the engine's redaction) and `inputRedacted` (true when redaction changed it); they are absent when the adapter omits them, and old logs rebuild unchanged | `packages/engine/test/runner/permission-fields.test.ts` PF01-PF03; the rebuild check |
| 7.2 | 7a, pre-check: a registered pure pre-check receives the request, the asker, the views of the same transaction and the transaction's time; when it returns an option, the engine applies its own checks, whatever the pre-check said: the option is a one-time allow, not persistent, of a known kind, within the asker's mode by `canAnswerOption`, and `settingsWrite` is false; if they pass, `PermissionAnswered` is written in the same transaction as `PermissionRequested` with the service caller and rule id, and no delivery to the holder is queued; if they fail, the request is routed as today; with nothing registered, routing is unchanged | `packages/engine/test/routing/permission-precheck.test.ts` PC01-PC05 (with a stub pre-check that always answers); `packages/engine/test/acceptance/capability-07-permissions.test.ts` unchanged and passing |
| 7.3 | 7b, hold: a capacity error writes `DeliveryHeld { deliveryId, reason: "capacity" }`; the delivery stays queued at the front, the dispatcher skips it while held, and the agent becomes idle; no `DeliveryReturned` and no pause is written; a wait on that agent does not end; a crash or stop handles a held delivery as it handles any queued one; usage-limit and sign-in pauses are unchanged | `packages/engine/test/runner/classify-capacity.test.ts` K01-K05 |
| 7.4 | 7b, release: a new command `release { deliveryId }`, allowed for the owner, the delivery's target's holder and a service, writes `DeliveryReleased`, and the delivery is dispatched as usual; it is refused for a delivery that is not held | `packages/engine/test/commands/release.test.ts` RL01-RL03 |
| 7.5 | 7c: `TurnEnded` carries optional usage for the turn's last model request, when the adapter reports it: its start time, input tokens, cache-read tokens, and cache-write tokens split by lifetime when given; old logs rebuild unchanged | `packages/engine/test/runner/usage.test.ts` U01-U02; the rebuild check |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 7a | Permission fields and pre-check registration on the seam (rows 24, 35) | `packages/engine/src/runner/AcpRunner.ts` l.400-416 (where the request's tool call is read), `packages/engine/src/routing/permissions.ts` (`answer`'s agent checks as the pattern), `routing/holders.ts:holderAbove`; CAPI §6 item 12 as the pattern |
| 7b | Capacity class, `DeliveryHeld`, `DeliveryReleased` and `release` (row 36) | `packages/engine/src/runner/classify.ts:classifyError`; `routing/deliveries.ts` (dispatch, `failed`); `packages/contracts/src/commands.ts`, `packages/contracts/src/events.ts` |
| 7c | Optional usage fields on `TurnEnded` | `packages/engine/src/runner/translate.ts`; `packages/contracts/src/events.ts` `TurnEnded`; the Claude fixture's `usage_update` and `state_update` frames (`packages/testing/fixtures/claude.ndjson` l.17-20) |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| 7a puts the matcher inside the engine's most sensitive path | major | The matcher is WS-2's pure function; the engine checks every answer itself (7.2); attack pass on 7a; the permission acceptance test stays unchanged. |
| 7b holds a message forever when the capacity error never clears | minor | The stall watch's 12-release limit and its notice (4.5); the holder or owner can release it; switching the stall watch off releases it (3.10). |
| 7c's fields are missing in older logs | minor | Optional fields; the rebuild check. |

**Verify:** `pnpm --filter @lgtm/engine test`. Device or environment QA: none.

**WS-8: Proof that the Foundry needs nothing else**

The recipe is a document in this repository. The Foundry skill that will
use it is in the Founder OS repository and is changed after this plan.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 8.1 | `docs/foundry.md` maps every action of the Foundry skill's Steps 3, 4, 5 and 8 to an LGTM Studio command, setting or stall watch rule, or marks it as team workflow that stays in the skill; it states that the roles are stopped by their switches, never by downgrading the engine | Read against `FOUNDRY/SKILL.md` by the unit's reviewer; `grep -n 'herdr agent\|collect.sh\|board-waker.sh' docs/foundry.md` hits only its "What this replaces" table |
| 8.2 | The acceptance test runs an orchestrator, two leads and two workers each, with fake agents, through the public socket only, with the stall watch's limits set to seconds: roles and groups at start; `roles.orient` for each; a group channel per team; a standing rule answers a worker's test run; a lead's hand-off post in `all` mode wakes it once when both workers reply, and the lead is not reported as stalled while it waits; a worker stalls through three episodes and is reported; a capacity error is held and released; a worker crashes, is resumed and carries on with a new working turn, crashes again and is reported; a team idles and its lead's holder is told; the wrap-up reads `client.roster` for an attribution table and exports each thread | `packages/roles/test/acceptance/foundry-run.test.ts` FR01-FR10 |
| 8.3 | The same test counts lead wakes: none from a matched standing rule or a capacity error with WS-7 | `foundry-run.test.ts` FR11 |
| 8.4 | Live check by hand: the same flow on a real Claude Code lead and a real Codex worker on the owner's accounts, with one standing rule and one timed compaction or flush | `pnpm live-check:roles`, run by the owner; its report saved under `.scratch/` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 8a | Recipe `docs/foundry.md`, step by step | target `docs/foundry.md`; source `FOUNDRY/SKILL.md` "Step 3 — Open an area", "Step 4 — Workers", "Step 5 — Watch, approve, escalate", "Step 8 — Wrap up" |
| 8b | Acceptance test on the engine's rig, with second-scale limits | pattern `packages/engine/test/acceptance/flow-start-to-finish.test.ts`; `packages/engine/test/support/acceptance.ts`, `serviceProcess.ts` (child process, 120-second test timeout) |
| 8c | Live check script | pattern `packages/engine/scripts/live-check.ts`, `packages/engine/scripts/live/flow.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A Foundry action has no LGTM Studio equivalent and is found only when the skill is rewritten | major | 8.1 walks every action of the four steps; anything unmapped becomes an issue before the plan is done. |
| Fake agents behave more politely than real ones | minor | The live check (8.4). |
| The skill rewrite in another repository is forgotten | minor | Rollout step 6; the manager checks the epic's first "Done when" bullet against it. |

**Verify:** `pnpm --filter @lgtm/roles test`; live check 8.4 by hand. Device or environment QA: the live check on the owner's accounts.

**Post-build checks.** Worries this plan cannot settle before building:
(1) whether each adapter puts the tool's `kind` and `rawInput` on its
permission request, and in what shape (2g records them; a harness without
them gets no matches); (2) whether `claude-agent-acp` writes a transcript
the reader can find under the account's `CLAUDE_CONFIG_DIR`; (3) whether
the seam's in-process service path lets a service call a piece's command
(`board.post`) as well as the engine's, as the board contract assumes;
(4) whether the four capacity patterns still match after the engine's
redaction of a returned delivery's reason; (5) a differential check: for
every command the matcher accepts in its tests, `bash` parses it into
exactly one simple command whose words equal the parser's words; (6) a
fault-injection run that kills the service between each stall watch command
and its action record, for every action kind, and finds exactly one of
each.

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (A) epic row 4 and the epic's three "Done when" bullets;
(B) the engine design's "What stays out of the engine" items for piece 4;
(C) `docs/features.md` section 1 rows not built in the engine, and section
5; (D) `docs/research/t3-code.md` items 4, 7 and 8; (E) the Foundry skill's
Steps 3, 4, 5 and 8 and the scripts `collect.sh`, `board-waker.sh`,
`team-idle-watch.sh`, `context-keeper.sh` and `capacity-retry.sh`; (F) CAPI
§7, "The foundry roles"; (G) the board contract's answers to the roles'
seven needs; (H) decisions.md; (I) lead rulings L17, L19, L20 and L22.

| Source item | Workstream | Status |
|---|---|---|
| A: orchestrator, team leads, workers | WS-1 | mapped |
| A: standing permission rules | WS-2, WS-7a | mapped; matching needs WS-7a (row 35) |
| A: the stall watch | WS-3, WS-4, WS-5 | mapped |
| A: Done when 1 (Steps 3-5 and 8 through LGTM Studio alone) | WS-8 | mapped; the skill rewrite is rollout step 6 |
| A: Done when 2 (phone pairing and answers) | — | piece 2 |
| A: Done when 3 (a message wakes only the agent that needs it) | — | piece 3; the stall watch's notices use `reply: none` and `board.flush` |
| B: rules for each role | WS-1, WS-4f | mapped (advice, row 10) |
| B: standing permission rules | WS-2 | mapped |
| B: retrying, replacing or giving up | WS-4b, WS-4d, WS-4e, WS-6 | mapped |
| C: Orchestrator, Team leads, Worker kinds (idea) | WS-1 | adopted as kinds (row 14) |
| C: Start, stop, and reuse (idea) | — | not adopted: reuse is team workflow (row 5) |
| C: LGTM Studio's tools over MCP (idea) | WS-1, WS-6 | `roles.orient` and `roles.handoff` become tools through the seam |
| C: Hand-offs built from records (idea) | WS-6 | mapped |
| C: Stall watch (idea) | WS-4b | mapped (rows 16, 25, 37) |
| C: Usage-limit pauses are not stalls (idea) | WS-4 (4.7) | mapped; the resume itself is the engine's |
| C: Stuck input boxes and approval dialogs (idea) | — | not needed in ACP mode: no input box, and approvals go to the holder (engine) |
| C: Compaction timed to the prompt cache (idea) | WS-5 | mapped, with delivery before expiry (rows 28, 45) |
| C: Runaway work (idea) | WS-4c | mapped (turn and age, row 43) |
| D: item 4 | WS-5 | mapped |
| D: item 7 (a wait result that says why) | — | built in the engine (`WaitSatisfied` member reasons, CLI exit codes; Scout E items 3 and 5) |
| D: item 8 | WS-4 (4.7) | mapped |
| E: Step 3, start a lead | WS-8a | engine `start` with role `lead` and a group |
| E: Step 3, relayer, team creation, scoped instructions, advisor | WS-8a | team workflow, stays in the skill; the team channel is a board group channel |
| E: Step 3, watchers (idle, capacity, context, board-waker) | WS-4a, WS-4d, WS-5 | mapped; board-waker is piece 3's wake rule |
| E: Step 3, "waiters collect" | WS-8a | a hand-off post in `all` mode (Board, "Posts"), or engine `wait` |
| E: Step 4, workers | WS-8a | engine `start`; worktrees stay in the skill (git) |
| E: Step 5, approve and deny | WS-2 | standing rules; other requests reach the holder through the engine |
| E: Step 5, escalate to the owner | — | engine `pass-up` and `OwnerNeeded`, alerts in piece 2 |
| E: Step 8, wrap-up | WS-8a, WS-8b | `client.roster`, `lgtm thread export`, `stop` |
| E: collect.sh | WS-8a | as "waiters collect" above |
| E: team-idle-watch.sh | WS-4a | mapped |
| E: context-keeper.sh | WS-5, WS-4c | compaction and the two-hour worker cap (the age rule); the advisor check is team workflow |
| E: capacity-retry.sh | WS-4d, WS-7b | mapped |
| F: items 1 to 6 | WS-1, WS-6, WS-3, WS-2 and WS-3, WS-4, — | roster, thread, service caller, `roles.` commands and alert kinds used as given; subscribe filters not needed in-process |
| G: needs 1, 3, 4, 5, 6, 7 accepted; 2 refused | WS-3, WS-4, WS-5 | accepted needs used as given; work state derived (row 25) |
| H: rows 1 to 53 | all | each row names its workstream in its own text |
| I: L17 (service direct pair; no engine-prompt fallback) | WS-3 | mapped (row 34) |
| I: L19 and L22 (reach check at queue and send, on every piece delivery) | — | the roles register no reach check; the stall watch's notices pass the board's, which L17's direct pair allows (row 52) |
| I: L20 (standing-rule matching) | WS-2, WS-7a | mapped (row 35) |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: never push to `vitalysim/herdr-synapse` | Units push only to `qnlbnsl/lgtm-studio`. |
| `AGENTS.md` rule 2: credit copied code | No code is planned as copied; T3 Code's idle compaction and hand-off are read as designs (5a, 6a). A builder who copies code follows rule 2, and the unit's review checks it. |
| `AGENTS.md` rule 3: keep the lists current | The result file's "For docs/issues.md" and "For docs/features.md"; the conventions paragraph; WS-8 risk row 1. |
| `AGENTS.md` rule 4 and SECURITY.md rule 7 | Rows 15, 22 and 35; criteria 1.5, 1.7, 2.2 to 2.13, 3.4, 6.4 and 7.2; attack passes on units 3, 4 and 11a. |
| SECURITY.md rule 6: secrets never reach a client | The hand-off reads only redacted log text (6.4); the matcher refuses redacted input (2.6); the transcript reader keeps only numbers (5.7); notice bodies are fixed text; roles events pass the engine's redactor (CAPI §1). |
| `AGENTS.md` rule 5: the client API is the product's surface | Every owner action, including the switches, is a `roles.` command with owner and device access. |
| `AGENTS.md` rule 6: team shapes do not belong here | Role files and team definitions live outside the repository (rows 5, 14, 22); the recipe marks what stays in the skill. |
| `AGENTS.md` "How agents are run": one delivery interface | Every nudge and notice is an engine delivery (Board, "How a wake reaches an agent"); nothing reads the run mode. |
| `AGENTS.md` "Language" | Conventions paragraph. |
| `AGENTS.md` rule 7 and team rules 2 to 6 | Planners commit their own branch only. |
| Epic, 2026-10-30: built on the engine without changing it | Rows 6, 19, 24, 30 and 53; WS-7 waits on the owner. |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its
harness-session skill) at launch; this section names none (owner,
2026-10-16). The scopes `roles/contracts`, `roles/backend` and
`roles/docs-research` do not exist yet: the lead runs the scoping skill
before the first launch. WS-7 uses the existing `engine/backend`.

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1 Role names, contracts package, role-file schema (1a to 1c) | contracts | roles/contracts | medium | New schemas on the contract's fixed five-export shape. | no | CAPI seam unit |
| 2 Roles view, snapshot and `orient` (1d, 1e) | backend | roles/backend | medium | A fold on the engine's view pattern, a bounded snapshot and one read handler. | no | 1, CAPI roster |
| 3 Rule schema, parser, matcher, harness inputs (2a to 2c, 2f) | backend | roles/backend | high | Decides permissions without a human. | yes | 2g's recordings |
| 4 Rule commands and pre-check registration (2d, 2e) | backend | roles/backend | medium | Wires the matcher to fixed contracts. | yes | 2, 3, 11a |
| 5 Stall watch base and switches (3a to 3f) | backend | roles/backend | medium | Reactor, timers and request ids on the engine's patterns. | no | 2, the board's first units |
| 6 Idle, runaway, crash and role-advice rules (4a, 4c, 4e, 4f) | backend | roles/backend | medium | Pure rules, one test file each. | no | 5 |
| 7 Stall state machine (4b) | backend | roles/backend | medium | One state machine over the board's status. | no | 5 |
| 8 Capacity rule (4d) | backend | roles/backend | low | A pattern table and a timer on a fixed event. | no | 5, 11b if allowed |
| 9 Cache timing (5a to 5c) | backend | roles/backend | medium | One schedule with known guards and a hardened reader. | no | 5 |
| 10 Hand-off (6a, 6b) | backend | roles/backend | medium | Budgeted selection over fixed event shapes. | no | 2 |
| 11a Permission fields and pre-check (7a) | backend | engine/backend | high | Inside the engine's permission path, in one transaction. | yes | 3, owner |
| 11b Capacity hold and release (7b) | backend | engine/backend | medium | One error class, two events and one command on existing patterns. | no | owner |
| 11c Usage on `TurnEnded` (7c) | contracts | engine/backend | medium | An optional event field plus the runner's translation. | no | owner |
| 12 Recipe (8a) | docs-research | roles/docs-research | medium | Checked step by step against the skill. | no | 2, 4, 5 |
| 13 Acceptance test (8b) | backend | roles/backend | medium | One scenario on the engine's acceptance rig. | no | 4, 6 to 10 |
| 14 Live check (8c) | backend | roles/backend | low | One script, run by the owner. | no | 13 |

The recording run for 2g is not a build unit: the owner runs the existing
recorder once per harness, with the prompt changed to ask for one shell
command, before unit 3's matcher is called finished.

Load: 16 build units (13 if the owner declines WS-7). At about three
launches a unit (builder, test writer, focused review), plus two for each of
the three attack-pass units, that is about 54 launches (45 without WS-7).
From the sheet's tables, most backend builds land on the OpenAI vendor, and
the Anthropic vendor carries the test writers for those builds, the high
units' alternates and the attack verifiers. The planner cannot read either
vendor's remaining weekly allowance. The lead checks both before launching,
and schedules units 11a to 14 after a reset if either would run out (known
gap 1).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|
| — | — | Frozen for round 1 on 2026-11-03 (`attack/plan-v1.md`). The lead runs the four lenses. |
| 1 | 2 / 37 / 21 | All 60 folded (`attack/round-1-findings.md`): lead ruling L20 rewrote the matcher; L17's fallback dropped; 7a and 7b reshaped, sent to the lead as question 2 (row 53); stall state machine, holder routing, owner alerts, request ids, hand-off overflow, switches, bounds. Frozen for round 2 as `attack/plan-v2.md`. |

</details>
