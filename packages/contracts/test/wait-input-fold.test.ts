import { foldSettled, type SettledInput } from "../src/settled.ts";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { apply, emptyViews } from "../../engine/src/views/apply.ts";
import { envelopes, event, started, opened, permission, question } from "../../engine/test/support/viewFixtures.ts";
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
const empty = (): SettledInput => ({ agents: {}, requests: {}, questions: {}, deliveries: {}, waits: {} });
const pick = (input: SettledInput) => ({
  agents: Object.fromEntries(Object.entries(input.agents).map(([id, row]) => [id, { state: { _tag: row.state._tag }, ...(row.reloadable === undefined ? {} : { reloadable: row.reloadable }), capacityHeld: row.capacityHeld === true }])),
  requests: Object.fromEntries(Object.entries(input.requests).map(([id, row]) => [id, { agentId: row.agentId, holder: row.holder, status: row.status }])),
  questions: Object.fromEntries(Object.entries(input.questions).map(([id, row]) => [id, { agentId: row.agentId, holder: row.holder, status: row.status }])),
  deliveries: Object.fromEntries(Object.entries(input.deliveries).map(([id, row]) => [id, { target: row.target, status: row.status }])),
  waits: Object.fromEntries(Object.entries(input.waits).map(([id, row]) => [id, { agentId: row.agentId, status: row.status, blocking: row.blocking }])),
});
it("3.5 generated engine histories keep the client wait-input fold equal to apply at every sequence", () => {
  fc.assert(fc.property(fc.array(fc.record({ reloadable: fc.boolean(), cancel: fc.boolean(), blocking: fc.boolean(), end: fc.constantFrom("idle", "interrupted", "crashed", "stopped", "paused") }), { minLength: 1, maxLength: 12 }), (episodes) => {
    const history = episodes.flatMap((episode, i) => {
      const agentId = ["agent-a", "__proto__", "constructor", "toString"][i % 4]!;
      const id = `episode-${i}`;
      const queued = { _tag: "DeliveryQueued", delivery: { id, target: agentId, sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Fixture turn." } } };
      return [
        event({ ...started, agentId }), event({ ...opened, agentId, reloadable: episode.reloadable }), event(queued),
        event({ _tag: "DeliverySent", agentId, deliveryId: id, method: "acp" }), event({ _tag: "DeliveryAccepted", agentId, deliveryId: id }),
        event({ ...permission, agentId, permissionRequestId: id }),
        event({ _tag: "PermissionMoved", agentId, permissionRequestId: id, from: { _tag: "owner" }, to: { _tag: "agent", agentId: "parent" }, deliveryId: `moved-${id}` }),
        event(episode.cancel ? { _tag: "PermissionCancelled", agentId, permissionRequestId: id, reason: "Cancelled fixture." } : { _tag: "PermissionAnswered", agentId, permissionRequestId: id, answeredBy: { _tag: "owner" }, answer: { _tag: "selected", optionId: "once" } }),
        event({ ...question, agentId, questionId: id }),
        event({ _tag: "QuestionMoved", agentId, questionId: id, from: { _tag: "owner" }, to: { _tag: "agent", agentId: "parent" }, deliveryId: `qm-${id}` }),
        event({ _tag: "QuestionAnswered", agentId, questionId: id, answeredBy: { _tag: "owner" }, text: "Answer.", deliveryId: `qa-${id}` }),
        event({ _tag: "WaitOpened", agentId, waitId: id, members: ["child"], mode: "all", blocking: episode.blocking }),
        event(episode.cancel ? { _tag: "WaitCancelled", agentId, waitId: id, reason: "Cancelled fixture." } : { _tag: "WaitSatisfied", agentId, waitId: id, members: [{ agentId: "child", reason: "settled" }] }),
        event({ _tag: "DeliveryQueued", delivery: { ...queued.delivery, id: `withdraw-${id}` } }),
        event({ _tag: "DeliveryWithdrawn", agentId, deliveryId: `withdraw-${id}`, reason: "Source closed." }),
        event({ _tag: "TurnEnded", agentId, compact: false }),
        event({ _tag: "DeliveryHeld", agentId, deliveryId: `hold-${id}`, reason: "capacity" }),
        event({ _tag: "DeliveryReleased", agentId }),
        event({ _tag: "DeliveryHeld", agentId, deliveryId: `final-hold-${id}`, reason: "capacity" }),
        event(episode.end === "crashed" ? { _tag: "AgentCrashed", agentId, exitCode: 1, signal: null, stderr: "Fixture." }
          : episode.end === "stopped" ? { _tag: "AgentStopped", agentId }
          : episode.end === "interrupted" ? { _tag: "AgentInterrupted", agentId, previous: "idle" }
          : { _tag: "StateChanged", agentId, state: episode.end === "paused" ? { _tag: "paused", reason: "limit", midTurn: false } : { _tag: "idle" } }),
      ];
    });
    let client = empty(); let engine = emptyViews();
    for (const row of envelopes(history)) {
      client = foldSettled(client, row); engine = apply(engine, row);
      expect(pick(client), `fold diverged after sequence ${row.sequence} ${row.event._tag}`).toEqual(pick(engine));
    }
  }), { numRuns: 100, seed: 314159 });
});
