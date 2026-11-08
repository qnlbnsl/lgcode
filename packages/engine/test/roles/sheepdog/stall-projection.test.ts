import { expect, it } from "vitest";
import type { Event } from "@lgcode/contracts";
import { apply, emptyViews, type State } from "../../../src/views/apply.ts";
import type { RolesView } from "../../../src/roles/view.ts";
import { stallInput, stallKey } from "../../../src/roles/sheepdog/stallView.ts";
import { evaluateStall, waitingOnOthers } from "../../../src/roles/sheepdog/rules/stall.ts";
import { event, envelopes, start } from "../fixtures.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
const agent = (agentId: string) => ({ _tag: "agent", agentId });
const setup = [
  start("lead", { role: "lead" }), start("worker", { parent: agent("lead") }), start("sibling", { parent: agent("lead") }),
  ...["lead", "worker", "sibling"].map((agentId) => event({ _tag: "StateChanged", agentId, state: { _tag: "idle" } })),
  event({ _tag: "roles.SheepdogBaseline", position: 0, on: true, boardOn: true }),
  event({ _tag: "board.ChannelOpened", channelId: "room", name: "room", kind: "plain", opener: { _tag: "owner" }, manager: { _tag: "owner" },
    members: [agent("lead"), agent("worker"), agent("sibling")] }),
];
const post = (postId = "work", author = "lead", target = "worker") => event({ _tag: "board.PostWritten", postId, channelId: "room",
  author: agent(author), to: [agent(target)], reply: "all", text: "Work on the assigned task." });
const journey = (extra: ReadonlyArray<Event> = []) => [...setup, post(), ...extra];
const fold = (events: ReadonlyArray<Event>, placeholder = false): State => envelopes(events).reduce((state, row) => apply(state,
  placeholder ? { ...row, occurredAt: 0 } : row), emptyViews());
const clock = (state: State, postId = "work", agentId = "worker") => (state.roles as RolesView).stalls[stallKey(postId, agentId)]!;
const seen = (occurrence: number, stalledPostId = "work", recipient = "worker") => event({ _tag: "roles.StallSeen", agentId: "worker",
  stalledPostId, noticeRecipient: recipient, triggerSequence: 9, sourceSequence: 9, occurrence, notice: "board-off" });

it("projects independent post counters and durable clock origins without envelope time", () => {
  const events = journey([post("other"), seen(1), seen(2), seen(2, "work", "lead")]);
  const live = fold(events);
  expect(clock(live).occurrence).toBe(2);
  expect(clock(live).originSequence).toBe(events.length - 1);
  expect(clock(live, "other").occurrence).toBe(0);
  expect(fold(events, true).roles).toEqual(live.roles);
  const input = stallInput(live);
  expect(evaluateStall({ ...input, episode: { post: input.status.posts!.find((row) => row.postId === "work")!,
    addressee: "worker", elapsed: 600_000, occurrence: clock(live).occurrence } })).toMatchObject([
    { _tag: "roles.ReplaceAdvised", stalledPostId: "work", occurrence: 3, noticeRecipient: "lead" },
  ]);
});

it("resets clocks after busy time, an empty capacity hold, account recovery, and every ended turn", () => {
  const busy = event({ _tag: "StateChanged", agentId: "worker", state: { _tag: "working" } });
  const idle = event({ _tag: "TurnEnded", agentId: "worker", compact: false });
  expect(clock(fold(journey([busy]))).originSequence).toBeUndefined();
  const events = journey([busy, idle]);
  expect(clock(fold(events)).originSequence).toBe(events.length);
  const held = [...events, event({ _tag: "DeliveryHeld", agentId: "worker", deliveryId: "missing", reason: "capacity" })];
  expect(clock(fold(held)).originSequence).toBeUndefined();
  const released = [...held, event({ _tag: "DeliveryReleased", agentId: "worker", deliveryId: "missing" })];
  expect(clock(fold(released)).originSequence).toBe(released.length);
  const paused = journey([event({ _tag: "StateChanged", agentId: "worker", state: { _tag: "paused", reason: "limit", midTurn: false } })]);
  expect(clock(fold(paused)).originSequence).toBeUndefined();
  const recovered = [...paused, event({ _tag: "StateChanged", agentId: "worker", state: { _tag: "idle" } })];
  expect(clock(fold(recovered)).originSequence).toBe(recovered.length);
});

it("preserves counters through board and sheepdog switches but restarts their clocks", () => {
  const events = journey([seen(2), event({ _tag: "roles.SheepdogBaseline", position: 10, on: true, boardOn: false })]);
  expect(clock(fold(events))).toMatchObject({ occurrence: 2 });
  expect(clock(fold(events)).originSequence).toBeUndefined();
  const on = [...events, event({ _tag: "roles.SheepdogBaseline", position: 11, on: true, boardOn: true })];
  expect(clock(fold(on))).toMatchObject({ occurrence: 2, originSequence: on.length });
  const off = [...on, event({ _tag: "roles.SheepdogBaseline", position: 12, on: false })];
  expect(clock(fold(off)).originSequence).toBeUndefined();
  const back = [...off, event({ _tag: "roles.SheepdogBaseline", position: 13, on: true })];
  expect(clock(fold(back))).toMatchObject({ occurrence: 2, originSequence: back.length });
});

it("resets for file changes and ordinary posts but preserves counts for acknowledgements and sheepdog posts", () => {
  const events = journey([seen(2)]);
  const acknowledge = event({ _tag: "board.PostAcknowledged", postId: "work", addressee: agent("worker") });
  expect(clock(fold([...events, acknowledge])).occurrence).toBe(2);
  const changed = [...events, event({ _tag: "ThreadItem", agentId: "worker", itemId: "file", replay: false,
    content: { _tag: "file-change", path: "src/work.ts", diff: "data" } })];
  expect(clock(fold(changed))).toMatchObject({ occurrence: 0, originSequence: changed.length });
  expect(clock(fold([...events, post("progress", "worker", "lead")])).occurrence).toBe(0);
  const nudge = [
    event({ _tag: "DeliveryQueued", delivery: { id: "nudge", target: "worker", sender: { _tag: "service", service: "roles.sheepdog" }, content: { _tag: "prompt", text: "Continue." } } }),
    event({ _tag: "DeliverySent", agentId: "worker", deliveryId: "nudge", method: "acp" }),
    event({ _tag: "DeliveryAccepted", agentId: "worker", deliveryId: "nudge" }),
  ];
  expect(clock(fold([...events, ...nudge, post("nudge-post", "worker", "lead")])).occurrence).toBe(2);
  expect(clock(fold([...events, ...nudge, event({ _tag: "TurnEnded", agentId: "worker", compact: false }),
    post("outside-turn", "worker", "lead")])).occurrence).toBe(0);
});

it("uses the real engine wait graph, ignores stopped askers, and gates on a matching board sequence", () => {
  const events = journey([
    event({ _tag: "QuestionAsked", agentId: "sibling", questionId: "q", holder: { _tag: "owner" }, deliveryId: "question", text: "Which task?" }),
    post("lead-work", "owner", "lead"),
  ]);
  const state = fold(events);
  expect(waitingOnOthers(stallInput(state), "lead")).toBe(true);
  const stopped = fold([...events, event({ _tag: "AgentStopped", agentId: "sibling", reason: "owner stopped" })]);
  expect(waitingOnOthers(stallInput(stopped), "lead")).toBe(false);
  const input = stallInput(stopped);
  expect(evaluateStall({ ...input, status: { ...input.status, sequence: stopped.sequence - 1 }, episode: {
    post: input.status.posts![0]!, addressee: "worker", elapsed: 600_000,
  } })).toEqual([]);
});


it("an idle request holder stops upstream clocks transitively, until the asker stops", () => {
  const events = journey([
    event({ _tag: "QuestionAsked", agentId: "worker", questionId: "q", holder: agent("sibling"), deliveryId: "question", text: "Which task?" }),
    post("lead-work", "owner", "lead"),
  ]);
  expect(waitingOnOthers(stallInput(fold(events)), "lead")).toBe(true);
  const stopped = fold([...events, event({ _tag: "AgentStopped", agentId: "worker" })]);
  expect(waitingOnOthers(stallInput(stopped), "lead")).toBe(false);
});
