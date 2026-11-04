# Scouting: shepherd-message-board

Gate 8's anchor source. Every scan below was made on the worktree
`foundry-plans-board`, branch `worker/plans-board`, at commit `8ff4c9b`
(the engine as merged on `engine`). Paths are relative to the repository
root unless a line says otherwise.

## Scan 1: the planner's own reading (2026-11-03)

- `packages/contracts/src/commands.ts`: `commandNames`, `ownerOnlyCommands`,
  `commandAccess`, `CommandsRpcGroup` (built with `RpcGroup.make(...)` and
  `.merge(DebugRpcGroup)`), `ServiceRpcGroup = CommandsRpcGroup.omit(...)`.
  `prompt` takes `{ requestId, agentId, text }` and returns a `deliveryId`.
- `packages/contracts/src/events.ts`: `Actor` (owner or agent), `Delivery`
  (`content`: prompt, compact or carry-on; optional `source`: permission,
  question or wait), `Event` (a closed `Schema.Union` of tagged structs),
  `EventEnvelope` (sequence, eventId, occurredAt, caller, optional requestId,
  optional agentId, event). `OwnerNeeded` has `agentId`, `reason` and an
  optional `subject` (permission or question).
- `packages/engine/src/commands/CommandHandler.ts`: `supported` (a closed
  set of command names), `targeted`, `planCommand` (a closed switch),
  `replyFor`, `layer` (forks `runner.events`, `dispatchCommitted` and
  `followAvailability` for the service's life), `execute` (identifies the
  caller, checks the receipt, plans, appends with `withWaitChecks`).
  The `prompt` command is allowed for an agent caller only when
  `holderAbove(snapshot, agentId)` is that caller.
- `packages/engine/src/routing/deliveries.ts`: `nextQueued`, `returnTo`
  (an engine notice to an agent sender uses `sender: owner` and
  `envelope(id, text)`), `movedOrWake` (a `wait` source is withdrawn and
  never returned), `targetGone`, `dispatchQueued` (writes `DeliverySent`,
  then calls `runner.prompt` or `runner.compact`), `readyAfter`,
  `dispatchCommitted` (a follower on `log.subscribeCommitted`).
- `packages/engine/src/routing/envelope.ts`: `escapeLeadingSlash`,
  `envelope` (fresh random marker per envelope), `agentText`.
- `packages/engine/src/runner/Runner.ts`: `Runner` service (`start`, `load`,
  `prompt`, `cancel`, `answerPermission`, `setMode`, `compact`, `stop`,
  `capabilities`, `events`). `prompt` takes `{ agentId, incarnation,
  delivery }` and knows nothing of the sender. This is the engine's one
  delivery interface.
- `packages/contracts/src/events.ts`: `SessionReference` already has an
  `interactive` case with a `paneId`.
- `packages/mcp/src/tools.ts`: `toolNames` (explicit allow-list),
  `descriptions`, `inputSchema` (reads `CommandsRpcGroup`), and a load-time
  check that each tool is `agent-callable`.
- `packages/engine/src/service.ts`: `program` (lock, socket, owner
  credential, database, migrations, layers).

## Scan 2: Explore scout, 2026-11-03 (verbatim return)

Paths relative to `packages/`.

1. subscribe.ts:subscribe (l.58) does NOT filter per caller (it replays and then streams all rows). The filter is in engine/src/api/server.ts:application, the "subscribe" handler, l.~149-155, using Stream.filterEffect. Owner and device callers see all events (agentId === undefined means pass). An agent caller sees an envelope only if envelope.agentId is defined AND (envelope.agentId === caller agentId OR snapshot.agents[envelope.agentId].parent is that agent), i.e. its own thread plus direct children only (not grandchildren). Envelopes with no agentId are hidden from agents.
2. views/apply.ts:apply (l.~338) is NOT one exhaustive switch. It calls per-view reducers (agentsAfter, requestsAfter, questionsAfter, waitsAfter, deliveriesAfter, accountsAfter, devicesAfter) plus threadAgent. Each reducer is a switch on event._tag with `default: return state.<view>` (l.210, 230, 246, 268, 293, 322, 332). No never-check or throw: unhandled tags are ignored. nextState (l.~150) uses eventEffect from contracts.
3. routing/waits.ts:settled (l.39). Yes, queued/sent deliveries make it not settled: `!Object.values(state.deliveries).some((row) => row.target === id && (row.status === "queued" || row.status === "sent"))`. It also requires state idle, no open requests or questions for the agent, no held requests, and no open non-blocking waits. reasonOf (l.49) calls it.
4. api/server.ts:application l.~134. One generic route: `group.toHandlers(Object.fromEntries([...group.requests.keys()].map(name => ...)))`. Special cases for "subscribe" and "debug.compare-views"; everything else is `handler.execute(credential, name, payload)` (CommandHandler.execute). The group is `(options.debug ? CommandsRpcGroup : ServiceRpcGroup)` from @shephrd/contracts, so ServiceRpcGroup in non-debug mode (CommandsRpcGroup in debug).
5. CLI: cli/src/commands/registry.ts:commandNames = [...CommandsRpcGroup.requests.keys()], plus `summaries: Record<CommandName,string>` (a new command needs an entry there), isCommand, matchCommand, helpText. Commands come from contracts/src/commands.ts:commandNames, ownerOnlyCommands, commandAccess. MCP: mcp/src/tools.ts:toolNames (explicit allow-list: answer, ask, compact, group, pass-up, prompt, resume, start, stop, wait) plus `descriptions: Record<ToolName,string>`; a module-load check requires commandAccess[name]==="agent-callable"; inputSchema(name) reads CommandsRpcGroup. mcp/src/server.ts:buildToolkit maps toolNames to Tool.dynamic.
6. log/migrations.ts tables: events, receipts, agent_tokens, devices, processes, plus schema_migrations (bookkeeping).
7. commands/prompt.ts: yes, it imports and uses `agentText(actor, id, payload.text)` from ../routing/envelope.ts (l.4, l.10). It does not import `envelope` directly. waits.ts uses `envelope` for engine notices.
8. views/compare.ts:compareViews (l.55; also CompareHeadMismatch), views/rebuild.ts:rebuild (l.22). Test helper: engine/test/support/rebuildCheck.ts:registerRebuildCheck, whose header says every engine test file registers it and the comparison runs after each test (finalizer). Yes. It is also exposed as the RPC "debug.compare-views" (engine/test/api/compare-views-rpc.test.ts).
9. Acceptance suite: engine/test/acceptance/ (capability-01..12-*.test.ts, failure-1..8-*.test.ts, flow-start-to-finish.test.ts, secret-scan.test.ts). Main support file: engine/test/support/acceptance.ts (Spec, Started, World, ownerEnvironment). Fake agent: testing/src/fakeAgent.ts. The script is the JSON env var FAKE_AGENT_SCRIPT parsed into `interface Script` (l.62). The step types are `Step = DiagnosticStep | StepDiagnostic` (l.26) with steps shaped `{ step: "<name>", ... }`, e.g. `{ step: "exec"; argv: string[] }`. DiagnosticStep uses `type:` and is normalized to `step:`.
10. grep -rni "interactive" engine/src: no hits. No interactive-mode runner or stub in engine/src.
11. contracts/src/stateMachine.ts:commandOutcome (l.60) = commandTable[state][command], with `commandTable: Record<StateName, Record<Command, Outcome>>` (l.12). `type Command` (l.9) = "prompt" | "compact" | "resume" | "stop" | "group". Other exports: eventEffect (l.122), canTransition (l.72), displayedState.
12. routing/holders.ts:holderAbove (l.21) returns the nearest available ancestor agent of the given agent as an Actor (skipping ids in `leaving`), otherwise the owner (also on a broken or cyclic ancestry).
13. contracts/src/ids.ts: branded NonEmptyString with no prefix. Example: `export const AgentId = Schema.NonEmptyString.pipe(Schema.brand("AgentId")); export type AgentId = typeof AgentId.Type`. AccountId and HarnessId use a Slug pattern, `Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/))`. Agent tokens use the "shp_a_" prefix (server.ts l.90).
14. Whole-word grep of "board", "channel" and "post" in packages/**/*.ts, excluding comment-only lines and node_modules: no identifier hits. The only matches are the words "post" or "POST" in test titles and strings, in engine/test/routing/fix-round-one.test.ts:364, engine/test/live-check/redaction.test.ts:67 and engine/test/views/apply.test.ts:273. No board, channel or post identifiers.
15. log/EventLog.ts: service members `append` (type Append, l.~70), `transact` (l.87, impl l.242; append is `transact(write => write(...args))` at l.279), `subscribeCommitted` (l.81, impl l.286 = PubSub.subscribe(committedEvents)). Append does NOT validate input events against the contracts Event schema. It redacts each event (redactor.redact), INSERTs JSON.stringify(event), then decodes the resulting EventEnvelope with Schema.decodeUnknownSync(EventEnvelope) (l.182). That decode happens after the INSERT, inside the transaction, so a schema failure would throw.

## What the scans mean for the board (planner's reading)

- The board cannot be added without touching engine files. Board commands
  need entries in `CommandHandler.ts:supported` and `planCommand`, board
  events need tags in the closed `Event` union (or the post-insert decode in
  `EventLog.ts` throws), and a board wake to a non-child needs a delivery
  path other than the `prompt` command. This is decision row 9's question.
- Board events that carry no top-level `agentId` are hidden from agent
  subscribers by the existing filter in `api/server.ts:application`, so a
  direct message never leaks to a member's parent through `subscribe`.
- The existing `apply` reducers ignore unknown tags, so board views can be a
  separate reducer and the engine's eight views stay unchanged.
- A queued board wake makes its target not settled (`waits.ts:settled`), so
  an orchestrator waiting on a lead is not woken while the lead still has a
  post to answer.
