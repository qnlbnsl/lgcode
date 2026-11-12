import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, expect, vi } from "vitest";
import * as AcpRunner from "../../src/runner/AcpRunner.ts";
import { Runner } from "../../src/runner/Runner.ts";
import { sha256Hex } from "../../src/identity/credential.ts";
import { Views } from "../../src/views/Views.ts";
import { accountFor, echoFile, effortOption, framesOf, harnessFor, makeRunnerRig, modeOption, modelOption,
  readEcho, removeRunnerRig, serviceEnvironment, startPayloadFor, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { call, makeFakeSecrets, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { appendEvents, provideRestart, recover } from "../support/restartRig.ts";
import { eventually, tagged } from "../support/routingRig.ts";
import { withViews } from "../support/withViews.ts";

let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
registerRebuildCheck({ noLog: true });
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) => it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);
const runnerLayer = () => AcpRunner.layer({ socketPath: rig.socket, stateFolder: rig.stateFolder, environment: serviceEnvironment(rig) }).pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, makeFakeSecrets().layer)));
const options = [modeOption(), modelOption(), effortOption()];
const reports = readLog.pipe(Effect.map((rows) => tagged(rows, "ThreadItem").flatMap((row) => row.content._tag === "text" && row.content.text.startsWith("configuration:")
  ? [JSON.parse(row.content.text.slice("configuration:".length))] : [])));
const axis = (value: any, id: string) => value.options.find((option: any) => option.configId === id)?.currentValue;

live("W05c spawn race: a choice committed before the delayed spawn configures the actual first prompt", () => Effect.gen(function* () {
  const committed = yield* Deferred.make<string>(), release = yield* Deferred.make<void>();
  const harness = harnessFor("first", writeFakeAdapter(rig), { models: ["model-small", "model-large"], efforts: ["low", "high"] });
  const echo = echoFile(rig);
  const account = accountFor("first", { configOptions: options, turns: [[{ step: "report_configuration" }]] }, echo);
  let views: Views["Service"] | undefined;
  let held = false;
  yield* provideRestart(rig, runnerLayer(), Effect.gen(function* () {
    yield* registerRebuildCheck();
    views = yield* Views;
    yield* appendEvents({ _tag: "HarnessChanged", harness }, { _tag: "AccountChanged", accountId: account.id, account });
    const starting = yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "first turn", model: "model-small" })).pipe(Effect.forkScoped);
    const agentId = yield* Deferred.await(committed);
    success(yield* call(ownerCredential, "configure", { agentId, model: "model-large", effort: "high" }));
    yield* Deferred.succeed(release, undefined);
    success(yield* Fiber.join(starting));
    const actual = yield* eventually(reports, (values) => values.length === 1);
    expect([axis(actual[0], "model"), axis(actual[0], "effort")]).toEqual(["model-large", "high"]);
  }), { recovering: false, wrapLog: (real) => ({ ...real, transact: (body) => real.transact(body).pipe(Effect.tap(() => Effect.gen(function* () {
    if (held || views === undefined) return;
    const agent = Object.values((yield* views.snapshot).agents).find((row) => row.state._tag === "starting");
    if (agent === undefined) return;
    held = true;
    yield* Deferred.succeed(committed, agent.agentId);
    yield* Deferred.await(release);
  }))) }) });
}));

live("W05c restart: queued owner work uses durable pending settings on reload, and stale incarnation calls cannot touch the new process", () => Effect.gen(function* () {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const oldEcho = echoFile(rig);
  const account = accountFor("first", { configOptions: options, turns: [[
    { step: "text", text: "old turn accepted" },
    { step: "raw_frame", frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "${session}", update: { sessionUpdate: "usage_update", used: 30, size: 100 } } }) },
    { step: "slow", ms: 60_000 },
  ]] }, oldEcho);
  const old = yield* provideRestart(rig, runnerLayer(), Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* appendEvents({ _tag: "HarnessChanged", harness }, { _tag: "AccountChanged", accountId: account.id, account });
    const agentId = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "old work" }))).agentId;
    const oldContext = () => call(ownerCredential, "client.agent.context", { agentId }).pipe(Effect.map(success));
    expect(yield* eventually(oldContext(), (value) => value.context._tag === "available")).toHaveProperty("context.percent", 30);
    success(yield* call(ownerCredential, "configure", { agentId, model: "model-large", effort: "high" }));
    const deliveryId = success(yield* call(ownerCredential, "prompt", { agentId, text: "durable owner work" })).deliveryId;
    const child = yield* readEcho(oldEcho);
    return { agentId, deliveryId, incarnation: sha256Hex(child.env.LGTM_TOKEN!), session: (yield* (yield* Views).snapshot).agents[agentId]!.session };
  }), { recovering: false });
  const nextEcho = echoFile(rig);
  const nextAccount = accountFor("first", { configOptions: options, turns: [[{ step: "report_configuration" }], [{ step: "report_configuration" }]] }, nextEcho);
  yield* withViews(rig.root, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* appendEvents({ _tag: "AccountChanged", accountId: nextAccount.id, account: nextAccount });
  }));
  yield* provideRestart(rig, runnerLayer(), Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* recover;
    const actual = yield* eventually(reports, (values) => values.length === 2);
    expect(actual.map((value) => [axis(value, "model"), axis(value, "effort")])).toEqual([["model-large", "high"], ["model-large", "high"]]);
    const echo = yield* readEcho(nextEcho);
    expect(echo.inbound.some((frame) => frame.method === "session/resume" && frame.params.sessionId === (old.session as any).sessionId)).toBe(true);
    expect(framesOf(echo, "session/prompt").map((frame) => frame.params.prompt[0].text)).toEqual(["old work", "durable owner work"]);
    expect((yield* (yield* Views).snapshot).deliveries[old.deliveryId]?.status).toBe("accepted");
    expect(success(yield* call(ownerCredential, "client.agent.context", { agentId: old.agentId })).context).toEqual({ _tag: "unavailable", reason: "not-reported" });
    const runner = yield* Runner;
    const before = framesOf(echo, "session/set_config_option").length;
    expect((yield* runner.configure({ agentId: old.agentId, incarnation: old.incarnation, desired: { model: "model-small" } }).pipe(Effect.result))._tag).toBe("Failure");
    expect((yield* runner.context({ agentId: old.agentId, incarnation: old.incarnation }).pipe(Effect.result))._tag).toBe("Failure");
    expect(framesOf(yield* readEcho(nextEcho), "session/set_config_option")).toHaveLength(before);
    expect(success(yield* call(ownerCredential, "client.agent.configuration", { agentId: old.agentId })).configuration).toMatchObject({
      status: "applied", applied: { model: "model-large", effort: "high" }, desired: { model: "model-large", effort: "high" },
    });
  }));
}));
