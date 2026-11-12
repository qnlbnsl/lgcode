# Round 3, architect lens: plan v3

Reviewer: architect lens, round 3 (the final round), isolated context,
2026-11-01. Target: `attack/plan-v3.md`, scoped to the round-2 patches
(rows 52, 54, 55, 59, 60, 62 and 63), the new unit 6d, the sizing table and
the launch totals. Known gaps in `attack/known-gaps.md` are not re-reported.

Sources checked:

- T3 Code at `6fc9144a60c4a5f45089316ddd5f7371bafd3bf2` (scouting checkout),
  including `packages/effect-acp` and the vendored Effect source
  (`.repos/effect-smol`, version 4.0.1).
- Effect 4.0.5 as published: `effect@4.0.5/src/socket/Socket.ts`,
  `@effect/platform-node@4.0.5/src/NodeSocket.ts` and
  `effect@4.0.5/src/ai/McpServer.ts`, read from unpkg on 2026-11-01.
- The published tarballs of `@agentclientprotocol/claude-agent-acp` 0.99.1
  and `@agentclientprotocol/codex-acp` 2.5.0 (both published 2026-10-29),
  unpacked and read. Nothing was run.

## Verdict: REVISE

The top finding is that the permission ceiling's mode set-back still uses
`session/set_mode`, and that call fails against both pinned adapters. Each
adapter negotiates the draft ACP version 2 when the copied client offers it.
On version 2 the copied client refuses `session/set_mode` with "method not
found". So an adapter-reported mode change above the ceiling cannot be set
back. Round 2's architect finding 4 asked for the `mode` config option to be
used here, and plan v3 folded only the model and effort half of it.

Counts: 0 BLOCKER, 5 MAJOR, 5 MINOR. Every fix is a short edit to a row or a
criterion. None of them reopens an owner ruling.

## Findings

### 1. MAJOR, Security (isolation) and Design: the mode set-back fails on ACP version 2, which both pinned adapters negotiate

Evidence:

- Row 35(c) (`plan-v3.md:887`) sets a mode back "with `session/set_mode`".
  Criterion 6.13 (line 571) and task 6a.4 (line 581) name no other method.
  Row 60 (line 912) covers only model and effort.
- The copied client offers version 2 in `initialize`
  (`effect-acp/src/client.ts:695-702`, `1078-1089`). It fails
  `setSessionMode` with "method not found" whenever generation 2 was
  negotiated (`client.ts:1209-1217`; doc comment at `client.ts:121-124`:
  "ACP v2 fails with method-not-found; use `setSessionConfigOption`").
- codex-acp 2.5.0 always enables version 2:
  `agentProtocolRouter().withV1(v1Agent).withV2(v2Agent)` in
  `dist/index.js`. claude-agent-acp 0.99.1's router defaults to `auto`,
  where "a client that requests version 2 or later gets the draft ACP v2"
  (`dist/serve.js:36-50`).
- Both adapters expose a config option with `category: "mode"`
  (claude `dist/session-mode.js:71`; codex `dist/index.js`). T3 sets modes
  that way and uses `session/set_mode` only for version 1 agents that
  advertise no mode option (`packages/provider-acp/src/server/AcpSessionRuntime.ts:2611-2629`).

Consequence: an agent that switches itself to a wider mode keeps it, which
breaks the ceiling. The recorder's "read-only mode" (overview item 3,
criterion 8.2) also has no working way to set the mode on these adapters.

Fix: extend row 60 to the `mode` category. Set the starting mode, the
recorder's read-only mode and every set-back through
`session/set_config_option` on the option whose category is `mode`. Use
`session/set_mode` only on generation 1 when no such option exists. Make
criterion 6.13 assert the set-back on a generation 2 fake agent.

### 2. MAJOR, Design: the fake agent has no way to call an LGTM Studio command

Evidence:

- Criterion 7.10 (line 624) requires that "a reloaded fake agent's tool call
  during its carry-on turn succeeds".
- The acceptance tests in 8.3 (line 666) run "through the public socket
  only, with real tokens". Capabilities 2, 5 and 7 need an agent that
  starts a child, waits or passes a request up.
- The fake agent's script list in criterion 8.1 (line 664) has no step that
  calls LGTM Studio. Its "tool call" step is an ACP `tool_call` report, not a
  call to LGTM Studio.
- `packages/testing` depends only on contracts and third_party (row 23,
  line 875), plus `ws` (task 1d). It does not depend on `packages/client`,
  so the fake agent would have to re-implement the RPC client.

Fix: let `packages/testing` depend on `packages/client`. This makes no cycle,
because `client` depends only on `contracts`. Add the script step "call a
LGTM Studio command with `LGTM_TOKEN` over `LGTM_SOCKET`" to 8.1.
Optionally, in 8b, also have the fake agent spawn the `mcpServers` entry it
received and call one tool through `lgtm mcp`, which is the path real
adapters take.

### 3. MAJOR, Design (contract): "refused at `start`" is impossible as written, and the contracts have no event for a start that fails later

Evidence:

- Row 60 and criterion 6.11 (line 569) say that "a model, effort or mode the
  harness cannot set is refused at `start`".
- An adapter reports its config options only in its `session/new` reply.
  That reply arrives after `start` has already written "agent started" and
  replied (criterion 5.4's `start` row, line 509).
- Task 3d's event list (line 424) has "agent reload failed" but no "agent
  start failed". Task 3c's state machine (line 423) has no state for an
  agent whose session could not be configured.
- In claude-agent-acp 0.99.1, the effort option depends on the chosen model
  (`dist/session-effort.js`). So the order in which model and effort are set
  matters, and the plan does not state it.

Fix: choose one of two rules. Either validate at `start` against the
harness's config options as recorded in the fixtures and the last session,
or add an "agent start failed (reason)" event that stops the adapter, moves
the agent to stopped, revokes its token and resolves any wait on it. Set the
model first, then re-read the options, then set the effort.

### 4. MAJOR, Design (ordering): criterion 5.4, in unit 5b, depends on units 5d, 6b and 6d

Evidence: in the lifecycle table (lines 505-518), unit 5b (sizing line 809,
which depends on 5a and 4c) must show these results:

- `resume`: "recovery step 10 for this agent … unaccepted deliveries re-sent
  or carry-on queued". Step 10 is task 6d.1 (line 586).
- `stop`: "open waits by it cancelled". Waits are task 5d.1.
- `accounts mark-available`: "paused agents return; mid-turn ones get a
  carry-on". This is 6b's return logic, criterion 6.10.
- `accounts set-secret`: "the account's secret reference resolves". The
  `secrets.json` reader is task 6b.1.

Consequence: unit 5b cannot pass its own criterion. A builder would either
fail the gate or write parts of 5d, 6b and 6d early, which then collide with
those units.

Fix: in 5b, assert only the event written and the record-level view change.
Move the step-10 half to criterion 6.7, the wait-cancel half to 5.8, and the
return and secret-resolution halves to 6.10 and 6.5.

### 5. MAJOR, Design (scope and lockfile): unit 2 must change the lockfile and package manifests, which the conventions forbid after unit 1

Evidence:

- The conventions (lines 289-291) and row 59 (line 911) say that no unit
  edits `package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml` after
  unit 1.
- Unit 2 creates five new workspace packages under `third_party/t3code/`
  (tasks 2a-2e). Each new package becomes a new entry in `pnpm-lock.yaml`.
- Task 1d (line 318) gives `packages/engine` its "full dependency list".
  That list must include `@lgtm/t3-effect-acp` and the other copied
  packages. In unit 1 those packages do not exist yet, so
  `pnpm install --frozen-lockfile` (criterion 1.1) cannot succeed with them
  declared.

Fix: change the rule to "after unit 2". Unit 2 (infra scope, which may edit
the lockfile) runs `pnpm install`, adds the workspace dependencies to
`packages/*/package.json`, and commits the lockfile. Re-run criteria 1.1 and
1.7 at the end of unit 2.

### 6. MINOR, Design: unit 1's `pnpm check` fails on empty packages

Evidence:

- Task 1b (line 316) has each package run `tsc --noEmit`.
- Task 1d creates only `package.json` and `tsconfig.json` for `contracts`,
  `client`, `cli`, `mcp` and `testing`.
- The infra scope cannot create `packages/*/src/**`.
- `tsc` exits with error TS18003 ("No inputs were found in config file")
  for a package with no inputs, so criterion 1.2 fails.

Fix: let the infra scope create a placeholder `packages/*/src/index.ts`,
which later units replace. Alternatively, add each package's `typecheck`
script only when its first source file lands, and say that this is the one
allowed edit to `packages/*/package.json` after unit 1.

### 7. MINOR, Design (ordering): unit 7a's criteria need unit 7b's command-line entry, and `--version` lost its criterion

Evidence:

- Criterion 7.4 (line 618) runs `lgtm serve --detach`, and task 7a.3
  (line 634) spawns the service detached. But `bin/lgtm` runs the stub
  until task 7b.2 (line 636) writes `packages/cli/src/bin.ts`.
- Criterion 7.10 needs an agent-side client, which is part of finding 2.
- Round-2 critic 3 moved `--version` into 7b.2, but no WS-7 criterion
  checks it.

Fix: make 7a.3 spawn `packages/engine/src/service.ts` directly. Have 7.4
call `serve.ts` and the service entry in unit 7a, and move the check through
the `lgtm` binary to 7b. Add a criterion that `./bin/lgtm --version`
prints the version after 7b.

### 8. MINOR, Bug (failure): the lock is correct only if built on raw `node:sqlite` and the file is never opened again

Evidence: the mechanism in row 52 step 1 (line 904) is sound: an exclusive
lock that is taken by a write and kept, with the kernel releasing it on
`SIGKILL`. Two hazards are unstated.

- The copied `nodeSqliteClient` sets `busy_timeout = 5000`, refuses any
  journal mode other than WAL, and uses worker threads
  (`packages/shared/src/nodeSqliteClient.ts:207-210, 516-520`). Opening the
  lock through it overrides `busy_timeout=0`.
- The lock is a POSIX advisory lock. If the same process later opens
  `engine.lock` with `fs` and closes it, the kernel drops all of that
  process's locks on the file.

Fix: in task 7a.2, state that the lock uses `new DatabaseSync(path,
{ timeout: 0 })` on the main thread, in rollback-journal mode, and detects
`errcode === 5`. Afterwards, only `lstat` and `chmod` by path touch the
file. Add a 7.4 case in which a second start fails after the first service
has completed its state-folder checks.

### 9. MINOR, Design (traceability): row 52 still names the wrong owner for recovery

Evidence: row 52 (line 904) ends: "task 6c.2 implements steps 4-10".
Task 6d.1 (line 586) and criterion 6.7 say steps 3-10. Task 6c.2 is the
leftover sweep. The sizing table (line 816) calls 6d "Ten ordered steps",
but 6d implements eight of them.

Fix: change the end of row 52 to "task 7a.2 owns steps 1-2; task 6d.1
implements steps 3-10, calling 6c.2 for step 5". Correct the reason given
for 6d's complexity.

### 10. MINOR, Design (scope): no unit can write the per-harness list that criterion 6.14 requires in SECURITY.md

Evidence:

- Criterion 6.14 (line 572) requires that "file `SECURITY.md` names the
  harnesses without a mechanism".
- Row 61 asks for the same.
- The harness list is learned in unit 6a (task 6a.4), but `SECURITY.md` is
  read-only in the backend scope (`.plans/scopes/engine/backend/scope.json`).
- No lead task is named for this edit, as one is for `docs/features.md`.

Fix: have 6a write the list in its unit report. Add a lead task, "after 6a,
add the list to SECURITY.md", mirroring row 63's rule for
`docs/features.md`.

## Notes outside the ten findings

- **Debug RPCs must be their own group.** Criterion 3.1 and task 3e
  (lines 396 and 425) put `debug.compare-views` in the one `RpcGroup`. Task
  7a.2 serves a "debug RPC group" only under the test flag. Effect's
  `RpcGroup.toLayer` needs a handler for every RPC in a group. Define a
  separate `DebugRpcs` group, and leave it out of 3.1's main list and out
  of 7.5's parity test.
- **Round-2 critic 8 is only partly folded.** WS-7 "Verify" (line 650) puts
  the startup-hook check "during the live check, step 4 of the owner's
  list", but overview item 4 does not mention that check.
- **Round-2 critic 12 is only partly folded.** "A blocking wait creates no
  delivery" (row 26) still has no criterion; 7.6 does not assert it.
- **A paused agent's failed reload is undefined.** Row 52 step 7 reloads
  paused agents, and a failed reload "stays interrupted". A paused agent
  whose reload fails therefore has no defined state. It should stay paused.
- **The recorder cannot use the real redactor.** The recorder (8a.4) scrubs
  secrets, but 8a depends only on unit 3. By rollout step 7, unit 5a's
  redactor exists. Either make 8a depend on 5a and reuse the redactor, or
  name the recorder's own scrub rules.
- **Known gap 2 can be closed.** `McpServer.layerStdio` exists in Effect
  4.0.5 (`effect@4.0.5/src/ai/McpServer.ts:1513`).
- **Known gap 3 has evidence.** codex-acp 2.5.0 implements `session/load`
  and `session/resume` with `replayFrom`. claude-agent-acp 0.99.1 on version
  2 replays through `session/resume` with `replayFrom: { type: "start" }`
  (`dist/v2/session.js:19-37`). The copied client's `loadSession` maps to
  that call on generation 2 (`client.ts:1123-1140`). So row 51's replay scan
  is viable on both adapters. Task 6a.2's words "during `session/load`"
  should read "during `session/load` or a replaying `session/resume`".

## Answers to the attack questions

1. **Not all were fixed.**
   - Fixed: round-2 architect findings 1, 2, 3, 6, 7, 9, 10, 11 and 12, and
     critic finding 1.
   - Partly fixed: architect 4 (the mode half is missing, finding 1),
     architect 5 and critic 2 (unit 2 breaks the lockfile rule, finding 5),
     architect 8 (it resurfaces as findings 4 and 7), critic 3 (`--version`
     has no criterion), critic 8 (the startup-hook check is missing from the
     overview) and critic 12 (the blocking-wait criterion is missing).
   - Newly broken: criterion 5.4's dependencies, unit 1's typecheck, and
     row 52's naming of task 6c.2.
2. **Correct, with conditions.**
   - `BEGIN EXCLUSIVE` plus a write, under `locking_mode=EXCLUSIVE` with
     timeout 0, holds the lock until the connection closes, and the kernel
     releases it on `SIGKILL`.
   - Use the rollback journal, not WAL, and raw `DatabaseSync` rather than
     the copied client. Never open and close the file with `fs` afterwards
     (finding 8).
   - Criterion 7.4 can test exclusion with two processes, and 7.10 tests
     release after `SIGKILL` implicitly.
3. **Every target path is inside its scope's edit list, except `SECURITY.md`
   for 6.14 (finding 10).** Some units still use later work:
   - 5b uses 5d, 6b and 6d (finding 4).
   - 7a uses 7b (finding 7).
   - Unit 1 depends on packages that unit 2 creates (finding 5).
   - The 4a pass-through redactor, the 5b.2 Runner interface and 8a.3 are
     correctly ordered.
4. **Compatible, verified against Effect 4.0.5 source.** In 4.0.5,
   `Socket.makeWebSocket` takes `headers` and passes
   `{ protocols, headers }` to the constructor (`Socket.ts:896-917`).
   `NodeSocket.layerWebSocketConstructorWS` passes those headers to `ws`,
   and `layerWebSocketConstructor` routes any options object to `ws`
   (`NodeSocket.ts:25-67`). A custom constructor is therefore unnecessary.
   `NodeSocket.layerWebSocket("ws+unix:…", { headers })` works. The plan's
   anchor, "lines 34-46", describes 4.0.1.
5. **Real, verified in the copied schema and both adapters' code.**
   - The categories `model` and `thought_level` are in
     `schema-v1.gen.ts:735-747` and in `schema.gen.ts:915-926`.
   - claude-agent-acp 0.99.1 emits `model` (`session-model.js:214`),
     `thought_level` (`session-effort.js:95`) and `mode`
     (`session-mode.js:71`).
   - codex-acp 2.5.0 emits `model`, `thought_level` and `mode`.
   - Both adapters negotiate version 2, so `session/set_model` and
     `session/set_mode` are unavailable (findings 1 and 3).
6. **They agree.**
   - The overview, the workstreams and the sizing table all name nineteen
     units and eight workstreams.
   - The launch total is 19 × 3 + 4 × 2 = 65, which is 29 OpenAI
     (13 + 6 + 6 + 4) and 36 Anthropic (6 + 13 + 13 + 4) launches.
   - The rollout steps match the dependencies, and the traceability rows
     cover rows 49-63.
   - The only mismatch is 6d's "Ten ordered steps" (finding 9).
