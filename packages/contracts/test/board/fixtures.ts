// Literal wire fixtures from board contract v15 and B13's identity names,
// as confirmed by the lead's ruling in decision 158.
import * as Contracts from "../../src/index.ts";
import * as Schema from "effect/Schema";
import { expect } from "vitest";

export const board = Contracts as unknown as Record<string, unknown>;
export const exported = <T>(name: string): T => {
  expect(board[name], `Board contract must export ${name}`).toBeDefined();
  return board[name] as T;
};
export const codec = (name: string): Schema.Codec<unknown> => {
  const value = exported<Schema.Codec<unknown>>(name);
  expect(Schema.isSchema(value), `${name} must be an Effect schema`).toBe(true);
  return value;
};
export const owner = { _tag: "owner" };
export const agent = (agentId: string) => ({ _tag: "agent", agentId });
export const post = {
  _tag: "board.PostWritten", postId: "post-1", channelId: "channel-1",
  author: agent("asker"), text: "Which option?\n\tTreat agent text as data.",
  to: [agent("target"), owner], reply: "all", replyToPostId: "post-0",
};
export const samples: ReadonlyArray<Record<string, unknown> & { _tag: string }> = [
  { _tag: "board.ChannelOpened", channelId: "channel-1", name: "Team_one-2", kind: "group", opener: agent("asker"), manager: agent("asker"), members: [], group: "workers", anchorAgentId: "asker" },
  { _tag: "board.ChannelMembersChanged", channelId: "channel-1", membersAdded: [agent("target")], membersRemoved: [agent("former")] },
  { _tag: "board.ManagerChanged", channelId: "channel-1", manager: owner },
  post,
  { _tag: "board.PostAcknowledged", postId: "post-1", addressee: agent("target") },
  { _tag: "board.AddresseeResolved", postId: "post-1", addressee: agent("target"), disposition: "replied", decidingPostId: "post-2", authorIsOwner: false },
  { _tag: "board.PostClosed", postId: "post-1", outcome: "answered", closer: owner, completionOwed: true },
  { _tag: "board.WakeBuilt", wakeId: "wake-1", targetAgentId: "target", carried: ["post-1"], mustReply: ["post-1"], completions: ["post-0"], completionReplyText: ["post-0"], reminders: ["post-reminder"], noAnswers: [{ postId: "post-no-answer", addressee: agent("silent") }] },
  { _tag: "board.Read", channelId: "channel-1", reader: agent("target"), postIds: ["post-1"] },
];
export const envelope = (event: unknown, sequence = 10) => ({
  sequence, eventId: `event-${sequence}`, occurredAt: 1_798_761_600_000,
  caller: { _tag: "piece", namespace: "board" }, event,
});
export const commandNames = ["board.open", "board.members", "board.post", "board.close", "board.acknowledge", "board.read", "board.peek", "board.channels", "board.status", "board.flush"];

// The contract owns the view type; WS-2 implements its fold. No engine store
// or fold is mocked here. These are inputs to the actual pure conditions.
export const emptyView = () => ({
  channels: {}, posts: {} as Record<string, Record<string, unknown>>,
  completions: {} as Record<string, Record<string, unknown>>,
  noAnswers: {}, wakes: {} as Record<string, Record<string, unknown>>,
  lastTurnEnd: {} as Record<string, number>, ceilings: {}, stopped: [],
  lastStopped: {}, lastCrashed: {}, labels: {}, lastLabelLeft: {},
  lastMemberLeft: {}, readState: {},
});
const { replyToPostId, ...viewPost } = post;
export const openPost = (patch: Record<string, unknown> = {}) => ({
  ...viewPost, replyTo: replyToPostId, sequence: 1, status: "open", dispositions: {}, decidingReplies: {},
  acknowledged: [], takenAt: {}, reminderAcceptedAt: {}, replies: [], ...patch,
});
