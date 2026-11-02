// Criterion 7.2 (unit 7a; rows 48, 73; SECURITY.md rules 2, 4, 6): an
// upgrade without a credential, with a revoked one, or with a malformed one
// is refused before any RPC message; revoking a credential closes its open
// connections, because each connection is raced against an invalidation
// signal. The server is built in process over the real command handler, log
// and views, with the fake runner (`api/server.ts`, `serve`).
import { randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import { DeviceId } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type WebSocket from "ws";

import * as Server from "../../src/api/server.ts";
import { mintAgentToken } from "../../src/identity/tokens.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  appendSetup, call, eventOf, headSequence, makeFakeSecrets, makeRig, ownerCredential, provideRig, removeRig,
  rotateToken, seedAccount, seedAgent, seedDevice, seedHarness, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ancestryHeaders, authorization, connect, requestFrame, upgrade, upgradeStatus } from "../support/socketClient.ts";

const ownerSecret = randomBytes(32).toString("base64url");

interface Context {
  readonly rig: Rig;
  readonly socket: string;
}

// The server listens for the life of the body's scope.
const withServer = <A, E>(body: (context: Context) => Effect.Effect<A, E, any>) => Effect.gen(function* () {
  const rig = makeRig();
  chmodSync(rig.stateFolder, 0o700);
  const socket = join(rig.stateFolder, "engine.sock");
  const runner = yield* makeFakeRunner();
  return yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedHarness();
    yield* seedAccount();
    yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(ownerSecret), debug: false });
    return yield* body({ rig, socket });
  })).pipe(Effect.ensuring(Effect.sync(() => removeRig(rig))));
});

const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, 60_000);

const promise = <A>(run: () => Promise<A>) => Effect.promise(run);

const closed = (socket: WebSocket) => new Promise<{ code: number }>((resolve) => {
  if (socket.readyState === socket.CLOSED) resolve({ code: -1 });
  socket.once("close", (code) => resolve({ code }));
});

// The socket closes within `limit`, or the test fails.
const closesWithin = (socket: WebSocket, what: string, limit = 10_000) => promise(() => Promise.race([
  closed(socket).then(() => true),
  new Promise<boolean>((resolve) => setTimeout(() => resolve(false), limit)),
])).pipe(Effect.flatMap((done) => done ? Effect.void : Effect.die(new Error(`${what} stayed open after revocation`))));

const expectRefused = (socket: string, headers: Record<string, string>, secret?: string) => Effect.gen(function* () {
  const before = yield* headSequence;
  const outcome = yield* promise(() => upgradeStatus(socket, headers));
  expect(outcome.status, JSON.stringify(headers)).toBe(401);
  if (secret !== undefined && secret.length > 0) expect(outcome.body).not.toContain(secret);
  expect(outcome.body.length).toBeLessThan(200);
  // Nothing reached the handler: a refused upgrade writes no event.
  expect(yield* headSequence).toBe(before);
});

live("7.2 an upgrade with no credential, or with an Authorization header that is not a bearer credential, is refused with 401 before any RPC message (breaks if a credential-less upgrade is accepted and refused per message, or only some header forms are checked)", () =>
  withServer(({ socket }) => Effect.gen(function* () {
    yield* expectRefused(socket, { ...ancestryHeaders() });
    yield* expectRefused(socket, { Authorization: "", ...ancestryHeaders() });
    yield* expectRefused(socket, { Authorization: "Bearer", ...ancestryHeaders() });
    yield* expectRefused(socket, { Authorization: `Basic ${Buffer.from(`owner:${ownerSecret}`).toString("base64")}`, ...ancestryHeaders() }, ownerSecret);
    yield* expectRefused(socket, { Authorization: `Token ${ownerSecret}`, ...ancestryHeaders() }, ownerSecret);
  })));

live("7.2 a malformed credential is refused with 401, and the refusal body never repeats it (breaks if a near-miss owner credential, a bad checksum or a truncated token is accepted, or the body echoes the value)", () =>
  withServer(({ socket }) => Effect.gen(function* () {
    const token = Redacted.value(mintAgentToken().token);
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    const nearOwner = (ownerSecret[0] === "A" ? "B" : "A") + ownerSecret.slice(1);
    for (const value of [nearOwner, `${ownerSecret}x`, ownerSecret.slice(0, -1), flipped, token.slice(0, 20), "shp_a_", "x".repeat(4096), `${token} ${token}`]) {
      yield* expectRefused(socket, { ...authorization(value), ...ancestryHeaders() }, value);
    }
  })));

live("7.2 a revoked agent token, a revoked device credential and a well-formed token that was never issued are refused with 401 on upgrade (breaks if only the token's shape is checked on upgrade, or revoked rows are not filtered)", () =>
  withServer(({ socket }) => Effect.gen(function* () {
    const stopped = yield* seedAgent({ id: "agent-stopped", state: "stopped" });
    const live = yield* seedAgent({ id: "agent-rotated" });
    yield* rotateToken(live.agentId);
    const device = yield* seedDevice("Old phone");
    yield* appendSetup([eventOf({ _tag: "DeviceRevoked", deviceId: device.deviceId })], { revokeDevices: [Schema.decodeUnknownSync(DeviceId)(device.deviceId)] });
    const unknown = Redacted.value(mintAgentToken().token);
    for (const value of [stopped.token, live.token, device.credential, unknown]) {
      yield* expectRefused(socket, { ...authorization(value), ...ancestryHeaders() }, value);
    }
  })));

live("7.2 control: the owner credential, a live agent token and a live device credential are each accepted and can call a command (breaks if the server refuses every upgrade, which would pass the refusal cases)", () =>
  withServer(({ socket }) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-live" });
    const device = yield* seedDevice("Phone");
    for (const value of [ownerSecret, agent.token, device.credential]) {
      const outcome = yield* promise(() => upgradeStatus(socket, { ...authorization(value), ...ancestryHeaders() }));
      expect(outcome.status).toBe(101);
    }
    yield* Effect.scoped(Effect.gen(function* () {
      const owner = yield* connect(socket, ownerSecret);
      const reply = yield* owner.harnesses({ requestId: "request-harness-list", operation: "list" } as never) as Effect.Effect<{ harnesses: ReadonlyArray<unknown> }, unknown>;
      expect(reply.harnesses.length).toBe(1);
      const asAgent = yield* connect(socket, agent.token);
      const asked = yield* asAgent.ask({ requestId: "request-agent-ask", text: "Which file?" } as never) as Effect.Effect<{ questionId: string }, unknown>;
      expect(asked.questionId.length).toBeGreaterThan(0);
    }));
  })));

live("7.2 stopping an agent closes its open connections and its open subscription, and leaves the owner's connection open (breaks if the token is checked only at upgrade, or revocation closes every connection)", () =>
  withServer(({ socket }) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-to-stop" });
    const idle = yield* promise(() => upgrade(socket, { ...authorization(agent.token), ...ancestryHeaders() }));
    const subscribed = yield* promise(() => upgrade(socket, { ...authorization(agent.token), ...ancestryHeaders() }));
    const owner = yield* promise(() => upgrade(socket, { ...authorization(ownerSecret), ...ancestryHeaders() }));
    expect([idle.status, subscribed.status, owner.status]).toEqual([101, 101, 101]);
    subscribed.socket!.send(requestFrame("1", "subscribe", { requestId: "request-subscribe", after: 0 }));
    let ownerClosed = false;
    owner.socket!.once("close", () => { ownerClosed = true; });
    const stop = yield* call(ownerCredential, "stop", { agentId: agent.agentId });
    expect(stop._tag).toBe("Success");
    yield* closesWithin(idle.socket!, "an idle agent connection");
    yield* closesWithin(subscribed.socket!, "an agent connection with an open subscription");
    // The owner's connection still answers a command after the agent's closed.
    yield* Effect.scoped(Effect.gen(function* () {
      const client = yield* connect(socket, ownerSecret);
      yield* client.harnesses({ requestId: "request-after-stop", operation: "list" } as never);
    }));
    expect(ownerClosed).toBe(false);
    owner.socket!.terminate();
  })));

live("7.2 a token rotation closes the old token's connection while the new token connects, and a device revocation closes that device's connection (breaks if the invalidation signal follows only stop events, or is keyed by agent rather than by credential)", () =>
  withServer(({ socket }) => Effect.gen(function* () {
    const agent = yield* seedAgent({ id: "agent-rotating" });
    const old = yield* promise(() => upgrade(socket, { ...authorization(agent.token), ...ancestryHeaders() }));
    expect(old.status).toBe(101);
    const fresh = yield* rotateToken(agent.agentId);
    yield* closesWithin(old.socket!, "the rotated-out token's connection");
    const next = yield* promise(() => upgrade(socket, { ...authorization(fresh), ...ancestryHeaders() }));
    expect(next.status).toBe(101);

    const device = yield* seedDevice("Tablet");
    const other = yield* seedDevice("Laptop");
    const tablet = yield* promise(() => upgrade(socket, { ...authorization(device.credential), ...ancestryHeaders() }));
    const laptop = yield* promise(() => upgrade(socket, { ...authorization(other.credential), ...ancestryHeaders() }));
    let laptopClosed = false;
    laptop.socket!.once("close", () => { laptopClosed = true; });
    yield* appendSetup([eventOf({ _tag: "DeviceRevoked", deviceId: device.deviceId })], { revokeDevices: [Schema.decodeUnknownSync(DeviceId)(device.deviceId)] });
    yield* closesWithin(tablet.socket!, "the revoked device's connection");
    // Rule 4: revoking one device does not sign out another.
    const still = yield* promise(() => upgradeStatus(socket, { ...authorization(other.credential), ...ancestryHeaders() }));
    expect(still.status).toBe(101);
    expect(laptopClosed).toBe(false);
    next.socket!.terminate();
    laptop.socket!.terminate();
  })));
