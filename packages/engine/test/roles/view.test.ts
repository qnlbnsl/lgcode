import type { Event } from "@shephrd/contracts";
import { expect, it } from "vitest";
import { pieceViews } from "../../src/pieces/viewTables.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { action, envelopes, event, fileEvent, fold, freeze, roles, start } from "./fixtures.ts";
import { channel, post, wake, queue, accept, read } from "../board/fixtures.ts";

registerRebuildCheck({ noLog: true });

it("V01 the registered roles fold keeps the loaded file, settings and latest snooze together without losing actions", () => {
  const state = roles(fold([
    start(), fileEvent(), action("StallSeen"),
    event({ _tag: "roles.SettingsChanged", settings: { sheepdog: false, limits: { stallMinutes: 20 } } }),
    event({ _tag: "roles.Snoozed", group: "build", until: 1_900_000_000_000 }),
    event({ _tag: "roles.Snoozed", group: "build", until: 1_900_000_060_000 }),
  ]));
  expect(state).toMatchObject({
    file: { name: "Build team" }, settings: { sheepdog: false, limits: { stallMinutes: 20 } },
    snoozes: { build: 1_900_000_060_000 },
    actions: [expect.objectContaining({ _tag: "roles.StallSeen", sequence: 3, occurrence: 1 })],
  });
  expect(state.roleFileHash).toMatch(/^[a-f0-9]{64}$/);
});

it("V02 the sheepdog position is the highest source or baseline, never the record, trigger or settings sequence", () => {
  const state = roles(fold([
    event({ _tag: "roles.SheepdogBaseline", position: 30, on: true }),
    action("StallSeen", { sourceSequence: 40, triggerSequence: 400 }),
    action("CacheFlushed", { sourceSequence: 35 }),
    event({ _tag: "roles.SettingsChanged", settings: { sheepdog: true } }),
    event({ _tag: "roles.SheepdogBaseline", position: 38, on: false }),
  ]));
  expect(state.position).toBe(40);
});

it("V03 lifecycle clock origins and the highest permission survive a narrowing and use event sequences", () => {
  const state = roles(fold([
    start(), event({ _tag: "SessionOpened", agentId: "worker", session: { _tag: "acp", sessionId: "session" }, protocolVersion: 2, reloadable: true }),
    event({ _tag: "ModeChanged", agentId: "worker", mode: "edit", level: "edit" }),
    event({ _tag: "ModeChanged", agentId: "worker", mode: "plan", level: "read-only" }),
    event({ _tag: "DeliveryQueued", delivery: { id: "delivery", target: "worker", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Build the view." } } }),
    event({ _tag: "DeliverySent", agentId: "worker", deliveryId: "delivery", method: "acp" }),
    event({ _tag: "TurnStarted", agentId: "worker" }),
    event({ _tag: "TurnEnded", agentId: "worker", compact: false }),
    event({ _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "A test crash." }),
  ]));
  expect(state.agents.worker).toMatchObject({ highestPermission: "edit", startedSequence: 1, turnStartSequence: 6, turnEndSequence: 8, crashSequence: 9 });
  expect(JSON.stringify(state)).not.toContain("180000000000");
});

it("V04 action occurrences retain counters without counting a redirected notice as another retry", () => {
  const state = roles(fold([
    start(), action("StallSeen"), action("StallSeen", { occurrence: 2 }),
    action("StallSeen", { occurrence: 2, noticeRecipient: "lead", postId: "redirected" }),
    action("CapacityRetried", { occurrence: 1 }), action("CapacityRetried", { occurrence: 2 }),
    action("CrashAdmitted", { triggerSequence: 8 }), action("CrashRetried", { triggerSequence: 8 }),
  ]));
  expect(state.agents.worker).toMatchObject({ stallCount: 2, capacityRetries: 2, crashRetries: 1 });
  expect(state.actions).toHaveLength(7);
});

it.each(["CrashRetried", "GaveUp", "stop", "off"])("V05 an admitted retry remains open across resume and closes on %s", (end) => {
  const before: Event[] = [start(), action("CrashAdmitted", { triggerSequence: 90 }),
    event({ _tag: "StateChanged", agentId: "worker", state: { _tag: "starting" } })];
  expect(roles(fold(before)).agents.worker?.openCrash).toMatchObject({ _tag: "roles.CrashAdmitted", triggerSequence: 90, sequence: 2 });
  const closing = end === "stop" ? event({ _tag: "AgentStopped", agentId: "worker" })
    : end === "off" ? event({ _tag: "roles.SheepdogBaseline", position: 100, on: false })
    : action(end, { triggerSequence: 90 });
  expect(roles(fold([...before, closing])).agents.worker?.openCrash).toBeUndefined();
});

it("V06 closing one crash admission cannot erase a newer admission for the same agent", () => {
  const state = roles(fold([start(), action("CrashAdmitted", { triggerSequence: 10 }),
    action("CrashAdmitted", { triggerSequence: 20 }), action("CrashRetried", { triggerSequence: 10 })]));
  expect(state.agents.worker?.openCrash).toMatchObject({ triggerSequence: 20 });
});

it.each([
  ["StallSeen", {}, "roles.stall", "stall:worker"],
  ["TeamIdleReported", {}, "roles.stall", "stall:worker"],
  ["ReplaceAdvised", {}, "roles.replace", "replace:worker"],
  ["RunawayReported", {}, "roles.runaway", "runaway:worker"],
  ["GaveUp", { notice: "board-off", postId: undefined, noticeRecipient: "lead" }, "roles.stall", "stall:worker"],
] as const)("V07 %s retains its owner alert matter for a first-start scan", (kind, fields, matterKind, key) => {
  const state = roles(fold([start(), action(kind, fields)]));
  expect(state.agents.worker?.matters).toEqual([{ key, kind: matterKind, agentId: "worker" }]);
});

it.each([
  ["StallSeen", { noticeRecipient: "lead" }], ["ReplaceAdvised", { noticeRecipient: "lead" }],
  ["RunawayReported", { noticeRecipient: "lead" }], ["GaveUp", { engineAlertOpen: true }],
  ["GaveUp", { noticeRecipient: "lead" }], ["RoleAdviceBroken", {}], ["CrashAdmitted", {}],
] as const)("V08 %s %j cannot invent an owner matter", (kind, fields) => {
  expect(roles(fold([start(), action(kind, fields)])).agents.worker?.matters).toEqual([]);
});

it.each([
  ["StallSeen", "roles.StallEnded"], ["StallSeen", "AgentStopped"],
  ["ReplaceAdvised", "AgentStopped"], ["RunawayReported", "TurnEnded"], ["RunawayReported", "AgentStopped"],
] as const)("V09 %s ends its matter on %s and preserves another agent's matters", (kind, closing) => {
  const end = closing === "roles.StallEnded" ? action("StallEnded")
    : event({ _tag: closing, agentId: "worker", ...(closing === "TurnEnded" ? { compact: false } : {}) });
  const state = roles(fold([start(), start("other"), action(kind), action(kind, { agentId: "other" }), end]));
  expect(state.agents.worker?.matters).toEqual([]);
  expect(state.agents.other?.matters).toHaveLength(1);
});

it("V10 a turn end clears runaway but preserves a replacement and a stall until their own ends", () => {
  const state = roles(fold([start(), action("StallSeen"), action("ReplaceAdvised"), action("RunawayReported"),
    event({ _tag: "TurnEnded", agentId: "worker", compact: false })]));
  expect(state.agents.worker?.matters.map((matter) => matter.kind).sort()).toEqual(["roles.replace", "roles.stall"]);
});

it("V11 replay and projection read only the event and sequence, with frozen inputs and no envelope time", () => {
  const events = [start(), fileEvent(), event({ _tag: "roles.SheepdogBaseline", position: 1, on: true }),
    action("StallSeen"), action("CrashAdmitted"), action("RunawayReported"),
    event({ _tag: "TurnEnded", agentId: "worker", compact: false })];
  let projected = pieceViews.roles.empty();
  for (const row of envelopes(events)) projected = pieceViews.roles.reduce(freeze(projected), freeze(row.event) as unknown as Readonly<Record<string, unknown>>, row.sequence);
  const live = roles(fold(events));
  expect(live.actions).toHaveLength(3);
  expect(projected).toEqual(live);
  const changedTimes = envelopes(events).map((row) => ({ ...row, occurredAt: row.occurredAt + 900_000 }));
  let replayed = pieceViews.roles.empty();
  for (const row of changedTimes) replayed = pieceViews.roles.reduce(replayed, row.event as unknown as Readonly<Record<string, unknown>>, row.sequence);
  expect(replayed).toEqual(live);
});

it.each(["__proto__", "constructor", "toString"])("V12 the valid agent and group id %s stays a data key", (id) => {
  const state = roles(fold([start(id), action("StallSeen", { agentId: id }),
    event({ _tag: "roles.Snoozed", group: id, until: 1_900_000_000_000 })]));
  expect(Object.hasOwn(state.agents, id)).toBe(true);
  expect(state.agents[id]?.matters).toEqual([{ kind: "roles.stall", key: `stall:${id}`, agentId: id }]);
  expect(Object.hasOwn(state.snoozes, id)).toBe(true);
  expect(state.snoozes[id]).toBe(1_900_000_000_000);
});

it.each(["read", "accepted"])("V13 a notice becomes read only through its recipient's %s, and the fact survives replay", (path) => {
  const setup = [start(), start("lead"), start("other"), channel(),
    post("notice", { author: { _tag: "service", service: "roles.sheepdog" }, to: [{ _tag: "agent", agentId: "lead" }], reply: "none" }),
    action("ReplaceAdvised", { noticeRecipient: "lead", postId: "notice" })];
  expect(roles(fold(setup)).actions[0]?.noticeRead).toBe(false);
  const ending = path === "read" ? [read(["notice"], "lead")]
    : [wake("notice-wake", { targetAgentId: "lead", carried: ["notice"] }), queue("notice-wake", "delivery-notice-wake", "lead"), accept("notice-wake", "lead")];
  expect(roles(fold([...setup, ...ending])).actions[0]?.noticeRead).toBe(true);
});

it("V14 another reader, another post and an unaccepted wake cannot settle an unread notice", () => {
  const state = roles(fold([start(), start("lead"), start("other"), channel(),
    post("notice", { author: { _tag: "service", service: "roles.sheepdog" }, to: [{ _tag: "agent", agentId: "lead" }], reply: "none" }),
    action("ReplaceAdvised", { noticeRecipient: "lead", postId: "notice" }),
    read(["notice"], "other"), read(["different-post"], "lead"),
    wake("notice-wake", { targetAgentId: "lead", carried: ["notice"] }), queue("notice-wake", "delivery-notice-wake", "lead"),
  ]));
  expect(state.actions[0]?.noticeRead).toBe(false);
});
