import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { MinimumLogLevel } from "effect/References";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { redactingLoggerLayer } from "../../src/identity/logger.ts";
import { RunnerRejected } from "../../src/runner/Runner.ts";
import { Views } from "../../src/views/Views.ts";
import { incarnationOf, makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, call, makeFakeSecrets, makeRig, provideRig, readLog, removeRig,
  seedAccount, seedAgent, seedHarness, success, type Fakes, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { endTurn, requestPermission, requestRow, standardOptions, tagged } from "../support/routingRig.ts";

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRig(rig);
});

const withRig = <A, E, R>(body: (fakes: Fakes) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fakes: Fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    return yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      yield* fakes.runner.subscribed;
      return yield* body(fakes);
    }));
  });

it.live("5.5 runner rejection keeps the committed answer and receipt, logs once without failure content, and does not retry the runner", () => {
  const lines: Array<string> = [];
  const secret = "runner-failure-content-must-not-be-logged";
  return withRig((fakes) => Effect.gen(function* () {
    const lead = yield* seedAgent({ id: "lead" });
    const worker = yield* seedAgent({ id: "worker", parent: "lead", state: "working" });
    const { id } = yield* requestPermission(fakes.runner, worker);
    const views = yield* Views;
    fakes.runner.script("answerPermission", () => Effect.gen(function* () {
      expect((yield* views.snapshot).requests[id]?.status).toBe("answered");
      return yield* new RunnerRejected({ reason: secret });
    }));
    const payload = { requestId: "answer-retry", kind: "permission", id, optionId: "once" };
    const first = success(yield* call(agentCredential(lead.token), "answer", payload));
    expect(success(yield* call(agentCredential(lead.token), "answer", payload))).toEqual(first);
    expect((yield* requestRow(id))?.status).toBe("answered");
    expect(tagged(yield* readLog, "PermissionAnswered")).toHaveLength(1);
    expect(fakes.runner.callsOf("answerPermission")).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).message).toBe("permission answer delivery failed");
    expect(lines.join("\n")).not.toContain(secret);
  })).pipe(
    Effect.provide(Layer.mergeAll(
      redactingLoggerLayer({ redactText: (text) => text }, (line) => { lines.push(line); }),
      Layer.succeed(MinimumLogLevel, "All"),
    )),
    Effect.orDie,
  );
});

it.live("5.5 duplicate runner notification cannot reopen an answered request or replace its asker", () =>
  withRig((fakes) => Effect.gen(function* () {
    const lead = yield* seedAgent({ id: "lead" });
    const worker = yield* seedAgent({ id: "worker", parent: "lead", state: "working" });
    const other = yield* seedAgent({ id: "other", state: "working" });
    const { id, row } = yield* requestPermission(fakes.runner, worker);
    success(yield* call(agentCredential(lead.token), "answer", { kind: "permission", id, optionId: "once" }));
    for (const sender of [worker, other]) {
      yield* fakes.runner.emit({
        _tag: "permissionRequested", agentId: sender.agentId, incarnation: incarnationOf(sender.token),
        permissionRequestId: id, toolCallId: "replacement", description: "Replacement", options: standardOptions, settingsWrite: true,
      });
    }
    // A later event proves the sequential consumer read both duplicates.
    yield* endTurn(fakes.runner, other);
    expect(yield* requestRow(id)).toMatchObject({ agentId: worker.agentId, status: "answered", toolCallId: row.toolCallId });
    expect(tagged(yield* readLog, "PermissionRequested")).toHaveLength(1);
  })).pipe(Effect.orDie));
