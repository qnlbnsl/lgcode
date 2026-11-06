import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  agentCredential, call, failureOf, headSequence, logAfter, makeRig, ownerCredential, removeRig,
  seedAccount, seedAgent, seedHarness, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agent, boardState, change, eventsOf, provideBoard } from "./wakeFixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

for (const state of ["paused", "starting", "interrupted", "crashed", "stopped", "idle", "working"] as const) {
  it.live(`board.members uses the effective holder with a ${state} intermediate parent`, () => provideBoard(rig, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAccount(); yield* seedHarness();
    const root = agentCredential((yield* seedAgent({ id: "root", state: "idle" })).token);
    yield* seedAgent({ id: "middle", parent: "root", state });
    const child = agentCredential((yield* seedAgent({ id: "child", parent: "middle", state: "idle" })).token);
    const rootRoom = success(yield* call(root, "board.open", { name: "RootRoom" })).channelId;
    const childRoom = success(yield* call(child, "board.open", { name: "ChildRoom" })).channelId;
    const unavailable = state !== "idle" && state !== "working";
    const before = yield* headSequence;
    const added = yield* call(root, "board.members", { channelId: rootRoom, add: ["child"], remove: [] });
    const ownHolder = yield* call(child, "board.members", { channelId: childRoom, add: ["root"], remove: [] });
    if (unavailable) {
      expect(success(added).memberCount).toBe(2);
      expect(success(ownHolder).memberCount).toBe(2);
      expect(eventsOf(yield* logAfter(before), "board.ChannelMembersChanged")).toEqual([
        { _tag: "board.ChannelMembersChanged", channelId: rootRoom, membersAdded: [agent("child")], membersRemoved: [] },
        { _tag: "board.ChannelMembersChanged", channelId: childRoom, membersAdded: [agent("root")], membersRemoved: [] },
      ]);
    } else {
      expect(failureOf(added)?.reason).toBe("member cannot be added");
      expect(failureOf(ownHolder)?.reason).toBe("member cannot be added");
      expect(eventsOf(yield* logAfter(before), "board.ChannelMembersChanged")).toEqual([]);
    }
    expect((yield* boardState).channels[rootRoom]?.manager).toEqual(agent("root"));
    expect((yield* boardState).channels[childRoom]?.manager).toEqual(agent("child"));

    // Availability changes do not silently add or remove stored members.
    yield* change({ _tag: "StateChanged", agentId: "middle", state: { _tag: "idle" } });
    expect((yield* boardState).channels[rootRoom]?.members).toEqual(unavailable
      ? [agent("root"), agent("child")] : [agent("root")]);
    const deniedAt = yield* headSequence;
    expect(failureOf(yield* call(child, "board.members", { channelId: rootRoom, add: ["middle"], remove: [] }))?.reason)
      .toBe("channel cannot be managed");
    expect(eventsOf(yield* logAfter(deniedAt), "board.ChannelMembersChanged")).toEqual([]);
    success(yield* call(ownerCredential, "board.members", { channelId: rootRoom, add: ["child"], remove: [] }));
    expect((yield* boardState).channels[rootRoom]?.members).toEqual([agent("root"), agent("child")]);
  })).pipe(Effect.orDie));
}
