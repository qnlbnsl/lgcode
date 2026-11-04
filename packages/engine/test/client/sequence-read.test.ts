import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { expect, it, vi } from "vitest";
import { Views } from "../../src/views/Views.ts";
import { agentCredential, seedAgent, headSequence, appendSetup } from "../support/handlerRig.ts";
import { run as runReadRig, read, readOutcome, event } from "./support/readRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

it("3.10 client.sequence returns only the views value's own sequence and request id", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a" });
  const views = yield* Views;
  const value = yield* views.snapshot;
  const reply = yield* read("client.sequence", { requestId: "small-read" });
  expect(reply).toEqual({ requestId: "small-read", sequence: value.sequence });
})));
it("3.10 client.sequence stays at the published batch while the durable head is ahead of views", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a" });
  const views = yield* Views; const before = (yield* views.snapshot).sequence;
  const entered = yield* Deferred.make<void>(); const release = yield* Deferred.make<void>();
  const apply = views.applyCommitted;
  const spy = vi.spyOn(views, "applyCommitted").mockImplementation((batch) => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(apply(batch))));
  yield* Effect.gen(function* () {
    const writer = yield* appendSetup([event({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" })]).pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    expect((yield* read("client.sequence").pipe(Effect.timeout(2_000))).sequence).toBe(before);
    yield* Deferred.succeed(release, undefined); yield* Fiber.join(writer);
    expect((yield* read("client.sequence")).sequence).toBe(before + 1);
  }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.ensuring(Effect.sync(() => spy.mockRestore())));
})));
it("3.10 an agent cannot use client.sequence and a refusal writes no event", async () => run(Effect.gen(function* () {
  const a = yield* seedAgent({ id: "agent-a" });
  const before = yield* headSequence;
  expect((yield* readOutcome("client.sequence", { requestId: "agent-sequence" }, agentCredential(a.token)))._tag).toBe("Failure");
  expect(yield* headSequence).toBe(before);
})));
