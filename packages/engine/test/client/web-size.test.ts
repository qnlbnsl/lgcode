import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { fixtureLists, loadLists } from "../support/fixturePiece.ts";
import { freshRequest, seedHarness } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { requestFrame } from "../support/socketClient.ts";
import { connected, eventually, login, rpc, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

it("5.8 inbound bytes: catches a missing 1 MiB limit or applying the limit to characters instead of bytes", async () => withWeb((ctx) => Effect.gen(function* () {
  yield* seedHarness();
  const { cookie } = yield* login(ctx);
  const socket = yield* connected(ctx, cookie);
  expect((yield* rpc(socket, "harnesses", { requestId: freshRequest(), operation: "list" }))._tag).toBe("Success");
  const frame = requestFrame("oversized", "harnesses", { requestId: freshRequest(), operation: "list", padding: "é".repeat(530_000) });
  expect(frame.length < 1_048_576 && Buffer.byteLength(frame) > 1_048_576).toBe(true);
  socket.send(frame);
  yield* eventually(() => socket.readyState, (state) => state === 3, "an inbound message larger than 1 MiB was accepted");
})));

it("5.8 boundary: catches rejecting exactly 1 MiB or failing to count whitespace in the next message", async () => withWeb((ctx) => Effect.gen(function* () {
  yield* seedHarness();
  const { cookie } = yield* login(ctx); const socket = yield* connected(ctx, cookie);
  let answered = false;
  socket.on("message", (data) => {
    for (const line of String(data).split("\n").filter(Boolean)) {
      const frame = JSON.parse(line);
      if (frame._tag === "Exit" && frame.requestId === "boundary" && frame.exit._tag === "Success") answered = true;
    }
  });
  const frame = requestFrame("boundary", "harnesses", { requestId: freshRequest(), operation: "list" });
  socket.send(frame + " ".repeat(1_048_576 - Buffer.byteLength(frame)));
  yield* eventually(() => answered, Boolean, "exactly 1 MiB must still be accepted");
  const next = requestFrame("over", "harnesses", { requestId: freshRequest(), operation: "list" });
  socket.send(next + " ".repeat(1_048_577 - Buffer.byteLength(next)));
  yield* eventually(() => socket.readyState, (state) => state === 3, "1 MiB plus one byte must close");
})));

it("5.8 outbound: catches imposing the inbound transport limit on a valid large server reply", async () => {
  const base = fixtureLists(await loadLists());
  const large = "x".repeat(1_048_577);
  const lists = { ...base, reads: { ...base.reads, "client.record": (_input: unknown, payload: { requestId: string }) => Effect.succeed({
    reply: { requestId: payload.requestId, id: large, sequence: 0 },
  }) } };
  await withWeb((ctx) => Effect.gen(function* () {
    const { cookie } = yield* login(ctx); const socket = yield* connected(ctx, cookie);
    const exit = yield* rpc(socket, "client.record", { requestId: freshRequest(), id: "large-read", text: "Data." });
    expect(exit._tag).toBe("Success");
    expect(exit.value.id.length).toBe(1_048_577);
    expect(socket.readyState).toBe(1);
  }), { lists });
});
