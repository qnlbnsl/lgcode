import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { Runner } from "../../src/runner/Runner.ts";
import { Views } from "../../src/views/Views.ts";
import { incarnationOf, makeFakeRunner, sessionFor } from "../support/fakeRunner.ts";
import {
  call, makeFakeSecrets, makeRig, ownerCredential, provideRig, readLog, removeRig,
  seedAccount, seedAgent, seedHarness, startPayload, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
});
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
registerRebuildCheck({ noLog: true });

for (const command of ["start", "resume"] as const) {
  it.live(`6.1 session result: ${command} cannot mark a process idle after its exit was committed`, () => Effect.gen(function* () {
    const runner = yield* makeFakeRunner();
    return yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      yield* runner.subscribed;
      const views = yield* Views;
      const exitedBeforeResult = (input: Parameters<Runner["Service"]["start"]>[0]) => Effect.gen(function* () {
        yield* runner.emitRaw({ _tag: "exited", agentId: input.agentId,
          incarnation: incarnationOf(Redacted.value(input.token)), exitCode: 3, signal: null, stderr: "" });
        yield* eventually(views.snapshot, (snapshot) => snapshot.agents[input.agentId]?.state._tag === "crashed");
        return sessionFor(input.agentId);
      });
      runner.script("start", exitedBeforeResult);
      runner.script("load", exitedBeforeResult);
      const agentId = command === "start"
        ? success(yield* call(ownerCredential, "start", startPayload(rig))).agentId as string
        : "resume-race";
      if (command === "resume") {
        yield* seedAgent({ id: agentId, state: "crashed", reloadable: true });
        success(yield* call(ownerCredential, "resume", { agentId, fresh: false }));
      }
      const rows = yield* readLog;
      expect(tagged(rows, "AgentCrashed").filter((event) => event.agentId === agentId)).toHaveLength(command === "resume" ? 2 : 1);
      expect(tagged(rows, "SessionOpened").filter((event) => event.agentId === agentId)).toHaveLength(command === "resume" ? 1 : 0);
      expect((yield* views.snapshot).agents[agentId]?.state._tag).toBe("crashed");
    }));
  }), 10_000);
}
