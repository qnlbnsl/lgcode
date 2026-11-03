# Scouting — shepherd-client-api

Gate 8's anchor source. Paths are relative to the repository root, at engine
commit `8ff4c9b`.

## Scout 1: the engine's API surface (2026-11-03)

Explore scout, read-only. Return, as given:

**1. RPC groups.** Several groups, all in `packages/contracts/src/commands.ts`:
`DebugRpcGroup` (l.36) holds only `debug.compare-views`; `CommandsRpcGroup`
(l.44) is the full inventory and ends with `.merge(DebugRpcGroup)` (l.135);
`ServiceRpcGroup` (l.137) is `CommandsRpcGroup.omit("debug.compare-views")`.
Rpc tags, 16 (`commandNames` l.10): start, prompt, answer, pass-up, ask, wait,
stop, resume, compact, group, accounts, "accounts set-secret", "accounts
mark-available", harnesses, subscribe (`stream: true`), debug.compare-views.
Owner-only list: `ownerOnlyCommands` (l.16); `commandAccess` (l.20) derived,
values "agent-callable" or "owner-only"; enforced at
`packages/engine/src/commands/CommandHandler.ts:70`
(`owners.has(name) && actor._tag !== "owner"`). Request id: field
`requestId`, type `RequestId` (`packages/contracts/src/ids.ts:7`, branded
NonEmptyString), carried via `const request = { requestId: RequestId }`
(commands.ts:24) in every payload and reply; `Ack` (l.26) and `Refused`
(`CommandError`, l.27) carry it. Extension point: `RpcGroup.merge` used
(commands.ts:135), **no registry**. The server enumerates
`group.requests.keys()` (`packages/engine/src/api/server.ts:153`); the client
enumerates `CommandsRpcGroup.requests` (`packages/client/src/index.ts:218`);
the CLI enumerates `CommandsRpcGroup.requests.keys()`
(`packages/cli/src/commands/registry.ts:10`); the server is hard-wired to
`CommandsRpcGroup` or `ServiceRpcGroup` (server.ts:85); `supported`
(CommandHandler.ts:~56) is a hard-coded set of command names. **A new group
needs edits in all these places.**

**2. Events.** Union `Event` (`packages/contracts/src/events.ts:88`). Tags:
AgentStarted, AgentStartFailed, SessionOpened, PromptSent, ThreadItem,
TurnStarted, TurnEnded, StateChanged, ModeChanged, ModeRefused,
PermissionRequested, PermissionAnswered, PermissionMoved,
PermissionCancelled, QuestionAsked, QuestionAnswered, QuestionMoved,
OwnerNeeded, WaitOpened, WaitMemberResolved, WaitSatisfied, WaitCancelled,
DeliveryQueued, DeliverySent, DeliveryAccepted, DeliveryRequeued,
DeliveryReturned, DeliveryWithdrawn, AgentCrashed, AgentInterrupted,
AgentReloadFailed, AgentStopped, AgentGrouped, AccountChanged,
AccountNeedsSignIn, AccountOutOfUsage, AccountAvailable, HarnessChanged,
DeviceAdded, DeviceRevoked, CommandRefused. Most carry `agentId` (the `agent`
spread, l.79); exceptions: DeliveryQueued (`delivery.target`), Account*,
HarnessChanged, Device*, CommandRefused. `OwnerNeeded` (events.ts:143-150):
`agentId`, `reason: String`, `subject?: permission{id} | question{id}`.
`DeviceAdded` (l.177): `deviceId`, `name`. `DeviceRevoked` (l.178):
`deviceId`. Envelope `EventEnvelope` (events.ts:184): `sequence`, `eventId`,
`occurredAt`, `caller: Actor`, `requestId?`, `agentId?`, `event`. `Actor`
(events.ts:8) is `owner | agent{agentId}`; **no device tag**.

**3. subscribe.** Request `{ requestId, after: EventSequence }`
(commands.ts:132); 0 means from the start. Stream element `EventEnvelope`,
error `Refused` (l.133). Catch-up and live: `subscribe(after)` in
`packages/engine/src/log/subscribe.ts:58`; fails with `SubscribeAheadOfHead`
or `SubscribeInvalidCursor`; pages 512 rows then joins live. Per-caller
visibility: inline `Stream.filterEffect` in server.ts:155-159, not a named
function. Owner and device see everything. An agent sees an envelope only if
`envelope.agentId` is set and is itself or a child (parent in the views
snapshot). Envelopes without `agentId` are hidden from agents. Test:
`packages/engine/test/api/subscribe-visibility.test.ts`. **No filter by event
type or agent in the request.** Subscribe re-authenticates via
`authenticateRequest` (server.ts:113).

**4. Identity.** Wire credential union `Credential`
(CommandHandler.ts:45): owner, device, agent. A device credential maps to
`actor = { _tag: "owner" }` (CommandHandler.ts:207): **a device acts as the
owner and the log records "owner"**. Log caller strings "owner" or
"agent:<id>" (subscribe.ts:38). Client `Identity.kind` "agent" or "owner"
(`packages/client/src/identity.ts:8`). Device credentials: minted by
`mintDeviceCredential` (`packages/engine/src/identity/devices.ts:12`) via
`mintCredential("shp_d_")` (`identity/credential.ts:66`), format prefix + 32
random bytes base64url + "_" + 8 hex checksum; hashed with `sha256Hex`
(credential.ts:62); stored in table `devices`
(`packages/engine/src/log/migrations.ts:45`: device_id, name, token_hash
UNIQUE, created_at, revoked_at), inserted via `sideRows.devices`
(`log/EventLog.ts:202-204`), revoked via `sideRows.revokeDevices`
(EventLog.ts:64,199-200); verified by `verifyDeviceCredential`
(devices.ts:18); views at `views/apply.ts:328,331`; redactor input at
`packages/engine/src/service.ts:87`. **Pairing: none.** Nothing emits
DeviceAdded or DeviceRevoked; no RPC or CLI for it. Owner credential file
`owner-credential` in the state folder (`identity/ownerCredential.ts:197`,
`filename` l.105). Socket `<state folder>/engine.sock`. Owner ancestry check
`outsideAdapters` (`packages/engine/src/api/ancestry.ts:11`), applied at
server.ts:107; headers `shephrd-ancestors`, `shephrd-process-group`; Linux
only; owner credential only, device credential skips it; client side
`ancestryHeaders` (`packages/client/src/ancestry.ts:16`).

**5. Server.** `Authorization: Bearer` parsed at server.ts:101. `authenticate`
(l.87): owner by `timingSafeEqual`, then `shp_a_` via `verifyAgentToken`,
then `verifyDeviceCredential`. Non-owner credentials re-checked on every
committed batch and every 100 ms (l.119-126). Non-WebSocket upgrade: 400.
Recovering: 503. **TCP: none**; `listen(socketPath)` (l.52) on a Unix socket;
client connects to `ws+unix://<socket>:/` (client/src/index.ts:130). Wiring:
`RpcServer.makeProtocolWithHttpEffectWebsocket` with
`RpcSerialization.layerJson` (l.128); `boundedProtocol` (l.130): 5 s chunk ack
deadline, invalidation at a 2,048-event backlog; `RpcServer.make(group)`
(l.168) with `group.toHandlers(...)` (l.153); `subscribe` and
`debug.compare-views` inline; everything else to `CommandHandler.execute`
(CommandHandler.ts:51, ~196).

**6. Request id dedupe.** Table `receipts`, PRIMARY KEY (caller, request_id)
(migrations.ts:29-36), with `body_hash`, `result_json`. Check at
CommandHandler.ts:~237-257: a different body is refused "request id reused";
the same body replays the stored reply. **Scoped per caller; a device uses
"owner", so devices share the owner's scope.** Subscribe is not deduped.

**7. Client.** `connect(options)` (`packages/client/src/index.ts:117`)
returns `Effect<Client, ClientError, Scope>`; checks the socket, reconnects
on transport errors (3 attempts); its `subscribe` helper resumes from the
last delivered sequence. **No wait helper over subscribe.** MCP tools:
`packages/mcp/src/tools.ts:7`; `subscribe` is not an MCP tool.

**8. Alerts.** No alert, notify or push event or field exists.

**9. Test.** `packages/contracts/test/commands.test.ts` asserts the sixteen
commands, the five owner-only commands, ten MCP-offered commands, a
non-empty `requestId` in every payload and reply, and group sizes (15, 16, 1).

**10. Effect.** `effect: 4.0.5` in the `pnpm-workspace.yaml` catalog; import
path `effect/rpc/*` (not `@effect/rpc`); platform imports
`@effect/platform-node/NodeHttpServer`, `@effect/platform-node/NodeSocket`.

## Planner's own checks (2026-11-03)

- `OwnerNeeded` has three producers, each with a fixed reason string:
  `packages/engine/src/routing/holders.ts:49` ("request needs the owner",
  with `subject`), `packages/engine/src/recovery/crash.ts:69` ("agent
  crashed", when the crashed agent's holder is the owner), and
  `packages/engine/src/routing/deliveries.ts:194` ("account needs sign-in",
  or "account is out of usage, no reset time known").
- `Ack` is `Schema.Struct({ requestId })` (commands.ts:26): a reply does not
  carry the sequence number it committed.
- Effect 4.0.5 source, `node_modules/.pnpm/effect@4.0.5/node_modules/effect/src/rpc/`:
  `RpcGroup.merge` (RpcGroup.ts:269) copies each group's requests into one
  map keyed by tag, **so a later group silently replaces a same-named
  command**; `RpcGroup.prefix` (RpcGroup.ts:324) renames every request to
  `${prefix}${tag}` (Rpc.ts:150); `RpcGroup.middleware` (RpcGroup.ts:68) and
  `RpcMiddleware.Service` (RpcMiddleware.ts:278) exist.
- `docs/issues.md` issue 65 (no event withdraws an owner alert) is left to
  piece 2 or the lead; issue 75 (no owner waiter) is answered by owner choice
  A10 and lead ruling L1; issue 164 (agent-less events hidden from agents)
  stands.
