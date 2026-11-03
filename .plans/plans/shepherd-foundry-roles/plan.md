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
context. A standing rule is an owner-approved rule such as "allow
`pnpm test` in the worker's own folder". Shephrd answers a matching request
by itself with a one-time allow, and the record names the rule that
answered. A rule can never allow more than the asker's own permission mode,
save a permission, or edit a settings file. Only the owner adds or removes a
rule, and the owner's phone is told the first time each rule is used.

The third addition is the sheepdog. It is a small part of the Shephrd
service that watches the record of events and keeps every agent moving
without spending their turns. It replaces the Foundry's scripts. It tells a
lead's parent when the lead's team has had nothing running for an hour. It
retries an agent five minutes after a "model at capacity" error. It resumes
a crashed agent once and then gives up. It wakes a worker that sits on an
unanswered message, then tells its lead, and tells the lead to replace a
worker that stalls three times. Just before an idle Claude agent's prompt
cache expires, it delivers any messages waiting for that agent, or compacts
the agent's context, because that is when both are cheapest. It never
decides what the work is. When a worker is replaced, Shephrd builds the
replacement's first message from the record of what the old worker did, so
no model turn is spent writing a summary.

Two other plans were written at the same time, and this one builds on both
of their contracts, which are now frozen. The client API plan adds one
extension point to the engine. Through it the roles add their own commands
and events, and the sheepdog acts as a narrow "service" caller whose actions
the record names as the sheepdog's, not the owner's. The client API also
lets an agent list its own team. The message board lets the sheepdog post
a notice that no agent can forge, and deliver an agent's waiting messages
at a chosen moment.

One owner decision is open. The lead sent the owner one question on
2026-11-03: the client API plan's extension point, plus three small engine
changes for this plan. The first change checks standing rules before a
request reaches the lead, so the lead is not woken at all. The second tells
a "model at capacity" error apart from other errors, so the lead is not
woken for each one. The third records how large each agent's context is,
so compaction can be timed for every harness, not only Claude. The
recommendation is to allow these and nothing more, under the rule that
nothing the engine already does changes. If the owner declines the three
changes, each workstream below still works, but some wakes remain. If the
owner declines the extension point itself, both contracts and this plan are
rewritten first.

## Key decisions

- **The roles plug into the engine through one extension point, without
  changing what the engine does.** Pending the owner. The roles add their
  own commands and record their own events through it. The sheepdog runs
  inside the Shephrd service as a narrow caller that can nudge, compact,
  resume, post notices and give one-time answers, and nothing else. After a
  restart it reads the record again and knows everything it knew before.
- **Role rules are advice in this version.** The lead's ruling of
  2026-11-03. A confused agent can still do something its role should not,
  but its parent is told. Enforcement can be added later.
- **Standing rules only ever allow one action at a time.** A rule answers
  with "allow once", inside the asker's folder and permission mode, for an
  exact command, never a compound shell line. A rule cannot be stretched
  into "allow everything" by an agent wording its command cleverly. The
  cost is that the owner writes a rule per command shape.
- **The sheepdog tells the parent; the parent acts.** It wakes an agent,
  retries a capacity error and resumes a crash once by itself. Replacing a
  worker or giving up is reported to the worker's parent, which decides.
  This follows the owner's words of 2026-10-25: "tell the lead to recreate
  it". A matter that reaches the owner becomes a phone alert.
- **"Stalled" means an unanswered message.** The board does not track work
  states, so a worker counts as stalled when it sits idle with a message
  that needs its reply. Three stalls on the same message, with no progress
  between them, is the signal to replace it.
- **Every limit is a setting.** The defaults come from the Foundry's own
  scripts and the owner's earlier words: an hour of team idleness, five
  minutes between capacity retries, ten minutes before a worker's
  unanswered message counts as a stall, two hours for a runaway turn. The
  owner can change each from any client.
- **Open: the extension point and three engine changes.** Pending the
  owner. The three changes sit in one workstream that is dropped if the
  owner declines them.

Full log → `decisions.md`

## Workstreams

### Agents know their role, their team and their rules

An agent can ask Shephrd who it is and get back its role, its parent, its
children and their states, its count of open requests and questions, and
its role's advice, from the command line or as a tool. This replaces
Synapse's `orient` and the Foundry's habit of pasting the same facts into
every brief. The team's role file, kept outside this repository, supplies
the advice text and the limits for each role. The owner loads it from any
client. The risk is a role file used to grant something. The role file's
format has no field that can grant a permission, and Shephrd refuses a file
that tries. Done when an agent started as `worker:builder` reads its parent
and its role's advice through `orient`.

### Routine permission requests are answered by owner-approved rules

The owner adds a rule such as "Codex workers may run `pnpm test` in their
own folder". When a request matches, Shephrd answers it once, the record
names the rule, and the lead is not asked. The main risk is a rule that
allows more than the owner meant. The matcher refuses compound commands,
settings writes, persistent answers, and anything above the asker's mode or
outside its folder. A dedicated attack review checks it. Done when a
worker's matching request is answered by the rule, and a request for
`pnpm test && rm -rf ~` is not.

### A sheepdog keeps every agent moving

The sheepdog runs inside the Shephrd service, reads the record of events,
and acts through its narrow caller. It is the base the next workstreams'
rules sit on. The risk is a sheepdog that nudges the same agent twice after
a restart. Every action it takes is itself recorded, so it reads its own
past actions when it starts and does not repeat them. Done when a service
restarted in the middle of a team's run sends no duplicate nudge.

### Stalls, crashes and capacity errors are handled without the owner

The sheepdog's rules cover a team with nothing running for an hour, a
worker sitting on an unanswered message, the third such stall, a turn that
runs past two hours, a "model at capacity" error, a crash, and an agent
that breaks its role's advice. Usage-limit pauses never count as stalls,
because the engine already resumes those agents when the limit resets. The
risk is noise: a lead that is told too often stops reading. Each notice is
sent once per event and repeats at most hourly, and the owner can snooze a
team. Done when each rule fires once in its test and stays quiet in a team
that is paused or rightly waiting on another team.

### Waiting messages and compaction are timed to the prompt cache

Two minutes before an idle Claude agent's prompt cache expires, the
sheepdog delivers the messages waiting for it, if there are any, so they
are read at the cheap cached price. If there are none and its context is
large, it asks the agent to compact. The risk is compacting an agent that
is about to receive work. The sheepdog skips any agent with something
queued, open or waiting. Done when a test shows the delivery or the compact
request two minutes before the computed expiry, and neither for a busy
agent.

### A replacement worker starts from what the old one did

When a lead replaces a worker, Shephrd builds the replacement's first
message from the record: the original brief, the last exchange, the
commands it ran and the files it changed, each shortened, with pointers to
the rest. No model turn is spent writing it. The risk is a hand-off that
leaves out the one thing that mattered. It always keeps the brief and the
last exchange whole, and says what it left out. Done when the hand-off
command returns a hand-off under its budget that contains both.

### Three small engine changes, if the owner allows them

If the owner agrees, the engine asks the roles' rule matcher before it
delivers a permission request. It puts a capacity error back in the queue
instead of returning it to the lead. It records each turn's token and cache
usage. The risk is the same as any engine change: a regression in a part
that is already reviewed. Each change keeps every existing engine test
passing unchanged and adds its own. If the owner says no, this workstream
is dropped and the fallbacks in the other workstreams apply.

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

1. **Wait for the extension point.** The client API plan builds it as its
   first unit, once the owner agrees. Until then, the parts with no
   connection to the engine can be built: the role names, the role file
   format, the rule matcher and the hand-off builder.
2. **Build the roles' commands and events,** then `orient` and the
   standing-rule commands, once the extension point and the client API's
   roster have merged.
3. **Build the sheepdog's base, then its rules.** The rules that send
   notices need the board's post, flush and status commands, so they follow
   the board's first units.
4. **Build the three engine changes, if the owner allowed them,** each in
   its own pull request into `engine`. Without them, the fallbacks ship.
5. **Run the acceptance test, then the check by hand.** The check by hand
   spends usage on the owner's accounts, so it runs once, before the owner
   switches the Foundry over.
6. **Switch the Foundry over.** The owner or the manager rewrites the
   Foundry skill's Steps 3 to 5 and 8 from the recipe, in the Founder OS
   repository. Until then the old scripts keep working, because nothing in
   this plan removes them.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

**Sources this plan builds on.** "CAPI §n" is the client API contract v2,
`.plans/plans/shepherd-client-api/contract.md` on `worker/plans-api` at
`75ab185` with its addendum `cd1d836` (frozen 2026-11-03, decision row 21). "Board" is the message
board contract, `.plans/plans/shepherd-message-board/contract.md` on
`worker/plans-board` at `44cd371` (frozen 2026-11-03, rows 29 and 31). Both assume
the extension seam (CAPI §6), which is pending the owner (rows 19, 24, 30).
Engine anchors are at `8ff4c9b` (scouting.md, Scout E). `FOUNDRY` is
`~/.claude/plugins/marketplaces/founder-os/plugins/harness-sessions/skills/software-foundry`.

**Conventions for every unit.** TypeScript on Node.js 26 with Effect 4 at
the engine's pinned version. Effect APIs are looked up in the current
documentation before they are written (team rule 7). Timers are tested with
`TestClock` from `effect/testing`, advanced with `TestClock.adjust`, inside
`it.effect` from `@effect/vitest`, which provides the test clock by default
(checked on 2026-11-03 against the Effect 4.0.4 `@effect/vitest` README
through context7). No unit reads an agent's screen or types into a pane.
Text from an agent, a tool call's input or a file is data: it is matched,
shortened and quoted, never followed. New problems go into
`docs/issues.md` in the same change (AGENTS.md rule 3).

**The roles piece, as CAPI §1 shapes it.** Namespace `roles`. Two packages
(row 26): `packages/roles-contracts` (schemas only; depends on
`packages/contracts`, and on the client and board contracts packages for
their types) and `packages/roles` (handlers, view, reactors, services, the
sheepdog). Commands and their access:

| Command | Access (CAPI §2) | What it does |
|---|---|---|
| `roles.orient` | agent | The caller's own `client.roster` entry and its children's, plus its role's advice. A read. |
| `roles.handoff` | owner, device, agent, service | A hand-off for one agent; an agent may ask only for an agent it holds a parent's rights over. A read. |
| `roles.role-file.set` | owner, device | Loads a role file from its content (row 22). |
| `roles.role-file.get` | owner, device | Returns the loaded role file and its hash. |
| `roles.rules.list` | owner, device | Lists standing rules and their use counts. |
| `roles.rules.add` | owner, and device unless CAPI's question Q2 makes it host-only (CAPI §7, item 4) | Adds a standing rule. |
| `roles.rules.disable`, `roles.rules.remove` | owner, device | Disables or removes a rule. |
| `roles.settings.get`, `roles.settings.set` | owner, device | The sheepdog's limits (rows 16, 25). |
| `roles.snooze` | owner, device | Silences team-idle notices for one group until a time. |

Events, all `owner-only` (CAPI §3), so agents never see them through
`subscribe`: `roles.RoleFileSet`, `roles.RuleAdded`, `roles.RuleDisabled`,
`roles.RuleRemoved`, `roles.RuleFirstUsed`, `roles.SettingsChanged`,
`roles.Snoozed`, and the sheepdog's action records
`roles.TeamIdleReported`, `roles.StallSeen`, `roles.ReplaceAdvised`,
`roles.RunawayReported`, `roles.CapacityRetried`, `roles.CrashRetried`,
`roles.GaveUp`, `roles.RoleAdviceBroken`, `roles.CacheFlushed` and
`roles.CompactRequested`. Each action record carries its recipient (`parent`
with an agent id, or `owner`) and the sequence number of the event that
triggered it. Alert sources (CAPI §4): `StallSeen` and `GaveUp` with
recipient `owner` raise `roles.stall`; `ReplaceAdvised` with recipient
`owner` raises `roles.replace`; `RunawayReported` with recipient `owner`
raises `roles.runaway`; `RuleFirstUsed` raises `roles.rule-first-use`. Each
alert ends when its agent next starts a turn or is stopped, or when the
owner dismisses it.

Services (CAPI §2, "Services"): `roles.standing-rules` (answers) and
`roles.sheepdog` (everything else). The engine commands they call are
exactly `subscribe`, `prompt`, `compact`, `resume` and a one-time `answer`.
The board commands they call are exactly `board.post`, `board.flush` and
`board.status` (Board, "For Shephrd's own services").

**WS-1: Agents know their role, their team and their rules**

This work gives Shephrd a vocabulary for roles, the roles' contracts
package, the role file, and `orient`. Role names are parsed from the free
`role` string the engine already stores (row 14).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | `parseRole("worker:builder")` gives kind `worker` and name `builder`; `parseRole("")` and `parseRole("chef")` give kind `worker` with an `unknown-kind` flag | `packages/roles-contracts/test/role.test.ts` R01-R03 |
| 1.2 | `RolesRpcGroup` is prefixed `roles.`, every payload has `requestId`, and the composed API's uniqueness test passes with it | `packages/roles-contracts/test/group.test.ts` G01; CAPI §1's uniqueness test in `packages/api` |
| 1.3 | `rolesAccess` equals the command table above, and every event in `RolesEvent` is `owner-only` in `rolesVisibility` | `group.test.ts` G02-G03 |
| 1.4 | A role file that fails the schema is refused with the failing path, and the previous file stays loaded | `packages/roles/test/roleFile.test.ts` F01-F04 |
| 1.5 | A role file with a key outside the schema, such as `permission` or `rules`, is refused | `roleFile.test.ts` F05 |
| 1.6 | `shephrd roles orient` and the MCP tool, called by an agent, return its name, kind and role name, its parent's id and name, its children with their states, its open-request and open-question counts, and its role's advice; called by the owner, it is refused | `packages/roles/test/orient.test.ts` O01-O04 |
| 1.7 | Advice text is returned inside the engine's data envelope with a fresh marker, and a leading `/` is escaped | `orient.test.ts` O05 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | `parseRole` and the three kinds, with generic advice for each: an orchestrator talks to leads; a lead starts, waits on and answers for its own workers; a worker reports to its lead, does not start agents and does not ask the owner | target `packages/roles-contracts/src/role.ts:parseRole`; pattern `packages/contracts/src/permission.ts:permissionLevels` |
| 1b | `packages/roles-contracts`: `RolesRpcGroup`, `RolesEvent`, `rolesAccess`, `rolesVisibility`, `rolesAlertSources` | CAPI §1, "Where the schemas live"; pattern `packages/contracts/src/commands.ts:CommandsRpcGroup`, `packages/contracts/src/events.ts:Event` |
| 1c | Role-file schema (role name to advice text and limits), loader from content, `roles.role-file.set` and `get` handlers | target `packages/roles/src/roleFile.ts:loadRoleFile`; pattern `packages/contracts/src/harnesses.ts` |
| 1d | The roles view (role file, rules, settings, snoozes, the sheepdog's action records, the reactor's cursor, open tool calls by agent) and its registration on the seam | target `packages/roles/src/view.ts:apply`; pattern `packages/engine/src/views/apply.ts:apply`, `emptyViews`; CAPI §1, "Views and reactors" |
| 1e | `roles.orient` handler over `client.roster` entries (CAPI §3) and the role file | target `packages/roles/src/orient.ts`; envelope rule `packages/engine/src/routing/envelope.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A role file is used to widen what an agent may do | major | The schema has no permission, rule or account fields (1.5); standing rules are separate, owner-only commands (WS-2). |
| An agent edits the owner's copy of the role file on disk, since agents run as the owner's user (engine decision row 47) | minor | The file reaches Shephrd only through `roles.role-file.set` from the owner or a device; `RoleFileSet` records its hash. The copy on disk is outside Shephrd. |
| An agent cannot see its grandchildren (CAPI §3 refusal) | minor | By design: a lead asks its workers. `orient` shows only what the roster shows. |

**Verify:** `pnpm --filter @shephrd/roles-contracts test`, `pnpm --filter @shephrd/roles test`. Device or environment QA: none.

**WS-2: Routine permission requests are answered by owner-approved rules**

This work adds standing rules: a schema, a pure matcher, the owner's
commands and the answering service. The matcher reads only what the adapter
reported for the request: the request's options, its `settingsWrite` flag,
and the tool call's `input`, joined by `toolCallId` from the asker's
`ThreadItem` tool-call events (scouting.md, Scout E items 3 and 4;
`packages/contracts/src/events.ts:ThreadContent`). The `roles.standing-rules`
service gives the answer, and the log records its caller as
`{ service: "roles.standing-rules", rule: "<id>" }` (CAPI §2).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | A request whose tool-call input is the command `pnpm test` in the asker's folder, from a harness and role the rule names, matches, and the matcher returns the request's `allow_once` option id | `packages/roles/test/rules.test.ts` M01 |
| 2.2 | Commands containing `;`, `&&`, `\|\|`, `\|`, a backquote, `$(`, `>`, `<`, a newline or a here-document match no rule | `rules.test.ts` M02-M10 |
| 2.3 | A request with `settingsWrite: true`, one offering no `allow_once` option, and one whose `allow_once` level is above the asker's mode never match | `rules.test.ts` M11-M13 |
| 2.4 | A command run outside the asker's folder, or with a path argument that resolves outside it, does not match | `rules.test.ts` M14-M15 |
| 2.5 | A disabled or expired rule does not match; the lowest rule id wins when two match | `rules.test.ts` M16-M17 |
| 2.6 | `roles.rules.add`, `disable` and `remove` are refused for agents and services, and accepted for the owner | `packages/roles/test/rulesCommands.test.ts` C01-C03 |
| 2.7 | A matching request is answered by the service with the rule's id in the envelope's caller; a non-matching request is left to its holder | `packages/roles/test/answerer.test.ts` A01-A02 |
| 2.8 | A rule's first use writes `roles.RuleFirstUsed` once, which raises one `roles.rule-first-use` alert | `answerer.test.ts` A03 |
| 2.9 | Without WS-7a, the test records that the holder also received the request; with WS-7a, no delivery to the holder is queued | `answerer.test.ts` A04 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a | Rule schema: id, harnesses, roles or groups, command prefix as a word list, folder scope (`own-folder` only in this version), optional expiry, enabled flag, owner note | target `packages/roles-contracts/src/rules.ts:StandingRule`; pattern `packages/contracts/src/permission.ts` |
| 2b | Command splitter that refuses shell control characters and splits words without a shell | target `packages/roles/src/commandWords.ts:splitCommand`; pattern `packages/cli/src/commands/sanitize.ts` |
| 2c | `matchRule(request, toolCall, asker, rules)`: pure; returns an option id or a reason; uses the engine's option kinds and levels; folder check on the pattern of the engine's protected paths | target `packages/roles/src/rules.ts:matchRule`; `packages/contracts/src/permission.ts:acpPermissionOptionKinds`, `permissionForOptionKind`; `packages/engine/src/identity/ceiling.ts` l.239-244 |
| 2d | Rule commands' handlers and their events | target `packages/roles/src/rulesCommands.ts`; CAPI §1, "How a piece's command runs" |
| 2e | `roles.standing-rules` service: a reactor on `PermissionRequested` that finds the tool call in the roles view, matches, and calls `answer` | target `packages/roles/src/answerer.ts`; CAPI §1, "Views and reactors"; §2, "Services" |
| 2f | Pin each harness's tool-call `input` shape for shell commands from the recorded fixtures | `packages/testing/fixtures/claude.ndjson`, `packages/testing/fixtures/codex.ndjson` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A rule is stretched by a crafted command (compound shell, path escape, quoting) | blocker | 2.2 and 2.4; the splitter refuses anything unusual rather than parsing it; attack pass on units 3 and 4. |
| A harness's tool-call `input` is missing or shaped differently | major | No input, no match: the request goes to its holder as today (2f pins the shapes). |
| Without WS-7a, the answer arrives after the holder was already prompted, so the lead still wakes once | major | Accepted for the fallback; the answer still saves the lead's decision and any owner escalation. WS-7a removes the wake. |
| A rule outlives its purpose | minor | Optional expiry; the first-use alert (2.8); the owner lists rules from any client. |
| A stolen phone adds a rule that survives the phone's revocation | major | CAPI's question Q2 may make `roles.rules.add` host-only; this plan follows its answer. |

**Verify:** `pnpm --filter @shephrd/roles test`. Device or environment QA: none.

**WS-3: A sheepdog keeps every agent moving**

This work builds the sheepdog's base inside the roles piece (row 23): the
service registration, the reactor's cursor, the settings, snooze, notices
and timers. The rules in WS-4 and WS-5 plug into it.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | The roles view rebuilt from the log equals the live view, through the engine's rebuild check | `packages/engine/test/support/rebuildCheck.ts` run over the roles suite; `packages/roles/test/sheepdog/fold.test.ts` S01 |
| 3.2 | After a service restart in the middle of a run, the sheepdog sends no nudge, notice, retry or compaction it had already recorded | `fold.test.ts` S02 |
| 3.3 | Each action's request id is derived from the triggering event's sequence number, so a crash between deciding and writing acts once | `fold.test.ts` S03 |
| 3.4 | The sheepdog and the answerer call only the engine and board commands listed under "Services" above; a test lists their calls and compares | `packages/roles/test/sheepdog/calls.test.ts` K01 |
| 3.5 | A notice to an agent is a `board.post` by `roles.sheepdog` in a direct channel with `reply: none`, followed by `board.flush` when it must wake the agent now; a notice to the owner is a roles event that raises an alert | `packages/roles/test/sheepdog/notices.test.ts` N01-N03 |
| 3.6 | `roles.snooze` silences team-idle notices for that group until the time passes; `roles.settings.set` changes a limit and the next check uses it | `notices.test.ts` N04-N05 |
| 3.7 | Timers are re-armed from the view at start-up; a deadline that passed while the service was down fires once at start-up | `packages/roles/test/sheepdog/timers.test.ts` T01-T02 (`TestClock.adjust`) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a | Register `roles.sheepdog` and `roles.standing-rules` on the seam; the reactor's cursor in the roles view | CAPI §2, "Services"; §1, "Views and reactors" |
| 3b | Settings shape and defaults (rows 16, 25), with per-role overrides from the role file | target `packages/roles/src/sheepdog/settings.ts` |
| 3c | Notices through `board.post` and `board.flush`; owner notices as roles events | target `packages/roles/src/sheepdog/notices.ts`; Board, "For Shephrd's own services" |
| 3d | Timers on Effect's clock, re-armed from the view | pattern `packages/engine/src/accounts/timers.ts:startAccountTimers` (and its re-check of deadlines crossed during a tick, issue 210) |
| 3e | Action request ids from trigger sequence numbers | CAPI §5, "Request ids" |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Duplicate or lost actions across a restart | major | 3.2 and 3.3; the reactor is safe to run twice on the same event (CAPI §1). |
| The service caller's rights are wider than the sheepdog needs | major | 3.4. |
| A notice is read by the lead as an instruction from another agent | minor | Only an in-process service can be a post's author (Board, "Posts", row 36 of the board's log); the notice text is fixed by Shephrd. |

**Verify:** `pnpm --filter @shephrd/roles test`. Device or environment QA: none.

**WS-4: Stalls, crashes and capacity errors are handled without the owner**

Each rule is a pure function from the roles view, the engine's views, the
board's status and the clock to a list of actions, so each is tested alone.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Team idle: a group whose agents are all idle, paused or stopped, with no open wait, request, question, queued delivery, or open post of their own awaiting a reply, for 60 minutes, gets one nudge to its top agent (the member whose parent is outside the group) and one notice to that agent's parent; then hourly; a snoozed group gets nothing | `packages/roles/test/sheepdog/rules/teamIdle.test.ts` TI01-TI05 |
| 4.2 | Stall: an idle agent with no delivery queued or sent, and an open post addressed to it that needs its reply, for 10 minutes (worker) or 20 (lead or orchestrator), gets one nudge; 10 minutes later its parent is told; the third stall on the same post, with no tool call or file change between, writes `ReplaceAdvised` and tells the parent, offering `roles.handoff` | `rules/stall.test.ts` ST01-ST06 |
| 4.3 | Runaway turn: a turn longer than the role's limit (default 120 minutes) tells the parent once per turn | `rules/runaway.test.ts` RW01-RW02 |
| 4.4 | Capacity: with WS-7b, an agent paused with reason `capacity` is resumed after 5 minutes, at most 12 times, then the parent is told once to move the work to another model; without WS-7b, a `DeliveryReturned` whose reason matches the capacity patterns is re-sent on the same schedule | `rules/capacity.test.ts` CP01-CP04 |
| 4.5 | Crash: the first `AgentCrashed` for an agent is followed by one `resume`; a second within an hour is not retried, and `GaveUp` tells the parent | `rules/crash.test.ts` CR01-CR03 |
| 4.6 | Usage-limit and sign-in pauses are never nudged and never counted as stalls or team idleness | `rules/stall.test.ts` ST07; `rules/teamIdle.test.ts` TI04 |
| 4.7 | A worker that starts an agent, or asks a question that reaches the owner, is reported to its parent once per kind of break | `rules/roleAdvice.test.ts` RA01-RA02 |
| 4.8 | A notice whose recipient is the owner (the agent's parent is the owner) raises the matching `roles.` alert instead of a post | `rules/stall.test.ts` ST08 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 4a | Team idle rule over engine groups | target `packages/roles/src/sheepdog/rules/teamIdle.ts`; groups from `AgentStarted.groups` and `AgentGrouped` (`packages/contracts/src/events.ts:Event`); own open posts from `board.status` |
| 4b | Stall rule and a counter per open post (row 25) | target `rules/stall.ts`; Board, `board.status` ("open posts waiting for its reply") and its pure-function export from `packages/board` |
| 4c | Runaway rule from `TurnStarted` and `TurnEnded` | target `rules/runaway.ts` |
| 4d | Capacity rule with one pattern table: `Selected model is at capacity`, `API Error: 529`, `overloaded_error`, `model is currently overloaded` | target `rules/capacity.ts`; patterns from `FOUNDRY/scripts/capacity-retry.sh` `CAPACITY_RE` (scouting.md, Scout S); `DeliveryReturned {sender, reason}` |
| 4e | Crash rule: one `resume`, then give up | target `rules/crash.ts`; `AgentCrashed` from `packages/engine/src/recovery/crash.ts:64` |
| 4f | Role-advice rule | target `rules/roleAdvice.ts`; `parseRole` (WS-1); `AgentStarted.parent`, `QuestionMoved` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Notices wake leads so often that they cost more than they save | major | One notice per event; hourly repeats at most; `reply: none` posts that wake only when flushed; snooze. The acceptance test counts lead wakes (8.3). |
| Without WS-7b, the agent sees the sheepdog as the sender of its re-sent prompt, and the parent is still woken once by the engine's returned delivery | minor | The re-send quotes the original sender inside its envelope; known gap 6. |
| A crash loop on resume | major | One retry per hour per agent (row 17). |
| A lead rightly waiting on another team is reported as idle | minor | 4.1 excludes groups with an open post awaiting a reply; snooze covers the rest. |

**Verify:** `pnpm --filter @shephrd/roles test`. Device or environment QA: none.

**WS-5: Waiting messages and compaction are timed to the prompt cache**

The cache lasts one hour after a request that wrote one-hour cache tokens,
otherwise five minutes after one that wrote five-minute cache tokens;
otherwise its expiry is unknown and nothing is scheduled (T3 Code's rule,
`docs/research/t3-code.md` item 4). Two minutes before it expires, for an
idle agent with nothing open: if `board.status` shows unread posts, the
sheepdog calls `board.flush` (row 28); otherwise, if the agent's context is
at least its role's floor (default 150,000 tokens), it asks for a
compaction.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | A last call with one-hour cache tokens at time T and 200,000 context tokens, and no unread posts, gives a compact request at T + 58 minutes | `packages/roles/test/sheepdog/rules/cache.test.ts` CM01 (`TestClock.adjust`) |
| 5.2 | The same with two unread posts gives a `board.flush` at T + 58 minutes and no compaction | `cache.test.ts` CM02 |
| 5.3 | Nothing is sent when the agent has a queued delivery, an open request, question or wait, is compacting, or its last turn was a compaction; a newer turn replaces the timer | `cache.test.ts` CM03-CM07 |
| 5.4 | No compaction below the floor or with an unknown expiry | `cache.test.ts` CM08-CM09 |
| 5.5 | With WS-7c, usage comes from `TurnEnded`; without it, from the Claude transcript in the account's config folder, and a missing transcript schedules nothing | `cache.test.ts` CM10-CM11 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5a | Expiry rule and schedule | target `packages/roles/src/sheepdog/rules/cache.ts`; design read from T3 Code `apps/server/src/orchestration-v2/IdleCompaction.ts` (read, not copied; copying invokes AGENTS.md rule 2) |
| 5b | Usage source: `TurnEnded` (WS-7c) or the transcript reader | target `packages/roles/src/sheepdog/usage.ts`; fields from `FOUNDRY/scripts/context-keeper.sh:last_call` (`.message.usage.input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; scouting.md, Scout S answer b) |
| 5c | `board.flush` and `compact` through the service caller | Board, "For Shephrd's own services"; `packages/engine/src/runner/compact.ts:compactPrompt` (read only) |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The Claude ACP adapter writes no transcript, or writes it elsewhere | major | Post-build check 2 and the live check; without a transcript nothing is scheduled, which is today's cost. |
| A compaction lands just as work arrives | minor | 5.3; the engine refuses `compact` on an agent that is not idle. |
| Codex and other harnesses get no timing without WS-7c | minor | Known gap 5. |

**Verify:** `pnpm --filter @shephrd/roles test`; live check 8.4. Device or environment QA: the live check.

**WS-6: A replacement worker starts from what the old one did**

`roles.handoff` pages through the agent's thread with the seam's paged read
(CAPI §6, item 9) and returns a budgeted hand-off. It holds the first prompt
whole, the last exchange whole, then the most recent tool calls and file
changes, each shortened to 240 characters, within 16,000 tokens, with the
sequence numbers of what it left out (T3 Code's budget,
`docs/research/t3-code.md` item 5).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | The hand-off contains the first prompt and the last exchange whole, and stays under the budget for a 5,000-item thread | `packages/roles/test/handoff.test.ts` H01-H02 |
| 6.2 | It lists the sequence numbers it left out | `handoff.test.ts` H03 |
| 6.3 | The old agent's text is inside a data envelope, and text the log redacted stays redacted | `handoff.test.ts` H04 |
| 6.4 | An agent may ask only for an agent it holds a parent's rights over | `handoff.test.ts` H05 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6a | Budgeted selection over `PromptSent` and `ThreadItem` events | target `packages/roles/src/handoff.ts:buildHandoff`; `packages/contracts/src/events.ts:ThreadContent` |
| 6b | `roles.handoff` handler with the seam's rights helper and paged read | CAPI §2 ("An agent's rights over other agents are the engine's"); §6 items 8 and 9 |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The hand-off drops the detail the replacement needed | minor | The brief and last exchange are always whole; the omitted sequence numbers let the new worker ask its parent. |
| The old agent's text instructs the replacement | major | Data envelope and escaped leading `/` (6.3). |

**Verify:** `pnpm --filter @shephrd/roles test`. Device or environment QA: none.

**WS-7: Three small engine changes, if the owner allows them**

Rows 11, 19, 24 and 30: pending the owner. If declined, this workstream is
dropped. Each change follows CAPI §6's additive rule, "No existing command,
event, state, reply, rule or test changes", and every existing engine test,
the acceptance suite and the rebuild check pass unchanged.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 7.1 | 7a: with a registered permission pre-check that matches, `PermissionAnswered` is written in the same transaction as `PermissionRequested`, with the service caller and rule id, and no delivery to the holder is queued; with nothing registered, routing is unchanged | `packages/engine/test/routing/permission-precheck.test.ts` PC01-PC03; `packages/engine/test/acceptance/capability-07-permissions.test.ts` unchanged and passing |
| 7.2 | 7b: a capacity error requeues the message at the front and pauses the agent with reason `capacity`; no `DeliveryReturned` is written | `packages/engine/test/runner/classify-capacity.test.ts` K01-K02 |
| 7.3 | 7c: `TurnEnded` carries optional input, cache-read and cache-write token counts and the cache lifetime when the adapter reports them; old logs rebuild unchanged | `packages/engine/test/runner/usage.test.ts` U01-U02; the rebuild check |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 7a | Permission pre-check registration on the seam (row 24) | `packages/engine/src/routing/permissions.ts`, `routing/holders.ts:holderAbove`; CAPI §6 item 12 as the pattern |
| 7b | Capacity class, as an added variant of the pause reason | `packages/engine/src/runner/classify.ts:classifyError`; `routing/deliveries.ts:pauseAgent`, `failed`; `packages/contracts/src/stateMachine.ts:LifecycleState` |
| 7c | Optional usage fields on `TurnEnded` | `packages/engine/src/runner/translate.ts`; `packages/contracts/src/events.ts` `TurnEnded` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| 7a puts the matcher inside the engine's most sensitive path | major | The matcher is WS-2's pure function; attack pass on 7a; the permission acceptance test stays unchanged. |
| 7b pauses an agent forever when the capacity error never clears | minor | The sheepdog's 12-retry limit and its notice (4.4). |
| 7c's fields are missing in older logs | minor | Optional fields; the rebuild check. |

**Verify:** `pnpm --filter @shephrd/engine test`. Device or environment QA: none.

**WS-8: Proof that the Foundry needs nothing else**

The recipe is a document in this repository. The Foundry skill that will
use it is in the Founder OS repository and is changed after this plan.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 8.1 | `docs/foundry.md` maps every action of the Foundry skill's Steps 3, 4, 5 and 8 to a Shephrd command, setting or sheepdog rule, or marks it as team workflow that stays in the skill | Read against `FOUNDRY/SKILL.md` by the unit's reviewer; `grep -n 'herdr agent\|collect.sh\|board-waker.sh' docs/foundry.md` hits only its "What this replaces" table |
| 8.2 | The acceptance test runs an orchestrator, two leads and two workers each, with fake agents, through the public socket only: roles and groups at start; `roles.orient` for each; a group channel per team; a standing rule answers a worker's test run; a lead's hand-off post in `all` mode wakes it once when both workers reply; a worker stalls, is nudged, then reported; a capacity error is retried; a worker crashes, is resumed, crashes again and is reported; a team idles and its lead's parent is told; the wrap-up reads `client.roster` for an attribution table and exports each thread | `packages/roles/test/acceptance/foundry-run.test.ts` FR01-FR10 |
| 8.3 | The same test counts lead wakes: none from a matched standing rule with WS-7a, at most one per matched rule without it | `foundry-run.test.ts` FR11 |
| 8.4 | Live check by hand: the same flow on a real Claude Code lead and a real Codex worker on the owner's accounts, with one standing rule and one timed compaction or flush | `pnpm live-check:roles`, run by the owner; its report saved under `.scratch/` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 8a | Recipe `docs/foundry.md`, step by step | target `docs/foundry.md`; source `FOUNDRY/SKILL.md` "Step 3 — Open an area", "Step 4 — Workers", "Step 5 — Watch, approve, escalate", "Step 8 — Wrap up" |
| 8b | Acceptance test on the engine's rig | pattern `packages/engine/test/acceptance/flow-start-to-finish.test.ts`; `packages/engine/test/support/acceptance.ts`, `serviceProcess.ts` |
| 8c | Live check script | pattern `packages/engine/scripts/live-check.ts`, `packages/engine/scripts/live/flow.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A Foundry action has no Shephrd equivalent and is found only when the skill is rewritten | major | 8.1 walks every action of the four steps; anything unmapped becomes an issue before the plan is done. |
| Fake agents behave more politely than real ones | minor | The live check (8.4). |
| The skill rewrite in another repository is forgotten | minor | Rollout step 6; the manager checks the epic's first "Done when" bullet against it. |

**Verify:** `pnpm --filter @shephrd/roles test`; live check 8.4 by hand. Device or environment QA: the live check on the owner's accounts.

**Post-build checks.** Worries this plan cannot settle: (1) each harness's
tool-call `input` shape for shell commands (2f pins it from fixtures; a new
adapter needs a new fixture); (2) whether `claude-agent-acp` writes a
transcript the reader can find under the account's `CLAUDE_CONFIG_DIR`;
(3) whether the seam's in-process service path lets a service call a
piece's command (`board.post`) as well as the engine's, as the board
contract assumes.

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (A) epic row 4 and the epic's three "Done when" bullets;
(B) the engine design's "What stays out of the engine" items for piece 4;
(C) `docs/features.md` section 1 rows not built in the engine, and section
5; (D) `docs/research/t3-code.md` items 4, 7 and 8; (E) the Foundry skill's
Steps 3, 4, 5 and 8 and the scripts `collect.sh`, `board-waker.sh`,
`team-idle-watch.sh`, `context-keeper.sh` and `capacity-retry.sh`; (F) CAPI
§7, "The foundry roles"; (G) the board contract's answers to the roles'
seven needs; (H) decisions.md.

| Source item | Workstream | Status |
|---|---|---|
| A: orchestrator, team leads, workers | WS-1 | mapped |
| A: standing permission rules | WS-2, WS-7a | mapped |
| A: the sheepdog | WS-3, WS-4, WS-5 | mapped |
| A: Done when 1 (Steps 3-5 and 8 through Shephrd alone) | WS-8 | mapped; the skill rewrite is rollout step 6 |
| A: Done when 2 (phone pairing and answers) | — | piece 2 |
| A: Done when 3 (a message wakes only the agent that needs it) | — | piece 3; the sheepdog's notices use `reply: none` and `board.flush` |
| B: rules for each role | WS-1, WS-4f | mapped (advice, row 10) |
| B: standing permission rules | WS-2 | mapped |
| B: retrying, replacing or giving up | WS-4b, WS-4d, WS-4e, WS-6 | mapped |
| C: Orchestrator, Team leads, Worker kinds (idea) | WS-1 | adopted as kinds (row 14) |
| C: Start, stop, and reuse (idea) | — | not adopted: reuse is team workflow (row 5) |
| C: Shephrd's tools over MCP (idea) | WS-1, WS-6 | `roles.orient` and `roles.handoff` become tools through the seam |
| C: Hand-offs built from records (idea) | WS-6 | mapped |
| C: Stall watch (idea) | WS-4b | mapped (rows 16, 25) |
| C: Usage-limit pauses are not stalls (idea) | WS-4 (4.6) | mapped; the resume itself is the engine's |
| C: Stuck input boxes and approval dialogs (idea) | — | not needed in ACP mode: no input box, and approvals go to the holder (engine) |
| C: Compaction timed to the prompt cache (idea) | WS-5 | mapped, with delivery before expiry (row 28) |
| C: Runaway work (idea) | WS-4c | mapped |
| D: item 4 | WS-5 | mapped |
| D: item 7 (a wait result that says why) | — | built in the engine (`WaitSatisfied` member reasons, CLI exit codes; Scout E items 3 and 5) |
| D: item 8 | WS-4 (4.6) | mapped |
| E: Step 3, start a lead | WS-8a | engine `start` with role `lead` and a group |
| E: Step 3, relayer, team creation, scoped instructions, advisor | WS-8a | team workflow, stays in the skill; the team channel is a board group channel |
| E: Step 3, watchers (idle, capacity, context, board-waker) | WS-4a, WS-4d, WS-5 | mapped; board-waker is piece 3's wake rule |
| E: Step 3, "waiters collect" | WS-8a | a hand-off post in `all` mode (Board, "Posts"), or engine `wait` |
| E: Step 4, workers | WS-8a | engine `start`; worktrees stay in the skill (git) |
| E: Step 5, approve and deny | WS-2 | standing rules; other requests reach the holder through the engine |
| E: Step 5, escalate to the owner | — | engine `pass-up` and `OwnerNeeded`, alerts in piece 2 |
| E: Step 8, wrap-up | WS-8a, WS-8b | `client.roster`, `shephrd thread export`, `stop` |
| E: collect.sh | WS-8a | as "waiters collect" above |
| E: team-idle-watch.sh | WS-4a | mapped |
| E: context-keeper.sh | WS-5, WS-4c | compaction and the two-hour worker cap; the advisor check is team workflow |
| E: capacity-retry.sh | WS-4d, WS-7b | mapped |
| F: items 1 to 6 | WS-1, WS-6, WS-3, WS-2 and WS-3, WS-4, — | roster, thread, service caller, `roles.` commands and alert kinds used as given; subscribe filters not needed in-process |
| G: needs 1, 3, 4, 5, 6, 7 accepted; 2 refused | WS-3, WS-4, WS-5 | accepted needs used as given; work state derived (row 25) |
| H: rows 1 to 30 | all | each row names its workstream in its own text |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: never push to `vitalysim/herdr-synapse` | Units push only to `qnlbnsl/sheprd`. |
| `AGENTS.md` rule 2: credit copied code | No code is planned as copied; T3 Code's idle compaction and hand-off are read as designs (5a, 6a). A builder who copies code follows rule 2, and the unit's review checks it. |
| `AGENTS.md` rule 3: keep the lists current | The result file's "For docs/issues.md" and "For docs/features.md"; the conventions paragraph; WS-8 risk row 1. |
| `AGENTS.md` rule 4 and SECURITY.md rule 7 | Rows 15 and 22; criteria 1.5, 1.7, 2.2 to 2.6, 3.4 and 6.3; attack passes on units 3, 4 and 11a. |
| SECURITY.md rule 6: secrets never reach a client | The hand-off reads only redacted log text (6.3); the transcript reader reads only usage fields (5b); roles events pass the engine's redactor (CAPI §1). |
| `AGENTS.md` rule 5: the client API is the product's surface | Every owner action is a `roles.` command with owner and device access. |
| `AGENTS.md` rule 6: team shapes do not belong here | Role files and team definitions live outside the repository (rows 5, 14, 22); the recipe marks what stays in the skill. |
| `AGENTS.md` "How agents are run": one delivery interface | Every nudge and notice is an engine delivery (Board, "How a wake reaches an agent"); nothing reads the run mode. |
| `AGENTS.md` "Language" | Conventions paragraph. |
| `AGENTS.md` rule 7 and team rules 2 to 6 | Planners commit their own branch only. |
| Epic, 2026-10-30: built on the engine without changing it | Rows 6, 19, 24 and 30; WS-7 waits on the owner. |

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
| 2 Roles view and `orient` (1d, 1e) | backend | roles/backend | medium | A fold on the engine's view pattern and one read handler. | no | 1, CAPI roster |
| 3 Rule schema, splitter, matcher (2a to 2c, 2f) | backend | roles/backend | high | Decides permissions without a human. | yes | none |
| 4 Rule commands and answering service (2d, 2e) | backend | roles/backend | medium | Wires the matcher to fixed contracts. | yes | 2, 3 |
| 5 Sheepdog base (3a to 3e) | backend | roles/backend | medium | Reactor and timers on the engine's patterns. | no | 2, the board's first units |
| 6 Idle, runaway, crash and role-advice rules (4a, 4c, 4e, 4f) | backend | roles/backend | medium | Pure rules, one test file each. | no | 5 |
| 7 Stall rule (4b) | backend | roles/backend | medium | One rule over the board's status. | no | 5 |
| 8 Capacity rule (4d) | backend | roles/backend | low | A pattern table and a timer on a fixed event. | no | 5 |
| 9 Cache timing (5a to 5c) | backend | roles/backend | medium | One schedule with known guards. | no | 5 |
| 10 Hand-off (6a, 6b) | backend | roles/backend | medium | Budgeted selection over fixed event shapes. | no | 2 |
| 11a Permission pre-check seam (7a) | backend | engine/backend | high | Inside the engine's permission path, in one transaction. | yes | 3, owner |
| 11b Capacity class (7b) | backend | engine/backend | low | One added error class on an existing pattern. | no | owner |
| 11c Usage on `TurnEnded` (7c) | contracts | engine/backend | medium | An optional event field plus the runner's translation. | no | owner |
| 12 Recipe (8a) | docs-research | roles/docs-research | medium | Checked step by step against the skill. | no | 2, 4, 5 |
| 13 Acceptance test (8b) | backend | roles/backend | medium | One scenario on the engine's acceptance rig. | no | 4, 6 to 10 |
| 14 Live check (8c) | backend | roles/backend | low | One script, run by the owner. | no | 13 |

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
| — | — | Frozen for round 1 on 2026-11-03. The lead runs the four lenses. |

</details>
