import { expect, it } from "vitest";
import { event, envelopes } from "../fixtures.ts";
import { pieceViews } from "../../../src/pieces/viewTables.ts";
import { isStallWatchTurn } from "../../../src/roles/stall-watch/notices.ts";
import { read } from "../../board/fixtures.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it("N01 only an accepted wake or a read by the notice recipient marks a notice read", () => {
  const notice = event({ _tag: "roles.ReplaceAdvised", agentId: "worker", noticeRecipient: "lead", triggerSequence: 1, sourceSequence: 2, occurrence: 1, notice: "sent", postId: "post-1" });
  const readEvent = read(["post-1"], "lead");
  let unread = pieceViews.roles.reduce(pieceViews.roles.empty(), notice as any, 1) as any;
  expect(unread.actions[0].noticeRead).toBe(false);
  const seen = pieceViews.roles.reduce(unread, readEvent as any, 2) as any;
  expect(seen.actions[0].noticeRead).toBe(true);
});

it("N02 another agent reading the post leaves the recipient notice unread", () => {
  const notice = event({ _tag: "roles.ReplaceAdvised", agentId: "worker", noticeRecipient: "lead", triggerSequence: 1, sourceSequence: 2, occurrence: 1, notice: "sent", postId: "post-1" });
  const readEvent = read(["post-1"], "other");
  let state = pieceViews.roles.reduce(pieceViews.roles.empty(), notice as any, 1);
  state = pieceViews.roles.reduce(state, readEvent as any, 2) as any;
  expect((state as any).actions[0].noticeRead).toBe(false);
});

it("N03 a stall watch turn is distinguished from a wake carrying another author's work", async () => {
  expect(isStallWatchTurn({ posts: [{ author: { _tag: "service", service: "roles.stallWatch" } }], completions: [], reminders: [], noAnswers: [] })).toBe(true);
  expect(isStallWatchTurn({ posts: [{ author: { _tag: "service", service: "roles.stallWatch" } }, { author: { _tag: "agent", agentId: "worker" } }], completions: [], reminders: [], noAnswers: [] })).toBe(false);
  expect(isStallWatchTurn({ posts: [{ author: { _tag: "service", service: "roles.stallWatch" } }], completions: ["completion"], reminders: [], noAnswers: [] })).toBe(false);
  expect(isStallWatchTurn({ posts: [{ author: { _tag: "service", service: "roles.stallWatch" } }], completions: [], reminders: ["reminder"], noAnswers: [] })).toBe(false);
  expect(isStallWatchTurn({ posts: [{ author: { _tag: "service", service: "roles.stallWatch" } }], completions: [], reminders: [], noAnswers: ["no-answer"] })).toBe(false);
});
