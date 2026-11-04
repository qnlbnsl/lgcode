import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import {
  accountFor, echoFile, fixturePath, harnessFor, makeRunnerRig, removeRunnerRig,
  startPayloadFor, withEngine, writeFakeAdapter,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { eventsNamed } from "../support/capacityRig.ts";
import { eventually, pause, snapshot } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
it("K14 catches the real adapter path converting a documented capacity frame into a pause, return, or turn end", async () => {
  const rig = makeRunnerRig();
  const sample = JSON.parse(readFileSync(fixturePath("errors/claude-capacity.json"), "utf8")) as { text: string };
  try {
    const harness = harnessFor("claude", writeFakeAdapter(rig));
    const account = accountFor("claude", { turns: [[{ step: "rpc_error", message: sample.text }]] }, echoFile(rig));
    await Effect.runPromise(withEngine(rig, { harness, accounts: [account], capacityHoldCondition: () => true }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "Try the capacity error path." })));
      const rows = yield* eventually(readLog, (rows) => eventsNamed(rows, "DeliveryHeld").length > 0);
      expect(eventsNamed(rows, "DeliveryHeld")).toEqual([expect.objectContaining({ agentId: started.agentId, reason: "capacity" })]);
      yield* pause(60);
      expect(context.events.find((event) => event._tag === "promptReply")).toHaveProperty("outcome._tag", "capacity");
      expect(eventsNamed(yield* readLog, "DeliveryReturned")).toEqual([]);
      expect(eventsNamed(yield* readLog, "TurnEnded")).toEqual([]);
      expect((yield* snapshot).agents[String(started.agentId)]?.state._tag).toBe("idle");
      expect((yield* snapshot).accounts.primary?.status).toBe("available");
    })));
  } finally { removeRunnerRig(rig); }
}, 30_000);
