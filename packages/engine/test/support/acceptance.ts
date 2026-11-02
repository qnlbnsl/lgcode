import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { it, expect } from "@effect/vitest";
import { connect, type Client, type ClientError } from "@shephrd/client";
import type { EventEnvelope } from "@shephrd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import {
  alive, fakeHarness, makeServiceRoot, peekEcho, startService, stopAllServices, waitFor, writeFakeAdapter,
  type Echo, type ServiceProcess, type ServiceRoot,
} from "./serviceProcess.ts";

// Unit 8b: the acceptance harness (plan tasks 8b.1 and 8b.2, criteria 8.3 to
// 8.5). A scenario starts the real service (`src/service.ts`) as a child
// process with `SHEPHRD_TEST_DEBUG=1`, in a short /tmp folder of its own, and
// then talks to it only through `@shephrd/client` over the socket: the owner
// with the real owner credential, an agent with the token that the fake agent
// recorded in its own environment. A scenario reads no database and imports
// nothing from `src/`. The one exception is `plantDatabaseFault`, which
// injects a fault into the stopped or running service's database, as the
// 7a restart test does, because a full disk cannot be produced any other way
// without root; it never reads a value for an assertion.
//
// Cleanup: every scenario file calls `afterEach(stopAllServices)`, which
// sends SIGTERM to each service the file started (SIGKILL after 10 s), awaits
// its exit, kills the fake agents whose pids are in this root's echo files
// (only a pid whose command line or environment names the root), and removes
// the root. Nothing else is ever signalled.

export { stopAllServices, alive, peekEcho, waitFor };
export type { Client, Echo, ServiceProcess, ServiceRoot };

export const requestId = (): string => `request-${randomUUID()}`;

// A call of the client, as an effect that never fails for a refusal: the
// refusal reason is the value. Used where a scenario asserts a refusal.
export const refusal = <A>(effect: Effect.Effect<A, unknown>): Effect.Effect<string | undefined> =>
  effect.pipe(Effect.exit, Effect.map((exit) => {
    if (Exit.isSuccess(exit)) return undefined;
    const failure = Cause.findErrorOption(exit.cause);
    const error = failure._tag === "Some" ? failure.value as { _tag?: string; reason?: string } : undefined;
    return error?._tag === "CommandError" ? error.reason : `not a refusal: ${String(exit.cause)}`.slice(0, 300);
  }));

export interface Spec {
  readonly script?: Record<string, unknown>;
  readonly name?: string;
  readonly role?: string;
  readonly prompt?: string;
  readonly permission?: "read-only" | "ask" | "edit" | "full";
  readonly groups?: ReadonlyArray<string>;
  readonly model?: string;
  readonly effort?: string;
  readonly accountId?: string;
  readonly harness?: string;
  readonly folder?: string;
  // Account variables beside the script and echo file.
  readonly environment?: Record<string, string>;
}

export interface Started {
  readonly agentId: string;
  readonly echo: string;
  readonly accountId: string;
}

const mode = (current = "default") => ({
  configId: "mode", name: "Mode", category: "mode", type: "select", currentValue: current,
  options: [
    { value: "read-only", name: "Read only" }, { value: "default", name: "Default" },
    { value: "accept-edits", name: "Accept edits" }, { value: "full-access", name: "Full access" },
  ],
});
const model = (current = "model-small") => ({
  configId: "model", name: "Model", category: "model", type: "select", currentValue: current,
  options: [{ value: "model-small", name: "Small" }, { value: "model-large", name: "Large" }],
});
const effort = (current = "low") => ({
  configId: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: current,
  options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }],
});

export interface World {
  readonly root: ServiceRoot;
  // The service process now running, and the owner's client on it.
  readonly service: ServiceProcess;
  readonly owner: Client;
  // Every secret value a scenario creates (tokens, stored secrets). The
  // final check proves none reached an event or the service's output.
  readonly secrets: Set<string>;
  // Starts a service on this root (again, after a kill) and waits until it
  // serves. Replaces `service` and `owner`.
  readonly boot: (options?: { readonly env?: Record<string, string | undefined> }) => Effect.Effect<ServiceProcess, unknown, Scope.Scope>;
  readonly kill: (signal?: NodeJS.Signals) => Effect.Effect<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
  readonly reopenOwner: () => Effect.Effect<Client, unknown, Scope.Scope>;
  // A client with this agent token, as the agent's own tool would connect.
  readonly asAgent: (token: string) => Effect.Effect<Client, ClientError, Scope.Scope>;
  readonly start: (caller: Client, spec?: Spec) => Effect.Effect<Started, unknown>;
  readonly token: (agent: Started, notPid?: number) => Effect.Effect<{ readonly token: string; readonly pid: number; readonly echo: Echo }>;
  readonly watermark: () => Effect.Effect<number>;
}

export const ownerEnvironment = (root: ServiceRoot): Record<string, string> => ({ SHEPHRD_HOME: root.state });

const connectOwner = (root: ServiceRoot) => connect({ environment: ownerEnvironment(root), attempts: 1 });

// The service accepts the owner: recovery has finished (row 52, step 9). A
// service that exits first fails at once with its output.
const waitServing = (root: ServiceRoot, service: ServiceProcess, limit = 40_000) => Effect.gen(function* () {
  const deadline = Date.now() + limit;
  for (;;) {
    if (service.exited()) return yield* Effect.die(new Error(`The service exited before serving; output:\n${service.output().slice(-4000)}`));
    const probe = yield* Effect.exit(Effect.scoped(connectOwner(root)));
    if (Exit.isSuccess(probe)) return;
    if (Date.now() > deadline) return yield* Effect.die(new Error(`Timed out after ${limit} ms waiting for the service to serve; output:\n${service.output().slice(-4000)}`));
    yield* Effect.sleep(50);
  }
});

export const head = (client: Client): Effect.Effect<number> =>
  (client["debug.compare-views"]({ requestId: requestId() } as never) as Effect.Effect<{ sequence: number }, unknown>).pipe(
    Effect.map((reply) => reply.sequence), Effect.orDie,
  );

// Every event after `after`, up to and including the first that `last`
// accepts; fails with `what` if none arrives within `limit`.
export const eventsUntil = (
  client: Client, after: number, what: string, last: (envelope: EventEnvelope) => boolean, limit = 20_000,
): Effect.Effect<ReadonlyArray<EventEnvelope>> =>
  (client.subscribe({ requestId: requestId(), after } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
    Stream.takeUntil(last), Stream.runCollect,
    Effect.timeoutOrElse({ duration: limit, orElse: () => Effect.die(new Error(`Timed out after ${limit} ms waiting for ${what}`)) }),
    Effect.map((events) => [...events]), Effect.orDie,
  );

export const next = (
  client: Client, after: number, what: string, predicate: (envelope: EventEnvelope) => boolean, limit = 20_000,
): Effect.Effect<EventEnvelope> =>
  eventsUntil(client, after, what, predicate, limit).pipe(Effect.map((events) => events[events.length - 1]!));

// The events committed after `after`, up to the head now. Used to count
// what one step caused, never totals (issue 55).
export const since = (client: Client, after: number): Effect.Effect<ReadonlyArray<EventEnvelope>> => Effect.gen(function* () {
  const end = yield* head(client);
  if (end <= after) return [];
  return yield* eventsUntil(client, after, `catching up to sequence ${end}`, (envelope) => envelope.sequence >= end, 30_000);
});

export const tagged = (events: ReadonlyArray<EventEnvelope>, tag: string, agentId?: string): ReadonlyArray<EventEnvelope> =>
  events.filter((envelope) => envelope.event._tag === tag && (agentId === undefined || envelope.agentId === agentId));

export const isTag = (tag: string, agentId?: string) => (envelope: EventEnvelope): boolean =>
  envelope.event._tag === tag && (agentId === undefined || envelope.agentId === agentId);

export const stateIs = (agentId: string, state: string) => (envelope: EventEnvelope): boolean =>
  envelope.agentId === agentId && envelope.event._tag === "StateChanged" && (envelope.event as { state: { _tag: string } }).state._tag === state;

// The agent's own words in its thread, in order.
export const threadText = (events: ReadonlyArray<EventEnvelope>, agentId: string): string =>
  events.filter((envelope) => envelope.agentId === agentId && envelope.event._tag === "ThreadItem")
    .map((envelope) => {
      const content = (envelope.event as { content: { _tag: string; text?: string } }).content;
      return content._tag === "text" ? content.text ?? "" : `[${content._tag}]`;
    }).join("");

export const promptsOf = (echo: Echo): ReadonlyArray<string> => echo.inbound
  .filter((frame) => frame.method === "session/prompt")
  .map((frame) => (frame.params.prompt as Array<{ text?: string }>).map((part) => part.text ?? "").join(""));

// Plants a fault in the service's own database file (the one SQLite file with
// an events table). A trigger that aborts every insert whose event type
// matches `eventType`, or a read-only connection for the whole file.
export const databaseIn = (folder: string): string => {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (!lstatSync(path).isFile() || name === "engine.lock") continue;
    if (readFileSync(path).subarray(0, 16).toString("latin1") !== "SQLite format 3\u0000") continue;
    const database = new DatabaseSync(path);
    try {
      if (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events'").all().length > 0) return path;
    } finally { database.close(); }
  }
  throw new Error("No event database in the state folder");
};

export const plantDatabaseFault = (root: ServiceRoot, trigger: string, sql: string): void => {
  const database = new DatabaseSync(databaseIn(root.state));
  try { database.exec("PRAGMA busy_timeout = 5000"); database.exec(`${sql}; ${trigger}`); } finally { database.close(); }
};

export const runSql = (root: ServiceRoot, statement: string): void => {
  const database = new DatabaseSync(databaseIn(root.state));
  try { database.exec("PRAGMA busy_timeout = 5000"); database.exec(statement); } finally { database.close(); }
};

const readOwnerCredential = (root: ServiceRoot): ReadonlyArray<string> => {
  try {
    const bytes = readFileSync(join(root.state, "owner-credential"));
    return [bytes.toString("base64url"), bytes.toString("base64"), bytes.toString("hex")];
  } catch { return []; }
};

// Criterion 8.5 and the security rules: the views rebuilt from the log equal
// the live views, and no credential or secret appears in any event or in
// what the service printed.
export const finish = (world: World): Effect.Effect<void, unknown, Scope.Scope> => Effect.gen(function* () {
  const client = yield* world.reopenOwner();
  const reply = yield* (client["debug.compare-views"]({ requestId: requestId() } as never) as Effect.Effect<{ sequence: number; equal: boolean; differences: ReadonlyArray<string> }, unknown>);
  expect(reply.differences, "debug.compare-views reported a difference between the live views and the rebuild").toEqual([]);
  expect(reply.equal).toBe(true);
  const all = yield* since(client, 0);
  const text = JSON.stringify(all) + world.service.output();
  for (const secret of [...world.secrets, ...readOwnerCredential(world.root)]) {
    expect(secret.length).toBeGreaterThan(8);
    expect(text.includes(secret), "a credential or secret reached an event or the service's output").toBe(false);
  }
});

export interface ScenarioOptions {
  // The service environment beyond the harness defaults.
  readonly env?: Record<string, string | undefined>;
  // Do not start the service; the scenario calls `world.boot`.
  readonly manual?: boolean;
  readonly timeout?: number;
}

// One acceptance scenario. The title names the break the scenario catches.
export const scenario = (
  title: string,
  body: (world: World) => Effect.Effect<unknown, unknown, Scope.Scope>,
  options: ScenarioOptions = {},
): void => {
  it.live(title, () => Effect.scoped(Effect.gen(function* () {
    const scope = yield* Scope.Scope;
    const root = makeServiceRoot("/tmp/sh8-");
    const secrets = new Set<string>();
    let current: ServiceProcess | undefined;
    let owner: Client | undefined;
    const reopenOwner = () => connectOwner(root).pipe(Effect.provideService(Scope.Scope, scope));
    const boot: World["boot"] = (bootOptions = {}) => Effect.gen(function* () {
      const service = startService(root, { env: { SHEPHRD_TEST_DEBUG: "1", ...options.env, ...bootOptions.env } });
      current = service;
      yield* waitServing(root, service);
      owner = yield* reopenOwner();
      return service;
    });
    const world: World = {
      root, secrets, boot, reopenOwner,
      get service() { if (current === undefined) throw new Error("No service has been started"); return current; },
      get owner() { if (owner === undefined) throw new Error("No service has been started"); return owner; },
      kill: (signal = "SIGKILL") => Effect.gen(function* () {
        const service = current!;
        service.child.kill(signal);
        return yield* Effect.promise(() => service.exit);
      }),
      asAgent: (token) => connect({ environment: { SHEPHRD_SOCKET: root.socket, SHEPHRD_TOKEN: token }, attempts: 1 }).pipe(Effect.provideService(Scope.Scope, scope)),
      start: (caller, spec = {}) => Effect.gen(function* () {
        const harnessId = spec.harness ?? "fake";
        const adapter = join(root.bin, "fake-adapter");
        if (!existsSync(adapter)) writeFakeAdapter(root);
        yield* world.owner.harnesses({ requestId: requestId(), operation: "list" } as never).pipe(
          Effect.flatMap((listing) => (listing as { harnesses: ReadonlyArray<{ id: string }> }).harnesses.some((harness) => harness.id === harnessId)
            ? Effect.void
            : world.owner.harnesses({
              requestId: requestId(), operation: "set",
              harness: { ...fakeHarness(adapter, harnessId), models: ["model-small", "model-large"], efforts: ["low", "high"] },
            } as never).pipe(Effect.asVoid)),
        );
        const accountId = spec.accountId ?? `acct${randomUUID().slice(0, 8)}`;
        const echo = join(root.root, `echo-${randomUUID()}.json`);
        yield* world.owner.accounts({
          requestId: requestId(), operation: "add",
          account: {
            id: accountId, harness: harnessId, displayName: accountId, enabled: true,
            environment: {
              FAKE_AGENT_SCRIPT: JSON.stringify({ configOptions: [mode(), model(), effort()], turns: [], ...spec.script }),
              FAKE_AGENT_ECHO: echo, ...spec.environment,
            },
          },
        } as never);
        const reply = yield* (caller.start({
          requestId: requestId(), name: spec.name ?? "Acceptance agent", role: spec.role ?? "worker", harness: harnessId,
          account: { _tag: "named", accountId }, permission: spec.permission ?? "ask", folder: spec.folder ?? root.work,
          runMode: "acp", groups: spec.groups ?? [],
          ...(spec.model === undefined ? {} : { model: spec.model }), ...(spec.effort === undefined ? {} : { effort: spec.effort }),
          ...(spec.prompt === undefined ? {} : { prompt: spec.prompt }),
        } as never) as Effect.Effect<{ agentId: string }, unknown>);
        return { agentId: reply.agentId, echo, accountId } satisfies Started;
      }),
      token: (agent, notPid) => waitFor("the fake agent's environment", () => {
        const echo = peekEcho(agent.echo);
        if (echo === undefined || echo.pid === notPid || echo.env.SHEPHRD_TOKEN === undefined) return undefined;
        secrets.add(echo.env.SHEPHRD_TOKEN);
        return { token: echo.env.SHEPHRD_TOKEN, pid: echo.pid, echo };
      }),
      watermark: () => head(owner!),
    };
    if (options.manual !== true) yield* boot();
    yield* body(world);
    yield* finish(world);
  })) as Effect.Effect<void, unknown, never>, options.timeout ?? 120_000);
};

// A secret value of the right shape for `accounts set-secret`.
export const secretValue = (label: string): string => `${label}-${randomUUID()}`;
export const redacted = (value: string) => Redacted.make(value, { label: "secret value" });
