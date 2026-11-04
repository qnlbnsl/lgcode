import "./support/unit3Group.ts";
import * as Effect from "effect/Effect";
import { afterEach, expect, it } from "vitest";
import { agentRow, snapshot, turnEnd, loadWait, clientApiPeer, closeClientApiPeers, cleanupUnit7b, chunk, succeed, refuse } from "./support/unit3.ts";
afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

it("a failed candidate gate is retried on a quiet log without inventing another event", async () => {
  const initial = snapshot({ agents: [agentRow("agent-a", "working")] });
  const waitForAgents = await loadWait();
  let reads = 0;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "subscribe") chunk(socket, frame, [turnEnd(11)]);
    if (frame.tag === "client.sequence") {
      if (++reads === 1) refuse(socket, frame, "database read failed");
      else succeed(socket, frame, { requestId: frame.payload.requestId, sequence: 11 });
    }
  });
  const connect = await peer.connect();
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    return yield* waitForAgents(yield* connect, { members: ["agent-a"], mode: "all" }).pipe(Effect.timeout(3_000));
  })));
  expect(reads).toBe(2);
  expect(result).toEqual({ outcome: "satisfied", members: [{ agentId: "agent-a", reason: "settled" }] });
});

it("a missing piece snapshot section cannot turn an idle member into a satisfied wait", async () => {
  const initial = snapshot({ failedSections: ["board"] });
  const waitForAgents = await loadWait();
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
  });
  const connect = await peer.connect();
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    return yield* waitForAgents(yield* connect, { members: ["agent-a"], mode: "all" }).pipe(Effect.result, Effect.timeout(3_000));
  })));
  expect(result._tag).toBe("Failure");
});
