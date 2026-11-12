# Scouting — lgtm-engine

Scout returns, written as they arrived. Gate 8's anchor source.

## Scout B: Herdr plugin format and ACP adapters (returned 2026-11-01)

Web facts read on 2026-11-01; bracketed dates are page or snippet dates.

### Part A — Herdr plugin manifest

1. `/home/qnlbnsl/projects/personal/herdr-synapse/herdr-plugin.toml` (143 lines).
   - Top-level keys, lines 1-6: `id = "herdr-synapse"`, `name`, `version = "0.23.0"`, `min_herdr_version = "0.8.2"`, `description`, `platforms = ["macos", "linux"]`.
   - `[[startup]]` (line 8), 1 entry, key `command`.
   - `[[actions]]` (lines 11-69), 10 entries, keys `id`, `title`, `contexts`, `command`. Contexts used: `"global"`, `"pane"`.
   - `[[events]]` (lines 71-81), 3 entries, keys `on`, `command`. `on` = `pane.agent_detected`, `pane.closed`, `pane.exited`.
   - `[[panes]]` (lines 83-143), 8 entries, keys `id`, `title`, `placement`, `command`, plus `width` (string such as `"80%"`) and `height` (integer) on popups.
   - Not used there but documented upstream: `[[build]]`, `[[link_handlers]]`.
2. Manifest format documentation.
   - No manifest-format doc in the Synapse checkout. References only: `docs/development.md:8`; `herdr_team/reference_docs.py:MANIFEST_PATH`; `tests/test_schema_conformance.py`; `lgtm/docs/research/herdr-and-synapse.md:39`.
   - No Herdr Rust source checkout on disk.
   - Upstream: https://herdr.dev/tui/docs/plugins/ [read 2026-11-01]; https://herdr.dev/tui/docs/socket-api/ "Plugin APIs" [read 2026-11-01]; https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/plugins.mdx [2026-03-27]; https://herdr.dev/docs/cli-reference/ [read 2026-11-01].
   - Secondary summary: https://github.com/voodootikigod/adlc/blob/main/docs/herdr-integration-plan.md [2026-06-11]. Required keys `id`, `name`, `version`, `min_herdr_version`; optional `description`, `platforms`; entrypoint arrays `[[build]]`, `[[startup]]`, `[[actions]]`, `[[events]]`, `[[panes]]`, `[[link_handlers]]`; pane placement `overlay` (default), `popup`, `split`, `tab`, `zoomed`.
3. How Synapse starts its long-running service.
   - `[[startup]] command = ["./bin/herdr-synapse", "daemon", "start"]`, `herdr-plugin.toml:8-9`; also the `daemon-start` action.
   - The daemon double-forks and detaches: `herdr_team/daemon.py` module docstring, lines 1-25 ("fork, setsid, fork again ... flock daemon.lock").
   - Herdr does not restart it. plugins.mdx: "Startup hooks are one-shot initialization commands rather than supervised daemons." Startup runs once per enabled plugin after restore, and again when a new server takes over during live handoff; not on client attach, config reload, or plugin link/enable. A startup failure does not stop the server.
   - Synapse side: `herdr_team/daemon.py:restart_argv` (~line 713) self-restarts on manifest version change (`HERDR_TEAM_NO_SELF_RESTART=1` disables). Exits after 60 s of server unreachable; reconnect backoff 1, 2, 4 ... 30 s. `docs/capabilities.md:1091`.
4. Environment for plugin commands: yes.
   - Every runtime command: `HERDR_SOCKET_PATH`, `HERDR_BIN_PATH`, `HERDR_ENV=1`, `HERDR_PLUGIN_ID`, `HERDR_PLUGIN_ROOT`, `HERDR_PLUGIN_CONFIG_DIR`, `HERDR_PLUGIN_STATE_DIR`, `HERDR_PLUGIN_CONTEXT_JSON`.
   - When available: `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID`.
   - Startup hooks also: `HERDR_PLUGIN_EVENT=startup`.
   - Working directory is the plugin directory.
   - Synapse anchors: `herdr_team/daemon.py:DAEMON_DROPPED_ENV_VARS` (~lines 93-94, 845); `herdr_team/paths.py` reads `HERDR_PLUGIN_STATE_DIR`; `herdr_team/hooks.py` parses `HERDR_PLUGIN_EVENT`, `HERDR_PLUGIN_EVENT_JSON`.

### Part B — ACP adapters

5. Claude Code adapter: `@agentclientprotocol/claude-agent-acp`, bin `claude-agent-acp` (formerly zed-industries). https://github.com/agentclientprotocol/claude-agent-acp/blob/main/package.json
   - Latest 0.99.1, ~2026-10-22 (https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp [2026-10-23]). Requires node >=22. Depends on `@agentclientprotocol/sdk` 2.1.0 and `@anthropic-ai/claude-agent-sdk` 0.3.312.
   - Licence Apache-2.0 per npm and package.json; the ACP registry `claude-acp/agent.json` says "proprietary" (conflict).
   - loadSession: yes, from a live initialize capture of 0.44.0 (https://github.com/maksugr/acp-devtools/blob/main/docs/session-anatomy.md [2026-05-19]). Not confirmed directly in 0.99.1 source; `src/acp-agent.ts` contains session/load replay logic.
   - Slash commands through `available_commands_update`: yes, `/compact` included. `src/acp-agent.ts:getAvailableSlashCommands` uses `query.supportedCommands()`; commit 5b11f470 [2026-10-21] test returns `{name:"compact"}`; DeepWiki 5.2 [2026-06-29] says `/compact` calls `session.query.compact()`; issue #33, PR #51.
   - Caveat: terminal-bound commands filtered; `/model`, `/mcp`, `/status` in `REPLAY_HIDDEN_COMMANDS`.
6. Codex adapter: `@zed-industries/codex-acp` deprecated, archived 2026-07-22, last 0.16.0. Current `@agentclientprotocol/codex-acp`, bin `codex-acp` (https://www.npmjs.com/package/@agentclientprotocol/codex-acp [2026-10-29]).
   - Install: `npx -y @agentclientprotocol/codex-acp` or `npm install -g`. Starts the Codex App Server. Release assets also published as bun-compiled binaries.
   - Version 2.5.0 (~2026-10-28) on npm; main package.json showed 2.2.2.
   - Licence Apache-2.0.
   - loadSession: unclear. Source check would be `src/CodexACPAgent` for `loadSession`.
   - `/compact`: yes in the README's slash-command list. Not confirmed that it arrives via `available_commands_update`.
7. Gemini CLI: `--acp` current; `--experimental-acp` deprecated. loadSession: yes (`packages/cli/src/acp/acpRpcDispatcher.ts`; capture `fixtures/handshakes/gemini-cli-0.46.0.json` in maksugr/acp-devtools).
8. SDK `@agentclientprotocol/sdk`, 2.2.0 on main (npm `latest` not confirmed). Default import is ACP v1; v2 under `/experimental/v2`. Current stable protocol version: 1.

## Scout A: T3 Code files to copy (returned 2026-11-01)

All paths relative to the T3 Code checkout at commit `6fc9144`.

1. `packages/effect-acp`, non-test line counts: `src/agent.ts` 563, `src/client.ts` 1402, `src/compat.ts` 457, `src/errors.ts` 454, `src/protocol.ts` 1006, `src/rpc.ts` 410, `src/schema.ts` 13, `src/_internal/shared.ts` 128, `src/_internal/stdio.ts` 75, `src/_generated/meta.gen.ts` 40, `src/_generated/schema.gen.ts` 10019, `src/_generated/schema-v1.gen.ts` 9398, `scripts/generate.ts` 527, `test/fixtures/acp-mock-peer.ts` 242.
   - Imports only `effect/*` subpaths; no `@t3tools/*`. `@effect/platform-node/NodeServices` in 2 files; `@effect/vitest` in tests. package.json `dependencies`: `effect` only.
   - Child-process client: yes. `src/client.ts:layerChildProcess` (line 1392) takes a `ChildProcessSpawner.ChildProcessHandle`, uses `_internal/stdio.ts:makeChildStdio`, returns `Layer<AcpClient>`. Service `AcpClient`, built by `make` (line 755).
   - Agent side for a fake agent: yes. `src/agent.ts:AcpAgent` (line 34), `make` (194), `layer(stdio, options)` (554), `layerStdio` (557). Existing mock peer `test/fixtures/acp-mock-peer.ts`.
   - `session/load`: yes. `src/rpc.ts` `session_load: "session/load"`; `src/agent.ts` handler `loadSession?` (163), wired 325 and 448, capability advertised (586); `src/client.ts` `loadSession` (91).
   - `_generated/schema-v1.gen.ts` generated by `scripts/generate.ts` (`"generate": "node scripts/generate.ts"`, devDependency `@effect/openapi-generator`).
2. `packages/provider-acp/src/server`: `adapter.ts` 8585, `AcpSessionRuntime.ts` 2885, `runtimeModel.ts` 1619, `clientTerminals.ts` 428, `clientPolicy.ts` 250, `mcpOverAcpBridge.ts` 235, `sessionConfig.ts` 143, `nativeLogging.ts` 76, `stderr.ts` 36.
   - Imports `@t3tools/contracts` (6 places), 17 `@t3tools/provider-core/server/*` modules, 11 `@t3tools/shared/*` modules.
   - ACP update to event: `runtimeModel.ts:parseSessionUpdateEvent` (line 1350, takes `SessionNotification`); related `decideToolCallUpdateEmission` (1019), `applyAcpAgentTerminalUpdate` (156), `sessionUpdateIsReplay` (1234), `sessionUpdateCountsAsLoadReplayActivity` (1239).
3. Event stores.
   - `apps/server/src/orchestration-v2/EventStore.ts` 156 lines; only `@t3tools/contracts` (line 8). Exports `EventStoreAppendEventsError`, `EventStoreReadEventsError`, `EventStoreV2Error`, `EventStoreV2`, `layer`, `layerFromOrchestrationEventStore`. `append` (110) delegates to `applicationEvents.appendAgentEvents`.
   - `apps/server/src/persistence/OrchestrationEventStore.ts` 757 lines; imports `@t3tools/contracts` (16), `@t3tools/shared/nodeSqliteClient` (18). Exports `UnsequencedProjectEvent`, `OrchestrationEventStore`, `layer` (757). `appendProjectEventRow` (363).
   - Tables: `Migrations/055_OrchestrationV2.ts` creates `orchestration_v2_events` (sequence INTEGER PK AUTOINCREMENT, event_id TEXT UNIQUE, command_id, thread_id, run_id, node_id, provider, raw_event_id, event_type, occurred_at, payload_json; later columns not confirmed), `orchestration_v2_command_receipts`, `orchestration_v2_projection_*`.
   - Transaction: unclear in the store; the caller owns it. `apps/server/src/orchestration-v2/EventSink.ts` uses `sql.withTransaction` (716, 781, 277). `OrchestrationEventStore.ts:103` comment: publish "only after the surrounding event/projection transaction commits".
4. `packages/shared/src/nodeSqliteClient.ts` 1280 lines. Driver `node:sqlite` (`DatabaseSync`), not better-sqlite3 or bun:sqlite. Imports `node:sqlite`, `node:util`, `node:worker_threads`, effect modules (including `effect/sql/SqlClient`, `effect/sql/Statement`). Exports `SqliteClientConfig`, `readOnly`, `UnsupportedNodeSqliteVersionError`, `UnsupportedNodeSqliteOperationError`, `layer`.
5. `packages/contracts/src/providerInstance.ts` 108 lines (imports effect, `./baseSchemas.ts:TrimmedNonEmptyString`, `./secretReference.ts:SecretReference`). `packages/contracts/src/secretReference.ts` 27 lines. `packages/provider-core/src/server/instanceEnvironment.ts` 26 lines, export `mergeProviderInstanceEnvironment` (imports `@t3tools/contracts` type, `@t3tools/shared/HostProcess`). `packages/provider-core/src/server/pathExpansion.ts` 12 lines, export `expandHomePath` (imports `node:path`).
6. `apps/server/src/provider/Drivers/CodexHomeLayout.ts` 452 lines; imports `@t3tools/contracts`, `@t3tools/provider-core/server/pathExpansion`, `@t3tools/shared/HostProcess`, effect. Exports `CodexHomeLayout`, `resolveCodexHomeLayout`, `CodexShadowHome*Error` (five), `materializeCodexShadowHome`, `codexContinuationIdentity`. Symlinks shadow home to shared `CODEX_HOME`: yes, `materializeCodexShadowHome` calls `fileSystem.symlink(target, link)` (line 236). `apps/server/src/provider/CodexManagedHome.ts` 20 lines, export `resolveManagedCodexHomeLayout`.
7. `packages/provider-testing/src`: `fakeCli.ts` (`FakeCliOptions`, `writeFakeCli`, `execScriptSource`; imports `@t3tools/shared/HostProcess`), `replayGate.ts` (`ProviderReplayGate`, `makeProviderReplayGate`), `replayTranscript.ts` (`decodeProviderReplayNdjson`, `readProviderReplayTranscript`, `materializeReplayTranscriptWorkspace`, error types; imports `@t3tools/contracts`), `replayWorkspace.ts` (`checkpointWorkspace`, `makeCheckpointWorkspace`), `TestProviderHost.ts` (`layer`; imports `@t3tools/provider-core/server/ProviderHost`, `@t3tools/contracts`).
8. `apps/server/src/persistence/AuthSessions.ts` 495 lines, `AuthPairingLinks.ts` 383 lines. Tokens hashed in persistence: no / unclear. `Migrations/020_AuthAccessManagement.ts` has `credential TEXT NOT NULL UNIQUE`; `AuthPairingLinkRecord.credential: Schema.String`. Hash/HMAC only in `apps/server/src/auth/utils.ts` (`createHash` sha256 line 27, `createHmac` line 80), not traced.
9. Toolchain: root `packageManager` `pnpm@12.14.0`, `engines.node` `26.12.1`; `apps/server` `engines.node` `^22.16 || ^23.11 || >=24.10`. Test runner vite-plus (`vp test run`), with `@effect/vitest`. `tsconfig.base.json`: target ESNext, module NodeNext, moduleResolution NodeNext, strict, allowImportingTsExtensions, erasableSyntaxOnly, verbatimModuleSyntax. Dev runs `.ts` directly with `node` (`apps/server` `dev`: `node --watch ... src/bin.ts`); production `node dist/bin.mjs` built with `vp pack`. Package `exports` point at `./src/*.ts`.
10. ACP adapters are not package dependencies of T3 Code. `@agentclientprotocol/claude-agent-acp` only in a replay fixture (`apps/server/src/orchestration-v2/Adapters/AcpRegistryAdapterV2.test.ts:128`, `0.90.0`). Adapters resolved at runtime through the ACP registry (`packages/provider-acp-registry/src/server/adapter.ts:197`); `codex-acp` registry id in `packages/client-runtime/src/providerClients.ts:23`.

## What the two returns change (planner's notes)

- `effect-acp` depends only on Effect, so it can be copied whole.
- `provider-acp` depends on 28 T3 modules, so LGTM Studio writes its own runner. `runtimeModel.ts:parseSessionUpdateEvent` is the reference for turning ACP updates into events.
- The event store is tied to T3's contracts; `nodeSqliteClient.ts` is not. Copy the SQLite client; write LGTM Studio's own event store in the same shape as `orchestration_v2_events`.
- T3's auth tables appear to store credentials in plain text. Do not copy them; the spec requires hashed tokens.
- `node:sqlite` and the Claude adapter's `node >=22` both point to Node.js.

## Planner check: Cursor over ACP (2026-11-01)

- Cursor's command-line agent speaks ACP natively: `agent acp` (also `cursor-agent acp`), a hidden subcommand. Source: https://cursor.com/docs/cli/using ("Use `agent acp` to run Cursor CLI as an ACP server over stdio") and https://cursor.com/docs/cli/reference/parameters, read 2026-11-01.
- Account separation: `--api-key` or `CURSOR_API_KEY` (same parameters page). Sign-in: `agent login`; status: `agent status`.
- Known gaps reported on forum.cursor.com tag `acp` (read 2026-11-01): no token usage over ACP (2026-09-17); AskQuestion never offered (2026-09-25); plugins and project hooks not loaded correctly (2026-10-20).

## Planner spot-check of plan anchors (2026-11-01, gate 8)

All in T3 Code at `6fc9144`; "yes" means the file exists, with its line count.

- yes `apps/server/src/orchestration-v2/CommandPolicy.ts` 401
- yes `apps/server/src/orchestration-v2/CommandReceiptStore.ts` 202 (exports `CommandReceiptStoreWriteError` line 10, `CommandReceiptStoreReadError` 22, `CommandReceiptStoreV2Error` 34)
- yes `apps/server/src/orchestration-v2/DelegatedTaskQuestionReactor.ts` 182
- yes `apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts` 3190
- yes `apps/server/src/orchestration-v2/ProjectionRecovery.test.ts` 1065
- yes `apps/server/src/orchestration-v2/EventSink.ts` 1019
- yes `apps/server/src/ws.ts` 3395: `import { RpcGroup, RpcSerialization, RpcServer } from "effect/rpc"` (line 108); `RpcServer.makeProtocolWithHttpEffectWebsocket` (3309); `RpcServer.make(ServerWsRpcGroup, WS_RPC_SERVER_OPTIONS)` (3310)
- yes `apps/server/src/mcp/McpHttpServer.ts` 1162; `apps/server/src/mcp` imports `effect/ai`, `effect/ai/McpSchema`, `effect/ai/Tool`, `effect/ai/Toolkit`. No stdio MCP transport is used in T3's mcp folder (decision 15's check stays open until unit 7b).
- yes `apps/server/src/auth/utils.ts` 184
- yes `packages/provider-acp/src/server/stderr.ts` 36
- yes `packages/provider-core/src/server/processGroup.ts` (and `processGroup.test.ts`)
- yes `apps/server/src/persistence/OrchestrationEventStore.ts:streamProjectedApplicationEvents` (lines 111, 712)
- `effect-acp` tests import `@effect/vitest` (`packages/effect-acp/src/schema.test.ts:1`, `src/_internal/stdio.test.ts:1`, `src/protocol.test.ts:19`).
