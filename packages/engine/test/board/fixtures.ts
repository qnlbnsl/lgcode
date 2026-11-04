import { existsSync } from "node:fs";

import type { Event, EventEnvelope } from "@shephrd/contracts";
import type { BoardView } from "@shephrd/contracts/board/view";
import { expect } from "vitest";

import { envelopes, event, owner, started } from "../support/viewFixtures.ts";

export { envelopes, event, owner };

// These are the unit's missing production seams, never substitute reducers.
export interface BoardModule {
  readonly emptyBoard: () => BoardView;
  readonly boardAfter: (state: BoardView, envelope: EventEnvelope) => BoardView;
}

export async function requiredModule<T>(path: string): Promise<T> {
  const url = new URL(`../../src/board/${path}.ts`, import.meta.url);
  expect(existsSync(url), `Unit 2a must implement board/${path}.ts; see .foundry/tests-result.md`).toBe(true);
  return await import(/* @vite-ignore */ url.href) as T;
}

export const agent = (agentId: string) => ({ _tag: "agent" as const, agentId });
export const start = (agentId: string, groups: ReadonlyArray<string> = [], parent = "lead") => event({
  ...started, agentId, groups, parent: agentId === "lead" ? owner : agent(parent), permission: "edit",
});
export const channel = (overrides: Record<string, unknown> = {}) => event({
  _tag: "board.ChannelOpened", channelId: "room", name: "Room", kind: "plain",
  opener: agent("lead"), manager: agent("lead"), members: [agent("lead"), agent("worker"), agent("other")],
  ...overrides,
});
export const post = (postId: string, overrides: Record<string, unknown> = {}) => event({
  _tag: "board.PostWritten", postId, channelId: "room", author: agent("lead"),
  text: `Text for ${postId}.`, to: [agent("worker")], reply: "all", ...overrides,
});
export const close = (postId: string, overrides: Record<string, unknown> = {}) => event({
  _tag: "board.PostClosed", postId, outcome: "answered", closer: agent("worker"), completionOwed: true,
  ...overrides,
});
export const resolve = (postId: string, disposition: string, overrides: Record<string, unknown> = {}) => event({
  _tag: "board.AddresseeResolved", postId, addressee: agent("worker"), disposition,
  authorIsOwner: false, ...overrides,
});
export const wake = (wakeId: string, overrides: Record<string, unknown> = {}) => event({
  _tag: "board.WakeBuilt", wakeId, targetAgentId: "worker", carried: [], mustReply: [],
  completions: [], completionReplyText: [], reminders: [], noAnswers: [], ...overrides,
});
export const queue = (wakeId: string, deliveryId = `delivery-${wakeId}`, target = "worker") => event({
  _tag: "DeliveryQueued", delivery: {
    id: deliveryId, target, sender: { _tag: "piece", namespace: "board" },
    content: { _tag: "prompt", text: "Board data." }, source: { _tag: "piece", namespace: "board", id: wakeId },
  },
});
export const accept = (wakeId: string, agentId = "worker") => event({
  _tag: "DeliveryAccepted", agentId, deliveryId: `delivery-${wakeId}`,
});
export const returned = (wakeId: string, agentId = "worker") => event({
  _tag: "DeliveryReturned", agentId, deliveryId: `delivery-${wakeId}`,
  sender: { _tag: "piece", namespace: "board" }, reason: "Test return.",
});
export const read = (postIds: ReadonlyArray<string>, reader = "worker", channelId = "room") => event({
  _tag: "board.Read", channelId, reader: agent(reader), postIds,
});
export const setup = [start("lead"), start("worker"), start("other"), channel()];

export const freeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

// Validate every fixture before checking for the missing seam. Replay every
// prefix independently, so every pure-fold scenario also checks rebuild parity.
export async function scenario(events: ReadonlyArray<Event>) {
  const rows = freeze(envelopes(events));
  const module = await requiredModule<BoardModule>("view");
  const history: BoardView[] = [module.emptyBoard()];
  let state = history[0]!;
  for (const [index, row] of rows.entries()) {
    const before = structuredClone(state);
    freeze(state);
    const next = module.boardAfter(state, row);
    expect(state, "boardAfter mutated a previously published snapshot").toEqual(before);
    expect(module.boardAfter(state, row), "boardAfter is nondeterministic").toEqual(next);
    const rebuilt = rows.slice(0, index + 1).reduce(module.boardAfter, module.emptyBoard());
    expect(next, `board fold differs from replay at sequence ${row.sequence}`).toEqual(rebuilt);
    state = next;
    history.push(state);
  }
  return { ...module, rows, history, state };
}

// Unit 2a's convention: readState[agent-or-owner][channel]. The contract
// leaves the nesting order unspecified; the builder can use this public type.
export const position = (state: BoardView, reader = "worker", channelId = "room") =>
  state.readState[reader]?.[channelId];
