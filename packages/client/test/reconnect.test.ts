// Issues 77/170: receipts and cursors survive connection replacement.
import { afterEach, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  agentEnvironment, chunk, cleanupUnit7b, fakeEngine, loadClient, prepareRoot, succeed, type RequestFrame,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

const event = (sequence: number) => ({
  sequence, eventId: `event-${sequence}`, occurredAt: 1_800_000_000_000 + sequence,
  caller: { _tag: "agent", agentId: "member" }, agentId: "member",
  event: { _tag: "TurnEnded", agentId: "member", compact: false },
});

it("R01 catches restarting subscribe at zero/the original cursor after a mid-catch-up disconnect, duplicating or losing events", async () => {
  const connect = await loadClient();
  const root = prepareRoot();
  const starts: Array<number> = [];
  const engine = await fakeEngine(root, {
    onRequest: (frame, socket, connection) => {
      starts.push(frame.payload.after);
      const available = [101, 102, 103, 104].filter((sequence) => sequence > Number(frame.payload.after));
      const values = (connection === 1 ? available.slice(0, 2) : available).map(event);
      if (values.length > 0) chunk(socket, frame, values);
      else succeed(socket, frame, undefined);
    },
    // Ack is the named protocol barrier that the first chunk was consumed.
    onAck: (socket, connection) => { if (connection === 1) socket.close(1013, "subscription backlog"); },
  });
  const received = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect({ environment: agentEnvironment(root) });
    return yield* client.subscribe({ requestId: "subscription-original", after: 100 } as never).pipe(
      Stream.take(4), Stream.runCollect, Effect.timeout(10_000),
    );
  })));
  expect(starts).toEqual([100, 102]);
  expect(engine.requests.every((frame) => frame.tag === "subscribe")).toBe(true);
  expect(received.map((envelope) => envelope.sequence)).toEqual([101, 102, 103, 104]);
  expect(new Set(received.map((envelope) => envelope.eventId)).size).toBe(4);
});

it("R02 catches retrying a blocking wait with its committed request id and returning the stored opened receipt instead of the final outcome", async () => {
  const connect = await loadClient();
  const root = prepareRoot();
  const calls: Array<RequestFrame> = [];
  await fakeEngine(root, { onRequest: (frame, socket) => {
    calls.push(frame);
    if (calls.length === 1) { socket.close(1012, "service connection replaced"); return; }
    const reused = frame.payload.requestId === calls[0]!.payload.requestId;
    succeed(socket, frame, {
      requestId: frame.payload.requestId, waitId: reused ? "old-wait" : "new-wait",
      outcome: reused ? "opened" : "satisfied", members: reused ? [] : [{ agentId: "member", reason: "settled" }],
    });
  } });
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect({ environment: agentEnvironment(root) });
    return yield* client.wait({ requestId: "wait-original", members: ["member"], mode: "all", block: true } as never).pipe(Effect.timeout(10_000));
  })));
  expect(calls).toHaveLength(2);
  expect(calls.every((frame) => frame.tag === "wait")).toBe(true);
  expect(calls[0]!.payload.requestId).toBe("wait-original");
  expect(calls[1]!.payload.requestId).not.toBe(calls[0]!.payload.requestId);
  expect(calls[1]!.payload).toMatchObject({ members: ["member"], mode: "all", block: true });
  expect(result).toMatchObject({ outcome: "satisfied", members: [{ agentId: "member", reason: "settled" }] });
});
