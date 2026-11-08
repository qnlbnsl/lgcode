import { RolesActionRecord } from "@lgcode/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { evaluateCrash } from "../../../../src/roles/sheepdog/rules/crash.ts";
import { evaluateRunaway } from "../../../../src/roles/sheepdog/rules/runaway.ts";
import { evaluateTeamIdle } from "../../../../src/roles/sheepdog/rules/teamIdle.ts";
import type { RuleAgent, RuleInput } from "../../../../src/roles/sheepdog/rules/context.ts";
import { ageLimitFor, limitsFor } from "../../../../src/roles/sheepdog/rules/context.ts";
import { agentIdOf } from "../../../support/handlerRig.ts";
import { registerRebuildCheck } from "../../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
const hour = 60 * 60_000;
const now = 10 * hour;
const agent = (overrides: Partial<RuleAgent> = {}): RuleAgent => ({
  agentId: agentIdOf("worker"), role: "worker", parent: { _tag: "owner" }, state: { _tag: "idle" }, groups: ["build"], ...overrides,
});
const input = (overrides: Partial<RuleInput> = {}): RuleInput => ({
  now, agents: { worker: agent() }, roles: {}, eventTimes: { "group:build": now - hour }, ...overrides,
});
const record = Schema.decodeUnknownSync(RolesActionRecord);

it.each(["chef:builder", ":builder", "worker:builder"])("named limits apply only to a known kind: %s", (role) => {
  const worker = agent({ role, startedSequence: 1 });
  const context = input({ agents: { worker }, eventTimes: { "1": now - 90 * 60_000 }, roles: {
    settings: { limits: { stallMinutes: 15, ageMinutes: 180 } },
    file: { name: "Team", roles: { builder: { advice: "Build carefully.", limits: { capacityRetries: 0, stallMinutes: 25, ageMinutes: 60 } } } },
  } });
  const known = role === "worker:builder";
  expect(limitsFor(context, worker).capacityRetries).toBe(known ? 0 : 12);
  expect(limitsFor(context, worker).stallMinutes).toBe(known ? 25 : 15);
  expect(ageLimitFor(context, worker)).toBe(known ? 60 : 180);
  expect(evaluateRunaway(context)).toHaveLength(known ? 1 : 0);
});

it.each(["stopped", "crashed", "paused"])("a group containing only %s agents receives no idle nudge", (state) => {
  expect(evaluateTeamIdle(input({ agents: { worker: agent({ state: { _tag: state } }) } }))).toEqual([]);
});

it("an empty capacity hold is busy, and a queued sheepdog wake alone is idle", () => {
  expect(evaluateTeamIdle(input({ agents: { worker: agent({ capacityHeld: true }) } }))).toEqual([]);
  expect(evaluateTeamIdle(input({ agents: { worker: agent({ deliveries: [{ status: "queued", sheepdog: true }] }) } }))).toHaveLength(1);
});

it("a rerouted notice preserves the original report time for the next hourly nudge", () => {
  const first = record({ _tag: "roles.TeamIdleReported", agentId: "worker", group: "build", noticeRecipient: "owner", notice: "sent",
    triggerSequence: 1, sourceSequence: 1, sequence: 2, occurrence: 1 });
  const rerouted = record({ ...first, sequence: 3 });
  const actions = evaluateTeamIdle(input({ roles: { actions: [first, rerouted] }, groupOrigins: { build: 1 },
    eventTimes: { "1": now - 2 * hour, "2": now - hour, "3": now - 1 } }));
  expect(actions).toHaveLength(1);
  expect(actions[0]?.occurrence).toBe(2);
});

it("a role file can give a lead an age cap without giving every lead one", () => {
  const lead = agent({ role: "lead:reviewer", startedSequence: 1 });
  const base = input({ agents: { worker: lead }, eventTimes: { "1": now - 3 * hour } });
  expect(evaluateRunaway(base)).toEqual([]);
  expect(evaluateRunaway({ ...base, roles: { settings: { limits: { ageMinutes: 60 } } } })).toEqual([]);
  expect(evaluateRunaway({ ...base, roles: { file: { name: "Team", roles: { reviewer: { advice: "Review work.", limits: { ageMinutes: 60 } } } } } })).toHaveLength(1);
});

it("elapsed permission time is excluded even after the permission row closes", () => {
  const working = agent({ state: { _tag: "working" }, turnStartSequence: 1, turnOpen: true });
  const base = input({ agents: { worker: working }, eventTimes: { "1": now - 3 * hour }, turnExcludedMillis: { worker: 90 * 60_000 } });
  expect(evaluateRunaway(base)).toEqual([]);
  expect(evaluateRunaway({ ...base, now: now + 31 * 60_000 })).toHaveLength(1);
});

it("the holder's turn counts again after a stopped asker's permission is cancelled", () => {
  const lead = agent({ role: "lead", state: { _tag: "working" }, turnStartSequence: 1, turnOpen: true });
  const request = { status: "open", agentId: "child", holder: { _tag: "agent", agentId: lead.agentId } } as const;
  const base = input({ agents: { worker: lead }, eventTimes: { "1": now - 3 * hour }, requests: { request } });
  expect(evaluateRunaway(base)).toEqual([]);
  expect(evaluateRunaway({ ...base, requests: { request: { ...request, status: "cancelled" } } })).toHaveLength(1);
});

it("an old crash admission outside the hour permits a new retry", () => {
  const admitted = record({ _tag: "roles.CrashAdmitted", agentId: "worker", noticeRecipient: "owner", notice: "sent",
    triggerSequence: 1, sourceSequence: 1, sequence: 2, occurrence: 1 });
  const actions = evaluateCrash({ ...input({ agents: { worker: agent({ state: { _tag: "crashed" }, crashSequence: 3 }) },
    roles: { actions: [admitted] }, eventTimes: { "2": now - hour - 1 } }), event: { _tag: "AgentCrashed", agentId: "worker", sequence: 3 } });
  expect(actions[0]?._tag).toBe("roles.CrashAdmitted");
});

it.each(["open", "cleared"])("a give-up respects an engine failure alert that is %s", (status) => {
  const actions = evaluateCrash({ ...input({ agents: { worker: agent({ state: { _tag: "crashed" }, crashSequence: 3 }) },
    roles: { settings: { limits: { crashRetries: 0 } } }, client: { alerts: { failure: { kind: "failure", agentId: "worker", status } } } }),
    event: { _tag: "AgentCrashed", agentId: "worker", sequence: 3 } });
  expect(actions[0]).toMatchObject({ _tag: "roles.GaveUp", noticeRecipient: "owner", engineAlertOpen: status === "open" });
});
