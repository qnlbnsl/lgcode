import "./support/unit3Group.ts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { afterEach, expect, it } from "vitest";
import { ClientError } from "../src/errors.ts";
import { clientApiPeer, closeClientApiPeers, cleanupUnit7b, chunk, succeed, turnEnd } from "./support/unit3.ts";

afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });
const wrap = (json: string) => `Data from another agent [recovery] (delivery read):\n${json}\nEnd data [recovery]`;
const invalid = [wrap("null"), wrap("{}"), wrap('{"envelope":null}'), wrap('{"envelope":{}}'), "bad framing", wrap("{")];
for (const transport of ["node", "browser"] as const) for (const data of invalid) {
  it(`${transport} retries invalid recovery ${data} from the pre-marker cursor before exposing later state`, async () => {
    let streams = 0;
    const source = turnEnd(11);
    const peer = await clientApiPeer(transport, (frame, socket) => {
      if (frame.tag === "client.subscribe") {
        streams++;
        chunk(socket, frame, [{ _tag: "client.Oversized", sequence: 11, tag: "TurnEnded", agentId: "agent-a", bytes: 300_000 }, turnEnd(12)]);
      }
      if (frame.tag === "client.event") succeed(socket, frame, { requestId: frame.payload.requestId,
        data: streams === 1 ? data : wrap(JSON.stringify({ envelope: source })) });
    });
    const connect = await peer.connect();
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const client = yield* connect;
      return yield* client["client.subscribe"]({ requestId: "invalid-recovery", after: 10 }).pipe(Stream.take(2), Stream.runCollect, Effect.timeout(4_000));
    })));
    expect(result).toEqual([source, turnEnd(12)]);
    expect(peer.requests.filter(({ frame }) => frame.tag === "client.subscribe").map(({ frame }) => frame.payload.after)).toEqual([10, 10]);
  });
}
it.each(["node", "browser"] as const)("%s exhausts invalid recovery as a typed ClientError without exposing the marker or tail", async (transport) => {
  const peer = await clientApiPeer(transport, (frame, socket) => {
    if (frame.tag === "client.subscribe") chunk(socket, frame, [{ _tag: "client.Oversized", sequence: 11, tag: "TurnEnded", bytes: 300_000 }, turnEnd(12)]);
    if (frame.tag === "client.event") succeed(socket, frame, { requestId: frame.payload.requestId, data: wrap("null") });
  });
  const connect = await peer.connect();
  const received: unknown[] = [];
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    return yield* client["client.subscribe"]({ requestId: "invalid-exhausted", after: 10 }).pipe(
      Stream.tap((row) => Effect.sync(() => { received.push(row); })), Stream.runDrain, Effect.result, Effect.timeout(4_000));
  })));
  expect(result._tag).toBe("Failure");
  if (result._tag === "Failure") expect(result.failure).toBeInstanceOf(ClientError);
  expect(received).toEqual([]);
  expect(peer.requests.filter(({ frame }) => frame.tag === "client.subscribe").map(({ frame }) => frame.payload.after)).toEqual([10, 10, 10]);
});
