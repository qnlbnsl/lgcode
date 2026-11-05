import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { it, expect } from "@effect/vitest";
import { connect, type Client, type ClientError } from "@shephrd/client";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Scope from "effect/Scope";

import {
  eventsUntil, findLeaks, head, readOwnerCredentialFrom, recordReplies, requestId, show, since, threadSources,
} from "../../scripts/live/support.ts";
import {
  alive, fakeHarness, makeServiceRoot, peekEcho, startService, stopAllServices, waitFor, writeFakeAdapter,
  type Echo, type ServiceProcess, type ServiceRoot,
} from "./serviceProcess.ts";
import { waitForBoardRecovery } from "./boardRecovery.ts";

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

// Unit 8c moved the helpers that the live check also uses into a module that
// imports nothing from vitest. They are re-exported, so the scenarios keep
// their imports.
export {
  eventsUntil, findLeaks, head, isTag, next, refusal, requestId, since, stateIs, tagged, threadSources, threadText,
} from "../../scripts/live/support.ts";
export type { LeakSource } from "../../scripts/live/support.ts";

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
  // Start with `any account` of the harness instead of the named one made
  // here, so the engine has to pick (the one made here is then the only
  // account with no agent on it).
  readonly anyAccount?: boolean;
  // The request identifier of the start call, to send the same call twice.
  readonly requestId?: string;
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
  // Every reply and refusal the scenario's clients received, as JSON text.
  readonly replies: ReadonlyArray<string>;
  // Adds every token a fake agent has recorded so far to `secrets`.
  readonly collectTokens: () => void;
  // Starts a service on this root (again, after a kill) and waits until it
  // serves and the board's immediately actionable recovery work completes.
  // Replaces `service` and `owner`.
  readonly boot: (options?: { readonly env?: Record<string, string | undefined> }) => Effect.Effect<ServiceProcess, unknown, Scope.Scope>;
  readonly kill: (signal?: NodeJS.Signals) => Effect.Effect<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
  readonly reopenOwner: () => Effect.Effect<Client, unknown, Scope.Scope>;
  // A client with this agent token, as the agent's own tool would connect.
  readonly asAgent: (token: string) => Effect.Effect<Client, ClientError, Scope.Scope>;
  readonly start: (caller: Client, spec?: Spec) => Effect.Effect<Started, unknown>;
  // Makes the harness and the account that `start` would use, without
  // starting anything, so a scenario can send the start call itself.
  readonly prepare: (spec?: Spec) => Effect.Effect<Started & { readonly request: Record<string, unknown> }, unknown>;
  // Every service process this scenario started, oldest first.
  readonly incarnations: ReadonlyArray<ServiceProcess>;
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

export const promptsOf = (echo: Echo): ReadonlyArray<string> => echo.inbound
  .filter((frame) => frame.method === "session/prompt")
  .map((frame) => (frame.params.prompt as Array<{ text?: string }>).map((part) => part.text ?? "").join(""));

// An independent FIFO prompt after the duty under test supplies a completed
// drain boundary. Count from the original watermark through a freshly captured
// head afterwards, including recovery sends and the suffix after the first send.
export const drainAgent = (client: Client, agentId: string, after: number) => Effect.gen(function* () {
  const reply = yield* client.prompt({ requestId: requestId(), agentId, text: "Finish the acceptance drain boundary." } as never);
  let accepted = false;
  yield* eventsUntil(client, after, "the independent drain prompt's completed turn", (row) => {
    if (row.event._tag === "DeliveryAccepted" && row.event.deliveryId === reply.deliveryId) accepted = true;
    return accepted && row.event._tag === "TurnEnded" && row.agentId === agentId;
  });
  return yield* since(client, after);
});

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

// Criterion 8.5 and the security rules: the views rebuilt from the log equal
// the live views, and no credential or secret appears, in any form, in any
// event, any reply, the accounts list, or the output of any service process
// the scenario started.
export const finish = (world: World): Effect.Effect<void, unknown, Scope.Scope> => Effect.gen(function* () {
  const client = yield* world.reopenOwner();
  const reply = yield* (client["debug.compare-views"]({ requestId: requestId() } as never) as Effect.Effect<{ sequence: number; equal: boolean; differences: ReadonlyArray<string> }, unknown>);
  expect(reply.differences, "debug.compare-views reported a difference between the live views and the rebuild").toEqual([]);
  expect(reply.equal).toBe(true);
  const all = yield* since(client, 0);
  const accounts = yield* client.accounts({ requestId: requestId(), operation: "list" } as never);
  world.collectTokens();
  const secrets = [...world.secrets, ...readOwnerCredentialFrom(world.root.state)];
  for (const secret of secrets) expect(secret.length).toBeGreaterThan(8);
  const leaks = findLeaks(secrets, [
    { label: "the events", text: JSON.stringify(all) },
    { label: "the accounts list", text: show(accounts) },
    { label: "the replies and refusals", text: world.replies.join("\n") },
    ...world.incarnations.map((service, index) => ({ label: `the output of service process ${index + 1}`, text: service.output() })),
    ...threadSources(all),
  ]);
  expect(leaks, "a credential or secret reached an event, a reply or the service's output").toEqual([]);
});

export interface ScenarioOptions {
  // The service environment beyond the harness defaults.
  readonly env?: Record<string, string | undefined>;
  // Do not start the service; the scenario calls `world.boot`.
  readonly manual?: boolean;
  readonly timeout?: number;
}

const writeError = (text: string) => Effect.sync(() => { process.stderr.write(`[acceptance] ${text}\n`); });

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
    const replies: Array<string> = [];
    const incarnations: Array<ServiceProcess> = [];
    let current: ServiceProcess | undefined;
    let owner: Client | undefined;
    const reopenOwner = () => connectOwner(root).pipe(Effect.provideService(Scope.Scope, scope), Effect.map((client) => recordReplies(client, replies)));
    // Every token the service minted for an agent is in the environment of
    // that agent's fake, whether or not the scenario asked for it.
    const collectTokens = () => {
      try {
        for (const name of readdirSync(root.root)) {
          if (!/^echo-.*\.json$/.test(name)) continue;
          const token = peekEcho(join(root.root, name))?.env.SHEPHRD_TOKEN;
          if (token !== undefined) secrets.add(token);
        }
      } catch { /* the folder is gone or a file is half written; the next look reads it */ }
    };
    const boot: World["boot"] = (bootOptions = {}) => Effect.gen(function* () {
      const service = startService(root, { env: { SHEPHRD_TEST_DEBUG: "1", ...options.env, ...bootOptions.env } });
      current = service;
      incarnations.push(service);
      yield* waitServing(root, service);
      for (const form of readOwnerCredentialFrom(root.state)) secrets.add(form);
      owner = yield* reopenOwner();
      if (incarnations.length > 1) yield* waitForBoardRecovery(Effect.suspend(() => owner!["client.snapshot"]({ requestId: requestId() } as never)));
      return service;
    });
    const world: World = {
      root, secrets, replies, incarnations, boot, reopenOwner, collectTokens,
      get service() { if (current === undefined) throw new Error("No service has been started"); return current; },
      get owner() { if (owner === undefined) throw new Error("No service has been started"); return owner; },
      kill: (signal = "SIGKILL") => Effect.gen(function* () {
        const service = current!;
        service.child.kill(signal);
        return yield* Effect.promise(() => service.exit);
      }),
      asAgent: (token) => connect({ environment: { SHEPHRD_SOCKET: root.socket, SHEPHRD_TOKEN: token }, attempts: 1 }).pipe(
        Effect.provideService(Scope.Scope, scope), Effect.map((client) => recordReplies(client, replies)),
      ),
      prepare: (spec = {}) => Effect.gen(function* () {
        const harnessId = spec.harness ?? "fake";
        const adapter = join(root.bin, "fake-adapter");
        if (!existsSync(adapter)) writeFakeAdapter(root);
        yield* world.owner.harnesses({ requestId: requestId(), operation: "list" } as never).pipe(
          // Fix round 1, N-1: a fresh service already lists the real "claude"
          // and "codex"; the fake adapter takes the name only when it is not
          // the one listed.
          Effect.flatMap((listing) => (listing as { harnesses: ReadonlyArray<{ id: string; adapterPath: string }> }).harnesses.some((harness) => harness.id === harnessId && harness.adapterPath === adapter)
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
        const request = {
          requestId: spec.requestId ?? requestId(), name: spec.name ?? "Acceptance agent", role: spec.role ?? "worker", harness: harnessId,
          account: spec.anyAccount === true ? { _tag: "any" } : { _tag: "named", accountId },
          permission: spec.permission ?? "ask", folder: spec.folder ?? root.work,
          runMode: "acp", groups: spec.groups ?? [],
          ...(spec.model === undefined ? {} : { model: spec.model }), ...(spec.effort === undefined ? {} : { effort: spec.effort }),
          ...(spec.prompt === undefined ? {} : { prompt: spec.prompt }),
        };
        return { agentId: "", echo, accountId, request };
      }),
      start: (caller, spec = {}) => Effect.gen(function* () {
        const prepared = yield* world.prepare(spec);
        const reply = yield* (caller.start(prepared.request as never) as Effect.Effect<{ agentId: string }, unknown>);
        return { agentId: reply.agentId, echo: prepared.echo, accountId: prepared.accountId } satisfies Started;
      }),
      token: (agent, notPid) => waitFor("the fake agent's environment", () => {
        const echo = peekEcho(agent.echo);
        if (echo === undefined || echo.pid === notPid || echo.env.SHEPHRD_TOKEN === undefined) return undefined;
        secrets.add(echo.env.SHEPHRD_TOKEN);
        return { token: echo.env.SHEPHRD_TOKEN, pid: echo.pid, echo };
      }),
      watermark: () => head(owner!),
    };
    // Looks for new tokens while the scenario runs, so one that a later
    // restart or a stop removes from view is still on the list.
    yield* Effect.forever(Effect.sync(collectTokens).pipe(Effect.andThen(Effect.sleep(50)))).pipe(Effect.forkIn(scope));

    // The rebuild comparison and the secret scan run on the way out of the
    // body, also when the body failed (A5): the body's own failure is the one
    // that is reported; a failed check after it is written to stderr.
    const check = Effect.gen(function* () {
      if (current === undefined) return yield* Effect.die(new Error("could not compare: the service was never started"));
      if (current.exited()) {
        // A scenario that ends on a killed service: the check needs one.
        const recovered = yield* Effect.exit(boot());
        if (Exit.isFailure(recovered)) {
          return yield* Effect.die(new Error(`could not compare: the service could not be recovered (${Cause.pretty(recovered.cause).slice(0, 600)})`));
        }
      }
      yield* finish(world);
    }).pipe(Effect.timeoutOrElse({
      duration: 60_000,
      orElse: () => Effect.die(new Error("could not compare: the final check timed out after 60000 ms")),
    }));
    const program = Effect.gen(function* () {
      if (options.manual !== true) yield* boot();
      yield* body(world);
    });
    yield* Effect.onExit(program, (exit) => Exit.isFailure(exit)
      ? check.pipe(Effect.catchCause((cause) => writeError(`the final check failed after the scenario failed: ${Cause.pretty(cause).slice(0, 1500)}`)))
      : check);
  })) as Effect.Effect<void, unknown, never>, options.timeout ?? 120_000);
};

// A secret value of the right shape for `accounts set-secret`.
export const secretValue = (label: string): string => `${label}-${randomUUID()}`;
export const redacted = (value: string) => Redacted.make(value, { label: "secret value" });
