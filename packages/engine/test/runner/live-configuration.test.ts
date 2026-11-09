import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { ownerOnlyCommands } from "@lgcode/contracts";
import { toolNames } from "../../../mcp/src/tools.ts";
import { serve } from "../../src/api/server.ts";
import { connect, upgradeStatus } from "../support/socketClient.ts";
import { CommandHandler } from "../../src/commands/CommandHandler.ts";
import { Views } from "../../src/views/Views.ts";
import { rebuild } from "../../src/views/rebuild.ts";
import { accountFor, echoFile, effortOption, framesOf, harnessFor, makeRunnerRig, modeOption, modelOption, peekEcho,
  readEcho, removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { call, failureOf, ownerCredential, readLog, stateOf, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";

let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
registerRebuildCheck({ noLog: true });
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) => it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);
const options = [modeOption(), modelOption(), effortOption()];
const report = { step: "report_configuration" };
const compactAdvertisement = { step: "raw_frame", frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {
  sessionId: "${session}", update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "compact", description: "Compact context" }] },
} }) };
const read = (name: string, agentId: string) => call(ownerCredential, name, { agentId }).pipe(Effect.map(success));
const configuration = (agentId: string) => read("client.agent.configuration", agentId).pipe(Effect.map((reply) => reply.configuration));
const applied = (agentId: string) => eventually(configuration(agentId), (value) => value.status === "applied");
const reports = () => readLog.pipe(Effect.map((rows) => tagged(rows, "ThreadItem").flatMap((row) => {
  if (row.content._tag !== "text" || !row.content.text.startsWith("configuration:")) return [];
  return [JSON.parse(row.content.text.slice("configuration:".length))];
})));
const axis = (value: any, id: string) => value.options.find((option: any) => option.configId === id)?.currentValue;

for (const protocolVersion of [1, 2] as const) live(`W05c v${protocolVersion}: a busy turn survives rapid choices; the next actual prompt uses the last model and effort on the same process`, () => {
  const gate = join(rig.root, "finish-current");
  const echo = echoFile(rig);
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { protocolVersion, configOptions: options, strictConfigOptions: true, turns: [
    [{ step: "text", text: "current turn alive" }, { step: "wait_for_file", path: gate }, report], [report],
  ] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "current" })));
    yield* readEcho(echo, (value) => framesOf(value, "session/prompt").length === 1);
    const pid = peekEcho(echo)!.pid;
    const first = success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-large", effort: "high" }));
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-small", effort: "low" }));
    const last = success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-large", effort: "high" }));
    // Replaying an old receipt must not restore its old desired choice.
    success(yield* call(ownerCredential, "configure", { requestId: first.requestId, agentId: started.agentId, model: "model-large", effort: "high" }));
    expect(yield* configuration(started.agentId)).toMatchObject({ status: "pending", revision: last.requestId, applied: { model: "model-small", effort: "low" } });
    expect(framesOf(peekEcho(echo)!, "session/set_config_option").map((frame) => frame.params.configId)).toEqual(["mode"]);
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "next" }));
    writeFileSync(gate, "done");
    const seen = yield* eventually(reports(), (values) => values.length === 2);
    expect(seen.map((value) => [value.pid, axis(value, "model"), axis(value, "effort")])).toEqual([
      [pid, "model-small", "low"], [pid, "model-large", "high"],
    ]);
    const frames = peekEcho(echo)!.inbound.filter((frame) => ["session/prompt", "session/set_config_option", "session/cancel"].includes(frame.method ?? ""));
    expect(frames.map((frame) => frame.method === "session/prompt" ? "prompt" : `${frame.params.configId}:${frame.params.value}`)).toEqual([
      "mode:default", "prompt", "model:model-large", "effort:high", "prompt",
    ]);
    expect(yield* applied(started.agentId)).toMatchObject({ desired: { model: "model-large", effort: "high" }, applied: { model: "model-large", effort: "high" } });
  }));
});

live("W05c: the send lane holds a racing prompt until configuration acknowledgement; compaction uses the same reservation", () => {
  const gate = join(rig.root, "allow-config"), entered = join(rig.root, "in-config");
  const echo = echoFile(rig);
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { configOptions: options, configuration: { gate, entered }, turns: [[compactAdvertisement, report], [report]] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-large" }));
    yield* eventually(Effect.sync(() => existsSync(entered)), Boolean);
    const queued = success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "racing" }));
    expect(framesOf(peekEcho(echo)!, "session/prompt")).toHaveLength(0);
    expect(tagged(yield* readLog, "DeliverySent").find((event) => event.deliveryId === queued.deliveryId)).toBeUndefined();
    writeFileSync(gate, "ack");
    const observed = yield* eventually(reports(), (values) => values.length === 1);
    expect(axis(observed[0], "model")).toBe("model-large");
    yield* eventually(stateOf(started.agentId), (state) => state === "idle");
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, effort: "high" }));
    success(yield* call(ownerCredential, "compact", { agentId: started.agentId }));
    const compacted = yield* eventually(reports(), (values) => values.length === 2);
    expect(axis(compacted[1], "effort")).toBe("high");
    const wire = framesOf(peekEcho(echo)!, "session/prompt");
    expect(wire[1]!.params.prompt[0].text).toBe("/compact");
    expect(yield* applied(started.agentId)).toMatchObject({ applied: { model: "model-large", effort: "high" } });
  }));
});

for (const kind of ["refused", "unacknowledged", "unsupported"] as const) live(`W05c: ${kind} configuration is honest, keeps owner work queued, and accepts a corrected choice`, () => {
  const echo = echoFile(rig);
  const harness = harnessFor("first", writeFakeAdapter(rig), { models: ["model-small", "model-large"], efforts: ["low", "high"] });
  const account = accountFor("first", { configOptions: kind === "unsupported" ? [modeOption()] : options,
    configuration: kind === "refused" ? { refuseValues: ["model-large"] } : kind === "unacknowledged" ? { ignoreValues: ["model-large"] } : {},
    turns: [[report]],
  }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-large" }));
    const status = yield* eventually(configuration(started.agentId), (value) => value.status === "refused" || value.status === "unsupported");
    expect(status).toMatchObject({ status: kind === "unsupported" ? "unsupported" : "refused", desired: { model: "model-large" } });
    const queued = success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "keep this work" }));
    yield* Effect.sleep(100);
    expect(framesOf(peekEcho(echo)!, "session/prompt")).toHaveLength(0);
    expect((yield* (yield* Views).snapshot).deliveries[queued.deliveryId]?.status).toBe("queued");
    // An unsupported adapter can recover when its actual advertised options change.
    if (kind === "unsupported") return;
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-small" }));
    const seen = yield* eventually(reports(), (values) => values.length === 1);
    expect(axis(seen[0], "model")).toBe("model-small");
    expect((yield* (yield* Views).snapshot).deliveries[queued.deliveryId]?.status).toBe("accepted");
  }));
});

live("W05c: model-specific effort options are re-read after setting the model", () => {
  const echo = echoFile(rig);
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { configOptions: options, configuration: { optionsByModel: {
    "model-large": [modeOption(), modelOption("model-large"), effortOption("low")],
  } }, turns: [[report]] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-large", effort: "high" }));
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "work" }));
    const seen = yield* eventually(reports(), (values) => values.length === 1);
    expect([axis(seen[0], "model"), axis(seen[0], "effort")]).toEqual(["model-large", "high"]);
  }));
});

live("W05c: only owner credentials can configure or read composer data; labels are not model identifiers", () => {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { configOptions: options, turns: [] }, echoFile(rig));
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
    const sql = yield* SqlClient.SqlClient;
    // Read the real spawned agent credential from its controlled child environment.
    const context = yield* CommandHandler;
    const state = yield* context.input({ _tag: "owner" });
    const echo = Object.values(state.snapshot.accounts)[0]!;
    const child = peekEcho(echo.environment!.FAKE_AGENT_ECHO!)!;
    const agent = { _tag: "agent" as const, token: Redacted.make(child.env.LGCODE_TOKEN!) };
    for (const command of ["configure", "client.agent.configuration", "client.agent.context"]) {
      expect(ownerOnlyCommands).toContain(command);
      expect(toolNames).not.toContain(command);
      expect(failureOf(yield* call(agent, command, { agentId: started.agentId, model: "model-large" }))?._tag).toBe("CommandRefused");
      expect(failureOf(yield* call({ _tag: "agent", token: Redacted.make("invalid") }, command, { agentId: started.agentId }))?._tag).toBe("CommandRefused");
    }
    const bearer = "w05c-owner-credential-for-socket-test";
    yield* serve({ socketPath: rig.socket, ownerCredential: Redacted.make(bearer), debug: false });
    const ownerClient = yield* connect(rig.socket, bearer);
    const agentClient = yield* connect(rig.socket, child.env.LGCODE_TOKEN!);
    expect((yield* ownerClient["client.agent.configuration"]({ requestId: randomUUID() as any, agentId: started.agentId })).configuration.status).toBe("applied");
    for (const name of ["configure", "client.agent.configuration", "client.agent.context"] as const) {
      const result = yield* (agentClient[name] as (payload: any) => Effect.Effect<any, any>)({ requestId: randomUUID(), agentId: started.agentId, model: "model-large" }).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    }
    expect((yield* Effect.promise(() => upgradeStatus(rig.socket, {}))).status).toBe(401);
    const choices = yield* read("client.agent.configuration", started.agentId);
    expect(choices.models).toEqual({ source: "negotiated", options: [{ id: "model-small", label: "Small" }, { id: "model-large", label: "Large" }] });
    expect(failureOf(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "Large" }))?.reason).toContain("available");
    expect(failureOf(yield* call(ownerCredential, "configure", { agentId: started.agentId }))?._tag).toBe("CommandRefused");
    for (const value of ["x".repeat(257), "bad\nidentifier"]) {
      expect(failureOf(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { model: value })))?._tag).toBe("CommandRefused");
    }
    success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: { ...harness, defaultModel: "x".repeat(257) } }));
    expect(failureOf(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)))?._tag).toBe("CommandRefused");
    expect((yield* sql`SELECT sequence FROM events WHERE event_type = 'AgentConfigurationChosen'`)).toHaveLength(0);
  }));
});

live("W05c: stopped and failed-start agents retain desired settings; real retry and replay use them", () => {
  const echo = echoFile(rig);
  const harness = harnessFor("first", writeFakeAdapter(rig), { models: ["model-small", "model-large"], efforts: ["low", "high"] });
  const account = accountFor("first", { configOptions: options, strictConfigOptions: true, turns: [[report]] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { model: "model-large", effort: "high" })));
    success(yield* call(ownerCredential, "stop", { agentId: started.agentId }));
    const previousPid = peekEcho(echo)!.pid;
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-small", effort: "low" }));
    expect(yield* configuration(started.agentId)).toMatchObject({ status: "pending", desired: { model: "model-small", effort: "low" } });
    expect(yield* read("client.agent.context", started.agentId)).toHaveProperty("context", { _tag: "unavailable", reason: "not-live" });
    const snapshot = yield* (yield* Views).snapshot;
    expect((yield* rebuild(snapshot.sequence)).agents[started.agentId]?.configuration).toEqual(snapshot.agents[started.agentId]?.configuration);
    success(yield* call(ownerCredential, "resume", { agentId: started.agentId, fresh: true }));
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "retry" }));
    const seen = yield* eventually(reports(), (values) => values.length === 1);
    expect(seen[0].pid).not.toBe(previousPid);
    expect([axis(seen[0], "model"), axis(seen[0], "effort")]).toEqual(["model-small", "low"]);
    // Start failure is fixed by choosing a genuinely available model before retry.
    const badAccount = { ...account, id: "bad-start" as typeof account.id };
    success(yield* call(ownerCredential, "accounts", { operation: "add", account: badAccount }));
    success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: { ...harness, efforts: [] } }));
    const failed = success(yield* call(ownerCredential, "start", startPayloadFor(harness, badAccount, rig.work, { effort: "missing" })));
    expect(yield* stateOf(failed.agentId)).toBe("stopped");
    // A stopped failed start has no negotiation, so recorded valid choices are needed.
    success(yield* call(ownerCredential, "harnesses", { operation: "set", harness }));
    success(yield* call(ownerCredential, "configure", { agentId: failed.agentId, effort: "high", model: "model-large" }));
    success(yield* call(ownerCredential, "resume", { agentId: failed.agentId, fresh: true }));
    success(yield* call(ownerCredential, "prompt", { agentId: failed.agentId, text: "fixed start" }));
    const retried = yield* eventually(reports(), (values) => values.length === 2);
    expect([axis(retried[1], "model"), axis(retried[1], "effort")]).toEqual(["model-large", "high"]);
  }));
});

live("W05c: an unsolicited model report invalidates context and is reconciled before the next owner's prompt", () => {
  const echo = echoFile(rig), gate = join(rig.root, "unsolicited-done");
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { configOptions: options, turns: [[
    { step: "mode_change", configId: "model", value: "model-small" },
    { step: "wait_for_file", path: gate },
  ], [report]] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { model: "model-large" })));
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "drifting adapter" }));
    expect(yield* eventually(configuration(started.agentId), (value) => value.status === "pending")).toMatchObject({
      desired: { model: "model-large" }, applied: { model: "model-small" },
    });
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "reconcile choice" }));
    writeFileSync(gate, "done");
    const observed = yield* eventually(reports(), (values) => values.length === 1);
    expect(axis(observed[0], "model")).toBe("model-large");
  }));
});

live("W05c: a model change that removes the requested effort holds queued work and reports the actual partially applied model", () => {
  const echo = echoFile(rig);
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { configOptions: options, configuration: { optionsByModel: {
    "model-large": [modeOption(), modelOption("model-large")],
  } }, turns: [[report]] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-large", effort: "high" }));
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "do not silently downgrade" }));
    const observed = yield* eventually(configuration(started.agentId), (value) => value.status === "unsupported");
    expect(observed).toMatchObject({ desired: { model: "model-large", effort: "high" }, applied: { model: "model-large" } });
    expect(observed.applied).not.toHaveProperty("effort");
    expect(framesOf(peekEcho(echo)!, "session/prompt")).toHaveLength(0);
  }));
});

live("W05c Cursor: the existing auto start setting runs the actual first and next turns with its acknowledged protocol ID", () => {
  const echo = echoFile(rig);
  const harness = harnessFor("cursor", writeFakeAdapter(rig), { defaultModel: "auto", models: ["auto"] });
  const model = { configId: "model", name: "Model", category: "model", type: "select", currentValue: "expensive-model",
    options: [{ value: "default[]", name: "Auto" }, { value: "expensive-model", name: "Other" }] };
  const account = accountFor("cursor", { configOptions: [modeOption(), model, effortOption()], strictConfigOptions: true, turns: [[report], [report]] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "first auto turn" })));
    const first = yield* eventually(reports(), (values) => values.length === 1);
    expect(axis(first[0], "model")).toBe("default[]");
    expect(yield* configuration(started.agentId)).toMatchObject({ status: "applied", desired: { model: "auto" }, applied: { model: "default[]" } });
    yield* eventually(stateOf(started.agentId), (state) => state === "idle");
    // A live request must use an offered ID, rather than the start alias or label.
    for (const value of ["auto", "Auto"]) expect(failureOf(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: value }))?._tag).toBe("CommandRefused");
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, effort: "high" }));
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "next auto turn" }));
    const next = yield* eventually(reports(), (values) => values.length === 2);
    expect([next[1].pid, axis(next[1], "model"), axis(next[1], "effort")]).toEqual([first[0].pid, "default[]", "high"]);
    expect(framesOf(peekEcho(echo)!, "session/set_config_option").filter((frame) => frame.params.configId === "model").map((frame) => frame.params.value)).toEqual(["default[]"]);
    expect(yield* applied(started.agentId)).toMatchObject({ desired: { model: "auto", effort: "high" }, applied: { model: "default[]", effort: "high" } });
  }));
});

live("W05c: a timed-out configuration cannot arrive late after a newer acknowledgement and silently change a queued prompt", () => {
  const echo = echoFile(rig), gate = join(rig.root, "timed-out-config"), entered = join(rig.root, "timed-out-entered");
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { configOptions: options, configuration: { gate, entered }, turns: [[report]] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-large" }));
    const queued = success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "retain through timeout" }));
    yield* eventually(Effect.sync(() => existsSync(entered)), Boolean);
    // The production timeout is ten seconds. Do not replace it with a test-only branch.
    yield* Effect.sleep(10_200);
    expect(yield* configuration(started.agentId)).toMatchObject({ status: "unavailable", reason: "configuration-unknown" });
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-small" }));
    yield* eventually(configuration(started.agentId), (value) => value.status === "unavailable");
    writeFileSync(gate, "late completion");
    yield* Effect.sleep(100);
    expect(framesOf(peekEcho(echo)!, "session/prompt")).toHaveLength(0);
    expect((yield* (yield* Views).snapshot).deliveries[queued.deliveryId]?.status).toBe("queued");
    // Only the owner's explicit lifecycle action clears an uncertain process.
    success(yield* call(ownerCredential, "stop", { agentId: started.agentId }));
    success(yield* call(ownerCredential, "resume", { agentId: started.agentId, fresh: true }));
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "use corrected choice" }));
    const observed = yield* eventually(reports(), (values) => values.length === 1);
    expect(axis(observed[0], "model")).toBe("model-small");
  }));
});
