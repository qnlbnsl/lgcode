import { afterEach, expect, it } from "vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { agentEnvironment, cleanupUnit7b, loadClient, prepareRoot, succeed, until } from "../../testing/test/support/unit7b.ts";
import { closeRecoveryPeers, recoveryPeer } from "./support/recoveryPeer.ts";

afterEach(async () => { await closeRecoveryPeers(); await cleanupUnit7b(); });

it("X11 (T-1) catches dropping a shared connection interrupting a sibling unary call instead of retrying both unchanged requests, five times", async () => {
  const connect = await loadClient();
  const rounds = [];
  for (let round = 0; round < 5; round++) {
    const root = prepareRoot();
    let pending = 0;
    const peer = await recoveryPeer(root, (frame, socket, connection) => {
      if (connection === 1) {
        // Both requests reached the shared connection before it disappears.
        if (++pending === 2) socket.close(1012, "restart with two calls pending");
      } else succeed(socket, frame, { requestId: frame.payload.requestId, questionId: `answer-${frame.payload.text}` });
    });
    const payloads = [
      { requestId: `round-${round}-first`, text: "first" },
      { requestId: `round-${round}-second`, text: "second" },
    ];
    const exits = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const client = yield* connect({ environment: agentEnvironment(root) });
      // Capture each exit separately: one interruption cannot cancel the other
      // test branch and masquerade as the sibling-connection defect.
      return yield* Effect.all(payloads.map((payload) => client.ask(payload as never).pipe(
        Effect.timeout(5_000), Effect.exit,
      )), { concurrency: "unbounded" });
    })));
    rounds.push({ peer, payloads, exits });
  }
  for (const [round, { peer, payloads, exits }] of rounds.entries()) {
    expect.soft(peer.requests.filter((request) => request.connection === 1).map(({ frame }) => frame.payload), `round ${round}: initial shared requests`).toEqual(payloads);
    for (const [index, exit] of exits.entries()) {
      expect.soft(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause), `round ${round}, call ${index}: leaked connection interruption`).toBe(false);
      expect.soft(exit).toMatchObject({ _tag: "Success", value: {
        requestId: payloads[index]!.requestId, questionId: `answer-${payloads[index]!.text}`,
      } });
    }
    expect.soft(peer.connections, `round ${round}: exceeded the shared reconnect budget`).toHaveLength(2);
    expect.soft(peer.requests.filter((request) => request.connection === 2).map(({ frame }) => frame.payload).sort((a, b) => a.text.localeCompare(b.text)), `round ${round}: request id or payload lost on retry`).toEqual(payloads);
  }
});

it("X12 (T-1 control) catches mistaking the caller's own interruption for a retryable connection drop", async () => {
  const connect = await loadClient();
  const root = prepareRoot();
  const peer = await recoveryPeer(root, () => { /* hold the call until cancelled */ });
  const exit = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect({ environment: agentEnvironment(root) });
    const fiber = yield* Effect.forkChild(client.ask({ requestId: "caller-cancel", text: "hold" } as never));
    yield* Effect.promise(() => until("the caller's pending RPC", () => peer.requests.length === 1));
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    // Still in the client scope, so a scope finalizer cannot satisfy this.
    yield* Effect.promise(() => until("the caller's RPC interrupt", () => peer.interrupts.some((interrupt) => interrupt.requestId === peer.requests[0]!.frame.id)));
    return exit;
  })));
  expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
  expect(peer.requests).toHaveLength(1);
  expect(peer.connections).toHaveLength(1);
});

it("X13 (T-1 budget control) catches restarting the attempt budget whenever a failed connection is replaced", async () => {
  const { connect } = await import("@lgtm/client");
  const root = prepareRoot();
  const peer = await recoveryPeer(root, (_frame, socket) => socket.close(1012, "every attempt disconnects"));
  const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect({ environment: agentEnvironment(root), attempts: 2 });
    return yield* client.ask({ requestId: "bounded-retry", text: "two attempts only" } as never).pipe(Effect.timeout(3_000));
  })));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Cause.hasInterrupts(exit.cause), "an exhausted connection retry must fail, not interrupt the caller").toBe(false);
    expect(Cause.pretty(exit.cause)).toMatch(/RpcClientError|ClientError/);
  }
  expect(peer.connections, "two attempts must not silently become a new retry budget").toHaveLength(2);
  expect(peer.requests.map(({ connection, frame }) => ({ connection, payload: frame.payload }))).toEqual([
    { connection: 1, payload: { requestId: "bounded-retry", text: "two attempts only" } },
    { connection: 2, payload: { requestId: "bounded-retry", text: "two attempts only" } },
  ]);
});
