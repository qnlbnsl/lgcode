import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  accountFor, compactFor, deliveryFor, echoFile, harnessFor, makeRunnerRig, removeRunnerRig,
  spawnFor, withAcpRunner, writeFakeAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
registerRebuildCheck({ noLog: true });

for (const protocolVersion of [1, 2]) for (const method of ["prompt", "compact"] as const) {
  it.live(`FR-016 ${method}, protocol ${protocolVersion}: the real runner returns each reservation's sequence when the delivery ID is reused`, () =>
    withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
      const harness = harnessFor("first", writeFakeAdapter(rig));
      const catalogue = { step: "raw_frame", frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update",
        params: { sessionId: "${session}", update: { sessionUpdate: "available_commands_update",
          availableCommands: [{ type: "command", name: "compact", description: "Compact" }] } } }) };
      const account = accountFor("first", { protocolVersion,
        turns: method === "compact" ? [[catalogue], [], []] : [[], []] }, echoFile(rig));
      const agent = yield* spawnFor(rig, harness, account);
      yield* context.runner.start(agent.input);
      if (method === "compact") {
        const first = deliveryFor(agent.agentId, "List the available commands.");
        yield* context.runner.prompt({ agentId: agent.agentId, incarnation: agent.incarnation, delivery: first, sentSequence: 19 });
        yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === first.id);
      }
      const delivery = method === "compact" ? compactFor(agent.agentId) : deliveryFor(agent.agentId, "Retry the same delivery.");
      const before = context.events.length;
      for (const sentSequence of [41, 73]) {
        const from = context.events.length;
        yield* context.runner[method]({ agentId: agent.agentId, incarnation: agent.incarnation, delivery, sentSequence });
        const end = yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === delivery.id, from);
        expect(end).toMatchObject({ _tag: "turnEnded", deliveryId: delivery.id, sentSequence });
      }
      expect(context.eventsAfter(before).filter((event) => event._tag === "turnEnded").map((event) => event.sentSequence)).toEqual([41, 73]);
    })));
}
