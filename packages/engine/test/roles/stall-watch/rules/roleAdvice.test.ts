import { expect, it } from "vitest";
import { evaluateRoleAdvice } from "../../../../src/roles/stall-watch/rules/roleAdvice.ts";
import { registerRebuildCheck } from "../../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const envelope = (event: Record<string, unknown>, caller: unknown = { _tag: "agent", agentId: "worker" }) => ({
  sequence: 9, occurredAt: 1_900_000_000_000, caller, event,
});
const views = {
  agents: {
    worker: { agentId: "worker", role: "worker:builder", parent: { _tag: "agent", agentId: "lead" } },
    lead: { agentId: "lead", role: "lead", parent: { _tag: "owner" } },
  },
  roles: { file: { name: "Build team", roles: { builder: { advice: "Report work to your lead.", limits: {} } } }, actions: [] },
};

it.each([
  ["RA01", { _tag: "AgentStarted", agentId: "new-worker", parent: { _tag: "agent", agentId: "worker" } }],
  ["RA02", { _tag: "QuestionAsked", agentId: "worker", holder: { _tag: "owner" } }],
  ["RA03", { _tag: "QuestionMoved", agentId: "worker", questionId: "q-1", holder: { _tag: "owner" } }],
] as const)("%s reports a worker's own role-advice break to its holder", (id, event) => {
  const actions = evaluateRoleAdvice(views as any, envelope(event as any) as any);

  expect(actions, `${id} must report this envelope`).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    _tag: "roles.RoleAdviceBroken", agentId: "worker", noticeRecipient: "lead", triggerSequence: 9,
  });
});

it("RA04 ignores a question moved by its caller's pass-up instead of blaming the asker", () => {
  const moved = envelope({ _tag: "QuestionMoved", agentId: "worker", questionId: "q-1", from: { _tag: "agent", agentId: "lead" }, to: { _tag: "owner" }, deliveryId: "move-1" }, {
    _tag: "agent", agentId: "lead",
  });

  expect(evaluateRoleAdvice(views as any, moved as any)).toEqual([]);
});

it("seeded advice suppresses only the same agent/kind and includes owner-addressed posts", () => {
  const seeded = { ...views, agents: { ...views.agents, other: { ...views.agents.worker, agentId: "other" } }, adviceKinds: { worker: ["start"] } };
  expect(evaluateRoleAdvice(seeded as any, envelope({ _tag: "AgentStarted", agentId: "child", parent: { _tag: "agent", agentId: "worker" } }) as any)).toEqual([]);
  expect(evaluateRoleAdvice(seeded as any, envelope({ _tag: "AgentStarted", agentId: "child", parent: { _tag: "agent", agentId: "other" } }, { _tag: "agent", agentId: "other" }) as any))
    .toMatchObject([{ agentId: "other" }]);
  const ownerPost = envelope({ _tag: "board.PostWritten", author: { _tag: "agent", agentId: "worker" }, to: [{ _tag: "owner" }] });
  expect(evaluateRoleAdvice(seeded as any, ownerPost as any)).toMatchObject([{ agentId: "worker" }]);
  const ownerSeeded = { ...seeded, adviceKinds: { worker: ["start", "owner"] } };
  expect(evaluateRoleAdvice(ownerSeeded as any, ownerPost as any)).toEqual([]);
  expect(evaluateRoleAdvice(ownerSeeded as any, envelope({ _tag: "QuestionAsked", agentId: "worker", holder: { _tag: "owner" } }) as any)).toEqual([]);
  expect(evaluateRoleAdvice(ownerSeeded as any, envelope({ _tag: "QuestionMoved", agentId: "worker" }) as any)).toMatchObject([{ agentId: "worker" }]);
});
