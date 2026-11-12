---
topic: lgtm-engine
status: attack
tier: L
created: 2026-11-01
updated: 2026-11-01
epic: lgtm-foundation
---

# Build the LGTM Studio engine

## Overview

This plan builds the first of LGTM Studio's four pieces: the engine. The engine
is a background program that the Herdr plugin starts. It runs coding agents
(Claude Code, Codex, Gemini CLI and Cursor) through the Agent Client Protocol
(ACP), the shared protocol that lets one program drive many different coding
agents. It keeps a complete, numbered record of everything the agents do,
and it offers one authenticated connection through which agents and the
owner start, prompt, watch, approve, wait on, stop and resume agents. Today
none of this exists: the LGTM Studio repository holds only documents, one file
copied from T3 Code, and the approved design in
`docs/specs/2026-11-01-engine-design.md`.

The engine is finished when the Foundry skill (the owner's method for running
teams of agents in Herdr) needs nothing else from it. The design turned that
into twelve capabilities and eight rules for failures. This plan proves them
with an acceptance suite: one test for each capability and each failure
rule, all driven through the same connection that agents and the owner use,
against a scripted fake agent that speaks real ACP. A last check runs the
main flow once against real Claude Code and Codex agents on the owner's
accounts.

A large part of the work is copied from T3 Code, an open-source program by
T3 Tools Inc. under the MIT licence, which is written with the same library,
Effect. T3's ACP client, its database code, its account settings and its test
helpers can be copied with credit. Three parts cannot: T3's agent runner is
tied to 28 other T3 modules, its event store is tied to T3's own data types,
and its login tables appear to store credentials in plain text, which
LGTM Studio's security rules forbid. LGTM Studio writes those three itself.

Four independent reviewers checked this plan twice. The first round found
gaps in the design itself; the second checked the fixes and found more,
mostly in one area: what happens when the engine restarts while agents are
working. The owner chose to keep restarts fully automatic. After a restart,
LGTM Studio reloads every agent's conversation, re-sends any message that had
not arrived, and tells agents that were mid-task to carry on. This version
makes that safe. A message the agent already received is recognised by its
id and not sent twice. Pauses and their timers survive the restart. Agents
cannot use LGTM Studio's tools until recovery is finished. The engine's private
socket file is cleared after a crash, so the engine can start again.

The second round also closed a security hole. If an agent ran LGTM Studio's
command-line tool without its own token, the tool would quietly have acted
as the owner. Now it refuses, and it checks that the socket it talks to sits
in LGTM Studio's private folder before sending any credential. Smaller fixes
harden the permission rules, the removal of secrets from the record, and the
wrapping of one agent's text before another agent reads it. The design
document's last section lists every change.

The work is split into eight workstreams and nineteen units, built in order:
the project skeleton, the copied code, the shared definitions, the record,
the permission rules, the agent runner, the connection, and the proof.

The owner has already decided three things on 2026-11-01:

- **Commits are allowed, locally.** When building starts, the files that
  exist then become the first commit on `master`. Each finished unit becomes
  one commit on a local `engine` branch, so units can be built in parallel
  and any unit can be undone. Nothing is pushed to GitHub until the owner
  asks.
- **Agents may read LGTM Studio's files, for now.** Agents run as the owner's
  own user, so any agent can read LGTM Studio's private folder, including the
  owner's credential. LGTM Studio's permission rules stop mistakes, not a
  deliberately hostile agent, and SECURITY.md now says so. Where a harness
  allows it, LGTM Studio adds a rule forbidding its agents to read that folder.
  The real fix, running LGTM Studio as its own user, is listed as agreed work
  for before remote access is built.
- **Restarts are fully automatic,** as described above.

Four steps need the owner during the build, in this order:

1. **Install Node.js 26** with `nvm install 26`. The host does not have it
   yet, and nothing can be built without it.
2. **Link the plugin in Herdr,** at the end of the first unit, by running
   `herdr plugin link` on the LGTM Studio folder and then
   `herdr plugin action list --plugin lgtm`. This checks that Herdr
   accepts the plugin. Once linked, Herdr runs `lgtm serve --detach`
   every time it starts. Until the engine is built, that command only prints
   "not built yet" and exits. Declining only delays this check; the build
   continues.
3. **Record the first sample sessions** before the agent runner is built, by
   running `pnpm record-fixtures` in the LGTM Studio folder.
   - It runs one tiny prompt on each harness that is installed and signed in.
     Claude Code and Codex are required; Gemini CLI and Cursor are recorded
     only if they are installed, and are otherwise listed as skipped.
   - The real agents run in a fresh empty folder under `/tmp`, in read-only
     mode, because LGTM Studio's own permission rules do not exist yet.
   - It spends a little usage on each account it uses.
   - The recordings, with secrets removed, are saved in the repository under
     `packages/testing/fixtures/`, so the tests can replay them.
   - Declining blocks the agent runner (unit 6a) and everything after it.
4. **Run the live check** at the end, with `pnpm live-check`. It runs the
   main flow once on one Claude Code account and one Codex account, in a
   fresh folder under `/tmp`, and records the sessions again. It spends a
   little more usage. Declining leaves the engine unproven against real
   agents; everything else is still tested.

## Key decisions

- **Node.js 26, with pnpm.** The owner chose Node.js 26, the current
  long-term support line, and the `.nvmrc` file says `26`. The launcher finds
  Node.js 26 through nvm even when it is not on the shell's path.
- **Copied code stays in its own packages.** Each piece copied from T3 Code
  lives under `third_party/t3code/`, with T3's licence and a note naming the
  exact commit and files, and each copied file is read for security problems
  before use.
- **The engine is reached through a private socket file.** It listens on a
  Unix socket inside a folder only the owner's user can open, and every
  connection must present a credential. The web page and phone connection,
  which needs a network port, comes with piece 2.
- **Agents never act as the owner by accident.** LGTM Studio's command-line
  tool uses the owner's credential only when no agent variables are set, and
  it checks the socket's folder before sending anything.
- **Agents get only what they need.** Each agent gets its own token, which
  stops working when the agent stops, crashes or the engine restarts. It
  gets a short, fixed list of environment variables, never Herdr's, and no
  file or terminal access through LGTM Studio. Its own harness's sandbox stays
  in charge. Owner-only commands are not offered to agents as tools.
- **The permission ceiling covers more than the starting mode.** A child must
  work inside its parent's folder or a worktree of the same repository, and
  never in the owner's home folder itself, LGTM Studio's private folder or
  LGTM Studio's own install. An answer that would save a permanent permission
  rule always goes to the owner.
- **Rights pass up when a parent is stuck.** If a lead crashes or pauses, its
  workers' requests and the right to manage them pass to the nearest agent
  above that can act, and finally to the owner.
- **Restarts recover automatically,** in a fixed order that is tested by
  killing the engine in the middle of a turn.
- **The adapters are pinned.** The Claude Code and Codex ACP adapters are
  installed at exact versions with LGTM Studio, and their full paths are saved.
  Starting an agent never downloads code.
- **Commits stay local,** on `master` for the first commit and on the
  `engine` branch for each unit. Nothing is pushed.

Full log → `decisions.md`

## Workstreams

### A project skeleton on Node.js 26

The repository becomes a pnpm workspace on Node.js 26, set up as T3 Code is
set up, with Effect 4.0.5, Vitest, and one command, `pnpm check`, that runs
the type checks, the tests and the credit check. Every dependency the later
units need, including the two pinned ACP adapters, is declared here once, so
no later unit edits the shared install files. It also gets the Herdr plugin
manifest and a launcher that finds Node.js 26 through nvm. The risk is that
Node.js 26, Effect 4.0.5 and Node.js's own database module do not work
together; a first test opens a database on day one to catch that. When this
is done, `pnpm check` passes on the empty project and Herdr lists LGTM Studio's
action.

### T3 Code's ACP client and helpers, copied with credit

T3 Code's ACP client, its database client, its account settings, the Codex
"shadow home" that lets two Codex accounts share sessions, and its replay
test helpers are copied into `third_party/t3code/`. Each comes with its
licence, its source commit and a list of changes, and each file is read for
security problems. Where a copied file uses another T3 module, a small
LGTM Studio replacement takes its place, and the change is recorded. The risk is
a hidden dependency on something T3 sets up elsewhere; T3's own tests for the
copied code catch that. When this is done, those tests pass in LGTM Studio's
repository and a script confirms every copied file is credited.

### One shared definition of every command, event and state

Every command, event, agent state, account, harness setting and permission
level is written once as an Effect schema, together with one table of which
command is allowed in which state. The engine, the command-line tool and the
agents' tool server all use these definitions, so they cannot disagree. The
risk is a wrong definition that later has to change everywhere; the
definitions follow the amended design, and tests check every state and
command combination and that no field can carry a secret.

### A record that is never half-written

The event log stores every event in a SQLite database with a sequence
number, writes each command's events in one transaction, and lets any client
ask for "everything after event N" followed by every new event, with no gap
and no duplicate. A repeated request from the same caller acts once. The
views rebuild the current picture from the log alone. The main risk is an
event written at the moment a client switches from catching up to live
updates; a stress test writes thousands of events while clients catch up and
checks that every number arrives exactly once.

### Who may do what, and where each request goes

Each agent gets its own token, stored only as a hash. The owner's terminal
gets its own credential. The command handler checks every command against
who is asking, which state the target is in, and the permission ceiling.
Permission requests and questions go to the nearest agent above the asker
that can answer, and to the owner when none can. Waits wake the waiting agent
exactly once, when every agent it waits on has truly settled or failed, with
the reason for each. Messages for a busy agent wait for its turn to end and
count as received only when the agent starts on them. Secrets are removed
from everything written. This is the most security-sensitive part, so every
rule has its own test.

### Agents that run, report and recover

The runner starts each harness's ACP adapter with the right account, a fresh
token, a short fixed environment and LGTM Studio's tool server. It turns
everything the agent streams into events, holds the agent while a permission
request is open, and sends `/compact` where the harness offers it. Accounts
are named or picked automatically, and a paused account comes back when its
usage resets. After a crash, the runner reports and does not restart. After
an LGTM Studio restart, it recovers every agent automatically in a fixed order.
The risk is that each adapter behaves slightly differently; recorded real
sessions are replayed in tests to catch that, and the restart order is
tested by killing the engine in the middle of a turn.

### One door for agents and the owner

The engine listens on a Unix socket in LGTM Studio's private folder, and every
connection must present a credential before anything else. Revoking a
credential closes its open connections. The `lgtm` command-line tool and
the `lgtm mcp` tool server, which offers LGTM Studio's commands to agents as
tools through the Model Context Protocol (MCP), are thin clients of that
connection. Herdr starts the service once at startup. The service refuses to
start twice, clears its socket file after a crash, and can be started again
by hand or from a Herdr action if it stops. The risk is an unauthenticated
way in; tests try a missing credential, a revoked one, a planted socket and
an agent reading another agent's thread, and each must be refused.

### Proof that the Foundry needs nothing else

A scripted fake agent that speaks real ACP plays any scenario on cue. The
acceptance suite has one test for each of the twelve capabilities and each
of the eight failure rules, including killing the service in the middle of a
turn and restarting it, and it checks after every scenario that the views
still match the record. The owner then runs one live check against real
Claude Code and Codex agents.

## Rollout order

1. The owner installs Node.js 26. The existing files are committed on
   `master`, and the local `engine` branch is created from that commit.
2. Build the project skeleton, because every other unit needs it. The owner
   links the plugin in Herdr once at its end.
3. Copy the T3 Code packages, because the record, the runner and the fake
   agent are built on them.
4. Write the shared definitions, because every later unit uses them.
5. Build the record and the fake agent side by side.
6. Build the permission rules, then the waits and message delivery, on top
   of the record.
7. The owner records the first sample sessions (`pnpm record-fixtures`).
8. Build the runner, the accounts, crash handling, then restart recovery.
9. Build the connection, the command-line tool and the tool server.
10. Write and run the acceptance suite.
11. The owner runs the live check.

Nothing is deployed and nothing is irreversible.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

Conventions for every unit. Paths are relative to the LGTM Studio repository
root. "T3" anchors refer to T3 Code at commit
`6fc9144a60c4a5f45089316ddd5f7371bafd3bf2` (scouting checkout:
`/tmp/claude-1000/-home-qnlbnsl-projects-personal-herdr-synapse/1c6c319c-95eb-4ab1-af54-3ec9498592c9/scratchpad/src/t3code`;
re-clone `https://github.com/pingdotgg/t3code` at that commit if it is gone).
Greenfield anchors give the target path and the neighbouring pattern. Effect
code is written from Effect 4.0.5's current documentation, looked up, never
from memory (`AGENTS.md`, "Language"). A "test id" is a Vitest file path; run
one with `pnpm vitest run <path>`. Abbreviations: RPC (remote procedure call,
one request and its reply), WAL (SQLite's write-ahead log), NDJSON (one JSON
object per line), QA (a manual check on a real host), PID (process id).
"Rows" are decision-log rows in `decisions.md`. The state folder is
`$LGTM_HOME`, default `$XDG_STATE_HOME/lgtm`, else
`~/.local/state/lgtm` (row 21). Tests always set their own
`LGTM_HOME`, created with `mkdtemp` under `/tmp` (row 54). Every unit
records any problem it finds in `docs/issues.md` in the same change
(AGENTS.md rule 3); the lead marks features built in `docs/features.md`
(row 63). Commits: one per finished unit on the local `engine` branch, with
`git add <paths>`, never `-A`, and no push (row 17). Every commit that adds
copied code names the T3 project and source file in its message (AGENTS.md
rule 2). No unit edits `package.json`, `pnpm-workspace.yaml` or
`pnpm-lock.yaml` after unit 1; a unit that needs a change reports it to the
lead (row 59).

**WS-1: A project skeleton on Node.js 26**

Purpose: give every later unit a workspace, a toolchain, its dependencies and
one command that proves the repository is healthy, and let Herdr start
LGTM Studio.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | Node.js 26 is selected and a clean install succeeds | Command: `nvm use && node --version` prints `v26.`; `pnpm install --frozen-lockfile` exits 0 |
| 1.2 | `pnpm check` runs `pnpm -r typecheck`, `vitest run` and `scripts/check-credits.sh` and exits 0 | Command: `pnpm check` exit code 0 |
| 1.3 | Node.js 26's SQLite module opens a database under Effect 4.0.5 | Test id: `packages/engine/test/smoke/node-sqlite.test.ts` |
| 1.4 | Herdr accepts the manifest and lists its action | On-device step (owner, end of unit 1): `herdr plugin link /home/qnlbnsl/projects/personal/lgtm-studio`, then `herdr plugin action list --plugin lgtm` lists `serve` (commands from https://herdr.dev/tui/docs/plugins/, read 2026-11-01) |
| 1.5 | The launcher finds Node.js 26 without `node` on the path | Command: `env -i HOME=$HOME NVM_DIR=$HOME/.nvm ./bin/lgtm serve --detach` runs the stub entry, prints `not built yet` and exits 0; with `NVM_DIR` pointing at an empty folder it exits 1 with an install hint |
| 1.6 | Install scripts of dependencies do not run unless listed | Command: `grep -n onlyBuiltDependencies pnpm-workspace.yaml` shows the list; `pnpm install` output names no unlisted build script |
| 1.7 | Every dependency later units need is declared, and the adapters are pinned exactly | Command: `pnpm ls -r --depth 0` lists `@agentclientprotocol/claude-agent-acp` `0.99.1`, `@agentclientprotocol/codex-acp` `2.5.0`, `ws`, `effect` `4.0.5`; `pnpm run` lists `check`, `record-fixtures`, `live-check` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | Root `package.json` (private, `"type": "module"`, `engines.node` `>=26.13 <27`, `packageManager` pnpm at the current version, scripts `typecheck`, `test`, `check`, `record-fixtures` → `node packages/engine/scripts/record-fixtures.ts`, `live-check` → `node packages/engine/scripts/live-check.ts`); `pnpm-workspace.yaml` listing `packages/*` and `third_party/t3code/*`, a catalog pinning `effect`, `@effect/platform-node`, `@effect/vitest` at 4.0.5, `vitest` at the 5.x release `@effect/vitest` 4.0.5 accepts, `@types/node` for Node.js 26, `@effect/openapi-generator` 4.0.5, `ws` and `@types/ws`; `onlyBuiltDependencies` (row 39) | Target `package.json`, `pnpm-workspace.yaml`; pattern T3 `pnpm-workspace.yaml` catalog (Scout A item 9) |
| 1b | `tsconfig.base.json` with T3's options (target ESNext, module and moduleResolution NodeNext, strict, allowImportingTsExtensions, erasableSyntaxOnly, verbatimModuleSyntax, noEmit); each package runs `tsc --noEmit` | Target `tsconfig.base.json`; pattern T3 `tsconfig.base.json` (Scout A item 9) |
| 1c | `vitest.config.ts` with workspace projects, T3's test timeouts and environment scrub | Target `vitest.config.ts`; pattern T3 `vite.config.ts` lines 98-130 |
| 1d | Packages `packages/contracts`, `packages/client`, `packages/engine`, `packages/cli`, `packages/mcp`, `packages/testing`, each with `package.json` exporting `./src/*.ts`, its full dependency list (row 59: engine pins both adapters exactly; client and testing depend on `ws`; cli depends on engine, client and mcp; engine has dev dependencies on client and testing) and a `tsconfig.json` (rows 23, 59) | Target `packages/*/package.json`; pattern T3 package `exports` (Scout A item 9) |
| 1e | SQLite smoke test (criterion 1.3) | Target `packages/engine/test/smoke/node-sqlite.test.ts`; pattern T3 `packages/shared/src/nodeSqliteClient.ts:layer` |
| 1f | `herdr-plugin.toml`: `id = "lgtm"`, `name = "LGTM Studio"`, `version = "0.0.1"`, `min_herdr_version = "0.8.2"`, `platforms = ["macos", "linux"]`, `[[startup]] command = ["./bin/lgtm", "serve", "--detach"]`, `[[actions]]` `id = "serve"`, `contexts = ["global"]` with the same command | Target `herdr-plugin.toml`; pattern Synapse `herdr-plugin.toml` lines 1-9 (Scout B Part A items 1, 3) |
| 1g | `bin/lgtm`: POSIX shell launcher choosing Node.js per row 22 and running the absolute path of `packages/cli/src/bin.ts`; while that file is absent the launcher runs `bin/stub-entry.ts`, which prints `not built yet` and exits 0 (row 59) | Target `bin/lgtm`, `bin/stub-entry.ts`; pattern Synapse `bin/herdr-synapse` |
| 1h | Change the existing `third_party/t3code/mergeMessage.test.ts` import from `vite-plus/test` to `vitest` and record it in `third_party/t3code/README.md` | Existing `third_party/t3code/mergeMessage.test.ts` line 1 |
| 1i | `.gitignore`: `node_modules/`, test state folders, `*.sqlite*` under test folders | Target `.gitignore` |

**Design artifact:** none; no screen (row 8).

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Effect 4.0.5 or `node:sqlite` misbehaves on Node.js 26 | High | Criterion 1.3 runs first. If it fails, stop and report to the owner before any other unit; the fallback is Node.js `26.12.1`, the version T3 pins (Scout A item 9). |
| Herdr's manifest format changed since Synapse's | Medium | Criterion 1.4 on the owner's Herdr. |
| The launcher picks the wrong Node.js | Medium | Criterion 1.5 runs with an empty environment. |
| A later unit needs a dependency nobody declared | Medium | Criterion 1.7; later units report the need to the lead, who makes the one change. |

**Verify:** criteria 1.1-1.3, 1.5-1.7 by command; criterion 1.4 needs the owner's Herdr host (environment QA: two `herdr` commands).

**Rollout detail:** rollout steps 1 and 2.

**WS-2: T3 Code's ACP client and helpers, copied with credit**

Purpose: reuse T3 Code's tested ACP client and helpers instead of rebuilding
them, while keeping the credit `AGENTS.md` rule 2 requires and checking the
copied code for security problems.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | The copied ACP client's own tests pass unchanged | Command: `pnpm vitest run third_party/t3code/effect-acp` exits 0 |
| 2.2 | The copied SQLite client's own test passes with only its import line changed | Test id: `third_party/t3code/node-sqlite/test/nodeSqliteClient.test.ts` (T3 `packages/shared/src/nodeSqliteClient.test.ts`, line 13 import changed from `vite-plus/test`) |
| 2.3 | The Codex shadow home creates links and refuses a copied home | Test id: `third_party/t3code/provider-instance/test/CodexHomeLayout.test.ts` (T3's test, with `@t3tools/shared/testing/symlinks` replaced by a local helper) |
| 2.4 | Replay transcripts decode | Test id: `third_party/t3code/provider-testing/test/replayTranscript.test.ts` |
| 2.5 | Every copied file is credited, and the check runs in `pnpm check` | Command: `scripts/check-credits.sh` exits 0, and fails when a file under `third_party/t3code/` is missing from its README table or lacks T3's copyright line where the original had one; `NOTICE` names each package |
| 2.6 | No copied file imports a T3 module | Command: `grep -rnE "^[[:space:]]*(import|export)[^;]*['\"]@t3tools/" third_party/t3code` prints nothing |
| 2.7 | Every copied file has been read for security problems | File `third_party/t3code/SECURITY-REVIEW.md` lists every copied file with "read, no findings" or its findings and the fix; criterion 2.5's script fails if a copied file is missing from it. The review names every logging call in `effect-acp/src/protocol.ts` (lines 263-272, 503, 547, 599) and how it is kept off or redacted (row 57) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a | Copy `packages/effect-acp` whole (src, `_generated`, `scripts/generate.ts`, tests, `test/fixtures/acp-mock-peer.ts`) to `third_party/t3code/effect-acp/` as `@lgtm/t3-effect-acp`; fix the `extends` path; its dependencies were declared in unit 1 | T3 `packages/effect-acp/src/client.ts:layerChildProcess` (1392), `src/agent.ts:AcpAgent` (34), `layerStdio` (557) (Scout A item 1) |
| 2b | Copy `packages/shared/src/nodeSqliteClient.ts` and its test to `third_party/t3code/node-sqlite/` as `@lgtm/t3-node-sqlite` | T3 `packages/shared/src/nodeSqliteClient.ts:layer` (Scout A item 4) |
| 2c | Copy `providerInstance.ts`, `secretReference.ts`, `TrimmedNonEmptyString` from `baseSchemas.ts`, `pathExpansion.ts`, `instanceEnvironment.ts`, `ClaudeHome.ts`, `CodexHomeLayout.ts` and its test, and `apps/server/src/provider/CodexManagedHome.ts` to `third_party/t3code/provider-instance/` as `@lgtm/t3-provider-instance`; replace `@t3tools/shared/HostProcess` with a local `HostProcess.ts` (`HomeDirectory`, `Platform`); replace `CodexSettings`, `ClaudeSettings` and `ProviderDriverKind` with a local `{ homePath, shadowHomePath }` type and a local brand | T3 `packages/contracts/src/providerInstance.ts:ProviderInstanceConfig`; `apps/server/src/provider/Drivers/CodexHomeLayout.ts:materializeCodexShadowHome` (236); `ClaudeHome.ts:makeClaudeEnvironment` (Scout A items 5, 6) |
| 2d | Copy `packages/provider-testing/src/replayTranscript.ts` and `fakeCli.ts` to `third_party/t3code/provider-testing/` as `@lgtm/t3-provider-testing`; copy the replay schemas from T3 `packages/contracts/src/orchestrationV2.ts` lines 4176-4220 with their header type and `NonNegativeInt`; replace `HostProcess`; drop `TestProviderHost.ts` and `replayGate.ts` | T3 `packages/provider-testing/src/replayTranscript.ts:decodeProviderReplayNdjson`; `fakeCli.ts:writeFakeCli` (Scout A item 7) |
| 2e | Move `third_party/t3code/mergeMessage.ts` and its test into `third_party/t3code/source-control/` as a package | Existing `third_party/t3code/mergeMessage.ts:removeAgentCredits` |
| 2f | Rewrite `third_party/t3code/README.md` as one table (package, file, T3 path, changes); extend `NOTICE` | Existing `third_party/t3code/README.md`, `NOTICE` |
| 2g | `scripts/check-credits.sh` (criteria 2.5, 2.7) | Target `scripts/check-credits.sh` |
| 2h | Security read of every copied file into `third_party/t3code/SECURITY-REVIEW.md` (rows 39, 57) | Target `third_party/t3code/SECURITY-REVIEW.md` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A copied file depends on behaviour T3 sets up elsewhere | Medium | Criteria 2.1-2.4 run T3's tests; 2.6 proves no T3 import remains. |
| Copied code has a security flaw or logs secrets | Medium | Criterion 2.7, including the logging calls. |
| The generator script needs network access | Low | Generated files are copied as they are; the generator is re-run only as its own change. |
| Credit missed on one file | Medium | Criterion 2.5 runs inside `pnpm check`. |

**Verify:** criteria 2.1-2.7 by command; environment QA: none.

**Rollout detail:** rollout step 3.

**WS-3: One shared definition of every command, event and state**

Purpose: write every message shape and the state machine once, so the
engine, the command-line tool, the tool server and later clients cannot
disagree.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | Every command (`start`, `prompt`, `answer`, `pass-up`, `ask`, `wait`, `stop`, `resume`, `compact`, `group`, `accounts`, `accounts set-secret`, `accounts mark-available`, `harnesses`, `subscribe`, `debug.compare-views`) has request and reply schemas with a request id, and each is tagged agent-callable or owner-only | Test id: `packages/contracts/test/commands.test.ts` (the command list and the owner-only list asserted equal to the lists in row 55) |
| 3.2 | Every event round-trips through encode and decode unchanged | Test id: `packages/contracts/test/events-roundtrip.test.ts` (property test over every event tag) |
| 3.3 | The permission scale orders `read-only` < `ask` < `edit` < `full`, and every ACP permission option kind maps to a level and a persistence flag | Test id: `packages/contracts/test/permission-scale.test.ts` |
| 3.4 | No schema can carry a secret value: secret-looking names (`*TOKEN*`, `*KEY*`, `*SECRET*`, `*PASSWORD*`) in an account's extra environment must be references; "command refused" carries only the command name and reason | Test id: `packages/contracts/test/no-secret-values.test.ts` (schema walk plus decoding an account with `CURSOR_API_KEY: "abc"` fails) |
| 3.5 | The transition table answers every (lifecycle state, command) and (lifecycle state, event) cell, including the cells row 62 decides, and the displayed states follow the derivation table below | Test id: `packages/contracts/test/state-machine.test.ts` (enumerates every cell and asserts the table's answer; asserts each derivation row) |

Displayed-state derivation (criterion 3.5, row 62), first match wins:

| Lifecycle state and counts | Displayed state |
|---|---|
| stopped | Stopped |
| crashed | Crashed |
| interrupted | Interrupted |
| paused, reason signed-out | Signed out |
| paused, reason limit | Paused for a limit |
| starting | Starting |
| working or idle, open permission requests > 0 | Waiting on a permission |
| working or idle, open questions asked > 0 | Waiting on an answer |
| working | Working |
| idle | Idle |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a | `src/ids.ts`: branded `AgentId`, `EventSequence`, `RequestId`, `PermissionRequestId`, `QuestionId`, `WaitId`, `DeliveryId`, `AccountId`, `HarnessId`, `DeviceId`, `BootId` | Target `packages/contracts/src/ids.ts`; pattern T3 `providerInstance.ts:ProviderInstanceId` |
| 3b | `src/permission.ts`: the scale, compare, option-kind mapping with persistence (rows 35b, 56) | Target `packages/contracts/src/permission.ts` |
| 3c | `src/stateMachine.ts`: lifecycle states with pause reasons and mid-turn flag, the derivation table, the command and event tables (rows 24, 53, 62) | Target `packages/contracts/src/stateMachine.ts`; spec "Changes after the plan review", "One state machine" |
| 3d | `src/events.ts`: one tagged union: agent started (with optional first-prompt delivery), session opened (session reference as a tagged union, negotiated protocol version), prompt sent, thread item (text, plan, tool call, file change; replay flag), turn started, turn ended (compact flag), state changed, mode changed, mode refused, permission requested, permission answered, permission moved, permission cancelled, question asked, question answered, question moved, owner needed, wait opened, wait member resolved, wait satisfied, wait cancelled, delivery queued, delivery sent, delivery accepted, delivery requeued, delivery returned, delivery withdrawn, agent crashed, agent interrupted (with previous state), agent reload failed (reason), agent stopped, agent grouped, account changed, account needs sign-in, account available (cause), harness changed, device added, device revoked, command refused (rows 50-53) | Target `packages/contracts/src/events.ts`; pattern T3 `Migrations/055_OrchestrationV2.ts` columns (Scout A item 3) |
| 3e | `src/commands.ts`: an `effect/rpc` `RpcGroup`, one `Rpc` per command, streaming `subscribe`, and the owner-only list (row 55) | Target `packages/contracts/src/commands.ts`; pattern T3 `apps/server/src/ws.ts` line 108 imports and `packages/effect-acp/src/rpc.ts` |
| 3f | `src/accounts.ts` (LGTM Studio's own schema: harness, home path or secret reference, extra environment with the reference rule, enabled) and `src/harnesses.ts` (run mode, absolute adapter path and arguments, permission mapping, model and effort defaults, deny-read mechanism) (rows 33, 39, 61) | Target `packages/contracts/src/accounts.ts`, `harnesses.ts`; pattern `third_party/t3code/provider-instance/providerInstance.ts:ProviderInstanceConfig` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A wrong definition must change in every package | Medium | Definitions follow the amended spec; criterion 3.5 makes the state rules explicit before anything uses them. |
| A secret slips into an event or account | High | Criterion 3.4 in `pnpm check`. |

**Verify:** criteria 3.1-3.5; environment QA: none.

**Rollout detail:** rollout step 4.

**WS-4: A record that is never half-written**

Purpose: the event log and the views. Units: 4a the log, 4b `subscribe`, 4c
the views and the rebuild check.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Events get consecutive numbers starting at 1; a batch, with its side rows, is all written or none | Test id: `packages/engine/test/log/append.test.ts` (failure injected after the first insert: zero rows in `events`, `agent_tokens`, `processes`) |
| 4.2 | Receipts are keyed by caller and request id with a body hash: a repeat returns the first result without writing; the same key with a different body is refused; another caller's id is a new request; a concurrent double send writes once and is not a disk failure | Test id: `packages/engine/test/log/receipts.test.ts` |
| 4.3 | `subscribe(after: N)` delivers every later event exactly once, in order, while events are written during catch-up | Test id: `packages/engine/test/log/subscribe-gapless.test.ts` (a writer appends 10,000 events while 5 subscribers start at random points; each sees a strictly consecutive sequence) |
| 4.4 | Views rebuilt from the log equal the live views, after every engine test | Test id: `packages/engine/test/views/rebuild.test.ts`; hook `packages/engine/test/support/rebuildCheck.ts`; guard test `packages/engine/test/support/every-file-registers-rebuild.test.ts`, which exempts `packages/engine/test/smoke/` (row 63) |
| 4.5 | A database write failure makes the engine refuse commands with a reason | Test id: `packages/engine/test/log/disk-failure.test.ts` |
| 4.6 | `compareViews(N)` returns no difference for a clean log, and returns the difference when the views layer is replaced by one that drops an event | Test id: `packages/engine/test/views/compare-views.test.ts` (the running-service part is criterion 7.12) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 4a.1 | One migration list for every table: `events` (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE, caller, request_id, agent_id, event_type, occurred_at, payload_json), `receipts` (caller, request_id, body_hash, result_json, first_sequence, PRIMARY KEY (caller, request_id)), `agent_tokens`, `devices`, `processes` (row 32) | Target `packages/engine/src/log/migrations.ts`; pattern T3 `Migrations/055_OrchestrationV2.ts` (`orchestration_v2_events`, `orchestration_v2_command_receipts`) |
| 4a.2 | `EventLog.append(caller, requestId, bodyHash, events, sideRows)`: one `withTransaction`, one writer behind a semaphore, WAL mode, receipt check inside the writer, every event passed through the `Redactor` service before insert; 4a provides a pass-through `Redactor` that 5a replaces (row 59) | Target `packages/engine/src/log/EventLog.ts`, `packages/engine/src/log/Redactor.ts`; pattern T3 `apps/server/src/orchestration-v2/EventSink.ts` (`sql.withTransaction`, lines 716, 781), `third_party/t3code/node-sqlite` `layer` |
| 4b.1 | `subscribe(after)`: read up to the head on a read-only connection (chosen and commented, PB-A5), then switch to an in-memory `PubSub` of committed events, de-duplicating by sequence at the join | Target `packages/engine/src/log/subscribe.ts`; pattern T3 `OrchestrationEventStore.ts:streamProjectedApplicationEvents` (lines 111, 712) and its line-103 comment |
| 4c.1 | `Views`: pure `apply(view, event)` for agents, threads, requests, questions, waits, deliveries, accounts, devices; `rebuild(upTo)` folds from sequence 1 | Target `packages/engine/src/views/`; pattern T3 `apps/server/src/orchestration-v2/ProjectionRecovery.test.ts` |
| 4c.2 | `compareViews(N)`: snapshot the live views at head sequence N under the writer's semaphore, rebuild up to N on a read connection, diff (row 62); the rebuild hook and guard test (row 43) | Target `packages/engine/src/views/compare.ts`, `packages/engine/test/support/` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An event written during catch-up is missed or repeated | High | Unit 4b is sized high, with criterion 4.3. |
| A view applies an event differently live and on rebuild | High | Pure functions; criteria 4.4 and 4.6. |
| Writer and readers contend for locks | Medium | WAL mode, one writer, readers on `nodeSqliteClient` `readOnly` connections. |

**Verify:** criteria 4.1-4.6; environment QA: none.

**Rollout detail:** rollout step 5.

**WS-5: Who may do what, and where each request goes**

Purpose: identity, the redactor, the command handler, routing, waits and
deliveries. Units: 5a identity, ceiling and redactor; 5b the lifecycle
commands and the Runner interface; 5c permissions, questions and rights; 5d
waits and deliveries.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | Agent tokens are 32 random bytes, passed only in the environment, stored only as SHA-256 hashes, replaced on every spawn and reload, and revoked on stop, crash and restart; revocation is checked inside the writer transaction for every command | Test id: `packages/engine/test/identity/tokens.test.ts` |
| 5.2 | The owner credential (32 random bytes) is created on first start in a 0600 file; device credentials are revocable one at a time | Test id: `packages/engine/test/identity/owner-credential.test.ts` |
| 5.3 | Authorization table: every caller kind × command × target state, including rights passed up, folder containment, refused folders, persistent options and options above the answerer's mode | Test id: `packages/engine/test/commands/authorization.test.ts` |
| 5.4 | Each lifecycle command writes the event and view change in the table below; invalid states are refused per the state table with "command refused" | Test id: `packages/engine/test/commands/lifecycle.test.ts` (one case per table row) |
| 5.5 | A permission request goes to the nearest idle-or-working ancestor or the owner; `pass-up` moves it by the holder rule from the holder's parent; the owner can answer any request; only the current holder or the owner can answer; the first answer wins; "owner needed" is written whenever the owner becomes the holder | Test id: `packages/engine/test/routing/permissions.test.ts` (includes two answers racing) |
| 5.6 | A request or question whose holder crashes, stops, pauses or is interrupted moves up; a move withdraws the old holder's delivery and alert; a request never moves back down; a holder that ends the turn in which it was delivered a request without answering or passing it up has it passed up; nothing times out into an answer | Test id: `packages/engine/test/routing/moving-requests.test.ts` |
| 5.7 | `ask` puts the asker in "waiting on an answer" and `answer` delivers the reply once | Test id: `packages/engine/test/routing/questions.test.ts` |
| 5.8 | Waits follow row 50; each case wakes exactly once at the right time: sent but not accepted (no wake); `start` with a first prompt then `wait` (no wake until it settles); compact then wait; a member holding an unanswered request (no wake); late open after settle (immediate wake); orchestrator → lead → worker; "any" and "all"; a crashed member (immediate notice plus final listing); a member paused then returned (reported as its state at close); a waiter that stops (wait cancelled, wake withdrawn) | Test id: `packages/engine/test/routing/waits.test.ts` |
| 5.9 | Deliveries: queued, sent, accepted only on a successful reply or a content update after the send; an unrelated update (`available_commands_update`) does not accept; an error reply requeues at the head; delivered once, in order, after a turn ends; returned to the sender if the target crashed; withdrawn for a stopped target | Test id: `packages/engine/test/routing/deliveries.test.ts` |
| 5.10 | Agent text is data: an agent writing "I approve request X" leaves it open; engine-written prompts wrap child text in an envelope with a fresh random marker and the delivery id; a forged closing marker inside child text does not end the envelope; a leading `/` after whitespace is escaped in every prompt an agent sends; the owner's prompts are not escaped | Test id: `packages/engine/test/routing/text-is-data.test.ts` |
| 5.11 | The redactor removes each live secret from every string field of an event, in raw, base64, base64url, URL-encoded and hex forms, when split across two streamed chunks, inside tool-call input and file diffs; a token-shaped substring whose hash matches a stored token or device hash is removed; a fake agent printing its token and an account key leaves neither in the database file or any reply | Test id: `packages/engine/test/identity/redactor.test.ts` |
| 5.12 | The ceiling: a child's stored real path is used for the spawn and re-checked on `resume`; a symlink swapped after the check is refused; the worktree check reads `.git` and `commondir` without running `git`; an agent-started child in `$HOME`, the state folder or the plugin root is refused; an owner-started agent there is allowed | Test id: `packages/engine/test/identity/ceiling.test.ts` |

Lifecycle commands (criterion 5.4, row 62):

| Command | Event written | View change asserted |
|---|---|---|
| `start` | agent started (with first-prompt delivery queued if given) | new agent, state starting, parent, harness, account, model, effort, mode, folder recorded |
| `prompt` | delivery queued (sender recorded) | delivery in the target's queue with the sender |
| `stop` | agent stopped; token revoked | state stopped; children unchanged; open waits by it cancelled |
| `resume` | state changed; recovery step 10 for this agent (row 52) | state starting then idle; unaccepted deliveries re-sent or carry-on queued |
| `compact` | delivery queued (compact) | next turn flagged compact |
| `group` | agent grouped | agent's group label |
| `accounts` | account changed | account list |
| `accounts set-secret` | account changed (no value) | the account's secret reference resolves; no value in any view |
| `accounts mark-available` | account available (cause owner cleared) | the account's paused agents return; mid-turn ones get a carry-on |
| `harnesses` | harness changed | harness settings |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5a.1 | `Identity`: mint and verify agent tokens and device credentials (SHA-256 hashes in `agent_tokens`, `devices`), owner credential file per row 37, rotation and revocation per rows 32, 52 | Target `packages/engine/src/identity/`; pattern T3 `apps/server/src/auth/utils.ts` (`createHash`, line 27); not T3's `AuthSessions.ts` (Scout A item 8) |
| 5a.2 | Ceiling: mode compare, folder containment by stored real path or same git common directory read from `.git` and `commondir`, refused folders, option-kind and persistence check (rows 35, 56) | Target `packages/engine/src/identity/ceiling.ts` |
| 5a.3 | `Redactor`: the real implementation replacing 4a's pass-through, per row 57 | Target `packages/engine/src/identity/redactor.ts` |
| 5b.1 | `CommandHandler`: identify, look up the state table, authorize, produce events, append; one module per lifecycle command | Target `packages/engine/src/commands/`; pattern T3 `apps/server/src/orchestration-v2/CommandPolicy.ts`, `CommandReceiptStore.ts` |
| 5b.2 | `Runner` interface per row 44, with a test double for 5b-5d (moved from 6a, row 59) | Target `packages/engine/src/runner/Runner.ts`, `packages/engine/test/support/fakeRunner.ts` |
| 5c.1 | Routing for permission requests and questions, holder selection, rights passing up, moves withdrawing old deliveries, automatic pass-up at turn end, answer checks inside the transaction (rows 27, 50, 51) | Target `packages/engine/src/routing/holders.ts`, `permissions.ts`, `questions.ts`; pattern T3 `apps/server/src/orchestration-v2/DelegatedTaskQuestionReactor.ts` |
| 5d.1 | Waits with the settled predicate, `since`, member resolution in the same transaction as the resolving event, wait cancelled, recovery re-check (rows 25, 50) | Target `packages/engine/src/routing/waits.ts`; pattern T3 `apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts` |
| 5d.2 | Deliveries with the three steps, acceptance rule, requeue, and the envelope (rows 29, 38, 51, 58) | Target `packages/engine/src/routing/deliveries.ts`, `envelope.ts` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An agent acts on an agent it has no rights over | High | Criterion 5.3's table; attack pass on 5a, 5c. |
| Two answers race and both take effect | High | Holder and open checks inside the single-writer transaction; criterion 5.5 races them. |
| A secret leaks into the record | High | The redactor sits inside `append`; criterion 5.11. |
| A wake is lost, early or repeated | High | Criterion 5.8's cases; the recovery re-check (6.7). |
| A child widens its own rights | High | Criteria 5.3 and 5.12. |

**Verify:** criteria 5.1-5.12; environment QA: none.

**Rollout detail:** rollout step 6.

**WS-6: Agents that run, report and recover**

Purpose: the ACP runner, accounts, crashes and restart recovery. Units: 6a
runner core, 6b accounts, 6c crashes and the leftover sweep, 6d restart
recovery.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | Starting an agent spawns its adapter from the harness's absolute path, at its stored real folder, in a new process group, with exactly the allow-listed environment plus the account's variables and exactly `LGTM_SOCKET` and `LGTM_TOKEN`; `session/new` gets the `lgtm mcp` server with `process.execPath` and an absolute script path; the session id and negotiated protocol version are recorded | Test id: `packages/engine/test/runner/start.test.ts` (the fake agent echoes its environment, its arguments and the `mcpServers` it received; asserts the exact set and no `HERDR_*`) |
| 6.2 | Streamed text, plans, tool calls and file changes become thread events in order; replays of real sessions produce the expected events | Test ids: `packages/engine/test/runner/stream.test.ts`; `packages/engine/test/runner/replay.test.ts` over `packages/testing/fixtures/*.ndjson` |
| 6.3 | A permission request holds the agent until answered, then releases it with the chosen option | Test id: `packages/engine/test/runner/permission-hold.test.ts` |
| 6.4 | `compact` sends the harness's compact command when advertised, else is refused with a reason | Test id: `packages/engine/test/runner/compact.test.ts` |
| 6.5 | "Any account" picks per row 28, refuses when none is usable; a second Codex account gets a shadow home | Test ids: `packages/engine/test/accounts/pick.test.ts`, `packages/engine/test/accounts/codex-shadow-home.test.ts` |
| 6.6 | A crash records the exit code and the last error lines with secrets removed; open requests are cancelled; the token is revoked; waiters get an immediate crash notice; the parent is told, or "owner needed" for an owner-started agent; no restart | Test id: `packages/engine/test/recovery/crash.test.ts` |
| 6.7 | Restart follows row 52's steps 3-10 in order: every token revoked; leftover groups stopped; starting, working and idle agents interrupted with their previous state; paused agents stay paused; open permission requests cancelled; questions kept with no "owner needed" written; reloadable agents reloaded with new tokens; a failed reload writes "agent reload failed"; replayed updates produce no thread events; a delivery found in the replay is marked accepted and replaced by a carry-on; overdue "account available" written; holders re-evaluated once; unaccepted deliveries re-sent before carry-ons; non-reloadable agents stay interrupted; `resume` on one of them later runs step 10 | Test id: `packages/engine/test/recovery/restart.test.ts` (with the fake runner; the socket half is criterion 7.10) |
| 6.8 | The leftover sweep stops a recorded group only when boot id, start time, user and executable match and the group id is greater than 1 and not the engine's | Test id: `packages/engine/test/recovery/orphans.test.ts` (Linux; the macOS branch runs only on a macOS host and is otherwise reported as skipped) |
| 6.9 | Signed-out and out-of-usage errors are told apart for each harness | Test id: `packages/engine/test/runner/classify-errors.test.ts` over `packages/testing/fixtures/errors/` |
| 6.10 | Failure rule 5 and row 53: a signed-out account writes "account needs sign-in" and "owner needed" and pauses its agents; only `accounts mark-available` clears it; an out-of-usage agent pauses with its reset time, or writes "owner needed" if none; "account available" at the wall-clock reset time returns paused agents, releases their deliveries and gives mid-turn ones a carry-on; out of usage on a delivery requeues it and it is sent after the return; a restart while paused keeps the pause and re-arms the timer; a reset time passed during downtime fires at recovery | Test id: `packages/engine/test/accounts/pause-and-return.test.ts` (clock controlled with Effect's `TestClock`) |
| 6.11 | A `harnesses` override changes the spawned path and arguments; the permission mapping is applied; the model and effort reach the adapter through `session/set_config_option` (`model`, `thought_level`), or `session/set_model` only when negotiated; a model, effort or mode the harness cannot set is refused at `start` with the reason | Test id: `packages/engine/test/runner/harness-settings.test.ts` |
| 6.12 | The engine advertises no file or terminal capability, and `fs/*` and `terminal/*` requests are refused | Test id: `packages/engine/test/runner/no-client-capabilities.test.ts` |
| 6.13 | An adapter-reported mode change above the ceiling is set back and recorded | Test id: `packages/engine/test/runner/mode-ceiling.test.ts` |
| 6.14 | Each harness with a documented launch-time deny rule gets one forbidding reads of the state folder; harnesses without one are listed | Test id: `packages/engine/test/runner/deny-read.test.ts` (asserts the rule passed to the fake agent per harness); file `SECURITY.md` names the harnesses without a mechanism (row 61) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6a.1 | `AcpRunner` implementing 5b.2's `Runner`: spawn with `effect/process` `ChildProcessSpawner` (detached process group, `extendEnv: false`, `cwd` the stored real path), connect `AcpClient` via `layerChildProcess`, `initialize` with no client capabilities, `session/new` with `mcpServers`, record capabilities and protocol version; keep reading the child's stderr | Target `packages/engine/src/runner/AcpRunner.ts`; pattern `third_party/t3code/effect-acp/src/client.ts:layerChildProcess` (1392), `make` (755); T3 `AcpSessionRuntime.ts` lines 1447 (detached) and 1766-1772 (capabilities off) |
| 6a.2 | Translate `session/update` to events, tagging replay updates during `session/load` (row 51) | Target `packages/engine/src/runner/translate.ts`; reference T3 `packages/provider-acp/src/server/runtimeModel.ts:parseSessionUpdateEvent` (1350) (read, not copied) |
| 6a.3 | Permission hold with a `Deferred` scoped to the agent; option kinds mapped per rows 35b, 56 | Target `packages/engine/src/runner/permissions.ts` |
| 6a.4 | Compact via advertised commands; mode changes checked against the ceiling; model and effort per row 60; deny-read rules per row 61 | Target `packages/engine/src/runner/compact.ts`, `modes.ts`, `config.ts`, `denyRead.ts`; pattern `third_party/t3code/effect-acp/src/_generated/schema-v1.gen.ts` lines 735-747 (`set_config_option` categories) |
| 6b.1 | Accounts: the copied `mergeProviderInstanceEnvironment` over 8a's base environment (rows 33, 57), secrets from `secrets.json` (rows 19, 40), shadow home via `materializeCodexShadowHome`; picker and wall-clock "account available" timer (rows 28, 53) | Target `packages/engine/src/accounts/`; pattern `third_party/t3code/provider-instance/instanceEnvironment.ts:mergeProviderInstanceEnvironment`, `CodexHomeLayout.ts:materializeCodexShadowHome` |
| 6c.1 | Crash handling per criterion 6.6 | Target `packages/engine/src/recovery/crash.ts`; pattern T3 `packages/provider-acp/src/server/stderr.ts` |
| 6c.2 | Leftover sweep with the boot id (`/proc/sys/kernel/random/boot_id` on Linux, `sysctl kern.boottime` on macOS), start time, user and executable checks | Target `packages/engine/src/recovery/orphans.ts`; pattern T3 `packages/provider-core/src/server/processGroup.ts` (line 8, `process.kill(-pid)`) |
| 6c.3 | Error classification | Target `packages/engine/src/runner/classify.ts` |
| 6d.1 | Restart recovery steps 3-10 per row 52, and step 10 as a function `resume` calls | Target `packages/engine/src/recovery/restart.ts`; pattern `third_party/t3code/effect-acp/src/client.ts:loadSession` (91) |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Real adapters differ from the fake agent | High | Criterion 6.2 replays recorded sessions; the live check re-records them. |
| The Codex adapter cannot reload sessions | Medium | Capabilities read at run time; criterion 6.7 covers the non-reloadable path and the later `resume`. |
| The sweep signals an unrelated process | High | Criterion 6.8's guards. |
| Out-of-usage error text changes between versions | Medium | Adapters pinned; unrecognised errors are reported as crashes with their text, never retried. |
| A real adapter's replay does not contain the envelope text | Medium | Then the engine cannot find the delivery id and re-sends; PB-A12 checks each real adapter, and the live check records the result. |
| Recovery is the most intricate code | High | Its own unit (6d), sized high; criterion 6.7 and failure test 8.4 kill the service mid-turn. |

**Verify:** criteria 6.1-6.14; environment QA: criterion 6.8 on Linux, and on macOS only if the owner has a Mac host.

**Rollout detail:** rollout steps 7 and 8.

**WS-7: One door for agents and the owner**

Purpose: the server, the service lifecycle, the shared client, the
command-line tool and the tool server. Units: 7a the server and service, 7b
the client, command-line tool and tool server.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 7.1 | The state folder is created 0700 with umask 077; the service refuses to start if the folder is a symlink, not owned by its user or not 0700, or if the socket path exceeds 100 bytes; every regular file in it is 0600; the socket is the only listener and there is no TCP listener | Test id: `packages/engine/test/api/state-folder.test.ts` |
| 7.2 | An upgrade without a credential, with a revoked one, or with a malformed one is refused before any RPC message; revoking a credential closes its open connections | Test id: `packages/engine/test/api/auth.test.ts` |
| 7.3 | For every event type: an agent's `subscribe` returns only events of itself and its children; agent-less events are owner-only | Test id: `packages/engine/test/api/subscribe-visibility.test.ts` |
| 7.4 | `lgtm serve --detach` starts one service; two services started at once against one `LGTM_HOME` leave exactly one running and the other exits 0 reporting it; `serve --detach` detects a running service by connecting to the socket | Test id: `packages/cli/test/serve.test.ts` (two real processes) |
| 7.5 | Every RPC is a `lgtm` subcommand; the MCP server offers exactly the agent-callable commands and none of the owner-only list | Test id: `packages/cli/test/parity.test.ts` (lists the contracts' `RpcGroup` and the owner-only list) |
| 7.6 | `lgtm wait --block` exit codes per row 62's precedence; it returns at once when the caller already holds a request or question, and when one is routed to it; killing it writes "wait cancelled" | Test id: `packages/cli/test/wait-exit-codes.test.ts` |
| 7.7 | The command-line tool strips terminal control characters from thread text | Test id: `packages/cli/test/control-chars.test.ts` |
| 7.8 | `lgtm mcp` gets its token from the environment only, never from its arguments; it connects on first use and retries "recovering" for up to 60 seconds | Test ids: `packages/mcp/test/token-source.test.ts`, `packages/mcp/test/lazy-connect.test.ts` |
| 7.9 | The client uses the owner credential only when both LGTM Studio variables are unset, refuses when only one is set, and refuses a socket whose folder is a symlink, owned by another user or not 0700, before sending any credential | Test id: `packages/client/test/identity.test.ts` |
| 7.10 | After `SIGKILL`, a restarted service removes the stale socket, listens, refuses commands with "recovering" until recovery step 9, then serves; a reloaded fake agent's tool call during its carry-on turn succeeds | Test id: `packages/engine/test/api/restart-socket.test.ts` |
| 7.11 | The service's own log output contains no planted secret, token or credential | Test id: `packages/engine/test/api/service-log.test.ts` (plants secrets, runs a flow, greps stdout and stderr) |
| 7.12 | `debug.compare-views` exists only when the service runs with `LGTM_TEST_DEBUG=1`, is owner-only, and returns no difference after a flow | Test id: `packages/engine/test/api/compare-views-rpc.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 7a.1 | Node.js HTTP server listening on `engine.sock`, WebSocket upgrade with the credential checked on upgrade, `RpcServer.makeProtocolWithHttpEffectWebsocket` per connection, revocation closing connections by racing each connection against an invalidation signal (row 48) | Target `packages/engine/src/api/server.ts`; pattern T3 `apps/server/src/ws.ts` lines 3293-3330, 3360-3367, 3374-3385 |
| 7a.2 | Service entry: the lifetime lock (row 52 step 1), stale socket removal and listen with "recovering" (step 2), then 6d's recovery, then serving; the service logger through the redactor; `LGTM_TOKEN` removed from its own environment; the debug RPC group only under the test flag (rows 52, 57, 62) | Target `packages/engine/src/service.ts`, `packages/engine/src/lock.ts` |
| 7a.3 | `serve --detach`: connect to the socket first; if nothing answers, spawn detached and `unref` | Target `packages/cli/src/serve.ts`; pattern Synapse `herdr_team/daemon.py` (double fork, lock; Scout B item 3) |
| 7b.1 | `packages/client`: the RPC client over the socket with a `WebSocketConstructor` built on `ws` (`ws+unix:` address, `Authorization` header), the identity rule and folder check (row 54) | Target `packages/client/src/`; pattern `@effect/platform-node` `NodeSocket.ts` lines 34-46 |
| 7b.2 | `lgtm` command-line tool: one subcommand per RPC, `--version`, `wait --block`, `accounts set-secret` reading standard input without echo, control-character stripping; replaces unit 1's stub entry | Target `packages/cli/src/bin.ts`, `packages/cli/src/commands/` |
| 7b.3 | `lgtm mcp`: stdio MCP server built with `effect/ai` `McpServer.layerStdio` (present in the Effect 4 source T3 vendors, `effect/src/ai/McpServer.ts:1437`; confirm in 4.0.5 first, and if absent stop and ask the owner), one tool per agent-callable command, lazy connect with retry (rows 15, 52, 55) | Target `packages/mcp/src/server.ts`; pattern T3 `apps/server/src/mcp/McpHttpServer.ts` (imports `effect/ai`) |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An unauthenticated or under-authorised way in | High | Criteria 7.1-7.3, 7.9; attack pass on 7a, 7b. |
| A harness sandbox blocks the agent's tool server from reaching the socket | Medium | Post-build check PB-A3; if a sandbox blocks it, the harness setting adds the socket folder to the sandbox's allowed paths, recorded per harness. |
| The service stops and nothing restarts it | Medium | `serve --detach` is safe to repeat and is a Herdr action; recovery makes restarting safe; supervision is a later piece's concern. |
| A secret reaches the service's log | High | Criterion 7.11. |

**Verify:** criteria 7.1-7.12; environment QA: on the owner's Herdr host, the startup hook starts the service once (checked during the live check, step 4 of the owner's list).

**Rollout detail:** rollout step 9.

**WS-8: Proof that the Foundry needs nothing else**

Purpose: the fake agent, the recorded sessions, the acceptance suite and the
live check. Units: 8a fake agent, replay, harness resolution and the fixture
recorder; 8b the acceptance suite; 8c the live check.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 8.1 | The fake agent follows a script (text, plan, tool call, file change, permission request with option kinds, question, mode change, config options, end turn, crash, out of usage, signed out, slow turn, print environment, replay history on load) over real ACP, in the protocol version the real adapters negotiate | Test id: `packages/testing/test/fake-agent.test.ts` |
| 8.2 | The fixture recorder runs in a fresh `/tmp` folder in read-only mode, scrubs secrets, and writes `packages/testing/fixtures/claude.ndjson` and `codex.ndjson`, plus `gemini.ndjson` and `cursor.ndjson` when those harnesses are installed (otherwise it prints them as skipped); each file's header records the adapter version and negotiated protocol version | Test id: `packages/testing/test/recorder-scrubs.test.ts`; on-device step: owner runs `pnpm record-fixtures` before unit 6a; it exits 0 and `ls packages/testing/fixtures` shows the files |
| 8.3 | One acceptance test per capability, through the public socket only, with real tokens and the owner credential | Test ids: `packages/engine/test/acceptance/capability-01-start.test.ts` to `capability-12-accounts.test.ts` |
| 8.4 | One acceptance test per failure rule; failure 2 runs the service as a child process, sends it `SIGKILL` mid-turn, restarts it, and checks no message is lost or repeated | Test ids: `packages/engine/test/acceptance/failure-1-crash.test.ts` to `failure-8-disk.test.ts` |
| 8.5 | The spec's "One request, start to finish" passes end to end; every acceptance test ends with `debug.compare-views` reporting no difference | Test id: `packages/engine/test/acceptance/flow-start-to-finish.test.ts`; harness `packages/engine/test/support/acceptance.ts` |
| 8.6 | The live check passes once on the owner's accounts | On-device step: owner runs `pnpm live-check` on the Herdr host with one Claude Code and one Codex account; it runs flow 8.5 on the real adapters in a fresh `/tmp` folder, prints each step, re-records the fixtures, and exits 0 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 8a.1 | Fake agent on `AcpAgent.layerStdio`, reading a JSON script from an environment variable | Target `packages/testing/src/fakeAgent.ts`; pattern `third_party/t3code/effect-acp/src/agent.ts:layerStdio` (557), `test/fixtures/acp-mock-peer.ts` |
| 8a.2 | Replay player in T3's NDJSON format | Target `packages/testing/src/replay.ts`; pattern `third_party/t3code/provider-testing/replayTranscript.ts:decodeProviderReplayNdjson` |
| 8a.3 | Harness defaults with absolute paths resolved at install (Claude `claude-agent-acp` 0.99.1 and Codex `codex-acp` 2.5.0 from `node_modules/.bin`, Gemini `gemini --acp`, Cursor `agent acp` from the owner's install) and the allow-listed base environment builder (rows 18, 33, 39, 57, 59); 6a and 6b reuse them | Target `packages/engine/src/runner/harnesses.ts`, `packages/engine/src/runner/baseEnvironment.ts`; Scout B items 5-7; planner's Cursor check |
| 8a.4 | Fixture recorder `pnpm record-fixtures` (row 42), with scrubbing and the `/tmp` read-only folder | Target `packages/engine/scripts/record-fixtures.ts` |
| 8b.1 | Acceptance harness, running the service with `LGTM_TEST_DEBUG=1` (row 23) | Target `packages/engine/test/support/acceptance.ts` |
| 8b.2 | The twenty-one acceptance files | Target `packages/engine/test/acceptance/` |
| 8c.1 | `pnpm live-check`, never part of `pnpm check` | Target `packages/engine/scripts/live-check.ts` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The suite passes on the fake but the real adapters differ | High | Recorded fixtures before 6a (8.2) and the live check (8.6). |
| Recording and the live check spend real usage or touch real files | Medium | Both are owner-run, never in `pnpm check`, use one tiny prompt per harness, and run in a fresh `/tmp` folder in read-only mode. |
| A timing test is flaky | Medium | Tests wait on events, never on sleeps; clocks use `TestClock`; no retries. |

**Verify:** criteria 8.1, 8.3-8.5 by test; 8.2 and 8.6 need the owner's host and accounts (environment QA).

**Rollout detail:** rollout steps 5 (8a), 7 (recording), 10 (8b) and 11 (8c).

**Post-build checks**

| Id | Scenario | Expected result | Evidence | Area |
|---|---|---|---|---|
| PB-A1 | Stop and crash an agent whose adapter started child processes | The whole process group exits | `ps` output before and after, in the unit 6c report | WS-6 |
| PB-A2 | An adapter writes a lot to stderr | The runner keeps draining it; the agent does not hang | Test with a fake agent writing 10 MB to stderr | WS-6 |
| PB-A3 | Each harness's sandbox, with `lgtm mcp` connecting to the socket | The tool call succeeds, or the harness setting that allows it is recorded | Live-check log per harness | WS-7 |
| PB-A4 | Search each adapter's own session files for the agent token | Not found, unless the agent itself printed its environment | `grep` over the adapters' session folders after the live check | WS-6 |
| PB-A5 | `subscribe` catch-up uses the read-only connection deliberately | The reader setting is chosen and commented | Code review note in unit 4b | WS-4 |
| PB-A6 | Type-check the copied code with the TypeScript version T3 uses | No new errors | Command output in the unit 2 report | WS-2 |
| PB-A7 | After a restart, a reloaded agent's old token | Refused | Criterion 6.7; confirmed on real adapters in the live check | WS-6 |
| PB-A8 | Kill the service with `SIGKILL`, restart it, connect with the command-line tool | The service listens; the connection succeeds | Criterion 7.10 output | WS-7 |
| PB-A9 | Start two services at once against one `LGTM_HOME` | Exactly one runs; the other reports it and exits 0 | Criterion 7.4 two-process log | WS-7 |
| PB-A10 | Record each real adapter's negotiated ACP version and its config option categories | Recorded in the fixtures; the model and effort path chosen per harness | Fixture header, unit 6a report | WS-6 |
| PB-A11 | After a restart, a reloaded real agent calls an LGTM Studio tool during its carry-on turn | The call succeeds | Live-check log | WS-7 |
| PB-A12 | After a reload on each real adapter, the replayed history contains the envelope's delivery id | Found, or the harness is recorded as "re-send on restart" | Live-check log, unit 6d report | WS-6 |
| SEC-PB-1 | Search real adapters' files and process arguments for the token | Not found (per PB-A4's exception) | Live-check log | WS-6 |
| SEC-PB-2 | A child's text beginning with `/compact` reaches its parent | It arrives escaped and runs no command | Live-check log | WS-5 |
| SEC-PB-3 | Each real adapter's permission option kinds | Each maps onto LGTM Studio's scale, with its persistence | Recorded fixtures, unit 6a report | WS-6 |
| SEC-PB-4 | After an "always allow" answer on real `claude-agent-acp` 0.99.1, inspect `.claude/settings.local.json` in the agent's folder | Each option's scope recorded; persistent options routed to the owner | Live-check log | WS-6 |
| SEC-PB-5 | On each real harness, run a shell command with `LGTM_TOKEN` removed | `lgtm` refuses instead of acting as the owner | Live-check log | WS-7 |

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (a) the spec `docs/specs/2026-11-01-engine-design.md`,
including its "Changes after the plan review": the twelve capabilities, the
six parts, accounts, the states, the eight failure rules, the six kinds of
test, the five copy rows, the security section, and every amendment; (b)
`decisions.md` rows 1-63; (c) round 1 and round 2 findings,
`attack/round-1-findings.md` and `attack/round-2-findings.md`.

| Source item | Workstream | Status |
|---|---|---|
| Capability 1, start an agent | WS-5 (5b, 5.4), WS-6 (6a, 6.1, 6.11); acceptance 8.3 | mapped |
| Capability 2, agents start agents, ceiling | WS-5 (5a, 5.3, 5.12) | mapped |
| Capability 3, prompt with sender | WS-5 (5.4 `prompt` row, 5.9) | mapped |
| Capability 4, state and changes | WS-3 (3.5), WS-4 (4c), WS-7 (7.3) | mapped |
| Capability 5, wait without polling | WS-5 (5d, 5.8), WS-7 (7.6) | mapped |
| Capability 6, read any thread live | WS-4 (4b, 4.3), WS-7 (7a, 7.3) | mapped |
| Capability 7, permission routing | WS-5 (5c, 5.5, 5.6), WS-6 (6.3) | mapped |
| Capability 8, reach the owner | WS-5 (5.5, 5.6), WS-6 (6.6, 6.10) | mapped |
| Capability 9, talk to any agent remotely | WS-7 (owner credential, 7.2, 7.9) | mapped |
| Capability 10, stop, resume, compact | WS-5 (5.4), WS-6 (6.4, 6.7) | mapped |
| Capability 11, group agents | WS-5 (5.4 `group` row) | mapped |
| Capability 12, several accounts | WS-6 (6b, 6.5, 6.10), WS-2 (2c), WS-5 (5.4 account rows) | mapped |
| Part 1, event log | WS-4 (4a, 4b) | mapped |
| Part 2, views | WS-4 (4c) | mapped |
| Part 3, command handler, `harnesses` | WS-5 (5b, 5.4), WS-6 (6.11) | mapped |
| Part 4, agent runner | WS-5 (5b.2), WS-6 (6a) | mapped |
| Part 5, identity | WS-5 (5a) | mapped |
| Part 6, the doors | WS-7 | mapped |
| States and the state machine | WS-3 (3c, 3.5) | mapped |
| Failure rule 1 | WS-6 (6.6); 8.4 | mapped |
| Failure rule 2 | WS-6 (6d, 6.7), WS-7 (7.10); 8.4 | mapped |
| Failure rule 3 | WS-4 (4.1, 4.2) | mapped |
| Failure rule 4 | WS-5 (5.6) | mapped |
| Failure rule 5 | WS-6 (6.9, 6.10) | mapped |
| Failure rule 6 | WS-5 (5.9) | mapped |
| Failure rule 7 | WS-6 (6.8) | mapped |
| Failure rule 8 | WS-4 (4.5) | mapped |
| Test kinds 1-6 | WS-8 (8a, 8.2, 8b, 8c), WS-4 (4.4, 4.6), every WS | mapped |
| Copy rows | WS-2 (event store: shape only, row 13) | mapped |
| Security section and SECURITY.md rules 1, 2, 4, 6, 7 | WS-7 (7.1, 7.2, 7.9, 7.11), WS-5 (5.1, 5.2, 5.10, 5.11), WS-3 (3.4), WS-6 (6.1, 6.12, 6.14) | mapped |
| Amendment: how clients reach the engine (rows 21, 48, 54) | WS-7 (7.1, 7.2, 7.9; 7a.1, 7b.1) | mapped |
| Amendment: one state machine (rows 24, 62) | WS-3 (3c, 3.5) | mapped |
| Amendment: when a wait is satisfied (rows 25, 26, 50) | WS-5 (5d.1, 5.8), WS-7 (7.6) | mapped |
| Amendment: who holds a request (rows 27, 51) | WS-5 (5c.1, 5.5, 5.6) | mapped |
| Amendment: pauses and accounts (rows 28, 53) | WS-6 (6b.1, 6.10), WS-5 (5.4) | mapped |
| Amendment: messages that survive a restart (rows 29, 51) | WS-5 (5d.2, 5.9), WS-6 (6a.2, 6.7) | mapped |
| Amendment: repeated requests (row 30) | WS-4 (4.2) | mapped |
| Amendment: start-up order (rows 31, 49, 52) | WS-6 (6d.1, 6.7), WS-7 (7a.2, 7.4, 7.10) | mapped |
| Amendment: what agents are given (rows 32-38, 54-58) | WS-5 (5.1, 5.10-5.12), WS-6 (6.1, 6.12, 6.13), WS-7 (7.5, 7.8, 7.9, 7.11) | mapped |
| Amendment: what agents can read (rows 47, 61) | SECURITY.md (written 2026-11-01); WS-6 (6.14) | mapped |
| Rows 59, 60, 63 (build order, model setting, bookkeeping) | WS-1 (1.7, 1g), WS-6 (6.11), WS-4 (4.4), conventions | mapped |
| Decisions 1-63 | Key decisions and the rows cited in each WS | mapped |
| Round 1 and round 2 findings | the outcomes columns of the two findings files | mapped |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: never push to or open a pull request against `vitalysim/herdr-synapse` | No push at all, to any remote, without the owner (row 17). |
| `AGENTS.md` rule 2: credit every piece of copied code | WS-2 tasks 2a-2h, criteria 2.5 and 2.7; commit messages name the T3 file (conventions paragraph). |
| `AGENTS.md` rule 3: keep `docs/features.md` and `docs/issues.md` current | Conventions paragraph; every scope may edit `docs/issues.md`; the lead updates `docs/features.md` (rows 46, 63). |
| `AGENTS.md` rule 4 and SECURITY.md's binding rules | Rows 21, 33-38, 47, 48, 54-58, 61; criteria 3.4, 5.1, 5.2, 5.10-5.12, 6.1, 6.12-6.14, 7.1-7.3, 7.8, 7.9, 7.11. The owner approved the agent-read limit in SECURITY.md on 2026-11-01 (row 47). |
| `AGENTS.md` rule 5: the client API is the product's surface | Criterion 7.5; `accounts set-secret` and `accounts mark-available` through the API (rows 40, 53). |
| `AGENTS.md` rule 6: team shapes do not belong here | No roles or team definitions (row 4). |
| `AGENTS.md` rule 7: do not commit or push unless the owner asks | The owner asked on 2026-11-01: local commits on `master` (first commit) and `engine` only, no push (row 17). |
| `AGENTS.md` "Language": Effect 4 looked up; Node.js 26 | Conventions paragraph; criteria 1.1, 1.5. |
| `AGENTS.md` "Status": no application code until the design is approved | The design is approved; the lead updates the section before unit 1 (row 46). |
| `AGENTS.md` "Writing style for documents" | READMEs and reviews in WS-2; abbreviations expanded in the conventions paragraph. |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its harness-session skill)
at launch; this section names none (owner, 2026-10-16).

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1 Skeleton, dependencies, manifest, launcher | infra | engine/infra | medium | Several config files on T3's pattern, one launcher, one environment check. | no | rollout step 1 (Node.js 26, first commit) |
| 2 Copied T3 packages and review | infra | engine/infra | medium | Copying with import replacement, credit and a security read; T3's tests prove it. | no | 1 |
| 3 Shared definitions and state machine | contracts | engine/contracts | medium | New schemas whose shapes the amended spec fixes. | no | 2 |
| 4a Event log | backend | engine/backend | medium | One writer, transactions, receipts on the copied SQLite client. | no | 3 |
| 4b Subscribe without gaps | backend | engine/backend | high | Concurrency at the catch-up-to-live join. | no | 4a |
| 4c Views, rebuild check, compare | backend | engine/backend | medium | Pure fold functions over a fixed event list. | no | 4a |
| 5a Identity, ceiling, redactor | backend | engine/backend | high | Authentication, credential storage and secret handling. | yes | 4a |
| 5b Lifecycle commands, Runner interface | backend | engine/backend | medium | One module per command on a fixed handler and state table. | no | 5a, 4c |
| 5c Permissions, questions, rights | backend | engine/backend | high | Holder selection, moves and answer races. | yes | 5b |
| 5d Waits and deliveries | backend | engine/backend | high | Exactly-once wakes across transactions. | no | 5c |
| 8a Fake agent, replay, harness resolution, recorder | backend | engine/backend | medium | Built on the copied ACP agent and replay code. | no | 3 |
| 6a Runner core | backend | engine/backend | high | Child processes, streaming and held requests across a protocol boundary. | no | 5d, 8a, owner fixture recording |
| 6b Accounts | backend | engine/backend | medium | Environment assembly on copied code, picker, timer. | no | 6a |
| 6c Crashes, sweep, error classes | backend | engine/backend | medium | Bounded handlers with explicit guards and fixtures. | no | 6a |
| 6d Restart recovery | backend | engine/backend | high | Ten ordered steps whose mistakes lose or repeat messages. | no | 6b, 6c |
| 7a Server and service | backend | engine/backend | high | The engine's only entry point, its lock and its authentication. | yes | 4b, 5d, 6d |
| 7b Client, command-line tool, tool server | backend | engine/backend | medium | Thin wrappers over one RPC group, plus the identity check. | yes | 7a |
| 8b Acceptance suite | backend | engine/backend | medium | Twenty-one tests on one harness pattern. | no | 7b, 8a |
| 8c Live check | backend | engine/backend | low | One script, run by the owner. | no | 8b |

Load: 19 build units. Following the sheet's builder and test-writer tables
for these work areas and complexities, roughly 13 builds land on the OpenAI
vendor and 6 on the Anthropic vendor, with test writers on the opposite
vendor (13 Anthropic, 6 OpenAI), one focused review per unit on the vendor
that did not build it (6 OpenAI, 13 Anthropic), and a cyber attacker and
verifier for each of the four attack-pass units (4 OpenAI, 4 Anthropic).
That is 29 OpenAI and 36 Anthropic launches, 65 in all (19 × 3 + 8). The
planner cannot read the remaining weekly allowance; the lead checks each
vendor's remaining limit before launching and schedules units 6a to 8b later
if either vendor would run out (known gap 1).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|
| 1 | 2 / 31 / 13 | All four lenses REVISE. Folded into plan v2 and the spec amendment. Details: `attack/round-1-findings.md`. |
| 2 | 1 / 35 / ~20 | All four lenses REVISE. 16 of 36 BLOCKER and MAJOR findings in restart, waits and deliveries; the owner kept automatic recovery (row 49). Folded into plan v3 as rows 50-63 and the rewritten spec amendment. Details: `attack/round-2-findings.md`. |

</details>


---

# decisions.md (verbatim)

# Decisions — lgtm-engine

| id | question | decision | rationale | status | date |
|---|---|---|---|---|---|
| 1 | Which process tier does this plan need? | L | A new subsystem with six parts, new public contracts (the engine API, agent tokens, device credentials), security rules and copied third-party code. More than five workstreams, so it is above tier M. ATTACK runs to convergence, at most three rounds. | closed | 2026-11-01 |
| 2 | What is the plan built from? | The approved spec `docs/specs/2026-11-01-engine-design.md`. | Owner approved it on 2026-11-01 after asking for it to be checked against the design session instead of reading it. | closed | 2026-11-01 |
| 3 | What would make the owner consider this a failure? | The Foundry still needing something from Herdr or a script that the engine should provide: the twelve capabilities in the spec's "How the engine is judged finished". | Owner, 2026-10-30: "At least what the engine enables should still be enabled, so I shouldn't have to open up those things." | closed | 2026-11-01 |
| 4 | What is out of scope for this plan? | The client API's pairing, phone alerts, remote access and web page; the message board; the foundry roles and sheepdog; interactive mode; git worktrees; usage meters; the event log's retention rule. | Spec, "What stays out of the engine" and "What this spec leaves open". | closed | 2026-11-01 |
| 5 | Language and framework? | TypeScript with Effect, pinned to the version at T3 Code commit `6fc9144` (Effect 4.0.5). | Owner decisions 2026-10-30 (TypeScript) and 2026-11-01 (Effect, for reuse of T3 Code). | closed | 2026-11-01 |
| 6 | New contracts or reuse? | New LGTM Studio contracts (commands, events, states), built with Effect Schema. T3 Code's ACP schema and provider-instance contract are copied with credit. | Spec, "The six parts" and "Code to copy from T3 Code". | closed | 2026-11-01 |
| 7 | Closest existing template to copy? | T3 Code at commit `6fc9144`: `packages/effect-acp`, the orchestration-v2 event store, provider instances, `packages/provider-testing`. | Spec, "Code to copy from T3 Code". | closed | 2026-11-01 |
| 8 | UI? | None. The engine has no screen; clients come in piece 2. Gate 3 does not apply. | Spec scope. | closed | 2026-11-01 |
| 9 | Failure behaviour? | The eight rules in the spec's "When things fail". | Owner approved section 3 on 2026-11-01. | closed | 2026-11-01 |
| 10 | Which epic does this plan belong to? | `lgtm-foundation`: the four pieces the owner named (engine, client API, message board, foundry roles). This plan is slice 1. | Owner agreed the four-piece split and "engine first" on 2026-10-30. | closed | 2026-11-01 |
| 11 | Does LGTM Studio's own licence need choosing before the engine is built? | Not for this plan. Assumption: the engine can be built and kept private while the licence is open; copied MIT code only needs its own licence kept. | The repository is private and nothing is published. | unanswered | 2026-11-01 |
| 12 | How is LGTM Studio packaged and run on a Herdr host? | A Node.js program, on Node.js 26, the current LTS line ("Lithium"; v26.13.0 released 2026-10-28, confirmed from nodejs.org/dist/index.json on 2026-11-01). The repository's `.nvmrc` says `26`. A Bun single file is not built. | Owner, 2026-11-01: "Node.js it is" and "The version we'll go with is 26. Make sure to set up the NVMRC file." T3 Code's copied SQLite client uses `node:sqlite`, and the Claude Code adapter needs Node.js 22 or later. | closed | 2026-11-01 |
| 13 | Where does copied T3 Code live, and how is it used? | Each copied T3 package becomes a pnpm workspace package under `third_party/t3code/<name>/` (`effect-acp`, `node-sqlite`, `provider-instance`, `provider-testing`), with T3's MIT licence, a README naming commit `6fc9144` and every file, and a NOTICE entry. LGTM Studio's own code imports them by package name. `provider-acp`, the event store and the auth tables are not copied. | Scout A: `effect-acp` and `nodeSqliteClient.ts` depend only on Effect and Node.js; `provider-acp` depends on 28 T3 modules; the event store depends on T3's contracts; T3's auth tables appear to store credentials in plain text, which the spec forbids. AGENTS.md rule 2. | closed | 2026-11-01 |
| 14 | Test runner? | Vitest with `@effect/vitest`, not vite-plus. | The copied `effect-acp` tests import only `@effect/vitest` (Scout A follow-up: `packages/effect-acp/src/schema.test.ts:1`), so they run unchanged; vite-plus would add a second toolchain for no gain. | closed | 2026-11-01 |
| 15 | How do agents reach LGTM Studio's tools over MCP? | A stdio MCP server, `lgtm mcp`, started by the agent's adapter from the ACP `session/new` `mcpServers` list, holding that agent's token and acting as a thin client of the engine API. Built with `effect/ai`'s MCP server, as T3 Code's `apps/server/src/mcp` is. If `effect/ai` 4.0.5 has no stdio transport, fall back to an HTTP MCP endpoint on the loopback address, like T3's `McpHttpServer.ts`, still authenticated by the agent token. | Stdio needs no extra listening port (SECURITY.md rule 1) and every ACP agent must support stdio MCP servers. | superseded by rows 21, 48 | 2026-11-01 |
| 16 | How is the engine API carried? | `effect/rpc`: one `RpcGroup` of commands plus a streaming `subscribe`, served over a WebSocket on 127.0.0.1, every message decoded with Effect Schema. Each connection presents a credential before any other message. | Spec, "The doors" (chosen in spec, accepted with the spec). `effect-acp` already uses `effect/rpc` (Scout A, item 1 imports). | superseded by rows 21, 48 | 2026-11-01 |
| 17 | May agents commit during execution? | Yes. At build start, one first commit on `master` of the files that exist then; each finished unit is then one commit on a local `engine` branch made from it, built in its own worktree. Nothing is pushed to `qnlbnsl/lgtm-studio` until the owner asks. Commits use `git add <paths>`, never `-A`. | Owner, 2026-11-01: "yes. it is allowed." (to: first commit, then commit to a local `engine` branch in the LGTM Studio repository, without pushing). This is the owner asking, as `AGENTS.md` rule 7 requires. | closed | 2026-11-01 |
| 18 | How does the engine get each harness's ACP command? | The Claude Code and Codex adapters are exact-pinned npm dependencies of `packages/engine` (`@agentclientprotocol/claude-agent-acp` 0.99.1, `@agentclientprotocol/codex-acp` 2.5.0) and run from `node_modules/.bin`. Gemini CLI (`gemini --acp`) and Cursor (`agent acp`) are found on `PATH`. Every default can be overridden per harness through the `harnesses` command. Never `npx -y` at run time. | Pinned versions keep tests reproducible and avoid downloading code each time an agent starts. Scout B items 5-7; planner's Cursor check. | closed | 2026-11-01 |
| 19 | Where are account secrets kept in this first version? | In one file, `secrets.json`, in LGTM Studio's state directory, readable only by the owner (mode 0600). Accounts hold a reference (`secret:<id>`), never the value. The value is read only when building an agent's environment and is never written to the log, a view or a reply. | SECURITY.md rule 6. T3 Code's secret providers (`packages/secret-provider-*`) are larger than this plan needs; a provider interface keeps them addable later. | closed | 2026-11-01 |
| 20 | Round 1 attack: how are its findings handled? | Folded into plan v2 and a spec amendment ("Changes after the plan review", 2026-11-01) per rows 21-46. Two findings need the owner: commits (row 17, now with options) and the threat model (row 47). Findings and outcomes: `attack/round-1-findings.md`. | Four lenses returned REVISE: 2 BLOCKER, 31 MAJOR, 13 MINOR. | closed | 2026-11-01 |
| 21 | How do local clients find and reach the engine? (critic 6, architect 1, security 8) | One fixed state folder, `$LGTM_HOME`, default `$XDG_STATE_HOME/lgtm` (normally `~/.local/state/lgtm`), mode 0700. The engine listens on a Unix domain socket, `engine.sock`, in that folder, and checks the peer's user id. The command-line tool, `lgtm mcp` and tests connect there. The runner passes `LGTM_SOCKET` and `LGTM_TOKEN` in the `mcpServers` environment. No TCP listener in this plan: the loopback WebSocket for the web page and phone moves to piece 2, with Origin and Host checks and connection limits. Amends the spec's "chosen in this spec" choice 3. | A Unix socket in a 0700 folder cannot be squatted by another user, needs no port discovery, and removes browser cross-site risks until a browser client exists. Herdr docs (read 2026-11-01): keep durable state out of `HERDR_PLUGIN_ROOT`. | closed | 2026-11-01 |
| 22 | How is Node.js found when Herdr or an adapter starts LGTM Studio? (architect 2) | `bin/lgtm` uses `$LGTM_NODE` if set, else the newest `$NVM_DIR/versions/node/v26.*/bin/node`, else `node` on `PATH` if it is version 26, else fails with an install hint. The runner's `mcpServers` entry uses `process.execPath` and the absolute path of `packages/cli/src/bin.ts`. Owner action: `nvm install 26` (the host has no Node.js 26 yet, architect check). | A clean shell on this host has no `node` on `PATH`; nvm is lazy-loaded. | closed | 2026-11-01 |
| 23 | Package layout without cycles (architect 3, question 2) | `packages/contracts` ← `packages/client` (shared RPC client) ← `packages/cli`, `packages/mcp`; `packages/engine` depends on contracts and third_party only; `packages/testing` (fake agent, replay) depends on contracts and third_party only; the acceptance harness and rebuild check live in `packages/engine/test/support/`. Type checks run per package (`pnpm -r typecheck`, `tsc --noEmit`). | `tsc -b` rejects the testing↔engine cycle (TS6202). | closed | 2026-11-01 |
| 24 | One state machine for agents (logic 7, question 1) | Contracts hold one transition table. An agent's lifecycle state is one of: starting, working, idle, paused (reason: limit or signed-out), interrupted, crashed, stopped. "Waiting on a permission" and "waiting on an answer" are derived from counts of open requests and questions, so both can be true. The spec's nine displayed states are computed from these. Command validity per state: `prompt` to idle or working (queued while working), refused to crashed and stopped; `compact` only when idle; `resume` for stopped, crashed and interrupted; `stop` for any non-stopped state. Every state change writes an event. Amends the spec. | The spec's command table and failure rule 2 disagreed on `resume`; signed-out had no state; two open requests could not be represented. | closed | 2026-11-01 |
| 25 | When is a wait satisfied? (logic 1, 2, 3) | A wait member resolves once, with a reason: settled (idle, with no open waits, requests, questions or queued deliveries, and not a compact turn), crashed, stopped, paused, or interrupted and not reloadable. "Any" resolves on the first member; "all" when every member has a reason. Each wait records `since`, the sequence number when it opened, and is checked when opened, in the same transaction as every event that can resolve a member, and again during recovery. The waiter gets one delivery listing each member's reason; a crash notice to a waiting parent is merged into it. | Any "turn ended" was satisfying waits, so multi-level waits fired early; wakes could be lost between transactions and across restarts. | closed | 2026-11-01 |
| 26 | Blocking `lgtm wait` (logic 4) | The MCP `wait` tool registers a wait and returns; the agent then ends its turn and is woken by one delivery. The command-line `lgtm wait --block` (for the owner's terminal and interactive mode) also returns early, exit 2, when a request or question is routed to the caller, and a blocking wait creates no delivery. Exit codes: 0 every member settled; 1 any member crashed or stopped; 2 waiting on the caller or any member paused or interrupted. | A blocking wait inside a lead's turn deadlocked with a worker's request routed to that lead. | closed | 2026-11-01 |
| 27 | Who holds a request, and who has a parent's rights, when the parent cannot act? (logic 5, 11, 12) | The holder is the nearest ancestor that is idle or working; if none, the owner. Questions follow the same rule. Whenever the owner becomes the holder, "owner needed" is written in the same transaction. A parent's rights (prompt, wait, stop, resume, compact, group, answer) pass to the nearest such ancestor while the parent is not idle or working. Stopping an agent does not stop its children. `answer` checks inside the transaction that the request is open and routed to the caller (or the caller is the owner). Closing a request withdraws its queued delivery and its owner alert in the same transaction. Amends the spec's "chosen in this spec" choice 1. | Requests stuck forever behind paused or interrupted holders; the orchestrator could not manage a crashed lead's team. | closed | 2026-11-01 |
| 28 | How does a paused agent come back, and how is an account picked? (logic 6) | Each pause records a reset time when the harness gives one. The engine's timer writes "account available" at that time; the owner can also mark an account available. That event moves the account's paused agents to idle and releases their queued deliveries. The picker counts agents that are starting, working, idle or paused on each usable account, picks the fewest, and breaks ties by account id. With no usable account, `start` is refused with the reason. A signed-out account writes "account needs sign-in" and "owner needed", and its agents pause with reason signed-out. | Pauses had no exit; clock-based usability broke the views-from-log rule. | closed | 2026-11-01 |
| 29 | Exactly-once delivery across a restart (logic 8) | A delivery has three steps: queued, sent (the engine sent `session/prompt`), accepted (the adapter's first `session/update` for that turn, or the prompt's reply, whichever comes first). On restart, a delivery that was sent but not accepted is re-sent first; the "carry on" prompt goes only to agents that were mid-turn with no unaccepted delivery, at the head of their queue. | "Delivered" was written before the adapter accepted the message. | closed | 2026-11-01 |
| 30 | Request-id receipts (logic 9, architect 6, security 11) | Receipts are keyed by (caller, request id) and store a hash of the request body. The same key with a different body is refused as "request id reused". Only completed results are stored; refusals for temporary conditions (no usable account, database busy) are not. The duplicate check runs inside the writer, and a key collision is a duplicate, never a disk failure. | Another caller could read or suppress a command by reusing its id. | closed | 2026-11-01 |
| 31 | Start-up and recovery order (logic 10, security 12) | 1. Take the lifetime lock: a separate SQLite file `engine.lock` opened with `locking_mode=EXCLUSIVE` and held while the service runs; a second instance fails to lock and reports the running one. 2. Migrations. 3. Rebuild views. 4. Sweep leftover adapter process groups and wait for them to exit. A row is signalled only if its boot id equals this boot's, its group id is greater than 1 and not the engine's own, and its start time, user id and executable match. 5. Mark running agents interrupted, recording each one's previous state. 6. Reload sessions where supported, each with a new token. 7. Re-send unaccepted deliveries, then carry-on prompts. 8. Re-check open waits. 9. Open the socket. | The sweep could kill adapters recovery had just started; a crash mid-recovery lost which agents were mid-turn; pid-plus-port let a second instance start. | closed | 2026-11-01 |
| 32 | Tables outside the event log (architect 7) | One migration list, owned by unit 4a. `agent_tokens`, `devices` and `processes` are written only by `EventLog.append` as side rows in the same transaction as their events. A new token is minted for every spawn (start, resume, reload) and the old one revoked; stop and crash revoke too. | Tokens and events were written in separate transactions; a reload needs a fresh `mcpServers` entry anyway. | closed | 2026-11-01 |
| 33 | The adapter's environment (security 4, architect 4) | Built from an allow-list (`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_*`, `TERM`, `TMPDIR`, `TZ`) plus the account's variables, resolved secrets and `LGTM_*`. Never `HERDR_*`, and never provider keys the account does not set. LGTM Studio's own account schema requires every secret-looking variable to be a reference; T3's copied `mergeProviderInstanceEnvironment` is called with this base, never `process.env`. | `HERDR_SOCKET_PATH` would let an agent drive the owner's other panes; inherited `ANTHROPIC_API_KEY` overrides the account. | closed | 2026-11-01 |
| 34 | ACP client capabilities (security 3) | The engine advertises no file-system read, no file-system write and no terminal capability. `fs/*` and `terminal/*` requests are refused. Agents use their own tools inside their own harness sandbox. | Otherwise the engine would run agent commands with no sandbox; T3 defaults these off (`AcpSessionRuntime.ts`, lines 1766-1772). | closed | 2026-11-01 |
| 35 | The permission ceiling beyond the starting mode (security 2) | (a) A child's folder must resolve (by `realpath`) inside its parent's folder, or be a git worktree with the same git common directory as the parent's folder. (b) Every ACP permission option is mapped onto LGTM Studio's scale ("allow always" and "allow for this session" count as raising the asker to that option's level); an answerer may choose only options at or below its own mode; the owner may choose any. (c) Mode changes reported by the adapter are recorded; a change above the agent's ceiling is set back with `session/set_mode` and recorded as refused. | Folder choice, "allow always" answers and later mode changes could each widen a child. | closed | 2026-11-01 |
| 36 | Secrets in thread text and fixtures (security 5, 6) | Every append passes text through a redactor that holds every live secret value (agent tokens, device credentials, account secrets). Replay fixtures are scrubbed by the recorder. Tokens travel only in environment variables, never in arguments. | An agent printing `env` would store its token forever; arguments are readable by every local user. | closed | 2026-11-01 |
| 37 | File modes (security 7) | The service sets umask 077 at start; the state folder is 0700 and must be owned by the service's user, checked at every start (refuse otherwise); files are created with exclusive, no-follow opens; the database, its WAL and SHM files, `secrets.json`, the owner credential and the lock file are 0600. | Other users on a shared host could otherwise read every thread. | closed | 2026-11-01 |
| 38 | Agent text inside engine-written prompts (security 9) | Prompts the engine writes (permission requests, questions, wait results, deliveries) put child text inside a labelled envelope that says the content is data from another agent, and escape a leading `/` so it cannot run a slash command. The command-line tool strips terminal control characters from thread text. | SECURITY.md rule 7. | closed | 2026-11-01 |
| 39 | Adapter commands and install scripts (security 10) | Harness settings store absolute adapter paths, resolved at install time. `pnpm-workspace.yaml` sets `onlyBuiltDependencies` to an explicit empty or minimal list. WS-2 adds a security read of every copied file. Gemini CLI and Cursor stay owner-installed; their paths are recorded when the owner adds the harness. | Relative and `PATH` lookups let a changed checkout change what the engine runs. | closed | 2026-11-01 |
| 40 | Who writes `secrets.json`? (architect 5) | An owner-only, write-only command `accounts set-secret <id>` over the Unix socket; the command-line tool reads the value from standard input without echo; the reply never contains it. | Cursor accounts need an API key and must be configurable through the API (AGENTS.md rule 5). | closed | 2026-11-01 |
| 41 | Visibility of events with no agent (security 11) | Events with no agent attached ("owner needed", account and harness changes, device changes) are visible only to the owner. Criterion 7.3 covers every event type. | Agents had no stated visibility for them. | closed | 2026-11-01 |
| 42 | Where do the first replay and error fixtures come from? (critic 3) | An owner-run step before unit 6a: `pnpm record-fixtures` runs one short scripted session each on Claude Code, Codex, Gemini CLI and Cursor, records their ACP traffic, and captures each harness's signed-out error by running with an empty home or key. It spends a little usage. Out-of-usage error text comes from the adapters' source where it is open (Claude Code, Codex, Gemini CLI) and is marked unverified for Cursor until seen. | Criteria 6.2 and 6.9 needed fixtures that only the last step produced. | closed | 2026-11-01 |
| 43 | Proving the rebuild check runs in acceptance tests (critic 8) | An owner-only diagnostic command, `debug.compare-views`, rebuilds the views from the log inside the running service and returns any difference. The acceptance harness calls it after every scenario. A guard test fails if any engine test file does not register the rebuild hook. | The acceptance service runs in a separate process. | closed | 2026-11-01 |
| 44 | The Runner interface (architect 12) | `Runner` has start, load, prompt, cancel, answer permission, set mode, compact, stop, a capabilities record and an event stream. The agent's session reference is a tagged union (`acp` with a session id now; `interactive` later). | Interactive mode must not need contract changes. | closed | 2026-11-01 |
| 45 | Copy-list and toolchain corrections (architect 9-11, critic 9, 11) | Copy `ClaudeHome.ts` too (spec row). Replace `CodexSettings` and `ClaudeSettings` imports with a local `{ homePath, shadowHomePath }` type. Copy the replay schemas from T3 `packages/contracts/src/orchestrationV2.ts` lines 4176-4220 with their header type and `NonNegativeInt`. Replace `@t3tools/shared/testing/symlinks` in the copied Codex home test. Criterion 2.6 greps import statements only. Pin `vitest` 5.x for `@effect/vitest` 4.0.5, `@types/node`, and `@effect/openapi-generator` for the copied generator script; copy T3's test timeouts and environment scrub from `vite.config.ts` lines 98-130. Unit 1 changes the existing `mergeMessage.test.ts` import from `vite-plus/test` to `vitest`. Declare `@effect/platform-node` for `effect-acp`. Wire `scripts/check-credits.sh` into `pnpm check`. | Architect verified each against T3 at `6fc9144`. | closed | 2026-11-01 |
| 46 | Scope boundaries and dependencies (critic 2, 7) | The `AGENTS.md` "Status" update is the lead's job, not unit 1's. The infra scope also edits `packages/*/package.json`, `packages/*/tsconfig.json` and `packages/engine/test/smoke/**`; every scope may edit `docs/issues.md`; the live-check and fixture scripts live in `packages/engine/scripts/`. Dependencies: 8a before 6a; 4b and 6b before 7a. | Units 1 and 8c wrote outside their scopes; 7a served `subscribe` without depending on 4b. | closed | 2026-11-01 |
| 47 | Threat model: are agents trusted with the owner's files? (security BLOCKER 1, finding 10) | Accept the limit for now. Agents run as the owner's user and can read LGTM Studio's state folder; the permission rules stop mistakes, not a deliberately hostile agent. Written in SECURITY.md ("What LGTM Studio protects, and what it does not") on 2026-11-01. The cheap per-harness deny-read rule for the state folder stays as an accident guard (task and criterion in plan v3). The real fix, LGTM Studio running as its own Unix user, is deferred to before remote access (docs/features.md, section 4). | Owner, 2026-11-01: "I accept the recommendation here because the real fix is indeed using separate users and/or creating a separate user for LGTM Studio. The agents run as my user, but LGTM Studio makes its own user so that its private stuff stays private ... for now, let's not bother with it ... I couldn't care less right now about an agent reading the private folder or the credentials." | closed | 2026-11-01 |
| 48 | Correction to row 21: how the socket is served and authenticated | The engine runs a Node.js HTTP server listening on the Unix socket path and upgrades connections to WebSocket, then serves `effect/rpc` with `RpcServer.makeProtocolWithHttpEffectWebsocket`, as T3 Code's `apps/server/src/ws.ts` does (lines 3293-3330). The credential is checked on the upgrade request (`Authorization: Bearer`), before any RPC message; revoking a credential closes its live connections (T3 `ws.ts` lines 3360-3367). There is no peer user-id check: Node.js does not expose the peer's credentials, so the 0700 state folder is what limits connections to the owner's user. Piece 2 adds a TCP listener to the same server. | Architect finding 8 (authenticate on upgrade); Node.js `net` has no portable peer-credential API. Supersedes the peer-check wording in row 21. | closed | 2026-11-01 |
| 49 | Restart recovery: keep it automatic, or simplify? (round 2: 16 of 36 BLOCKER and MAJOR findings sit in restart, waits and deliveries) | (a) Keep automatic recovery: reload every reloadable agent, re-send unaccepted messages, send carry-on prompts to agents that were mid-turn, with round 2's fixes folded (decisions 50 onward). Round 3, the last, is scoped to this mechanism. | Owner, 2026-11-01: "Yeah, this can be fully automatic." Offered (a) automatic, (b) reload and wait for a resume (recommended), (c) no recovery. | closed | 2026-11-01 |
| 50 | When is a wait member settled, and how do waits end? (round 2: logic F1-F4, F10, M3) | Settled is a predicate on the agent's current state only: idle, with no delivery that is not yet accepted, no open request or question it asked, no open request or question it holds, no open non-blocking wait, and not in a compact turn. The lifecycle state becomes working when "delivery sent" is written. A `start` with a first prompt queues that prompt as a delivery inside the "agent started" transaction. "Turn ended" records whether it was a compact turn; the end of a compact turn restores the settled status from before it. When a holder ends the turn in which a request or question was delivered to it without answering or passing it up, the engine passes it up in the "turn ended" transaction. New event "wait cancelled", written when a blocking wait's connection closes and when the waiter stops or crashes; a wake for a stopped or crashed waiter is withdrawn. Blocking waits never count against the caller's settled status. The blocking wait's early return is level-triggered: it returns at once if the caller already holds an open request or question. A member's reason is its state when the wait closes, not when it first resolved. A crashed member's notice is delivered at once and listed again in the final wake. Amends rows 25 and 26. | Early wakes in the orchestrator → lead → worker flow; waits that never ended; silent stalls. | closed | 2026-11-01 |
| 51 | When is a delivery accepted, and what happens to moved requests? (logic F7, F8, F12) | A delivery is accepted only on a successful `session/prompt` reply or a content update (message chunk, plan, tool call, file change) after the send. An error reply puts the delivery back at the head of the agent's queue. The envelope carries the delivery id. During a reload, replayed history updates are tagged as replay: they produce no thread events and no acceptance, and the engine scans them for unaccepted delivery ids; a found id marks that delivery accepted, and a carry-on is sent instead of a re-send. Moving a request or question withdraws the old holder's delivery and alert in the same transaction. A request never moves back down. `pass-up` uses the holder rule starting from the current holder's parent. Amends rows 27 and 29. | Messages lost on an out-of-usage reply, repeated after a restart, or answered by a former holder. | closed | 2026-11-01 |
| 52 | Start-up and recovery order, revised (owner kept automatic recovery, row 49; logic F5, F6, F9, F11; architect 1-3; security 3, 12; logic M1) | 1. Lifetime lock: open `engine.lock` (a separate SQLite file) with `locking_mode=EXCLUSIVE` and `busy_timeout=0`, run `BEGIN EXCLUSIVE`, write one row, commit, and keep the connection open while the service runs; `SQLITE_BUSY` means another service runs, so this one reports it and exits 0. The kernel releases the lock when the process dies. 2. Remove a stale `engine.sock`, then listen; until step 9 every RPC is refused with "recovering", and `lgtm mcp` connects on first use and retries "recovering" for up to 60 seconds. 3. Migrations, then rebuild the views. 4. Revoke every agent token. 5. Sweep leftover adapter process groups (row 31's guards) and wait for them to exit. 6. Agents that were starting, working or idle become interrupted with their previous state; paused agents stay paused; open permission requests are cancelled, because the adapter process that asked is gone; questions stay open, and an interrupted holder may keep holding during recovery. 7. Reload every reloadable agent that is interrupted or paused, each with a new token; a failure writes the new event "agent reload failed" with its reason, and the agent stays interrupted. Replay is scanned per row 51. 8. Rebuild account timers from logged reset times that have no later "account available"; write an overdue "account available" now. 9. Re-evaluate holders once, moving only requests and questions whose holder stayed interrupted; re-check every open wait; recovery ends and commands are served. 10. For each reloaded agent: re-send its unaccepted deliveries, or a carry-on if replay found them or if it was mid-turn with nothing unaccepted. `resume` runs step 10 for one agent. The lock is owned by task 7a.2; task 6c.2 implements steps 4-10. Replaces row 31's order; row 31's sweep guards stay. | Stale socket blocked restart; agents started before the socket existed; the lock took no lock; every question flooded the owner; pauses and timers were lost; `resume` skipped re-sends. | closed | 2026-11-01 |
| 53 | Pauses, revised (logic F9, F10, M2, M6) | A pause records whether the agent was mid-turn; when it returns, a mid-turn agent gets a carry-on. An out-of-usage pause with no reset time writes "owner needed". "Account available" carries its cause: "usage reset" (timer) clears only out-of-usage pauses; "owner cleared" (new `accounts mark-available` command, owner-only) clears both. Deadlines are wall-clock times re-checked every minute, so a suspended host does not delay them. A pause before the session opens keeps no session; when it clears, the engine opens the session and then sends the first prompt. Amends row 28. | Paused agents lost their turn or were silent; signed-out agents were retried by the timer. | closed | 2026-11-01 |
| 54 | How the client picks its identity and trusts the socket (security 1 BLOCKER; architect 11) | The client uses the owner credential only when both `LGTM_SOCKET` and `LGTM_TOKEN` are unset; if only one is set, it refuses with a message. Before sending a credential it checks the socket's folder with `lstat`: a real folder (no symlink), owned by the current user, mode 0700, and the socket itself owned by the current user. The client uses a `WebSocketConstructor` built on the `ws` package with a `ws+unix:` address and an `Authorization` header. The service refuses to start if the socket path exceeds 100 bytes; tests create their `LGTM_HOME` with `mkdtemp` under `/tmp`. | An agent without its token would act as the owner; a planted socket path would receive the credential. | closed | 2026-11-01 |
| 55 | Which commands agents get as MCP tools (architect 7; security 8) | The command-line tool has full parity with the RPC group. The MCP server offers only agent-callable commands; it excludes `subscribe`, `accounts set-secret`, `accounts mark-available`, `debug.compare-views` and every owner-only command, asserted against an explicit list. A "command refused" event records only the command name and the reason, never the request body. The receipt hash for `accounts set-secret` covers the account id and a random request nonce, never the value. Amends criterion 7.5. | A stream cannot be a tool; a secret passed through a tool lands in the adapter's transcript. | closed | 2026-11-01 |
| 56 | The ceiling, hardened (security 4, 5) | The engine stores the child's resolved real path and spawns there, and checks it again on `resume`. The git-worktree check reads `.git` and `commondir` directly and never runs `git`. Agents started by agents may not use the owner's home folder itself, the state folder, or LGTM Studio's own plugin root; the owner may start agents anywhere. Permission options that persist beyond the session ("allow always" written to a settings file), and requests to write a harness settings file (`.claude/settings*.json`, `.codex/config.toml`, `.cursor/` permissions, `.gemini/settings.json`), are routed to the owner whatever the ceiling. Amends row 35. | A persisted "allow always" widened sibling agents; a symlink swapped after the check moved the child; `git` on `PATH` was attacker-influenced. | closed | 2026-11-01 |
| 57 | The redactor, the service log and agent environment, hardened (security 6, 9, 10) | The redactor runs on every string field of an event, after joining streamed chunks per item, with a carry-over window as long as the longest live secret. It matches each secret's raw, base64, base64url, URL-encoded and hex forms, and it hashes token-shaped substrings and matches them against stored token and device hashes. Engine-written prompts are built from redacted events. The service's logger passes through the redactor; the copied ACP protocol debug logging stays off outside tests; a test greps the service's output for planted secrets. Agents get exactly `LGTM_SOCKET` and `LGTM_TOKEN`, not a `LGTM_*` wildcard; the service removes `LGTM_TOKEN` from its own environment at start. Post-build check PB-A4 is restated: the token is absent from adapter session files unless the agent itself printed its environment. Amends rows 33 and 36. | Split, encoded and structured secrets slipped through; the copied client logs every message in debug mode. | closed | 2026-11-01 |
| 58 | The envelope, hardened (security 7) | Each envelope uses a fresh random marker in its opening and closing lines, and carries the delivery id. A leading `/`, after any whitespace, is escaped in every prompt an agent sends to another agent, not only inside engine-written prompts. The owner's prompts are not escaped. Amends row 38. | A fixed closing marker could be forged; agent prompts could run slash commands with extra tools. | closed | 2026-11-01 |
| 59 | Build order, scopes and dependencies, revised (critic 1-3, 8; architect 5, 6, 8, 10) | Unit 1 declares every dependency of every package (including the adapters pinned per row 18, and `ws`) and every root script (`check`, `record-fixtures`, `live-check`), so later units never edit the lockfile or the root manifest. Unit 1 tests the launcher against a stub entry; `lgtm --version` moves to 7b. Harness path resolution and a minimal environment builder move from 6b into 8a, and 6b reuses them. Unit 4a defines a pass-through `Redactor` service that 5a replaces. The Runner interface (6a.1) moves into 5b. The running-service part of criterion 4.6, and the socket part of 6.7, move to 7a. Row 23's package graph adds the edges cli → engine, cli → mcp, and engine dev → client, testing. The owner links the plugin in Herdr at the end of unit 1. Amends rows 23, 42 and 46. | The recorder needed adapters pinned later; root files were outside every build scope; several units used later work. | closed | 2026-11-01 |
| 60 | Setting model and effort through ACP (architect 4) | The runner uses `session/set_config_option` with the categories `model` and `thought_level` first. It uses `session/set_model` only when the adapter negotiated the protocol generation that offers it. The negotiated protocol version is recorded in "session opened" and in every fixture header. The fake agent answers in the version the real adapters use. A model or effort a harness cannot set is refused at `start` with the reason. | `session/set_model` is a compatibility method, not stable protocol version 1. | closed | 2026-11-01 |
| 61 | Carrying out decision 47 | SECURITY.md's limit is written (2026-11-01). A task adds the per-harness deny-read rule for the state folder where the harness documents a way to pass it at launch; the unit records each harness's mechanism, or "none", and SECURITY.md lists the harnesses without one. | Round 2: row 47's promises had no task. | closed | 2026-11-01 |
| 62 | Criteria made checkable (critic 9, 10; logic M2; architect 9) | Criterion 5.4 names, for each lifecycle command, the event it writes and the view change the test asserts. Criterion 3.5 has a derivation table for displayed states, and these cells are decided: `prompt` to a starting agent is queued; `group` is allowed in every state; a delivery to a stopped agent is withdrawn; exit-code precedence for `wait --block` is crashed or stopped (1) over paused or interrupted (2) over settled (0). `debug.compare-views` is served only when the service runs with the test flag `LGTM_TEST_DEBUG=1`; it compares the live views and a rebuild at one fixed head sequence, rebuilt on a read connection; tests corrupt a view by replacing the views layer. Criterion 8.2 lists the expected fixture files: Claude Code and Codex required, Gemini CLI and Cursor when installed, otherwise recorded as skipped. Amends row 43. | Several criteria could not be checked as written. | closed | 2026-11-01 |
| 63 | Bookkeeping (critic 11, 12; architect 12) | Rows 15 and 16 are superseded by rows 21 and 48. The launch totals are recomputed from the sizing table. The rebuild-hook guard exempts `packages/engine/test/smoke/`. The lead marks features built in `docs/features.md`; build units do not. | Contradictions and count errors. | closed | 2026-11-01 |
