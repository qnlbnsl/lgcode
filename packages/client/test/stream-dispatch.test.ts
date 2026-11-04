import "./support/clientFixtureGroup.ts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { afterEach, expect, it } from "vitest";
import { cleanupUnit7b } from "../../testing/test/support/unit7b.ts";
import { chunk, clientApiPeer, closeClientApiPeers, known } from "./support/clientApiPeer.ts";

afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

it.each(["subscribe", "client.subscribe"] as const)("2.7 %s dispatches its own tag instead of routing all streams to subscribe", async (tag) => {
  const peer = await clientApiPeer("node", (frame, socket) => chunk(socket, frame, [known(11)]));
  const connect = await peer.connect();
  const received = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    return yield* client[tag]!({ requestId: "dispatch", after: 10 }).pipe(Stream.take(1), Stream.runCollect, Effect.timeout(3_000));
  })));
  expect(peer.requests.map(({ frame }) => frame.tag)).toEqual([tag]);
  expect(received).toMatchObject([{ sequence: 11, event: { _tag: "TurnEnded" } }]);
});

it.each(["event", "checkpoint", "oversized"])("2.7 reconnect after a %s preserves the filter and resumes at the delivered cursor with a fresh request id", async (kind) => {
  const filter = { agents: ["agent-a"], groups: ["team-a"], kinds: ["TurnEnded", "ThreadItem"] };
  const first = kind === "event" ? known(21) : kind === "checkpoint"
    ? { _tag: "client.Checkpoint", sequence: 21 }
    : { _tag: "client.Oversized", sequence: 21, tag: "ThreadItem", agentId: "agent-a", bytes: 300_000 };
  let calls = 0;
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (++calls === 1) chunk(socket, frame, [first]);
    else chunk(socket, frame, [known(22)]);
  }, (socket) => { if (calls === 1) socket.close(1012, "resume cursor"); });
  const connect = await peer.connect();
  const received = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    return yield* client["client.subscribe"]!({ requestId: "filtered-original", after: 20, filter })
      .pipe(Stream.take(2), Stream.runCollect, Effect.timeout(3_000));
  })));
  expect(peer.requests.map(({ frame }) => frame.tag)).toEqual(["client.subscribe", "client.subscribe"]);
  expect(peer.requests[0]!.frame.payload).toEqual({ requestId: "filtered-original", after: 20, filter });
  expect(peer.requests[1]!.frame.payload).toMatchObject({ after: 21, filter });
  expect(peer.requests[1]!.frame.payload.requestId).not.toBe("filtered-original");
  expect(received.map((item: any) => item.sequence)).toEqual([21, 22]);
});
