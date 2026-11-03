---
topic: shepherd-foundry-roles
status: attack
tier: L
created: 2026-11-03
updated: 2026-11-03
epic: shepherd-foundation
---

# Build the foundry roles and the sheepdog

## Overview

This plan builds the fourth of Shephrd's pieces: the roles that let the
owner's Foundry run its teams through Shephrd alone. The Foundry is the
owner's method for running teams of coding agents: an orchestrator, a lead
for each area of work, and workers. Today it starts agents with Herdr
commands, approves their prompts by pressing keys in their panes, and keeps
them moving with five shell scripts that read the agents' screens. The
engine, piece 1, already starts, prompts, waits on, stops and resumes agents
through one authenticated connection. What it leaves out, on purpose, is
the rules for each role, the standing permission rules, and the decision to
retry, replace or give up on a failing agent. This plan adds those three.

The first addition is the roles. Shephrd learns three kinds of agent: the
orchestrator, a team lead and a worker. Each agent's role names its kind
and, optionally, the team's own name for it, such as `worker:builder`. The
team's own definitions, such as how many workers a lead runs or what a
reviewer is told, stay outside this repository, as the project rules
require. In this version a role's rules are advice. An agent asks Shephrd
"who am I" and gets its role, its parent, its children and its role's
rules. The sheepdog reports an agent that breaks one to its parent, and
Shephrd does not refuse the action. The lead ruled this on 2026-11-03, and
enforcement is recorded as a later idea.

The second addition is standing permission rules. Today a lead answers each
worker's "may I run the tests?" by reading the pane and pressing a key. The
engine already sends that request to the lead as a message, but every
request still costs the lead a turn, and a lead's turn re-reads its whole
context. A standing rule is an owner-approved rule such as "allow exactly
`pnpm test`, run by the shell tool in the worker's own folder". Shephrd
answers a matching request by itself with a one-time allow, before the lead
is woken, and the record names the rule that answered. A rule matches only
the harness's own shell tool, only the exact command the owner wrote (or,
when the owner's rule says so, that command followed by more plain words),
and only plain letters, digits and a few punctuation marks. It matches only
a request that the harness marks as a run inside its sandbox, and never one
that would save a permission or touch a settings file. A rule cannot stop
an agent that may edit files from changing what `pnpm test` runs, so by
default a rule applies only to agents that have never been allowed to edit
without asking. Even then, another agent whose folder contains the asker's
folder could change the tests; the owner is told this when adding a rule.
Only the owner adds or removes a rule, adding one works only at the
computer, and the owner's phone is told the
first time each rule is used. Standing rules need the first of the engine
changes described below. On today's evidence, no harness the owner uses
meets every one of these conditions yet. Claude Code's shell request names
no folder, and Codex runs an approved command outside its sandbox. So each
harness's permission requests are recorded first. The rule matcher and its
engine check are built only for a harness that qualifies, and if none
does, standing rules wait for a later version (lead ruling L27).

The third addition is the sheepdog. It is a small part of the Shephrd
service that watches the record of events and keeps every agent moving
without spending their turns. It replaces the Foundry's scripts. It tells a
lead's parent when the lead's team has had nothing running for an hour. It
holds a message that met a "model at capacity" error and retries it five
minutes later, through one of the engine changes below. It resumes a crashed agent once, tells it to carry on, and then
gives up. It wakes a worker that sits on an unanswered message, then tells
its lead, and tells the lead to replace a worker that stalls three times.
A worker waiting on an agent that is still busy is not stalled; two agents
that each wait on the other, with neither busy, are. Just before an idle
Claude agent's prompt cache expires, it delivers any messages waiting for
that agent, or compacts the agent's context, because that is when both are
cheapest. It never decides what the work is. When a worker is replaced,
Shephrd builds the replacement's first message from the record of what the
old worker did, so no model turn is spent writing a summary. The owner can
switch the sheepdog and the standing rules off from any client.

Two other plans were written at the same time, and this one builds on both
of their contracts. The client API plan's first unit edits the engine so
that a piece can add its own commands, events and views to the engine's
own lists, and so that Shephrd's own services can act as a narrow
"service" caller. The roles then add their commands and events to those
lists directly, and the sheepdog acts as a service whose actions the
record names as the sheepdog's, not the owner's. The client API also
lets an agent list its own team. The message board lets the sheepdog post
a notice that no agent can forge, and deliver an agent's waiting messages
at a chosen moment.

The owner settled how the plans may change the engine on 2026-11-03:
"change it. that is the whole point of a phased build." So this plan edits
the engine directly, and it makes three small engine changes of its own.
The first change checks standing rules before a permission request reaches
the lead, so the lead is not woken at all. It reads which tool asked and
exactly what it will run, which the client API plan now records on every
request. The second holds a message that met a
"model at capacity" error in its queue while the sheepdog is on, so
neither the agent nor its lead is woken for each one, and adds one command
that releases it. The third records how large each agent's context is, so
compaction can be timed for every harness, not only Claude. The first
change is built only for a harness that qualifies for standing rules.
Where a change alters something the engine already does, such as what
happens after a capacity error, the plan names the change, the file and
the existing tests it updates. Each change is reviewed like any engine
unit.

## Key decisions

- **The roles are built into the engine directly.** The owner's answer of
  2026-11-03. The roles add their own commands and events to the engine's
  lists, which the client API plan's first unit opens up, and they edit
  existing engine code where they need to. The sheepdog runs
  inside the Shephrd service as a narrow caller that can nudge, compact,
  resume, post notices and release held messages, and nothing else. After a
  restart it reads the record again and knows everything it knew before.
- **Role rules are advice in this version.** The lead's ruling of
  2026-11-03. A confused agent can still do something its role should not,
  but its parent is told. Enforcement can be added later.
- **Standing rules allow one plain shell command at a time.** The lead's
  ruling of 2026-11-03. A rule answers with "allow once" for the harness's
  own shell tool only, for the exact words the owner wrote, in the asker's
  own folder, inside the harness's sandbox. A rule may allow more words
  after its own only when the owner marks it so. Any character outside a
  short safe list, any request to leave the sandbox, and anything the
  matcher cannot read means no match. The cost is that the owner writes a rule per command, and that rules need
  the first engine change. They are built only for a harness that qualifies
  (next decision).
- **The sheepdog tells the parent; the parent acts.** It wakes an agent,
  retries a held capacity error and resumes a crash once by itself.
  Replacing a worker or giving up is reported to the nearest ancestor that
  can act, which decides. This follows the owner's words of 2026-10-25:
  "tell the lead to recreate it". A matter that reaches the owner becomes a
  phone alert.
- **"Stalled" means an unanswered message and no one busy to wait for.**
  The board does not track work states, so a worker counts as stalled when
  it sits idle with a message that needs its reply, and no agent it waits
  on is busy. Three stalls on the same message, with no file change or post
  between them, is the signal to replace it.
- **Every limit is a setting, within fixed bounds.** The defaults come from
  the Foundry's own scripts and the owner's earlier words: an hour of team
  idleness, five minutes between capacity retries, ten minutes before a
  worker's unanswered message counts as a stall, two hours for a runaway
  turn or a long-lived worker. The owner can change each from any client,
  inside a minimum and a maximum.
- **Standing rules are built only for a harness that qualifies.** The
  lead's ruling L27 of 2026-11-03. Each harness is recorded first; if none
  qualifies, standing rules wait for a later version.

Full log → `decisions.md`

## Workstreams

### Agents know their role, their team and their rules

An agent can ask Shephrd who it is and get back its role, its parent, its
children and their states, its count of open requests and questions, and
its role's advice, from the command line or as a tool. While one of its
children is unavailable, which means in any state but idle or working, it
also sees that child's children, because it now answers for them. This replaces
Synapse's `orient` and the Foundry's habit of pasting the same facts into
every brief. The team's role file, kept outside this repository, supplies
the advice text and the limits for each role. The owner loads it from any
client. The risk is a role file used to grant something. The role file's
format has no field that can grant a permission, and Shephrd refuses a file
that tries. Done when an agent started as `worker:builder` reads its parent
and its role's advice through `orient`.

### Routine permission requests are answered by owner-approved rules

The owner adds a rule such as "Codex workers may run exactly `pnpm test` in
their own folder". When a request matches, Shephrd answers it once, the
record names the rule, and the lead is not asked. The main risk is a rule
that allows more than the owner meant. The matcher refuses any other tool,
any unusual character, any word the rule does not allow, anything that is
not plainly a sandboxed run, settings files, persistent answers, and
anything above the asker's mode or outside its folder. A dedicated attack
review checks it. Done when a worker's matching request is answered by the
rule, and requests for `pnpm test & rm -rf ~` and `pnpm test -- --config x`
are not. If no harness qualifies in the recordings, this workstream waits
for a later version (lead ruling L27).

### A sheepdog keeps every agent moving

The sheepdog runs inside the Shephrd service, reads the record of events,
and acts through its narrow caller. It is the base the next workstreams'
rules sit on. The risk is a sheepdog that nudges the same agent twice after
a restart. Every action it takes is itself recorded, so it reads its own
past actions when it starts and does not repeat them. Done when a service
restarted in the middle of a team's run sends no duplicate nudge, and a
sheepdog switched off sends nothing and holds nothing.

### Stalls, crashes and capacity errors are handled without the owner

The sheepdog's rules cover a team with nothing running for an hour, a
worker sitting on an unanswered message, the third such stall, two agents
waiting on each other, a turn or a worker that runs past two hours, a
"model at capacity" error, a crash, and an agent that breaks its role's
advice. Usage-limit pauses never count as stalls, because the engine
already resumes those agents when the limit resets. The risk is noise: a
lead that is told too often stops reading. Each notice is sent once per
event and repeats at most hourly, and the owner can snooze a team. Done
when each rule fires once in its test and stays quiet in a team that is
paused or rightly waiting on a busy agent.

### Waiting messages and compaction are timed to the prompt cache

Two minutes before an idle Claude agent's prompt cache expires, the
sheepdog delivers the messages waiting for it, if there are any, so they
are read at the cheap cached price. If there are none and its context is
large, it asks the agent to compact. The risk is compacting an agent that
is about to receive work. The sheepdog skips any agent with something
queued, open or waiting, and it schedules nothing when it cannot tell when
the cache expires. Done when a test shows the delivery or the compact
request two minutes before the computed expiry, and neither for a busy
agent.

### A replacement worker starts from what the old one did

When a lead replaces a worker, Shephrd builds the replacement's first
message from the record: the original brief, the last exchange, the
commands it ran and the files it changed, each shortened, with pointers to
the rest. No model turn is spent writing it. The risk is a hand-off that
leaves out the one thing that mattered. It keeps the brief and the last
exchange whole when they fit, and cuts them with a clear marker when they
do not. The marker tells the lead where to read the rest; the replacement
asks its lead, because only the lead may read the old worker's record.
Done when the hand-off command returns a hand-off under both its limits,
for a small thread and for one with a very long brief, and the replacement
gets the missing part through its lead.

### Three small engine changes

The engine asks the roles' rule matcher before it delivers a permission
request, reading the tool and the input that the client API plan now records
on every request; this part is built only for a harness that qualifies. While the sheepdog is on, it holds a message that met a
capacity error in its queue instead of returning it to the sender, until
the sheepdog releases it. It records each turn's token and cache usage.
The risk is the same as any engine change: a regression in a part that is
already reviewed. Where a change alters existing engine behaviour, the
plan names it and the tests it updates, and every other engine test keeps
passing.

### Proof that the Foundry needs nothing else

A written recipe maps each of the Foundry's Steps 3 to 5 and 8 onto
Shephrd's commands. An acceptance test runs a whole Foundry-shaped team
with fake agents through Shephrd's public connection alone: an
orchestrator, two leads and their workers, with a standing rule, a stall, a
capacity error, a crash and a wrap-up. A check by hand runs the same flow on
real Claude Code and Codex agents. The Foundry skill itself lives in another
repository, so changing it to use the recipe is the last step, done by the
owner or the manager. Done when the acceptance test passes and the recipe
uses no `herdr agent` command, `collect.sh` or `board-waker.sh`.

## Rollout order

1. **Wait for the shared engine edits.** The client API plan makes them
   as its first unit. Until then, the parts with no
   connection to the engine can be built: the role names, the role file
   format, the rule matcher and the hand-off builder. The owner also
   records short shell-permission samples for each harness, with a
   recorder prepared for them. That recording decides the gate: the rule
   matcher is built only for a harness that qualifies.
2. **Build the roles' commands and events,** then `orient`, and the standing-rule commands if a
   harness qualified, once the shared engine edits and the client API's
   unit 3, which brings `client.roster`, have merged.
3. **Build the sheepdog's base, then its rules.** The rules that send
   notices need the board's post, flush and status commands, so they follow
   the board's first units.
4. **Build the three engine changes,** each in its own pull request into
   `engine`. The first is built only if a harness qualified.
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
`.plans/plans/shepherd-client-api/contract.md` on `worker/plans-api` at
`3bd2358`, copied here as `client-api-contract-v11.md` (v11: v3's rework
under lead ruling L26, v4's round 4 shared fixes S1 to S6 under lead ruling
L29, v5's waiting and reactor changes under lead ruling L30, v6's service
rights without `answer`, v7's design talk 1, v8's review round 1, and v9's
two points from the board's question 7 under lead ruling L31, v10's review
round 2, and v11's review round 3; the shared engine edits E1 to E32 in its
section 6, and lead rulings L15, L16,
L19, L22 and L23; decision rows 21, 32, 33, 52, 55, 80, 95 to 101, 103 to
131). Edit E28 is pending the owner's question 6, and either answer leaves
this plan unchanged (row 108). "Board" is
the message board contract v10, `.plans/plans/shepherd-message-board/contract.md`
on `worker/plans-board` at `c053fda`, v6's rework under L26 with the
board's round 4 fold and its folds of the client API contract up to v11, of
which v8's two additions the lead approved as ruling L31 (lead rulings L17,
L21, L24, L28, L30 and L31; rows 29, 31, 33, 34, 55, 94, 102, 109, 130); round 2 reviewed v4 at `bcc33e1`. Both build on the
shared engine edits of CAPI §6, which the client API plan's first unit
makes directly in the engine, under the owner's answer of 2026-11-03 and
lead ruling L26 (row 80). Lead rulings L20 and L25 govern standing rules
(rows 35, 54, 67, 79), and lead ruling L27 builds WS-2 and WS-7a's rule
check only for a harness that qualifies (rows 68, 81). Engine anchors are at
`8ff4c9b` (scouting.md, Scout E). `FOUNDRY` is
`~/.claude/plugins/marketplaces/founder-os/plugins/harness-sessions/skills/software-foundry`.
Each review round's findings and their folds are in
`attack/round-1-findings.md`, `attack/round-2-findings.md` and
`attack/round-3-findings.md` and `attack/round-4-findings.md`.

**Conventions for every unit.** TypeScript on Node.js 26 with Effect 4 at
the engine's pinned version. Effect APIs are looked up in the current
documentation before they are written (team rule 7). Timers are tested with
`TestClock` from `effect/testing`, advanced with `TestClock.adjust`, inside
`it.effect` from `@effect/vitest`, which provides the test clock by default
(checked on 2026-11-03 against the Effect 4.0.4 `@effect/vitest` README
through context7). A test clock does not reach a service in a child
process, and the settings' bounds refuse second-scale limits, so the
acceptance test runs the composed Shephrd service inside the test process,
with the test clock as its clock, and talks to it only through its real
Unix socket (row 63). The production service has no test switch, and its
bounds are unchanged. Tests run with the workspace's `vitest run` at the
repository root, filtered by path, because packages have no `test` script
(row 66); each "Verify" line below names the paths. The roles' code and
tests live in the engine's existing packages, which the root
`vitest.config.ts` already lists, and each unit's first verification
output shows the test files it discovered (rows 71, 80). No unit reads an
agent's screen or types into a pane. Text from an agent, a tool call's
input or a file is data: it is matched, shortened and quoted, never
followed. An agent's name, which its parent chose, is data too: a roles
alert's source names a kind and never a title, each title comes from the
fixed table of kinds in `packages/contracts`, and the name travels in its
own field (CAPI §4; row 105). Every notice body is fixed text plus sanitized agent names; no
`stderr`, error reason or post text goes in it. New problems go into the
result file for `docs/issues.md` in the same change (AGENTS.md rule 3;
only the lead writes the list).

**The roles piece, as CAPI §1 shapes it.** Namespace `roles`. Its code
lives in two folders inside the engine's existing packages (CAPI §1, "Where
a piece's code lives"; row 80): `packages/contracts/src/roles/` (the
command group, events, access entries, visibility entries and alert
sources) and `packages/engine/src/roles/` (planners, view, reactors,
services and the sheepdog). The roles add themselves to the engine's own
lists in their own units: their commands to `CommandsRpcGroup` (CAPI E1),
their access entries (E2), their planners and reads (E3, E4), their events
to the `Event` union and the lifecycle table (E5), their view to the engine's views (E6), their
visibility entries (E8), their snapshot entry (E9), their alert sources,
and their two services to the service list (E13). Every batch the roles'
code writes, from a planner or the first-use reactor, goes through the
engine's piece batch path (CAPI E23), so it holds only `roles.` events,
passes the engine's state table and wait checks, and never writes an
engine event (row 99). Every command is exactly one of two kinds (CAPI §1,
"How a piece's command runs"; E3, E4; row 95). A **planner** writes events
and returns a small reply of ids, counts and fixed text from its own
batch, and is deduplicated by its request id. A **read** returns records,
is checked against the caller's current access on every request,
including a resent one, and is never deduplicated. No roles read writes
marks. Commands, their access and their kind:

| Command | Access (CAPI §2) | Kind | What it does |
|---|---|---|---|
| `roles.orient` | agent | read | The `client.roster` entries the caller may read by CAPI's read rule (§3, "The read rule and the management rule"): itself, its children, and an agent whose parent is unavailable and whose effective holder it is; plus its role's advice (row 96). |
| `roles.handoff` | owner, device, agent | read | A hand-off for one agent; an agent may ask only for an agent it may manage, by the engine's rights helper (`mayActForHolder` over `holderAbove`, CAPI E22). |
| `roles.role-file.set` | owner, device | planner | Loads a role file from its content (row 22), recording the device. Its reply is the file's hash. |
| `roles.role-file.get` | owner, device | read | Returns the loaded role file and its hash. |
| `roles.rules.list` | owner, device | read | Lists standing rules in full, their state and their use counts, paged. |
| `roles.rules.add` | owner alone; **computer-only**, by the owner's choice (CAPI §2, CAPI criterion 5.5; row 103) | planner | Adds a standing rule. Its reply is the new rule's id and the fixed warnings. |
| `roles.rules.disable`, `roles.rules.remove` | owner, device | planner | Disables or removes a rule. |
| `roles.settings.get` | owner, device | read | The sheepdog's limits and the two on/off switches. |
| `roles.settings.set` | owner, device | planner | Changes the sheepdog's limits, within bounds (rows 16, 25, 48), and the two on/off switches (row 46), recording the device. |
| `roles.snooze` | owner, device | planner | Silences team-idle notices for one group until a time. |
| `roles.actions.list` | owner, device | read | The sheepdog's action records, paged, newest first, optionally for one agent (row 61). |
| `roles.record` | service | planner | The sheepdog writes its own action records: a closed list of action kinds, allowed only for `roles.sheepdog` (rows 67, 99). Its reply is the record's sequence number. |

Events, all `owner-only` (CAPI §3), so agents never see them through
`subscribe`: `roles.RoleFileSet` (with the device, if any),
`roles.RuleAdded`, `roles.RuleDisabled`,
`roles.RuleRemoved`, `roles.RuleFirstUsed`, `roles.SettingsChanged` (with
the device, if any), `roles.Snoozed`, and the sheepdog's action records
`roles.TeamIdleReported`, `roles.StallSeen`, `roles.ReplaceAdvised`,
`roles.RunawayReported`, `roles.CapacityRetried`, `roles.CrashRetried`,
`roles.GaveUp`, `roles.RoleAdviceBroken`, `roles.CacheFlushed`,
`roles.CompactRequested` and `roles.StallEnded`, and `roles.SheepdogBaseline { position, on }`, written at the sheepdog's first start and on each change of its switch (rows 104, 115). `roles.RuleFirstUsed` carries the rule's id and the asking agent. Each action record carries its subject agent,
its recipient (an agent id, or `owner`), the sequence number of the event
that triggered it, the `sourceSequence` of the last stream event the
sheepdog had handled when it decided (row 104), its occurrence number, whether its notice was sent (`sent`, or
`board-off`), and, for a sent notice, the post id that `board.post` returns as its
planner reply (CAPI E3; row 69). `GaveUp` also carries its cause (`crash`,
`resume-refused`, `reload-failed` or `capacity`) and `engineAlertOpen`:
whether an engine `failure` alert for the same agent was open when the
record was written, read from the client API's alert view (row 58). Alert sources (CAPI §4), each only for recipient `owner` (row 39),
except a `GaveUp` whose notice is `board-off` (row 72): `StallSeen`
and `TeamIdleReported` raise `roles.stall`; `GaveUp` raises `roles.stall`
unless `engineAlertOpen` is true; `ReplaceAdvised` raises `roles.replace`;
`RunawayReported` raises `roles.runaway`; `RuleFirstUsed` raises
`roles.rule-first-use` for every rule. `RoleAdviceBroken` raises no alert;
the clients show it. A source names a kind, a key and an agent, never a
title, and the roles add their four kinds to the fixed title table in
`packages/contracts` (CAPI §4; row 105). The keys are `stall:<agentId>`,
`replace:<agentId>`, `runaway:<agentId>` and `rule:<ruleId>`. No roles alert
has a subject, so a tap opens the subject agent's thread, or, for a first
use, the asking agent's, with no entry in the thread page's subject panel.
The client API's own `client.lasting-setting` alert has `roles.RoleFileSet`
and `roles.SettingsChanged` among its sources: a change that arrives with
`device: open-web` raises it, and it ends only when dismissed (CAPI §4,
CAPI row 98). A device caller cannot switch off this kind's push (CAPI §2,
CAPI row 139; row 117). Alert ends (row 40): `roles.stall` ends on `roles.StallEnded`,
which the sheepdog writes when its agent next starts a turn that is not a
sheepdog turn, or is stopped, because an alert source sees one event and
cannot tell the two kinds of turn apart (row 76);
`roles.replace` ends when its agent is stopped; `roles.runaway` ends when
the turn ends or the agent is stopped; `roles.rule-first-use` ends when the
rule is disabled or removed. Every alert also ends when the owner
dismisses it.

**Open matters at the alert reactor's first start.** The roles supply `openMatters(views)` in the client API's table (contract section 4). It is a pure function over the rebuilt views. It returns each open matter of `roles.stall`, `roles.replace` and `roles.runaway`, with the same key, kind, agent and subject that the roles' alert source gives. `roles.rule-first-use` records something finished, so it has no open matter. Only the first-start scan calls it.

The roles view keeps these matters for each agent, folded from the action
records and the ends above, so the function reads a field and searches no
history (row 112). A record opens a matter only when it would have raised an
alert, so a record for a recipient other than the owner opens none, except a
`GaveUp` whose notice is `board-off`, and a `GaveUp` with `engineAlertOpen`
true opens none.

The roles have no `ownerHeld` list. Their row in CAPI §3's table is "none",
because they reach the owner through these alert kinds (row 118).


Snapshot and sizes (rows 33, 47, 61). The roles' `client.snapshot` section
comes from `snapshotFor(caller, view)`, and is absent for an agent
(CAPI §3; the snapshot-section table, CAPI E9). For the owner, devices and services it is a
bounded summary, like the board's (Board, ruling L23): the role file's name
and hash; the settings and switches; each rule's id, state and use count,
without its words or note; the snoozes; the matters of open roles alerts;
and the latest action record of each kind for each live agent, newest
agents first. Every list has a stated maximum, and a list cut short sets
`truncated` for that list. The client then reads the rest with
`roles.rules.list` and `roles.actions.list`. Stated maxima, which
the size test in `packages/contracts` checks against the budgets in CAPI §5,
on real encoded messages (CAPI criterion 2.6; row 106): an inbound message
of at most 1 MiB, a page that closes at 900 KiB or its item limit, and an
event checked against that 900 KiB page budget (CAPI row 137; row 116). An
event over 256 KiB reaches `client.subscribe` as a marker, and the client
reads it with `client.event`.
The roles' largest event is `roles.RoleFileSet` and their largest page is a
`roles.rules.list` page, so each fits without a marker or a byte cut: a role file of at most 64 KiB, so `roles.RoleFileSet` stays
under 72 KiB; a rule of at most 2 KiB, measured on its encoded form and
checked as a whole, because its fields at their separate maxima do not fit
together (2a, row 70), and at most 500 rules, so a `roles.rules.list` page
of at most 200 rules stays under 400 KiB; a `roles.actions.list` page of at most 500
records, under 256 KiB; a `roles.handoff` reply of at most 64 KiB, encoded,
envelope included; and the roles' snapshot section at most 128 KiB, with
the rules' summary at most 500 entries, the snoozes at most 200, and the
agents' latest records at most 256 agents. The section is filled in a
stated order until it reaches 128 KiB, measured encoded, as the board's
section is: the role file, the settings and switches, the open alerts'
matters, then the rules' summary, the snoozes, and the agents' latest
records, newest agents first. Whatever does not fit is cut, and its list is
marked `truncated` (row 70). The roles' hold-unsettled and request-held
entries stay "never" (CAPI E19, E20): an open capacity hold leaves its agent
unsettled through the engine's own part of the test, even once its queue is
empty (7.3; row 129). So the section
carries no agent lists for the client wait helper, and the roles offer no
read for it (CAPI §3, lead ruling L30; row 100).

Every function this plan adds to a per-piece table (view reducer, reach check, hold-unsettled, request-held, source rule, secret keep list, `snapshotFor`, alert source, `openMatters`) is called through the engine's `guardPiece` (client API contract, section 1, edit E30). If it throws, the engine logs the namespace, the table and the error's class name, with no event text, and uses the stated fallback. This plan adds no wrapper of its own, and no direct call. A reducer reads the event and the sequence, and nothing else from the envelope, because a projection passes placeholders for the rest.

The roles' entries are the view reducer and `snapshotFor` (1d), the alert
sources (1b) and `openMatters` (3h). They have no reach check, source rule or
keep list, and their hold-unsettled and request-held entries stay "never", as
above. The client API's fixture test reaches all of these tables, so this plan
adds no expectation to it. The matcher (7.2) and the capacity-hold condition
(7.3) are not table entries, and each keeps its own rule (row 121).


Services (CAPI §2, "Services"): `roles.standing-rules` and
`roles.sheepdog`. The standing-rules service does not call the engine's
`answer`, which no service may call (CAPI E13, CAPI row 75): a rule
answers through WS-7a's pre-check, inside the engine's transaction, and
`PermissionAnswered.answeredBy` names the service and the rule (row 35,
CAPI E14). The standing-rules service calls no command at all. Its entry
in the service list names no command, so the entry point refuses every
call under its name; the name exists so that the log can record its
answers. A rule's first use is recorded by the roles' first-use reactor,
not by the service (row 99). The sheepdog calls exactly `subscribe`, `prompt` (only
for the carry-on after a crash, 4.6), `compact`, `resume`, `roles.record`
and `release`. These lists are the engine's, not only the roles' habit:
each service's entry in the service list (`commands/services.ts`, CAPI
E13) names its own commands, and the service entry point refuses every
other one, including `board.close`, which the board would otherwise
allow any service (row 92). WS-7b adds `release` to the engine's commands, and its
access entry includes `service` (CAPI E2); the services' rights in CAPI §2
and E13 gain that one command (row 101). The
sheepdog's board commands are exactly `board.post`, `board.flush` and
`board.status`; a service cannot use `board.read` (Board, "For Shephrd's
own services").

Notices, nudges and sheepdog turns (rows 34, 60). A notice to an agent is a
`board.post` with a `direct` target to that agent and `reply: none`, which
lead ruling L17 allows: the pair is the agent and the service, the author
is `service roles.sheepdog`, and the service still cannot read it. A
sheepdog `prompt` is shown as from the service and wrapped as data, like
an agent's (CAPI E15). A
notice that asks for a decision or wakes a stuck agent is followed by
`board.flush` for its recipient: a nudge, a stall's holder notice,
`ReplaceAdvised`, `GaveUp`, `CrashRetried`, `TeamIdleReported` and
`RunawayReported`. A `RoleAdviceBroken` notice is not flushed; it rides the
recipient's next wake. A **nudge** is such a notice, to the stalled or idle
agent itself, followed by `board.flush`. A **sheepdog turn** is a turn
started by a delivery that the sheepdog alone caused: a board wake whose
`board.WakeBuilt` lists only posts by `service roles.sheepdog`, the
sheepdog's carry-on prompt, or a compaction the sheepdog requested
(row 76). A wake that also carries any other post, or any
completion, is not a sheepdog turn, because a completion carries ordinary
work (row 90). There is no engine-prompt fallback for notices. `board.flush` is refused with
the engine's reason when its agent is stopped or crashed (Board row 125).
Such a refusal, from a recipient that stopped or crashed after the sheepdog
chose it, is not a fault: the notice's record stands and its re-send rule
below covers it, and the cache rule drops its flush (row 109).

The board switched off (rows 34, 59, 102). While the board is switched
off, every board command but `board.status` is refused with "board
disabled", and the board's reactor and conditions stop (Board, "When the
board is switched off"). `board.status` stays readable, says `disabled`,
and returns empty condition lists, so the stall rule's waiting test gets
no board part. The sheepdog then suspends the stall
rule, the team-idle rule and the cache flush, keeping their counts, and
restarts their clocks from zero when the board is switched on. Compaction,
crash retries and capacity releases carry on. A notice to an agent is not
sent: its action record says `board-off`, the clients show it, and a
`GaveUp` is also raised to the owner as its alert, under the same
`engineAlertOpen` test and the alert-source exception above (row 72), so
a give-up never waits on a switched-off board.

Recipient of every notice (row 38). A notice about an agent goes to that
agent's holder at the moment the action is recorded: the nearest ancestor
that is idle or working, which is the engine's `holderAbove`
(`packages/engine/src/routing/holders.ts:21`), or the owner when there is
none. A paused parent is skipped, as the engine and the board skip it;
`docs/foundry.md` says so. The action record names both the subject agent
and the recipient. If the recipient crashes or is stopped while the notice
is still unread, the sheepdog sends the notice once more, to the new
holder. `board.status` cannot say whether one post is read, and a service
cannot use `board.read`, so the roles view tracks each notice itself: the
action record keeps the post id, and the view folds the board's
`board.Read`, which names its reader, and `board.WakeBuilt`, which names the
wake by its source id, with the engine's `DeliveryQueued` that has a board
source, to learn the wake's delivery id, and the engine's
`DeliveryAccepted` for that recipient, to mark the notice read (rows 69, 130).

Start-up and position (CAPI §1, "Views and reactors", CAPI row 108; row
104). The sheepdog is a service, because it writes through commands, but it
follows the reactors' rules:

- It starts, and arms its timers, only after `recovery.whenReady`.
- Its position is derived in the roles view: the highest of the
  `sourceSequence` on its action records and the `position` on its baselines.
  Only the sheepdog's own writes move it, so a planner's event, such as
  `roles.SettingsChanged`, never does (CAPI §1, CAPI row 145; row 115). It
  subscribes through the in-process call of CAPI E13, `after` that position. Rules and
  timers run on one loop, so a record's `sourceSequence` never passes an
  event not yet handled. A replayed event rebuilds the same request ids
  (below), so it repeats no action.
- At its first start, whatever the switch says, it writes
  `roles.SheepdogBaseline`, whose `position` is the `sequence` of one
  `views.snapshot` value (CAPI E9). It never replays history. Its first scan
  starts the clocks of open stalls, idle groups and running turns from that
  moment, and it acts on no crash from before the baseline, because the
  engine's alert and crash notice already cover it. While it is switched off
  it handles nothing, so a crash during that time is not retried either.
- The switch is read from the stream, so a replay treats each event under the
  switch it came under. The baseline's `on` is the switch's value at its
  `position`, and the latest baseline gives the value a replay starts from.
  When the loop handles a change of the switch, in either direction, it writes
  a new baseline at that event's sequence (row 115). So a kill with events
  unhandled ahead of a switch-on skips none of them.

- The roles view holds no time taken from an envelope, because a reducer reads
  only the event and the sequence. It keeps the sequence of each event that a
  timer counts from. Live, the loop reads `occurredAt` from the envelope it is
  handed. When it re-arms after a restart, it reads that event with
  `client.event`, in-process, at most once for each open clock (CAPI §3; row
  122).
- On `LogWriteFailed` it stops at the unhandled event and does not advance.
  The writer has latched, so a restart resumes from the position. A defect
  is logged at error level with no event text, and the loop restarts from
  the position after a pause. A refused `roles.record` is a defect its tests
  rule out; it is logged and counts as handled, because a retry would only
  get the same stored refusal.

The first-use reactor (2e) follows the same rules for recovery, a failed
write and a defect. It is a level rule, so it writes no baseline and keeps
no position.

Request ids (row 41). Each action's request id is
`roles:<rule>:<subject>:<trigger sequence>:<action kind>:<recipient>:<occurrence>`,
where the occurrence is the stall episode, the hourly repeat's number, or
the retry's attempt number. The recipient is read from the engine's views
when the action is decided, and every other part from the roles view, so a
restart rebuilds the same id, a retry reuses it with the same body, and a
repeat gets a new one. The first baseline's id is the fixed
`roles:baseline`, and a later baseline's is `roles:baseline:<sequence>`, with
the sequence of the switch change it handles (row 115).

**WS-1: Agents know their role, their team and their rules**

This work gives Shephrd a vocabulary for roles, the roles' contracts
package, the role file, and `orient`. Role names are parsed from the free
`role` string the engine already stores (row 14).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | `parseRole("worker:builder")` gives kind `worker` and name `builder`; `parseRole("")` and `parseRole("chef")` give kind `worker` with an `unknown-kind` flag | `packages/contracts/test/roles/role.test.ts` R01-R03 |
| 1.2 | `RolesRpcGroup` is prefixed `roles.`, every payload has `requestId`, and the engine's uniqueness test passes with it | `packages/contracts/test/roles/group.test.ts` G01; `packages/contracts/test/unique.test.ts` (CAPI E1) |
| 1.3 | `rolesAccess` equals the command table above, every event in `RolesEvent` is `owner-only` in `rolesVisibility`, and `snapshotFor` returns nothing for an agent caller; each roles command sits in the planner table or the read table as the table above says, which the engine's one-table test checks (CAPI E3); every roles event enters the lifecycle table as `keep` in all seven states through `keepInEveryState` (CAPI E5), and has one sample in the engine's visibility test, which an agent never receives (CAPI E5, E8); a resent `roles.rules.add` returns the stored reply and writes nothing, and a resent `roles.actions.list` after the caller's device is revoked is refused (row 95) | `group.test.ts` G02-G06; `packages/contracts/test/state-machine.test.ts`; `packages/engine/test/api/subscribe-visibility.test.ts` |
| 1.3a | A role file over 64 KiB is refused; a rule just under 2 KiB encoded is accepted, and a rule whose fields are each within their own maxima but whose encoded total, with multibyte text, passes 2 KiB is refused; a snapshot section built from 500 rules, 200 snoozes and 256 agents, each with records of all ten action kinds, stays under 128 KiB, is filled in the stated order, marks each cut list `truncated`, and the client rebuilds the full rule set and the omitted records through `roles.rules.list` and `roles.actions.list`; the roles' largest event and page, as real encoded messages, pass the size test in `packages/contracts`, and the roles' section counts toward the 4 MiB snapshot test | `roleFile.test.ts` F06; `packages/engine/test/roles/snapshot.test.ts` SN01-SN03; `packages/contracts/test/size-limits.test.ts`; `packages/engine/test/client/snapshot-size.test.ts` (CAPI criterion 2.6) |
| 1.4 | A role file that fails the schema is refused with the failing path, and the previous file stays loaded | `packages/engine/test/roles/roleFile.test.ts` F01-F04 |
| 1.5 | A role file with a key outside the schema, such as `permission` or `rules`, is refused; so is a limit outside its bounds (row 48) | `roleFile.test.ts` F05, F07 |
| 1.6 | The exact MCP tool list in `packages/contracts/test/commands.test.ts` names `roles.orient` (CAPI E2, CAPI row 140; row 113). `shephrd roles orient` and the MCP tool, called by an agent, return its name, kind and role name, its parent's id and name, the agents it may read by CAPI's read rule with their states (its children, and, while a child is unavailable, which means in any state but idle or working, that child's children whose effective holder it is), its open-request and open-question counts, and its role's advice; called by the owner, it is refused | `packages/engine/test/roles/orient.test.ts` O01-O04, O06 (O06 a lead that becomes its worker's worker's effective holder while the worker is paused sees it, and stops seeing it when the worker recovers) |
| 1.7 | Advice text is returned inside the engine's data envelope with a fresh marker, and a leading `/` is escaped | `orient.test.ts` O05 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | `parseRole` and the three kinds, with generic advice for each: an orchestrator talks to leads; a lead starts, waits on and answers for its own workers; a worker reports to its lead, does not start agents and does not ask the owner | target `packages/contracts/src/roles/role.ts:parseRole`; pattern `packages/contracts/src/permission.ts:permissionLevels` |
| 1b | `packages/contracts/src/roles/`: the roles' command group, events, access entries, visibility entries, alert sources and the stated maxima above, each added to the engine's lists (CAPI E1, E2, E5, E8), the four alert kinds' titles in the fixed table, with the roles' events spread into the lifecycle table by `keepInEveryState` and one sample each in `subscribe-visibility.test.ts` (row 97) | CAPI §1, "Where a piece's code lives"; §5 (stated maxima); pattern `packages/contracts/src/commands.ts:CommandsRpcGroup`, `packages/contracts/src/events.ts:Event` |
| 1c | Role-file schema (role name to advice text and limits, each limit within row 48's bounds), loader from content, `roles.role-file.set` and `get` handlers | target `packages/engine/src/roles/roleFile.ts:loadRoleFile`; pattern `packages/contracts/src/harnesses.ts` |
| 1d | The roles view (role file, rules, settings, switches, snoozes, the sheepdog's action records, each agent's open matters (3.13), the stall and retry counters, with the sequence of each event that a timer counts from and no time from an envelope (row 122), each agent's highest permission mode since it started, the sheepdog's position, derived as above; the first-use reactor keeps none, because its rule is a level rule, rows 99, 104), its bounded `snapshotFor` entry, `roles.actions.list`, and its field in the engine's views (CAPI E6, E9) | target `packages/engine/src/roles/view.ts:apply`; `packages/engine/src/views/apply.ts:apply`, `emptyViews`; CAPI §1, "Views and reactors"; Board's bounded snapshot section as the pattern |
| 1e | `roles.orient` read over `client.roster` entries, which apply CAPI's read rule (§3, E8; row 96), and the role file | target `packages/engine/src/roles/orient.ts`; envelope rule `packages/engine/src/routing/envelope.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A role file is used to widen what an agent may do | major | The schema has no permission, rule or account fields (1.5); standing rules are separate, owner-only commands (WS-2). |
| An agent reaches the open loopback web server, which the owner accepted in SECURITY.md rule 2's suspension, and changes the role file or the sheepdog's settings | major | Neither grants a permission (1.5). A change through the web server raises `client.lasting-setting` (row 105), and a device caller cannot switch off that alert's push (row 117). Adding a standing rule is refused there (row 103). |
| An agent edits the owner's copy of the role file on disk, since agents run as the owner's user (engine decision row 47) | minor | The file reaches Shephrd only through `roles.role-file.set` from the owner or a device; `RoleFileSet` records its hash and device; limits are bounded (row 48). The copy on disk is outside Shephrd. |
| An agent cannot see its grandchildren while their parent is available (CAPI §3, the read rule) | minor | By design: a lead asks its workers. `orient` shows only what the roster shows, which follows the read rule, so it also shows a grandchild while the agent is its effective holder (row 96). |
| The roles' snapshot section grows past the message limit | major | A bounded summary with `truncated` marks and paged reads (1.3a). |

**Verify:** `pnpm vitest run packages/contracts/test/roles packages/engine/test/roles` at the repository root; the output lists the test files it ran. Device or environment QA: none.

**WS-2: Routine permission requests are answered by owner-approved rules**

This workstream is built only for a harness that qualifies in the 2g
recordings (lead ruling L27, rows 68, 81). If none qualifies, nothing in
WS-2 is built except the recordings (2g, 2h), the acceptance test's
standing-rule step is dropped, and WS-7a is dropped with it. The fields of
CAPI E29 stay, because L27's condition applies to the matcher and no longer to
them (row 110).

This work adds standing rules: a schema, a parser, a pure matcher, the
owner's commands, and the pre-check that WS-7a calls from the engine's permission path. The matcher
follows lead ruling L20 (rows 35, 67). It reads only the permission request
itself, as CAPI E29 records it: the tool's kind, the tool's own input from the
request (the input the harness will run, not a streamed copy), its `locations`, the flags
that say whether that input was redacted or cut, the request's title, its
options and its `settingsWrite` flag. CAPI E29 records the input for every
tool kind, and the matcher reads it only when the kind is `execute`. It checks
each `locations` entry as it checks a word (2.6; row 123). It never
reads the asker's thread.
Each harness has a pinned shape (2f), taken from the recordings of 2g: its
shell discriminator, its known input fields, how its command is written,
its working-folder field, and the field that marks a run inside its
sandbox. A rule matches only when every one of these holds:

- the harness has a pinned shape, so it is not `unsupported`;
- the tool kind is `execute`, and the request carries the harness's shell
  discriminator: a field the adapter sets, whose value the model's input
  cannot choose, and which only the harness's own shell tool produces. A
  title never counts, because adapters build titles from the model's
  input (row 54, lead ruling L25; row 79);
- every field of the input is in the harness's known-field list, the
  harness's sandboxed-run marker is present with its sandboxed value, and
  no field asks to leave or widen the sandbox: for Claude Code,
  `dangerouslyDisableSandbox` absent or false; for Codex, no
  `additional_permissions`, `with_escalated_permissions`, `prefix_rule` or
  `reason`, and `sandbox_permissions` absent or `use_default`. These Codex
  fields describe what the model asked for, not how an approved command
  runs, so none of them is the sandboxed-run marker. Under Codex's
  on-request approval policy an approved command runs outside the sandbox,
  so Codex is expected to be `unsupported`, unless the adapter's approval
  event itself says the approved command will run inside the sandbox
  (row 79). A harness whose recordings show no field that tells a
  sandboxed run from each kind of escalation is `unsupported`;
- the input was neither redacted nor cut;
- the command, in the harness's pinned form, contains only ASCII letters,
  digits, the space and `_ . / = : , @ + -`. A command written as one
  string is split on single spaces into words. A command written as a list
  is compared item by item, and each item must also contain no space. A
  shell wrapper such as `bash -lc` is accepted only in the exact form the
  harness's shape pins, and then only its script string is split;
- the words equal the rule's word list exactly; or, for a rule the owner
  marked `prefix`, the rule's words are the first words and every further
  word passes the same character check (ruling L20: "Prefix matching
  applies only on whole argv words, and only where the rule says so");
- no word contains, anywhere in it and compared without case, the name
  of a protected settings folder or file: the engine's protected names,
  imported from the engine's own function rather than copied
  (`packages/engine/src/identity/ceiling.ts:314-321`; today `.claude`,
  `.codex`, `.gemini`, `.cursor` and `.mcp.json`), and each harness's
  configured settings folder. This catches `of=.claude/settings.json`,
  `of=.Claude/x` and `--config=.codex/x` as well as a plain path, even
  when `settingsWrite` is false;
- no word, and no part of a word after an `=`, names a path that resolves
  into a protected settings location. WS-7a resolves every word, and every
  part of a word after an `=`, whether or not it looks like a path,
  against the request's working folder before the request's transaction,
  following symbolic links with the engine's own resolver, as the
  permission ceiling does, and passes the result to the matcher. So
  `cp template.json active-config` does not match when `active-config`
  links to `.claude/settings.json`. A path that cannot be resolved for any
  reason except that it does not exist counts as protected (row 79);
- the input names a working folder, and it equals the asker's folder; an
  input with no working-folder field never matches, so Claude Code's shell
  gets no matches in this version (known gap 14);
- the harness, role and group the rule lists all match: every listed
  dimension must match, and an empty or missing list matches nothing;
- the highest permission mode the asker has held since it started is at or
  below the rule's highest asker mode, which defaults to `ask`. An asker
  with any `ModeRefused` in its history counts as above every rule's
  limit, because it ran in the refused mode until the engine set it back
  (row 79);
- the request offers an `allow_once` option at or below the asker's mode,
  `settingsWrite` is false, and the rule is enabled and unexpired at the
  transaction's time.

A request that fails any check goes to its holder, exactly as today. So
does a request for which the matcher fails: WS-7a calls it as a total
function, and any error is "no match" (7.2). The match runs inside the
engine's transaction for the request, so a rule disabled, removed or
expired in an earlier transaction never answers, and nothing can change
between the match and the answer. The engine then applies its own checks
to the answer, whatever the matcher said (7.2). The log records the
answer's caller as `{ service: "roles.standing-rules", rule: "<id>" }`
(CAPI §2). Role and group names are chosen by the agents that start
agents, so they narrow a rule only by agreement; the folder, the mode and
the exact words are the real limits. `roles.rules.add`'s reply says so in
fixed text. It also warns that another agent whose folder contains the
asker's folder, such as a lead in `edit` mode, can change what the command
runs; that a rule wider than `ask` lets the asker do so itself; and, for a
`prefix` rule, that test runners and package managers accept further
arguments that run code. A symbolic link created after WS-7a's
resolution and before the command runs is not caught; known gap 20 states
it.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | A request of kind `execute` with the harness's shell discriminator and sandboxed-run marker, whose own input is the command `pnpm test` with the asker's folder, from a harness, role and group the rule names, by an asker that has only ever been in `ask` mode, matches, and the matcher returns the request's `allow_once` option id | `packages/engine/test/roles/rules.test.ts` M01 |
| 2.2 | A command containing any character outside the allowed set matches no rule: tested with `&`, `;`, `\|`, a backquote, `$`, `(`, `>`, `<`, `~`, `*`, `?`, `[`, `{`, `%`, a single and a double quote, a backslash, a newline, a tab, a carriage return, a non-ASCII space, and `[REDACTED]` | `rules.test.ts` M02-M22 |
| 2.3 | Words that differ from an exact rule's list do not match: an extra trailing word (`pnpm test -- --config x`), a missing word, a reordered word, and a doubled space; a `prefix` rule matches extra plain words and refuses an extra word with a refused character | `rules.test.ts` M23-M28 |
| 2.4 | A request whose kind is not `execute` or is absent does not match, even when it carries a `toolInput` that would otherwise match; nor does a request of kind `execute` without the shell discriminator, including a recorded or synthetic non-shell tool with the same input shape, and a non-shell `execute` tool whose title copies the shell's title | `rules.test.ts` M29-M31, M63, M71 |
| 2.5 | A request with an unknown input field, without the sandboxed-run marker, with `dangerouslyDisableSandbox: true`, with `sandbox_permissions` other than `use_default`, with `additional_permissions`, `with_escalated_permissions`, `prefix_rule` or `reason`, or from an `unsupported` harness, does not match; nor does a Codex request whose only sandbox evidence is `sandbox_permissions: use_default`, including a recorded retry-without-sandbox approval with and without `reason` | `rules.test.ts` M32-M39, M64-M65 |
| 2.6 | A request with no input, with input that was redacted or cut, with no working folder, or with a working folder other than the asker's does not match; nor does a word naming or containing a protected settings name, such as `.claude/settings.json`, `of=.claude/settings.json` or `--config=.codex/config.toml`, an upper-case spelling such as `of=.Claude/settings.json`, or a word naming an existing symbolic link to a protected settings file, each with an empty locations list; a word whose resolution fails for a reason other than "does not exist" counts as protected; an asker whose folder is under a `.claude/worktrees/` folder gets no match, even for `pnpm test`, because every word resolves into a protected location, so the rule fails closed (row 85); a `locations` entry outside the asker's folder or in a protected settings location does not match; nor does a list of 16 entries or of over 1 KiB encoded, which may have been cut with no flag, or an entry that redaction changed (row 123) | `rules.test.ts` M40-M46, M66-M68, M70, M72-M74 |
| 2.7 | A command written as a list matches item by item; a list item containing a space, a wrapper not in the pinned form, and a list whose items joined with spaces equal the rule but whose items differ do not match | `rules.test.ts` M47-M49 |
| 2.8 | A request with `settingsWrite: true`, one offering no `allow_once` option, one whose `allow_once` level is above the asker's mode, one whose asker is now in `ask` but was in `edit` earlier, and one whose asker has a `ModeRefused` in its history never match | `rules.test.ts` M50-M53, M69 |
| 2.9 | A rule listing a role and a group does not match an agent with only one of them; an empty list matches nothing; a disabled rule and a rule expired at the time passed in do not match; the lowest numeric rule id wins when two match | `rules.test.ts` M54-M58 |
| 2.10 | `roles.rules.add`, `disable` and `remove` are refused for agents and services and accepted for the owner; `roles.rules.add` is also refused for a device, and a device that replays an owner's request id and body is refused with a `CommandRefused` and no receipt (CAPI E2), while `disable` and `remove` stay open to a device; rule ids are numeric and never reused; a rule over its field bounds is refused; the reply carries the fixed warnings above | `packages/engine/test/roles/rulesCommands.test.ts` C01-C06; CAPI criterion 5.5 for the web server's refusal by name |
| 2.11 | With WS-7a, a matching request is answered in the request's own transaction, and the `PermissionAnswered` envelope's caller is the service with the rule's id; no delivery to the holder is queued; a disable committed before the request wins; with no match, the request goes to its holder | `packages/engine/test/roles/precheck.test.ts` P01-P03 |
| 2.12 | A rule's first use writes `roles.RuleFirstUsed` once, under the caller `piece { roles }`, which raises one `roles.rule-first-use` alert, also when the service restarts between the answer and the reactor's write, and when two uses land in one batch; the alert ends only when the owner dismisses it or the rule is disabled or removed | `precheck.test.ts` P04-P05, P07 |
| 2.13 | `roles.rules.add` refuses a rule whose harnesses are all `unsupported`, and `roles.rules.list` marks a rule `inactive: harness unsupported` when its last supported harness loses its pinned shape | `precheck.test.ts` P06 |
| 2.14 | Each harness's recordings (2g) parse into the matcher's inputs and pin its shape; a harness whose recordings show no shell discriminator, or no field that separates a sandboxed run from each recorded escalation, is `unsupported`; a shell discriminator that is only a title is refused | `packages/engine/test/roles/fixtures.test.ts` X01-X04 |
| 2.15 | A matcher given deeply nested, very large or wrongly typed input returns "no match" and never throws | `rules.test.ts` M60-M62 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a | Rule schema: numeric id, harnesses, roles and groups (each at most 8 entries of at most 64 characters), the word list (at most 16 words of at most 64 characters), the `prefix` flag (default off), highest asker mode (default `ask`), folder scope (`own-folder` only in this version), optional expiry, enabled flag, the adding device, owner note (at most 256 characters); the bounds keep a rule under 2 KiB encoded | target `packages/contracts/src/roles/rules.ts:StandingRule`; pattern `packages/contracts/src/permission.ts` |
| 2b | Command parser: refuses any character outside the allowed set, then splits a string on single spaces, or checks a list item by item; nothing is stripped or rewritten | target `packages/engine/src/roles/commandWords.ts:splitCommand`; new code (the CLI's `sanitize.ts` strips characters, which is the opposite, so it is not the pattern) |
| 2c | `matchRule(request, asker, rules, now)`: pure and total; returns an option id or a reason; uses the engine's option kinds and levels, the protected settings names compared without case, and WS-7a's resolved-path results | target `packages/engine/src/roles/rules.ts:matchRule`; `packages/contracts/src/permission.ts:acpPermissionOptionKinds`, `permissionForOptionKind`; `packages/engine/src/identity/ceiling.ts` l.239-244, l.317 |
| 2d | Rule commands' planners and their events | target `packages/engine/src/roles/rulesCommands.ts`; CAPI §1, "How a piece's command runs" |
| 2e | `matchRule` as the matcher WS-7a calls; the roles' first-use reactor, a level rule over the views that keeps no position and starts after `recovery.whenReady` (CAPI §1, "Views and reactors"): for each rule whose use count is above zero and that has no `RuleFirstUsed`, it gives the piece batch path a function from the views to a batch holding `RuleFirstUsed`, under the caller `piece { roles }` (CAPI E23); a use is a `PermissionAnswered` whose durable `answeredBy` (CAPI E14) is the standing-rules service with that rule's id, and the envelope's caller and device also survive a read of the log (CAPI E11 and E12, the durable form), so a rebuild after a restart sees the same rule (rows 98, 99) | target `packages/engine/src/roles/precheck.ts`; CAPI §1, "Views and reactors"; WS-7a |
| 2f | Per-harness shapes from 2g's recordings: shell discriminator, known-field list, command form (string, list or pinned wrapper), working-folder field, sandboxed-run marker | target `packages/engine/src/roles/harnessInputs.ts` |
| 2g | Record scrubbed shell-permission samples for each harness (Claude Code through `claude-agent-acp`, Codex through `codex-acp`): one plain sandboxed command; one with each sandbox-escape field the harness supports; for Codex, a `require_escalated` request and Codex's own retry-without-sandbox approval, with and without `reason`, in its `read-only` and `workspace-write` modes, and under any approval policy that might let Codex qualify (row 81); one request from any other tool of kind `execute` the harness has; and the tool-call frames around each. A short live run on the owner's accounts, approved by the owner | targets `packages/testing/fixtures/claude-shell-permission.ndjson`, `codex-shell-permission.ndjson`; the recorder as prepared by 2h |
| 2h | Prepare the recorder for 2g: a scenario, permission mode, harness and output path chosen per run, keeping the greeting fixtures and their paths unchanged, and the scrubbing the greeting recordings already get | targets `packages/engine/scripts/record-fixtures.ts`, `packages/engine/scripts/recorder.ts` (today fixed to read-only mode, l.217-225, and to `<harness>.ndjson`, l.293-296); pattern `packages/engine/scripts/live/prompts.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A rule is stretched by a crafted command (compound shell, extra arguments, quoting, expansion, argument lists) | blocker | The allowed character set, the exact word list, the opt-in `prefix` with its warning, item-by-item lists (2.2, 2.3, 2.7); attack pass on units 3 and 11a. |
| A rule approves a run outside the harness's sandbox, including an escalation that carries no named field | blocker | A positive sandboxed-run marker set by the adapter's approval event, never the model's own fields; Codex expected `unsupported`; `unsupported` whenever recordings cannot tell them apart (2.5, 2.14, row 79). |
| Standing rules ship into the engine's permission path, but no harness qualifies | major | Lead ruling L27: the recording run comes first, and the matcher and WS-7a's rule check are built only for a harness that qualifies (rows 68, 81). |
| A rule meant for the shell approves another tool | major | Kind `execute` plus the pinned shell discriminator (2.4); lead ruling L25 (row 54). |
| The matcher approves an input other than the one that runs | major | It reads only the request's own input, and refuses a redacted or cut one (2.6). |
| A rule writes a harness settings file through an argument or a link | major | The protected-name check inside every word, without case, and WS-7a's resolved paths (2.6); a link made after the check is known gap 20. |
| A rule for a test command lets an agent run what it or another agent wrote | major | The highest mode since start defaults to `ask` (2.8); the fixed warnings name other agents' folders (2.10). The guard cannot see edits by an agent whose folder contains the asker's; that is stated, not fixed. |
| A team whose worktrees sit under `.claude/worktrees/` gets no standing-rule matches, and the engine's ceiling sends their file edits to the owner, because the engine's settings test matches any `.claude` segment | minor | It fails closed (2.6, PC14). `docs/foundry.md` names a worktree root outside any settings folder (8.1). Narrowing the engine's settings test is offered to plans-lead as an issue, because it touches a settings rule (row 85). |
| A matcher defect loses a permission request | major | WS-7a treats any matcher error as no match (2.15, 7.2). |
| Claude Code's shell input names no working folder, so Claude agents get no matches | minor | Fail closed by design (2.6); known gap 14; a launch setting is a feature idea. |
| A rule outlives its purpose | minor | Optional expiry; the first-use alert (2.12); the owner lists rules from any client. |
| A stolen phone or an open web request adds a rule | major | `roles.rules.add` is computer-only: its access is `owner` alone, and the web server refuses it by name (2.10; CAPI §2, criterion 5.5; row 103). While the web server is open, this is also a guard and not a boundary, because a web caller can start an agent or set a harness's adapter, and that program can read the owner credential (CAPI §2's list of exceptions; row 117; known gap 23). |

**Verify:** `pnpm vitest run packages/engine/test/roles` at the repository root; the output lists the test files it ran. Device or environment QA: the owner's recording run for 2g, which comes before units 3, 4 and 11a and decides whether they are built (row 81).

**WS-3: A sheepdog keeps every agent moving**

This work builds the sheepdog's base inside the roles piece (row 23): the
service registration, the sheepdog's start-up and position, the settings and switches,
snoozes, notices, request ids and timers. The rules in WS-4 and WS-5 plug
into it.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | The roles view rebuilt from the log equals the live view, through the engine's rebuild check; folding the same events with placeholders for everything in the envelope but the event and the sequence gives the same view (row 122) | `packages/engine/test/support/rebuildCheck.ts` run over the roles suite; `packages/engine/test/roles/sheepdog/fold.test.ts` S01, S02 |
| 3.2 | After a service restart in the middle of a run, the sheepdog sends no nudge, notice, retry or compaction it had already recorded; a kill between a command and its action record, for each action kind, leads to exactly one command | `fold.test.ts` S02-S03 |
| 3.3 | Request ids follow the rule above: an hourly repeat and a stall's later episode get new ids; a retry of one action reuses its id and body; two recipients of one trigger get two ids | `fold.test.ts` S04-S06 |
| 3.4 | Each service has its own command list in the engine's service list (`packages/engine/src/commands/services.ts`, CAPI E13): `roles.sheepdog` may call `subscribe`, `client.event`, `prompt`, `compact`, `resume`, `release`, `roles.record`, `board.post`, `board.flush` and `board.status`; `roles.standing-rules` may call nothing; a test calls the real service entry point under each name and checks that every other command, including `answer`, `board.close`, `start` and `stop`, is refused; `roles.record` refuses every event kind outside the sheepdog's own action kinds and its baseline, including `RuleAdded`, `RuleFirstUsed` and `SettingsChanged`; an import-boundary test fails if any file in `packages/engine/src/roles/sheepdog/` or the services' files imports `log/EventLog`, `runner/*`, `effect/sql` or `commands/CommandHandler`, so roles code reaches the engine only through the service entry point, the views, the piece batch path and the helpers of CAPI E22 (rows 92, 99); CAPI E23's own boundary test covers every file under `packages/engine/src/roles/` | `packages/engine/test/roles/sheepdog/calls.test.ts` K01-K04; `packages/engine/test/roles/imports.test.ts` B01 |
| 3.5 | A notice to an agent is a `board.post` by `service roles.sheepdog` with a `direct` target and `reply: none`, followed by `board.flush` for exactly the kinds listed above; its body is fixed text plus sanitized names; a notice to the owner is a roles event that raises its alert | `packages/engine/test/roles/sheepdog/notices.test.ts` N01-N03, N07, N21 (N21 a flush refused because the recipient has just crashed keeps the record, stops nothing, and the notice goes once to the new holder) |
| 3.6 | With the board switched off, no notice is sent, the sheepdog's `board.status` reads still succeed and say `disabled` with empty condition lists (row 102), its action record says `board-off`, the stall, team-idle and flush rules are suspended with their counts kept and their clocks restarted from zero when it is switched on, and a `GaveUp` raises its owner alert unless an engine `failure` alert covers it, including after a crash of a worker whose recorded recipient is a live lead | `notices.test.ts` N06, N11-N12, N20 |
| 3.7 | A notice goes to the subject's nearest idle or working ancestor, or to the owner when there is none; a notice still unread when its recipient crashes is sent once to the new holder; read state comes from the roles view's fold of the notice's post id, so a notice the recipient read or accepted is not re-sent, after a restart too | `notices.test.ts` N08-N09, N15-N16 |
| 3.8 | `roles.snooze` silences team-idle notices for that group until the time passes; `roles.settings.set` changes a limit and the next check uses it; a value outside its bounds is refused with its path | `notices.test.ts` N04-N05, N10 |
| 3.9 | Timers are re-armed from the view at start-up, each with the time of its starting event, read by sequence (row 122); a stall, team-idle or capacity deadline that passed while the service was down is re-checked and fires once, one step only; a cache deadline that passed is dropped | `packages/engine/test/roles/sheepdog/timers.test.ts` T01-T04 (`TestClock.adjust`; T04 a restart re-arms from the read time) |
| 3.10 | With `sheepdog: off`, the sheepdog sends nothing, cancels its timers and keeps folding events; with WS-7b it first releases each held delivery once, and the engine holds no new delivery while it is off, so a released delivery that meets capacity again is returned to its sender as today; with `standing-rules: off`, the pre-check matches nothing; switching back on re-arms the timers under 3.9's rules; at start-up with the sheepdog off, every hold still open is released once | `packages/engine/test/roles/sheepdog/switch.test.ts` W01-W07 |
| 3.11 | A turn started by a wake that lists only the sheepdog's posts, or by its carry-on prompt, is a sheepdog turn; a turn started by a wake that also carries another author's post, or any completion, is not (row 90); a compaction the sheepdog requested is a sheepdog turn; `roles.StallEnded` is written at the first turn that is not a sheepdog turn, and the alert ends through the client API's alert reactor, for a sheepdog-only wake followed by a mixed wake | `notices.test.ts` N13-N14, N17-N19 (N19 a sheepdog notice in the same wake as a completion is an ordinary turn) |
| 3.12 | The sheepdog and the first-use reactor do nothing while recovery is held open; a first start on a log with history writes one `roles.SheepdogBaseline` at the views' sequence, resumes no old crash, and starts every clock from then; a later restart subscribes after the derived position, whose highest `sourceSequence` never passes an unhandled event, and repeats no action; a `roles.SettingsChanged` moves no position until the loop handles it, so a kill with events unhandled ahead of a switch-on skips none, each is handled under the switch it came under, and a replayed switch change writes one baseline, under the same request id (row 115); a crash while switched off is not retried after a restart or a switch-on; `LogWriteFailed` stops the loop without advancing; a defect is logged with no event text and restarts the loop; a refused `roles.record` counts as handled (row 104) | `packages/engine/test/roles/sheepdog/startup.test.ts` SU01-SU10 |
| 3.13 | `openMatters(views)` is a pure function over the rebuilt views, and only the alert reactor's first-start scan calls it. It returns each open `roles.stall`, `roles.replace` and `roles.runaway` matter, with the same key, kind, agent and subject that the alert source gives for the record. A record for a recipient other than the owner gives none, except a `GaveUp` whose notice is `board-off`. A `GaveUp` with `engineAlertOpen` true gives none. A stall followed by `roles.StallEnded`, a replace advice whose agent is stopped, and a runaway report whose turn has ended or whose agent is stopped each give none. `roles.rule-first-use` gives none (rows 40, 72, 112) | `packages/engine/test/roles/openMatters.test.ts` OM01-OM05 |


**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a | Add `roles.sheepdog`, with its command list, and `roles.standing-rules`, with none, to the engine's service list (CAPI E13); the `roles.SheepdogBaseline` kind and the derived position in the roles view; the `roles.record` planner with its closed list of the sheepdog's kinds, written through the piece batch path (CAPI E23) | CAPI §2, "Services"; §1, "Views and reactors" |
| 3b | Settings shape, bounds and defaults (rows 16, 25, 48, 73), the two switches (row 46), with per-role overrides from the role file | target `packages/engine/src/roles/sheepdog/settings.ts` |
| 3c | Notices through `board.post` and `board.flush`, the recipient rule, the flush list, the `board-off` record and suspension, owner notices as roles events, the notices' read state (row 69), the sheepdog-turn test and `roles.StallEnded` (row 76) | target `packages/engine/src/roles/sheepdog/notices.ts`; Board, "For Shephrd's own services", `board.WakeBuilt`; `packages/engine/src/routing/holders.ts:holderAbove` |
| 3d | Timers on Effect's clock, re-armed from the view; each rule declares whether a missed deadline is re-checked or dropped | pattern `packages/engine/src/accounts/timers.ts:startAccountTimers` (and its re-check of deadlines crossed during a tick, issue 210) |
| 3e | Action request ids (row 41) | CAPI §5, "Request ids" |
| 3f | The on/off switches and their effect on timers, held deliveries, the capacity-hold condition (7.3) and the pre-check | target `packages/engine/src/roles/sheepdog/switch.ts` |
| 3g | Start-up and position: the wait for recovery, the baseline and first scan, the baseline on each switch change (row 115), the one loop for stream events and timers, the stop on `LogWriteFailed` and the restart after a defect (row 104) | target `packages/engine/src/roles/sheepdog/loop.ts`; CAPI §1, "Views and reactors"; CAPI E6, E9, E13; patterns `accounts/available.ts:84`, `routing/deliveries.ts:317` |
| 3h | `openMatters(views)` and the roles' entry in the client API's table typed over `PieceNamespace`, which unit 1 writes as "none", called through `guardPiece` (rows 112, 121) | target `packages/engine/src/roles/openMatters.ts`; CAPI §4; CAPI row 136 |


**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Duplicate or lost actions across a restart | major | 3.2, 3.3 and 3.12; the sheepdog's action records and request ids, and `roles.record`'s receipts, make a retried action safe; the first-use reactor is a level rule, safe to run twice (CAPI §1). |
| The service callers' rights are wider than they need | major | 3.4, including `roles.record`'s closed list. |
| A notice is read by the lead as an instruction from another agent | minor | Only an in-process service can be a post's author, and the wake's header names it as `service roles.sheepdog` from fixed words (Board, "How a wake reaches an agent"); the notice text is fixed by Shephrd. |
| A notice reaches a holder that cannot act | major | 3.7. |
| The board is switched off and every open post looks stalled | major | 3.6 suspends the board-dependent rules; give-ups still reach the owner. |
| A defect in the roles needs them stopped while the engine keeps running | major | 3.10; nothing stays held once the sheepdog is off; the engine is never downgraded once roles events exist (row 46). |

**Verify:** `pnpm vitest run packages/engine/test/roles` at the repository root; the output lists the test files it ran. Device or environment QA: none.

**WS-4: Stalls, crashes and capacity errors are handled without the owner**

Each rule is a pure function from the roles view, the engine's views, the
board's status (its fixed-size summary, and its `incoming` and `own`
detail lists, and, with no agent, the ids of the agents for which each
board condition holds and the sequence they were computed at, Board v10)
and the clock to a list of actions, so each is
tested alone.

An agent is **busy** when it is starting or working, has a delivery
queued or sent, has an open capacity hold (row 129), or is paused for a usage limit with a known reset, because
the engine will resume it (row 74). An agent signed out of its account,
or paused for a usage limit with no known reset, counts as the owner for
these tests, because the owner already has the alert and no timer will
resume it; when the account becomes usable again, the clocks that it
stopped restart from zero (row 83). For the waiting test, a party is busy
only for work the sheepdog did not cause: a sheepdog turn, or a queue
holding only a sheepdog wake, does not make it busy, as it does not for
team idleness (row 88). An agent A **waits on** another party through: a child of
A; an open engine wait of A, on its members; an open request or question of
A, on its holder; and an open post of A's own that needs a reply, on each
addressee with no disposition yet. A stopped or crashed agent waits on nobody,
so an open question it asked adds no link (row 125). A is **waiting on others** when some party
reachable from A through "waits on" links is busy, is the owner, or holds
an open request or question of the agent that waits on it (rows 56, 74).
The search keeps a visited set, so a cycle of idle agents ends as "not
waiting". When nothing reachable is busy, A is not waiting on others, so a
chain or a cycle of agents that each wait on the next, with none busy, is
stalled at every link that owes a reply. A chain that ends at a busy agent
is stalled nowhere, with one exception: the clock for a post P and its
addressee A also runs when P's author reaches nothing busy except through
A, because the author is then blocked on A alone. So a lead that a worker
asked a question is nudged about it even while a sibling works (row 88).

`stop` writes `PermissionCancelled`, with the reason "agent stopped", and a withdrawal, for each open permission request the stopped agent asked (edit E31). A question from a stopped asker stays open. Nothing may count on a stopped asker's permission row being open, and a resumed agent has no such row.

So the waiting test, the runaway limit's exclusion for holding a request and
the cache rule's skip read the row, and they need no case of their own for a
stopped asker (row 125).


The stall rule is a small state machine for each pair of an open post P and
one addressee A (row 37). Its clock runs only while A is idle, has no open capacity hold, no delivery
to A is queued or sent, P is open and needs A's reply, A is not waiting on
others, A is not paused, and the board is on. When the clock stops for any
other reason, it restarts from zero the next time it runs, so time spent
waiting on a busy agent never counts. A turn that ends restarts it too.
When the clock reaches A's role limit L (10 minutes for a worker, 20 for a
lead or orchestrator), an episode begins:

- episode 1: A is nudged;
- episode 2: A is nudged again, and A's holder is told that A stalled
  twice on P;
- episode 3: `ReplaceAdvised` tells A's holder to replace A, offering
  `roles.handoff`, and the sheepdog stops nudging A about P.

The episode count resets to zero when A makes progress (a thread item that
records a file change, a reply to P, or a board post by A made outside a
sheepdog turn), when P closes, or when A's part of P is resolved. Tool
calls alone are not progress, and nor is a post A writes in a turn a nudge
started (row 78). The count lives in
the roles view as `StallSeen` records, so a restart continues it. Each
episode needs the clock to run its full limit again, so a stall never steps
twice at once.

A turn's start is the time of the `DeliverySent` that made the agent
working, because the engine writes no `TurnStarted` (row 64). The delivery
it sent says what kind of turn it is: a compaction, a sheepdog turn, or
ordinary work.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Team idle: a group with at least one live, unpaused member, none of whose members is busy, for 60 minutes, gets one nudge to each of its top agents (each member whose parent is outside the group) and one notice to each distinct holder of those; then hourly; sheepdog turns do not restart the hour; a group whose members are all stopped or paused gets nothing; a group of an idle lead and a worker paused for a usage limit with a known reset, mid-turn or not, gets nothing; a worker paused with no known reset, accepted mid-turn or not, counts as the owner, so its idle lead is not nudged, and when the account becomes usable the hour restarts from zero, also across a restart; a snoozed group gets nothing | `packages/engine/test/roles/sheepdog/rules/teamIdle.test.ts` TI01-TI08, TI10-TI12 |
| 4.2 | Stall: the state machine above, through three episodes on a simulated clock: nudge, nudge and holder notice, `ReplaceAdvised`; a file change, a reply to P or a post outside a sheepdog turn resets the count; tool calls alone do not, and nor does a post written in a nudge's turn; P closing resets it; the count survives a restart; a lead nudged by the sheepdog does not count as busy for its worker's clock, so the worker reaches `ReplaceAdvised` on schedule (row 88) | `rules/stall.test.ts` ST01-ST08, ST18, ST20 |
| 4.3 | A lead that holds an open `all` post to its working workers, and a worker with an open wait on a working agent, are not stalled; a lead that posted H to a worker and a worker that posted question Q back, both idle with nothing pending, both stall; the same with an engine wait in place of a post; a group whose only activity is such a cycle counts as idle; a worker that posted a question to its idle lead while a sibling works is not stalled, and nor is the lead; an orchestrator over idle leads whose workers work is not stalled; a chain that ends at an idle agent stalls; a lead whose only child is paused for a usage limit is not stalled, with a known reset or with none; a lead asked a question by a worker whose sibling works is still nudged about it, because the asker reaches nothing busy except through the lead (row 88); a lead whose worker's pause has no known reset is not stalled, and its clock restarts from zero when the account is usable (row 83); when a worker with an open permission request to its idle lead is stopped, the row closes and the lead's clock restarts from zero; a stopped worker whose open question the owner holds does not make its lead wait on the owner (row 125); a worker with an open capacity hold and an empty queue is busy, so its clock does not run and its lead is not stalled (row 129) | `rules/stall.test.ts` ST09-ST13, ST15-ST17, ST19, ST21-ST25; `rules/teamIdle.test.ts` TI09 |
| 4.4 | Runaway: a turn longer than the role's turn limit (default 120 minutes from its `DeliverySent`, not counting time paused, holding an open permission request, or inside an open blocking `wait` (row 77)) tells the holder once per turn; a worker older than the worker age limit (default 120 minutes from `AgentStarted`, the Foundry's worker cap) tells the holder once, suggesting a hand-off; a lead or orchestrator has no age limit unless its role file sets one; a lead in a blocking `wait` on working workers for three hours is not reported; a holder's time counts again once the asker of its open request is stopped (row 125) | `rules/runaway.test.ts` RW01-RW07 |
| 4.5 | Capacity: a held delivery is released after 5 minutes, at most 12 times in one outage; after the last release, the hold condition says no, so the next capacity error returns the delivery to its sender as today, and `GaveUp { cause: capacity }` tells the holder, flushed, to move the work to another model; the count is the engine's own, per agent and outage (7.3), so a release by the owner or the holder counts too; an outage ends, and the count resets, when a turn ends with no capacity error, when a later error is not a capacity error, or when the capacity return happens; the sheepdog writes `GaveUp { cause: capacity }` on the `DeliveryReturned` whose `cause` is `capacity`, once per outage, and a later hold starts a new count (row 89); with the sheepdog off, the error returns the delivery to its sender, as before this plan | `rules/capacity.test.ts` CP01-CP10 (CP08 the give-up from the return, CP09 a non-capacity error ends the outage, CP10 a hold after the give-up starts a new count) |
| 4.6 | Crash: on the first `AgentCrashed` for an agent within an hour, the sheepdog checks that the crash is still current, calls `resume` once, and after `SessionOpened`, if the engine queued no carry-on, sends one `prompt` with fixed carry-on text; it then tells the holder (`CrashRetried`) that the agent was resumed, that the holder's posts to it resolved as `gone` and must be posted again if still needed, and not to replace it unless told the sheepdog gave up; a refused `resume`, an `AgentReloadFailed`, or a second crash within the hour writes `GaveUp` with its cause and tells the holder at once; with the crash-retry setting at 0, the first crash writes `GaveUp` at once (row 73) | `rules/crash.test.ts` CR01-CR07 |
| 4.7 | Usage-limit and sign-in pauses are never nudged and never counted as stalls or team idleness | `rules/stall.test.ts` ST14; `rules/teamIdle.test.ts` TI04 |
| 4.8 | Role advice: a worker that itself starts an agent, posts to the owner, or passes a question up is reported to its holder once per kind of break; a question moved by an ancestor's `pass-up` or by the holder chain is not reported | `rules/roleAdvice.test.ts` RA01-RA04 |
| 4.9 | A notice whose recipient is the owner raises the alert in the table above instead of a post: one test per action kind; `GaveUp` raises `roles.stall` for each cause unless an engine `failure` alert for that agent is open, so an owner-held agent whose reload failed after the sheepdog's resume, or whose `resume` was refused, raises none while the engine's alert stands, because a failed reload keeps that alert open (CAPI §4), and raises one if the owner has dismissed it (row 105); role advice raises none | `rules/ownerAlerts.test.ts` OA01-OA09 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 4a | Team idle rule over engine groups, per top agent and per holder, with the "busy" test, which counts a usage-limit pause as busy (row 74) | target `packages/engine/src/roles/sheepdog/rules/teamIdle.ts`; groups from `AgentStarted.groups` and `AgentGrouped` (`packages/contracts/src/events.ts:Event`); `FOUNDRY/scripts/team-idle-watch.sh` l.13-14 ("Only 'working' counts as busy") |
| 4b | Stall state machine, with its counter per post and addressee (row 37), and the transitive "waits on" and "waiting on others" tests (rows 56, 74) | target `rules/stall.ts`; Board v10, `board.status` with `detail` `incoming` and `own`, and with no agent for the condition lists (Board row 103), and its pure-function export from `packages/engine/src/board/` ("For Shephrd's own services"); the shared settled test in `packages/contracts/src/settled.ts` (CAPI E19), which replaced `routing/waits.ts:settled`: the sheepdog applies its engine part itself, from the engine's deliveries with their status, and the board's part through `board.status` with no agent, whose lists carry the sequence they were computed at; it decides only when both agree at one sequence, as the client wait helper does (CAPI §3, lead ruling L30; row 100) |
| 4c | Runaway rule from `DeliverySent`, `TurnEnded`, pauses, permission requests and blocking waits (`packages/engine/src/routing/waits.ts` l.162-170); worker age rule from `AgentStarted` | target `rules/runaway.ts`; `packages/engine/src/routing/deliveries.ts` l.248 (`DeliverySent`); `FOUNDRY/scripts/context-keeper.sh` (`WORKER_MAX_MIN`) |
| 4d | Capacity rule over `DeliveryHeld`: release timer, and the give-up triggered by `DeliveryReturned` with `cause: "capacity"`; the hold condition reads the engine's own count (7.3, rows 75, 89) | target `rules/capacity.ts`; WS-7b's `DeliveryHeld` and `DeliveryReleased`; `FOUNDRY/scripts/capacity-retry.sh` (5-minute backoff, 12 retries) |
| 4e | Crash rule: re-check, one `resume`, the carry-on prompt, then give up, with `engineAlertOpen` | target `rules/crash.ts`; `AgentCrashed` from `packages/engine/src/recovery/crash.ts:64`; `packages/engine/src/commands/resume.ts` l.26, l.51-54; `packages/engine/src/recovery/reload.ts:reloadedEvents`; CAPI §4 (the engine's `failure` alert and when it clears) |
| 4f | Role-advice rule over the envelope's caller | target `rules/roleAdvice.ts`; `parseRole` (WS-1); `AgentStarted.parent`, `QuestionMoved` and its caller |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Notices wake leads so often that they cost more than they save | major | One notice per event; hourly repeats at most; only decision notices are flushed; snooze. The acceptance test counts lead wakes (8.3). |
| A lead or worker rightly waiting on a busy agent is treated as stalled | major | The "waiting on others" test (4.3). |
| Two idle agents wait on each other and nothing fires | major | Waiting counts only while an agent reachable through the waits is busy (4.3). |
| A usage-limit pause makes a team look idle | major | A paused agent with a known reset counts as busy (4.1, row 74). |
| With the sheepdog off, capacity errors wake their senders, as before this plan | minor | By design: the hold needs the sheepdog to release it (7.3). |
| A crash loop on resume | major | One retry per hour per agent (row 17). |
| The engine's own crash notice wakes the holder before the sheepdog's notice, and the holder starts a replacement anyway | minor | The sheepdog's notice says what it did; known gap 15. |

**Verify:** `pnpm vitest run packages/engine/test/roles` at the repository root; the output lists the test files it ran. Device or environment QA: none.

**WS-5: Waiting messages and compaction are timed to the prompt cache**

A prompt cache's life starts when a model request starts, and a request
that reads the cache renews it for the lifetime it was written with
(row 45; Claude prompt-caching documentation, read through context7 on
2026-11-03). The sheepdog therefore takes, for the last model request of an
agent's last turn, its start time and the cache lifetimes it read or wrote.
The start time is the request's own if the usage source gives it, and
otherwise the turn's start, the `DeliverySent` that began it (row 64), which
is earlier and therefore safe. The lifetime is one hour when the request
wrote only one-hour cache tokens, and five minutes when it wrote any
five-minute tokens. A request that only read the cache takes the lifetime
of the latest write the usage source shows for that session; if there is
none, the expiry is unknown (row 64). When the source gives no split
between the two lifetimes, the owner's per-harness `cacheLifetime` setting
is used; it has no default, so nothing is scheduled until the owner sets
it. The expiry is the start time plus the lifetime. If it has already
passed, or is unknown, nothing is scheduled. Two minutes before the expiry,
for an idle agent with nothing queued or sent, no open request or question
of its own, no open blocking `wait`, and no compaction under way or just
done (row 84): if
`board.status` shows unread posts and the board is on, the sheepdog calls
`board.flush` (row 28); otherwise, if the agent's context is at least its
role's floor (default 150,000 tokens; a role file may switch compaction off
for a role), it asks for a compaction.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | A last request that started at time T, wrote only one-hour cache tokens, and left 200,000 context tokens, with no unread posts, gives a compact request at T + 58 minutes | `packages/engine/test/roles/sheepdog/rules/cache.test.ts` CM01 (`TestClock.adjust`) |
| 5.2 | The same with two unread posts gives a `board.flush` at T + 58 minutes and no compaction | `cache.test.ts` CM02 |
| 5.3 | Nothing is sent when the agent has a delivery queued or sent, an open capacity hold (row 129), an open request or question it asked, an open blocking `wait`, is compacting, or its last turn was a compaction; an open non-blocking wait and an open post of its own do not block it, so an idle lead whose workers are working is flushed or compacted (row 84); a newer turn replaces the timer; the guard is checked again at the moment of sending | `cache.test.ts` CM03-CM07, CM18-CM20 (an idle lead with a working worker and 200,000 tokens is compacted at T + 58 minutes; an idle orchestrator over working teams likewise; CM20 an agent with an empty open hold gets nothing) |
| 5.4 | No compaction below the floor, with compaction off for the role, or with an unknown expiry | `cache.test.ts` CM08-CM10 |
| 5.5 | A four-minute turn on a five-minute cache, timed from its `DeliverySent`, schedules nothing, because the deadline has passed; a request with both lifetimes uses five minutes; a read-only request after a one-hour write uses one hour; a read-only request with no write in view schedules nothing; with no lifetime split and no `cacheLifetime` setting, nothing is scheduled | `cache.test.ts` CM11-CM15 |
| 5.6 | Usage comes from `TurnEnded` (WS-7c) when the adapter reports it; otherwise from the Claude transcript, and a missing transcript schedules nothing | `cache.test.ts` CM16-CM17 |
| 5.7 | The transcript reader refuses a session id outside the expected format, opens one expected path without following a symbolic link, reads at most a bounded tail, keeps only numbers and timestamps, and never logs or records text it read | `packages/engine/test/roles/sheepdog/usage.test.ts` U01-U04 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5a | Expiry rule and schedule | target `packages/engine/src/roles/sheepdog/rules/cache.ts`; design read from T3 Code `apps/server/src/orchestration-v2/IdleCompaction.ts` (read, not copied; copying invokes AGENTS.md rule 2) |
| 5b | Usage source: `TurnEnded` (WS-7c) or the transcript reader, hardened as in 5.7 | target `packages/engine/src/roles/sheepdog/usage.ts`; fields from `FOUNDRY/scripts/context-keeper.sh:last_call` (`.message.usage.input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; scouting.md, Scout S answer b), plus `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`; reader pattern `packages/engine/src/identity/ceiling.ts` l.97-120 (`O_NOFOLLOW`) |
| 5c | `board.flush` and `compact` through the service caller | Board, "For Shephrd's own services"; `packages/engine/src/runner/compact.ts:compactPrompt` (read only) |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The Claude ACP adapter writes no transcript, or writes it elsewhere | major | Post-build check 2 and the live check; without a transcript nothing is scheduled, which is today's cost. |
| The transcript reader leaks a credential from the account's configuration folder | major | 5.7; with WS-7c the reader is not used. |
| A compaction lands just as work arrives, or before the cache really expires | minor | 5.3 and 5.5; the engine refuses `compact` on an agent that is not idle. |
| A harness whose adapter reports no usage gets no timing, except Claude through its transcript | minor | Known gap 5. |

**Verify:** `pnpm vitest run packages/engine/test/roles` at the repository root; live check 8.4. Device or environment QA: the live check.

**WS-6: A replacement worker starts from what the old one did**

`roles.handoff` pages through the agent's thread with the engine's paged
read of one agent's events (CAPI E21) and returns a budgeted hand-off (rows 47, 62). Two limits
hold at once: 16,000 tokens, counted as the UTF-8 byte length divided by
three and rounded up, which over-counts English text and so is safe without
a tokenizer, so at most 48,000 bytes; and 64 KiB for the whole encoded
reply, envelope included. The token limit is the tighter one. Every size
below is measured on the encoded text. The hand-off is filled in this
order, and a later step gets only what is left:

1. The first prompt, up to 20 KiB. A longer one is cut at a character
   boundary, followed by a fixed marker that gives its sequence number. A
   thread with no first prompt says so.
2. The last exchange, up to 20 KiB. Its tool calls' input and output are
   shortened first, then its messages are cut, each with the same marker.
3. The most recent tool calls and file changes, each shortened to 240
   characters, while both limits allow.
4. The sequence numbers of everything left out, as ranges.

The hand-off is written to its caller, the lead, who may manage the old
worker by the engine's rights helper (CAPI E22). The markers tell the lead which sequences hold
the rest, which the lead reads with `client.thread`. To an agent caller, a
page of `client.thread` comes inside the data envelope, with a fresh marker and
an escaped leading slash (CAPI §3, CAPI row 140; row 114), so what the lead
reads there is data, as the hand-off is. `roles.handoff` uses the paged read of
CAPI E21, not `client.thread`, and wraps its reply once (6.4).

`client.event` is agent-callable, under the read rule, and is in the MCP tool pin with `client.snapshot`, `client.roster` and `client.thread`. An agent's reply to `client.thread` and `client.event` is `{ requestId, data }`, where `data` is the data envelope around one line of JSON. The tool and the command line return it unchanged. Owner-only events stay unavailable to an agent.

So the lead's read of a marked sequence receives `data`, and a service caller's
reply is plain (row 119). The replacement cannot
read its predecessor's thread, because a sibling never reads another
agent under CAPI's read rule (§3); the plan does not widen that. The recipe in `docs/foundry.md`
says the lead includes the hand-off in the replacement's first prompt with
a fixed line telling it to ask its lead, by a board post, for any part
marked as cut; the lead then reads that part and posts it to the
replacement (row 62).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | For a 5,000-item thread with small items, the hand-off contains the first prompt and the last exchange whole and stays under both limits | `packages/engine/test/roles/handoff.test.ts` H01-H02 |
| 6.2 | For a 100 KiB first prompt, a last exchange with a 200 KiB tool output, and multibyte text, the hand-off stays under both limits with both sections at their caps, cuts each with a marker that names its sequence, and never splits a character | `handoff.test.ts` H03-H05 |
| 6.3 | It lists the sequence numbers it left out | `handoff.test.ts` H06 |
| 6.4 | The old agent's text is inside a data envelope, and text the log redacted stays redacted | `handoff.test.ts` H07 |
| 6.5 | An agent may ask only for an agent it may manage, by the engine's rights helper, checked on every request, including a resent one, because `roles.handoff` is a read and never deduplicated (row 95); an orchestrator may ask for a worker while that worker's lead is paused, and is refused once the lead recovers; the replacement's own `roles.handoff` and `client.thread` for its predecessor are refused, and the lead's `client.thread` read of a marked sequence succeeds, with the reply `{ requestId, data }` and the page inside the data envelope (rows 114, 119); the exact MCP tool list in `commands.test.ts` names `roles.handoff` (row 113) | `handoff.test.ts` H08-H12; `packages/contracts/test/commands.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6a | Budgeted selection over `PromptSent` and `ThreadItem` events, with both limits measured on the encoded reply | target `packages/engine/src/roles/handoff.ts:buildHandoff`; `packages/contracts/src/events.ts:ThreadContent` |
| 6b | `roles.handoff` handler with the engine's rights helper and paged read | CAPI §2 ("An agent's rights over other agents are the engine's"); §3 (`client.thread` visibility); CAPI E21, E22 |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The hand-off drops the detail the replacement needed | minor | The brief and last exchange are whole when they fit, and otherwise cut with a marker; the replacement asks its lead, who can read the rest (6.5, 8.2). |
| The old agent's text instructs the replacement | major | Data envelope and escaped leading `/` (6.4). |

**Verify:** `pnpm vitest run packages/engine/test/roles` at the repository root. Device or environment QA: none.

**WS-7: Three small engine changes**

The owner's answer of 2026-11-03 lets this plan edit the engine directly
(row 80). Rounds 1 to 3 shaped the three changes: 7a reads the input that
CAPI E29 records only for `execute` requests, and resolves paths before the
rule check; 7b holds the target agent's whole queue only while the roles say
so, and the engine counts the holds (rows 35, 57, 75, 79). Under lead
ruling L27, 7a is built only for a harness that qualified in the 2g
recordings; 7b and 7c are built in any case (row 81). CAPI E29's fields are
also built in any case, in the client API plan's unit 1b (row 110). Each change names
what it alters in existing engine behaviour, its files, and the existing
tests it updates; every other engine test, the acceptance suite and the
rebuild check keep passing.

Changes to existing engine behaviour, with the tests they update (tests at
engine commit `8ff4c9b`):

- **7a.** This change adds no field to `PermissionRequested`, because CAPI
  E29 adds them (row 110). The runner-event transaction
  (`packages/engine/src/commands/CommandHandler.ts` l.138-176) gains a
  second write, with the service caller, when a rule answers. For a
  rule-answered request, the request's routing events are replaced
  entirely, so no `DeliveryQueued` and no `OwnerNeeded` is written, and
  the wait checks (`withWaitChecks`, l.146-150) run once, on the
  projection of both writes (row 82). A rule-answered request never counts as held. For an agent's wait, the engine judges the whole batch. For the owner's wait, the client helper's gate reads a sequence at the batch's end before it ends the wait (client API contract, section 3). So the rule's `PermissionRequested` and `PermissionAnswered` must stay in one committed batch. Any read that the roles offer for the helper builds its lists and its sequence from one views value.
  The two writes are one `transact`, which publishes them together after
  commit (`log/EventLog.ts:261-267`), and the roles offer no such read (row
  120). A request that no rule answers is routed through the same path as
  today, and its wait checks are unchanged. An agent holder receives, inside the envelope: `Permission request <id> from agent <asker>:`, then `Tool kind: <known kind, or "unknown">`, then `Locations: <one-line JSON>` when there are any, then `Input: <one-line JSON>` when there is any, then any fixed warning, then `Title: <the redacted title>`. A moved request gets the same text. Any test or prompt that reads a holder's permission delivery changes to match. The first line keeps its form.
  This plan's own tests check only whether a delivery was queued, and the
  acceptance test's fake lead keys on the first line (row 124).
  The path resolution runs only when the standing-rules switch is on, the
  asker's harness is supported, and the request passes the matcher's
  lexical checks against at least one enabled rule. It resolves at most 32
  words and the request's `locations` entries, off the event loop, with a two-second limit, and a timeout counts
  as protected. After commit, the runner's `answerPermission` runs on its
  own fiber, not inside the shared runner-event stream
  (`CommandHandler.ts:177`) (row 91). Tests updated:
  `packages/engine/test/routing/permissions.test.ts`,
  `routing/permission-boundaries.test.ts`, `runner/permission-hold.test.ts`
  and `acceptance/capability-07-permissions.test.ts` keep their
  expectations, because none of them sets a rule. So do
  `routing/waits.test.ts` (its W19 cases, l.343-357) and
  `acceptance/capability-05-wait.test.ts`, for an unmatched request.
- **7b.** A "model at capacity" error, which `classifyError`
  (`packages/engine/src/runner/classify.ts`) does not classify today, so
  that the delivery is returned to its sender, becomes a third class. Its
  phrases come, per harness, from a recorded adapter error frame, or else
  from the provider's documented error type, such as the Anthropic API's
  `overloaded_error`, pinned to the adapter version. A harness with
  neither keeps today's return. The class gets its own runner outcome,
  never a pause. The classifier's type (`AcpRunner.ts:54`) and `finish`
  (l.166-176) produce `outcome: "capacity"`, `RunnerEvent.promptReply`
  (`packages/engine/src/runner/Runner.ts` l.85-95) gains that variant,
  the command handler decodes it (`CommandHandler.ts:133`), and the
  delivery planner sends it to the hold, never to the usage-limit path
  (`routing/deliveries.ts:179`) (row 87). The engine calls the roles' hold
  condition as a total function, so an error or a malformed result is
  logged without content and read as "no" (row 89). With
  the sheepdog on and its retries left, it holds the agent's queue instead
  (`routing/deliveries.ts`); a reload and an account's return leave a held
  agent idle (`recovery/reload.ts`, `recovery/restart.ts`). A new engine
  command, `release`, joins `CommandsRpcGroup` with access `owner`,
  `device`, `agent` (a caller that may act for the target's holder, by the
  engine's rights helper, CAPI E22) and `service` (CAPI E1, E2) (row 93).
  The engine's lifecycle table (`packages/contracts/src/stateMachine.ts:79`)
  gains two cells: `DeliveryHeld` moves the agent from working to idle,
  and `DeliveryReleased` changes no state; `DeliveryReturned` keeps its
  cell. The roles' own events enter the table through
  `keepInEveryState` (CAPI E5; row 97).
  When the condition says no because the count is spent, the engine
  returns the delivery with `DeliveryReturned`'s new optional
  `cause: "capacity"`. That return ends the outage and resets the count.
  So does a turn that ends without a capacity error, or a later
  non-capacity error. The count is the number of `DeliveryHeld` events in
  the outage (row 89). The engine's part of the settled test
  (`packages/contracts/src/settled.ts`, CAPI E19) gains one clause: an agent
  with an open capacity hold is not settled, even once its queue is empty.
  So its input gains the open holds, `client.snapshot`'s agent entry gains a
  `capacityHeld` flag, and the client's fold in `settled.ts` folds
  `DeliveryHeld`, `DeliveryReleased`, and the stop and the crash that end a hold.
  The property test of CAPI row 150 gains these events (row 129). Tests updated:
  `packages/engine/test/runner/classify-errors.test.ts`: its fixture type
  (l.21) gains a third kind, its "both kinds" check becomes "usage and
  sign-in for every harness, capacity for each harness with a capacity
  source", and its real-runner loop (l.119) expects a capacity fixture to
  give the capacity outcome, while usage and sign-in still give a pause;
    `packages/engine/test/support/fakeRunner.ts` scripts the new outcome;
  `packages/contracts/test/state-machine.test.ts` covers the two new
  cells; `packages/engine/test/api/subscribe-visibility.test.ts` gains a
  sample of each new event;
  `routing/deliveries.test.ts`, `acceptance/failure-6-undeliverable.test.ts`
  and `recovery/restart.test.ts`, `restart-regressions.test.ts` and
  `restart-accounts.test.ts` keep their expectations, because none of them
  uses a capacity error, and gain held cases in the new test files;
  `packages/contracts/test/commands.test.ts` lists `release` among the
  engine's commands and in its pinned MCP tool list, because `release`'s
  access includes `agent` (CAPI E2, CAPI row 140; row 113), and `packages/cli/test/parity.test.ts` gains a
  `release` payload in its map (l.27).
- **7c.** `TurnEnded` gains optional usage fields. The runner collects
  the terminal usage from the idle `state_update` frame, which today
  returns before translation (`AcpRunner.ts` l.354-363), keeps the last
  `usage_update.used`, and carries both on its internal `turnEnded` event
  (`AcpRunner.ts` l.59 and l.178, `Runner.ts` l.67). The command handler
  decodes it (`CommandHandler.ts:133`), and `routing/deliveries.ts`
  (`turnEnded`, l.92) copies it into the persisted event (row 86). Tests
  updated: `events-roundtrip.test.ts` and
  `packages/engine/test/runner/stream.test.ts` gain usage cases, from the
  raw idle frame to the log.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 7.1 | 7a, fields: this change adds none. CAPI E29, in the client API plan's unit 1b, adds them, whether or not a harness qualifies. `PermissionRequested` carries `toolKind`, `toolInput` (at most 8 KiB, redacted before the cut), `locations` (at most 16 entries and 2 KiB), `inputRedacted` and `inputTruncated`. The requests view keeps them on an open row, in one optional part named `action`, and drops it when the row closes. They are never in `client.snapshot`. The standing-rule matcher reads them and matches only when `toolKind` is `execute`. An absent, redacted or cut input matches nothing (2.6; rows 110, 123) | `rules.test.ts` M71 and `permission-precheck.test.ts` PC15 here; the fields' own tests are the client API plan's `packages/engine/test/runner/permission-fields.test.ts` |
| 7.2 | 7a, pre-check: the engine's permission path calls the roles' pure matcher (2c), which receives the request, the asker, the views of the same transaction and the transaction's time; the engine calls it as a total function, so an error or a malformed result is logged without request content and treated as no match; when it returns an option, the engine applies its own checks, whatever the pre-check said: the option is a one-time allow, not persistent, of a known kind, within the asker's mode by `canAnswerOption`, and `settingsWrite` is false; if they pass, `PermissionAnswered` is appended in the same transaction as `PermissionRequested`, as a second write whose envelope caller is the service with the rule id, with `answeredBy` the same service, no delivery to the holder is queued, no `DeliveryQueued` or `OwnerNeeded` is written, the wait checks run once over both writes, and the runner's `answerPermission` is called after commit on its own fiber; if they fail, the request is routed as today. Before the transaction, when the standing-rules switch is on, the harness is supported and the request passes the lexical checks against an enabled rule, for an `execute` request, the engine resolves every word, at most 32, each part of a word after an `=`, and each `locations` entry, against the request's working folder with the ceiling's resolver, following symbolic links, off the event loop with a two-second limit, and passes the pre-check, for each, whether it lands in a protected settings location; a resolution error other than "does not exist", or a timeout, counts as protected | `packages/engine/test/routing/permission-precheck.test.ts` PC01-PC17 (with stub matchers that always answer, and one that throws; PC09 a holder in a blocking `wait` on the asker stays waiting; PC10 an owner-held asker gets no `OwnerNeeded` and no alert; PC11 a bare-named link to a protected file and PC12 a linked folder followed by a missing file, both through the real resolver; PC13 a hanging resolution is cut off, counts as protected, and other agents' runner events still flow; PC14 a request in a folder under `.claude/worktrees/` never matches; PC15 a request of another kind that carries `toolInput` resolves no word and never matches; PC16 a reader of the views sees the request and its answer in one publication, so the state at that sequence has no open row; PC17 a `locations` entry that is a link to a protected file never matches); `routing/waits.test.ts` W19 keeps its expectations for an unmatched request; `packages/engine/test/acceptance/capability-07-permissions.test.ts` keeps its expectations |
| 7.3 | 7b, hold (rows 57, 75, 87, 89): a capacity error reaches the delivery planner as the runner's own `capacity` outcome, never as a pause. The engine asks the roles' capacity-hold condition, a pure function of the target agent and the views of the same transaction, called as a total function, so an error or a malformed result counts as no. The engine counts each agent's capacity holds itself, as its `DeliveryHeld` events in the current outage; an outage ends when a turn ends without a capacity error, when a later error is not a capacity error, or when a capacity error returns the delivery, so the count is per agent and outage, a release by anyone leads to the next hold being counted, and no roles record can lag behind it. The roles' condition says yes only while the sheepdog is on and that count is below its limit. On a capacity error with the condition saying yes, the engine writes `DeliveryHeld { agentId, deliveryId, reason: "capacity" }` and holds the agent's queue: a delivery that was sent but not accepted stays queued at the front, and for an accepted delivery the engine leaves it accepted and queues its usual carry-on. While the hold is open, the dispatcher sends nothing to that agent, whatever is at the head, so a board wake that the board withdraws and replaces (CAPI E17) stays behind the hold. The agent becomes idle; no `DeliveryReturned` and no pause is written; a wait on that agent does not end. A restart's reload and an account's return leave an agent with an open hold idle, with its queue still held: a held queue counts as neither "requeued" nor "carried" for `reloadedEvents`, so no agent is left working with nothing sent. Outside a hold, the same property comes from the client API: a withdrawal that leaves its target in the reloaded state with nothing queued or sent writes `StateChanged idle` in the same batch, in the first step of `withWaitChecks`, for any batch that holds a `DeliveryWithdrawn` (CAPI E17 and E18, CAPI rows 143, 173), so a board wake withdrawn from a reloaded agent, before a hold opens or after it is released, strands nobody, and the roles write nothing for it (row 111). A crash or stop of the held agent handles the queued deliveries as today and ends the hold. A stop of another agent can withdraw a delivery from a held queue, because `stop` withdraws the queued delivery of each open request that agent asked (CAPI E31). The hold stays open and names no delivery that must still be there. A hold whose queue empties stays open until its release: the dispatcher sends nothing, a later delivery stays behind it, and a wait on the agent does not end, because the engine's part of the settled test counts an open hold as not settled. The sheepdog's timer, the owner or the holder releases it; `release` then writes `DeliveryReleased` and sends nothing, and the wait can end (Board criterion 6.7; row 129). With the condition saying no, the error returns the delivery as today, and its `DeliveryReturned` carries `cause: "capacity"`; usage-limit and sign-in pauses are unchanged | `packages/engine/test/runner/classify-capacity.test.ts` K01-K18 (K09 a replaced board wake during a hold, K10 a release by the owner, K11 a restart with a held unaccepted delivery and with a held carry-on, K12 a sign-out return during a hold, K13 a condition that throws gives a return, K14 a recorded capacity frame through the real adapter and the command handler gives a hold and no pause, K15 a usage error after a capacity hold ends the outage and pauses as today, K16 a board wake withdrawn under an open hold after a restart leaves the agent idle with no second state change, and one withdrawn from a reloaded agent after a release gives `StateChanged idle` in the withdrawal's batch and no roles event, K17 a hold whose queue is emptied keeps a waiter waiting, and the release ends the wait and sends nothing, K18 a stop of an asker whose request's delivery is the held one withdraws it, and the release sends the next delivery); `classify-errors.test.ts` with its third fixture kind; the held cases of Board criterion 6.7, in `packages/engine/test/acceptance/board-capacity-hold.test.ts`: withdraw and replace a wake while the hold is on, across a restart, then withdraw the last queued wake, with nothing sent and no wait ended while the hold is open, and the persisted events, rebuilt views, engine wait result and owner's helper agreeing at each complete-state boundary. `DeliveryHeld` comes from unit 11b and the board's unit 5 writes the no-hold control, so whichever of the two is built second adds the held cases (row 129) |
| 7.4 | 7b, release: a new command `release { agentId }`, allowed for the owner, a caller that may act for the agent by the engine's rights helper (`mayActForHolder` over `holderAbove`, CAPI E22), and a service, writes `DeliveryReleased` and ends the agent's open hold, and its queue is dispatched as usual; it is refused for an agent with no open hold, and for any other agent caller (row 93) | `packages/engine/test/commands/release.test.ts` RL01-RL06 (RL04 a sibling, RL05 the held agent's own child, RL06 an unrelated agent, each refused); `packages/cli/test/parity.test.ts` covers `release` |
| 7.5 | 7c: `TurnEnded` carries optional usage for the turn, when the adapter reports it: the context size the adapter reports (`usage_update.used`), and for the turn's last model request its start time, input tokens, cache-read tokens, and cache-write tokens split by lifetime when given; the runner collects the terminal usage from the idle `state_update` frame before it finishes the turn, carries it on its internal `turnEnded` event, and the delivery planner copies it into `TurnEnded`; the context that decides compaction is `used` when present, otherwise the last request's input, cache-read and cache-write tokens, never a sum over the turn (row 86); old logs rebuild unchanged | `packages/engine/test/runner/usage.test.ts` U01-U04 (U01 the raw Claude fixture's idle frame reaches the persisted `TurnEnded` with no transcript; U02 a second turn without usage carries none; U03 a replay does not reuse old usage; U04 a multi-request turn uses the last request); the rebuild check |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 7a | Path resolution and the call to the roles' matcher in the permission path, as one projected batch with one run of the wait checks and the answer on its own fiber, reading CAPI E29's fields (rows 24, 35, 67, 79, 82, 91, 110) | `packages/engine/src/runner/AcpRunner.ts` l.400-417 (where the answer is awaited; CAPI E29 reads the request's tool call there), `packages/engine/src/commands/CommandHandler.ts` l.138-176 (the runner-event transaction, its fixed `owner` caller and its failure path), `packages/engine/src/routing/permissions.ts` (`answer`'s agent checks and `answerPermission` as the pattern), `routing/holders.ts:holderAbove`; the ceiling's resolver, `packages/engine/src/identity/ceiling.ts` l.341 and l.396; the service caller and `answeredBy` (CAPI E11, E14) |
| 7b | Capacity class and its runner outcome, the call to the roles' hold condition, `DeliveryHeld`, `DeliveryReleased`, `DeliveryReturned.cause` and `release` (rows 36, 57, 75, 87, 89, 93) | `packages/engine/src/runner/classify.ts:classifyError`; `packages/engine/src/runner/AcpRunner.ts` (the classifier's type, l.54; `finish`, l.166-176); `packages/engine/src/runner/Runner.ts` (`promptReply` outcomes, l.85-95); `packages/engine/src/commands/CommandHandler.ts` l.133 (decode); `packages/engine/test/support/fakeRunner.ts`; `routing/deliveries.ts` (dispatch, `failed`, l.109-116 acceptance, l.136-156 the pause's carry-on); `packages/engine/src/recovery/reload.ts` l.84-98 (requeued and carried rows, carry-on text); `packages/engine/src/recovery/restart.ts` l.184-209, l.276-296 (account return and recovered dispatch); `packages/contracts/src/commands.ts`, `packages/contracts/src/events.ts`; `packages/contracts/src/settled.ts` and `client.snapshot`'s agent entry (CAPI E9, E19) |
| 7c | Optional usage fields on `TurnEnded`, end to end (row 86) | `packages/engine/src/runner/AcpRunner.ts` (the per-turn structure, l.59; the idle `state_update` branch, l.354-363, which returns before `translate` today; `finish`, l.178); `packages/engine/src/runner/Runner.ts` (`RunnerEvent`'s `turnEnded`, l.67); `packages/engine/src/commands/CommandHandler.ts` l.133 (decode); `packages/engine/src/routing/deliveries.ts` l.92 (`turnEnded`); `packages/engine/src/runner/translate.ts`; `packages/contracts/src/events.ts` `TurnEnded`; the Claude fixture's `usage_update` and `state_update` frames (`packages/testing/fixtures/claude.ndjson` l.17-20) |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| 7a puts the matcher inside the engine's most sensitive path | major | The matcher is WS-2's pure function, called as a total function; the engine checks every answer itself (7.2); attack pass on 7a; the permission acceptance test stays unchanged. |
| A non-shell tool's input, which CAPI E29 now records, reaches the matcher | major | The matcher and the pre-check read the input only when `toolKind` is `execute`, and the shell discriminator still applies (2.4, 7.1). The size of the fields is the client API plan's to bound (CAPI E29). |
| 7b holds a message with nothing to release it | major | The hold needs the roles' condition, which says no when the sheepdog is off or the engine's own count is spent; the delivery then returns as today; a restart leaves the agent idle and held, and the sheepdog re-arms or, when off, releases it (7.3, 3.9, 3.10). |
| A board wake replaced during a hold skips the backoff | major | The hold is on the agent's queue, not one delivery (7.3, row 75). |
| 7b repeats a prompt the agent already took | major | An accepted delivery is never re-sent; a carry-on is held instead (7.3). |
| 7c's fields are missing in older logs | minor | Optional fields; the rebuild check. |

**Verify:** `pnpm vitest run packages/engine packages/contracts packages/cli` at the repository root, then `pnpm check` for the whole workspace; the output lists the test files, including the new ones. Device or environment QA: none.

**WS-8: Proof that the Foundry needs nothing else**

The recipe is a document in this repository. The Foundry skill that will
use it is in the Founder OS repository and is changed after this plan.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 8.1 | `docs/foundry.md` maps every action of the Foundry skill's Steps 3, 4, 5 and 8 to a Shephrd command, setting or sheepdog rule, or marks it as team workflow that stays in the skill; it states that the roles are stopped by their switches, never by downgrading the engine; that notices skip a paused parent; how a replacement gets a cut part of its hand-off through its lead; that adding a standing rule works only at the computer (row 103); and that the team's worktree root must not sit under a harness settings folder such as `.claude/`, for example `<repo>-worktrees/`, because the engine treats every path under such a folder as a settings path (row 85) | Read against `FOUNDRY/SKILL.md` by the unit's reviewer; `grep -n 'herdr agent\|collect.sh\|board-waker.sh' docs/foundry.md` hits only its "What this replaces" table |
| 8.2 | The acceptance test runs the composed service in the test process with the test clock, and drives it only through its Unix socket, with the settings at their production defaults: an orchestrator, two leads and two workers each, with fake agents; roles and groups at start; `roles.orient` for each; a group channel per team; a standing rule answers a worker's test run, if a harness qualified (row 81); a lead's hand-off post in `all` mode wakes it once when both workers reply, and the lead is not reported as stalled while they work; a worker that posts a question back to its idle lead makes both stall; a worker stalls through three episodes and is reported; a capacity error is held and released; a worker crashes, is resumed and carries on with a new working turn, crashes again and is reported; a team idles and its lead's holder is told; a replacement started with a cut hand-off asks its lead and receives the cut part; the wrap-up reads `client.roster` for an attribution table and exports each thread | `packages/engine/test/roles/acceptance/foundry-run.test.ts` FR01-FR12 |
| 8.3 | The same test counts lead wakes and blocking-wait returns: none from a matched standing rule, if built, or from a capacity error | `foundry-run.test.ts` FR13 |
| 8.4 | Live check by hand: the same flow on a real Claude Code lead and a real Codex worker on the owner's accounts, with one standing rule (if Codex is supported after 2g) and one timed compaction or flush | `pnpm live-check:roles`, run by the owner; its report saved under `.scratch/` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 8a | Recipe `docs/foundry.md`, step by step | target `docs/foundry.md`; source `FOUNDRY/SKILL.md` "Step 3 — Open an area", "Step 4 — Workers", "Step 5 — Watch, approve, escalate", "Step 8 — Wrap up" |
| 8b | Acceptance test with the composed service in the test process, the test clock as its clock, and a real Unix socket between the test's clients and the service | pattern `packages/engine/test/acceptance/flow-start-to-finish.test.ts`; `packages/engine/test/support/acceptance.ts` (its client helpers; not its child process), `serviceProcess.ts` (what the in-process start must match) |
| 8c | Live check script | pattern `packages/engine/scripts/live-check.ts`, `packages/engine/scripts/live/flow.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A Foundry action has no Shephrd equivalent and is found only when the skill is rewritten | major | 8.1 walks every action of the four steps; anything unmapped becomes an issue before the plan is done. |
| The in-process service differs from the real child process | minor | The engine's own acceptance suite keeps the child process; post-build check 7 runs one roles scenario that way with real minutes. |
| Fake agents behave more politely than real ones | minor | The live check (8.4). |
| The skill rewrite in another repository is forgotten | minor | Rollout step 6; the manager checks the epic's first "Done when" bullet against it. |

**Verify:** `pnpm vitest run packages/engine/test/roles/acceptance` at the repository root; live check 8.4 by hand. Device or environment QA: the live check on the owner's accounts.

**Post-build checks.** Worries this plan cannot settle before building:
(1) whether each adapter puts the tool's `kind`, `rawInput`, a shell
discriminator and a sandboxed-run marker on its permission request, and in
what shape (2g records them; a harness without them gets no matches);
(2) whether `claude-agent-acp` writes a transcript the reader can find
under the account's `CLAUDE_CONFIG_DIR`; (3) whether the engine's in-process
service path (CAPI E13) lets a service call a piece's command
(`board.post`) as well as the engine's, as the board contract assumes; (4) a differential check:
for every command the matcher accepts in its tests, `bash` parses it into
exactly one simple command whose words equal the parser's words; (5) a
fault-injection run that kills the service between each sheepdog command
and its action record, for every action kind, and finds exactly one of
each; (6) a capacity error before and after a delivery's first content
update, for each harness: the first is held and re-sent, the second gets
only a carry-on; (7) one roles scenario, a stall through its first
episode, run against the real child-process service with production
minutes, so the in-process acceptance service is not the only proof;
(8) for a supported harness, how long a symbolic link created between
WS-7a's resolution and the command's run can go unseen (known gap 20),
measured, not prevented.

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (A) epic row 4 and the epic's three "Done when" bullets;
(B) the engine design's "What stays out of the engine" items for piece 4;
(C) `docs/features.md` section 1 rows not built in the engine, and section
5; (D) `docs/research/t3-code.md` items 4, 7 and 8; (E) the Foundry skill's
Steps 3, 4, 5 and 8 and the scripts `collect.sh`, `board-waker.sh`,
`team-idle-watch.sh`, `context-keeper.sh` and `capacity-retry.sh`; (F) CAPI
§7, "The foundry roles"; (G) the board contract's answers to the roles'
seven needs; (H) decisions.md; (I) lead rulings L17 and L19 to L27.

| Source item | Workstream | Status |
|---|---|---|
| A: orchestrator, team leads, workers | WS-1 | mapped |
| A: standing permission rules | WS-2, WS-7a | mapped; matching needs WS-7a (row 35); built only for a harness that qualifies (lead ruling L27, rows 68, 81) |
| A: the sheepdog | WS-3, WS-4, WS-5 | mapped |
| A: Done when 1 (Steps 3-5 and 8 through Shephrd alone) | WS-8 | mapped; the skill rewrite is rollout step 6 |
| A: Done when 2 (phone pairing and answers) | — | piece 2 |
| A: Done when 3 (a message wakes only the agent that needs it) | — | piece 3; the sheepdog's notices use `reply: none`, and only decision notices are flushed |
| B: rules for each role | WS-1, WS-4f | mapped (advice, row 10) |
| B: standing permission rules | WS-2 | mapped |
| B: retrying, replacing or giving up | WS-4b, WS-4d, WS-4e, WS-6 | mapped |
| C: Orchestrator, Team leads, Worker kinds (idea) | WS-1 | adopted as kinds (row 14) |
| C: Start, stop, and reuse (idea) | — | not adopted: reuse is team workflow (row 5) |
| C: Shephrd's tools over MCP (idea) | WS-1, WS-6 | `roles.orient`, `roles.handoff` and `release` become MCP tools because their access includes `agent` (CAPI E2), and each one's unit updates the pinned exact list (row 113) |
| C: Hand-offs built from records (idea) | WS-6 | mapped |
| C: Stall watch (idea) | WS-4b | mapped (rows 16, 25, 37, 56) |
| C: Usage-limit pauses are not stalls (idea) | WS-4 (4.7) | mapped; the resume itself is the engine's |
| C: Stuck input boxes and approval dialogs (idea) | — | not needed in ACP mode: no input box, and approvals go to the holder (engine) |
| C: Compaction timed to the prompt cache (idea) | WS-5 | mapped, with delivery before expiry (rows 28, 45, 64) |
| C: Runaway work (idea) | WS-4c | mapped (turn and worker age, rows 43, 65) |
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
| E: Step 8, wrap-up | WS-8a, WS-8b | `client.roster`, `shephrd thread export`, `stop` |
| E: collect.sh | WS-8a | as "waiters collect" above |
| E: team-idle-watch.sh | WS-4a | mapped, with its "only working counts as busy" rule (row 56) |
| E: context-keeper.sh | WS-5, WS-4c | compaction and the two-hour worker cap (the worker age rule, row 65); the advisor check is team workflow |
| E: capacity-retry.sh | WS-4d, WS-7b | mapped (rows 57, 75) |
| F: items 1 to 6 | WS-1, WS-6, WS-3, WS-2 and WS-3, WS-4, — | roster, thread, service caller, `roles.` commands and alert kinds used as given; subscribe filters not needed in-process |
| G: needs 1, 3, 4, 5, 6, 7 accepted; 2 refused | WS-3, WS-4, WS-5 | accepted needs used as given, with v8's `board.status` detail lists and its condition lists with no agent; work state derived (rows 25, 55) |
| H: rows 1 to 131 | all | each row names its workstream in its own text |
| I: L17 (service direct pair; no engine-prompt fallback) | WS-3 | mapped (row 34) |
| I: L19, L22, L23 (reach check at queue and send, with the delivery) | — | the roles register no reach check; the sheepdog's notices pass the board's (rows 52, 55) |
| I: L20 (standing-rule matching, including opt-in prefix) | WS-2, WS-7a | mapped (rows 35, 67, 79) |
| I: L25 (the shell tool is kind `execute` plus the harness's pinned shell discriminator) | WS-2 (2.4, 2.14) | mapped (row 54) |
| I: L26 (direct engine edits; security properties kept as engine code) | all, WS-7 | mapped (row 80) |
| I: L27 (standing rules only for a qualifying harness) | WS-2, WS-7a | mapped (row 81) |
| I: L21, L24, L28, L30, L31 (board v4 to v8) | WS-3, WS-4 | mapped (rows 55, 94, 102, 109) |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: never push to `vitalysim/herdr-synapse` | Units push only to `qnlbnsl/sheprd`. |
| `AGENTS.md` rule 2: credit copied code | No code is planned as copied; T3 Code's idle compaction and hand-off are read as designs (5a, 6a). A builder who copies code follows rule 2, and the unit's review checks it. |
| `AGENTS.md` rule 3: keep the lists current | The result file's "For docs/issues.md" and "For docs/features.md"; the conventions paragraph; WS-8 risk row 1. |
| `AGENTS.md` rule 4 and SECURITY.md rule 7 | Rows 15, 22, 35 and 67; criteria 1.5, 1.7, 2.2 to 2.15, 3.4, 6.4, 6.5 and 7.2; row 79; attack passes on units 3, 4 and 11a. |
| SECURITY.md rule 6: secrets never reach a client | The hand-off reads only redacted log text (6.4); the matcher refuses redacted input (2.6); the input that 7a reads is redacted and kept out of snapshots by CAPI E29 (7.1); the transcript reader keeps only numbers (5.7); notice bodies are fixed text; roles events pass the engine's redactor (CAPI §1). |
| `AGENTS.md` rule 5: the client API is the product's surface | Every owner action, including the switches and the action history, is a `roles.` command with owner and device access, except `roles.rules.add`, one of the three commands that rule 5 now names as computer-only, by the owner's choice of 2026-11-03 (row 103). |
| `AGENTS.md` rule 6: team shapes do not belong here | Role files and team definitions live outside the repository (rows 5, 14, 22); the recipe marks what stays in the skill. |
| `AGENTS.md` "How agents are run": one delivery interface | Every nudge and notice is an engine delivery (Board, "How a wake reaches an agent"); nothing reads the run mode. |
| `AGENTS.md` "Language" | Conventions paragraph. |
| `AGENTS.md` rule 7 and team rules 2 to 6 | Planners commit their own branch only. |
| Owner, 2026-11-03: edit the engine directly, and record each change to existing behaviour | Row 80; WS-7 names each change to existing engine behaviour, its files and the tests it updates; the roles add themselves to the engine's lists (CAPI E1 to E13). |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its
harness-session skill) at launch; this section names none (owner,
2026-10-16). The scopes `roles/contracts`, `roles/backend` and
`roles/docs-research` do not exist yet: the lead runs the scoping skill
before the first launch. WS-7 uses the existing `engine/backend`.

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1 Role names, roles contracts, role-file schema (1a to 1c) | contracts | roles/contracts | medium | New schemas in `packages/contracts/src/roles/`, added to the engine's lists. | no | CAPI units 1a and 1b |
| 2 Roles view, snapshot, action list and `orient` (1d, 1e) | backend | roles/backend | medium | A fold on the engine's view pattern, a bounded snapshot and two reads. | no | 1, CAPI unit 3 |
| 3p Recorder scenarios (2h) | backend | roles/backend | low | Adds scenario, mode, harness and output choices to the existing recorder. | no | none |
| 3 Rule schema, parser, matcher, harness shapes (2a to 2c, 2f) | backend | roles/backend | high | Decides permissions without a human. | yes | 3p, a qualifying harness in the 2g recordings (row 81) |
| 4 Rule commands and pre-check registration (2d, 2e) | backend | roles/backend | medium | Wires the matcher to fixed contracts. | yes | 2, 3, 11a |
| 5 Sheepdog base and switches (3a to 3h) | backend | roles/backend | medium | Reactor, timers, notices and request ids on the engine's patterns. | no | 2, 11b, the board's first units |
| 6 Idle, runaway, crash and role-advice rules (4a, 4c, 4e, 4f) | backend | roles/backend | medium | Pure rules, one test file each. | no | 5, CAPI unit 6a |
| 7 Stall state machine (4b) | backend | roles/backend | medium | One state machine over the board's status, with the waiting tests. | no | 5 |
| 8 Capacity rule (4d) | backend | roles/backend | low | A timer and a count over a fixed event. | no | 5, 11b |
| 9 Cache timing (5a to 5c) | backend | roles/backend | medium | One schedule with known guards and a hardened reader. | no | 5 |
| 10 Hand-off (6a, 6b) | backend | roles/backend | medium | Budgeted selection over fixed event shapes. | no | 2 |
| 11a Pre-check (7a) | backend | engine/backend | high | Inside the engine's permission path, in one transaction, with resolved paths. | yes | 3, CAPI unit 1b |
| 11b Capacity hold and release (7b) | backend | engine/backend | medium | One error class, one call to the roles' condition, a queue hold, two events and one command on existing patterns, plus the reload rule and one settled clause. | no | CAPI units 1b and 3 |
| 11c Usage on `TurnEnded` (7c) | backend | engine/backend | medium | The runner's capture of terminal usage, its internal event, the handler's decode and the delivery planner, plus an optional event field. | no | CAPI unit 1a |
| 12 Recipe (8a) | docs-research | roles/docs-research | medium | Checked step by step against the skill. | no | 2, 4, 5 |
| 13 Acceptance test (8b) | backend | roles/backend | high | One scenario with an in-process service on the test clock over a real socket. | no | 4, 6 to 10 |
| 14 Live check (8c) | backend | roles/backend | low | One script, run by the owner. | no | 13 |

Unit 11b comes before unit 5. It adds `release` to the engine's commands
and access table in its own unit, and unit 5 names `release` in the
sheepdog's service entry (CAPI row 120; row 107). Until unit 5 writes the
roles' hold condition, the condition says no, so a capacity error returns as
it does today.

The recording run for 2g is not a build unit: the owner runs the recorder
prepared by unit 3p once per harness, before units 3, 4 and 11a start,
because its result decides whether those three units are built (rows 71,
81).

Load: 17 build units, or 14 if no harness qualifies for standing rules,
which drops units 3, 4 and 11a. At about three launches a unit (builder,
test writer, focused review), plus two for each of the three attack-pass
units, that is about 57 launches, or 42 with standing rules deferred. From the sheet's tables, most backend builds land on the
OpenAI vendor, and the Anthropic vendor carries the test writers for those
builds, the high units' alternates and the attack verifiers. The planner
cannot read either vendor's remaining weekly allowance. The lead checks
both before launching, and schedules units 11a to 14 after a reset if
either would run out (known gap 1).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|
| — | — | Frozen for round 1 on 2026-11-03 (`attack/plan-v1.md`). The lead runs the four lenses. |
| 1 | 2 / 37 / 21 | All 60 folded (`attack/round-1-findings.md`): lead ruling L20 rewrote the matcher; L17's fallback dropped; 7a and 7b reshaped, sent to the lead as question 2 (row 53); stall state machine, holder routing, owner alerts, request ids, hand-off overflow, switches, bounds. Frozen for round 2 as `attack/plan-v2.md`. |
| 2 | 0 / 23 / 18 | All 41 folded (`attack/round-2-findings.md`): bounded snapshot summary with paged reads; hand-off markers addressed to the lead; acceptance test in-process on the test clock; capacity hold only while the sheepdog is on, accepted prompts never re-sent, and the no-7b re-send dropped; give-up alerts tested against the engine's open alert; deadlocks stall; board-off suspension; turn start from `DeliverySent`; worker-only age cap; matcher gains a positive sandbox marker, opt-in prefix (L20), embedded settings names, argument lists and a total pre-check; lead ruling L25 on the shell's identity (row 54). Frozen for round 3 as `attack/plan-v3.md`. |
| 3 | 0 / 11 / 16 | All 27 folded (`attack/round-3-findings.md`), with threat-model R3-2 sent to the owner as question 4 (row 68) and the plan written for both answers: notices' read state tracked by the roles view; rule size checked as a whole and the snapshot filled by encoded size; transitive waiting, usage-limit pauses as busy; capacity hold on the agent's queue, counted by the engine, safe across restarts; `roles.StallEnded` for the stall alert; Codex expected `unsupported`; protected names without case and through resolved links; `ModeRefused` blocks matching; recorder preparation and test registration. Frozen for round 4 as `attack/plan-v4.md`. |
| L26 | — | Reworked under the owner's answer of 2026-11-03 and lead rulings L26 and L27, on client API contract v3 at `876bf4f`: the roles live in the engine's own packages and add themselves to its lists (CAPI E1 to E13); WS-7 is no longer pending and names each change to existing engine behaviour with the tests it updates; standing rules are built only for a qualifying harness; question 4 withdrawn (rows 80, 81). Frozen for the full review round as `attack/plan-v5.md`. |
| 4 | 0 / 13 / 19 | Grades 6 to 8, no refusals (`attack/round-4-findings.md`). The roles' own seven majors (six issues) and 17 minors are folded, with the WS-7 half of an eighteenth: a rule-answered request is one projected batch with no routing events; a pause with no known reset counts as the owner; the cache rule skips only an agent with its own pending work; worktrees under `.claude/` fail closed; usage reaches the log from the idle frame; capacity is its own runner outcome, with a defined outage end and a `cause` on the return; sheepdog work is not busy; `release` uses the engine's rights helper; per-service command lists and an import boundary; board v6 cited (rows 82 to 94). The six shared majors, one shared minor and the shared half of R4-A3 wait for client API contract v4. Frozen as `attack/plan-v6.md`. |
| 4, shared | — | Folded on client API contract v6 at `4a7e352` (lead rulings L29 and L30; board #178, #184): every roles command classed as a planner or a read; `orient` and the hand-off follow the read rule; roles events kept in every lifecycle state; the caller survives a log read; every roles batch through the piece batch path, with the first-use reactor a level rule and `roles.standing-rules` calling nothing; the stall rule's waiting test agrees with the board at one sequence (rows 95 to 101). Frozen as `attack/plan-v7.md`. |
| board v7 | — | Cited board contract v7 at `49d541b` (lead ruling L30; board #187). The roles' uses were checked against it: `board.status` with no agent for the condition lists, readable while the board is off; the manager seat moving only on a stop, which the roles do not use; `board.read` as a read with marks, which a service cannot call, while `board.Read` still names post ids for the notices' read state; the board's level-rule reactor (row 102). |
| client API v8 | — | Folded client API contract v8 at `04e1f83` (board #212, `artifacts/api-v8-for-pieces.md`), with no review round: `roles.rules.add` computer-only; the sheepdog's start-up gap closed by the reactor rules; alert kinds and titles; `client.lasting-setting`; budgets checked; `release` order (rows 103 to 108). Frozen as `attack/plan-v9.md`. |
| board v8, client API v9 | — | Cited board contract v8 at `4bdc670` and client API contract v9 at `5ceb503` (lead ruling L31; board #223). Both were checked against the roles' uses. One thing moved: a refused `board.flush` for a recipient that has just stopped or crashed (row 109). Frozen as `attack/plan-v10.md`. |
| client API v10 | — | Folded client API contract v10 at `a7f1c9f` (board #230, `artifacts/api-v10-for-pieces.md`), with no review round: the `PermissionRequested` fields moved to CAPI E29; the reloaded-state rule cited in 7.3; `openMatters` added; the MCP pin; the enveloped `client.thread`; and, found while folding, the sheepdog's position no longer moved by a switch-on, under CAPI row 145 (rows 110 to 118). Frozen as `attack/plan-v11.md`. |
| client API v11 | — | Folded client API contract v11 at `3bd2358` (board #241, `artifacts/api-v11-for-pieces.md`), with no review round: the lead's exact text on tool pins, the one batch, `guardPiece`, the fields and the delivered text, and `stop`. Checked against the sheepdog and the hold: a stopped or crashed agent adds no "waits on" link, and a hold can empty. Found while folding: the reducer may hold no envelope time, and `locations` has no cut flag (rows 119 to 128). Frozen as `attack/plan-v12.md`. |
| board v10 | — | Cited board contract v10 at `c053fda` (board #247), and aligned with its criterion 6.7: an open capacity hold keeps its agent unsettled even once its queue is empty, which reverses row 126, and unit 11b names the held cases. The roles view learns a wake's delivery id from `DeliveryQueued`, because `board.WakeBuilt` now names its source id (rows 129 to 131). Frozen as `attack/plan-v13.md`. |




</details>
