import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { expect, it } from "vitest";

import { snapshot as clientSnapshot } from "../../src/api/snapshot.ts";
import { serve } from "../../src/api/server.ts";
import { withBoardEnabled, boardEnabledAtStartup } from "../../src/board/switch.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { Views } from "../../src/views/Views.ts";
import { withAlerts, quietLists } from "../support/alertsRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { call, freshRequest, makeRig, ownerCredential, removeRig, seedAccount, seedAgent, seedHarness, success } from "../support/handlerRig.ts";
import { eventually } from "../support/routingRig.ts";
import { connect } from "../support/socketClient.ts";
import { connected, freshSecret, login, rpc, withWeb } from "../support/webRig.ts";
import type { EngineLists as FixtureLists } from "../support/fixturePiece.ts";
import { boardState, change, owner } from "./wakeFixtures.ts";

const disabled = withBoardEnabled(engineLists, false);
const payloads = {
  "board.open": { name: "Room" },
  "board.members": { channelId: "room", add: [], remove: [] },
  "board.post": { channelId: "room", text: "Data", to: [], reply: "none" },
  "board.close": { postId: "post" },
  "board.acknowledge": { postId: "post" },
  "board.read": { channelId: "room" },
  "board.channels": {},
  "board.flush": { agentId: "worker" },
};

it("5.10 startup disables the board only for the explicit setting", () => {
  registerRebuildCheck({ noLog: true });
  expect(boardEnabledAtStartup({})).toBe(true);
  expect(boardEnabledAtStartup({ SHEPHRD_BOARD_DISABLED: "0" })).toBe(true);
  expect(boardEnabledAtStartup({ SHEPHRD_BOARD_DISABLED: "1" })).toBe(false);
});

it("5.10 every disabled board command returns its public reason on the socket and logged-in web transport", async () => withWeb((ctx) => Effect.gen(function* () {
  yield* seedHarness(); yield* seedAccount(); yield* seedAgent({ id: "worker", state: "paused" });
  const socketPath = join(ctx.rig.stateFolder, "disabled.sock");
  const bearer = freshSecret();
  yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: false, lists: disabled });
  const unix = yield* connect(socketPath, bearer);
  const web = yield* connected(ctx, (yield* login(ctx)).cookie);
  for (const [name, body] of Object.entries(payloads)) {
    const requestId = freshRequest();
    const result = yield* (unix as any)[name]({ requestId, ...body }).pipe(Effect.result);
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandError", requestId, reason: "board disabled" } });
    const browser = yield* rpc(web, name, { requestId: freshRequest(), ...body });
    expect(browser._tag).toBe("Failure");
    expect(JSON.stringify(browser)).toContain('"reason":"board disabled"');
  }
  const result = yield* unix["board.status"]({ requestId: freshRequest() });
  expect(result).toMatchObject({ disabled: true, holdsUnsettled: [], holdsIncoming: [], ownerHeld: [] });
  const section = ((yield* clientSnapshot(owner, disabled)) as any).board;
  expect(section).toMatchObject({ disabled: true, holdsUnsettled: [], holdsIncoming: [], ownerHeld: [] });
}), { lists: quietLists(disabled) as unknown as FixtureLists }));

it("5.10 disabled restarts rebuild board events, refuse old receipts, keep reach checks, and re-enable a whole-state reactor scan", async () => {
  const rig = makeRig();
  const requestId = "before-disable";
  let channelId: string;
  let postId: string;
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "worker", state: "paused" });
      channelId = success(yield* call(ownerCredential, "board.open", { requestId, name: "Room" })).channelId;
      success(yield* call(ownerCredential, "board.members", { channelId, add: ["worker"], remove: [] }));
      postId = success(yield* call(ownerCredential, "board.post", { channelId, text: "Reply needed", to: [{ _tag: "agent", agentId: "worker" }], reply: "all" })).postId;
    }), { rig, lists: { ...quietLists(engineLists), reactors: {} } });
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect((yield* boardState).posts[postId!]!.status).toBe("open");
      const replay = yield* call(ownerCredential, "board.open", { requestId, name: "Room" });
      expect(replay).toMatchObject({ _tag: "Failure", failure: { reason: "board disabled" } });
      yield* change({ _tag: "AgentStopped", agentId: "worker" });
      expect((yield* boardState).posts[postId!]!.status).toBe("open");
      const summary = success(yield* call(ownerCredential, "board.status", {}));
      expect(summary).toMatchObject({ disabled: true, holdsUnsettled: [], holdsIncoming: [], ownerHeld: [] });
      expect(disabled.reactors.board).toBeUndefined();
      expect(disabled.reach.board).toBe(engineLists.reach.board);
      expect(disabled.sourceRules.board).toBe(engineLists.sourceRules.board);
      const view = yield* (yield* Views).snapshot;
      expect(disabled.holdUnsettled.board(view, "worker", view.board)).toBe(false);
      expect(disabled.requestHeld.board(view, "worker", view.board)).toBe(false);
    }), { rig, lists: quietLists(disabled), initialize: false });
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const result = yield* eventually(boardState, (view) => view.posts[postId!]?.status === "closed");
      expect(result.posts[postId!]!.status).toBe("closed");
      expect(success(yield* call(ownerCredential, "board.open", { requestId, name: "Room" })).channelId).toBe(channelId!);
    }), { rig, lists: quietLists(engineLists), initialize: false });
  } finally { removeRig(rig); }
});
