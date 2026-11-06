// Unit 1a's test build. This describes the lists the service builder consumes;
// it implements no engine behavior. Missing production seams fail assertions
// inside tests, rather than preventing Vitest from collecting the suite.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as Contracts from "@sheprd/contracts";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, vi } from "vitest";

import { CommandHandler } from "../../src/commands/CommandHandler.ts";
import type { Input, Plan, Runtime } from "../../src/commands/internal.ts";
import { SecretStore } from "../../src/commands/SecretStore.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { Redactor } from "../../src/log/Redactor.ts";
import { Runner } from "../../src/runner/Runner.ts";
import type { Restart } from "../../src/recovery/service.ts";
import { Views } from "../../src/views/Views.ts";
import type { emptyViews } from "../../src/views/apply.ts";
import { makeFakeRunner, type FakeRunner } from "./fakeRunner.ts";
import { makeFakeSecrets, makeRig, removeRig, type Rig } from "./handlerRig.ts";
import { ancestryHeaders, authorization, socketUrl } from "./socketClient.ts";

export type Caller = { readonly _tag: "owner" } | { readonly _tag: "agent"; readonly agentId: string };
export type View = ReturnType<typeof emptyViews> & Record<string, unknown>;
export type Visibility = "agent-scoped" | "owner-only" | "piece-decided";
export interface PieceView {
  readonly empty: () => unknown;
  readonly reduce: (view: unknown, event: Readonly<Record<string, unknown>>, sequence: number) => unknown;
}
export interface TestPlan {
  readonly afterCommit?: never;
  readonly events: ReadonlyArray<unknown>;
  readonly sideRows?: Readonly<Record<string, unknown>>;
  readonly reply: (batch: ReadonlyArray<Contracts.EventEnvelope>) => Record<string, unknown>;
}
export interface EngineLists {
  // Keep declarations BEFORE RpcGroup.merge, which silently loses duplicates.
  readonly commandGroups: ReadonlyArray<{ readonly namespace: string; readonly group: RpcGroup.RpcGroup<any> }>;
  readonly eventGroups: ReadonlyArray<{ readonly namespace: string; readonly events: Schema.Top }>;
  readonly commands: RpcGroup.RpcGroup<any>;
  readonly event: Schema.Top;
  readonly envelope: Schema.Top;
  readonly access: Readonly<Record<string, ReadonlyArray<"owner" | "agent" | "service">>>;
  readonly planners: Readonly<
    Record<string, (input: Input, payload: Record<string, unknown>) => Effect.Effect<Plan | TestPlan, unknown>>
    & Record<`${Contracts.PieceNamespace}.${string}`, (input: Input, payload: Record<string, unknown>) => Effect.Effect<TestPlan, unknown>>
  >;
  readonly reads: Readonly<Record<string, unknown>>;
  readonly views: Readonly<Record<string, PieceView>>;
  readonly migrations: Readonly<Record<string, ReadonlyArray<{ readonly id: number; readonly statements: ReadonlyArray<string> }>>>;
  readonly visibility: Readonly<Record<string, Visibility>>;
  readonly pieceVisibility: Readonly<Record<string, (caller: Caller, envelope: Contracts.EventEnvelope, view: View) => boolean>>;
  readonly snapshotSections: Readonly<Record<string, (caller: Caller, view: View) => unknown>>;
  readonly reactors: Readonly<Record<string, Effect.Effect<void, unknown, any>>>;
}

export async function productionModule<T>(path: string): Promise<T> {
  const url = new URL(`../../src/${path}`, import.meta.url);
  expect(existsSync(url), `Unit 1a must provide ${path}; see the builder seams in .foundry/tests-result.md`).toBe(true);
  return await import(/* @vite-ignore */ url.href) as T;
}

export const loadLists = async (): Promise<EngineLists> => {
  const module = await productionModule<{ readonly engineLists: EngineLists }>("pieces/lists.ts");
  expect(module.engineLists, "Export the engine's default lists, with no fixture installed").toBeDefined();
  return module.engineLists;
};

export const FixtureEvent = Schema.TaggedStruct("client.FixtureRecorded", {
  id: Schema.String, agentId: Schema.optionalKey(Schema.String), text: Schema.String,
});
const FixtureGroup = RpcGroup.make(Rpc.make("record", {
  payload: { requestId: Contracts.RequestId, id: Schema.String, text: Schema.String },
  success: Schema.Struct({ requestId: Contracts.RequestId, id: Schema.String, sequence: Contracts.EventSequence }),
  error: Schema.TaggedStruct("CommandError", { requestId: Contracts.RequestId, reason: Schema.String }),
})).prefix("client.");

export const fixtureLists = (base: EngineLists): EngineLists => {
  const event = Schema.Union([base.event, FixtureEvent]);
  const envelope = Schema.Struct({ ...Contracts.EventEnvelope.fields, event });
  return {
    ...base,
    commandGroups: [...base.commandGroups, { namespace: "client", group: FixtureGroup }],
    eventGroups: [...base.eventGroups, { namespace: "client", events: FixtureEvent }],
    commands: base.commands.merge(FixtureGroup), event, envelope,
    access: { ...base.access, "client.record": ["owner"] },
    planners: { ...base.planners, "client.record": (_input, payload) => Effect.succeed({
      events: [{ _tag: "client.FixtureRecorded", id: payload.id, text: payload.text }],
      sideRows: { client_fixture: [{ id: payload.id }] },
      reply: (batch) => ({ requestId: payload.requestId, id: (batch[0]!.event as unknown as { id: string }).id, sequence: batch[0]!.sequence }),
    }) },
    views: { ...base.views, client: {
      empty: () => ({ records: [] }),
      reduce: (view, e, sequence) => e._tag === "client.FixtureRecorded"
        ? { records: [...(view as { records: unknown[] }).records, { id: e.id, text: e.text, sequence }] } : view,
    } },
    migrations: { ...base.migrations, client: [{ id: 1, statements: ["CREATE TABLE client_fixture (id TEXT PRIMARY KEY)"] }] },
    visibility: { ...base.visibility, "client.FixtureRecorded": "owner-only" },
    snapshotSections: { ...base.snapshotSections, client: (caller, view) => caller._tag === "owner" ? view.client : undefined },
  };
};

export const fixtureClient = (socketPath: string, bearer: string, lists: EngineLists) => Effect.gen(function* () {
  const socket = yield* Socket.makeWebSocket(socketUrl(socketPath), {
    headers: { ...authorization(bearer), ...ancestryHeaders() }, openTimeout: 10_000,
  }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS));
  const protocol = yield* RpcClient.makeProtocolSocket({ retryTransientErrors: false }).pipe(
    Effect.provideService(Socket.Socket, socket), Effect.provide(RpcSerialization.layerJson),
  );
  const client = yield* RpcClient.make(lists.commands).pipe(Effect.provideService(RpcClient.Protocol, protocol));
  return client as unknown as Record<string, (payload: unknown) => Effect.Effect<Record<string, unknown>, unknown>>;
});

export const asEvent = (event: unknown): Contracts.Event => event as Contracts.Event;

type Services = CommandHandler | EventLog | Views;
type Dependencies = SqlClient.SqlClient | Runner | SecretStore | Redactor;
type Configuration = Pick<Runtime, "home" | "stateFolder" | "pluginRoot">;
type BuildServices = (configuration: Configuration, lists: EngineLists) => Layer.Layer<Services, unknown, Dependencies>;

export const withFixture = async (
  lists: EngineLists,
  body: (rig: Rig, bearer: string) => Effect.Effect<unknown, unknown, any>,
  options: {
    readonly redactor?: Layer.Layer<Redactor>;
    readonly recovery?: Layer.Layer<Restart>;
    readonly logger?: Layer.Layer<never>;
    readonly rig?: Rig;
    readonly runner?: Pick<FakeRunner, "layer">;
  } = {},
): Promise<void> => {
  // service.ts currently runs its CLI on import. Assert the builder export
  // before importing it, so RED never starts an unconfigured real service.
  const service = new URL("../../src/service.ts", import.meta.url);
  expect(readFileSync(service, "utf8"), "E22 must export buildServices without launching the CLI on import")
    .toMatch(/export\s+(?:const|function)\s+buildServices\b/);
  const { buildServices } = await import(/* @vite-ignore */ service.href) as { buildServices: BuildServices };
  const rig = options.rig ?? makeRig();
  vi.stubEnv("SHEPRD_HOME", rig.stateFolder);
  const bearer = randomBytes(32).toString("base64url");
  try {
    let program = Effect.gen(function* () {
      const runner = options.runner ?? (yield* makeFakeRunner());
      const services = buildServices(rig, lists);
      const redactor = options.redactor ?? Layer.succeed(Redactor, {
        redact: (event: Contracts.Event) => Effect.succeed(event), redactText: (text: string) => Effect.succeed(text),
      });
      return yield* Effect.scoped(body(rig, bearer)).pipe(
        Effect.provide(services.pipe(Layer.provide(Layer.mergeAll(runner.layer, makeFakeSecrets().layer, redactor)))),
        Effect.provide(runner.layer),
      );
    }).pipe(Effect.provide(SqliteClient.layer({ filename: join(rig.root, "events.sqlite"), readerWorker: true })), Effect.scoped);
    if (options.recovery !== undefined) program = program.pipe(Effect.provide(options.recovery));
    if (options.logger !== undefined) program = program.pipe(Effect.provide(options.logger));
    await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>);
  } finally {
    vi.unstubAllEnvs();
    if (options.rig === undefined) removeRig(rig);
  }
};
