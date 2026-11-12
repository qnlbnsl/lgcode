import { boardAlertSources } from "@lgtm/contracts/board/alerts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { guardPiece } from "../../src/pieces/guardPiece.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { makeRig, removeRig, type Rig } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agent, change, owner, provideBoard, seedBoard, snapshot } from "./wakeFixtures.ts";
import { post as postEvent } from "./fixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

it.live("5.15 board openMatters scans the full rebuilt view and matches post alert identities", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck();
  yield* seedBoard();
  const openId = "open-owner-post";
  const noAnswerId = "no-answer-post";
  const open = postEvent(openId, { author: agent("lead"), to: [owner], reply: "all" });
  const noAnswer = postEvent(noAnswerId, { author: owner, to: [agent("worker")], reply: "all" });
  const noOwner = postEvent("no-owner-post", { author: agent("lead"), to: [agent("worker")], reply: "all" });
  const closed = postEvent("closed-owner-post", { author: agent("lead"), to: [owner], reply: "all" });
  yield* change(open, noAnswer, noOwner, closed,
    { _tag: "board.AddresseeResolved", postId: noAnswerId, addressee: agent("worker"), disposition: "no-answer", authorIsOwner: true },
    { _tag: "board.PostClosed", postId: "closed-owner-post", outcome: "answered", closer: owner, completionOwed: false });
  const view = yield* snapshot;
  const scan = engineLists.openMatters?.board;
  expect(scan, "WS-5 must install the board openMatters scanner").toBeTypeOf("function");
  const matters = guardPiece("openMatters", "board", () => scan!(view), []);
  const alert = boardAlertSources[0]!({ sequence: view.sequence, event: { _tag: "board.PostWritten", postId: openId, channelId: "room", author: agent("lead"), text: "Owner review", to: [owner], reply: "all" } } as never);
  expect(alert).toMatchObject({ _tag: "raise", key: "post:open-owner-post", kind: "board.post", agentId: "lead", subject: "open-owner-post" });
  expect(matters).toContainEqual({ key: "post:open-owner-post", kind: "board.post", agentId: "lead", subject: "open-owner-post" });
  const noAnswerAlert = boardAlertSources[1]!({ sequence: view.sequence, event: { _tag: "board.AddresseeResolved", postId: noAnswerId, addressee: agent("worker"), disposition: "no-answer", authorIsOwner: true } } as never);
  expect(noAnswerAlert).toMatchObject({ _tag: "raise", key: "no-answer:no-answer-post", kind: "board.no-answer", agentId: "worker", subject: "no-answer-post" });
  expect(matters).toContainEqual({ key: "no-answer:no-answer-post", kind: "board.no-answer", agentId: "worker", subject: "no-answer-post" });
  expect(matters.map((row) => row.key)).not.toContain("post:no-owner-post");
  expect(matters.map((row) => row.key)).not.toContain("post:closed-owner-post");
})).pipe(Effect.orDie));
