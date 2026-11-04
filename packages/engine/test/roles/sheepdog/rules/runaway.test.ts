import { expect, it } from "vitest";
import { evaluateRunaway } from "../../../../src/roles/sheepdog/rules/runaway.ts";
import { registerRebuildCheck } from "../../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const at = 1_900_000_000_000;
const context = (agents: Record<string, unknown>, options: Record<string, unknown> = {}) => ({
  agents,
  now: at,
  eventTimes: { started: at - 121 * 60_000, sent: at - 121 * 60_000 },
  deliveries: { turn: { status: "sent", delivery: { content: { _tag: "prompt", text: "continue" } } } },
  requests: {}, waits: {}, roles: { settings: {}, actions: [], agents: {} },
  ...options,
});
const worker = (overrides: Record<string, unknown> = {}) => ({
  agentId: "worker", name: "worker", role: "worker:builder", parent: { _tag: "agent", agentId: "lead" },
  state: { _tag: "working" }, compacting: false, capacityHeld: false, ...overrides,
});

it("RW01 reports an over-limit turn to its holder once for that turn", () => {
  const actions = evaluateRunaway(context({ worker: worker({ turnStartSequence: 2, turnOpen: true }) }) as any);

  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    _tag: "roles.RunawayReported", agentId: "worker", noticeRecipient: "lead", occurrence: 1,
  });
});

it("RW02 excludes elapsed time while an open permission request holds the turn", () => {
  const actions = evaluateRunaway(context({ worker: worker({ turnStartSequence: 2, turnOpen: true }) }, {
    requests: { permission: { status: "open", agentId: "worker", holder: { _tag: "agent", agentId: "lead" } } },
  }) as any);

  expect(actions).toEqual([]);
});

it("RW03 excludes a blocking wait on workers that are still working", () => {
  const actions = evaluateRunaway(context({
    lead: worker({ agentId: "lead", role: "lead", turnStartSequence: 2, turnOpen: true, parent: { _tag: "owner" } }),
    worker: worker(),
  }, { waits: { wait: { status: "open", blocking: true, agentId: "lead", members: ["worker"] } } }) as any);

  expect(actions).toEqual([]);
});

it("RW04 applies the worker age limit from AgentStarted and suggests a hand-off once", () => {
  const actions = evaluateRunaway(context({ worker: worker({ state: { _tag: "idle" }, startedSequence: 1 }) }) as any);

  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ _tag: "roles.RunawayReported", agentId: "worker", noticeRecipient: "lead" });
});

it("RW05 gives leads no age limit unless their role limits set one", () => {
  const actions = evaluateRunaway(context({
    lead: worker({ agentId: "lead", role: "lead", state: { _tag: "idle" }, startedSequence: 1, parent: { _tag: "owner" } }),
  }) as any);

  expect(actions).toEqual([]);
});
