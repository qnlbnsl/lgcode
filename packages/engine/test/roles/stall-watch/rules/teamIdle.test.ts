import { expect, it } from "vitest";
import { evaluateTeamIdle } from "../../../../src/roles/stall-watch/rules/teamIdle.ts";
import { registerRebuildCheck } from "../../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const at = 1_900_000_000_000;
const agent = (agentId: string, parent: string, state: string, overrides: Record<string, unknown> = {}) => ({
  agentId,
  name: agentId,
  role: agentId === "top" ? "lead" : "worker",
  groups: ["build"],
  parent: { _tag: "agent", agentId: parent },
  account: "account",
  state: { _tag: state },
  capacityHeld: false,
  ...overrides,
});

const context = (agents: Record<string, unknown>, options: Record<string, unknown> = {}) => ({
  agents,
  now: at,
  eventTimes: { "group:build": at - 60 * 60_000 },
  roles: { snoozes: {}, settings: {} },
  ...options,
});

it("TI01 nudges each top agent once when the entire group has been idle for an hour", () => {
  const actions = evaluateTeamIdle(context({
    top: agent("top", "owner", "idle", { parent: { _tag: "owner" } }),
    worker: agent("worker", "top", "idle"),
  }) as any);

  expect(actions.map((action: any) => [action.agentId, action._tag])).toEqual([["top", "roles.TeamIdleReported"]]);
  expect(actions[0]).toMatchObject({ group: "build", noticeRecipient: "owner", occurrence: 1 });
});

it("TI02 does not report a group while any member is starting, working, or has a queued delivery", () => {
  for (const member of [
    agent("worker", "top", "starting"),
    agent("worker", "top", "working"),
    agent("worker", "top", "idle", { deliveries: [{ status: "queued", stallWatch: false }] }),
  ]) {
    const actions = evaluateTeamIdle(context({
      top: agent("top", "owner", "idle", { parent: { _tag: "owner" } }),
      worker: member,
    }) as any);
    expect(actions, "a busy member pauses the whole group's idle clock").toEqual([]);
  }
});

it("TI04 counts a usage-limit pause with a known reset as busy", () => {
  const actions = evaluateTeamIdle(context({
    top: agent("top", "owner", "idle", { parent: { _tag: "owner" } }),
    worker: agent("worker", "top", "paused", { pause: { reason: "limit", resetAt: at + 30_000 } }),
  }) as any);

  expect(actions).toEqual([]);
});

it("TI10 restarts the hour after an owner-held unknown usage limit becomes available", () => {
  const actions = evaluateTeamIdle(context({
    top: agent("top", "owner", "idle", { parent: { _tag: "owner" } }),
    worker: agent("worker", "top", "idle"),
  }, { eventTimes: { "group:build": at - 1 }, accountRecoveredAt: at - 1 }) as any);

  expect(actions).toEqual([]);
});

it("TI12 keeps a snoozed group quiet after its idle deadline", () => {
  const actions = evaluateTeamIdle(context({
    top: agent("top", "owner", "idle", { parent: { _tag: "owner" } }),
  }, { roles: { snoozes: { build: at + 60_000 }, settings: {} } }) as any);

  expect(actions).toEqual([]);
});
