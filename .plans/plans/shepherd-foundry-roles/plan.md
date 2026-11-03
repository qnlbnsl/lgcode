---
topic: shepherd-foundry-roles
status: discover
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
require. In this version a role's rules are advice: an agent asks Shephrd
"who am I" and gets its role, its parent, its children, its open requests
and its role's rules, and the sheepdog reports an agent that breaks one to
its parent. Shephrd does not refuse the action. The lead ruled this on
2026-11-03, and enforcement is recorded as a later idea.

The second addition is standing permission rules. Today a lead answers each
worker's "may I run the tests?" by reading the pane and pressing a key.
The engine already sends that request to the lead as a message, but every
request still costs the lead a turn, and a lead's turn re-reads its whole
context. A standing rule is an owner-approved rule such as "allow
`pnpm test` in the worker's own folder". Shephrd answers a matching request
by itself with a one-time allow, logs which rule answered, and never uses a
rule to allow more than the asker's own permission mode, to save a
permission, or to edit a settings file. Only the owner adds or removes a
rule.

The third addition is the sheepdog. It is a small background program that
watches the engine's record of events and keeps every agent moving without
spending their turns. It replaces the Foundry's scripts: it tells a lead
when its team has had nothing running for an hour, retries an agent five
minutes after a "model at capacity" error, resumes a crashed agent once and
then gives up, wakes a stalled worker once and then tells its lead, tells a
lead to replace a worker that stalls three times, and compacts an idle
Claude agent's context just before its prompt cache expires, which is when
compacting is cheapest. It never decides what the work is. When a worker is
replaced, Shephrd builds the replacement's first message from the record of
what the old worker did, so no model turn is spent writing a summary.

Two other plans are being written at the same time, and this one builds on
both. The client API plan gives the sheepdog a narrow credential of its own,
so its actions are logged as the sheepdog's and not the owner's, and gives
agents a way to list who is on their team. The message board plan gives the
sheepdog one way to deliver a nudge to any agent and a record of each
agent's work state. This plan cannot be frozen until both of their contracts
are.

One owner decision is open. Three small engine changes would make the roles
much cheaper to run: checking standing rules before a request reaches the
lead, so the lead is not woken at all; telling a "model at capacity" error
apart from other errors, so the lead is not woken for each one; and
recording how large each agent's context is, so compaction can be timed for
every harness. The lead sent this to the owner on 2026-11-03 with the
recommendation to allow those three only. Each workstream below also says
what it does if the answer is no: it still works, but some wakes remain.

## Key decisions

- **The roles sit beside the engine, not inside it.** The sheepdog is a
  separate program that reads the engine's event log through the same
  connection every client uses. It keeps no database of its own: after a
  restart it reads the log again and knows everything it knew before. The
  consequence is that it can be built and tested without touching the
  engine, and that it can lag the engine by a moment, never by a missed
  event.
- **Role rules are advice in this version.** The lead's ruling of
  2026-11-03. The consequence is that a confused agent can still do
  something its role should not, but its parent is told. Enforcement can be
  added later in the engine's command handler.
- **Standing rules only ever allow one action at a time.** A rule answers
  with "allow once", inside the asker's folder and permission mode, for an
  exact command, never a compound shell line. The consequence is that a rule
  cannot be stretched into "allow everything" by an agent wording its
  command cleverly. The cost is that the owner writes a rule per command
  shape.
- **The sheepdog tells the parent; the parent acts.** It wakes an agent,
  retries a capacity error and resumes a crash once by itself. Replacing a
  worker or giving up is reported to the worker's parent, which decides.
  This follows the owner's words of 2026-10-25: "tell the lead to recreate
  it".
- **Every limit is a setting.** The defaults come from the Foundry's own
  scripts and the owner's earlier words (an hour of team idleness, five
  minutes between capacity retries, two hours for a runaway turn). The
  owner can change each from any client.
- **Open: three engine changes.** Pending the owner. The plan works either
  way, and the changes sit in one workstream that is dropped if the owner
  says no.

Full log → `decisions.md`

## Workstreams

### Agents know their role, their team and their rules

An agent can ask Shephrd who it is and get back its role, its parent, its
children and their states, its open requests and questions, and its role's
advice, from the command line or as a tool. This replaces Synapse's
`orient` and the Foundry's habit of pasting the same facts into every brief.
The team's role file, kept outside this repository, supplies the advice
text and the limits for each role. The risk is that the file is written by
hand and could be wrong; Shephrd checks it against a schema when it is
loaded and refuses a bad file with the line that is wrong. Done when an
agent started with role `worker:builder` reads its own parent, its role's
advice and its open requests through `shephrd orient` and the `orient` tool.

### Routine permission requests are answered by owner-approved rules

The owner adds a rule such as "Codex workers may run `pnpm test` in their
own folder". When a request matches, Shephrd answers it once, records which
rule answered, and the lead is not asked. The main risk is a rule that
allows more than the owner meant; the matcher refuses compound commands,
settings writes, persistent answers and anything above the asker's mode,
and a dedicated attack pass reviews it. Done when a worker's matching
request is answered by the rule with the rule's id in the log, and a
request for `pnpm test && rm -rf ~` is not.

### A background sheepdog keeps every agent moving

The sheepdog starts with Shephrd, reads the record of events, and acts on
it through its own narrow credential. It is the base the next workstream's
rules sit on. The risk is a sheepdog that nudges the same agent twice after
a restart; because each nudge it sends is itself in the record, it reads its
own past nudges when it starts and does not repeat them. Done when a
sheepdog stopped and started in the middle of a team's run sends no
duplicate nudge.

### Stalls, crashes and capacity errors are handled without the owner

The sheepdog's rules: a team with nothing running for an hour, a worker
that stalls on unfinished work, a worker that stalls three times, a turn
that runs past two hours, a "model at capacity" error, a crash, and an agent
that breaks its role's advice. Usage-limit pauses never count as stalls,
because the engine already resumes those agents when the limit resets. The
risk is noise: a lead that is told too often stops reading. Each notice is
sent once per event and repeats at most hourly, and the owner can snooze a
team. Done when each rule fires once in its acceptance test and stays quiet
in a paused team.

### Context is compacted when it is cheapest

An idle Claude agent with a large context is asked to compact two minutes
before its prompt cache expires, so the next wake does not re-read the
whole context at full price. The risk is compacting an agent that is about
to receive work and losing context it needed; the sheepdog skips any agent
with something queued, open or waiting. Done when a test shows the compact
request sent two minutes before the computed expiry and not sent to an
agent with a queued message.

### A replacement worker starts from what the old one did

When a lead replaces a worker, Shephrd builds the replacement's first
message from the record: the original brief, the last requests and
answers, the commands it ran and the files it changed, each shortened, with
pointers to the rest. No model turn is spent writing it. The risk is a
hand-off that leaves out the one thing that mattered; it always keeps the
original brief and the last exchange whole, and says what it left out.
Done when `shephrd handoff <agent>` prints a hand-off under its budget that
contains the brief and the last exchange.

### Three small engine changes, if the owner allows them

If the owner agrees, the engine checks standing rules before it delivers a
request, puts a capacity error back in the queue instead of returning it to
the lead, and records each turn's token and cache usage. The risk is the
same as any engine change: a regression in a part that is already
reviewed. Each change keeps the engine's whole acceptance suite passing and
adds its own test. Done when those tests pass on `engine`. If the owner
says no, this workstream is dropped and the fallbacks above apply.

### Proof that the Foundry needs nothing else

A written recipe maps each of the Foundry's Steps 3 to 5 and 8 onto
Shephrd's commands, and an acceptance test runs a whole Foundry-shaped team
with fake agents through Shephrd's public connection alone: an orchestrator,
two leads and their workers, with a standing rule, a stall, a capacity
error, a crash and a wrap-up. A check by hand runs the same flow on real
Claude Code and Codex agents. The Foundry skill itself lives in another
repository, so changing it to use the recipe is the last step, done by the
owner or the manager. Done when the acceptance test passes and the recipe
names no `herdr agent` command, `collect.sh` or `board-waker.sh`.

## Rollout order

1. **Wait for the two contracts.** The client API's service credential and
   roster query, and the board's delivery interface and work state, are
   frozen by their planners first. Units that need neither (role files, the
   rule matcher, the hand-off builder) can be built meanwhile.
2. **Build the role files and the rule matcher.** They are plain functions
   with no connection to the engine, so they are tested alone.
3. **Build `orient` and the sheepdog's base** once the client API has
   merged its roster query and service credential.
4. **Build the sheepdog's rules and the compaction timer.** The stall rules
   that need work state wait for the board to merge.
5. **Build the engine changes, if the owner allowed them,** on `engine`,
   each in its own pull request. Without them, the fallbacks ship.
6. **Run the acceptance test, then the check by hand.** The check by hand
   spends usage on the owner's accounts, so it runs once, before the owner
   switches the Foundry over.
7. **Switch the Foundry over.** The owner or the manager rewrites the
   Foundry skill's Steps 3 to 5 and 8 from the recipe, in the Founder OS
   repository. Until then, the old scripts keep working, because nothing in
   this plan removes them.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

**Conventions for every unit.** TypeScript on Node.js 26 with Effect 4 at
the engine's pinned version. Effect APIs are looked up in the current
documentation before they are written (team rule 7); the test clock is
`TestClock` from `effect/testing`, advanced with `TestClock.adjust`, inside
`it.effect` from `@effect/vitest`, which provides it by default (checked on
2026-11-03 against the Effect 4.0.4 `@effect/vitest` README through
context7). New packages follow the engine's layout:
`packages/<name>/src`, `packages/<name>/test`, `package.json`,
`tsconfig.json`, on the pattern of `packages/client/package.json`. Every
connection to the engine goes through `packages/client/src/index.ts:connect`;
no unit opens the socket itself. No unit reads an agent's screen or types
into a pane. Text from an agent, a tool call's input or a file is data: it
is matched, shortened and quoted, never followed. The words
"`CA-n`" and "`B-n`" refer to the items of `requests.md` as the frozen
contracts answer them; until they freeze, each such task is marked
**contract pending**.

**WS-1: Agents know their role, their team and their rules**

This work gives Shephrd a vocabulary for roles and a way for each agent to
read its own situation. Role names are parsed from the free `role` string
the engine already stores. Role files come from outside the repository and
carry the advice text and limits; Shephrd ships a schema and three generic
defaults, not a team.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | `parseRole("worker:builder")` gives kind `worker`, name `builder`; `parseRole("")` and `parseRole("chef")` give kind `worker` with an `unknown-kind` flag | `packages/roles/test/role.test.ts` R01-R03 |
| 1.2 | A role file that fails the schema is refused with the failing path and line, and the previous file stays loaded | `packages/roles/test/roleFile.test.ts` F01-F04 |
| 1.3 | A role file with a key outside the schema (for example a `permission` or `rules` key) is refused, so a role file cannot grant permissions | `packages/roles/test/roleFile.test.ts` F05 |
| 1.4 | `shephrd orient` run by an agent prints its name, role kind and name, parent, children with their states, open permission requests and questions, and its role's advice; run by the owner it is refused with "orient is for agents" | `packages/roles/test/orient.test.ts` O01-O04, against the fake engine rig |
| 1.5 | The MCP tool `orient` returns the same fields as the command | `packages/mcp/test/orient-tool.test.ts` T01 |
| 1.6 | Advice text in a role file is shown as data inside an envelope with a random marker, and a leading `/` is escaped | `packages/roles/test/orient.test.ts` O05 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | `parseRole` and the three kinds, with generic advice text for each (orchestrator talks to leads; a lead starts and waits on its own workers; a worker reports to its lead and does not start agents or ask the owner) | target `packages/roles/src/role.ts:parseRole`; neighbouring pattern `packages/contracts/src/permission.ts:permissionLevels` |
| 1b | Role-file schema (role name → advice text, sheepdog limits from WS-4's settings shape) and loader, from a path the owner sets through CA-4; the schema has no permission fields | target `packages/roles/src/roleFile.ts:RoleFile`, `loadRoleFile`; pattern `packages/contracts/src/harnesses.ts` (Effect Schema of a settings object) |
| 1c | `orient`: compose CA-1's roster query for the caller's own row, its parent and its children with their open requests; wrap advice with the engine's envelope rule | target `packages/roles/src/orient.ts:orient`; pattern `packages/engine/src/routing/envelope.ts`; **contract pending** (CA-1) |
| 1d | CLI subcommand `shephrd orient` and MCP tool `orient` | `packages/cli/src/commands/registry.ts:commandNames`, `summaries`; `packages/mcp/src/tools.ts:toolNames`, `descriptions` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A role file is used to widen what an agent may do | major | The schema has no permission, rule or account fields (1.3); standing rules are a separate, owner-only store (WS-2). |
| An agent edits the role file, since agents run as the owner's user (engine decision row 47) | minor | The same accepted risk as the state folder; the loader logs each load with the file's hash, and the owner sets the path through CA-4. Recorded for docs/issues.md. |
| CA-1 lands without the open-requests field | minor | `orient` shows what the roster gives and the gap is a known gap until the client API adds it. |

**Verify:** `pnpm --filter @shephrd/roles test`; `pnpm --filter @shephrd/mcp test`. Device or environment QA: none.

**WS-2: Routine permission requests are answered by owner-approved rules**

This work adds standing rules: a schema, a pure matcher, the owner's
commands to manage them, and the answerer. The matcher decides; it never
reads anything an agent can choose except what the adapter reports for the
request (the request's `description` and the tool call's `input`, joined by
`toolCallId`). The answerer is either the engine's pre-delivery seam
(WS-7a, if the owner allows it) or the sheepdog acting with its service
credential (fallback).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | A request whose tool-call input is the command `pnpm test` in the asker's folder, from a harness and role the rule names, matches; the matcher returns the request's `allow_once` option id | `packages/roles/test/rules.test.ts` M01 |
| 2.2 | Commands with `;`, `&&`, `||`, `|`, `` ` ``, `$(`, `>`, `<`, a newline or a here-document do not match any rule | `rules.test.ts` M02-M10 |
| 2.3 | A request with `settingsWrite: true`, a request offering no `allow_once` option, and a request whose `allow_once` option's level is above the asker's mode never match | `rules.test.ts` M11-M13 |
| 2.4 | A command run in a folder outside the asker's folder, or with an argument path that resolves outside it, does not match | `rules.test.ts` M14-M15 |
| 2.5 | A disabled or expired rule does not match; the first rule by id wins when two match | `rules.test.ts` M16-M17 |
| 2.6 | Only the owner can add, disable or remove a rule; an agent's attempt is refused and logged | `packages/sheepdog/test/rules-commands.test.ts` C01-C03; **contract pending** (CA-4) |
| 2.7 | Fallback answerer: a matching request is answered through the service credential with the rule's id recorded, within 2 seconds of `PermissionRequested` | `packages/sheepdog/test/answerer.test.ts` A01 |
| 2.8 | A rule's first use raises the "standing rule used for the first time" notice to the owner, once | `answerer.test.ts` A02 |
| 2.9 | With WS-7a: a matching request is answered in the same transaction as `PermissionRequested`, and no delivery to the holder is written | `packages/engine/test/routing/standing-rules.test.ts` SR01 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a | Rule schema: id, harnesses, roles or groups, command prefix as a word list, folder scope (`own-folder` only in this version), optional expiry, enabled flag, owner note | target `packages/roles/src/rules.ts:StandingRule`; pattern `packages/contracts/src/permission.ts` |
| 2b | Command splitter that refuses shell control characters and splits words without a shell | target `packages/roles/src/commandWords.ts:splitCommand`; pattern `packages/cli/src/commands/sanitize.ts` |
| 2c | `matchRule(request, toolCall, asker, rules)`: pure, returns an option id or a reason; uses the engine's option kinds and levels | target `packages/roles/src/rules.ts:matchRule`; uses `packages/contracts/src/permission.ts:acpPermissionOptionKinds`, `permissionForOptionKind`; the asker's folder rule follows `packages/engine/src/identity/ceiling.ts` (protected paths, l.239-244) |
| 2d | Owner commands for rules (list, add, disable, remove), carried by the client API's owner settings | **contract pending** (CA-4); CLI registry `packages/cli/src/commands/registry.ts` |
| 2e | Fallback answerer in the sheepdog: on `PermissionRequested`, find the tool call by `toolCallId` in the asker's `ThreadItem` events (`content._tag: "tool-call"`, `callId`, `input`), match, then answer through the service credential naming the rule | target `packages/sheepdog/src/answerer.ts`; event shapes `packages/contracts/src/events.ts:Event` (`PermissionRequested`, `ThreadItem`); **contract pending** (CA-3) |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A rule is stretched by a crafted command (compound shell, path escape, quoting tricks) | blocker | 2.2 and 2.4; the splitter refuses rather than parses anything unusual; attack pass on units 2a-2c. |
| The tool call's `input` is missing or in an adapter-specific shape | major | No input, no match: the request goes to the holder as today. Each harness's input shape is read from the recorded fixtures (`packages/testing/fixtures/*.ndjson`) and pinned in a test. |
| The fallback answers after the holder was already prompted, so the lead still wakes | major | Accepted for the fallback; WS-7a removes it. The answer still saves the lead's decision and the owner's escalation. |
| An answer is recorded as the owner's | major | The fallback answers only with the service credential (CA-3), never the owner's. |
| A rule outlives its purpose | minor | Optional expiry; the owner lists rules from any client; the first-use notice (2.8). |

**Verify:** `pnpm --filter @shephrd/roles test`, `pnpm --filter @shephrd/sheepdog test`; with WS-7a, `pnpm --filter @shephrd/engine test`. Device or environment QA: none.

**WS-3: A background sheepdog keeps every agent moving**

This work builds the sheepdog's base: the program, its connection, its
rebuild from the log, its settings, its notices and its snooze. It holds no
rules of its own; WS-4, WS-5 and WS-2's answerer plug into it.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | `shephrd sheepdog` connects with the service credential, subscribes from sequence 0 and folds every event into its state; the folded state equals a fold of the same log read from the database | `packages/sheepdog/test/fold.test.ts` S01 |
| 3.2 | After a restart in the middle of a run, the sheepdog sends no nudge or notice it had already sent (it finds its own past actions in the log) | `fold.test.ts` S02 |
| 3.3 | Two copies started at once: the second exits, naming the first | `packages/sheepdog/test/lock.test.ts` L01 |
| 3.4 | Every nudge goes through the board's delivery interface; every notice to a parent is a needs-reply post from the system author | `packages/sheepdog/test/notices.test.ts` N01-N02; **contract pending** (B-1, B-4) |
| 3.5 | `sheepdog snooze <group> <hours>` by the owner stops team notices for that group until the time passes; an agent cannot snooze | `notices.test.ts` N03-N04; **contract pending** (CA-4) |
| 3.6 | The Herdr plugin starts the sheepdog after `serve`, and the sheepdog waits for the engine's "recovering" answer to clear before acting | `packages/sheepdog/test/startup.test.ts` U01; `herdr-plugin.toml` has a second `[[startup]]` entry |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a | Package and entry point; lifetime lock in the state folder | target `packages/sheepdog/src/main.ts`; pattern `packages/engine/src/lock.ts` |
| 3b | Fold of events into the sheepdog's state (agents, groups, open items, turns, its own past actions), as a pure function | target `packages/sheepdog/src/fold.ts:apply`; pattern `packages/engine/src/views/apply.ts:apply`, `emptyViews` |
| 3c | Connection and resumed subscription | `packages/client/src/index.ts:connect`, `subscribe` (auto-resumes after the last sequence) |
| 3d | Settings shape (every limit in decision row 16), defaults, per-role overrides from WS-1's role file | target `packages/sheepdog/src/settings.ts`; **contract pending** (CA-4) |
| 3e | Notices and nudges through the board's delivery interface; snooze | target `packages/sheepdog/src/notices.ts`; **contract pending** (B-1, B-4, CA-5) |
| 3f | Timers on Effect's clock, tested with `TestClock.adjust` | pattern `packages/engine/src/accounts/timers.ts:startAccountTimers` |
| 3g | Second startup entry in the plugin manifest; `serve` is not changed | `herdr-plugin.toml` `[[startup]]`; `packages/cli/src/serve.ts` (read only) |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Duplicate or lost nudges across a sheepdog restart | major | Rebuild from the log including its own actions (3.2); every action carries a request id derived from the triggering event's sequence number, so a resend after a crash acts once (engine design, "Repeated requests"). |
| The sheepdog falls behind on a long log | minor | The client's resumed subscription; a fold over a recorded long log is measured in a test (under 5 seconds for 100,000 events). |
| The service credential's rights are wider than the sheepdog needs | major | The sheepdog uses only the commands CA-3 grants; a test lists every command it calls and compares it with the grant. |

**Verify:** `pnpm --filter @shephrd/sheepdog test`. Device or environment QA: none.

**WS-4: Stalls, crashes and capacity errors are handled without the owner**

This work adds the sheepdog's rules. Each is a pure function from the
folded state and the clock to a list of actions, so each is tested alone.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Team idle: a group whose agents are all idle, paused for a limit or stopped, with no open wait, request, question or queued delivery, for 60 minutes, gets one nudge to its top agent and one notice to that agent's parent; then hourly; a group with any agent paused for a usage limit is not counted as idle | `packages/sheepdog/test/rules/team-idle.test.ts` TI01-TI05 |
| 4.2 | Stalled work: an agent whose board work state is assigned or working, but which is idle with no new thread item for its role's limit, gets one wake; 10 minutes later its parent is told; the third stall in a row on the same work item, with no new commit, file change or tool call between, tells the parent to replace it and offers `shephrd handoff` | `rules/stall.test.ts` ST01-ST06; **contract pending** (B-2) |
| 4.3 | Runaway turn: a turn running longer than the role's limit (default 120 minutes) tells the parent once per turn | `rules/runaway.test.ts` RW01-RW02 |
| 4.4 | Capacity error: with WS-7b, an agent paused with reason "capacity" is resumed 5 minutes later, up to 12 times, then the parent is told once to move the work to another model; without WS-7b, a `DeliveryReturned` whose reason matches the capacity patterns is re-sent by the sheepdog on the same schedule | `rules/capacity.test.ts` CP01-CP04 |
| 4.5 | Crash: the first `AgentCrashed` for an agent is followed by one `resume`; a second within an hour is not retried, and the parent is told "gave up after two crashes" | `rules/crash.test.ts` CR01-CR03 |
| 4.6 | Usage-limit and sign-in pauses are never nudged and never counted as stalls | `rules/stall.test.ts` ST07; `rules/team-idle.test.ts` TI04 |
| 4.7 | Role advice broken: a worker that starts an agent or asks the owner a question is reported to its parent once per kind of break | `rules/role-advice.test.ts` RA01-RA02 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 4a | Team idle rule over engine groups | target `packages/sheepdog/src/rules/teamIdle.ts`; groups from `AgentStarted.groups` and `AgentGrouped` (`packages/contracts/src/events.ts:Event`) |
| 4b | Stall rule and stall counter per work item | target `packages/sheepdog/src/rules/stall.ts`; **contract pending** (B-2); pattern for the counters `packages/engine/src/routing/waits.ts` (settled rules) |
| 4c | Runaway rule from `TurnStarted` and `TurnEnded` | target `packages/sheepdog/src/rules/runaway.ts` |
| 4d | Capacity rule: patterns `Selected model is at capacity`, `API Error: 529`, `overloaded_error`, `model is currently overloaded`, kept in one table; resend or resume | target `packages/sheepdog/src/rules/capacity.ts`; patterns from `FOUNDRY/scripts/capacity-retry.sh` `CAPACITY_RE` (scouting.md, Scout S); `DeliveryReturned {sender, reason}` |
| 4e | Crash rule: one `resume`, then give up | target `packages/sheepdog/src/rules/crash.ts`; `AgentCrashed` from `packages/engine/src/recovery/crash.ts:64`; `resume` in `packages/contracts/src/commands.ts` |
| 4f | Role-advice reports | target `packages/sheepdog/src/rules/roleAdvice.ts`; `parseRole` from WS-1 |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Notices wake leads so often that they cost more than they save | major | One notice per event, hourly repeats at most, snooze per group; the acceptance test counts wakes per lead. |
| The fallback capacity resend re-sends as the sheepdog, so the agent sees a different sender | minor | The resend quotes the original sender in its envelope; recorded as a known gap until WS-7b. |
| A crash loop on resume | major | One retry per hour per agent (decision row 17); the parent is told when it gives up. |
| Stall rules that depend on work state ship before the board | major | 4.2 waits for B-2; until then the team-idle and runaway rules cover the silent cases. |

**Verify:** `pnpm --filter @shephrd/sheepdog test`. Device or environment QA: none.

**WS-5: Context is compacted when it is cheapest**

This work schedules a compaction for an idle Claude agent two minutes
before its prompt cache expires, when its context is above the role's floor
and nothing is pending. The cache lasts one hour after a request that wrote
one-hour cache tokens, otherwise five minutes after one that wrote
five-minute cache tokens, otherwise the expiry is unknown and nothing is
scheduled (T3 Code's rule, `docs/research/t3-code.md` item 4).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | Given a last call with one-hour cache tokens at time T and 200,000 context tokens, a compact request is sent at T + 58 minutes | `packages/sheepdog/test/rules/compaction.test.ts` CM01 (`TestClock.adjust`) |
| 5.2 | No request when the agent has a queued delivery, an open request, question or wait, is compacting, or its last turn was a compaction; a newer turn replaces the timer | `compaction.test.ts` CM02-CM06 |
| 5.3 | No request below the role's floor (default 150,000 tokens) or when the expiry is unknown | `compaction.test.ts` CM07-CM08 |
| 5.4 | With WS-7c the usage comes from `TurnEnded`; without it, from the Claude transcript in the account's config folder, and a missing or unreadable transcript schedules nothing | `compaction.test.ts` CM09-CM10 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5a | Expiry rule (one hour, five minutes, unknown) and the compaction schedule | target `packages/sheepdog/src/rules/compaction.ts`; source idea T3 Code `apps/server/src/orchestration-v2/IdleCompaction.ts` (read, not copied; if copied, AGENTS.md rule 2 applies) |
| 5b | Usage source: `TurnEnded` usage (WS-7c) or the transcript reader | target `packages/sheepdog/src/usage.ts`; transcript fields from `FOUNDRY/scripts/context-keeper.sh:last_call` (`.message.usage.input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; scouting.md, Scout S answer b) |
| 5c | Send `compact` through the service credential | `packages/contracts/src/commands.ts` `compact`; `packages/engine/src/runner/compact.ts:compactPrompt` (read only) |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The ACP adapter writes no transcript, or writes it elsewhere | major | Checked in the live check (9.4); without a transcript nothing is scheduled, which is today's cost, not a new one. |
| A compaction lands just as work arrives | minor | 5.2; the engine refuses `compact` on a non-idle agent (engine design change list, "One state machine"). |
| Codex and other harnesses get no timed compaction | minor | Without WS-7c only Claude is covered; recorded as a known gap. |

**Verify:** `pnpm --filter @shephrd/sheepdog test`; live check 9.4. Device or environment QA: the live check.

**WS-6: A replacement worker starts from what the old one did**

This work builds `shephrd handoff <agent>`, which reads the agent's thread
and prints a budgeted hand-off: the first prompt whole, the last exchange
whole, then the most recent tool calls and file changes, each shortened to
240 characters, within 16,000 tokens, with the sequence numbers of what it
left out (T3 Code's budget, `docs/research/t3-code.md` item 5).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | The hand-off always contains the first prompt and the last exchange whole, and is under the budget for a 5,000-item thread | `packages/roles/test/handoff.test.ts` H01-H02 |
| 6.2 | It lists the sequence numbers it left out | `handoff.test.ts` H03 |
| 6.3 | The old agent's text is inside a data envelope, and secrets already redacted in the log stay redacted | `handoff.test.ts` H04 |
| 6.4 | A parent may build a hand-off only for its own child; the owner for anyone | `handoff.test.ts` H05; **contract pending** (CA-2) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6a | Budgeted selection over `PromptSent` and `ThreadItem` events | target `packages/roles/src/handoff.ts:buildHandoff`; event shapes `packages/contracts/src/events.ts` (`ThreadContent`: text, plan, tool-call, file-change) |
| 6b | Thread read through CA-2; CLI subcommand and MCP tool `handoff` | **contract pending** (CA-2); `packages/cli/src/commands/registry.ts`; `packages/mcp/src/tools.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The hand-off drops the detail the replacement needed | minor | The brief and last exchange are always whole; the omitted sequence numbers let the new worker ask its parent. |
| One agent's text instructs the replacement | major | Data envelope and escaped leading `/` (engine design change list, "What agents are given"); 6.3. |

**Verify:** `pnpm --filter @shephrd/roles test`. Device or environment QA: none.

**WS-7: Three small engine changes, if the owner allows them**

Decision row 11 is open. If the owner says no, this workstream is dropped
and the fallbacks in WS-2, WS-4 and WS-5 ship. Each change keeps
`pnpm --filter @shephrd/engine test` and the engine's acceptance suite
passing.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 7.1 | 7a: a request matching an enabled standing rule is answered in the same transaction as `PermissionRequested`, `PermissionAnswered` names the rule, and no delivery to the holder is queued; a non-matching request is routed as before | `packages/engine/test/routing/standing-rules.test.ts` SR01-SR03; `packages/engine/test/acceptance/capability-07-permissions.test.ts` unchanged and passing |
| 7.2 | 7b: a capacity error requeues the message at the front and pauses the agent with reason "capacity"; no `DeliveryReturned` is written | `packages/engine/test/runner/classify-capacity.test.ts` K01-K02 |
| 7.3 | 7c: `TurnEnded` carries optional input, cache-read and cache-write token counts and cache lifetime when the adapter reports them, and the rebuild check still passes | `packages/engine/test/runner/usage.test.ts` U01-U02; `packages/engine/test/support/rebuildCheck.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 7a | Standing-rule seam: rules as owner-only events; `permissionRequested` calls `matchRule` from `packages/roles` before routing | `packages/engine/src/routing/permissions.ts`, `routing/holders.ts:holderAbove`; `packages/contracts/src/events.ts:Event` |
| 7b | Capacity class | `packages/engine/src/runner/classify.ts:classifyError`; `packages/engine/src/routing/deliveries.ts:pauseAgent`, `failed`; `packages/contracts/src/stateMachine.ts:LifecycleState` |
| 7c | Usage on `TurnEnded` | `packages/engine/src/runner/translate.ts`; `packages/contracts/src/events.ts` `TurnEnded` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| 7a puts the matcher inside the permission path, the engine's most sensitive code | major | The matcher is the same pure function tested in WS-2; attack pass on 7a; the existing permission acceptance test is unchanged. |
| 7b pauses an agent forever when the capacity error never clears | minor | The sheepdog's 12-retry limit (4.4) and its notice to the parent. |
| 7c adds fields a replayed old log lacks | minor | The fields are optional; the rebuild check covers old logs. |

**Verify:** `pnpm --filter @shephrd/engine test`. Device or environment QA: none.

**WS-8: Proof that the Foundry needs nothing else**

This work writes the recipe and proves it. The recipe is a document in this
repository; the Foundry skill that will use it is in the Founder OS
repository and is changed after this plan, by the owner or the manager.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 8.1 | `docs/foundry.md` maps every action of the Foundry skill's Steps 3, 4, 5 and 8 to a Shephrd command, setting or sheepdog rule, or marks it as team workflow that stays in the skill | `grep -c 'herdr agent\|collect.sh\|board-waker.sh' docs/foundry.md` prints `0` outside its "What this replaces" table |
| 8.2 | The acceptance test runs an orchestrator, two leads and two workers each, with fake agents, through the public socket only, and passes these steps: leads and workers start with roles and groups; `orient` answers each; a standing rule answers a worker's test run; a lead's `wait` on its workers is satisfied once; a worker stalls and is woken, then reported; a capacity error is retried; a worker crashes, is resumed once, crashes again and is reported; a team idles and its lead is told; the wrap-up reads the roster for an attribution table and exports each thread | `packages/sheepdog/test/acceptance/foundry-run.test.ts` FR01-FR10 |
| 8.3 | The same test counts lead wakes and shows none caused by a matched standing rule (with 7a) or at most one per matched rule (fallback) | `foundry-run.test.ts` FR11 |
| 8.4 | Live check, by hand: the same flow on a real Claude Code lead and a real Codex worker on the owner's accounts, including one standing rule and one compaction | `pnpm live-check:roles`, run by the owner; its report saved under `.scratch/` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 8a | Recipe `docs/foundry.md`, step by step against `FOUNDRY/SKILL.md` Steps 3, 4, 5 and 8 | target `docs/foundry.md`; source `FOUNDRY/SKILL.md` "Step 3 — Open an area" to "Step 5 — Watch, approve, escalate" and "Step 8 — Wrap up" |
| 8b | Acceptance test on the engine's rig | pattern `packages/engine/test/acceptance/flow-start-to-finish.test.ts`; `packages/engine/test/support/acceptance.ts`, `serviceProcess.ts` |
| 8c | Live check script | pattern `packages/engine/scripts/live-check.ts`, `packages/engine/scripts/live/flow.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A Foundry action has no Shephrd equivalent and is found only when the skill is rewritten | major | 8.1 walks every action of the four steps; anything unmapped becomes an issue in `docs/issues.md` before the plan is done. |
| The fake agents behave more politely than real ones | minor | The live check (8.4). |
| The skill rewrite happens in another repository and is forgotten | minor | Rollout step 7 names it; the epic's first "Done when" bullet is checked against it by the manager. |

**Verify:** `pnpm --filter @shephrd/sheepdog test`; live check 8.4 by hand. Device or environment QA: the live check on the owner's accounts.

**Post-build checks.** Code-level worries this plan cannot settle: (1) the
shape of each harness's tool-call `input` for shell commands (pin from the
recorded fixtures); (2) whether `claude-agent-acp` writes a transcript the
reader can find under the account's `CLAUDE_CONFIG_DIR`; (3) whether a
write to the role file or the rules store by an agent is caught by the
engine's settings-write rule (`identity/ceiling.ts` protected paths) or
only by the accepted risk of engine decision row 47.

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (A) epic row 4 and the epic's three "Done when" bullets;
(B) the engine design's "What stays out of the engine" items for piece 4;
(C) `docs/features.md` section 1 rows not built in the engine, and section
5; (D) `docs/research/t3-code.md` items 4, 7 and 8; (E) the Foundry skill's
Steps 3, 4, 5 and 8 and the scripts `collect.sh`, `board-waker.sh`,
`team-idle-watch.sh`, `context-keeper.sh`, `capacity-retry.sh`;
(F) decisions.md.

| Source item | Workstream | Status |
|---|---|---|
| A: orchestrator, team leads, workers | WS-1 | mapped |
| A: standing permission rules | WS-2, WS-7a | mapped |
| A: the sheepdog | WS-3, WS-4, WS-5 | mapped |
| A: Done when 1 (Steps 3-5 and 8 through Shephrd alone) | WS-8 | mapped; the skill rewrite is rollout step 7 |
| A: Done when 2 (phone pairing and answers) | — | piece 2 (client API plan) |
| A: Done when 3 (a message wakes only the agent that needs it) | — | piece 3 (board plan); WS-3 sends nudges through its interface |
| B: rules for each role | WS-1, WS-4f | mapped (advice, row 10) |
| B: standing permission rules | WS-2 | mapped |
| B: retrying, replacing or giving up | WS-4e, WS-4b, WS-6 | mapped |
| C: Orchestrator, Team leads, Worker kinds (idea) | WS-1 | adopted as kinds (row 14) |
| C: Start, stop, and reuse (idea) | — | not adopted: reuse is team workflow (row 5) |
| C: Shephrd's tools over MCP (idea) | WS-1d, WS-6b | `orient` and `handoff` tools added |
| C: Hand-offs built from records (idea) | WS-6 | mapped |
| C: Stall watch (idea) | WS-4b | mapped, rules from row 16 |
| C: Usage-limit pauses are not stalls (idea) | WS-4 (4.6) | mapped; the resume itself is the engine's |
| C: Stuck input boxes and approval dialogs (idea) | — | not needed in ACP mode: no input box; approvals go to the holder (engine) |
| C: Compaction timed to the prompt cache (idea) | WS-5 | mapped; "deliver before the cache expires" is B-6 |
| C: Runaway work (idea) | WS-4c | mapped |
| D: item 4 (cache-timed compaction) | WS-5 | mapped |
| D: item 7 (a wait result that says why) | — | built in the engine (`WaitSatisfied` member reasons, CLI exit codes; scouting.md, Scout E items 3 and 5) |
| D: item 8 (usage limit is its own stall) | WS-4 (4.6) | mapped |
| E: Step 3 start lead, relayer, team, watchers | WS-8a | lead start is engine `start`; relayer and team shape stay in the skill; watchers are WS-3/4/5 |
| E: Step 4 workers | WS-8a | engine `start` with role and group; worktrees stay in the skill (git) |
| E: Step 5 approve and escalate | WS-2, WS-8a | standing rules; escalation is the engine's `pass-up` and `OwnerNeeded` |
| E: Step 8 wrap-up | WS-8a, WS-8b | roster (CA-1) and thread export (CA-2) for attribution and archive; `stop` |
| E: collect.sh | WS-8a | engine `wait` with mode all; timeout cases by WS-4a and WS-4c |
| E: board-waker.sh | — | piece 3's wake rules; WS-3 uses its interface |
| E: team-idle-watch.sh | WS-4a | mapped |
| E: context-keeper.sh | WS-5, WS-4c | compaction and the two-hour worker cap; the advisor check is team workflow and stays in the skill |
| E: capacity-retry.sh | WS-4d, WS-7b | mapped |
| F: rows 1-18 | all | each row's workstream named in its own text |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: never push to `vitalysim/herdr-synapse` | Units push only to `qnlbnsl/sheprd`. |
| `AGENTS.md` rule 2: credit copied code | No code is planned as copied. T3 Code's idle compaction and hand-off are read as designs (WS-5a, WS-6a); a builder who copies code follows rule 2 and the unit's review checks it. |
| `AGENTS.md` rule 3: keep the lists current | The result file's "For docs/issues.md" and "For docs/features.md" sections; WS-8 risk row 1. |
| `AGENTS.md` rule 4 and SECURITY.md rule 7 | Decision row 15; WS-2 criteria 2.2-2.6; WS-1 criteria 1.3, 1.6; WS-6 criterion 6.3; attack passes in the sizing fold. |
| SECURITY.md rule 6: secrets never reach a client | The hand-off reads only redacted log text (6.3); the transcript reader reads only usage fields (5b). |
| `AGENTS.md` rule 5: the client API is the product's surface | Every owner action (rules, limits, snooze, role-file path) is an owner command through the client API (CA-4). |
| `AGENTS.md` rule 6: team shapes do not belong here | Role files and team definitions live outside the repository (rows 5, 14); the recipe says which Foundry actions stay in the skill. |
| `AGENTS.md` "How agents are run": one delivery interface | The sheepdog's nudges go through the board's delivery interface (B-1); nothing depends on the run mode. |
| `AGENTS.md` "Language" | Conventions paragraph; Effect checked against documentation. |
| `AGENTS.md` rule 7 and team rules 2 to 6 | Planners commit their own branch only; builders follow the build run's rules. |
| Epic, 2026-10-30: built on the engine without changing it | Row 6 and row 13; WS-7 waits on the owner (row 11). |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its
harness-session skill) at launch; this section names none (owner,
2026-10-16). The scopes below do not exist yet: the lead runs the scoping
skill for `roles/backend`, `roles/contracts` and `roles/docs-research`
before the first launch; WS-7 uses the existing `engine/backend`.

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1 Role names and role files (1a, 1b) | contracts | roles/contracts | low | One parser and one schema with no design choice left. | no | none |
| 2 `orient` command and tool (1c, 1d) | backend | roles/backend | medium | Composes a query on a fixed contract into CLI and MCP wrappers. | no | 1, CA-1 |
| 3 Rule schema, splitter, matcher (2a-2c) | backend | roles/backend | high | Decides permissions without a human; enforcement code. | yes | none |
| 4 Rule commands and fallback answerer (2d, 2e) | backend | roles/backend | medium | Wires the matcher to fixed contracts. | yes | 3, 5, CA-3, CA-4 |
| 5 Sheepdog base (3a-3g) | backend | roles/backend | medium | A fold on the engine's view pattern plus a lock and timers. | no | CA-3, B-1 |
| 6 Idle, runaway, crash and role-advice rules (4a, 4c, 4e, 4f) | backend | roles/backend | medium | Pure rules over the fold, one test file each. | no | 5 |
| 7 Stall rule and counter (4b) | backend | roles/backend | medium | One rule on the board's work state. | no | 5, B-2 |
| 8 Capacity rule (4d) | backend | roles/backend | low | A pattern table and a timer on a fixed event. | no | 5 |
| 9 Timed compaction (5a-5c) | backend | roles/backend | medium | One schedule with known guards from T3 Code's design. | no | 5 |
| 10 Hand-off builder (6a, 6b) | backend | roles/backend | medium | Budgeted selection over fixed event shapes. | no | CA-2 |
| 11a Standing-rule seam (7a) | backend | engine/backend | high | Inside the engine's permission path, in one transaction. | yes | 3, row 11 |
| 11b Capacity class (7b) | backend | engine/backend | low | One new error class on an existing pattern. | no | row 11 |
| 11c Usage on `TurnEnded` (7c) | contracts | engine/backend | medium | An event field plus the runner's translation. | no | row 11 |
| 12 Recipe (8a) | docs-research | roles/docs-research | medium | Checked step by step against the skill. | no | 2, 4, 5 |
| 13 Acceptance test (8b) | backend | roles/backend | medium | One scenario on the engine's acceptance rig. | no | 2, 4, 6-10 |
| 14 Live check (8c) | backend | roles/backend | low | One script, run by the owner. | no | 13 |

Load: 16 build units (13 if the owner declines row 11). Following the
sheet's builder, test-writer and focused-review seats, each unit is about
three launches, plus two for each of the three attack-pass units: about 54
launches (45 without WS-7). From the sheet's tables, about two thirds of the
builds land on the OpenAI vendor (backend low and medium) and the Anthropic
vendor carries the high units' alternates, the test writers for OpenAI
builds and the attack verifiers. The planner cannot read either vendor's
remaining weekly allowance; the lead checks both before launching and
schedules units 11a to 14 after a reset if either would run out (known gap
1).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|
| — | — | Not run yet. The plan is in DISCOVER until both contracts freeze and row 11 is answered. |

</details>
