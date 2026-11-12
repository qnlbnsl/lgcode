import { CommandsRpcGroup } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { WebSocket } from "ws";
import { ancestryHeaders, requestFrame, socketUrl } from "../support/socketClient.ts";
import { appendSetup, headSequence, seedAgent } from "../support/handlerRig.ts";
import { run as runReadRig, endpoint, textItem } from "./support/readRig.ts";
import { until } from "../../../testing/test/support/unit7b.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

it("3.9 live chunks close at 256 KiB of actual encoded RPC frames and deliver every escaped item once", async () => run(Effect.gen(function* () {
  expect(CommandsRpcGroup.requests.has("client.subscribe" as never), "install the real filtered stream before measuring frames").toBe(true);
  yield* seedAgent({ id: "agent-a" }); const after = yield* headSequence;
  const address = yield* endpoint;
  const socket = yield* Effect.acquireRelease(Effect.promise(() => new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(socketUrl(address.socket), { headers: { Authorization: `Bearer ${address.bearer}`, ...ancestryHeaders() } });
    socket.once("error", reject); socket.once("open", () => resolve(socket));
  })), (socket) => Effect.sync(() => socket.terminate()));
  const frames: Array<{ encoded: number; values: any[] }> = [];
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    for (const frame of Array.isArray(message) ? message : [message]) {
      if (frame._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
      if (frame._tag === "Chunk") {
        frames.push({ encoded: Buffer.byteLength(JSON.stringify(frame)), values: frame.values });
        socket.send(JSON.stringify({ _tag: "Ack", requestId: frame.requestId }));
      }
    }
  });
  socket.send(requestFrame("chunk-fixture", "client.subscribe", { requestId: "chunk-fixture", after }));
  // Receiving this marker proves the subscription is running before the batch.
  yield* appendSetup([textItem("ready", "Ready.")]);
  yield* Effect.promise(() => until("live stream ready", () => frames.flatMap((frame) => frame.values).some((row) => row.event?.itemId === "ready")));
  yield* appendSetup(Array.from({ length: 12 }, (_, i) => textItem(`bounded-${i}`, "界\\\"\n".repeat(9_000))));
  yield* Effect.promise(() => until("all encoded chunks", () => frames.flatMap((frame) => frame.values).filter((row) => row.event?.itemId?.startsWith("bounded-")).length === 12));
  for (const frame of frames) {
    expect(frame.values.length).toBeGreaterThan(0);
    expect(frame.encoded).toBeLessThanOrEqual(256 * 1024);
  }
  expect(frames.flatMap((frame) => frame.values).filter((row) => row.event?.itemId?.startsWith("bounded-")).map((row) => row.event.itemId)).toEqual(Array.from({ length: 12 }, (_, i) => `bounded-${i}`));
})));
