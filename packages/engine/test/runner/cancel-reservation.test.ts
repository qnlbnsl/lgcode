import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { accountFor, deliveryFor, echoFile, harnessFor, makeRunnerRig, readEcho, removeRunnerRig,
  spawnFor, withAcpRunner, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";

let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
registerRebuildCheck({ noLog: true });

for (const protocolVersion of [1, 2]) {
  it.live(`a delayed cancel for an ended reservation never reaches the next turn, protocol ${protocolVersion}`, () =>
    withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
      const harness = harnessFor("cancel-peer", writeFakeAdapter(rig));
      const echo = echoFile(rig);
      const account = accountFor(harness.id, { protocolVersion, turns: [[], [
        { step: "plan", entries: [{ content: "reservation 42 is active", priority: "high", status: "in_progress" }] },
        { step: "slow", ms: 60_000 },
      ]] }, echo);
      const agent = yield* spawnFor(rig, harness, account);
      yield* context.runner.start(agent.input);
      const delivery = deliveryFor(agent.agentId, "Reuse the delivery id with a new reservation.");
      const send = { agentId: agent.agentId, incarnation: agent.incarnation, delivery };
      yield* context.runner.prompt({ ...send, sentSequence: 17 });
      const first = yield* context.waitFor((event) => event._tag === "turnEnded");
      expect(first).not.toHaveProperty("stopped");
      yield* context.runner.prompt({ ...send, sentSequence: 42 });
      // A pipe write confirms delivery, not that the fake peer has installed
      // its turn's cancel signal. Exercise stale cancellation against the
      // active second reservation, rather than that unrelated dispatch race.
      yield* context.waitFor((event) => event._tag === "deliveryUpdate" && event.deliveryId === delivery.id
        && event.kind === "plan" && event.text.includes("reservation 42 is active"));
      const stale = yield* context.runner.cancel({ agentId: agent.agentId, deliveryId: delivery.id, sentSequence: 17 }).pipe(Effect.result);
      expect(stale._tag).toBe("Failure");
      expect((yield* readEcho(echo)).inbound.filter((frame) => frame.method === "session/cancel")).toEqual([]);
      yield* context.runner.cancel({ agentId: agent.agentId, deliveryId: delivery.id, sentSequence: 42 });
      const last = yield* context.waitFor((event) => event._tag === "turnEnded" && event.sentSequence === 42);
      expect(last).toMatchObject({ stopped: true });
      expect((yield* readEcho(echo)).inbound.filter((frame) => frame.method === "session/cancel")).toHaveLength(1);
    })).pipe(Effect.orDie));
}
