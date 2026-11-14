import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  AgentId, Event as EventSchema, RequestId,
  type Actor, type Event, type HarnessSettings, type LifecycleState, type PermissionLevel,
} from "@lgtm/contracts";
import * as SqliteClient from "@lgtm/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import type * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import type * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as CommandHandler from "../../src/commands/CommandHandler.ts";
import * as SecretStore from "../../src/commands/SecretStore.ts";
import { mintAgentToken } from "../../src/identity/tokens.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Redactor from "../../src/log/Redactor.ts";
import * as Views from "../../src/views/Views.ts";
import { seedFakeProcess, type FakeRunner } from "./fakeRunner.ts";
import { Runner } from "../../src/runner/Runner.ts";

// Shared setup for the unit 5b tests (lifecycle, authorization, handler). It
// holds no assertion. Each test file still registers the rebuild check itself
// (row 63), because the guard test reads the file for the call.

export const agentIdOf = Schema.decodeUnknownSync(AgentId);
export const requestIdOf = Schema.decodeUnknownSync(RequestId);
const decodeEvent = Schema.decodeUnknownSync(EventSchema);
export const eventOf = decodeEvent;
export const freshRequest = () => requestIdOf(randomUUID());

// A temporary tree. Every folder a test inspects lives under `root`, which is
// under /tmp. `outside` is beside `work`, so it is neither inside a parent's
// folder nor inside a refused folder.
export interface Rig {
  readonly root: string;
  readonly home: string;
  readonly stateFolder: string;
  readonly pluginRoot: string;
  readonly work: string;
  readonly outside: string;
  readonly database: string;
}

// Seeded agents work here unless a case says otherwise: a folder that is
// neither home, the state folder nor the plugin root, nor contains them.
let defaultFolder = "/tmp";

export const makeRig = (): Rig => {
  const root = realpathSync(mkdtempSync("/tmp/lgtm-commands-"));
  const rig = {
    root, home: join(root, "home"), stateFolder: join(root, "state"), pluginRoot: join(root, "plugin"),
    work: join(root, "work"), outside: join(root, "outside"), database: join(root, "events.sqlite"),
  };
  for (const folder of [rig.home, rig.stateFolder, rig.pluginRoot, rig.work, rig.outside]) mkdirSync(folder);
  defaultFolder = rig.work;
  return rig;
};

export const removeRig = (rig: Rig): void => rmSync(rig.root, { recursive: true, force: true });

export const folderIn = (rig: Rig, ...names: ReadonlyArray<string>): string => {
  const path = join(rig.work, ...names);
  mkdirSync(path, { recursive: true });
  return path;
};

// The in-memory stand-in for `secrets.json` (decision row 19). It keeps the
// values so a test can ask whether a reference resolves, and so it can search
// every other place for them.
export interface FakeSecrets {
  readonly layer: Layer.Layer<SecretStore.SecretStore>;
  readonly stored: ReadonlyMap<string, string>;
}

export const makeFakeSecrets = (): FakeSecrets => {
  const stored = new Map<string, string>();
  return {
    stored,
    layer: Layer.succeed(SecretStore.SecretStore, {
      put: (reference, value) => Effect.sync(() => { stored.set(reference, Redacted.value(value)); }),
      resolve: (reference) => Effect.sync(() => {
        const value = stored.get(reference);
        return value === undefined ? undefined : Redacted.make(value);
      }),
    }),
  };
};

export interface Fakes {
  readonly harnessPrograms?: import("../../src/harnesses/programs.ts").HarnessPrograms;
  readonly runner: FakeRunner;
  readonly secrets: FakeSecrets;
  // WS-7b: the production default declines until the roles condition exists.
  // Tests inject only that pure policy; planning, dispatch and writes stay real.
  readonly capacityHoldCondition?: (agentId: AgentId, snapshot: import("../../src/commands/internal.ts").Snapshot) => unknown;
  readonly lists?: import("../../src/pieces/lists.ts").EngineLists;
  // The harness defaults the service loads on a first start and on
  // `harnesses reset`. A rig that leaves it out has none (fix round 1, N-1).
  readonly harnessDefaults?: Effect.Effect<ReadonlyArray<HarnessSettings>>;
  // Replaces the pass-through redactor, for the side-row text test.
  readonly redactor?: Layer.Layer<Redactor.Redactor>;
  // Decorates the real writer to hold a post-COMMIT boundary deterministically.
  readonly wrapLog?: (real: Context.Service.Shape<typeof EventLog.EventLog>) => Context.Service.Shape<typeof EventLog.EventLog>;
}

// Migrates the file, then builds the event log, the live views, the command
// handler (with the fake runner and the fake secret store) and runs `program`
// in a scope that closes before they do, so a finalizer registered by
// `registerRebuildCheck()` still finds the log open.
export const provideRig = <A, E, R>(
  rig: Rig, fakes: Fakes, program: Effect.Effect<A, E, R>,
) => {
  const baseLog = EventLog.makeLayer(fakes.lists).pipe(
    Layer.provideMerge(Views.makeLayer(fakes.lists)), Layer.provide(fakes.redactor ?? Redactor.layer),
  );
  const log = fakes.wrapLog === undefined ? baseLog : Layer.effect(EventLog.EventLog,
    Effect.map(EventLog.EventLog, fakes.wrapLog),
  ).pipe(Layer.provideMerge(baseLog));
  const services = CommandHandler.layer({
    ...(fakes.harnessPrograms === undefined ? {} : { harnessPrograms: fakes.harnessPrograms }),
    home: rig.home, stateFolder: rig.stateFolder, pluginRoot: rig.pluginRoot,
    ...(fakes.capacityHoldCondition === undefined ? {} : { capacityHoldCondition: fakes.capacityHoldCondition }),
    ...(fakes.harnessDefaults === undefined ? {} : { harnessDefaults: fakes.harnessDefaults }),
  }, fakes.lists).pipe(
    Layer.provideMerge(log),
    Layer.provide(Layer.merge(fakes.runner.layer, fakes.secrets.layer)),
  );
  return Effect.gen(function* () {
    yield* migrate;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL`;
    return yield* Effect.scoped(program).pipe(Effect.provide(services), Effect.provide(fakes.runner.layer));
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })),
    Effect.scoped,
  );
};

// A caller, as the transport hands it to the handler. The owner is
// authenticated by the transport itself; agents present a
// credential the handler checks inside the writer (criterion 5.1).
export type Credential =
  | { readonly _tag: "owner" }
  | { readonly _tag: "agent"; readonly token: Redacted.Redacted<string> };

export const ownerCredential: Credential = { _tag: "owner" };
export const agentCredential = (raw: string): Credential => ({ _tag: "agent", token: Redacted.make(raw) });

// The test seam to the handler. The handler's static signature is its
// builder's to choose, so the payload is cast here, in one place.
export const call = (credential: Credential, name: string, payload: Record<string, unknown>) =>
  Effect.gen(function* () {
    const handler = yield* CommandHandler.CommandHandler;
    return yield* (handler.execute as (c: Credential, n: string, p: unknown) => ReturnType<typeof handler.execute>)(
      credential, name, { requestId: freshRequest(), ...payload },
    ).pipe(Effect.result);
  });

export interface Logged {
  readonly sequence: number;
  readonly caller: Actor;
  readonly requestId: string;
  readonly event: Event;
}

export const readLog = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ sequence: number; caller: string; request_id: string; payload_json: string }>`
    SELECT sequence, caller, request_id, payload_json FROM events ORDER BY sequence`;
  return rows.map((row): Logged => ({
    sequence: row.sequence,
    caller: row.caller === "owner" ? { _tag: "owner" } : { _tag: "agent", agentId: agentIdOf(row.caller.slice("agent:".length)) },
    requestId: row.request_id,
    event: decodeEvent(JSON.parse(row.payload_json)),
  }));
});

// The events written after `sequence`.
export const logAfter = (sequence: number) => readLog.pipe(Effect.map((rows) => rows.filter((row) => row.sequence > sequence)));
export const headSequence = readLog.pipe(Effect.map((rows) => rows.at(-1)?.sequence ?? 0));

// Appends test setup as the owner, with no side rows unless given.
export const appendSetup = (events: ReadonlyArray<Event>, sideRows: EventLog.SideRows = {}) => Effect.gen(function* () {
  const log = yield* EventLog.EventLog;
  return yield* log.append({ _tag: "owner" }, freshRequest(), randomUUID().replaceAll("-", "").padEnd(64, "0"), events, sideRows);
});

export const seedAccount = (accountId = "primary", harness = "first") =>
  appendSetup([decodeEvent({
    _tag: "AccountChanged", accountId, account: { id: accountId, harness, displayName: "Primary", enabled: true },
  })]);

// The settings of the harness the seeded agents use, so a `start` is checked
// against settings that exist.
export const seedHarness = (id = "first") => appendSetup([decodeEvent({ _tag: "HarnessChanged", harness: harnessSettings(id) })]);

export type SeedState = "starting" | "working" | "idle" | "paused" | "interrupted" | "crashed" | "stopped";

export interface SeedAgent {
  readonly id: string;
  readonly name?: string;
  readonly parent?: string | undefined; // an agent id; absent means the owner
  readonly state?: SeedState | undefined;
  readonly folder?: string | undefined;
  readonly permission?: PermissionLevel | undefined;
  readonly reloadable?: boolean | undefined;
  readonly groups?: ReadonlyArray<string> | undefined;
}

// An agent written through the log, as the engine itself would have left it,
// with a live token unless it is crashed or stopped (crash and stop revoke).
// Returns the raw token so a test can call as that agent.
export const seedAgent = (spec: SeedAgent) => Effect.gen(function* () {
  const agentId = agentIdOf(spec.id);
  const state = spec.state ?? "idle";
  const token = mintAgentToken();
  const parent: Actor = spec.parent === undefined ? { _tag: "owner" } : { _tag: "agent", agentId: agentIdOf(spec.parent) };
  const events: Array<Event> = [decodeEvent({
    _tag: "AgentStarted", agentId, name: spec.name ?? `name-${spec.id}`, role: "worker", groups: spec.groups ?? [], parent,
    harness: "first", account: "primary", permission: spec.permission ?? "ask", folder: spec.folder ?? defaultFolder,
    runMode: "acp", model: "test-model", effort: "high",
  })];
  if (state !== "starting") {
    events.push(decodeEvent({
      _tag: "SessionOpened", agentId, session: { _tag: "acp", sessionId: `session-${spec.id}` },
      protocolVersion: 2, reloadable: spec.reloadable ?? true,
      configuration: { model: "test-model", effort: "high" },
    }));
  }
  const after: Record<SeedState, ReadonlyArray<Event>> = {
    starting: [], idle: [],
    // A working historical process has a real current turn. Turn-end
    // correlation must not be weakened to accommodate an impossible fixture.
    working: [
      decodeEvent({ _tag: "DeliveryQueued", delivery: { id: `seed-turn-${spec.id}`, target: agentId, sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Historical current turn." } } }),
      decodeEvent({ _tag: "DeliverySent", agentId, deliveryId: `seed-turn-${spec.id}`, method: "acp" }),
      decodeEvent({ _tag: "DeliveryAccepted", agentId, deliveryId: `seed-turn-${spec.id}` }),
    ],
    paused: [decodeEvent({ _tag: "StateChanged", agentId, state: { _tag: "paused", reason: "limit", midTurn: false } satisfies LifecycleState })],
    interrupted: [decodeEvent({ _tag: "AgentInterrupted", agentId, previous: "idle" })],
    crashed: [decodeEvent({ _tag: "AgentCrashed", agentId, exitCode: 1, signal: null, stderr: "fake crash" })],
    stopped: [decodeEvent({ _tag: "AgentStopped", agentId })],
  };
  const revoked = state === "crashed" || state === "stopped";
  yield* appendSetup([...events, ...after[state]], {
    agentTokens: [{ agentId, tokenHash: token.tokenHash, revokedAt: revoked ? 1 : null }],
  });
  seedFakeProcess(yield* Runner, agentId, Redacted.value(token.token), !revoked);
  return { agentId, token: Redacted.value(token.token) };
});

// A new token for an agent that already has one, revoking the earlier ones.
export const rotateToken = (agentId: AgentId) => Effect.gen(function* () {
  const token = mintAgentToken();
  yield* appendSetup([decodeEvent({ _tag: "AgentGrouped", agentId, groups: [] })], {
    revokeAgentTokens: [agentId],
    agentTokens: [{ agentId, tokenHash: token.tokenHash, revokedAt: null }],
  });
  seedFakeProcess(yield* Runner, agentId, Redacted.value(token.token), true);
  return Redacted.value(token.token);
});

// Revokes an agent's tokens with no other change.
export const revokeTokens = (agentId: AgentId) =>
  appendSetup([decodeEvent({ _tag: "AgentGrouped", agentId, groups: [] })], { revokeAgentTokens: [agentId] });

export const startPayload = (rig: Rig, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: "Builder", role: "worker", harness: "first", account: { _tag: "named", accountId: "primary" },
  model: "test-model", effort: "high", permission: "ask", folder: rig.work, runMode: "acp", groups: ["engine"],
  ...overrides,
});

// The views other than the sequence and the per-agent threads, for "unchanged".
export const viewsWithoutSequence = Effect.gen(function* () {
  const views = yield* Views.Views;
  const { sequence: _sequence, ...rest } = yield* views.snapshot;
  return rest;
});

export const agentRow = (id: string) => Effect.gen(function* () {
  const views = yield* Views.Views;
  return (yield* views.snapshot).agents[id];
});

export const stateOf = (id: string) => agentRow(id).pipe(Effect.map((row) => row?.state._tag));

// A crash as the engine writes it: the event and the revocation of the
// agent's tokens, in one append (row 32).
export const crashAgent = (id: string) => {
  const agentId = agentIdOf(id);
  return appendSetup(
    [decodeEvent({ _tag: "AgentCrashed", agentId, exitCode: 1, signal: null, stderr: "fake crash" })],
    { revokeAgentTokens: [agentId] },
  );
};

// A delivery the agent has accepted (queued, sent, accepted), for the cases
// that need deliveries since its last turn end.
export const acceptedDelivery = (id: string, deliveryId: string, text: string) => {
  const agentId = agentIdOf(id);
  return appendSetup([
    decodeEvent({ _tag: "DeliveryQueued", delivery: { id: deliveryId, target: agentId, sender: { _tag: "owner" }, content: { _tag: "prompt", text } } }),
    decodeEvent({ _tag: "DeliverySent", agentId, deliveryId, method: "acp" }),
    decodeEvent({ _tag: "DeliveryAccepted", agentId, deliveryId }),
  ]);
};

// A finished turn: it ends the "since its last turn end" window of row 66.
export const finishedTurn = (id: string) => {
  const agentId = agentIdOf(id);
  return appendSetup([
    decodeEvent({ _tag: "TurnStarted", agentId }),
    decodeEvent({ _tag: "TurnEnded", agentId, compact: false }),
  ]);
};

export const openWait = (id: string, waitId: string, members: ReadonlyArray<string>) =>
  appendSetup([decodeEvent({
    _tag: "WaitOpened", agentId: agentIdOf(id), waitId, members: members.map((member) => agentIdOf(member)), mode: "all", blocking: true,
  })]);

// What `call` returns: the reply, or the typed failure.
export type Outcome = Result.Result<any, { readonly _tag: string; readonly reason: string }>;

export const success = (outcome: Outcome): any => {
  if (outcome._tag !== "Success") throw new Error(`Expected a reply, got ${JSON.stringify(outcome.failure)}`);
  return outcome.success;
};

// The failure's tag and reason, or undefined for a reply.
export const failureOf = (outcome: Outcome): { readonly _tag: string; readonly reason: string } | undefined =>
  outcome._tag === "Failure" ? { _tag: outcome.failure._tag, reason: outcome.failure.reason } : undefined;

export const harnessSettings = (id = "first", overrides: Record<string, unknown> = {}) => ({
  id, runMode: "acp", adapterPath: process.execPath, adapterArguments: ["--stdio"],
  permissionMapping: { "read-only": "plan", ask: "default", edit: "acceptEdits", full: "bypass" },
  reportedModes: [{ id: "plan", level: "read-only" }], defaultPermission: "ask",
  models: ["test-model"], efforts: ["high"], denyReadMechanism: { _tag: "none" },
  ...overrides,
});
