import { collectSecrets } from "../accounts/collectSecrets.ts";
// Pattern: T3 Code packages/effect-acp/src/client.ts (`loadSession`, line 91;
// MIT licence; the copy here is third_party/t3code/effect-acp/src/client.ts)
// for the reload itself, through reload.ts. The recovery order is LGcode's
// own (decision rows 31, 52 and 66).
import { randomUUID } from "node:crypto";
import { BootId, Event as EventSchema, PermissionRequestId, WaitId, type AgentId, type Event } from "@lgcode/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import { returnAgents } from "../accounts/available.ts";
import { startAccountTimers } from "../accounts/timers.ts";
import { SecretStore } from "../commands/SecretStore.ts";
import { freshRequest, type Agent, type Runtime, type Snapshot } from "../commands/internal.ts";
import { mintAgentToken } from "../identity/tokens.ts";
import { EventLog, LogWriteFailed, RequestIdReused, type ProcessRow } from "../log/EventLog.ts";
import { dispatchQueued } from "../routing/deliveries.ts";
import { moveFromInterrupted, withdrawQueued } from "../routing/holders.ts";
import { withLane } from "../routing/lanes.ts";
import { withWaitChecks } from "../routing/waits.ts";
import { Runner } from "../runner/Runner.ts";
import { Views } from "../views/Views.ts";
import { linuxProcessReader, macosProcessReader, signalProcessGroup, sweepOrphans, type ProcessReader } from "./orphans.ts";
import { reload, SETUP_TIMEOUT_MILLIS, spawnInput } from "./reload.ts";
import { RecoveryAttempted, Restart } from "./service.ts";

export { RecoveryAttempted, Restart } from "./service.ts";

type AvailableCause = Extract<Event, { _tag: "AccountAvailable" }>["cause"];

export interface RestartOptions {
  readonly home: string;
  readonly stateFolder: string;
  readonly pluginRoot: string;
  // Process identity and signalling (row 31). The defaults are the host's
  // own; a host without a reader leaves every recorded group alone.
  readonly reader?: ProcessReader;
  readonly kill?: (groupId: number, signal: "SIGTERM" | "SIGKILL") => void;
  readonly graceMillis?: number;
  readonly killWaitMillis?: number;
  // Issue 103: how long one adapter setup may take before it is stopped.
  readonly setupTimeoutMillis?: number;
}

const owner = { _tag: "owner" } as const;
const decodeEvent = Schema.decodeUnknownSync(EventSchema);
const decodeBootId = Schema.decodeUnknownSync(BootId);
const decodePermissionRequestId = Schema.decodeUnknownSync(PermissionRequestId);
const decodeWaitId = Schema.decodeUnknownSync(WaitId);
const ignoreReused = <A>(value: A) => <B, E, R>(effect: Effect.Effect<B, E | RequestIdReused, R>): Effect.Effect<A | B, Exclude<E, RequestIdReused>, R> =>
  effect.pipe(Effect.catchIf((error): error is RequestIdReused => error instanceof RequestIdReused, () => Effect.succeed(value))) as never;
const readFailed = () => new LogWriteFailed({ reason: "database read failed" });

// Row 53: a usage reset returns only agents paused for a limit; the owner's
// mark-available returns sign-outs as well.
const returnable = (agent: Agent, accountId: string, cause: AvailableCause) =>
  agent.account === accountId && agent.state._tag === "paused" && (cause === "owner cleared" || agent.state.reason === "limit");

export const layer = (options: RestartOptions) => Layer.effect(Restart, Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const log = yield* EventLog;
  const views = yield* Views;
  const runner = yield* Runner;
  const secrets = yield* SecretStore;
  const services = yield* Effect.context<EventLog | Views | Runner | SecretStore | SqlClient.SqlClient>();
  const runtime: Runtime = { ...options, ...(log.lists === undefined ? {} : { lists: log.lists }), sql, log, views, runner, secrets };
  const reader = options.reader ?? (process.platform === "linux" ? linuxProcessReader : macosProcessReader);
  const timeoutMillis = options.setupTimeoutMillis ?? SETUP_TIMEOUT_MILLIS;
  const canReload = runner.capabilities.loadSession || runner.capabilities.resumeSession;
  const ready = yield* Deferred.make<void>();
  const running = yield* Semaphore.make(1);
  let completed = false;
  let attempted = false;
  let timersStarted = false;

  const write = (events: ReadonlyArray<Event>) => log.transact((append) => Effect.gen(function* () {
    const snapshot = yield* views.snapshot;
    const all = withWaitChecks(snapshot, events, log.lists);
    if (all.length > 0) yield* append(owner, freshRequest(), randomUUID(), all, {});
  })).pipe(ignoreReused(undefined));

  const liveAgents = sql<{ agent_id: string }>`SELECT DISTINCT agent_id FROM agent_tokens WHERE revoked_at IS NULL`.pipe(
    Effect.map((rows) => new Set(rows.map((row) => row.agent_id))),
    Effect.mapError(readFailed),
  );

  // Step 5, row 31 and issues 120 and 127. Only a group whose recorded
  // identity the reader proves is signalled; a reader that throws, or a
  // group that will not exit, is left alone. Recovery goes on either way,
  // and the diagnostic is fixed text.
  const sweep = Effect.gen(function* () {
    const rows = yield* sql<{ agent_id: string; group_id: number; boot_id: string; start_time: string; user_id: number; executable: string }>`
      SELECT agent_id, group_id, boot_id, start_time, user_id, executable FROM processes ORDER BY id`.pipe(Effect.mapError(readFailed));
    if (rows.length === 0) return;
    const recorded = rows.map((row): ProcessRow => ({
      agentId: row.agent_id as AgentId, groupId: Number(row.group_id), bootId: decodeBootId(row.boot_id),
      startTime: row.start_time, userId: Number(row.user_id), executable: row.executable,
    }));
    const results = yield* sweepOrphans({
      rows: recorded, reader, kill: options.kill ?? signalProcessGroup,
      graceMillis: options.graceMillis ?? 5_000, killWaitMillis: options.killWaitMillis ?? 5_000,
    });
    if (results.some((result) => result.reason === "group did not exit")) yield* Effect.logWarning("leftover process group did not exit");
  }).pipe(Effect.catchCause((cause) => Cause.hasInterrupts(cause)
    ? Effect.failCause(cause) : Effect.logWarning("leftover process sweep failed")));

  // Step 6. Starting, working and idle agents become interrupted with their
  // previous state; paused agents stay paused. The processes that asked open
  // permission requests are gone, so the requests are cancelled; committed
  // answers stay as they are and are never sent to a new process (issue 68).
  // Blocking waits belonged to connections that ended (row 66). Questions
  // stay open, and nothing tells the owner.
  const interrupt = Effect.gen(function* () {
    const snapshot = yield* views.snapshot;
    const events: Array<Event> = [];
    for (const agent of Object.values(snapshot.agents)) {
      const state = agent.state._tag;
      if (state === "starting" || state === "working" || state === "idle") {
        events.push({ _tag: "AgentInterrupted", agentId: agent.agentId, previous: state });
      }
    }
    for (const row of Object.values(snapshot.requests)) {
      if (row.status !== "open") continue;
      events.push({ _tag: "PermissionCancelled", agentId: row.agentId,
        permissionRequestId: decodePermissionRequestId(row.permissionRequestId), reason: "agent interrupted" },
      ...withdrawQueued(snapshot, row.deliveryId));
    }
    for (const row of Object.values(snapshot.waits)) {
      if (row.status === "open" && row.blocking) events.push({ _tag: "WaitCancelled", agentId: row.agentId, waitId: decodeWaitId(row.waitId), reason: "connection closed" });
    }
    if (events.length > 0) yield* write(events);
  });

  // Step 7 for one interrupted agent. An agent caught starting with no
  // session is started again. A reloadable agent is reloaded with a new
  // token. Any other agent stays interrupted until `resume --fresh`.
  const reloadInterrupted = (agentId: AgentId) => withLane(log, agentId)(Effect.gen(function* () {
    const snapshot = yield* views.snapshot;
    const agent = snapshot.agents[agentId];
    if (agent?.state._tag !== "interrupted") return false;
    const previous = agent.state.previous;
    const fresh = previous === "starting" && (agent.session === undefined || agent.reloadable !== true);
    if (!fresh && (agent.session === undefined || agent.reloadable !== true || !canReload)) return false;
    const reason = fresh ? "agent start failed" : "agent reload failed";
    const failed = (): ReadonlyArray<Event> => [{ _tag: "AgentReloadFailed", agentId, reason }];
    const token = mintAgentToken();
    const spawn = yield* spawnInput(runtime, snapshot, agent, token.token, "reload").pipe(Effect.result);
    if (spawn._tag === "Failure") {
      if (spawn.failure._tag === "LogWriteFailed") return yield* spawn.failure;
      yield* log.transact((append) => Effect.gen(function* () {
        const current = yield* views.snapshot;
        if (current.agents[agentId]?.state._tag !== "interrupted") return;
        yield* append(owner, freshRequest(), randomUUID(), withWaitChecks(current, failed(), log.lists), { revokeAgentTokens: [agentId] });
      })).pipe(ignoreReused(undefined));
      return false;
    }
    return yield* reload({
      runtime, actor: owner, agent, spawn: spawn.success, token, mode: fresh ? "start" : "load",
      midTurn: previous === "working", timeoutMillis, storeToken: true,
      still: (current) => current?.state._tag === "interrupted", failed,
    });
  }));

  // Row 66: the return of one paused agent with no live process. It is
  // reloaded, or started when it paused before its session opened (row 53,
  // issue 115), and only then made idle or given its carry-on. A failure
  // writes "agent reload failed" and the agent stays paused.
  const reloadPaused = (agentId: AgentId, accountId: string, cause: AvailableCause) => withLane(log, agentId)(Effect.gen(function* () {
    const snapshot = yield* views.snapshot;
    const agent = snapshot.agents[agentId];
    if (agent === undefined || agent.state._tag !== "paused" || !returnable(agent, accountId, cause)
      || snapshot.accounts[accountId]?.status !== "available") return false;
    const midTurn = agent.state.midTurn;
    const failed = (): ReadonlyArray<Event> => [{ _tag: "AgentReloadFailed", agentId, reason: "agent reload failed" }];
    const still = (current: Agent | undefined) => current?.state._tag === "paused";
    const start = agent.session === undefined;
    const token = mintAgentToken();
    const spawn = start || (agent.reloadable === true && canReload)
      ? yield* spawnInput(runtime, snapshot, agent, token.token, "reload").pipe(Effect.result) : undefined;
    if (spawn === undefined || spawn._tag === "Failure") {
      if (spawn?._tag === "Failure" && spawn.failure._tag === "LogWriteFailed") return yield* spawn.failure;
      yield* log.transact((append) => Effect.gen(function* () {
        const current = yield* views.snapshot;
        if (!still(current.agents[agentId])) return;
        yield* append(owner, freshRequest(), randomUUID(), withWaitChecks(current, failed(), log.lists), { revokeAgentTokens: [agentId] });
      })).pipe(ignoreReused(undefined));
      return false;
    }
    return yield* reload({
      runtime, actor: owner, agent, spawn: spawn.success, token, mode: start ? "start" : "load",
      midTurn, timeoutMillis, storeToken: true, carryText: "The pause has ended. Carry on with what you were doing.",
      still, failed,
    });
  }));

  // An account's return, in two parts. Agents whose process still runs go
  // idle in one transaction (accounts/available.ts); each agent without one
  // is then reloaded on its own. Returns the agents reloaded.
  const returnPaused = (accountId: string, cause: AvailableCause) => Effect.gen(function* () {
    const processless = yield* log.transact((append) => Effect.gen(function* () {
      const snapshot = yield* views.snapshot;
      if (snapshot.accounts[accountId]?.status !== "available") return [];
      const live = yield* liveAgents;
      const skip = new Set<AgentId>(Object.values(snapshot.agents)
        .filter((agent) => returnable(agent, accountId, cause) && !live.has(agent.agentId)).map((agent) => agent.agentId));
      const events = returnAgents(snapshot, accountId, cause, skip);
      if (events.length > 0) yield* append(owner, freshRequest(), randomUUID(), withWaitChecks(snapshot, events, log.lists), {});
      return [...skip] as ReadonlyArray<AgentId>;
    })).pipe(ignoreReused([] as ReadonlyArray<AgentId>));
    const reloaded: Array<AgentId> = [];
    for (const agentId of processless) if (yield* reloadPaused(agentId, accountId, cause)) reloaded.push(agentId);
    return reloaded;
  });

  // Step 8, rows 53 and 66, issue 116. The timers re-arm every logged reset
  // time and write an overdue "account available" now. An account that is
  // available, including one whose availability committed before the crash
  // and whose return never ran, then returns its paused agents. Their sends
  // wait for step 10.
  const returnAccounts = Effect.gen(function* () {
    if (!timersStarted) {
      yield* startAccountTimers;
      timersStarted = true;
    }
    const snapshot = yield* views.snapshot;
    const rows = yield* sql<{ payload_json: string }>`
      SELECT payload_json FROM events WHERE event_type = 'AccountAvailable' ORDER BY sequence`.pipe(Effect.mapError(readFailed));
    const causes = new Map<string, AvailableCause>();
    yield* Effect.try({
      try: () => {
        for (const row of rows) {
          const event = decodeEvent(JSON.parse(row.payload_json));
          if (event._tag === "AccountAvailable") causes.set(event.accountId, event.cause);
        }
      },
      catch: () => new LogWriteFailed({ reason: "stored event is unreadable" }),
    });
    const reloaded: Array<AgentId> = [];
    for (const account of Object.values(snapshot.accounts)) {
      const cause = causes.get(account.id);
      if (account.status !== "available" || cause === undefined) continue;
      if (!Object.values(snapshot.agents).some((agent) => returnable(agent, account.id, cause))) continue;
      reloaded.push(...yield* returnPaused(account.id, cause));
    }
    return reloaded;
  });

  // Step 9. Holders are re-evaluated once: only requests and questions whose
  // holder stayed interrupted move. The same append re-checks every open wait.
  const reevaluate = log.transact((append) => Effect.gen(function* () {
    const snapshot = yield* views.snapshot;
    const events = withWaitChecks(snapshot, moveFromInterrupted(snapshot), log.lists);
    if (events.length > 0) yield* append(owner, freshRequest(), randomUUID(), events, {});
  })).pipe(ignoreReused(undefined));

  // Step 10: each agent sends the head of its queue. A reloaded agent left
  // working sends its re-sent delivery or carry-on; an idle one, what was
  // queued before the restart (issue 88). One failed send does not stop the
  // others, and is logged without content.
  const sendQueued = (snapshot: Snapshot, recovered: ReadonlySet<string>) => Effect.forEach(Object.values(snapshot.agents), (agent) =>
    dispatchQueued(agent.agentId, { recovered: recovered.has(agent.agentId) }).pipe(
      ignoreReused(undefined),
      Effect.catchCause((cause) => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("delivery dispatch failed")),
    ), { discard: true });

  const recoverOnce = Effect.gen(function* () {
    // Step 3: the views were rebuilt from the log when the Views layer was built.
    // Step 4: every agent token, before anything can reach a leftover process.
    yield* log.append(owner, freshRequest(), randomUUID(), [], { revokeAgentTokens: "all" }, false).pipe(ignoreReused([]));
    yield* sweep;
    yield* interrupt;
    yield* collectSecrets(yield* views.snapshot, log.lists);
    const recovered = new Set<string>();
    for (const agent of Object.values((yield* views.snapshot).agents)) {
      if (agent.state._tag === "interrupted" && (yield* reloadInterrupted(agent.agentId))) recovered.add(agent.agentId);
    }
    for (const agentId of yield* returnAccounts) recovered.add(agentId);
    yield* reevaluate;
    yield* Deferred.succeed(ready, undefined);
    yield* sendQueued(yield* views.snapshot, recovered);
    completed = true;
  }).pipe(Effect.provide(services));

  return Restart.of({
    ready: Deferred.isDone(ready),
    whenReady: Deferred.await(ready),
    // Ruling 3 of fix round 1: one attempt per service (see `Restart.recover`).
    // A call that waited behind a running attempt sees its outcome.
    recover: running.withPermits(1)(Effect.suspend((): Effect.Effect<void, LogWriteFailed | RecoveryAttempted, Scope.Scope> => {
      if (completed) return Effect.void;
      if (attempted) return Effect.fail(new RecoveryAttempted({ reason: "recovery already attempted; start a new engine" }));
      attempted = true;
      return recoverOnce;
    })),
    returnAccount: (accountId, cause) => Effect.gen(function* () {
      const reloaded = yield* returnPaused(accountId, cause);
      // Row 66: a returned agent's queue is sent once, as at step 10.
      for (const agentId of reloaded) yield* dispatchQueued(agentId, { recovered: true }).pipe(ignoreReused(undefined));
    }).pipe(Effect.provide(services)),
  });
}));
