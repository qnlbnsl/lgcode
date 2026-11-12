---
topic: lgtm-engine
status: self-check
tier: L
created: 2026-11-01
updated: 2026-11-01
epic: lgtm-foundation
---

# Build the LGTM Studio engine

## Overview

This plan builds the first of LGTM Studio's four pieces: the engine. The engine
is a background service that the Herdr plugin starts. It runs coding agents
(Claude Code, Codex, Gemini CLI and Cursor) over the Agent Client Protocol
(ACP), keeps a complete, numbered record of everything they do, and offers one
authenticated connection through which agents and the owner's devices start,
prompt, watch, approve, wait on, stop and resume agents. Today none of this
exists: the LGTM Studio repository holds only documents, one copied T3 Code file,
and the approved design in `docs/specs/2026-11-01-engine-design.md`.

The engine is finished when the Foundry skill needs nothing else from it. The
design turned that into twelve capabilities and eight rules for failures.
This plan proves them with an acceptance suite: one test for each capability
and each failure rule, all driven through the same connection that agents
and devices use, against a scripted fake agent that speaks real ACP. A last
check runs the main flow once against the real Claude Code and Codex
adapters on the owner's accounts.

The plan copies a large part of the work from T3 Code, which is MIT-licensed
and written with the same library, Effect. The scouting found that T3's ACP
client, its SQLite code, its account settings and its test helpers can be
copied with credit. Three parts cannot: T3's agent runner is tied to 28 other
T3 modules, its event store is tied to T3's own data types, and its login
tables appear to store credentials in plain text, which LGTM Studio's security
rules forbid. LGTM Studio writes those three itself.

The work is split into eight workstreams and seventeen units, built in order:
the project skeleton, the copied code, the shared definitions, the record,
the permission rules, the agent runner, the connection, and the proof. Most
units can be built and reviewed on their own, because each part of the engine
talks to the others only through its interface.

Two things need the owner. First, the repository's rules say not to commit
unless the owner asks, so the plan assumes nothing is committed until the
owner says so; building seventeen units without commits means every change
waits in a worktree. Second, the last check spends real usage on the owner's
Claude Code and Codex accounts, so the owner runs it by hand.

## Key decisions

- **Node.js 26, with pnpm.** The owner chose Node.js 26, the current long-term
  support line. The `.nvmrc` file says `26`. T3 Code's copied SQLite code
  uses Node.js's own SQLite module, and the Claude Code adapter needs Node.js,
  so a single file built with Bun would not have saved an install step.
- **Copied code stays in its own packages.** Each piece copied from T3 Code
  lives under `third_party/t3code/`, with T3's licence and a note naming the
  exact commit and files. LGTM Studio's own code imports it by package name, so
  it is always clear which code is T3's.
- **The adapters are pinned, not downloaded each time.** The Claude Code and
  Codex ACP adapters are installed at exact versions with LGTM Studio. Starting
  an agent never downloads code. Gemini CLI and Cursor are used from the
  owner's own install. The owner can change any harness's command through the
  API.
- **Agents reach LGTM Studio through a small tool server.** Each agent's adapter
  starts `lgtm mcp`, which offers LGTM Studio's commands as tools and speaks
  to the engine with that agent's own token. It opens no extra network port.
- **Account secrets live in one owner-only file.** An account stores a
  reference to its secret, never the secret. The value is read only when an
  agent starts and never reaches the record or any client.
- **Nothing is committed until the owner says so.** This is an assumption
  from the repository's rules and needs the owner's answer before building
  starts.

Full log → `decisions.md`

## Workstreams

### A project skeleton on Node.js 26

The repository becomes a pnpm workspace on Node.js 26, with TypeScript set up
as T3 Code sets it up, Effect 4.0.5, Vitest, and a single command that runs
type checks and tests. It also gets the Herdr plugin manifest, so Herdr can
start LGTM Studio. The risk is a version mismatch between Node.js 26, Effect
4.0.5 and Node.js's SQLite module; a first test opens a database to catch
that on day one. When this is done, `pnpm check` passes on an empty project
and Herdr lists LGTM Studio as a plugin.

### T3 Code's ACP client and helpers, copied with credit

T3 Code's ACP client, its SQLite client, its account settings and the Codex
"shadow home", and its replay test helpers are copied into
`third_party/t3code/`, each with its licence, source commit and list of
changes. Where a copied file imports another T3 module, that import is
replaced with a small LGTM Studio equivalent, and the change is recorded. The
risk is that a copied file quietly depends on something T3 sets up
elsewhere; running T3's own tests for the copied code catches that. When
this is done, the copied ACP client's own tests pass in LGTM Studio's
repository, and the NOTICE file lists every copied file.

### One shared definition of every command, event and state

Every command, event, agent state, account, harness setting and the
permission scale is written once as an Effect schema. The engine, the
command-line tool, the tool server and the future phone app all use these
definitions, so they cannot disagree about the shape of a message. The risk
is getting a definition wrong early and having to change it everywhere; the
definitions follow the approved spec's tables exactly, and a test checks
that every event can be written and read back unchanged.

### A record that is never half-written

The event log stores every event in SQLite with a sequence number, writes
each command's events in one transaction, and lets any client ask for
"everything after event N" followed by every new event, with no gap and no
duplicate. The views rebuild the current picture from the log alone. The
main risk is a gap between catching up and going live, where an event
written at that moment is missed; a test writes events while a subscriber is
catching up and checks that every number arrives exactly once. A second
check rebuilds the views from the log after every test and compares them
with the live views.

### Who may do what, and where each request goes

Each agent gets its own token, stored only as a hash. The owner's terminal
gets its own credential on first start, saved in a file only the owner can
read. The command handler checks every command against who is asking:
parents act only on their own children, and no agent can give another a
wider permission mode than its own. Permission requests go to the agent that
started the asker, can be passed up to the owner, and the first answer wins.
Waits wake the waiting agent once, and messages for a busy agent wait for its
turn to end. This is the most security-sensitive part, so every rule has its
own test, and the security reviewer examines it before it is merged.

### Agents that run, report and recover

The runner starts each harness's ACP adapter with the right account's home
directory or API key, the agent's token and LGTM Studio's tool server. It turns
everything the agent streams into events, holds the agent while a permission
request is open, and sends `/compact` where the harness offers it. Accounts
can be named or picked automatically, with signed-out and out-of-usage
accounts skipped. After a crash, the runner reports and does not restart.
After an LGTM Studio restart, it reloads sessions, prompts only the agents that
were mid-turn, and stops any leftover adapter processes. The risk is that
each adapter behaves slightly differently; recorded real sessions from Claude
Code and Codex are replayed in tests to catch that.

### One door for agents and devices

The engine serves its API over a WebSocket on the loopback address, and
every connection must present a credential before anything else. The
`lgtm` command-line tool and the `lgtm mcp` tool server are thin
clients of that API. Herdr starts the service once at startup; the service
keeps itself running, refuses to start twice, and stores its files in the
plugin state folder Herdr provides. The risk is an unauthenticated path into
the engine; a test connects without a credential, with a revoked one, and
from an agent token asking for another agent's thread, and each must be
refused.

### Proof that the Foundry needs nothing else

A scripted fake agent that speaks real ACP plays any scenario on cue:
streaming text, calling tools, asking permission, crashing, running out of
usage or being signed out. The acceptance suite has one test for each of the
twelve capabilities and each of the eight failure rules, including killing
the service mid-turn and restarting it. The owner then runs one live check
against real Claude Code and Codex agents. When this is done, the engine
meets the definition of done in the spec.

## Rollout order

1. Build the project skeleton first, because every other unit needs the
   workspace, the toolchain and the test command.
2. Copy the T3 Code packages next, because the record, the runner and the
   fake agent are built on them.
3. Write the shared definitions, because every later unit uses them.
4. Build the record and the fake agent side by side; they do not depend on
   each other.
5. Build the permission rules on top of the record.
6. Build the runner and accounts, which need the record, the rules and the
   copied ACP client.
7. Build the API server, the command-line tool and the tool server last
   among the parts, because they expose everything else.
8. Write the acceptance suite, then run the whole of it.
9. The owner runs the live check by hand on real accounts. It spends usage.

Nothing is deployed and nothing is irreversible. Each step's changes stay in
worktrees until the owner says to commit (decision 17).

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

Conventions for every unit. Paths are relative to the LGTM Studio repository
root. Anchors in the "T3" column refer to T3 Code at commit
`6fc9144a60c4a5f45089316ddd5f7371bafd3bf2` (checkout used for scouting:
`/tmp/claude-1000/-home-qnlbnsl-projects-personal-herdr-synapse/1c6c319c-95eb-4ab1-af54-3ec9498592c9/scratchpad/src/t3code`;
re-clone `https://github.com/pingdotgg/t3code` at that commit if the scratchpad
is gone). Greenfield anchors give the target path plus the neighbouring
pattern file. Effect code is written from Effect 4.0.5's current
documentation, looked up, never from memory (`AGENTS.md`, "Language").
"Test id" means a Vitest file path; `pnpm vitest run <path>` runs one.

**WS-1: A project skeleton on Node.js 26**

Purpose: give every later unit a workspace, a toolchain and one command that
proves the repository is healthy, and let Herdr start LGTM Studio.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | `nvm use` selects Node.js 26 and `pnpm install` succeeds from a clean clone | Command: `nvm use && node --version` prints `v26.`; `pnpm install --frozen-lockfile` exits 0 |
| 1.2 | `pnpm check` runs type checks and all tests and exits 0 on the skeleton | Command: `pnpm check` exit code 0 |
| 1.3 | Node.js 26's SQLite module opens a database under Effect 4.0.5 | Test id: `packages/engine/test/smoke/node-sqlite.test.ts` |
| 1.4 | Herdr accepts the manifest | On-device step: `herdr plugin link .` in the repository, then `herdr plugin list` shows `lgtm` (or the Herdr command the plugins docs name, read 2026-11-01) |
| 1.5 | `AGENTS.md` "Status" says the design is approved and names this plan; all three scopes still pass | Command: `python3 <scoping skill>/scripts/scope.py check . engine/backend` (and `engine/infra`, `engine/contracts`) prints `ok` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | Root `package.json` (private, `"type": "module"`, `engines.node` `>=26.13 <27`, `packageManager` pnpm at the current version), `pnpm-workspace.yaml` listing `packages/*` and `third_party/t3code/*`, with a catalog pinning `effect`, `@effect/platform-node` and `@effect/vitest` at 4.0.5 | Target `package.json`, `pnpm-workspace.yaml`; pattern T3 `pnpm-workspace.yaml` (catalog, `effect: 4.0.5`, Scout A item 9) |
| 1b | `tsconfig.base.json` copied in options from T3 (target ESNext, module and moduleResolution NodeNext, strict, allowImportingTsExtensions, erasableSyntaxOnly, verbatimModuleSyntax), noEmit, run `.ts` directly with Node.js type stripping | Target `tsconfig.base.json`; pattern T3 `tsconfig.base.json` (Scout A item 9) |
| 1c | `vitest.config.ts` at the root with workspace projects; `pnpm check` = `tsc -b` plus `vitest run` | Target `vitest.config.ts`; pattern T3 `packages/effect-acp/package.json` test script (Scout A item 9) |
| 1d | Empty packages `packages/contracts`, `packages/engine`, `packages/cli`, `packages/mcp`, `packages/testing`, each with `package.json` exporting `./src/*.ts` | Target `packages/*/package.json`; pattern T3 package `exports` pointing at `./src/*.ts` (Scout A item 9) |
| 1e | SQLite smoke test (criterion 1.3) | Target `packages/engine/test/smoke/node-sqlite.test.ts`; pattern T3 `packages/shared/src/nodeSqliteClient.ts:layer` |
| 1f | `herdr-plugin.toml`: `id = "lgtm"`, `name`, `version = "0.0.1"`, `min_herdr_version` equal to Synapse's `0.8.2` unless the docs require newer, `platforms = ["macos", "linux"]`, one `[[startup]]` with `command = ["./bin/lgtm", "serve", "--detach"]`, one `[[actions]]` `serve` with the same command | Target `herdr-plugin.toml`; pattern Synapse `herdr-plugin.toml` lines 1-9 (Scout B Part A item 1, item 3) |
| 1g | `bin/lgtm`: a POSIX shell launcher that runs `node packages/cli/src/bin.ts "$@"` with the Node.js from `PATH` and fails clearly when Node.js is older than 26 | Target `bin/lgtm`; pattern Synapse `bin/herdr-synapse` (Scout B item 3) |
| 1h | Update `AGENTS.md` "Status": the engine design is approved (2026-11-01) and its plan is `.plans/plans/lgtm-engine/plan.md`; then re-accept the three scopes | Target `AGENTS.md` section "Status"; `scope.py accept` |
| 1i | `.gitignore` for `node_modules/`, state folders and test databases | Target `.gitignore` |

**Design artifact:** none; no screen (decision 8).

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| Effect 4.0.5 or `node:sqlite` misbehaves on Node.js 26 | High | Criterion 1.3 runs on day one. If it fails, stop and report to the owner with the error before any other unit starts; the fallback is the newest Node.js 26 release T3 Code pins (`26.12.1`, Scout A item 9). |
| Herdr's manifest format has changed since Synapse's manifest | Medium | Read https://herdr.dev/tui/docs/plugins/ before writing the manifest; criterion 1.4 checks it on the owner's Herdr. |

**Verify:** criteria 1.1 to 1.3 and 1.5 by command; criterion 1.4 needs the owner's Herdr host (environment QA: one `herdr` command).

**Rollout detail:** rollout step 1.

**WS-2: T3 Code's ACP client and helpers, copied with credit**

Purpose: reuse T3 Code's working, tested ACP client and helpers instead of
rebuilding them, while keeping the credit `AGENTS.md` rule 2 requires.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | The copied ACP client's own tests pass unchanged | Command: `pnpm vitest run third_party/t3code/effect-acp` exits 0 |
| 2.2 | The copied SQLite client's tests, or an LGTM Studio test if T3 has none for that file, pass | Test id: `third_party/t3code/node-sqlite/test/nodeSqliteClient.test.ts` |
| 2.3 | The Codex shadow home creates symlinks and refuses a copied home | Test id: `third_party/t3code/provider-instance/test/CodexHomeLayout.test.ts` (copied T3 test if present, else written against `materializeCodexShadowHome`) |
| 2.4 | Replay transcripts decode | Test id: `third_party/t3code/provider-testing/test/replayTranscript.test.ts` |
| 2.5 | Every copied file is credited | Command: `scripts/check-credits.sh` lists every file under `third_party/t3code/` and fails if any is missing from `third_party/t3code/README.md` or lacks T3's copyright line where the original had one; NOTICE names each package |
| 2.6 | No copied file imports `@t3tools/*` | Command: `grep -rn '@t3tools/' third_party/t3code` prints nothing |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a | Copy `packages/effect-acp` whole (src, `_generated`, `scripts/generate.ts`, tests, `test/fixtures/acp-mock-peer.ts`) into `third_party/t3code/effect-acp/` as package `@lgtm/t3-effect-acp`; `dependencies` `effect` only | T3 `packages/effect-acp/src/client.ts:layerChildProcess` (1392), `src/agent.ts:AcpAgent` (34), `layerStdio` (557) (Scout A item 1) |
| 2b | Copy `packages/shared/src/nodeSqliteClient.ts` into `third_party/t3code/node-sqlite/` as `@lgtm/t3-node-sqlite` | T3 `packages/shared/src/nodeSqliteClient.ts:layer` (Scout A item 4) |
| 2c | Copy `providerInstance.ts`, `secretReference.ts`, the needed part of `baseSchemas.ts` (`TrimmedNonEmptyString`), `pathExpansion.ts`, `instanceEnvironment.ts`, `CodexHomeLayout.ts`, `CodexManagedHome.ts` into `third_party/t3code/provider-instance/` as `@lgtm/t3-provider-instance`; replace `@t3tools/shared/HostProcess` with a local `HostProcess.ts` exposing `HomeDirectory` and `Platform`; replace `@t3tools/contracts` imports with the copied local files | T3 `packages/contracts/src/providerInstance.ts:ProviderInstanceConfig`; `packages/provider-core/src/server/instanceEnvironment.ts:mergeProviderInstanceEnvironment`; `apps/server/src/provider/Drivers/CodexHomeLayout.ts:materializeCodexShadowHome` (236) (Scout A items 5, 6) |
| 2d | Copy `packages/provider-testing/src/replayTranscript.ts` and `fakeCli.ts` into `third_party/t3code/provider-testing/` as `@lgtm/t3-provider-testing`; copy the replay schemas they import from `@t3tools/contracts` (`ProviderReplayEntry`, `ProviderReplayNdjsonRecord`, `ProviderReplayTranscript`) into the package; drop `TestProviderHost.ts` and `replayGate.ts`, which need T3's provider host | T3 `packages/provider-testing/src/replayTranscript.ts:decodeProviderReplayNdjson`; `fakeCli.ts:writeFakeCli` (Scout A item 7) |
| 2e | Move the existing `third_party/t3code/mergeMessage.ts` and its test into a package `third_party/t3code/source-control/` and change its test import from `vite-plus/test` to `vitest`, recording the change | Existing `third_party/t3code/mergeMessage.ts:removeAgentCredits`; `third_party/t3code/README.md` |
| 2f | Rewrite `third_party/t3code/README.md` as one table: package, each source file, its T3 path, and every change; extend `NOTICE` | Existing `third_party/t3code/README.md`, `NOTICE` |
| 2g | `scripts/check-credits.sh` for criterion 2.5 | Target `scripts/check-credits.sh` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A copied file depends on behaviour T3 sets up elsewhere (a layer, a global, an environment variable) | Medium | Criteria 2.1 to 2.4 run T3's own tests; criterion 2.6 proves no hidden T3 import remains. |
| The `effect-acp` generator script needs network access or a newer schema | Low | The generated files are copied as they are; the generator is only re-run deliberately, as its own change. |
| Credit is missed on one file | Medium | Criterion 2.5's script runs inside `pnpm check`. |

**Verify:** criteria 2.1 to 2.6 by command; environment QA: none.

**Rollout detail:** rollout step 2.

**WS-3: One shared definition of every command, event and state**

Purpose: write every message shape once, so the engine, the command-line
tool, the tool server and future clients cannot disagree.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | Every command in the spec's table (`start`, `prompt`, `answer`, `pass-up`, `ask`, `wait`, `stop`, `resume`, `compact`, `group`, `accounts`, `harnesses`, `subscribe`) has a request and a reply schema with a request id | Test id: `packages/contracts/test/commands.test.ts` (one case per command name, the list asserted equal to the spec's) |
| 3.2 | Every event round-trips through encode and decode unchanged | Test id: `packages/contracts/test/events-roundtrip.test.ts` (property test over every event tag) |
| 3.3 | The nine agent states and the four-step permission scale exist and the scale orders correctly | Test id: `packages/contracts/test/permission-scale.test.ts` |
| 3.4 | No schema field can carry a secret value: secrets appear only as `secret:<id>` references | Test id: `packages/contracts/test/no-secret-fields.test.ts` (walks every schema's fields; fails on any field named like `token`, `key`, `secret` or `password` that is not a reference type) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a | `src/ids.ts`: branded ids `AgentId`, `EventSequence`, `RequestId`, `PermissionRequestId`, `WaitId`, `DeliveryId`, `AccountId`, `HarnessId`, `DeviceId` | Target `packages/contracts/src/ids.ts`; pattern T3 `packages/contracts/src/providerInstance.ts:ProviderInstanceId` (branded slug) |
| 3b | `src/permission.ts`: the scale `read-only` < `ask` < `edit` < `full`, a compare function, and a per-harness mapping type | Target `packages/contracts/src/permission.ts`; spec "Identity" |
| 3c | `src/agent.ts`: agent record and the nine states from the spec's "Agent states" table | Target `packages/contracts/src/agent.ts`; spec "Agent states" |
| 3d | `src/events.ts`: one tagged union of every event: agent started, session opened, prompt sent, thread item (text, plan, tool call, file change), turn ended, state changed, permission requested, permission answered, permission passed up, permission cancelled, question asked, question answered, owner needed, wait opened, wait satisfied, delivery queued, delivered, delivery returned, agent crashed, agent interrupted, agent stopped, account changed, harness changed, command refused | Target `packages/contracts/src/events.ts`; pattern T3 `apps/server/src/persistence/Migrations/055_OrchestrationV2.ts` columns (`event_type`, `payload_json`, Scout A item 3) |
| 3e | `src/commands.ts`: an `effect/rpc` `RpcGroup` with one `Rpc` per command and a streaming `subscribe` | Target `packages/contracts/src/commands.ts`; pattern T3 `packages/effect-acp/src/rpc.ts` (an `RpcGroup` over `effect/rpc`) |
| 3f | `src/accounts.ts` and `src/harnesses.ts`: account (harness, home path or secret reference, extra environment, enabled) reusing the copied `ProviderInstanceConfig` shape; harness settings (run mode, ACP command, permission mapping) | Target `packages/contracts/src/accounts.ts`; pattern `third_party/t3code/provider-instance/providerInstance.ts:ProviderInstanceConfig` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A definition is wrong and has to change in every package | Medium | The schemas follow the spec's tables word for word; criterion 3.1 asserts the command list equals the spec's; a later change is one schema edit plus the compiler's errors. |
| A secret slips into an event payload | High | Criterion 3.4 runs in `pnpm check`. |

**Verify:** criteria 3.1 to 3.4; environment QA: none.

**Rollout detail:** rollout step 3.

**WS-4: A record that is never half-written**

Purpose: the event log and the views, the engine's single source of truth.
Split into three units: 4a the log, 4b `subscribe`, 4c the views.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Events get consecutive numbers starting at 1, and an appended batch is all written or none | Test id: `packages/engine/test/log/append.test.ts` (includes a failure injected after the first insert of a batch: zero rows written) |
| 4.2 | A command's request id is stored with its result, and a repeat returns the first result without writing | Test id: `packages/engine/test/log/receipts.test.ts` |
| 4.3 | `subscribe(after: N)` delivers every later event exactly once, in order, while new events are being written during catch-up | Test id: `packages/engine/test/log/subscribe-gapless.test.ts` (writer fiber appends 10,000 events while 5 subscribers start at random points; each sees a strictly consecutive sequence) |
| 4.4 | The views rebuilt from the log equal the live views | Test id: `packages/engine/test/views/rebuild.test.ts`; plus a Vitest `afterEach` hook in `packages/testing/src/rebuildCheck.ts` used by every engine test |
| 4.5 | A database write failure makes the engine refuse commands with a reason | Test id: `packages/engine/test/log/disk-failure.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 4a.1 | Migration creating `events` (sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE, request_id, agent_id, event_type, occurred_at, payload_json) and `receipts` (request_id PRIMARY KEY, caller, result_json, first_sequence) | Target `packages/engine/src/log/migrations.ts`; pattern T3 `apps/server/src/persistence/Migrations/055_OrchestrationV2.ts` (`orchestration_v2_events`, `orchestration_v2_command_receipts`) |
| 4a.2 | `EventLog` service: `append(requestId, caller, events)` in one `withTransaction`, one writer guarded by a semaphore, WAL mode | Target `packages/engine/src/log/EventLog.ts`; pattern T3 `apps/server/src/orchestration-v2/EventSink.ts` (`sql.withTransaction`, lines 716, 781) and `third_party/t3code/node-sqlite` `layer` |
| 4b.1 | `subscribe(after)`: read from the database up to the current head, then switch to an in-memory `PubSub` of committed events, de-duplicating by sequence at the join | Target `packages/engine/src/log/subscribe.ts`; pattern T3 `apps/server/src/persistence/OrchestrationEventStore.ts:streamProjectedApplicationEvents` and the comment at line 103 ("publish only after the surrounding transaction commits") |
| 4c.1 | `Views` service: pure `apply(view, event)` functions for agents, threads, permission requests, waits, deliveries, accounts; `rebuild(log)` folds from sequence 1 | Target `packages/engine/src/views/`; pattern T3 `apps/server/src/orchestration-v2/ProjectionRecovery.test.ts` (projection rebuild) |
| 4c.2 | `rebuildCheck` test helper (criterion 4.4) | Target `packages/testing/src/rebuildCheck.ts` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An event written during catch-up is missed or delivered twice | High | Unit 4b is sized high and has criterion 4.3's stress test. |
| A view applies an event differently live and on rebuild | High | Views are pure functions of the log; criterion 4.4 runs after every engine test. |
| SQLite lock contention between the writer and readers | Medium | WAL mode; one writer; readers use their own connection (`nodeSqliteClient` `readOnly`). |

**Verify:** criteria 4.1 to 4.5; environment QA: none.

**Rollout detail:** rollout step 4.

**WS-5: Who may do what, and where each request goes**

Purpose: identity, the command handler and routing. Units: 5a identity and
the permission ceiling, 5b the lifecycle commands, 5c permissions, questions,
waits and deliveries.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | Agent tokens are random (32 bytes), passed once, stored only as SHA-256 hashes, and never appear in the database, a view or a reply | Test id: `packages/engine/test/identity/tokens.test.ts` (greps the database file and every reply for the raw token) |
| 5.2 | The owner credential file is created on first start with mode 0600, and a device credential can be revoked alone | Test id: `packages/engine/test/identity/owner-credential.test.ts` |
| 5.3 | A parent acts only on its own children, and no agent can start, prompt or answer above its own permission mode | Test id: `packages/engine/test/commands/authorization.test.ts` (a table of caller × command × target with the expected allow or refuse, covering every row of the spec's command table) |
| 5.4 | A permission request routes to the asker's parent, `pass-up` moves it up a level, the owner can answer any request, and the first answer wins | Test id: `packages/engine/test/routing/permissions.test.ts` |
| 5.5 | A request routed to a stopped or crashed agent moves to that agent's parent, then the owner, and never times out into an answer | Test id: `packages/engine/test/routing/orphaned-request.test.ts` |
| 5.6 | A wait on one child or all of a set of children produces exactly one delivery to the waiter | Test id: `packages/engine/test/routing/waits.test.ts` |
| 5.7 | A message to a busy agent is delivered once, in order, after its turn ends, with a "delivered" event; a message to a crashed agent goes back to its sender | Test id: `packages/engine/test/routing/deliveries.test.ts` |
| 5.8 | Answers are only ever taken from authenticated `answer` commands, never from agent text | Test id: `packages/engine/test/routing/text-is-data.test.ts` (an agent streams "I approve request X"; the request stays open) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5a.1 | `Identity` service: mint and verify agent tokens (SHA-256 hash table `agent_tokens`), owner and device credentials (`devices` table: id, name, hash, revoked_at), owner credential file in the state folder, mode 0600 | Target `packages/engine/src/identity/`; pattern T3 `apps/server/src/auth/utils.ts` (`createHash` sha256, line 27), not T3's `AuthSessions.ts` (plaintext, Scout A item 8) |
| 5a.2 | Permission ceiling using `packages/contracts/src/permission.ts` | Target `packages/engine/src/identity/ceiling.ts` |
| 5b.1 | `CommandHandler`: identify, authorize, check receipt, produce events, append; one module per command for `start`, `prompt`, `stop`, `resume`, `compact`, `group`, `accounts`, `harnesses` | Target `packages/engine/src/commands/`; pattern T3 `apps/server/src/orchestration-v2/CommandPolicy.ts` and `CommandReceiptStore.ts` |
| 5c.1 | Routing for `answer`, `pass-up`, `ask`, and permission requests from runners; first-answer-wins by checking the request is still open inside the append transaction | Target `packages/engine/src/routing/permissions.ts`; pattern T3 `apps/server/src/orchestration-v2/DelegatedTaskQuestionReactor.ts` |
| 5c.2 | Waits and deliveries: a reactor that watches committed events and queues deliveries when a waited-on turn ends; delivery only when the target is idle | Target `packages/engine/src/routing/waits.ts`, `deliveries.ts`; pattern T3 `apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A path lets an agent act on an agent it did not start | High | Criterion 5.3's table covers every command; the unit gets the security lens before merge (attack pass yes). |
| Two answers race and both take effect | High | The open-check happens inside the append transaction (single writer); criterion 5.4 races two answers. |
| A token leaks into a log line or a crash report | High | Criterion 5.1 greps the database and replies; the runner's crash report redacts known secret values (WS-6, criterion 6.6). |
| A wait wakes the waiter twice | Medium | Waits close in the same transaction that queues their delivery; criterion 5.6 asserts exactly one. |

**Verify:** criteria 5.1 to 5.8; environment QA: none.

**Rollout detail:** rollout step 5.

**WS-6: Agents that run, report and recover**

Purpose: the ACP runner, accounts and recovery. Units: 6a runner core, 6b
accounts, 6c failures and recovery.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | Starting an agent spawns its adapter with the account's environment, the agent token and the `lgtm mcp` server in `session/new`, and records the session id | Test id: `packages/engine/test/runner/start.test.ts` (fake agent echoes its environment and the `mcpServers` it received) |
| 6.2 | Streamed text, plans, tool calls and file changes become thread events in order, and the end of a turn becomes "turn ended" | Test id: `packages/engine/test/runner/stream.test.ts`; replay ids `packages/testing/fixtures/claude-agent-acp-0.99.1.ndjson`, `codex-acp-2.5.0.ndjson` replayed by `packages/engine/test/runner/replay.test.ts` |
| 6.3 | A permission request holds the agent until answered, then releases it with the chosen option | Test id: `packages/engine/test/runner/permission-hold.test.ts` |
| 6.4 | `compact` sends the harness's compact command when the adapter lists it, and is refused with a reason otherwise | Test id: `packages/engine/test/runner/compact.test.ts` |
| 6.5 | "Any account" picks the usable account with the fewest running agents and skips signed-out and paused accounts; the Codex shadow home is prepared for a second Codex account | Test id: `packages/engine/test/accounts/pick.test.ts`, `packages/engine/test/accounts/codex-shadow-home.test.ts` |
| 6.6 | A crash is recorded with the exit code and the last error lines with secrets removed, waits wake with "crashed", and the agent is not restarted | Test id: `packages/engine/test/recovery/crash.test.ts` |
| 6.7 | After a service restart, reloadable idle agents return to idle, mid-turn agents get one carry-on prompt, non-reloadable agents stay interrupted, and open waits survive | Test id: `packages/engine/test/recovery/restart.test.ts` |
| 6.8 | Leftover adapter process groups from a hard crash are stopped on start, and an unrelated process that reused the number is not | Test id: `packages/engine/test/recovery/orphans.test.ts` (records a group with a mismatched start time and checks it survives) |
| 6.9 | Signed-out and out-of-usage errors are told apart for Claude Code, Codex, Gemini CLI and Cursor | Test id: `packages/engine/test/runner/classify-errors.test.ts` (fixtures of each harness's error text, captured during the live check or from adapter source) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6a.1 | `Runner` interface (start, prompt, cancel, stop, compact, events stream) so interactive mode can add a second implementation | Target `packages/engine/src/runner/Runner.ts` |
| 6a.2 | `AcpRunner`: spawn with `effect/process` `ChildProcessSpawner` in a new process group, connect with `AcpClient` from `layerChildProcess`, `initialize`, `session/new` with `mcpServers: [lgtm mcp]`, record capabilities (`loadSession`, available commands) | Target `packages/engine/src/runner/AcpRunner.ts`; pattern `third_party/t3code/effect-acp/src/client.ts:layerChildProcess` (1392), `make` (755) |
| 6a.3 | Translate ACP `session/update` notifications to thread events | Target `packages/engine/src/runner/translate.ts`; reference T3 `packages/provider-acp/src/server/runtimeModel.ts:parseSessionUpdateEvent` (1350), `sessionUpdateIsReplay` (1234) (read, not copied) |
| 6a.4 | Permission hold: on `session/request_permission`, emit the request through routing and await its answer in a `Deferred` scoped to the agent | Target `packages/engine/src/runner/permissions.ts`; pattern `third_party/t3code/effect-acp/src/client.ts` permission handler |
| 6a.5 | `compact` via the adapter's advertised commands (`available_commands_update`; Claude adapter `getAvailableSlashCommands`, Scout B item 5) | Target `packages/engine/src/runner/compact.ts` |
| 6b.1 | Accounts: build the environment from the copied `mergeProviderInstanceEnvironment`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` or `CURSOR_API_KEY`, never `HOME`; read secrets from `secrets.json` (decision 19); prepare the shadow home with `materializeCodexShadowHome` | Target `packages/engine/src/accounts/`; pattern `third_party/t3code/provider-instance/instanceEnvironment.ts:mergeProviderInstanceEnvironment`, `CodexHomeLayout.ts:materializeCodexShadowHome` |
| 6b.2 | Harness defaults: Claude `node_modules/.bin/claude-agent-acp`, Codex `node_modules/.bin/codex-acp`, Gemini `gemini --acp`, Cursor `agent acp`, overridable through `harnesses` (decision 18) | Target `packages/engine/src/runner/harnesses.ts`; Scout B items 5-7, planner's Cursor check |
| 6c.1 | Crash: on unexpected exit, emit "agent crashed" with exit code and the last 40 lines of stderr after removing every secret value the account holds | Target `packages/engine/src/recovery/crash.ts`; pattern T3 `packages/provider-acp/src/server/stderr.ts` |
| 6c.2 | Restart: on start, mark running agents interrupted, close their open requests, reload sessions where `loadSession` was advertised, prompt only mid-turn agents once | Target `packages/engine/src/recovery/restart.ts`; pattern `third_party/t3code/effect-acp/src/client.ts:loadSession` (91) |
| 6c.3 | Orphans: record process group id and start time (`/proc/<pid>/stat` on Linux, `ps -o lstart` on macOS) in a `processes` table; on start, signal recorded groups whose start time still matches | Target `packages/engine/src/recovery/orphans.ts`; pattern T3 `packages/provider-core/src/server/processGroup` (imported by provider-acp, Scout A item 2) |
| 6c.4 | Error classification fixtures per harness | Target `packages/engine/src/runner/classify.ts`; fixtures under `packages/testing/fixtures/errors/` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An adapter's real messages differ from the fake agent's | High | Criterion 6.2 replays recorded real sessions; the live check (WS-8, 8c) re-records them. |
| The Codex adapter does not support `session/load` (Scout B: unclear) | Medium | The runner reads `loadSession` from the adapter's capabilities at run time; criterion 6.7 covers the non-reloadable path. |
| A leftover-process sweep stops an unrelated program | High | Criterion 6.8 checks the start-time guard. |
| Error text differs between adapter versions, so out-of-usage looks like a crash | Medium | Adapters are exact-pinned (decision 18); unrecognised errors are reported as crashes with the text, never retried. |
| `/proc` is Linux-only | Low | macOS uses `ps -o lstart`; both paths have a test. |

**Verify:** criteria 6.1 to 6.9; environment QA: one Linux run of criterion 6.8 and, if the owner uses a Mac host, one macOS run.

**Rollout detail:** rollout step 6.

**WS-7: One door for agents and devices**

Purpose: the API server, the service lifecycle, the command-line tool and
the tool server. Units: 7a the API server and service, 7b the command-line
tool and tool server.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 7.1 | The server listens on 127.0.0.1 only unless a setting says otherwise, and refuses a non-loopback address without an encrypted-channel setting | Test id: `packages/engine/test/api/listen.test.ts` |
| 7.2 | A connection without a credential, with a revoked one, or with a malformed first message is closed before any other message is read | Test id: `packages/engine/test/api/auth.test.ts` |
| 7.3 | An agent's `subscribe` returns only its own and its children's events; the owner's returns everything | Test id: `packages/engine/test/api/subscribe-visibility.test.ts` |
| 7.4 | `lgtm serve --detach` starts one service, a second call reports the running one and exits 0, and files go to `HERDR_PLUGIN_STATE_DIR` when set, else `~/.local/state/lgtm` | Test id: `packages/cli/test/serve.test.ts` |
| 7.5 | Every command is available as a `lgtm` subcommand and as an MCP tool, both calling the same API | Test id: `packages/cli/test/parity.test.ts` (lists the contracts' `RpcGroup` and asserts a subcommand and a tool for each) |
| 7.6 | `lgtm wait` exits 0 when done, 1 when failed, 2 when the target is waiting on an answer | Test id: `packages/cli/test/wait-exit-codes.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 7a.1 | WebSocket server with `effect/rpc` `RpcServer` over the contracts' `RpcGroup`; first message must be a credential; Effect Schema decoding on every message | Target `packages/engine/src/api/server.ts`; pattern T3 `apps/server/src/ws.ts` and `packages/effect-acp/src/rpc.ts` |
| 7a.2 | Service entry: build all layers, run migrations, run recovery (WS-6 6c), then open the server | Target `packages/engine/src/service.ts` |
| 7a.3 | Single instance and detach: `serve --detach` spawns a detached child with `unref`, writes `lgtm.pid` with `O_EXCL`, and treats a live pid plus a listening port as "already running" | Target `packages/cli/src/serve.ts`; pattern Synapse `herdr_team/daemon.py` (double fork and `daemon.lock`, Scout B item 3) |
| 7b.1 | `lgtm` command-line tool: one subcommand per RPC, credential from `LGTM_TOKEN` (agents) or the owner credential file | Target `packages/cli/src/bin.ts`, `packages/cli/src/commands/` |
| 7b.2 | `lgtm mcp`: stdio MCP server with one tool per RPC, using `effect/ai`'s MCP server; fall back to a loopback HTTP endpoint if 4.0.5 has no stdio transport (decision 15) | Target `packages/mcp/src/server.ts`; pattern T3 `apps/server/src/mcp/McpHttpServer.ts` (imports `effect/ai`) |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An unauthenticated or under-authorised path into the engine | High | Criteria 7.2 and 7.3; attack pass yes for 7a and 7b. |
| Herdr does not supervise the service, so a crash leaves it down until the next Herdr start | Medium | `serve --detach` is idempotent and is also a Herdr action; restart recovery (6.7) makes restarting safe. Supervision is piece 2's concern. |
| `effect/ai` 4.0.5 lacks a stdio MCP transport | Low | Decision 15's fallback; the check is the first task of 7b. |

**Verify:** criteria 7.1 to 7.6; environment QA: criterion 1.4's Herdr host runs `lgtm serve --detach` from the startup hook once.

**Rollout detail:** rollout step 7.

**WS-8: Proof that the Foundry needs nothing else**

Purpose: the fake agent, the recorded sessions, the acceptance suite and the
live check. Units: 8a fake agent and replay, 8b acceptance suite, 8c live
check (owner).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 8.1 | The fake agent follows a script of steps (text, plan, tool call, file change, permission request, question, end turn, crash, out of usage, signed out, slow turn) over real ACP | Test id: `packages/testing/test/fake-agent.test.ts` |
| 8.2 | One acceptance test per capability, each driven only through the public API with real tokens and the owner credential | Test ids: `packages/engine/test/acceptance/capability-01-start.test.ts` to `capability-12-accounts.test.ts` (twelve files) |
| 8.3 | One acceptance test per failure rule, including a hard kill of the service mid-turn | Test ids: `packages/engine/test/acceptance/failure-1-crash.test.ts` to `failure-8-disk.test.ts` (eight files); failure 2 runs the service as a child process and sends it `SIGKILL` |
| 8.4 | The spec's "One request, start to finish" passes end to end against the fake agent | Test id: `packages/engine/test/acceptance/flow-start-to-finish.test.ts` |
| 8.5 | The live check passes once on the owner's accounts | On-device step: owner runs `pnpm live-check` on the Herdr host with one Claude Code and one Codex account configured; it runs flow 8.4 against the real adapters, prints each step, re-records the replay fixtures, and exits 0 |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 8a.1 | Fake agent: a Node.js program on `AcpAgent.layerStdio` reading a JSON script from an environment variable | Target `packages/testing/src/fakeAgent.ts`; pattern `third_party/t3code/effect-acp/src/agent.ts:layerStdio` (557), `test/fixtures/acp-mock-peer.ts` |
| 8a.2 | Replay: record an adapter's ACP traffic to NDJSON in T3's replay format and play it back as an agent | Target `packages/testing/src/replay.ts`; pattern `third_party/t3code/provider-testing/replayTranscript.ts:decodeProviderReplayNdjson` |
| 8b.1 | Acceptance harness: start the real service on a temporary state folder, an owner client, and agent clients from minted tokens | Target `packages/testing/src/acceptance.ts` |
| 8b.2 | The twenty-one acceptance files of criteria 8.2 to 8.4 | Target `packages/engine/test/acceptance/` |
| 8c.1 | `pnpm live-check` script, skipped by `pnpm check` | Target `scripts/live-check.ts` |

**Design artifact:** none.

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The suite passes against the fake but the real adapters behave differently | High | Replay fixtures (6.2) and the live check (8.5), which re-records them. |
| The live check spends real usage | Medium | It is owner-run, never part of `pnpm check`, and runs one short flow with a tiny prompt. |
| A flaky timing test hides a real gap | Medium | Tests wait on events, never on sleeps; `vitest --retry 0`. |

**Verify:** criteria 8.1 to 8.4 by test; criterion 8.5 needs the owner's Herdr host and accounts (environment QA).

**Rollout detail:** rollout steps 8 and 9.

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (a) the spec `docs/specs/2026-11-01-engine-design.md`: the
twelve capabilities, the six parts, accounts, the nine states, the eight
failure rules, the six kinds of test, the five copy rows, the security
section; (b) `decisions.md` rows 1-19.

| Source item | Workstream | Status |
|---|---|---|
| Capability 1, start an agent | WS-5 (5b), WS-6 (6a); acceptance 8.2 | mapped |
| Capability 2, agents start agents, ceiling | WS-5 (5a, 5b) | mapped |
| Capability 3, prompt with sender | WS-5 (5b), WS-3 events | mapped |
| Capability 4, state and changes | WS-3 (3c), WS-4 (4c), WS-7 (7.3) | mapped |
| Capability 5, wait without polling | WS-5 (5c) | mapped |
| Capability 6, read any thread live | WS-4 (4b), WS-7 (7a) | mapped |
| Capability 7, permission routing | WS-5 (5c), WS-6 (6a.4) | mapped |
| Capability 8, reach the owner | WS-3 ("owner needed" event), WS-5 (5c) | mapped |
| Capability 9, talk to any agent remotely | WS-7 (owner credential, API) | mapped |
| Capability 10, stop, resume, compact | WS-5 (5b), WS-6 (6a.5, 6c.2) | mapped |
| Capability 11, group agents | WS-5 (5b `group`) | mapped |
| Capability 12, several accounts | WS-6 (6b), WS-2 (2c) | mapped |
| Part 1, event log | WS-4 (4a, 4b) | mapped |
| Part 2, views | WS-4 (4c) | mapped |
| Part 3, command handler, including the `harnesses` command | WS-5 (5b) | mapped |
| Part 4, agent runner | WS-6 (6a) | mapped |
| Part 5, identity | WS-5 (5a) | mapped |
| Part 6, the doors | WS-7 | mapped |
| Accounts section | WS-6 (6b), WS-2 (2c) | mapped |
| Nine agent states | WS-3 (3c) | mapped |
| Failure rules 1-8 | WS-6 (6c) for 1, 2, 5, 7; WS-4 for 3, 8; WS-5 for 4, 6; acceptance 8.3 | mapped |
| Test kind 1, fake agent | WS-8 (8a) | mapped |
| Test kind 2, recorded sessions | WS-8 (8a.2), WS-6 (6.2) | mapped |
| Test kind 3, tests for each part | every WS's criteria | mapped |
| Test kind 4, rebuild check | WS-4 (4.4) | mapped |
| Test kind 5, acceptance suite | WS-8 (8b) | mapped |
| Test kind 6, live check | WS-8 (8c) | mapped |
| Copy rows: ACP client, event store, accounts, shadow home, replay | WS-2 (event store: shape only, decision 13) | mapped |
| Security section (SECURITY.md rules 1, 2, 4, 6, 7) | WS-7 (1, 2), WS-5 (4, 6, 7), WS-3 (6) | mapped |
| Decisions 1-19 | Key decisions; 12 → WS-1; 13 → WS-2; 14 → WS-1; 15 → WS-7; 16 → WS-3, WS-7; 17 → Rollout order; 18 → WS-6; 19 → WS-6 | mapped |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: never push to or open a pull request against `vitalysim/herdr-synapse` | No push at all without the owner (decision 17); the only remote is `qnlbnsl/lgtm-studio`. |
| `AGENTS.md` rule 2: credit every piece of copied code | WS-2 tasks 2a-2g and criterion 2.5's check script; decision 13. |
| `AGENTS.md` rule 3: keep `docs/features.md` and `docs/issues.md` current | Every unit that finishes a feature marks it built in `docs/features.md`; every problem found goes into `docs/issues.md` in the same change (backend scope may edit both). |
| `AGENTS.md` rule 4 and SECURITY.md's binding rules | WS-5 and WS-7 criteria 5.1, 5.2, 5.8, 7.1, 7.2, 7.3; WS-3 criterion 3.4; attack pass on 5a, 5c, 7a, 7b. |
| `AGENTS.md` rule 5: the client API is the product's surface | Criterion 7.5: every command is reachable through the API, the command-line tool and the MCP tools. |
| `AGENTS.md` rule 6: team shapes do not belong here | No role rules or team definitions in this plan (decision 4). |
| `AGENTS.md` rule 7: do not commit or push unless the owner asks | Decision 17; raised at handoff. |
| `AGENTS.md` "Language": Effect 4 looked up, not recalled; Node.js 26 | Conventions paragraph at the top of the implementation details; WS-1 criterion 1.1. |
| `AGENTS.md` "Status": no application code until the design is approved | The design is approved; task 1h updates the section. |
| `AGENTS.md` "Writing style for documents" | Applies to READMEs and docs written in WS-2 and every unit's `docs/features.md` updates. |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its harness-session skill)
at launch; this section names none (owner, 2026-10-16).

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1 Skeleton and manifest | infra | engine/infra | medium | Several config files following T3's pattern; one environment check on the owner's Herdr. | no | none |
| 2 Copied T3 packages | infra | engine/infra | medium | Copying with import replacement and credit; T3's own tests prove it. | no | 1 |
| 3 Shared definitions | contracts | engine/contracts | medium | New schemas, but every shape is fixed by the spec's tables. | no | 2 |
| 4a Event log | backend | engine/backend | medium | One table, one writer, transactions on the copied SQLite client. | no | 3 |
| 4b Subscribe without gaps | backend | engine/backend | high | Concurrency at the catch-up-to-live join. | no | 4a |
| 4c Views and rebuild check | backend | engine/backend | medium | Pure fold functions over a fixed event list. | no | 4a |
| 5a Identity and ceiling | backend | engine/backend | high | Authentication and credential storage. | yes | 4a |
| 5b Lifecycle commands | backend | engine/backend | medium | One module per command on a fixed handler pattern. | no | 5a, 4c |
| 5c Routing, waits, deliveries | backend | engine/backend | high | Races between answers and turn ends; permission decisions. | yes | 5b |
| 6a Runner core | backend | engine/backend | high | Child processes, streaming and held requests across a protocol boundary. | no | 5c, 2 |
| 6b Accounts | backend | engine/backend | medium | Environment assembly on copied code; secrets file. | no | 6a |
| 6c Failures and recovery | backend | engine/backend | high | Restart semantics and process cleanup that can affect other programs. | no | 6a |
| 7a API server and service | backend | engine/backend | high | The engine's network entry point and its authentication. | yes | 5c, 6c |
| 7b Command-line tool and MCP tools | backend | engine/backend | medium | Thin wrappers generated from one RPC group. | yes | 7a |
| 8a Fake agent and replay | backend | engine/backend | medium | Built on the copied ACP agent and replay code. | no | 2 |
| 8b Acceptance suite | backend | engine/backend | medium | Twenty-one tests on one harness pattern. | no | 7b, 8a |
| 8c Live check | backend | engine/backend | low | One script, run by the owner. | no | 8b |

Load: 17 build units. Following the sheet's builder and test-writer tables
for these work areas and complexities, roughly 12 builds land on the OpenAI
vendor and 5 on the Anthropic vendor, with test writers on the opposite
vendor (about 12 Anthropic and 5 OpenAI), plus one focused review per unit
(17) and a cyber attacker and verifier for the four attack-pass units (8).
That is roughly 30 OpenAI and 35 Anthropic launches over the build. The
planner cannot read the remaining weekly allowance; the lead checks each
vendor's remaining limit before launching and schedules units 6a to 8b later
if either vendor would run out (recorded in `attack/known-gaps.md`).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|

</details>


---

# Appendix: decisions.md (verbatim)

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
