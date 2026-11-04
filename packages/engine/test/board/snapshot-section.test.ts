import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { snapshot as clientSnapshot } from "../../src/api/snapshot.ts";
import { makeRig, removeRig, type Rig } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agent, change, encodedBytes, owner, provideBoard, seedBoard } from "./wakeFixtures.ts";
import { post as postEvent } from "./fixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

const run = <A>(body: Effect.Effect<A, any, any>) => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck();
  yield* seedBoard();
  return yield* body;
})).pipe(Effect.orDie);

it.live("5.9 board snapshot is absent for agents and is bounded metadata for owners at its views sequence", () => run(Effect.gen(function* () {
  const posts = Array.from({ length: 1_000 }, (_, index) => postEvent(`snapshot-${index}`, {
    text: "\\\"界".repeat(4_000), to: [agent("worker")],
  }));
  yield* change(...posts);
  const worker = yield* clientSnapshot({ _tag: "agent", agentId: "worker" } as never);
  expect(worker).not.toHaveProperty("board");

  const result = (yield* clientSnapshot(owner)) as unknown as Record<string, any>;
  const board = result.board as Record<string, any>;
  expect(board).toBeDefined();
  expect(board.sequence).toBe(result.sequence);
  expect(board.holdsUnsettled).toContain("worker");
  expect(board.holdsIncoming).toContain("worker");
  expect(encodedBytes(board)).toBeLessThanOrEqual(256 * 1024);
  expect(JSON.stringify(board)).not.toContain("界");
  expect(board.truncated).toBe(true);

})));
