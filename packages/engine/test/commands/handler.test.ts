import { existsSync, mkdirSync } from "node:fs";

import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { MinimumLogLevel } from "effect/References";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, describe, expect, it as plainIt, vi } from "vitest";

import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, agentIdOf, call, eventOf, failureOf,
  freshRequest, harnessSettings, headSequence, logAfter, makeFakeSecrets, makeRig, ownerCredential,
  provideRig, readLog, removeRig, seedAccount, seedAgent, seedHarness, startPayload, stateOf,
  success, type Credential, type Fakes, type Outcome, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { redactingLoggerLayer } from "../../src/identity/logger.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { verifyAgentToken } from "../../src/identity/tokens.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import * as Redactor from "../../src/log/Redactor.ts";

// Unit 5b.1 (decision rows 24, 30, 32, 55, 59, 70) and issue 50: how the
// command handler behaves around the log, apart from what each command
// writes (lifecycle.test.ts) and who may call it (authorization.test.ts).
//
//   1. The files the plan names exist.
//   2. The caller's token is checked inside the writer, not before it.
//   3. Every spawn gets a fresh token; stop and a crash revoke it.
//   4. Receipts: a retry gets the first reply, a reused id is refused.
//   5. No error reason or log line holds request content.
//   6. Side-row text is redacted without a carrier event (issue 50).

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRig(rig);
});

const withRig = <A, E, R>(
  body: (fakes: Fakes) => Effect.Effect<A, E, R>,
  extra: { readonly redactor?: Layer.Layer<Redactor.Redactor> } = {},
) =>
  Effect.gen(function* () {
    const fakes: Fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets(), ...extra };
    return yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      return yield* body(fakes);
    }));
  });

const liveTokens = (agentId: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM agent_tokens WHERE agent_id = ${agentId} AND revoked_at IS NULL`;
  return rows[0]?.n ?? -1;
});
const tokenRows = (agentId: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM agent_tokens WHERE agent_id = ${agentId}`;
  return rows[0]?.n ?? -1;
});
const tokenWorks = (raw: string) => verifyAgentToken(raw).pipe(Effect.result, Effect.map((result) => result._tag === "Success"));
const tokenOf = (call_: { readonly input: { readonly token: Redacted.Redacted<string> } }) => Redacted.value(call_.input.token);

// ---------------------------------------------------------------------------
// 1. The files of task 5b.1 and 5b.2
// ---------------------------------------------------------------------------

describe("5b layout", () => {
  const files = [
    "commands/CommandHandler.ts", "commands/SecretStore.ts", "commands/start.ts", "commands/prompt.ts",
    "commands/stop.ts", "commands/resume.ts", "commands/compact.ts", "commands/group.ts", "commands/accounts.ts",
    "commands/harnesses.ts", "runner/Runner.ts",
  ];
  for (const file of files) {
    plainIt(`5b.1 ${file}: catches a task that leaves this file out, so a command's logic is folded into another module or missing`, () => {
      expect(existsSync(new URL(`../../src/${file}`, import.meta.url))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. The token is checked in the writer (criterion 5.1, row 32)
// ---------------------------------------------------------------------------

// A command that has passed a token check before it waits for the writer
// permit acts on a token that was revoked while it waited. The test holds the
// permit, queues the command behind it, revokes the token with raw SQL, then
// releases the permit. Real sleeps let the queued command reach the permit.
const raceRevocation = (
  fakes: Fakes,
  who: { readonly credential: Credential },
  revoke: Effect.Effect<unknown, unknown, SqlClient.SqlClient>,
  command: { readonly name: string; readonly payload: Record<string, unknown> },
) => Effect.gen(function* () {
  const log = yield* EventLog.EventLog;
  const gate = yield* Deferred.make<void>();
  const before = yield* headSequence;
  const holder = yield* log.withWriterPermit(Deferred.await(gate)).pipe(Effect.forkChild);
  yield* Effect.sleep("50 millis");
  const pending = yield* call(who.credential, command.name, command.payload).pipe(Effect.forkChild);
  yield* Effect.sleep("150 millis");
  yield* revoke;
  yield* Deferred.succeed(gate, undefined);
  yield* Fiber.join(holder);
  const outcome = yield* Fiber.join(pending);
  return { outcome, written: yield* logAfter(before), runnerCalls: fakes.runner.calls.length };
});

it.live("5.1 token race: catches a handler that checks the agent token before it holds the writer permit, so a command queued behind a revocation still runs", () =>
  withRig((fakes) => Effect.gen(function* () {
    const parent = yield* seedAgent({ id: "agent-p" });
    yield* seedAgent({ id: "agent-c", parent: "agent-p" });
    const sql = yield* SqlClient.SqlClient;
    const raced = yield* raceRevocation(
      fakes, { credential: agentCredential(parent.token) },
      sql`UPDATE agent_tokens SET revoked_at = 5 WHERE agent_id = 'agent-p'`,
      { name: "prompt", payload: { agentId: "agent-c", text: "Run the tests." } },
    );
    expect(failureOf(raced.outcome)).toBeDefined();
    expect(raced.written).toEqual([]);
  })).pipe(Effect.orDie));

it.live("5.1 token race control: catches a race rig that blocks every command, so the revoked-token test above would pass for the wrong reason", () =>
  withRig((fakes) => Effect.gen(function* () {
    const parent = yield* seedAgent({ id: "agent-p" });
    yield* seedAgent({ id: "agent-c", parent: "agent-p" });
    const raced = yield* raceRevocation(
      fakes, { credential: agentCredential(parent.token) }, Effect.void,
      { name: "prompt", payload: { agentId: "agent-c", text: "Run the tests." } },
    );
    success(raced.outcome);
    expect(raced.written.map((row) => row.event._tag)).toEqual(["DeliveryQueued"]);
    expect(raced.written[0]?.caller).toEqual({ _tag: "agent", agentId: "agent-p" });
  })).pipe(Effect.orDie));


it.live("5.1 token race on stop: catches a stop that has acted on the runner before the writer confirms the token, so the adapter stops although the command is refused", () =>
  withRig((fakes) => Effect.gen(function* () {
    const parent = yield* seedAgent({ id: "agent-p" });
    yield* seedAgent({ id: "agent-c", parent: "agent-p" });
    const sql = yield* SqlClient.SqlClient;
    const raced = yield* raceRevocation(
      fakes, { credential: agentCredential(parent.token) },
      sql`UPDATE agent_tokens SET revoked_at = 5 WHERE agent_id = 'agent-p'`,
      { name: "stop", payload: { agentId: "agent-c" } },
    );
    expect(failureOf(raced.outcome)).toBeDefined();
    expect(raced.written).toEqual([]);
    expect(fakes.runner.callsOf("stop")).toEqual([]);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// 3. Fresh tokens; stop and a crash revoke (row 32)
// ---------------------------------------------------------------------------

it.effect("5b token on start: catches a start that reuses a token, never inserts one, or hands the runner a token the engine would not accept", () =>
  withRig((fakes) => Effect.gen(function* () {
    const reply = success(yield* call(ownerCredential, "start", startPayload(rig)));
    const given = tokenOf(fakes.runner.callsOf("start")[0]!);
    expect(given.startsWith("shp_a_")).toBe(true);
    expect(yield* verifyAgentToken(given)).toBe(reply.agentId);
    expect(yield* liveTokens(reply.agentId)).toBe(1);
  })).pipe(Effect.orDie));

it.effect("5b token on start, two agents: catches a start that gives two agents the same token", () =>
  withRig((fakes) => Effect.gen(function* () {
    success(yield* call(ownerCredential, "start", startPayload(rig, { name: "One" })));
    success(yield* call(ownerCredential, "start", startPayload(rig, { name: "Two" })));
    const [first, second] = fakes.runner.callsOf("start").map(tokenOf);
    expect(first).not.toBe(second);
  })).pipe(Effect.orDie));

it.effect("5b token on resume: catches a resume that keeps the old token valid, mints none, or leaves two live tokens (row 32: fresh token each spawn)", () =>
  withRig((fakes) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-a", state: "interrupted" });
    expect(yield* tokenWorks(agent.token)).toBe(true);
    success(yield* call(ownerCredential, "resume", { agentId: "agent-a" }));

    expect(yield* tokenWorks(agent.token)).toBe(false);
    const given = tokenOf(fakes.runner.callsOf("load")[0]!);
    expect(given).not.toBe(agent.token);
    expect(yield* verifyAgentToken(given)).toBe("agent-a");
    expect(yield* liveTokens("agent-a")).toBe(1);
    expect(yield* tokenRows("agent-a")).toBe(2);
  })).pipe(Effect.orDie));

it.effect("5b token on resume --fresh: catches a fresh resume that starts the new session with the old token", () =>
  withRig((fakes) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-a", state: "stopped" });
    // A stopped agent's token is already revoked, so the old token fails
    // before and after. The new one must work.
    success(yield* call(ownerCredential, "resume", { agentId: "agent-a", fresh: true }));
    const given = tokenOf(fakes.runner.callsOf("start")[0]!);
    expect(given).not.toBe(agent.token);
    expect(yield* verifyAgentToken(given)).toBe("agent-a");
    expect(yield* liveTokens("agent-a")).toBe(1);
  })).pipe(Effect.orDie));

it.effect("5b token on reload: catches a reload that leaves the previous process's token live beside the new one", () =>
  withRig((fakes) => Effect.gen(function* () {
    // A working agent that is resumed is not allowed; a reload follows a
    // crash or an interruption, and an interrupted agent still holds a token.
    const agent = yield* seedAgent({ id: "agent-a", state: "interrupted" });
    success(yield* call(ownerCredential, "resume", { agentId: "agent-a" }));
    const live = yield* liveTokens("agent-a");
    expect(live).toBe(1);
    expect(yield* tokenWorks(agent.token)).toBe(false);
    expect(fakes.runner.callsOf("load")).toHaveLength(1);
  })).pipe(Effect.orDie));

// The old token's revocation and the new token's insert are side rows of the
// same append (decision row 32). A planted failure on the events insert
// aborts the append; if the revocation or the insert were separate writes,
// one of them would survive.
const failEventsInsert = (eventType: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(`CREATE TRIGGER planted_failure BEFORE INSERT ON events WHEN NEW.event_type = '${eventType}'
    BEGIN SELECT RAISE(ABORT, 'planted insert failure'); END`);
});

it.effect("5b atomic resume: catches a resume that revokes the old token or inserts the new one outside the append that writes the event, so a failed append leaves an agent with no usable token", () =>
  withRig((fakes) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-a", state: "interrupted" });
    yield* failEventsInsert("StateChanged");
    const outcome = yield* call(ownerCredential, "resume", { agentId: "agent-a" });
    expect(failureOf(outcome)?._tag).toBe("LogWriteFailed");

    expect(yield* tokenWorks(agent.token)).toBe(true);
    expect(yield* tokenRows("agent-a")).toBe(1);
    expect(fakes.runner.calls).toEqual([]);
  })).pipe(Effect.orDie));

it.effect("5b atomic start: catches a start that inserts the token before the append that writes AgentStarted, leaving a live token for an agent that does not exist", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* failEventsInsert("AgentStarted");
    const outcome = yield* call(ownerCredential, "start", startPayload(rig));
    expect(failureOf(outcome)?._tag).toBe("LogWriteFailed");

    const sql = yield* SqlClient.SqlClient;
    expect(yield* sql`SELECT COUNT(*) AS n FROM agent_tokens`).toEqual([{ n: 0 }]);
    expect(fakes.runner.callsOf("start")).toEqual([]);
  })).pipe(Effect.orDie));

it.effect("5b stop token: catches a stop that leaves the stopped agent's token valid, so a stopped agent can still call the engine", () =>
  withRig(() => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-a", state: "working" });
    expect(yield* tokenWorks(agent.token)).toBe(true);
    success(yield* call(ownerCredential, "stop", { agentId: "agent-a" }));
    expect(yield* tokenWorks(agent.token)).toBe(false);
    expect(yield* liveTokens("agent-a")).toBe(0);
  })).pipe(Effect.orDie));

it.effect("5b stop token atomic: catches a stop that revokes the token in a write apart from AgentStopped, so a failed append leaves a stopped-looking agent without a token or the reverse", () =>
  withRig((fakes) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-a", state: "working" });
    yield* failEventsInsert("AgentStopped");
    const outcome = yield* call(ownerCredential, "stop", { agentId: "agent-a" });
    expect(failureOf(outcome)?._tag).toBe("LogWriteFailed");
    expect(yield* tokenWorks(agent.token)).toBe(true);
    expect(fakes.runner.callsOf("stop")).toEqual([]);
  })).pipe(Effect.orDie));

// The decision rows do not say which module turns a child exit into
// AgentCrashed (the runner's own events are a 6x concern). This test reads
// row 32 as: when the Runner reports that an agent's process ended, the
// handler layer writes AgentCrashed with the token revocation in one append.
// It uses the event `{ _tag: "exited", agentId, exitCode, signal, stderr }`
// on `Runner.events`; the interpretation is recorded in result.md.
const eventually = <A, E, R>(check: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 80; attempt++) {
      const value = yield* check;
      if (done(value)) return value;
      yield* Effect.sleep("25 millis");
    }
    return yield* check;
  });

it.live("5b crash token: catches a crash that is written without revoking the agent's token, or a revocation written in a separate append", () =>
  withRig((fakes) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-a", state: "working" });
    const before = yield* headSequence;
    yield* Effect.sleep("100 millis"); // the handler layer subscribes to the runner's events
    yield* fakes.runner.emit({
      _tag: "exited", agentId: agentIdOf("agent-a"), exitCode: 1, signal: null, stderr: "boom",
    } as never);

    const crashed = yield* eventually(stateOf("agent-a"), (state) => state === "crashed");
    expect(crashed).toBe("crashed");
    expect(yield* tokenWorks(agent.token)).toBe(false);
    const written = yield* logAfter(before);
    const crash = written.filter((row) => row.event._tag === "AgentCrashed");
    expect(crash).toHaveLength(1);
    expect(crash[0]?.event).toMatchObject({ exitCode: 1, signal: null });
  })).pipe(Effect.orDie));

it.effect("5b crash then resume: catches a crash whose token stays valid after a reload, or a reload that cannot mint a token for a crashed agent", () =>
  withRig((fakes) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-a", state: "crashed" });
    expect(yield* tokenWorks(agent.token)).toBe(false);
    success(yield* call(ownerCredential, "resume", { agentId: "agent-a" }));
    const given = tokenOf(fakes.runner.callsOf("load")[0]!);
    expect(yield* verifyAgentToken(given)).toBe("agent-a");
    expect(yield* tokenWorks(agent.token)).toBe(false);
  })).pipe(Effect.orDie));

it.effect("5b failed start token: catches an adapter rejection that leaves the new agent's token live (row 70 writes AgentStartFailed and revokes)", () =>
  withRig((fakes) => Effect.gen(function* () {
    fakes.runner.rejectNext("start", "adapter said no");
    yield* call(ownerCredential, "start", startPayload(rig));
    const started = (yield* readLog).find((row) => row.event._tag === "AgentStarted")?.event;
    expect(started?._tag).toBe("AgentStarted");
    expect(yield* liveTokens((started as { agentId: string }).agentId)).toBe(0);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// 4. Receipts (row 30)
//
// The body hash I chose: SHA-256, in hex, of the canonical JSON (keys sorted
// at every depth, no spaces) of { command, payload } where payload is the
// decoded payload without `requestId`. `accounts set-secret` hashes only
// { command, accountId, nonce } (row 55), never the value or the name.
// ---------------------------------------------------------------------------

it.effect("5b receipt reply: catches a retry that runs the command again instead of returning the first reply, so one request id starts two agents", () =>
  withRig((fakes) => Effect.gen(function* () {
    const requestId = freshRequest();
    const payload = startPayload(rig, { requestId });
    const first = success(yield* call(ownerCredential, "start", payload));
    const before = yield* headSequence;
    const second = success(yield* call(ownerCredential, "start", payload));

    expect(second).toEqual(first);
    expect(yield* logAfter(before)).toEqual([]);
    expect(fakes.runner.callsOf("start")).toHaveLength(1);
  })).pipe(Effect.orDie));

it.effect("5b receipt before state: catches a retry of 'stop' that checks the state table first, so the retry of a stop that worked is answered 'command refused' and writes a refusal", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a", state: "working" });
    const requestId = freshRequest();
    const first = success(yield* call(ownerCredential, "stop", { requestId, agentId: "agent-a" }));
    const before = yield* headSequence;
    const second = success(yield* call(ownerCredential, "stop", { requestId, agentId: "agent-a" }));
    expect(second).toEqual(first);
    expect(yield* logAfter(before)).toEqual([]);
  })).pipe(Effect.orDie));

it.effect("5b receipt reuse: catches a handler that answers a reused request id with a different body by running it or by returning the first reply", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    const requestId = freshRequest();
    success(yield* call(ownerCredential, "prompt", { requestId, agentId: "agent-a", text: "First text." }));
    const before = yield* headSequence;
    const outcome = yield* call(ownerCredential, "prompt", { requestId, agentId: "agent-a", text: "Second text." });

    expect(failureOf(outcome)?.reason).toBe("request id reused");
    expect(yield* logAfter(before)).toEqual([]);
  })).pipe(Effect.orDie));

it.effect("5b receipt reuse, other command: catches a body hash that leaves out the command name, so 'stop' and 'compact' with one id and one agent look like a retry", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    const requestId = freshRequest();
    success(yield* call(ownerCredential, "compact", { requestId, agentId: "agent-a" }));
    const before = yield* headSequence;
    const outcome = yield* call(ownerCredential, "stop", { requestId, agentId: "agent-a" });
    expect(failureOf(outcome)?.reason).toBe("request id reused");
    expect(yield* logAfter(before)).toEqual([]);
    expect(yield* stateOf("agent-a")).toBe("idle");
  })).pipe(Effect.orDie));

it.effect("5b receipt key order: catches a body hash taken from the payload's key order, so the same body with its fields in another order is refused as reused", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a", groups: ["alpha"] });
    const requestId = freshRequest();
    const first = success(yield* call(ownerCredential, "group", { requestId, agentId: "agent-a", add: ["x", "y"], remove: [] }));
    const second = success(yield* call(ownerCredential, "group", { remove: [], add: ["x", "y"], agentId: "agent-a", requestId }));
    expect(second).toEqual(first);
  })).pipe(Effect.orDie));

it.effect("5b receipt per caller: catches a receipt keyed by request id alone, so one caller's id blocks or answers another caller", () =>
  withRig(() => Effect.gen(function* () {
    const parent = yield* seedAgent({ id: "agent-p" });
    yield* seedAgent({ id: "agent-c", parent: "agent-p" });
    const requestId = freshRequest();
    const byOwner = success(yield* call(ownerCredential, "prompt", { requestId, agentId: "agent-c", text: "Same text." }));
    const byParent = success(yield* call(agentCredential(parent.token), "prompt", { requestId, agentId: "agent-c", text: "Same text." }));
    expect(byParent.deliveryId).not.toBe(byOwner.deliveryId);
    const queued = (yield* readLog).filter((row) => row.event._tag === "DeliveryQueued");
    expect(queued.map((row) => row.caller)).toEqual([{ _tag: "owner" }, { _tag: "agent", agentId: "agent-p" }]);
  })).pipe(Effect.orDie));

it.effect("5b receipt of a refusal: catches a refused command whose retry runs the state table again and writes a second CommandRefused", () =>
  withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a", state: "stopped" });
    const requestId = freshRequest();
    const first = yield* call(ownerCredential, "compact", { requestId, agentId: "agent-a" });
    expect(failureOf(first)?.reason).toBe("command refused");
    const refusals = () => readLog.pipe(Effect.map((rows) => rows.filter((row) => row.event._tag === "CommandRefused").length));
    expect(yield* refusals()).toBe(1);
    const second = yield* call(ownerCredential, "compact", { requestId, agentId: "agent-a" });
    expect(failureOf(second)?.reason).toBe("command refused");
    expect(yield* refusals()).toBe(1);
  })).pipe(Effect.orDie));

it.effect("5b receipt of set-secret (row 55): catches a receipt hash that covers the secret value, so a retry with the same account and nonce is refused", () =>
  withRig((fakes) => Effect.gen(function* () {
    const requestId = freshRequest();
    const base = { requestId, accountId: "primary", nonce: "nonce-aaaa" };
    const first = success(yield* call(ownerCredential, "accounts set-secret", {
      ...base, name: "API_KEY", value: Redacted.make("first-value-0123456789"),
    }));
    const second = success(yield* call(ownerCredential, "accounts set-secret", {
      ...base, name: "API_KEY", value: Redacted.make("second-value-0123456789"),
    }));
    expect(second).toEqual(first);
    // The retry did not write the second value.
    expect([...fakes.secrets.stored.values()]).toEqual(["first-value-0123456789"]);
  })).pipe(Effect.orDie));

it.effect("5b receipt of set-secret: catches a hash that leaves out the nonce, so a new nonce is mistaken for a retry", () =>
  withRig(() => Effect.gen(function* () {
    const requestId = freshRequest();
    const body = { requestId, accountId: "primary", name: "API_KEY", value: Redacted.make("value-0123456789abcdef") };
    success(yield* call(ownerCredential, "accounts set-secret", { ...body, nonce: "nonce-one-aaaa" }));
    const outcome = yield* call(ownerCredential, "accounts set-secret", { ...body, nonce: "nonce-two-bbbb" });
    expect(failureOf(outcome)?.reason).toBe("request id reused");
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// 5. Error reasons and log lines hold no request content (rows 55, 59)
//
// Every free-text field of a command carries a unique planted string. The
// reason of every refusal and of a failed log write, the text of every
// CommandRefused event and every line the service logs must not contain one,
// nor the raw token of the calling agent. The logger here has an identity
// redactor, so a planted string in a line means the handler logged it.
// ---------------------------------------------------------------------------

const plant = (field: string) => `PLANTED-${field}-5f1c9a7e3b20`;

interface Scenario {
  readonly name: string;
  // Seeds state, calls, and returns the outcome and every string planted.
  readonly run: () => Effect.Effect<{ readonly outcome: Outcome; readonly planted: ReadonlyArray<string>; readonly token: string | undefined }, unknown, any>;
}

const absentFolder = (...names: ReadonlyArray<string>) => {
  const path = `${rig.outside}/${names.join("/")}`;
  mkdirSync(path, { recursive: true });
  return path;
};

const scenarios: ReadonlyArray<Scenario> = [
  {
    name: "start refused by the folder ceiling",
    run: () => Effect.gen(function* () {
      const caller = yield* seedAgent({ id: "agent-x" });
      const planted = ["name", "role", "model", "effort", "prompt", "group", "folder"].map(plant);
      const [name, role, model, effort, prompt, group, folder] = planted as [string, string, string, string, string, string, string];
      const outcome = yield* call(agentCredential(caller.token), "start", startPayload(rig, {
        name, role, model, effort, prompt, groups: [group], folder: absentFolder(folder),
      }));
      return { outcome, planted, token: caller.token };
    }),
  },
  {
    name: "start by the owner with a model and effort the harness does not offer",
    run: () => Effect.gen(function* () {
      const planted = ["name", "role", "model", "effort", "prompt", "group"].map(plant);
      const [name, role, model, effort, prompt, group] = planted as [string, string, string, string, string, string];
      const outcome = yield* call(ownerCredential, "start", startPayload(rig, { name, role, model, effort, prompt, groups: [group] }));
      return { outcome, planted, token: undefined };
    }),
  },
  {
    name: "prompt by an unrelated agent",
    run: () => Effect.gen(function* () {
      const caller = yield* seedAgent({ id: "agent-x" });
      yield* seedAgent({ id: "agent-a" });
      const text = plant("prompt-text");
      const outcome = yield* call(agentCredential(caller.token), "prompt", { agentId: "agent-a", text });
      return { outcome, planted: [text], token: caller.token };
    }),
  },
  {
    name: "prompt to a stopped agent",
    run: () => Effect.gen(function* () {
      yield* seedAgent({ id: "agent-a", state: "stopped" });
      const text = plant("stopped-prompt");
      const outcome = yield* call(ownerCredential, "prompt", { agentId: "agent-a", text });
      return { outcome, planted: [text], token: undefined };
    }),
  },
  {
    name: "group by an unrelated agent",
    run: () => Effect.gen(function* () {
      const caller = yield* seedAgent({ id: "agent-x" });
      yield* seedAgent({ id: "agent-a" });
      const planted = [plant("add"), plant("remove")];
      const outcome = yield* call(agentCredential(caller.token), "group", { agentId: "agent-a", add: [planted[0]], remove: [planted[1]] });
      return { outcome, planted, token: caller.token };
    }),
  },
  {
    name: "accounts add by an agent",
    run: () => Effect.gen(function* () {
      const caller = yield* seedAgent({ id: "agent-x" });
      const planted = [plant("display"), plant("home"), plant("env")];
      const outcome = yield* call(agentCredential(caller.token), "accounts", {
        operation: "add",
        account: { id: "spare", harness: "first", displayName: planted[0], home: `/${planted[1]}`, environment: { REGION: planted[2] }, enabled: true },
      });
      return { outcome, planted, token: caller.token };
    }),
  },
  {
    name: "accounts set-secret by an agent",
    run: () => Effect.gen(function* () {
      const caller = yield* seedAgent({ id: "agent-x" });
      const planted = [plant("secret-name"), plant("nonce"), plant("secret-value")];
      const outcome = yield* call(agentCredential(caller.token), "accounts set-secret", {
        accountId: "primary", name: planted[0], nonce: planted[1], value: Redacted.make(planted[2]!),
      });
      return { outcome, planted, token: caller.token };
    }),
  },
  {
    name: "accounts set-secret by the owner for an account that does not exist",
    run: () => Effect.gen(function* () {
      const planted = [plant("missing-name"), plant("missing-nonce"), plant("missing-value")];
      const outcome = yield* call(ownerCredential, "accounts set-secret", {
        accountId: "no-such-account", name: planted[0], nonce: planted[1], value: Redacted.make(planted[2]!),
      });
      return { outcome, planted, token: undefined };
    }),
  },
  {
    name: "harnesses set by an agent",
    run: () => Effect.gen(function* () {
      const caller = yield* seedAgent({ id: "agent-x" });
      const planted = [plant("adapter-path"), plant("adapter-argument"), plant("model-name")];
      const outcome = yield* call(agentCredential(caller.token), "harnesses", {
        operation: "set",
        harness: harnessSettings("first", { adapterPath: `/opt/${planted[0]}`, adapterArguments: [planted[1]], models: [planted[2]] }),
      });
      return { outcome, planted, token: caller.token };
    }),
  },
  {
    name: "a reused request id",
    run: () => Effect.gen(function* () {
      yield* seedAgent({ id: "agent-a" });
      const requestId = freshRequest();
      success(yield* call(ownerCredential, "prompt", { requestId, agentId: "agent-a", text: "An ordinary first text." }));
      const text = plant("reused-text");
      const outcome = yield* call(ownerCredential, "prompt", { requestId, agentId: "agent-a", text });
      return { outcome, planted: [text], token: undefined };
    }),
  },
  {
    name: "a command with a revoked token",
    run: () => Effect.gen(function* () {
      const caller = yield* seedAgent({ id: "agent-x", state: "stopped" });
      yield* seedAgent({ id: "agent-a" });
      const text = plant("revoked-text");
      const outcome = yield* call(agentCredential(caller.token), "prompt", { agentId: "agent-a", text });
      return { outcome, planted: [text], token: caller.token };
    }),
  },
];

const withLines = <A, E, R>(lines: Array<string>, program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(Layer.mergeAll(
      redactingLoggerLayer({ redactText: (text: string) => text }, (line) => { lines.push(line); }),
      Layer.succeed(MinimumLogLevel, "All"),
    )),
  );

for (const scenario of scenarios) {
  it.effect(`5b error reasons, ${scenario.name}: catches a CommandRefused reason, a CommandRefused event or a log line that holds prompt text, a name, a folder, a model, a secret or the caller's token`, () => {
    const lines: Array<string> = [];
    return withLines(lines, withRig((fakes) => Effect.gen(function* () {
      const before = yield* headSequence;
      const { outcome, planted, token } = yield* scenario.run();
      const failure = failureOf(outcome);
      expect(failure, "the scenario must be refused or fail").toBeDefined();

      const written = (yield* logAfter(before)).filter((row) => row.event._tag === "CommandRefused");
      const searched = [JSON.stringify(failure), JSON.stringify(written), ...lines];
      const forbidden = [...planted, ...(token === undefined ? [] : [token])];
      for (const text of forbidden) {
        for (const where of searched) expect(where).not.toContain(text);
      }
      expect(failure?.reason.length).toBeLessThan(100);
    })));
  });
}

it.effect("5b error reasons, a failed log write: catches a LogWriteFailed reason or log line that repeats the database's message, which here carries the request's text", () => {
  const lines: Array<string> = [];
  return withLines(lines, withRig(() => Effect.gen(function* () {
    yield* seedAgent({ id: "agent-a" });
    const text = plant("write-failure-prompt");
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(`CREATE TRIGGER planted_failure BEFORE INSERT ON events WHEN NEW.event_type = 'DeliveryQueued'
      BEGIN SELECT RAISE(ABORT, '${plant("database-message")}'); END`);
    const outcome = yield* call(ownerCredential, "prompt", { agentId: "agent-a", text });
    const failure = failureOf(outcome);
    expect(failure?._tag).toBe("LogWriteFailed");
    for (const where of [JSON.stringify(failure), ...lines]) {
      expect(where).not.toContain(text);
      expect(where).not.toContain(plant("database-message"));
    }
  })));
});

it.effect("5b error reasons, a failed log write on start: catches a start whose failure reason holds the new agent's name, prompt, folder or token", () => {
  const lines: Array<string> = [];
  return withLines(lines, withRig((fakes) => Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(`CREATE TRIGGER planted_failure BEFORE INSERT ON events WHEN NEW.event_type = 'AgentStarted'
      BEGIN SELECT RAISE(ABORT, 'planted insert failure'); END`);
    const planted = ["name", "role", "prompt"].map(plant);
    const outcome = yield* call(ownerCredential, "start", startPayload(rig, {
      name: planted[0], role: planted[1], prompt: planted[2], folder: absentFolder(plant("write-folder")),
    }));
    const failure = failureOf(outcome);
    expect(failure?._tag).toBe("LogWriteFailed");
    for (const where of [JSON.stringify(failure), ...lines]) {
      for (const text of [...planted, plant("write-folder")]) expect(where).not.toContain(text);
    }
    expect(fakes.runner.callsOf("start")).toEqual([]);
  })));
});

it.effect("5b error reasons, a rejected adapter: catches an AgentStartFailed reason or log line that repeats the adapter's own message, which can echo the prompt or a credential", () => {
  const lines: Array<string> = [];
  return withLines(lines, withRig((fakes) => Effect.gen(function* () {
    const secretText = plant("adapter-message");
    fakes.runner.rejectNext("start", `adapter failed with ${secretText}`);
    const outcome = yield* call(ownerCredential, "start", startPayload(rig, { prompt: plant("first-prompt") }));
    const written = yield* readLog;
    const failed = written.find((row) => row.event._tag === "AgentStartFailed")?.event;
    expect(failed).toMatchObject({ _tag: "AgentStartFailed", reason: "could-not-start" });
    for (const where of [JSON.stringify(failureOf(outcome) ?? null), JSON.stringify(written), ...lines]) {
      expect(where).not.toContain(secretText);
    }
  })));
});

// ---------------------------------------------------------------------------
// 6. Side-row text (issue 50, rows 32 and 59)
// ---------------------------------------------------------------------------

const planted = "side-row-secret-0123456789abcdef";
const redactorWith = (secret: string) => makeRedactor({ secrets: () => [Redacted.make(secret)], tokenHashes: () => new Set() }).layer;

it.effect("issue 50 redactText: catches a Redactor service with no redactText, or one that returns the text unchanged although a secret is registered", () =>
  Effect.gen(function* () {
    const redactor = yield* Redactor.Redactor;
    const clean = yield* redactor.redactText(`Phone ${planted} two`);
    expect(clean).not.toContain(planted);
    expect(clean).toContain("[REDACTED]");
    expect(clean).toBe("Phone [REDACTED] two");
    expect(yield* redactor.redactText("no secret here")).toBe("no secret here");
  }).pipe(Effect.provide(redactorWith(planted)), Effect.orDie));

it.effect("issue 50 pass-through redactText: catches a pass-through layer that lacks redactText, so a log built on it fails at its first side row", () =>
  Effect.gen(function* () {
    const redactor = yield* Redactor.Redactor;
    expect(yield* redactor.redactText("kept as is")).toBe("kept as is");
  }).pipe(Effect.provide(Redactor.layer), Effect.orDie));

for (const field of ["process-executable"] as const) {
  it.effect(`issue 50 ${field}: catches a side-row text that reaches the database unredacted, or a redaction that writes a carrier DeviceAdded event named side-row-text`, () =>
    withRig(() => Effect.gen(function* () {
      const log = yield* EventLog.EventLog;
      const sql = yield* SqlClient.SqlClient;
      const before = yield* headSequence;
      const owned = {
          processes: [{
            agentId: agentIdOf("agent-a"), groupId: 42, bootId: "boot" as never, startTime: "123", userId: 1000,
            executable: `/tmp/${planted}/runner`,
          }],
        };
      yield* log.append({ _tag: "owner" }, freshRequest(), "a".repeat(64), [eventOf({ _tag: "TurnStarted", agentId: "agent-a" })], owned);

      const rows = yield* sql<{ executable: string }>`SELECT executable FROM processes`;
      expect(JSON.stringify(rows)).not.toContain(planted);
      expect(JSON.stringify(rows)).toContain("[REDACTED]");

      // The only event the append wrote is the one it was given.
      const written = (yield* logAfter(before)).map((row) => row.event);
      expect(written).toEqual([{ _tag: "TurnStarted", agentId: "agent-a" }]);
      const carriers = yield* sql`SELECT COUNT(*) AS n FROM events WHERE payload_json LIKE '%side-row-text%'`;
      expect(carriers).toEqual([{ n: 0 }]);
      const receipts = yield* sql`SELECT result_json FROM receipts`;
      expect(JSON.stringify(receipts)).not.toContain("side-row-text");
    }), { redactor: redactorWith(planted) }).pipe(Effect.orDie));
}

it.effect("issue 50 no carrier with the pass-through redactor: catches a log that still sends side-row text through a DeviceAdded event, which a counting redactor would see", () =>
  Effect.gen(function* () {
    const seen: Array<string> = [];
    const counting = Layer.succeed(Redactor.Redactor, {
      redact: (event) => Effect.sync(() => { seen.push(event._tag); return event; }),
      redactText: (text: string) => Effect.succeed(text),
    });
    yield* withRig(() => Effect.gen(function* () {
      const log = yield* EventLog.EventLog;
      seen.length = 0;
      yield* log.append({ _tag: "owner" }, freshRequest(), "b".repeat(64), [eventOf({ _tag: "TurnStarted", agentId: "agent-a" })], {
        processes: [{ agentId: agentIdOf("agent-a"), groupId: 42, bootId: "boot" as never, startTime: "123", userId: 1000, executable: "/tmp/runner" }],
      });
      expect(seen).toEqual(["TurnStarted"]);
    }), { redactor: counting });
  }).pipe(Effect.orDie));
