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

Four independent reviewers checked the first version of this plan. They found
real gaps in the design itself, and this version fixes them. The main
changes are these. Waits now finish only when an agent has truly settled, so
waiting through several levels of a team works. A permission request whose
holder is stuck moves up to someone who can answer. Messages survive a
restart without being lost or repeated. The engine is reached through a file
in a private folder (a Unix socket) instead of a network port, so no other
user or web page can reach it. Agents get a short, fixed set of environment
variables instead of everything the engine has. The design document now ends
with a section listing these changes.

The work is split into eight workstreams and eighteen units, built in order:
the project skeleton, the copied code, the shared definitions, the record,
the permission rules, the agent runner, the connection, and the proof.

Several things need the owner, in this order:

1. **Install Node.js 26** with `nvm install 26`. The host does not have it yet.
2. **Decide about commits.** The repository has no commits at all, and its
   rules say not to commit unless the owner asks. Building in separate
   working copies (git worktrees) only works once the existing files are
   committed. There are two options. With commits on a private branch that is
   never pushed, units can be built in parallel and any unit can be undone.
   Without commits, the units are built one at a time in the one checkout,
   which is slower, and nothing can be rolled back to a known point.
3. **Rule on what agents may read.** Agents run as the owner's own Unix user,
   so any agent can read LGTM Studio's files, including the owner's credential.
   File permissions do not stop a program running as the same user. Until the
   owner rules, the plan treats the permission rules as protection against
   mistakes, not against a deliberately hostile agent, and says so in
   SECURITY.md.
4. **Record the first sample sessions** before the agent runner is built, by
   running `pnpm record-fixtures`. It runs one tiny session on each harness
   and spends a little usage.
5. **Link the plugin in Herdr** once, to check that Herdr accepts it.
6. **Run the live check** at the end, which spends a little more usage.

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
- **Agents get only what they need.** Each agent gets its own token, which
  stops working when the agent stops or restarts. It gets a short, fixed list
  of environment variables, never Herdr's, and no file or terminal access
  through LGTM Studio. Its own harness's sandbox stays in charge.
- **The permission ceiling covers more than the starting mode.** A child must
  work inside its parent's folder or a worktree of the same repository. An
  "allow always" answer counts as widening. A mode change the agent's harness
  reports is set back if it goes above the ceiling.
- **Rights pass up when a parent is stuck.** If a lead crashes or pauses, its
  workers' requests and the right to manage them pass to the nearest agent
  above that can act, and finally to the owner.
- **The adapters are pinned.** The Claude Code and Codex ACP adapters are
  installed at exact versions with LGTM Studio, and their full paths are saved.
  Starting an agent never downloads code.
- **Nothing is committed until the owner says so,** and the plan waits for
  that answer before building starts.

Full log → `decisions.md`

## Workstreams

### A project skeleton on Node.js 26

The repository becomes a pnpm workspace on Node.js 26, set up as T3 Code is
set up, with Effect 4.0.5, Vitest, and one command, `pnpm check`, that runs
the type checks, the tests and the credit check. It also gets the Herdr
plugin manifest and a launcher that finds Node.js 26 through nvm. The risk is
that Node.js 26, Effect 4.0.5 and Node.js's own database module do not work
together; a first test opens a database on day one to catch that. When this
is done, `pnpm check` passes on the empty project and Herdr lists LGTM Studio's
actions.

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
definitions follow the design's tables, and tests check every state and
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
exactly once, when every agent it waits on has settled or failed, with the
reason for each. Messages for a busy agent wait for its turn to end. This is
the most security-sensitive part, so every rule has its own test.

### Agents that run, report and recover

The runner starts each harness's ACP adapter with the right account, a fresh
token, a short fixed environment and LGTM Studio's tool server. It turns
everything the agent streams into events, holds the agent while a permission
request is open, and sends `/compact` where the harness offers it. Accounts
are named or picked automatically, and a paused account comes back when its
usage resets. After a crash, the runner reports and does not restart. After
an LGTM Studio restart, it stops leftover processes, reloads sessions, re-sends
any message that was not yet received, and prompts only the agents that were
in the middle of a turn. The risk is that each adapter behaves slightly
differently; recorded real sessions are replayed in tests to catch that.

### One door for agents and the owner

The engine listens on a Unix socket in LGTM Studio's private folder, and every
connection must present a credential before anything else. Revoking a
credential closes its open connections. The `lgtm` command-line tool and
the `lgtm mcp` tool server, which offers LGTM Studio's commands to agents as
tools through the Model Context Protocol (MCP), are thin clients of that
connection. Herdr starts the service once at startup. The service refuses to
start twice, and it can be started again by hand or from a Herdr action if
it stops. The risk is an unauthenticated way in; tests try a missing
credential, a revoked one, and an agent reading another agent's thread, and
each must be refused.

### Proof that the Foundry needs nothing else

A scripted fake agent that speaks real ACP plays any scenario on cue. The
acceptance suite has one test for each of the twelve capabilities and each
of the eight failure rules, including killing the service in the middle of a
turn and restarting it, and it checks after every scenario that the views
still match the record. The owner then runs one live check against real
Claude Code and Codex agents.

## Rollout order

1. The owner installs Node.js 26 and answers the commit question. If commits
   are allowed, the existing documents are committed first, on a private
   branch.
2. Build the project skeleton, because every other unit needs it.
3. Copy the T3 Code packages, because the record, the runner and the fake
   agent are built on them.
4. Write the shared definitions, because every later unit uses them.
5. Build the record and the fake agent side by side.
6. Build the permission rules, then the waits and message delivery, on top
   of the record.
7. The owner records the first sample sessions (`pnpm record-fixtures`).
8. Build the runner, the accounts, and failures and recovery.
9. Build the connection, the command-line tool and the tool server.
10. Write and run the acceptance suite.
11. The owner links the plugin in Herdr once and runs the live check.

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
`~/.local/state/lgtm` (row 21). Every unit that finishes a feature marks
it built in `docs/features.md` once merged, and records any problem it finds
in `docs/issues.md` in the same change (AGENTS.md rule 3). Every commit that
adds copied code names the T3 project and source file in its message
(AGENTS.md rule 2).

**WS-1: A project skeleton on Node.js 26**

Purpose: give every later unit a workspace, a toolchain and one command that
proves the repository is healthy, and let Herdr start LGTM Studio.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | Node.js 26 is selected and a clean install succeeds | Command: `nvm use && node --version` prints `v26.`; `pnpm install --frozen-lockfile` exits 0 |
| 1.2 | `pnpm check` runs `pnpm -r typecheck` and `vitest run` and exits 0 | Command: `pnpm check` exit code 0 |
| 1.3 | Node.js 26's SQLite module opens a database under Effect 4.0.5 | Test id: `packages/engine/test/smoke/node-sqlite.test.ts` |
| 1.4 | Herdr accepts the manifest and lists its action | On-device step: `herdr plugin link /home/qnlbnsl/projects/personal/lgtm-studio`, then `herdr plugin action list --plugin lgtm` lists `serve` (commands from https://herdr.dev/tui/docs/plugins/, read 2026-11-01) |
| 1.5 | The launcher finds Node.js 26 without `node` on the path | Command: `env -i HOME=$HOME NVM_DIR=$HOME/.nvm ./bin/lgtm --version` prints the version and exits 0; with `NVM_DIR` pointing at an empty folder it exits 1 with an install hint |
| 1.6 | Install scripts of dependencies do not run unless listed | Command: `grep -n onlyBuiltDependencies pnpm-workspace.yaml` shows the list; `pnpm install` output names no unlisted build script |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | Root `package.json` (private, `"type": "module"`, `engines.node` `>=26.13 <27`, `packageManager` pnpm at the current version, scripts `typecheck`, `test`, `check`); `pnpm-workspace.yaml` listing `packages/*` and `third_party/t3code/*`, a catalog pinning `effect`, `@effect/platform-node`, `@effect/vitest` at 4.0.5, `vitest` at the 5.x release `@effect/vitest` 4.0.5 accepts, `@types/node` for Node.js 26, `@effect/openapi-generator` 4.0.5; `onlyBuiltDependencies` (row 39) | Target `package.json`, `pnpm-workspace.yaml`; pattern T3 `pnpm-workspace.yaml` catalog (Scout A item 9) |
| 1b | `tsconfig.base.json` with T3's options (target ESNext, module and moduleResolution NodeNext, strict, allowImportingTsExtensions, erasableSyntaxOnly, verbatimModuleSyntax, noEmit); each package runs `tsc --noEmit` | Target `tsconfig.base.json`; pattern T3 `tsconfig.base.json` (Scout A item 9) |
| 1c | `vitest.config.ts` with workspace projects, T3's test timeouts and environment scrub | Target `vitest.config.ts`; pattern T3 `vite.config.ts` lines 98-130 (architect finding 10) |
| 1d | Packages `packages/contracts`, `packages/client`, `packages/engine`, `packages/cli`, `packages/mcp`, `packages/testing`, each with `package.json` exporting `./src/*.ts` and a `tsconfig.json` (row 23) | Target `packages/*/package.json`; pattern T3 package `exports` (Scout A item 9) |
| 1e | SQLite smoke test (criterion 1.3) | Target `packages/engine/test/smoke/node-sqlite.test.ts`; pattern T3 `packages/shared/src/nodeSqliteClient.ts:layer` |
| 1f | `herdr-plugin.toml`: `id = "lgtm"`, `name = "LGTM Studio"`, `version = "0.0.1"`, `min_herdr_version = "0.8.2"`, `platforms = ["macos", "linux"]`, `[[startup]] command = ["./bin/lgtm", "serve", "--detach"]`, `[[actions]]` `id = "serve"`, `contexts = ["global"]` with the same command | Target `herdr-plugin.toml`; pattern Synapse `herdr-plugin.toml` lines 1-9 (Scout B Part A items 1, 3) |
| 1g | `bin/lgtm`: POSIX shell launcher choosing Node.js per row 22 and running the absolute path of `packages/cli/src/bin.ts` | Target `bin/lgtm`; pattern Synapse `bin/herdr-synapse` |
| 1h | Change the existing `third_party/t3code/mergeMessage.test.ts` import from `vite-plus/test` to `vitest` and record it in `third_party/t3code/README.md` | Existing `third_party/t3code/mergeMessage.test.ts` line 1 (architect finding 11) |
| 1i | `.gitignore`: `node_modules/`, test state folders, `*.sqlite*` under test folders | Target `.gitignore` |

**Design artifact:** none; no screen (row 8).

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Effect 4.0.5 or `node:sqlite` misbehaves on Node.js 26 | High | Criterion 1.3 runs first. If it fails, stop and report to the owner before any other unit; the fallback is Node.js `26.12.1`, the version T3 pins (Scout A item 9). |
| Herdr's manifest format changed since Synapse's | Medium | Criterion 1.4 on the owner's Herdr. |
| The launcher picks the wrong Node.js | Medium | Criterion 1.5 runs with an empty environment. |

**Verify:** criteria 1.1-1.3, 1.5, 1.6 by command; criterion 1.4 needs the owner's Herdr host (environment QA: two `herdr` commands).

**Rollout detail:** rollout step 2.

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
| 2.7 | Every copied file has been read for security problems | File `third_party/t3code/SECURITY-REVIEW.md` lists every copied file with "read, no findings" or its findings and the fix; criterion 2.5's script fails if a copied file is missing from it |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a | Copy `packages/effect-acp` whole (src, `_generated`, `scripts/generate.ts`, tests, `test/fixtures/acp-mock-peer.ts`) to `third_party/t3code/effect-acp/` as `@lgtm/t3-effect-acp`; dependencies `effect`, `@effect/platform-node`; dev dependencies `@effect/vitest`, `vitest`, `@types/node`, `@effect/openapi-generator`; fix the `extends` path | T3 `packages/effect-acp/src/client.ts:layerChildProcess` (1392), `src/agent.ts:AcpAgent` (34), `layerStdio` (557) (Scout A item 1; architect question 1) |
| 2b | Copy `packages/shared/src/nodeSqliteClient.ts` and its test to `third_party/t3code/node-sqlite/` as `@lgtm/t3-node-sqlite` | T3 `packages/shared/src/nodeSqliteClient.ts:layer` (Scout A item 4) |
| 2c | Copy `providerInstance.ts`, `secretReference.ts`, `TrimmedNonEmptyString` from `baseSchemas.ts`, `pathExpansion.ts`, `instanceEnvironment.ts`, `ClaudeHome.ts`, `CodexHomeLayout.ts` and its test, and `apps/server/src/provider/CodexManagedHome.ts` to `third_party/t3code/provider-instance/` as `@lgtm/t3-provider-instance`; replace `@t3tools/shared/HostProcess` with a local `HostProcess.ts` (`HomeDirectory`, `Platform`); replace `CodexSettings`, `ClaudeSettings` and `ProviderDriverKind` with a local `{ homePath, shadowHomePath }` type and a local brand | T3 `packages/contracts/src/providerInstance.ts:ProviderInstanceConfig`; `apps/server/src/provider/Drivers/CodexHomeLayout.ts:materializeCodexShadowHome` (236); `ClaudeHome.ts:makeClaudeEnvironment` (Scout A items 5, 6; architect finding 9) |
| 2d | Copy `packages/provider-testing/src/replayTranscript.ts` and `fakeCli.ts` to `third_party/t3code/provider-testing/` as `@lgtm/t3-provider-testing`; copy the replay schemas from T3 `packages/contracts/src/orchestrationV2.ts` lines 4176-4220 with their header type and `NonNegativeInt`; replace `HostProcess`; drop `TestProviderHost.ts` and `replayGate.ts` | T3 `packages/provider-testing/src/replayTranscript.ts:decodeProviderReplayNdjson`; `fakeCli.ts:writeFakeCli` (Scout A item 7; architect finding 9) |
| 2e | Move `third_party/t3code/mergeMessage.ts` and its test into `third_party/t3code/source-control/` as a package | Existing `third_party/t3code/mergeMessage.ts:removeAgentCredits` |
| 2f | Rewrite `third_party/t3code/README.md` as one table (package, file, T3 path, changes); extend `NOTICE` | Existing `third_party/t3code/README.md`, `NOTICE` |
| 2g | `scripts/check-credits.sh` (criteria 2.5, 2.7), added to the root `check` script | Target `scripts/check-credits.sh` |
| 2h | Security read of every copied file into `third_party/t3code/SECURITY-REVIEW.md` (row 39) | Target `third_party/t3code/SECURITY-REVIEW.md` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A copied file depends on behaviour T3 sets up elsewhere | Medium | Criteria 2.1-2.4 run T3's tests; 2.6 proves no T3 import remains. |
| Copied code has a security flaw | Medium | Criterion 2.7. |
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
| 3.1 | Every command (`start`, `prompt`, `answer`, `pass-up`, `ask`, `wait`, `stop`, `resume`, `compact`, `group`, `accounts`, `accounts set-secret`, `harnesses`, `subscribe`, `debug.compare-views`) has request and reply schemas with a request id | Test id: `packages/contracts/test/commands.test.ts` (the command list asserted equal to this list) |
| 3.2 | Every event round-trips through encode and decode unchanged | Test id: `packages/contracts/test/events-roundtrip.test.ts` (property test over every event tag) |
| 3.3 | The permission scale orders `read-only` < `ask` < `edit` < `full`, and every ACP permission option kind maps to a level | Test id: `packages/contracts/test/permission-scale.test.ts` |
| 3.4 | No schema can carry a secret value: secret-looking names (`*TOKEN*`, `*KEY*`, `*SECRET*`, `*PASSWORD*`) in an account's extra environment must be references | Test id: `packages/contracts/test/no-secret-values.test.ts` (schema walk plus decoding an account with `CURSOR_API_KEY: "abc"` fails) |
| 3.5 | The transition table answers every (lifecycle state, command) and (lifecycle state, event) cell, and the displayed states are derived as row 24 says | Test id: `packages/contracts/test/state-machine.test.ts` (enumerates every cell and asserts the table's answer) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a | `src/ids.ts`: branded `AgentId`, `EventSequence`, `RequestId`, `PermissionRequestId`, `QuestionId`, `WaitId`, `DeliveryId`, `AccountId`, `HarnessId`, `DeviceId`, `BootId` | Target `packages/contracts/src/ids.ts`; pattern T3 `providerInstance.ts:ProviderInstanceId` |
| 3b | `src/permission.ts`: the scale, compare, option-kind mapping (rows 35b) | Target `packages/contracts/src/permission.ts` |
| 3c | `src/stateMachine.ts`: lifecycle states with pause reasons, derived displayed states, the command and event tables (row 24) | Target `packages/contracts/src/stateMachine.ts`; spec "Changes after the plan review", "One state machine" |
| 3d | `src/events.ts`: one tagged union: agent started, session opened (session reference as a tagged union, row 44), prompt sent, thread item (text, plan, tool call, file change), turn started, turn ended, state changed, mode changed, mode refused, permission requested, permission answered, permission moved, permission cancelled, question asked, question answered, question moved, owner needed, wait opened, wait member resolved, wait satisfied, delivery queued, delivery sent, delivery accepted, delivery returned, delivery withdrawn, agent crashed, agent interrupted (with previous state), agent stopped, account changed, account needs sign-in, account available, harness changed, device added, device revoked, command refused | Target `packages/contracts/src/events.ts`; pattern T3 `Migrations/055_OrchestrationV2.ts` columns (Scout A item 3) |
| 3e | `src/commands.ts`: an `effect/rpc` `RpcGroup`, one `Rpc` per command, streaming `subscribe` | Target `packages/contracts/src/commands.ts`; pattern T3 `apps/server/src/ws.ts` line 108 imports and `packages/effect-acp/src/rpc.ts` |
| 3f | `src/accounts.ts` (LGTM Studio's own schema: harness, home path or secret reference, extra environment with the reference rule, enabled) and `src/harnesses.ts` (run mode, absolute adapter path and arguments, permission mapping, model and effort defaults) (rows 33, 39) | Target `packages/contracts/src/accounts.ts`, `harnesses.ts`; pattern `third_party/t3code/provider-instance/providerInstance.ts:ProviderInstanceConfig` |

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
| 4.4 | Views rebuilt from the log equal the live views, after every engine test | Test id: `packages/engine/test/views/rebuild.test.ts`; hook `packages/engine/test/support/rebuildCheck.ts`; guard test `packages/engine/test/support/every-file-registers-rebuild.test.ts` |
| 4.5 | A database write failure makes the engine refuse commands with a reason | Test id: `packages/engine/test/log/disk-failure.test.ts` |
| 4.6 | `debug.compare-views` returns no difference in a running service and returns the difference after a view is corrupted in a test build | Test id: `packages/engine/test/views/compare-views.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 4a.1 | One migration list for every table: `events` (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE, caller, request_id, agent_id, event_type, occurred_at, payload_json), `receipts` (caller, request_id, body_hash, result_json, first_sequence, PRIMARY KEY (caller, request_id)), `agent_tokens`, `devices`, `processes` (row 32) | Target `packages/engine/src/log/migrations.ts`; pattern T3 `Migrations/055_OrchestrationV2.ts` (`orchestration_v2_events`, `orchestration_v2_command_receipts`) |
| 4a.2 | `EventLog.append(caller, requestId, bodyHash, events, sideRows)`: one `withTransaction`, one writer behind a semaphore, WAL mode, receipt check inside the writer, text passed through the redactor (WS-5 5a.3) before insert | Target `packages/engine/src/log/EventLog.ts`; pattern T3 `apps/server/src/orchestration-v2/EventSink.ts` (`sql.withTransaction`, lines 716, 781), `third_party/t3code/node-sqlite` `layer` |
| 4b.1 | `subscribe(after)`: read up to the head, then switch to an in-memory `PubSub` of committed events, de-duplicating by sequence at the join | Target `packages/engine/src/log/subscribe.ts`; pattern T3 `OrchestrationEventStore.ts:streamProjectedApplicationEvents` (lines 111, 712) and its line-103 comment |
| 4c.1 | `Views`: pure `apply(view, event)` for agents, threads, requests, questions, waits, deliveries, accounts, devices; `rebuild` folds from sequence 1 | Target `packages/engine/src/views/`; pattern T3 `apps/server/src/orchestration-v2/ProjectionRecovery.test.ts` |
| 4c.2 | `compareViews` (used by `debug.compare-views`) and the rebuild hook and guard test (row 43) | Target `packages/engine/src/views/compare.ts`, `packages/engine/test/support/` |

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

Purpose: identity, the command handler, routing, waits and deliveries. Units:
5a identity, ceiling and redactor; 5b the lifecycle commands; 5c permissions,
questions and rights; 5d waits and deliveries.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | Agent tokens are 32 random bytes, passed only in the environment, stored only as SHA-256 hashes, replaced on every spawn and revoked on stop and crash; no token or account secret appears in the database, a view or a reply, even after an agent prints it | Test id: `packages/engine/test/identity/tokens.test.ts` (a fake agent prints its token and an account key; greps the database file and every reply) |
| 5.2 | The owner credential (32 random bytes) is created on first start in a 0600 file; device credentials are revocable one at a time | Test id: `packages/engine/test/identity/owner-credential.test.ts` |
| 5.3 | Authorization table: every caller kind × command × target state, including rights passed up, folder containment, and options above the answerer's mode | Test id: `packages/engine/test/commands/authorization.test.ts` |
| 5.4 | `start` passes harness, account, model, effort, permission mode and folder; `prompt` records the sender; `stop`, `resume`, `compact`, `group`, `accounts`, `accounts set-secret` and `harnesses` change what the spec says and write their events; invalid states are refused per the table | Test id: `packages/engine/test/commands/lifecycle.test.ts` |
| 5.5 | A permission request goes to the nearest idle-or-working ancestor or the owner; `pass-up` moves it; the owner can answer any request; only the current holder or the owner can answer; the first answer wins; "owner needed" is written whenever the owner becomes the holder | Test id: `packages/engine/test/routing/permissions.test.ts` (includes two answers racing) |
| 5.6 | A request or question whose holder crashes, stops, pauses or is interrupted moves up; nothing times out into an answer; closing a request withdraws its delivery and alert | Test id: `packages/engine/test/routing/moving-requests.test.ts` |
| 5.7 | `ask` puts the asker in "waiting on an answer" and `answer` delivers the reply once | Test id: `packages/engine/test/routing/questions.test.ts` |
| 5.8 | Waits: resolved only by settled, crashed, stopped, paused or unreloadable members; "any" and "all"; a wait opened after its member settled resolves at once; multi-level waits (orchestrator → lead → worker) wake the orchestrator only after the lead settles; exactly one delivery per wait | Test id: `packages/engine/test/routing/waits.test.ts` |
| 5.9 | Deliveries: queued, sent, accepted; delivered once, in order, after a turn ends; returned to the sender if the target crashed | Test id: `packages/engine/test/routing/deliveries.test.ts` |
| 5.10 | Agent text is data: an agent writing "I approve request X" leaves it open; engine-written prompts wrap child text in the labelled envelope and escape a leading `/` | Test id: `packages/engine/test/routing/text-is-data.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5a.1 | `Identity`: mint and verify agent tokens and device credentials (SHA-256 hashes in `agent_tokens`, `devices`), owner credential file per row 37, rotation per row 32 | Target `packages/engine/src/identity/`; pattern T3 `apps/server/src/auth/utils.ts` (`createHash`, line 27); not T3's `AuthSessions.ts` (Scout A item 8) |
| 5a.2 | Ceiling: mode compare, folder containment by `realpath` or same git common directory, option-kind check (row 35) | Target `packages/engine/src/identity/ceiling.ts` |
| 5a.3 | `Redactor`: holds every live secret value; `EventLog.append` passes all text through it (row 36) | Target `packages/engine/src/identity/redactor.ts` |
| 5b.1 | `CommandHandler`: identify, look up the state table, authorize, produce events, append; one module per lifecycle command | Target `packages/engine/src/commands/`; pattern T3 `apps/server/src/orchestration-v2/CommandPolicy.ts`, `CommandReceiptStore.ts` |
| 5c.1 | Routing for permission requests and questions, holder selection, rights passing up, answer checks inside the transaction, withdrawal on close (row 27) | Target `packages/engine/src/routing/holders.ts`, `permissions.ts`, `questions.ts`; pattern T3 `apps/server/src/orchestration-v2/DelegatedTaskQuestionReactor.ts` |
| 5d.1 | Waits with `since`, member resolution in the same transaction as the resolving event, recovery re-check (row 25) | Target `packages/engine/src/routing/waits.ts`; pattern T3 `apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts` |
| 5d.2 | Deliveries with the three steps and the envelope (rows 29, 38) | Target `packages/engine/src/routing/deliveries.ts`, `envelope.ts` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An agent acts on an agent it has no rights over | High | Criterion 5.3's table; attack pass on 5a, 5c. |
| Two answers race and both take effect | High | Holder and open checks inside the single-writer transaction; criterion 5.5 races them. |
| A secret leaks into thread text | High | The redactor sits inside `append`; criterion 5.1 makes the agent print secrets. |
| A wake is lost or repeated | High | Criterion 5.8's cases, including the late-open and multi-level ones; recovery re-check (6.7). |

**Verify:** criteria 5.1-5.10; environment QA: none.

**Rollout detail:** rollout step 6.

**WS-6: Agents that run, report and recover**

Purpose: the ACP runner, accounts, and failures and recovery. Units: 6a runner
core, 6b accounts, 6c failures and recovery.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | Starting an agent spawns its adapter from the harness's absolute path, in a new process group, with exactly the allow-listed environment plus the account's variables and `LGTM_SOCKET`, `LGTM_TOKEN`; `session/new` gets the `lgtm mcp` server with `process.execPath` and an absolute script path; the session id is recorded | Test id: `packages/engine/test/runner/start.test.ts` (the fake agent echoes its environment, its arguments and the `mcpServers` it received; asserts the exact set and no `HERDR_*`) |
| 6.2 | Streamed text, plans, tool calls and file changes become thread events in order; replays of real sessions produce the expected events | Test ids: `packages/engine/test/runner/stream.test.ts`; `packages/engine/test/runner/replay.test.ts` over `packages/testing/fixtures/*.ndjson` |
| 6.3 | A permission request holds the agent until answered, then releases it with the chosen option | Test id: `packages/engine/test/runner/permission-hold.test.ts` |
| 6.4 | `compact` sends the harness's compact command when advertised, else is refused with a reason | Test id: `packages/engine/test/runner/compact.test.ts` |
| 6.5 | "Any account" picks per row 28, refuses when none is usable; a second Codex account gets a shadow home | Test ids: `packages/engine/test/accounts/pick.test.ts`, `packages/engine/test/accounts/codex-shadow-home.test.ts` |
| 6.6 | A crash records the exit code and the last error lines with secrets removed; open requests are cancelled; waiters get one delivery with "crashed"; the parent is told, or "owner needed" for an owner-started agent; no restart | Test id: `packages/engine/test/recovery/crash.test.ts` |
| 6.7 | Restart follows row 31's order: leftover groups are stopped first; running agents are marked interrupted with their previous state; open requests close; reloadable agents get new tokens; unaccepted deliveries are re-sent before carry-on prompts; only mid-turn agents get a carry-on; non-reloadable agents stay interrupted; waits are re-checked; the socket opens last | Test id: `packages/engine/test/recovery/restart.test.ts` |
| 6.8 | The leftover sweep stops a recorded group only when boot id, start time, user and executable match and the group id is greater than 1 and not the engine's | Test id: `packages/engine/test/recovery/orphans.test.ts` (Linux; the macOS branch runs only on a macOS host and is otherwise reported as skipped) |
| 6.9 | Signed-out and out-of-usage errors are told apart for each harness | Test id: `packages/engine/test/runner/classify-errors.test.ts` over `packages/testing/fixtures/errors/` |
| 6.10 | Failure rule 5: a signed-out account writes "account needs sign-in" and "owner needed" and pauses its agents; an out-of-usage agent pauses with its reset time; "account available" at that time returns paused agents to idle and releases their deliveries | Test id: `packages/engine/test/accounts/pause-and-return.test.ts` (clock controlled with Effect's `TestClock`) |
| 6.11 | A `harnesses` override changes the spawned path and arguments; the permission mapping is applied; the model and effort reach the adapter (`session/set_model` or the harness's documented argument) | Test id: `packages/engine/test/runner/harness-settings.test.ts` |
| 6.12 | The engine advertises no file or terminal capability, and `fs/*` and `terminal/*` requests are refused | Test id: `packages/engine/test/runner/no-client-capabilities.test.ts` |
| 6.13 | An adapter-reported mode change above the ceiling is set back and recorded | Test id: `packages/engine/test/runner/mode-ceiling.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6a.1 | `Runner` interface per row 44 | Target `packages/engine/src/runner/Runner.ts` |
| 6a.2 | `AcpRunner`: spawn with `effect/process` `ChildProcessSpawner` (detached process group, `extendEnv: false`), connect `AcpClient` via `layerChildProcess`, `initialize` with no client capabilities, `session/new` with `mcpServers`, record capabilities; keep reading the child's stderr | Target `packages/engine/src/runner/AcpRunner.ts`; pattern `third_party/t3code/effect-acp/src/client.ts:layerChildProcess` (1392), `make` (755); T3 `AcpSessionRuntime.ts` lines 1447 (detached) and 1766-1772 (capabilities off) |
| 6a.3 | Translate `session/update` to events | Target `packages/engine/src/runner/translate.ts`; reference T3 `packages/provider-acp/src/server/runtimeModel.ts:parseSessionUpdateEvent` (1350) (read, not copied) |
| 6a.4 | Permission hold with a `Deferred` scoped to the agent; option kinds mapped per row 35b | Target `packages/engine/src/runner/permissions.ts` |
| 6a.5 | Compact via advertised commands; mode changes checked against the ceiling | Target `packages/engine/src/runner/compact.ts`, `modes.ts` |
| 6b.1 | Accounts: allow-listed base environment (row 33), the copied `mergeProviderInstanceEnvironment` with that base, secrets from `secrets.json` (rows 19, 40), shadow home via `materializeCodexShadowHome`; picker and "account available" timer (row 28) | Target `packages/engine/src/accounts/`; pattern `third_party/t3code/provider-instance/instanceEnvironment.ts:mergeProviderInstanceEnvironment`, `CodexHomeLayout.ts:materializeCodexShadowHome` |
| 6b.2 | Harness defaults with absolute paths resolved at install: Claude `@agentclientprotocol/claude-agent-acp` 0.99.1 and Codex `@agentclientprotocol/codex-acp` 2.5.0 from `node_modules/.bin`, Gemini `gemini --acp`, Cursor `agent acp` from the owner's install (rows 18, 39) | Target `packages/engine/src/runner/harnesses.ts`; Scout B items 5-7; planner's Cursor check |
| 6c.1 | Crash handling per criterion 6.6 | Target `packages/engine/src/recovery/crash.ts`; pattern T3 `packages/provider-acp/src/server/stderr.ts` |
| 6c.2 | Restart per row 31 | Target `packages/engine/src/recovery/restart.ts`; pattern `third_party/t3code/effect-acp/src/client.ts:loadSession` (91) |
| 6c.3 | Leftover sweep with the boot id (`/proc/sys/kernel/random/boot_id` on Linux, `sysctl kern.boottime` on macOS), start time, user and executable checks | Target `packages/engine/src/recovery/orphans.ts`; pattern T3 `packages/provider-core/src/server/processGroup.ts` (line 8, `process.kill(-pid)`) |
| 6c.4 | Error classification | Target `packages/engine/src/runner/classify.ts` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Real adapters differ from the fake agent | High | Criterion 6.2 replays recorded sessions; the live check re-records them. |
| The Codex adapter cannot reload sessions | Medium | Capabilities read at run time; criterion 6.7 covers the non-reloadable path. |
| The sweep signals an unrelated process | High | Criterion 6.8's guards. |
| Out-of-usage error text changes between versions | Medium | Adapters pinned; unrecognised errors are reported as crashes with their text, never retried. |
| The model or effort cannot be set through ACP for some harness | Medium | Criterion 6.11 records each harness's mechanism; an unsupported one is refused at `start` with the reason. |

**Verify:** criteria 6.1-6.13; environment QA: criterion 6.8 on Linux, and on macOS only if the owner has a Mac host.

**Rollout detail:** rollout steps 7 and 8.

**WS-7: One door for agents and the owner**

Purpose: the server, the service lifecycle, the shared client, the
command-line tool and the tool server. Units: 7a the server and service, 7b
the client, command-line tool and tool server.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 7.1 | The state folder is created 0700 with umask 077; the service refuses to start if the folder is not owned by its user or not 0700; every file in it is 0600; the socket is the only listener and there is no TCP listener | Test id: `packages/engine/test/api/state-folder.test.ts` |
| 7.2 | An upgrade without a credential, with a revoked one, or with a malformed one is refused before any RPC message; revoking a credential closes its open connections | Test id: `packages/engine/test/api/auth.test.ts` |
| 7.3 | For every event type: an agent's `subscribe` returns only events of itself and its children; agent-less events are owner-only | Test id: `packages/engine/test/api/subscribe-visibility.test.ts` |
| 7.4 | `lgtm serve --detach` starts one service; a second call reports the running one and exits 0; a test uses its own `LGTM_HOME` and never touches the owner's | Test id: `packages/cli/test/serve.test.ts` |
| 7.5 | Every RPC is a `lgtm` subcommand and an MCP tool, both through `packages/client` | Test id: `packages/cli/test/parity.test.ts` (lists the contracts' `RpcGroup`) |
| 7.6 | `lgtm wait --block` exit codes per row 26, including the early return when a request is routed to the caller | Test id: `packages/cli/test/wait-exit-codes.test.ts` |
| 7.7 | The command-line tool strips terminal control characters from thread text | Test id: `packages/cli/test/control-chars.test.ts` |
| 7.8 | `lgtm mcp` gets its token from the environment only, never from its arguments | Test id: `packages/mcp/test/token-source.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 7a.1 | Node.js HTTP server listening on `engine.sock`, WebSocket upgrade with the credential checked on upgrade, `RpcServer.makeProtocolWithHttpEffectWebsocket` per connection, revocation closing connections (row 48) | Target `packages/engine/src/api/server.ts`; pattern T3 `apps/server/src/ws.ts` lines 3293-3330, 3360-3367 |
| 7a.2 | Service entry running row 31's order, then the server | Target `packages/engine/src/service.ts` |
| 7a.3 | `serve --detach`: spawn detached, `unref`, report the running service when the lifetime lock is held (row 31) | Target `packages/cli/src/serve.ts`; pattern Synapse `herdr_team/daemon.py` (double fork, lock; Scout B item 3) |
| 7b.1 | `packages/client`: the RPC client over the socket, reading `LGTM_SOCKET` and `LGTM_TOKEN`, or the owner credential file | Target `packages/client/src/` |
| 7b.2 | `lgtm` command-line tool: one subcommand per RPC, `wait --block`, `accounts set-secret` reading standard input without echo, control-character stripping | Target `packages/cli/src/bin.ts`, `packages/cli/src/commands/` |
| 7b.3 | `lgtm mcp`: stdio MCP server, one tool per RPC, using `effect/ai`; check first that 4.0.5 has a stdio transport (`McpServer.layerStdio` exists in an Effect 4 beta, architect question 4), else serve MCP over the same Unix socket with the agent token | Target `packages/mcp/src/server.ts`; pattern T3 `apps/server/src/mcp/McpHttpServer.ts` (imports `effect/ai`) |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An unauthenticated or under-authorised way in | High | Criteria 7.1-7.3; attack pass on 7a, 7b. |
| A harness sandbox blocks the agent's tool server from reaching the socket | Medium | Post-build check PB-A3; if a sandbox blocks it, the harness setting adds the socket folder to the sandbox's allowed paths, recorded per harness. |
| The service stops and nothing restarts it | Medium | `serve --detach` is safe to repeat and is a Herdr action; recovery makes restarting safe; supervision is a later piece's concern. |

**Verify:** criteria 7.1-7.8; environment QA: on the owner's Herdr host, the startup hook starts the service once (criterion 1.4's host).

**Rollout detail:** rollout step 9.

**WS-8: Proof that the Foundry needs nothing else**

Purpose: the fake agent, the recorded sessions, the acceptance suite and the
live check. Units: 8a fake agent, replay and the fixture recorder; 8b the
acceptance suite; 8c the live check.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 8.1 | The fake agent follows a script (text, plan, tool call, file change, permission request with option kinds, question, mode change, end turn, crash, out of usage, signed out, slow turn, print environment) over real ACP | Test id: `packages/testing/test/fake-agent.test.ts` |
| 8.2 | The fixture recorder scrubs secrets and produces replayable files | Test id: `packages/testing/test/recorder-scrubs.test.ts`; on-device step: owner runs `pnpm record-fixtures` before unit 6a and it exits 0 |
| 8.3 | One acceptance test per capability, through the public socket only, with real tokens and the owner credential | Test ids: `packages/engine/test/acceptance/capability-01-start.test.ts` to `capability-12-accounts.test.ts` |
| 8.4 | One acceptance test per failure rule; failure 2 runs the service as a child process and sends it `SIGKILL` mid-turn | Test ids: `packages/engine/test/acceptance/failure-1-crash.test.ts` to `failure-8-disk.test.ts` |
| 8.5 | The spec's "One request, start to finish" passes end to end; every acceptance test ends with `debug.compare-views` reporting no difference | Test id: `packages/engine/test/acceptance/flow-start-to-finish.test.ts`; harness `packages/engine/test/support/acceptance.ts` |
| 8.6 | The live check passes once on the owner's accounts | On-device step: owner runs `pnpm live-check` on the Herdr host with one Claude Code and one Codex account; it runs flow 8.5 on the real adapters, prints each step, re-records the fixtures, and exits 0 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 8a.1 | Fake agent on `AcpAgent.layerStdio`, reading a JSON script from an environment variable | Target `packages/testing/src/fakeAgent.ts`; pattern `third_party/t3code/effect-acp/src/agent.ts:layerStdio` (557), `test/fixtures/acp-mock-peer.ts` |
| 8a.2 | Replay player in T3's NDJSON format | Target `packages/testing/src/replay.ts`; pattern `third_party/t3code/provider-testing/replayTranscript.ts:decodeProviderReplayNdjson` |
| 8a.3 | Fixture recorder `pnpm record-fixtures` (row 42), with scrubbing | Target `packages/engine/scripts/record-fixtures.ts` |
| 8b.1 | Acceptance harness in `packages/engine/test/support/acceptance.ts` (row 23) | Target `packages/engine/test/support/acceptance.ts` |
| 8b.2 | The twenty-one acceptance files | Target `packages/engine/test/acceptance/` |
| 8c.1 | `pnpm live-check`, never part of `pnpm check` | Target `packages/engine/scripts/live-check.ts` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The suite passes on the fake but the real adapters differ | High | Recorded fixtures before 6a (8.2) and the live check (8.6). |
| Recording and the live check spend real usage | Medium | Both are owner-run, never in `pnpm check`, and use one tiny prompt per harness. |
| A timing test is flaky | Medium | Tests wait on events, never on sleeps; clocks use `TestClock`; no retries. |

**Verify:** criteria 8.1, 8.3-8.5 by test; 8.2 and 8.6 need the owner's host and accounts (environment QA).

**Rollout detail:** rollout steps 5 (8a), 7 (recording), 10 (8b) and 11 (8c).

**Post-build checks**

| Id | Scenario | Expected result | Evidence | Area |
|---|---|---|---|---|
| PB-A1 | Stop and crash an agent whose adapter started child processes | The whole process group exits | `ps` output before and after, in the unit 6c report | WS-6 |
| PB-A2 | An adapter writes a lot to stderr | The runner keeps draining it; the agent does not hang | Test with a fake agent writing 10 MB to stderr | WS-6 |
| PB-A3 | Each harness's sandbox, with `lgtm mcp` connecting to the socket | The tool call succeeds, or the harness setting that allows it is recorded | Live-check log per harness | WS-7 |
| PB-A4 | Search each adapter's own session files for the agent token | Not found | `grep` over the adapters' session folders after the live check | WS-6 |
| PB-A5 | `subscribe` catch-up uses the read-only connection deliberately | The reader setting is chosen and commented | Code review note in unit 4b | WS-4 |
| PB-A6 | Type-check the copied code with the TypeScript version T3 uses | No new errors | Command output in the unit 2 report | WS-2 |
| PB-A7 | After a restart, a reloaded agent's old token | Refused | Covered by criterion 6.7; confirmed on real adapters in the live check | WS-6 |
| SEC-PB-1 | Search real adapters' files and process arguments for the token | Not found | Live-check log | WS-6 |
| SEC-PB-2 | A child's text beginning with `/compact` reaches its parent | It arrives escaped and runs no command | Live-check log | WS-5 |
| SEC-PB-3 | Each real adapter's permission option kinds | Each maps onto LGTM Studio's scale | Recorded fixtures, unit 6a report | WS-6 |

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (a) the spec `docs/specs/2026-11-01-engine-design.md`,
including its "Changes after the plan review": the twelve capabilities, the
six parts, accounts, the states, the eight failure rules, the six kinds of
test, the five copy rows, the security section, and every amendment; (b)
`decisions.md` rows 1-48; (c) round 1 findings, `attack/round-1-findings.md`.

| Source item | Workstream | Status |
|---|---|---|
| Capability 1, start an agent | WS-5 (5b, 5.4), WS-6 (6a, 6.1, 6.11); acceptance 8.3 | mapped |
| Capability 2, agents start agents, ceiling | WS-5 (5a, 5.3) | mapped |
| Capability 3, prompt with sender | WS-5 (5.4) | mapped |
| Capability 4, state and changes | WS-3 (3.5), WS-4 (4c), WS-7 (7.3) | mapped |
| Capability 5, wait without polling | WS-5 (5d, 5.8), WS-7 (7.6) | mapped |
| Capability 6, read any thread live | WS-4 (4b, 4.3), WS-7 (7a, 7.3) | mapped |
| Capability 7, permission routing | WS-5 (5c, 5.5, 5.6), WS-6 (6.3) | mapped |
| Capability 8, reach the owner | WS-5 (5.5, 5.6), WS-6 (6.6, 6.10) | mapped |
| Capability 9, talk to any agent remotely | WS-7 (owner credential, 7.2) | mapped |
| Capability 10, stop, resume, compact | WS-5 (5.4), WS-6 (6.4, 6.7) | mapped |
| Capability 11, group agents | WS-5 (5.4) | mapped |
| Capability 12, several accounts | WS-6 (6b, 6.5, 6.10), WS-2 (2c), WS-5 (`accounts set-secret`) | mapped |
| Part 1, event log | WS-4 (4a, 4b) | mapped |
| Part 2, views | WS-4 (4c) | mapped |
| Part 3, command handler, `harnesses` | WS-5 (5b, 5.4), WS-6 (6.11) | mapped |
| Part 4, agent runner | WS-6 (6a) | mapped |
| Part 5, identity | WS-5 (5a) | mapped |
| Part 6, the doors | WS-7 | mapped |
| States and the state machine | WS-3 (3c, 3.5) | mapped |
| Failure rule 1 | WS-6 (6.6); 8.4 | mapped |
| Failure rule 2 | WS-6 (6.7); 8.4 | mapped |
| Failure rule 3 | WS-4 (4.1, 4.2) | mapped |
| Failure rule 4 | WS-5 (5.6) | mapped |
| Failure rule 5 | WS-6 (6.9, 6.10) | mapped |
| Failure rule 6 | WS-5 (5.9) | mapped |
| Failure rule 7 | WS-6 (6.8) | mapped |
| Failure rule 8 | WS-4 (4.5) | mapped |
| Test kinds 1-6 | WS-8 (8a, 8.2, 8b, 8c), WS-4 (4.4, 4.6), every WS | mapped |
| Copy rows | WS-2 (event store: shape only, row 13) | mapped |
| Security section and SECURITY.md rules 1, 2, 4, 6, 7 | WS-7 (7.1, 7.2), WS-5 (5.1, 5.2, 5.10), WS-3 (3.4), WS-6 (6.1, 6.12) | mapped |
| Amendments: endpoint, state machine, waits, holders, pauses, deliveries, receipts, start-up order, what agents are given | WS-7 (rows 21, 48), WS-3 (24), WS-5 (25-27, 29, 38), WS-6 (28, 31-35), WS-4 (30, 36) | mapped |
| Open: what agents can read | Row 47; owner ruling; overview item 3 | mapped |
| Decisions 1-48 | Key decisions and the rows cited in each WS | mapped |
| Round 1 findings | `attack/round-1-findings.md` outcomes column | mapped |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: never push to or open a pull request against `vitalysim/herdr-synapse` | No push at all without the owner (row 17). |
| `AGENTS.md` rule 2: credit every piece of copied code | WS-2 tasks 2a-2h, criteria 2.5 and 2.7; commit messages name the T3 file (conventions paragraph). |
| `AGENTS.md` rule 3: keep `docs/features.md` and `docs/issues.md` current | Conventions paragraph; every scope may edit `docs/issues.md` (row 46). |
| `AGENTS.md` rule 4 and SECURITY.md's binding rules | Rows 21, 33-38, 47, 48; criteria 3.4, 5.1, 5.2, 5.10, 6.1, 6.12, 6.13, 7.1-7.3, 7.8. |
| `AGENTS.md` rule 5: the client API is the product's surface | Criterion 7.5; `accounts set-secret` through the API (row 40). |
| `AGENTS.md` rule 6: team shapes do not belong here | No roles or team definitions (row 4). |
| `AGENTS.md` rule 7: do not commit or push unless the owner asks | Row 17; overview item 2. |
| `AGENTS.md` "Language": Effect 4 looked up; Node.js 26 | Conventions paragraph; criteria 1.1, 1.5. |
| `AGENTS.md` "Status": no application code until the design is approved | The design is approved; the lead updates the section before unit 1 (row 46). |
| `AGENTS.md` "Writing style for documents" | READMEs and reviews in WS-2; abbreviations expanded in the conventions paragraph. |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its harness-session skill)
at launch; this section names none (owner, 2026-10-16).

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1 Skeleton, manifest, launcher | infra | engine/infra | medium | Several config files on T3's pattern, one launcher, one environment check. | no | owner steps 1 |
| 2 Copied T3 packages and review | infra | engine/infra | medium | Copying with import replacement, credit and a security read; T3's tests prove it. | no | 1 |
| 3 Shared definitions and state machine | contracts | engine/contracts | medium | New schemas whose shapes the amended spec fixes. | no | 2 |
| 4a Event log | backend | engine/backend | medium | One writer, transactions, receipts on the copied SQLite client. | no | 3 |
| 4b Subscribe without gaps | backend | engine/backend | high | Concurrency at the catch-up-to-live join. | no | 4a |
| 4c Views, rebuild check, compare | backend | engine/backend | medium | Pure fold functions over a fixed event list. | no | 4a |
| 5a Identity, ceiling, redactor | backend | engine/backend | high | Authentication, credential storage and secret handling. | yes | 4a |
| 5b Lifecycle commands | backend | engine/backend | medium | One module per command on a fixed handler and state table. | no | 5a, 4c |
| 5c Permissions, questions, rights | backend | engine/backend | high | Holder selection and answer races. | yes | 5b |
| 5d Waits and deliveries | backend | engine/backend | high | Exactly-once wakes across transactions and restarts. | no | 5c |
| 8a Fake agent, replay, recorder | backend | engine/backend | medium | Built on the copied ACP agent and replay code. | no | 3 |
| 6a Runner core | backend | engine/backend | high | Child processes, streaming and held requests across a protocol boundary. | no | 5d, 8a, owner fixture recording |
| 6b Accounts | backend | engine/backend | medium | Environment assembly on copied code, picker, timer. | no | 6a |
| 6c Failures and recovery | backend | engine/backend | high | Restart order and process cleanup that can affect other programs. | no | 6a, 6b |
| 7a Server and service | backend | engine/backend | high | The engine's only entry point and its authentication. | yes | 4b, 5d, 6b, 6c |
| 7b Client, command-line tool, tool server | backend | engine/backend | medium | Thin wrappers over one RPC group. | yes | 7a |
| 8b Acceptance suite | backend | engine/backend | medium | Twenty-one tests on one harness pattern. | no | 7b, 8a |
| 8c Live check | backend | engine/backend | low | One script, run by the owner. | no | 8b |

Load: 18 build units. Following the sheet's builder and test-writer tables
for these work areas and complexities, roughly 12 builds land on the OpenAI
vendor and 6 on the Anthropic vendor, with test writers on the opposite
vendor (about 12 Anthropic and 6 OpenAI), plus one focused review per unit
(18) and a cyber attacker and verifier for each of the four attack-pass
units (8). That is roughly 31 OpenAI and 37 Anthropic launches over the
build. The planner cannot read the remaining weekly allowance; the lead
checks each vendor's remaining limit before launching and schedules units 6a
to 8b later if either vendor would run out (known gap 1).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|
| 1 | 2 / 31 / 13 | All four lenses REVISE. Folded into plan v2 and the spec amendment; one BLOCKER (security 1) awaits the owner's ruling (row 47) with a written assumption; commits await the owner (row 17). Details: `attack/round-1-findings.md`. |

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
| 15 | How do agents reach LGTM Studio's tools over MCP? | A stdio MCP server, `lgtm mcp`, started by the agent's adapter from the ACP `session/new` `mcpServers` list, holding that agent's token and acting as a thin client of the engine API. Built with `effect/ai`'s MCP server, as T3 Code's `apps/server/src/mcp` is. If `effect/ai` 4.0.5 has no stdio transport, fall back to an HTTP MCP endpoint on the loopback address, like T3's `McpHttpServer.ts`, still authenticated by the agent token. | Stdio needs no extra listening port (SECURITY.md rule 1) and every ACP agent must support stdio MCP servers. | closed | 2026-11-01 |
| 16 | How is the engine API carried? | `effect/rpc`: one `RpcGroup` of commands plus a streaming `subscribe`, served over a WebSocket on 127.0.0.1, every message decoded with Effect Schema. Each connection presents a credential before any other message. | Spec, "The doors" (chosen in spec, accepted with the spec). `effect-acp` already uses `effect/rpc` (Scout A, item 1 imports). | closed | 2026-11-01 |
| 17 | May agents commit during execution? | Assumption: no commit and no push until the owner says so. Workers leave changes in their worktrees; the lead reports what is ready. | `AGENTS.md` rule 7: "Do not commit or push unless the owner asks." The owner has not yet asked. To be raised at the plan handoff. | unanswered | 2026-11-01 |
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
| 47 | Threat model: are agents trusted with the owner's files? (security BLOCKER 1, finding 10) | Owner ruling needed. Assumption until answered: agents run as the owner's Unix user and can read LGTM Studio's state folder, so the permission ceiling stops mistakes, not a deliberately hostile agent; this is written in SECURITY.md. The cheap hardening is added regardless: each harness that supports it gets a rule denying reads of the state folder (Claude Code `permissions.deny`, Cursor CLI permissions), tested per harness. Stronger options for the owner: OS keyring for the owner credential, or agents run as a separate Unix user. | A same-user process can read 0600 files; Codex's read-only sandbox reads the whole filesystem. | unanswered | 2026-11-01 |
| 48 | Correction to row 21: how the socket is served and authenticated | The engine runs a Node.js HTTP server listening on the Unix socket path and upgrades connections to WebSocket, then serves `effect/rpc` with `RpcServer.makeProtocolWithHttpEffectWebsocket`, as T3 Code's `apps/server/src/ws.ts` does (lines 3293-3330). The credential is checked on the upgrade request (`Authorization: Bearer`), before any RPC message; revoking a credential closes its live connections (T3 `ws.ts` lines 3360-3367). There is no peer user-id check: Node.js does not expose the peer's credentials, so the 0700 state folder is what limits connections to the owner's user. Piece 2 adds a TCP listener to the same server. | Architect finding 8 (authenticate on upgrade); Node.js `net` has no portable peer-credential API. Supersedes the peer-check wording in row 21. | closed | 2026-11-01 |
