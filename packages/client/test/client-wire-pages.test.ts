// Supplement the frozen acceptance cases with real client response schemas.
// Install definitions only in this fixture; production still has no handlers.
import { vi, afterEach, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import { cleanupUnit7b } from "../../testing/test/support/unit7b.ts";
import { chunk, clientApiPeer, closeClientApiPeers, known, succeed, type TestClient } from "./support/clientApiPeer.ts";

vi.mock("@lgcode/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lgcode/contracts")>();
  return { ...actual, CommandsRpcGroup: actual.CommandsRpcGroup.merge(actual.ClientRpcGroup),
    WireCommandsRpcGroup: actual.WireCommandsRpcGroup.merge(actual.WireClientRpcGroup) };
});

afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

type Reads = TestClient & {
  "client.thread": (payload: any) => Effect.Effect<any, unknown>;
  "client.snapshot": (payload: any) => Effect.Effect<any, unknown>;
};

it.each(["client.Checkpoint", "client.Oversized"])("a %s survives the real filtered-stream schema and reconnects at its cursor", async (tag) => {
  let calls = 0;
  const marker = tag === "client.Checkpoint" ? { _tag: tag, sequence: 21 }
    : { _tag: tag, sequence: 21, tag: "ThreadItem", bytes: 300_000 };
  const peer = await clientApiPeer("node", (frame, socket) => chunk(socket, frame, [++calls === 1 ? marker : known(22)]),
    (socket) => { if (calls === 1) socket.close(1012, "resume marker"); });
  const connect = await peer.connect();
  const items = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    return yield* client["client.subscribe"]({ requestId: "real-marker", after: 20, filter: { groups: ["team"] } })
      .pipe(Stream.take(2), Stream.runCollect, Effect.timeout(3_000));
  })));
  expect(items).toMatchObject([marker, { sequence: 22 }]);
  expect(peer.requests.map(({ frame }) => frame.payload.after)).toEqual([20, 21]);
  expect(peer.requests[1]!.frame.payload.filter).toEqual({ groups: ["team"] });
});

it("a real thread page tolerates a newer envelope while decoding known events above RPC", async () => {
  const future = { ...known(31), caller: { _tag: "future-caller" }, event: { _tag: "board.Future", text: "New data." } };
  const peer = await clientApiPeer("node", (frame, socket) => succeed(socket, frame, {
    requestId: frame.payload.requestId, items: [future, known(32)], next: 32,
  }));
  const connect = await peer.connect();
  const reply = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = (yield* connect) as Reads;
    return yield* client["client.thread"]({ requestId: "page", agentId: "agent-a", after: 30, limit: 2 });
  })));
  expect(reply).toMatchObject({ items: [
    { sequence: 31, event: { _tag: "UnknownEvent", tag: "board.Future", namespace: "board" } },
    { sequence: 32, event: { _tag: "TurnEnded" } },
  ], next: 32 });
});

it("a malformed known event in a real thread page fails decoding", async () => {
  const peer = await clientApiPeer("node", (frame, socket) => succeed(socket, frame, {
    requestId: frame.payload.requestId, items: [{ ...known(1), event: { _tag: "TurnEnded", compact: "invalid" } }],
  }));
  const connect = await peer.connect();
  const result = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
    const client = (yield* connect) as Reads;
    return yield* client["client.thread"]({ requestId: "bad-page", agentId: "agent-a", after: 0, limit: 1 });
  })));
  expect(Exit.isFailure(result)).toBe(true);
});

it("an opaque snapshot section stays data when it resembles a malformed event envelope", async () => {
  const section = { ...known(1), event: { _tag: "TurnEnded", compact: "invalid" } };
  const peer = await clientApiPeer("node", (frame, socket) => succeed(socket, frame, {
    requestId: frame.payload.requestId, sequence: 0, agents: [], requests: [], questions: [],
    requestsWithoutDisplay: 0, questionsWithoutDisplay: 0, board: section,
  }));
  const connect = await peer.connect();
  const reply = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = (yield* connect) as Reads;
    return yield* client["client.snapshot"]({ requestId: "opaque" });
  })));
  expect(reply.board).toEqual(section);
});
