import * as Contracts from "@sheprd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { afterEach, expect, it } from "vitest";
import { cleanupUnit7b } from "../../testing/test/support/unit7b.ts";
import { chunk, clientApiPeer, closeClientApiPeers, known } from "./support/clientApiPeer.ts";

afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

it("2.4 an unknown tag and future caller advance the cursor before reconnecting to subsequent known events through real RPC chunks", async () => {
  let calls = 0;
  const future = { ...known(31), caller: { _tag: "future-service", name: "board.fixture" },
    event: { _tag: "board.FutureRecord", text: "Newer server data." } };
  const peer = await clientApiPeer("node", (frame, socket) => {
    if (++calls === 1) {
      chunk(socket, frame, [future]);
    } else chunk(socket, frame, [known(32), known(33)]);
  }, (socket) => { if (calls === 1) socket.close(1012, "newer server reconnect"); });
  const connect = await peer.connect();
  const result = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    return yield* client.subscribe!({ requestId: "future", after: 30 }).pipe(Stream.take(3), Stream.runCollect, Effect.timeout(3_000));
  })));
  expect(result._tag, "E25 must tolerate unknown event and caller at the RPC boundary").toBe("Success");
  if (Exit.isSuccess(result)) {
    expect(result.value).toMatchObject([
      { sequence: 31, event: { tag: "board.FutureRecord", namespace: "board" } },
      { sequence: 32, event: { _tag: "TurnEnded" } }, { sequence: 33, event: { _tag: "TurnEnded" } },
    ]);
  }
  expect(peer.requests.map(({ frame }) => frame.payload.after)).toEqual([30, 31]);
});

it("2.4 a malformed known event fails decoding instead of becoming an unknown record or advancing the cursor", async () => {
  const peer = await clientApiPeer("node", (frame, socket) => chunk(socket, frame, [
    { ...known(1), event: { _tag: "TurnEnded", agentId: "agent-a", compact: "invalid" } }, known(2),
  ]));
  const connect = await peer.connect();
  const delivered: unknown[] = [];
  const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    return yield* client.subscribe!({ requestId: "malformed", after: 0 }).pipe(
      Stream.tap((item) => Effect.sync(() => { delivered.push(item); })), Stream.take(2), Stream.runCollect, Effect.timeout(3_000));
  })));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).not.toMatch(/Timeout/);
  expect(delivered).toEqual([]);
});

it("2.4 the durable engine envelope remains strict for unknown tags and malformed known events", () => {
  const decode = Schema.decodeUnknownSync(Contracts.EventEnvelope);
  expect(decode(known(1))).toMatchObject({ sequence: 1 });
  expect(() => decode({ ...known(2), event: { _tag: "board.FutureRecord" } })).toThrow();
  expect(() => decode({ ...known(2), event: { _tag: "TurnEnded", compact: "invalid" } })).toThrow();
});
