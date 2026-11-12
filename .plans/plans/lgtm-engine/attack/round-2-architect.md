# Round 2, architect lens: plan v2

Reviewer: architect lens, round 2, isolated context, 2026-11-01.
Target: `attack/plan-v2.md` (decisions 20-48, the new criteria and tasks) and the
unreviewed mechanisms listed in `attack/round-1-findings.md`. Known gaps in
`attack/known-gaps.md` are not re-reported.

Sources checked: T3 Code at `6fc9144a60c4a5f45089316ddd5f7371bafd3bf2` (scouting
checkout), including its vendored Effect source at `.repos/effect-smol`
(package version 4.0.1; T3's catalog pins 4.0.5, so line numbers may drift but
the shapes are the ones T3 builds against). Effect line references below are to
that vendored copy.

## Verdict: REVISE

The top finding is that a restart after a crash cannot work as written. Row 31
opens the socket last, but nothing removes the socket file the crashed service
left behind, so the listen call fails with "address in use"; and even with that
fixed, row 31 reloads agents and prompts them to carry on before the socket
exists, so the reloaded agents' LGTM Studio tools fail. Failure rule 2, the case
the acceptance suite kills the service to prove, breaks on both counts.

Counts: 0 BLOCKER, 7 MAJOR, 5 MINOR.

## Findings

### 1. MAJOR, Design: no stale socket removal, so every restart after a crash fails

Evidence: row 31 step 9 ("Open the socket"); task 7a.1 (`plan-v2.md:543`).
Effect's `NodeHttpServer.make` calls `server.listen(options)` with the given
path and does nothing else (`packages/platform/node/src/NodeHttpServer.ts:131`).
Node.js removes a Unix socket file only on a clean `close`; after `SIGKILL`
the file stays, and the next `listen` on that path fails with `EADDRINUSE`.
No task, row or criterion removes it (the plan never mentions unlinking or a
stale socket). Criterion 8.4's failure-2 test sends `SIGKILL` and restarts, so
it fails, as does every real restart after a crash.

Fix: after the lifetime lock is held (row 31 step 1), remove `engine.sock` if
present; it is safe because the lock proves no other service owns it. Add the
case to criterion 6.7 or 7.4: kill the service, restart, and connect.

### 2. MAJOR, Design: reloaded agents are prompted before the socket exists

Evidence: row 31 steps 6-7 (reload sessions with new tokens, re-send
deliveries, send carry-on prompts) run before step 9 (open the socket).
A reloaded session gets a new `mcpServers` entry (row 32), so its adapter
starts a new `lgtm mcp`, which tries to reach a socket that is either
missing or stale (connection refused). A mid-turn agent that receives "carry
on" and immediately calls `wait`, `answer` or `prompt` gets a connection error.
If `lgtm mcp` connects at startup and exits on failure, the adapter marks
the MCP server failed and the agent loses LGTM Studio's tools for the whole
session. The fake agent does not start an MCP server, so the acceptance suite
cannot catch this; only the live check would.

Fix: listen right after the lock and stale-socket removal, but have every RPC
(other than the upgrade itself) wait on, or refuse with "recovering", a
readiness signal set after step 8. That keeps round 1's security reason for
opening last (no command races recovery). Also state that `lgtm mcp`
connects lazily on the first tool call and retries for a bounded time.

### 3. MAJOR, Security (integrity): the lifetime lock as written does not exclude a second service

Evidence: row 31 step 1 ("`engine.lock` opened with `locking_mode=EXCLUSIVE`
and held"). In SQLite, `PRAGMA locking_mode=EXCLUSIVE` takes no lock by
itself: the first read takes a shared lock and only the first write takes the
exclusive lock, which is then kept. Two processes that only open the file and
set the pragma, or only read it, both succeed. Two services would then both
write the event log and both run the leftover sweep (row 31 step 4), where each
one's recorded process groups match boot id, user and executable, so each can
kill the other's adapters. No task builds the lock: task 6c.2 and task 7a.2 both
claim "row 31's order", and task 7a.3 only reads the lock.

The kernel does release the lock when the process dies, including on
`SIGKILL`, because SQLite uses POSIX advisory locks, so crash release is
correct once the lock is really taken.

Fix: after the pragma, run `BEGIN EXCLUSIVE; COMMIT` (or write a row), set
`timeout: 0`, treat `SQLITE_BUSY` as "already running", and keep the
connection referenced for the service's lifetime. Name task 7a.2 as the owner
and add a two-process test. In `serve --detach` (task 7a.3) detect a running
service by connecting to the socket, never by probing the lock: a probe that
opens and writes the lock file can make a service that is starting at that
moment fail and exit.

A simpler mechanism is not available without native code: Node.js has no
`flock`, and probing the socket by connecting is racy between two starters
(both see "refused", both remove and bind). The SQLite file is the right
choice; it only needs the write.

### 4. MAJOR, Design: `session/set_model` is not stable ACP v1, and mode and reload calls depend on the negotiated protocol generation

Evidence: criterion 6.11 (`plan-v2.md:484`), row 35(c), task 6c.2. The
copied `effect-acp` treats ACP protocol version 2 as primary
(`src/_generated/meta.gen.ts`, `PROTOCOL_VERSION = 2`, whose method list has no
`session/load`, `session/set_mode` or `session/set_model`). Those three exist
only as version 1 compatibility methods (`src/rpc.ts:10-16`), and
`session/set_model` comes from the compatibility schema, not the generated
version 1 schema (`src/compat.ts:449`). The client calls them only when the
adapter negotiated generation 1, and otherwise fails with "method not found"
(`src/client.ts:1200-1218`). The stable way to set model and effort is
`session/set_config_option` with the categories `model` and `thought_level`
(`src/_generated/schema-v1.gen.ts:735-747`), which is what T3 itself uses
(`packages/provider-acp/src/server/AcpSessionRuntime.ts`, `setModel` calls
`setConfigOption`).

The fallback in the WS-6 risk table ("an unsupported one is refused at `start`")
would then refuse model selection on any adapter that offers only config
options, which breaks capability 1 (start with model and effort).

Fix: set model and effort through `session/set_config_option` when the session
reports the matching config options; use `session/set_model` only on
generation 1 when no config option exists; then a documented launch argument;
refuse only when none applies. Do the same for row 35(c): set the mode back
through the `mode` config option when present, else `session/set_mode`.
Record the negotiated generation in "session opened". Require the fake agent
(task 8a.1) to answer `initialize` in the same generation the recorded real
adapters used, so acceptance tests run the production code path.

### 5. MAJOR, Design: scope edit lists miss files that later units must write

Evidence: `.plans/scopes/engine/backend/scope.json` and
`contracts/scope.json` do not include `pnpm-lock.yaml`,
`pnpm-workspace.yaml` or the root `package.json`, which only the infra scope
edits. But task 6b.2 adds the pinned adapters as dependencies of
`packages/engine` (row 18), task 7b.1 needs `ws` in `packages/client` (finding
11), and `packages/testing` needs the copied `effect-acp` package. Any
dependency change rewrites `pnpm-lock.yaml`, and criterion 1.1 installs with
`--frozen-lockfile`. Criteria 8.2 and 8.6 run `pnpm record-fixtures` and
`pnpm live-check` from the root, yet task 1a lists only the `typecheck`, `test`
and `check` scripts and the scripts are written by backend units.

Fix: have unit 1 declare every package's dependencies (the adapters included)
and the root `record-fixtures` and `live-check` scripts up front, so later units
change no lockfile; or add `pnpm-lock.yaml` to the backend and contracts edit
lists.

### 6. MAJOR, Design: the fixture recorder runs before the code it needs exists

Evidence: sizing table (`plan-v2.md:704-705`): 8a depends on 3, and 6a
depends on the owner's recording. Row 42 has the recorder run real Claude
Code, Codex, Gemini CLI and Cursor sessions and capture signed-out errors
"with an empty home or key". That needs the pinned adapter binaries and their
absolute paths (task 6b.2), the allow-listed environment and the Codex shadow
home and Cursor secret (task 6b.1). All three are built in unit 6b, after the
recording. Depending on 3 alone is correct for the copied ACP agent from unit 2
(3 depends on 2), but not for these.

Fix: move the adapter pins to unit 1 (finding 5) and move harness default
resolution plus a minimal allow-listed environment builder into unit 8a (or a
small unit before the recording that 6b then extends). State that the recorder
uses the copied `effect-acp` client directly and does not depend on the runner.

### 7. MAJOR, Design: criterion 7.5's parity rule cannot hold for MCP

Evidence: criterion 7.5 ("Every RPC is a `lgtm` subcommand and an MCP
tool"); task 7b.3. `subscribe` is a streaming RPC and an MCP tool is one
request with one reply, so it cannot be a tool as stated. Owner-only commands
(`debug.compare-views` from row 43, `accounts set-secret` from row 40, device
management) would become agent tools that are always refused. An agent calling
`accounts set-secret` would put the secret value into the tool call's
arguments, which the adapter writes to its own session files, outside
LGTM Studio's redactor.

Fix: keep full parity for the command-line tool (AGENTS.md rule 5). Give the
MCP server only the commands an agent may call, with `subscribe` replaced by
a bounded "read thread after N" tool, and make the parity test assert an
explicit exclusion list.

### 8. MINOR, Design: several units use something built later

Evidence: sizing table (`plan-v2.md:692-711`).
- Task 4a.2 passes text through the redactor of task 5a.3, but unit 5a depends
  on 4a.
- Criterion 5.4 has `start` pass harness, account, model and folder on, which
  needs the `Runner` interface of task 6a.1, built after unit 5b.
- Criterion 4.6 checks `debug.compare-views` "in a running service" in unit
  4c, but the service is built in unit 7a.
- Criterion 6.7 asserts "the socket opens last" in unit 6c, but the socket is
  built in unit 7a.

Fix: unit 4a defines a `Redactor` service with a pass-through layer, and 5a
provides the real one; move task 6a.1 to unit 3 or 5b; move the
running-service half of 4.6 and the socket assertion of 6.7 into unit 7a's
criteria.

### 9. MINOR, Design: `debug.compare-views` as a production RPC

Evidence: row 43; criterion 4.6 ("after a view is corrupted in a test build").
Comparing a rebuild with the live views while other commands write gives
spurious differences unless both are taken at the same sequence number. Taking
them under the single writer means a full rebuild blocks every agent's
commands for as long as the log takes to fold. "Corrupted in a test build"
implies a corruption switch compiled into the service. The command also
returns view contents for every agent, so it must stay owner-only. That fits
row 41's visibility rule, but it collides with criterion 7.5 (finding 7).

Fix: put it in a separate debug RPC group that the service serves only when
started with an explicit test flag. Compare at one sequence number: rebuild up
to the head read under the writer, against a copy of the live views at that
head. Corrupt a view in tests by replacing the views layer, never through
production code. Keep it out of the MCP tools and the main command list in
criterion 3.1.

### 10. MINOR, Design: row 23's package graph omits real edges

Evidence: row 23; manifest command `./bin/lgtm serve --detach` (task 1f);
row 22 (the runner's `mcpServers` entry runs `packages/cli/src/bin.ts`).
`lgtm serve` in `packages/cli` must load `packages/engine/src/service.ts`,
and `lgtm mcp` is a command of the same binary that runs `packages/mcp`.
The acceptance harness in `packages/engine/test/support/` uses
`packages/client` and `packages/testing`. There is no cycle, because the engine
names the command-line binary only by path, but the edges `cli → engine`,
`cli → mcp`, and the engine's development dependencies on `client` and
`testing` are not declared.

Fix: add these edges to row 23 and state that `engine` never imports `cli`.

### 11. MINOR, Design: the client half of row 48 is unstated, and socket path length is unchecked

Evidence: row 48; task 7b.1. Effect's `Socket.makeWebSocket` passes only the
protocols to the constructor (`packages/effect/src/socket/Socket.ts:862`), so
no `Authorization` header is sent, and the default Node constructor prefers
the built-in `WebSocket`, which cannot dial a Unix socket
(`packages/platform/node/src/NodeSocket.ts:34-46`). It works only with a
custom `Socket.WebSocketConstructor` that builds a `ws` client from a
`ws+unix:` URL with `headers` (the option exists:
`Socket.ts:779-790`). Separately, a Unix socket path is limited to 108 bytes on
Linux and 104 on macOS. A long `LGTM_HOME`, or a test home under a long
temporary folder, fails to listen.

Fix: task 7b.1 names the custom constructor and adds `ws` to
`packages/client`; the service refuses a socket path over 100 bytes with a
clear message; tests create their home with `mkdtemp` under `/tmp`.

### 12. MINOR, Design: decision and count mismatches

Evidence:
- Row 47's cheap hardening (deny rules per harness, "tested per harness") and
  its SECURITY.md wording have no task or criterion, and `SECURITY.md` is
  read-only in every scope.
- The conventions paragraph (`plan-v2.md:241-243`) has every unit mark
  `docs/features.md`, but the infra and contracts scopes cannot edit that file.
- The load line (`plan-v2.md:713-719`): 18 builds, 18 test writers, 18 reviews
  and 8 attack launches make 62, not 31 + 37 = 68.
- Criterion 1.4 belongs to unit 1 but runs at rollout step 11 (overview item
  5).
- Rows 15 and 16 still say "loopback" and "127.0.0.1"; rows 21 and 48 replace
  them but do not mark them superseded.

Fix: add a task for the deny rules and SECURITY.md to the lead or an infra
unit, and widen that scope; correct the conventions sentence, the launch
total and the step for 1.4; mark rows 15 and 16 superseded.

## Answers to the attack questions

1. **Verified, with two gaps.** `NodeHttpServer`'s `Options` extends
   `net.ListenOptions`, so `path` listens on a Unix socket, and a Unix address
   is reported (`NodeHttpServer.ts:73, 131-140`). The route handler sees the
   request headers before it calls `httpEffect`, so `Authorization: Bearer`
   is checked before the upgrade. A non-101 response is written to the raw
   socket (`NodeHttpServer.ts:258-266`). `makeProtocolWithHttpEffectWebsocket`
   is per request (`rpc/RpcServer.ts:986-1012`). T3 closes a live connection
   by racing the RPC effect against an invalidation signal (`ws.ts:3374-3385`),
   and interrupting it closes the WebSocket. The gaps are the stale socket
   (finding 1) and the client constructor (finding 11).
2. **Not as written.** The pragma alone takes no exclusive lock; a write
   does. The kernel releases the lock on a crash. No simpler pure-Node.js
   mechanism is safe. Keep the file and add the write (finding 3).
3. **No cycle,** but row 23 omits the edges from the command-line tool to the
   engine and the tool server. The edit lists miss `pnpm-lock.yaml`, the root
   scripts, `SECURITY.md` and `docs/features.md` (findings 5, 10, 12).
4. **Several units use later work:** 4a uses 5a, 5b uses 6a.1, 4.6 and 6.7 need
   7a, and 8a's recorder needs 6b. Depending on 3 alone is fine for the copied
   ACP agent, because 3 depends on 2 (findings 6, 8).
5. **Keep it owner-only, but move it** to a debug group served only behind a
   test flag and compared at one sequence number. As a production RPC under
   criterion 7.5 it conflicts with the owner-only rule (findings 7, 9).
6. **Not stable.** `session/set_model` is a version 1 compatibility method,
   available only at generation 1. The stable mechanism is
   `session/set_config_option` (`model`, `thought_level`). The written
   fallback would refuse valid starts (finding 4).
7. **Mostly agree.** The overview, workstreams and sizing table agree on 18
   units, 12 + 8 + 1 = 21 acceptance files, and the four attack-pass units.
   The launch total is off by 6, and criterion 1.4 runs at a different
   rollout step from its unit (finding 12).

## Note on known gap 2

Effect's `effect/ai` in the vendored source has `McpServer.layerStdio`
(`packages/effect/src/ai/McpServer.ts:1437`), so the stdio transport very
likely exists in 4.0.5. Confirming it closes known gap 2 and removes the
fallback. That fallback is not workable in any case: ACP's HTTP MCP server
entries take a URL, which an adapter cannot point at a Unix socket.

## Post-build checks proposed

| Id | Scenario | Expected result | Evidence | Area |
|---|---|---|---|---|
| PB-A8 | Kill the service with `SIGKILL`, restart it, connect with the command-line tool | The service listens; the connection succeeds | Test output, criterion 6.7 or 7.4 | WS-7 |
| PB-A9 | Start two services at once against one `LGTM_HOME` | Exactly one runs; the other reports it and exits 0 | Two-process test log | WS-7 |
| PB-A10 | Record each real adapter's negotiated ACP generation and its config option categories | Recorded in the fixtures; the model and effort path chosen per harness | Fixture header, unit 6a report | WS-6 |
| PB-A11 | After a restart, a reloaded real agent calls an LGTM Studio tool during its carry-on turn | The call succeeds | Live-check log | WS-7 |
