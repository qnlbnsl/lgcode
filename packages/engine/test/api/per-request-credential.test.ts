// Unit 7a fix round 1 (criteria 7.2 and 7.12; rows 48, 62, 73; SECURITY.md
// rules 2 and 4). Rulings 1, 2 and 7 of the fix task:
// - Ruling 1: a revoked credential is refused on each new `subscribe` and
//   `debug.compare-views` request, not only at upgrade, even when the
//   revocation wrote side rows only and published no event.
// - Ruling 7: an idle connection whose credential was revoked side-row-only
//   closes within one second (the 100 ms poll in `api/server.ts`).
// - Ruling 2: `debug.compare-views` is owner-only, so a paired device is
//   refused.
// The server is built in process over the real command handler, log and
// views, with the fake runner, as in `auth.test.ts`. Every credential is
// synthetic.
import { randomBytes } from "node:crypto";
import { chmodSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import type WebSocket from "ws";

import * as Server from "../../src/api/server.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  appendSetup, makeFakeSecrets, makeRig, provideRig, removeRig, seedAccount, seedAgent, seedDevice, seedHarness,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { compareViews, kindOf } from "../support/serviceProcess.ts";
import { ancestryHeaders, authorization, connect, requestFrame, upgrade } from "../support/socketClient.ts";

const ownerSecret = randomBytes(32).toString("base64url");

// The server listens for the life of the body's scope.
const withServer = <A, E>(debug: boolean, body: (socket: string) => Effect.Effect<A, E, any>) => Effect.gen(function* () {
  const rig = makeRig();
  chmodSync(rig.stateFolder, 0o700);
  const socket = join(rig.stateFolder, "engine.sock");
  const runner = yield* makeFakeRunner();
  return yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedHarness();
    yield* seedAccount();
    yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(ownerSecret), debug });
    return yield* body(socket);
  })).pipe(Effect.ensuring(Effect.sync(() => removeRig(rig))));
});

const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, 60_000);

const promise = <A>(run: () => Promise<A>) => Effect.promise(run);

interface Frame {
  readonly _tag?: string;
  readonly requestId?: string;
  readonly exit?: { readonly _tag: string; readonly cause?: ReadonlyArray<{ readonly _tag: string; readonly error?: { readonly _tag?: string; readonly reason?: string } }> };
}

// One raw connection that records every server frame and whether it closed.
interface Recorded {
  readonly socket: WebSocket;
  readonly frames: Array<Frame>;
  readonly closed: () => boolean;
  readonly send: (frame: string) => void;
}

const record = (socket: WebSocket): Recorded => {
  const frames: Array<Frame> = [];
  let closed = false;
  socket.on("message", (data) => {
    try {
      const parsed: unknown = JSON.parse(String(data));
      for (const frame of Array.isArray(parsed) ? parsed : [parsed]) frames.push(frame as Frame);
    } catch { /* not JSON */ }
  });
  socket.once("close", () => { closed = true; });
  return {
    socket, frames, closed: () => closed,
    // A send on a closing socket reports its error to the callback; the
    // closed connection is itself an accepted outcome.
    send: (frame) => socket.send(frame, () => undefined),
  };
};

const open = (socket: string, bearer: string) => Effect.gen(function* () {
  const outcome = yield* promise(() => upgrade(socket, { ...authorization(bearer), ...ancestryHeaders() }));
  expect(outcome.status).toBe(101);
  return record(outcome.socket!);
});

// Polls until `done` holds, never longer than `limit`; returns whether it held.
const within = (limit: number, done: () => boolean) => Effect.gen(function* () {
  const deadline = Date.now() + limit;
  while (!done()) {
    if (Date.now() > deadline) return false;
    yield* Effect.sleep(10);
  }
  return true;
});

const chunksFor = (connection: Recorded, id: string) => connection.frames.filter((frame) => frame._tag === "Chunk" && frame.requestId === id);
const exitFor = (connection: Recorded, id: string) => connection.frames.find((frame) => frame._tag === "Exit" && frame.requestId === id);
const failReason = (frame: Frame) => frame.exit?.cause?.find((part) => part._tag === "Fail")?.error?.reason;

// A request sent after a side-row-only revocation must end in a refusal
// naming the credential, or find the connection closed; it is never served.
const expectNotServed = (connection: Recorded, id: string, what: string, reason: string | undefined) => Effect.gen(function* () {
  const ended = yield* within(5_000, () => connection.closed() || exitFor(connection, id) !== undefined);
  expect(ended, `${what}: the request neither ended nor found the connection closed`).toBe(true);
  // Let any chunk already in flight arrive before judging.
  yield* Effect.sleep(50);
  expect(chunksFor(connection, id), `${what}: a chunk was served after revocation`).toEqual([]);
  const exit = exitFor(connection, id);
  if (exit !== undefined) {
    expect(exit.exit?._tag, `${what}: the request succeeded after revocation`).toBe("Failure");
    if (reason !== undefined) expect(failReason(exit), what).toBe(reason);
  }
  connection.socket.terminate();
});

live("fix1 T-1 ruling 1: a device's new subscribe sent at once after a side-row-only revocation is refused with invalid credential or finds the connection closed, never served a chunk, in 5 of 5 runs (breaks if subscribe does not re-check the credential per request and relies on the 100 ms poll)", () =>
  withServer(false, (socket) => Effect.gen(function* () {
    for (let run = 1; run <= 5; run++) {
      const device = yield* seedDevice(`Phone ${run}`);
      const connection = yield* open(socket, device.credential);
      connection.send(requestFrame("1", "subscribe", { requestId: `request-before-${run}`, after: 0 }));
      const served = yield* within(5_000, () => chunksFor(connection, "1").length > 0);
      expect(served, `run ${run}: the subscribe before revocation returned no chunk`).toBe(true);
      // Side rows only: no event is written, so nothing is published.
      yield* appendSetup([], { revokeDevices: [device.deviceId] });
      connection.send(requestFrame("2", "subscribe", { requestId: `request-after-${run}`, after: 0 }));
      yield* expectNotServed(connection, "2", `run ${run}`, "invalid credential");
    }
  })));

live("fix1 T-1 ruling 1: with the debug group on, an agent's debug.compare-views sent at once after a side-row-only token revocation is refused or finds the connection closed, never answered with a result, in 5 of 5 runs (breaks if debug.compare-views serves a revoked credential)", () =>
  withServer(true, (socket) => Effect.gen(function* () {
    for (let run = 1; run <= 5; run++) {
      const agent = yield* seedAgent({ id: `agent-debug-${run}` });
      const connection = yield* open(socket, agent.token);
      // Prove the connection is live before revocation with a harmless request.
      connection.send(requestFrame("1", "subscribe", { requestId: `request-live-${run}`, after: 0 }));
      yield* within(2_000, () => chunksFor(connection, "1").length > 0 || exitFor(connection, "1") !== undefined);
      expect(connection.closed(), `run ${run}: the agent's connection closed before revocation`).toBe(false);
      yield* appendSetup([], { revokeAgentTokens: [agent.agentId] });
      connection.send(requestFrame("2", "debug.compare-views", { requestId: `request-compare-${run}` }));
      // Either refusal reason is accepted: ruling 1 says invalid credential,
      // ruling 2 refuses every non-owner with the default reason.
      yield* expectNotServed(connection, "2", `run ${run}`, undefined);
    }
  })));

live("fix1 T-2 ruling 7: an idle device connection closes within 1 second of a side-row-only revocation that publishes no event (breaks if the 100 ms credential poll is removed, leaving only the event-driven check)", () =>
  withServer(false, (socket) => Effect.gen(function* () {
    const device = yield* seedDevice("Idle tablet");
    const other = yield* seedDevice("Idle laptop");
    const idle = yield* open(socket, device.credential);
    const control = yield* open(socket, other.credential);
    // Both connections stay open while nothing changes.
    yield* Effect.sleep(300);
    expect([idle.closed(), control.closed()]).toEqual([false, false]);
    yield* appendSetup([], { revokeDevices: [device.deviceId] });
    const closed = yield* within(1_000, idle.closed);
    expect(closed, "the revoked device's idle connection stayed open for 1 second after a side-row-only revocation").toBe(true);
    // Rule 4: revoking one device leaves another device's connection open.
    expect(control.closed()).toBe(false);
    control.socket.terminate();
  })));

live("fix1 T-3 ruling 2: with the debug group on, a paired device's debug.compare-views is refused while the owner's call still returns equal views (breaks if the debug RPC admits any credential without an agent id, as a device has)", () =>
  withServer(true, (socket) => Effect.gen(function* () {
    const device = yield* seedDevice("Paired phone");
    yield* Effect.scoped(Effect.gen(function* () {
      const asDevice = yield* connect(socket, device.credential);
      expect(kindOf(yield* compareViews(asDevice))).toBe("refused");
      // The device's connection itself still works: the refusal is the RPC's.
      yield* asDevice.harnesses({ requestId: "request-device-harnesses", operation: "list" } as never);
      const owner = yield* connect(socket, ownerSecret);
      const exit = yield* compareViews(owner);
      expect(kindOf(exit)).toBe("success");
      const result = (exit as Exit.Success<{ sequence: number; equal: boolean; differences: ReadonlyArray<string> }>).value;
      expect(result.equal).toBe(true);
      expect(result.differences).toEqual([]);
    }));
  })));
