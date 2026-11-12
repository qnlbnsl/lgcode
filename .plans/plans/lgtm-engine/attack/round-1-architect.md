# Round 1: architect review of plan-v1

Reviewer: architect lens (claims about existing code, placement, shared
contract, writers and readers, migrations, release order and rollback).
Target: `attack/plan-v1.md`. T3 Code checkout at commit `6fc9144` was read
directly; every T3 anchor below is relative to that checkout. Known gaps 1-7
are not re-reported.

## Verdict: REVISE

Top finding: nothing in the plan tells an agent's `lgtm mcp`, or the
owner's own terminal, where the engine is. No port, address or endpoint file
is named. The service's files go to `HERDR_PLUGIN_STATE_DIR`, but that
variable reaches only the commands Herdr runs for the plugin. Then
`bin/lgtm` relies on a `node` from `PATH` that does not exist in a clean
environment on this host. So the main flow, an agent calling LGTM Studio's
tools, has no defined way to connect.

## Findings

### 1. MAJOR, Design: no way to find the engine from outside the plugin

- Evidence: plan line 475 (criterion 7.4) puts files in
  `HERDR_PLUGIN_STATE_DIR`, else `~/.local/state/lgtm`. Plan line 486
  (7b.1) gives the CLI only `LGTM_TOKEN` or the owner credential file.
  The word "port" appears only at plan lines 68 and 485, and no number or
  discovery file is named.
- Scouting B item 4: the `HERDR_PLUGIN_*` variables are set for plugin
  runtime commands only. An adapter's child and the owner's shell do not
  have them, so both fall back to `~/.local/state/lgtm`. That is a
  different folder from the one the service used, so neither finds the
  credential or the port.
- Fix:
  - Fix one state directory that every process can compute, or have the
    service write a pointer file at a fixed path.
  - Have the service write `endpoint.json` (address, port, pid) with an
    atomic rename. The service is the only writer.
  - The runner puts `LGTM_URL` and `LGTM_TOKEN` in the `env` of the
    `mcpServers` entry and in the agent's environment.
  - The CLI reads `LGTM_URL` first, then `endpoint.json`.

### 2. MAJOR, Design: how `lgtm mcp` is launched inside an agent is undefined

- Evidence:
  - Plan line 231 (1g): `bin/lgtm` runs `node packages/cli/src/bin.ts`,
    a path relative to the current folder, with the `node` from `PATH`.
  - On this host there is no `/usr/bin/node` or `/usr/local/bin/node`.
  - `env -i /bin/sh -c 'command -v node'` prints nothing.
  - The user's zsh loads nvm lazily (`node` is an alias to `_load_nvm`).
  - `~/.nvm/versions/node` holds versions up to v24.20.0 and no v26.
  - An adapter starts its MCP servers with the agent's working folder as
    the current folder. Codex passes only a restricted environment to MCP
    servers.
- Fix: in 6a.2, the `mcpServers` entry is
  `{command: process.execPath, args: [<absolute path>/packages/cli/src/bin.ts, "mcp"], env: [LGTM_URL, LGTM_TOKEN]}`.
  `bin/lgtm` resolves its own folder, and finds Node.js 26 through
  `LGTM_NODE`, then `$NVM_DIR/versions/node/v26*`, then `PATH`.

### 3. MAJOR, Design: a dependency cycle between `testing` and `engine`

- Evidence: `packages/testing/src/rebuildCheck.ts` (plan lines 340, 351)
  needs the engine's `Views` and `EventLog`. `packages/testing/src/acceptance.ts`
  (plan line 525) starts the real service. At the same time, every engine
  test imports `rebuildCheck`, and `packages/engine/test/acceptance/`
  (plan line 526) imports the harness. So `testing` depends on `engine`, and
  `engine`'s tests depend on `testing`.
- `tsc -b` (plan line 227) refuses project references that form a circle
  (TS6202).
- Fix: `packages/testing` keeps only the fake agent, replay and fixtures; it
  depends on `contracts` and `t3-effect-acp`. Move `rebuildCheck` and the
  acceptance harness to `packages/engine/test/support/`, or into a separate
  `packages/acceptance` that depends on both.

### 4. MAJOR, Design and Security (integrity): the copied account contract conflicts with decision 19

- Evidence:
  - T3 `packages/contracts/src/providerInstance.ts:32-36`: an environment
    variable's `value` is `Union([String, SecretReference])`.
  - T3 `secretReference.ts:23-26`: `SecretReference` is
    `{provider, reference}`, not `secret:<id>`.
  - T3 `packages/provider-core/src/server/instanceEnvironment.ts:9`:
    `baseEnv` defaults to `process.env`, the engine's whole environment.
  - The same file, line 18, skips references without resolving them.
- So plan 3f (line 313) admits plain-text secrets, which reach the log
  through the "account changed" event. Criterion 3.4's check by field name
  cannot see a field called `value`.
- Fix:
  - Write LGTM Studio's own account schema. Each environment value is either a
    non-secret string or a `secret:<id>` reference, and names that look like
    secrets (`*_KEY`, `*_TOKEN`) must be references.
  - Resolve references before the merge.
  - Build `baseEnv` from an allow-list (`PATH`, `LANG`, `TERM` and similar),
    never from `process.env`.

### 5. MAJOR, Design: `secrets.json` has no writer

- Evidence: plan line 439 (6b.1) and decision 19 (plan line 675) only read
  the file. No command, CLI subcommand or task writes a value into it, and
  criterion 3.4 forbids carrying a value through `accounts`.
- Consequence: a Cursor account (`CURSOR_API_KEY`) cannot be configured
  through the API, which breaks capability 12 and `AGENTS.md` rule 5.
- Fix: name the file's single writer. Either:
  - an owner-only `secret set` command whose input is write-only and is
    never put in an event or a receipt, or
  - a CLI-local writer (mode 0600, atomic rename), with the API rule-5
    exception recorded.

### 6. MAJOR, Security (isolation): receipts are keyed by request id alone

- Evidence:
  - Plan line 347 (4a.1): `receipts(request_id PRIMARY KEY, caller, ...)`.
  - `events.request_id` is stored, and the events reach subscribers (7.3).
  - T3's `055_OrchestrationV2.ts:43` uses `command_id PRIMARY KEY`, which
    is safe only because T3 has a single user.
- An agent that resends a request id it saw in its children's events gets
  another caller's first result. An agent that sends a request id first
  makes the owner's later command a silent no-op.
- Fix: make the primary key `(caller, request_id)` and look receipts up by
  both. Add a case for this to criterion 4.2.

### 7. MAJOR, Design: tables written outside the event log, with no owner for migrations

- Evidence:
  - Spec line 112: the event log is "the only code that writes" the SQLite
    file.
  - The plan adds `agent_tokens` and `devices` (line 390, 5a.1) and
    `processes` (line 443, 6c.3), written by Identity and by the orphan
    sweep.
  - Only `log/migrations.ts` (line 347) creates tables.
- What breaks:
  - `start` writes the token row and the "agent started" event in separate
    transactions, so a crash between them leaves a token with no agent, or
    an agent with no token.
  - After a restart, the raw token cannot be recovered from its hash, and
    ACP `session/load` needs `mcpServers` again. The plan does not say that
    a new token is minted.
- Fix:
  - Unit 4a owns one migration list covering all five tables.
  - `EventLog.append` accepts side rows written in the same transaction.
  - A token is re-minted on every spawn (start, resume, reload), and the
    old hash is revoked.
  - A device revocation and each recorded process group become events.

### 8. MAJOR, Design: "first message is a credential" does not fit `RpcServer`

- Evidence: T3 `apps/server/src/ws.ts:3293`:
  - It authenticates on the WebSocket upgrade
    (`authenticateWebSocketUpgrade`).
  - It then builds one `RpcServer` per connection, with the session in its
    context (lines 3309-3330).
  - It races `awaitInvalidation` so that a revoked session is disconnected
    (lines 3360-3367).
- Plan 7a.1 (line 483) needs a custom protocol to read a credential as the
  first message, and criterion 7.2 tests revocation only when a connection
  opens.
- Fix:
  - Authenticate on the upgrade, using the `Authorization` header, or
    `Sec-WebSocket-Protocol` for browsers.
  - Build one `RpcServer` per connection, with the caller in its context.
  - Close live connections when a credential is revoked, and test that.

### 9. MINOR, Design: the WS-2 copy lists are incomplete

- `CodexHomeLayout.ts:1` imports `CodexSettings` (T3
  `packages/contracts/src/settings.ts:627`, a file of 1,797 lines with about
  15 sibling imports) and `ProviderDriverKind`.
- Its test imports `@t3tools/shared/testing/symlinks` (test line 15).
- `CodexManagedHome.ts` lives in `apps/server/src/provider/`, not in
  `Drivers/`.
- The replay schemas live in `orchestrationV2.ts:4176-4220` and also need
  `ProviderReplayTranscriptHeader` and `NonNegativeInt`.
- `fakeCli.ts:5` imports `HostProcess`.
- `nodeSqliteClient.test.ts:13` imports `vite-plus/test`.
- Criterion 2.6's grep will match the context-key strings at
  `nodeSqliteClient.ts:44,106` and in `HostProcess`.
- Fix: list each of these, replace `CodexSettings` with a local
  `{homePath, shadowHomePath}` type, and make 2.6 grep for imports only.

### 10. MINOR, Design: missing development dependencies and test settings

- Evidence:
  - The effect-acp `tsconfig.json` includes `scripts`, and `generate.ts`
    imports `@effect/openapi-generator`.
  - Its tests need `@effect/platform-node`, `@effect/vitest` and
    `@types/node`.
  - `@effect/vitest` 4.0.5, without T3's patch, requires `vitest >=5 <6`
    (`patches/@effect__vitest@4.0.5.patch`).
  - The copied package's `extends ../../tsconfig.base.json` sits one level
    too shallow at its new location.
  - T3's tests rely on `vite.config.ts:98-130`: 60-second timeouts and a
    `providerEnv` setup file that deletes `CLAUDE_*`, `CODEX_*` and
    `ANTHROPIC_*` variables.
- Fix:
  - Pin vitest 5.x, `@types/node` 26 and `@effect/openapi-generator` 4.0.5
    in the catalog.
  - Fix the `extends` path.
  - Copy the timeouts and the environment scrub into `vitest.config.ts`.

### 11. MINOR, Release order: unit 1 cannot pass `pnpm check`

- Evidence: the existing `third_party/t3code/mergeMessage.test.ts:1`
  imports `vite-plus/test`, which Vitest picks up in unit 1. That breaks
  criterion 1.2 before task 2e fixes it.
- `tsc -b` with `noEmit` needs composite projects and may fail (TS6310). T3
  runs `tsc --noEmit` per package.
- Fix: change that import line in unit 1, or exclude `third_party` until
  unit 2. Use `pnpm -r typecheck`.

### 12. MINOR, Design: the Runner interface is too narrow for interactive mode

- Evidence:
  - Plan line 434 (6a.1) lists start, prompt, cancel, stop, compact and an
    event stream.
  - Restart reload (6c.2) and the permission hold (6a.4) sit outside the
    interface.
  - The spec's agent view (spec line 134) stores an "ACP session id".
- Fix: add `load` or `resume(sessionRef)` and `answerPermission` to the
  interface. Make `sessionRef` a tagged union (`acp` or `interactive`).
  Record the runner's capabilities (permission hold, thread stream,
  compact) in "session opened".

## Answers to the attack questions

### Q1. Claims about T3 Code: partly false

- `effect-acp` at run time needs only `effect`. That is confirmed: every
  non-relative import in `src/` is `effect/*`, and there are no `node:`
  imports.
- Its tests and fixtures also need:
  - `@effect/platform-node` (`client.test.ts`, `protocol.test.ts`,
    `test/fixtures/acp-mock-peer.ts`);
  - `@effect/vitest`, which itself needs vitest 5;
  - `@types/node` (`tsconfig.json` `types: ["node"]`);
  - `@effect/openapi-generator`, because `scripts/` is type-checked.
- The tests spawn `process.execPath` with the `.ts` mock peer
  (`client.test.ts:83,111`). That works only with Node.js type stripping.
- `nodeSqliteClient.ts` needs only `effect` plus `node:sqlite`, `node:util`
  and `node:worker_threads`. Its workers are inline strings run with
  `eval: true` (lines 197, 314-315, 500, 643-644), so there is no worker
  file.
- It requires Node.js 22.16, 23.11 or 24 and later (lines 129-144).
- Its test exists, 463 lines, and needs `vite-plus/test` replaced.
- Tasks 2c and 2d pull in more than the plan lists: see finding 9.

### Q2. Package placement: a cycle exists, and the MCP spawn path is undefined

- `testing` and `engine` depend on each other (finding 3).
- `contracts` depending on `t3-provider-instance` (3f) is acceptable, but
  finding 4 changes the shape.
- The `cli` and `mcp` packages both need the same RPC client and the same
  way of finding the endpoint, but no package owns it. A small
  `packages/client` is suggested.
- How `lgtm mcp` is spawned: findings 1 and 2.

### Q3. Writers and readers: ownership is not single or clear

| Table or file | Writer | Reader | Problem |
|---|---|---|---|
| `events`, `receipts` | `EventLog` | views, `subscribe` | Fine, apart from the receipt key (finding 6). |
| `agent_tokens` | Identity, outside the transaction | API authentication | Finding 7: not atomic with the events; no rotation on spawn. |
| `devices` | Identity | API authentication | Revocation is not an event; live connections are not closed (finding 8). |
| `processes` | orphan sweep and runner | restart | Not covered by any migration owner (finding 7). |
| Owner credential | engine Identity on first start | CLI | Path mismatch (finding 1). The CLI may read it before the service has written it. |
| `secrets.json` | none | accounts | Finding 5. |
| `lgtm.pid` | CLI parent with `O_EXCL` | CLI | Who deletes a stale file is undefined; the service is the better owner. |

Migrations: only `log/migrations.ts` is named, and 7a.2 runs migrations.
Tests for 4a to 6c need the migrations before 7a.2 exists.

### Q4. What Effect 4.0.5 provides

- `RpcServer` over WebSocket: yes (`ws.ts:108`, `:3309`,
  `makeProtocolWithHttpEffectWebsocket`), but with authentication on the
  upgrade (finding 8).
- `ChildProcess.make({detached})`: yes
  (`provider-acp/src/server/AcpSessionRuntime.ts:1447`).
- Killing a whole process group is manual: T3 has its own `process.kill(-pid)`
  (`provider-core/src/server/processGroup.ts:8`).
- `extendEnv` defaults to true at that call site, so a spawned adapter
  inherits the engine's environment unless this is turned off.
- `effect/ai` MCP over stdio is known gap 2. One piece of supporting
  evidence: the cached `effect` 4.0.0-beta.83 has `McpServer.layerStdio`
  (`~/.cache/opencode/node_modules/effect/dist/unstable/ai/McpServer.d.ts:246`).

### Q5. Node.js type stripping: compatible

- No `enum`, `namespace`, parameter properties or decorators appear in
  effect-acp, `nodeSqliteClient`, `HostProcess` or the 2c and 2d files.
- Every relative import has a `.ts` extension.
- The JSON import uses `with { type: "json" }`, which Node.js supports.
- Caveat: Node.js will not strip types from files under `node_modules`.
  pnpm workspace links resolve to real paths outside it, so this works
  today, but LGTM Studio must never be installed under a `node_modules` path.
- Node.js 26 is not installed on this host (criterion 1.1 needs
  `nvm install 26`).

### Q6. Interactive mode later: not yet clean

The contracts and the interface need finding 12 now. Otherwise the agent
view's "ACP session id" and an ACP-only permission hold would force a
contract change later.

### Q7. Release and rollback: nothing irreversible, but order problems

- Nothing is irreversible: nothing is committed or deployed.
- Unit 1 breaks `pnpm check` (finding 11).
- Units 4b, 4c and 5a run in parallel after 4a. If 5a adds its tables
  without a single migration owner, migration numbering can collide
  (finding 7).

## Post-build checks

| Id | Scenario | Expected result | Required evidence | Area |
|---|---|---|---|---|
| PB-A1 | Stop an agent, and crash its adapter, with Claude Code and Codex | The whole process group goes, including the `claude` child and the Codex app server, not only the adapter's own process | `ps` output before and after the stop | 6a, 6c |
| PB-A2 | An adapter writes more than 64 KB to its error output | The runner keeps reading it; the adapter never blocks. effect-acp never reads the child's error output (`_internal/stdio.ts:13-22`). | A test with a fake agent that floods its error output | 6a, 6c.1 |
| PB-A3 | Each harness starts `lgtm mcp` under its own sandbox | The MCP server starts and reaches the loopback address, for Codex in workspace-write mode and for Claude Code's sandbox | Live-check log | 7b, 8c |
| PB-A4 | An agent token is passed in the `mcpServers` environment | It is not saved in `CLAUDE_CONFIG_DIR` or `CODEX_HOME` session files | A grep after the live check | 6a, 8c |
| PB-A5 | `subscribe` catches up while the writer is busy | `readOnly` reaches a reader connection only when `readerWorker: true` (`nodeSqliteClient.ts:37`, `:1084`). The configuration is chosen deliberately and the catch-up still sees no gap. | Criterion 4.3 run with the chosen configuration | 4b |
| PB-A6 | The copied code is type-checked | Upstream TypeScript checks the copied effect-acp without errors. T3 uses `@tsc-rs/typescript` 0.8.0 (`pnpm-workspace.yaml:73`). | `pnpm -r typecheck` | 2 |
| PB-A7 | LGTM Studio restarts and an agent's session is reloaded | The reloaded agent gets a new token, its old token is refused, and its tools work | Criterion 6.7, extended | 6c |
