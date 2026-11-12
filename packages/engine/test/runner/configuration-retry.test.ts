import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { AgentChoice, AgentId } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, expect, vi } from "vitest";
import * as AcpRunner from "../../src/runner/AcpRunner.ts";
import { Views } from "../../src/views/Views.ts";
import { accountFor, echoFile, effortOption, framesOf, harnessFor, makeRunnerRig, modeOption, modelOption,
  readEcho, removeRunnerRig, serviceEnvironment, startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { call, failureOf, makeFakeSecrets, ownerCredential, readLog, stateOf, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { appendEvents, provideRestart, recover } from "../support/restartRig.ts";
import { eventually, tagged } from "../support/routingRig.ts";
import { withViews } from "../support/withViews.ts";

let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
registerRebuildCheck({ noLog: true });
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);
const runnerLayer = () => AcpRunner.layer({ socketPath: rig.socket, stateFolder: rig.stateFolder, environment: serviceEnvironment(rig) }).pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, makeFakeSecrets().layer)));
const initial = { model: "model-small", effort: "low" };
const advertised = [modeOption(), modelOption(), effortOption()];
interface Report { pid: number; options: Array<{ configId: string; currentValue: string }> }
const reports = readLog.pipe(Effect.map((rows) => tagged(rows, "ThreadItem").flatMap((row): Report[] =>
  row.content._tag === "text" && row.content.text.startsWith("configuration:")
    ? [JSON.parse(row.content.text.slice("configuration:".length))] : [])));
const selected = (report: Report): AgentChoice => {
  const model = report.options.find((option) => option.configId === "model")?.currentValue;
  const effort = report.options.find((option) => option.configId === "effort")?.currentValue;
  return { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) };
};
const configuration = (agentId: AgentId) => call(ownerCredential, "client.agent.configuration", { agentId }).pipe(Effect.map(success));
const rowOf = (agentId: AgentId) => Effect.gen(function* () { return (yield* (yield* Views).snapshot).agents[agentId]!; });

// Each lifecycle uses the actual handler, restart service and ACP child. The
// configured lists are deliberately nonempty, and exclude the live choice.
for (const path of ["resume", "fresh", "reload"] as const) {
  for (const axis of ["model", "effort"] as const) {
    for (const lost of [false, true]) live(`537 ${path}: negotiated ${axis} ${lost ? "is refused recoverably when support disappears" : "survives and gates the queued prompt until acknowledged"}`, () => Effect.gen(function* () {
      const harness = harnessFor("first", writeFakeAdapter(rig), { models: [initial.model], efforts: [initial.effort] });
      const desired = { ...initial, [axis]: axis === "model" ? "model-large" : "high" };
      const oldEcho = echoFile(rig), nextEcho = echoFile(rig);
      const turnGate = join(rig.root, "old-turn"), configGate = join(rig.root, "acknowledge"), entered = join(rig.root, "setter-entered");
      const oldAccount = accountFor(harness.id, { configOptions: advertised, strictConfigOptions: true,
        turns: [[{ step: "report_configuration" }], [{ step: "wait_for_file", path: turnGate }]],
      }, oldEcho);
      // The negative control deliberately accepts arbitrary setter values. The
      // engine must reject a choice absent from the new advertisement itself.
      const nextOptions = lost ? advertised.map((option) => option.configId === axis
        ? { ...option, options: option.options.filter((choice) => choice.value === initial[axis]) } : option) : advertised;
      const nextAccount = accountFor(harness.id, { configOptions: nextOptions, strictConfigOptions: !lost,
        ...(lost ? {} : { configuration: { gate: configGate, entered } }),
        turns: [[{ step: "report_configuration" }], [{ step: "report_configuration" }]],
      }, nextEcho);
      const begin = Effect.gen(function* () {
        yield* registerRebuildCheck();
        yield* appendEvents({ _tag: "HarnessChanged", harness }, { _tag: "AccountChanged", accountId: oldAccount.id, account: oldAccount });
        // Initial admission remains strict even though the adapter advertises more.
        expect(failureOf(yield* call(ownerCredential, "start", startPayloadFor(harness, oldAccount, rig.work, desired)))?._tag).toBe("CommandRefused");
        expect(existsSync(oldEcho)).toBe(false);
        const agentId = success(yield* call(ownerCredential, "start", startPayloadFor(harness, oldAccount, rig.work, initial))).agentId as AgentId;
        const choice = success(yield* call(ownerCredential, "configure", { agentId, [axis]: desired[axis] }));
        yield* eventually(configuration(agentId), (value) => value.configuration.status === "applied");
        success(yield* call(ownerCredential, "prompt", { agentId, text: "prove the live selection before lifecycle change" }));
        const before = (yield* eventually(reports, (values) => values.length === 1))[0]!;
        expect(selected(before)).toEqual(desired);
        yield* eventually(stateOf(agentId), (state) => state === "idle");
        let activeDelivery: string | undefined;
        if (path !== "reload") {
          success(yield* call(ownerCredential, "stop", { agentId }));
        } else {
          activeDelivery = success(yield* call(ownerCredential, "prompt", { agentId, text: "work interrupted by reload" })).deliveryId;
          expect(framesOf(yield* readEcho(oldEcho, (echo) => framesOf(echo, "session/prompt").length === 2), "session/prompt")).toHaveLength(2);
        }
        // Reload retains a genuine queued owner prompt from the previous service.
        const queued = path === "reload" ? success(yield* call(ownerCredential, "prompt", { agentId, text: "work queued before reload" })).deliveryId : undefined;
        return { agentId, revision: choice.requestId, oldPid: before.pid, queued, activeDelivery };
      });
      type Started = Effect.Success<typeof begin>;
      const finish = (started: Started) => Effect.gen(function* () {
        yield* registerRebuildCheck();
        const { agentId, revision } = started;
        const lifecycle = path === "reload" ? recover : call(ownerCredential, "resume", { agentId, fresh: path === "fresh" }).pipe(Effect.map(success));
        const pending = yield* lifecycle.pipe(Effect.forkScoped);
        if (!lost) {
          // This is a real setter gate, not a sleep or an event-only assertion.
          expect(yield* eventually(Effect.sync(() => existsSync(entered)), Boolean)).toBe(true);
          const opening = yield* rowOf(agentId);
          expect(opening.configuration).toMatchObject({ revision, desired, status: "pending" });
          expect(opening.configuration?.applied).toEqual(initial);
          expect(framesOf(yield* readEcho(nextEcho), "session/prompt")).toHaveLength(0);
        } else {
          yield* Fiber.join(pending);
          const refused = yield* eventually(configuration(agentId), (value) => value.configuration.status === "refused");
          expect(refused.configuration).toMatchObject({ revision, desired, status: "refused", reason: "adapter-refused", applied: initial });
          expect(framesOf(yield* readEcho(nextEcho), "session/set_config_option").some((frame) => frame.params.value === desired[axis])).toBe(false);
          expect(failureOf(yield* call(ownerCredential, "configure", { agentId, [axis]: desired[axis] }))?._tag).toBe("CommandRefused");
        }
        const deliveryId = started.queued ?? success(yield* call(ownerCredential, "prompt", { agentId, text: "work queued during retry configuration" })).deliveryId;
        expect((yield* (yield* Views).snapshot).deliveries[deliveryId]?.status).toBe("queued");
        expect(framesOf(yield* readEcho(nextEcho), "session/prompt")).toHaveLength(0);
        if (lost) {
          // Owner correction releases the original work on this same new process.
          success(yield* call(ownerCredential, "configure", { agentId, [axis]: initial[axis] }));
        } else {
          writeFileSync(configGate, "acknowledge");
          yield* Fiber.join(pending);
        }
        const actual = yield* eventually(reports, (values) => values.length === (path === "reload" ? 3 : 2));
        expect(actual).toHaveLength(path === "reload" ? 3 : 2);
        const after = actual.slice(1);
        const echo = yield* readEcho(nextEcho);
        expect(echo.pid).not.toBe(started.oldPid);
        expect(after.map((report) => report.pid)).toEqual(after.map(() => echo.pid));
        expect(after.map(selected)).toEqual(after.map(() => lost ? initial : desired));
        const prompts = framesOf(echo, "session/prompt");
        if (path === "reload") {
          expect(prompts[0]?.params.prompt[0].text).toBe("work interrupted by reload");
          expect((yield* (yield* Views).snapshot).deliveries[started.activeDelivery!]?.status).toBe("accepted");
        }
        expect(prompts.at(-1)?.params.prompt[0].text).toBe(path === "reload" ? "work queued before reload" : "work queued during retry configuration");
        expect((yield* (yield* Views).snapshot).deliveries[deliveryId]?.status).toBe("accepted");
        const final = yield* eventually(configuration(agentId), (value) => value.configuration.status === "applied");
        expect(final.configuration).toMatchObject({ desired: lost ? initial : desired, applied: lost ? initial : desired });
        expect(success(yield* call(ownerCredential, "client.agent.context", { agentId })).context).toEqual({ _tag: "unavailable", reason: "not-reported" });
        if (!lost) expect(final.configuration.revision).toBe(revision);
        yield* eventually(stateOf(agentId), (state) => state === "idle");
        expect(framesOf(echo, path === "fresh" ? "session/new" : "session/load").length
          + (path === "fresh" ? 0 : framesOf(echo, "session/resume").length)).toBe(1);
        expect((yield* readLog).filter((row) => row.event._tag === "HarnessChanged").map((row) => row.event)).toEqual([{ _tag: "HarnessChanged", harness }]);
      });
      if (path === "reload") {
        const started = yield* provideRestart(rig, runnerLayer(), begin, { recovering: false });
        yield* withViews(rig.root, appendEvents({ _tag: "AccountChanged", accountId: nextAccount.id, account: nextAccount }));
        yield* provideRestart(rig, runnerLayer(), finish(started));
      } else {
        yield* provideRestart(rig, runnerLayer(), Effect.gen(function* () {
          const started = yield* begin;
          success(yield* call(ownerCredential, "accounts", { operation: "set", account: nextAccount }));
          yield* finish(started);
        }), { recovering: false });
      }
    }));
  }
}

for (const axis of ["model", "effort"] as const) for (const response of ["unsupported", "unacknowledged"] as const) {
  live(`537 fresh ${axis}: ${response} support cannot fabricate applied settings or send work`, () => {
    const harness = harnessFor("first", writeFakeAdapter(rig), { models: [initial.model], efforts: [initial.effort] });
    const echo = echoFile(rig), nextEcho = echoFile(rig);
    const desired = { ...initial, [axis]: axis === "model" ? "model-large" : "high" };
    const account = accountFor(harness.id, { configOptions: advertised, turns: [] }, echo);
    return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const agentId = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, initial))).agentId as AgentId;
      success(yield* call(ownerCredential, "configure", { agentId, [axis]: desired[axis] }));
      expect((yield* eventually(configuration(agentId), (value) => value.configuration.status === "applied")).configuration.applied).toEqual(desired);
      success(yield* call(ownerCredential, "stop", { agentId }));
      const replacement = accountFor(harness.id, {
        configOptions: response === "unsupported" ? advertised.filter((option) => option.configId !== axis) : advertised,
        configuration: { ignoreValues: [desired[axis]] }, turns: [[{ step: "report_configuration" }]],
      }, nextEcho);
      success(yield* call(ownerCredential, "accounts", { operation: "set", account: replacement }));
      success(yield* call(ownerCredential, "resume", { agentId, fresh: true }));
      const actual = response === "unsupported" ? Object.fromEntries(Object.entries(initial).filter(([key]) => key !== axis)) : initial;
      const refused = yield* eventually(configuration(agentId), (value) => value.configuration.status !== "pending");
      expect(refused.configuration).toMatchObject({ desired, applied: actual, status: response === "unsupported" ? "unsupported" : "refused",
        reason: response === "unsupported" ? "not-supported" : "not-acknowledged" });
      const queued = success(yield* call(ownerCredential, "prompt", { agentId, text: "retain until the owner resolves support" }));
      expect((yield* (yield* Views).snapshot).deliveries[queued.deliveryId]?.status).toBe("queued");
      expect(framesOf(yield* readEcho(nextEcho), "session/prompt")).toHaveLength(0);
      expect(yield* stateOf(agentId)).toBe("idle");
    }));
  });
}

live("537 Cursor fresh retry: the auto launch alias and a negotiated effort retain their actual protocol selections", () => {
  const harness = harnessFor("cursor", writeFakeAdapter(rig), { models: ["auto"], defaultModel: "auto", efforts: ["low"] });
  const model = { configId: "model", name: "Model", category: "model", type: "select", currentValue: "other-model",
    options: [{ value: "default[]", name: "Auto" }, { value: "other-model", name: "Other" }] };
  const echo = echoFile(rig);
  const account = accountFor(harness.id, { configOptions: [modeOption(), model, effortOption()], strictConfigOptions: true,
    turns: [[{ step: "report_configuration" }]],
  }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const agentId = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work))).agentId as AgentId;
    success(yield* call(ownerCredential, "configure", { agentId, effort: "high" }));
    expect((yield* eventually(configuration(agentId), (value) => value.configuration.status === "applied")).configuration.applied).toEqual({ model: "default[]", effort: "high" });
    const oldPid = (yield* readEcho(echo)).pid;
    success(yield* call(ownerCredential, "stop", { agentId }));
    success(yield* call(ownerCredential, "resume", { agentId, fresh: true }));
    success(yield* call(ownerCredential, "prompt", { agentId, text: "retain the auto selection" }));
    const actual = yield* eventually(reports, (values) => values.length === 1);
    expect(actual).toHaveLength(1);
    expect(actual[0]!.pid).not.toBe(oldPid);
    expect(selected(actual[0]!)).toEqual({ model: "default[]", effort: "high" });
    expect((yield* configuration(agentId)).configuration).toMatchObject({ status: "applied", desired: { model: "auto", effort: "high" }, applied: { model: "default[]", effort: "high" } });
    expect(framesOf(yield* readEcho(echo), "session/set_model")).toHaveLength(0);
  }));
});
