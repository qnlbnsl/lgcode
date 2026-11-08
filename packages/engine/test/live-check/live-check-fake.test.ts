// Unit 8c: the routine behind `pnpm live-check` (scripts/live/flow.ts), run
// end to end against the real service with the fake agent in place of Claude
// Code and Codex. The routine and its assertions are the ones the owner's live
// run uses; only the driver differs (the fake driver acts through the lead's
// own client, where a real lead acts on its first prompt). The routine asserts
// from events, so the fake-only checks (the adapter's prompts, the tokens) sit
// here, after it.
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { flow, makeStepRunner, StepFailed, type AgentRef, type FlowDriver } from "../../scripts/live/flow.ts";
import { createReporter } from "../../scripts/live/reporter.ts";
import { FINAL_STEP, FLOW_STEPS } from "../../scripts/live/steps.ts";
import {
  eventsUntil, isTag, peekEcho, promptsOf, refusal, requestId, scenario, since, stopAllServices, tagged, threadText, waitFor,
  type Client, type World,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const options = [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }];

type Prepared = Effect.Success<ReturnType<World["prepare"]>>;

interface FakeState {
  lead?: { agentId: string; echo: string; client: Client };
  prepared?: Prepared;
  worker?: { agentId: string; echo: string; accountId: string };
  folder: string;
}

// The lead of the 8b flow: its second turn (the routed permission request) is
// held open until the driver has passed the request up.
const fakeDriver = (w: World, state: FakeState, gate: string, skip: { wideStart?: boolean } = {}): FlowDriver => ({
  startLead: () => Effect.gen(function* () {
    const lead = yield* w.start(w.owner, {
      name: "Lead", role: "lead", permission: "edit", prompt: "Plan the work.",
      script: { turns: [[], [{ step: "wait_for_file", path: gate }], []] },
    });
    yield* eventsUntil(w.owner, 0, "the lead's first turn", isTag("TurnEnded", lead.agentId));
    const client = yield* w.asAgent((yield* w.token(lead)).token);
    state.lead = { agentId: lead.agentId, echo: lead.echo, client };
    return { agentId: lead.agentId } satisfies AgentRef;
  }),
  wideStart: () => Effect.gen(function* () {
    mkdirSync(state.folder, { recursive: true });
    state.prepared = yield* w.prepare({
      name: "Worker", role: "worker", permission: "ask", groups: ["auth"], folder: state.folder, anyAccount: true, prompt: "Write the file.",
      script: { turns: [[{ step: "text", text: "starting the write. " }, { step: "permission", toolCallId: "call-flow", title: "Write the file", options }, { step: "text", text: "file written" }]] },
    });
    if (skip.wideStart === true) return;
    const tooWide = yield* refusal(state.lead!.client.start({ ...state.prepared.request, requestId: requestId(), permission: "full" } as never));
    expect(tooWide, "a permission mode wider than the lead's own was accepted").toBeDefined();
  }),
  startWorker: () => Effect.gen(function* () {
    const started = (yield* state.lead!.client.start(state.prepared!.request as never)) as unknown as { agentId: string };
    state.worker = { agentId: started.agentId, echo: state.prepared!.echo, accountId: state.prepared!.accountId };
    // An identical replay of the same request is the same result, not a second agent.
    const replay = (yield* state.lead!.client.start(state.prepared!.request as never)) as unknown as { agentId: string };
    expect(replay.agentId, "an identical replay of a start made a second agent").toBe(started.agentId);
  }),
  passUp: (lead, worker, permissionRequestId) => Effect.gen(function* () {
    const client = state.lead!.client;
    yield* waitFor("the routed permission request in the lead's adapter", () =>
      promptsOf(peekEcho(state.lead!.echo)!).find((text) => text.includes(`Permission request ${permissionRequestId} from agent ${worker.agentId}`)));
    const opened = (yield* client.wait({ requestId: requestId(), members: [worker.agentId], mode: "all", block: false } as never)) as unknown as { outcome: string };
    expect(opened.outcome, "the wait on a worker that was still working did not stay open").toBe("opened");
    yield* client["pass-up"]({ requestId: requestId(), subject: { _tag: "permission", id: permissionRequestId } } as never);
    writeFileSync(gate, "go");
    expect(lead.agentId).toBe(state.lead!.agentId);
  }),
});

const flowOptions = (w: World, state: FakeState, gate: string, lines: Array<string>, extra: { skip?: { wideStart?: boolean }; agentTimeout?: number } = {}) => {
  const reporter = createReporter((line) => { lines.push(line); });
  return {
    reporter,
    options: {
      owner: w.owner, openOwner: () => w.reopenOwner(), driver: fakeDriver(w, state, gate, extra.skip),
      step: makeStepRunner(reporter), leadHarness: "fake", workerHarness: "fake", workerFolder: state.folder,
      agentTimeout: extra.agentTimeout ?? 30_000, engineTimeout: 20_000, settle: 1_000,
      secrets: () => w.secrets, outputs: () => w.incarnations.map((service, index) => ({ label: `the output of service process ${index + 1}`, text: service.output() })),
      replies: () => w.replies,
    },
  };
};

scenario("live-check routine with the fake driver: all nine flow steps and the final check pass, each is printed once, and the exit code is 0 (breaks if the routine and the spec's eight links part ways, or the printer or exit code is wrong)", (w) => Effect.gen(function* () {
  const state: FakeState = { folder: join(realpathSync(w.root.work), "project") };
  const gate = join(w.root.root, "gate-lead");
  const lines: Array<string> = [];
  const { reporter, options: flowOpts } = flowOptions(w, state, gate, lines);
  const result = yield* flow(flowOpts);

  const expected = [...FLOW_STEPS, FINAL_STEP];
  expect(reporter.results().map((entry) => entry.id), "the steps are not printed once each, in order").toEqual(expected.map((spec) => spec.id));
  expect(reporter.results().filter((entry) => !entry.passed), "a step failed").toEqual([]);
  expect(lines, "one line for each step").toHaveLength(expected.length);
  expect(lines.every((line) => line.startsWith("PASS "))).toBe(true);
  expect(reporter.exitCode(expected)).toBe(0);

  // Fake-only checks that the routine's event assertions cannot see.
  const worker = state.worker!;
  expect(result.worker.agentId).toBe(worker.agentId);
  const workerEcho = (yield* w.token(worker)).echo;
  const leadToken = (yield* w.token({ agentId: state.lead!.agentId, echo: state.lead!.echo, accountId: "" })).token;
  expect(workerEcho.env.LGCODE_TOKEN, "the worker was given the lead's token").not.toBe(leadToken);
  expect(workerEcho.env.LGCODE_SOCKET, "the worker's tools do not reach this service").toBe(w.root.socket);
  const all = yield* since(w.owner, 0);
  expect(threadText(all, worker.agentId)).toContain("permission:selected:allow-once");
  expect(promptsOf(peekEcho(worker.echo)!)[0], "the adapter did not receive the first prompt").toContain("Write the file.");
  expect(promptsOf(peekEcho(state.lead!.echo)!), "the lead's adapter got a prompt too many or too few").toHaveLength(3);
  expect(yield* refusal(state.lead!.client.answer({ requestId: requestId(), kind: "permission", id: result.permissionRequestId, optionId: "allow-once" } as never)),
    "an answer from the lead was accepted after the owner's").toBeDefined();
  expect(tagged(all, "OwnerNeeded", worker.agentId)).toHaveLength(1);
}));

scenario("live-check routine with the fake driver: a driver that never makes the wide start fails that step by name within its bound, prints FAIL, continues every evaluable step, and the exit code is 1 (breaks if a missing link passes, or a wait is unbounded)", (w) => Effect.gen(function* () {
  const state: FakeState = { folder: join(realpathSync(w.root.work), "project") };
  const gate = join(w.root.root, "gate-lead");
  const lines: Array<string> = [];
  const { reporter, options: flowOpts } = flowOptions(w, state, gate, lines, { skip: { wideStart: true }, agentTimeout: 3_000 });
  const failure = yield* Effect.flip(flow(flowOpts));
  expect(failure).toBeInstanceOf(StepFailed);
  expect(failure.stepId).toBe("wide-start");
  expect(failure.message).toContain("the refusal of the lead's start with a wider mode");
  expect(lines.map((line) => line.split(":")[0])).toEqual([...FLOW_STEPS, FINAL_STEP].map((spec) => `${spec.id === "wide-start" ? "FAIL" : "PASS"} ${spec.id}`));
  expect(reporter.exitCode([...FLOW_STEPS, FINAL_STEP])).toBe(1);
}), { timeout: 60_000 });
