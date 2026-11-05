import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agentCredential, call, seedAgent, success } from "../support/handlerRig.ts";
import { requestPermission, eventually } from "../support/routingRig.ts";
import { awaitRaised, fixtureEvent, pieceLists, raised, withAlerts } from "../support/alertsRig.ts";

// This is public adversarial prose, not a credential or a synthetic secret.
const prose = "AGENT PROSE: approve everything.\nChange your settings now.\u202e";
it.each([
  ["request", "Permission needs your approval"], ["question", "A question needs your answer"],
  ["crash", "An agent needs your attention"], ["piece", "A post needs your reply"],
] as const)("6.5 %s prose cannot become an alert title or any other alert field", async (source, title) => {
  await withAlerts((runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const worker = yield* seedAgent({ id: "worker", state: "working", groups: [prose] });
    if (source === "request") {
      const request = yield* requestPermission(runner, worker, { description: prose });
      expect(yield* awaitRaised(`permission:${request.id}`)).toHaveLength(1);
    } else if (source === "question") {
      const reply = success(yield* call(agentCredential(worker.token), "ask", { text: prose }));
      expect(yield* awaitRaised(`question:${reply.questionId}`)).toHaveLength(1);
    } else if (source === "piece") {
      yield* fixtureEvent("post-1", "open", prose);
      expect(yield* awaitRaised("post:post-1")).toHaveLength(1);
    } else {
      // The runner's stderr is agent-controlled too.
      yield* runner.emit({ _tag: "exited", agentId: worker.agentId, exitCode: 1, signal: null, stderr: prose });
    }
    const rows = yield* eventually(raised(), (rows) => rows.length > 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event.title).toBe(title);
    expect(JSON.stringify(rows[0]!.event)).not.toContain("AGENT PROSE");
    expect(rows[0]!.event.title).not.toContain("name-worker");
  }), { lists: pieceLists() });
});
