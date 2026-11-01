import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  accountFor, deliveryFor, echoFile, harnessFor, makeRunnerRig, modeOption, removeRunnerRig,
  spawnFor, startPayloadFor, withAcpRunner, withEngine, writeFakeAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, pause, tagged } from "../support/routingRig.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
});
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
registerRebuildCheck({ noLog: true });
const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => body() as Effect.Effect<unknown, unknown, never>, 30_000);

live("6.2 hardening: a secret split across chunks is redacted before runner events and thread items", () => {
  const secret = "sk-planted-chunk-boundary-secret-0123456789";
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [[
    { step: "text", text: `before ${secret.slice(0, 17)}` },
    { step: "slow", ms: 40 },
    { step: "text", text: `${secret.slice(17)} after` },
  ]] }, echoFile(rig), { PLANTED_API_KEY: "secret:split-stream" });
  return withEngine(rig, { harness, accounts: [account], secrets: { "secret:split-stream": secret } }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
    const rows = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 1);
    const text = tagged(rows, "ThreadItem").flatMap((item) => item.content._tag === "text" ? [item.content.text] : []).join("");
    expect(text).toBe("before [REDACTED] after");
    const streamed = context.events.flatMap((event) => event._tag === "deliveryUpdate" && event.kind === "message" ? [event.text] : []).join("");
    expect(streamed).toBe(text);
    expect(JSON.stringify(rows)).not.toContain(secret);
  }));
});

live("6.2 hardening: a v2 acknowledgement before idle does not hide a later usage error", () =>
  withAcpRunner(rig, { classifyError: ({ text }) => text.includes("quota exhausted") ? "out-of-usage" : undefined }, (context) => Effect.gen(function* () {
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [[
      { step: "raw_frame", frame: '{"jsonrpc":"2.0","id":1,"result":{"messageId":"early-ack"}}' },
      { step: "slow", ms: 300 },
      { step: "out_of_usage", message: "quota exhausted", resetsAt: "2026-11-02T00:00:00Z" },
    ]] }, echoFile(rig));
    const spawn = yield* spawnFor(rig, harness, account);
    yield* context.runner.start(spawn.input);
    const delivery = deliveryFor(spawn.agentId, "go");
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
    yield* pause(80);
    expect(context.events.filter((event) => event._tag === "promptReply")).toHaveLength(0);
    const reply = yield* context.waitFor((event) => event._tag === "promptReply" && event.deliveryId === delivery.id);
    expect(reply).toMatchObject({ outcome: { _tag: "pause", reason: "out-of-usage" } });
    yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === delivery.id);
    expect(context.events.filter((event) => event._tag === "promptReply")).toHaveLength(1);
  })));

live("6.2 hardening: resolved spawn secrets remain protected across chunks when the service registry has not seen them yet", () => {
  const secret = "sk-new-spawn-secret-not-yet-in-service-registry-0123456789";
  const unrelatedRegistry = makeRedactor({ secrets: () => [], tokenHashes: () => new Set() });
  return withAcpRunner(rig, { secrets: { "secret:new": secret } }, (context) => Effect.gen(function* () {
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [[
      { step: "text", text: `before ${secret.slice(0, 19)}` },
      { step: "text", text: `${secret.slice(19)} after` },
    ]] }, echoFile(rig), { PLANTED_API_KEY: "secret:new" });
    const spawn = yield* spawnFor(rig, harness, account);
    yield* context.runner.start(spawn.input);
    const delivery = deliveryFor(spawn.agentId, "go");
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
    yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === delivery.id);
    const text = context.events.flatMap((event) => event._tag === "deliveryUpdate" && event.kind === "message" ? [event.text] : []).join("");
    expect(text).toBe("before [REDACTED] after");
  })).pipe(Effect.provide(unrelatedRegistry.layer));
});

live("6.1 hardening: a naturally exited process releases its identity before the agent starts again", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const first = yield* spawnFor(rig, harness, accountFor("first", { turns: [[{ step: "crash", exitCode: 3 }]] }, echoFile(rig)));
    yield* context.runner.start(first.input);
    yield* context.runner.prompt({ agentId: first.agentId, incarnation: first.incarnation, delivery: deliveryFor(first.agentId, "go") });
    yield* context.waitFor((event) => event._tag === "exited" && event.agentId === first.agentId);
    const second = yield* spawnFor(rig, harness, accountFor("first", { turns: [] }, echoFile(rig)), { agentId: first.agentId });
    expect((yield* context.runner.start(second.input)).session._tag).toBe("acp");
    expect((yield* context.runner.prompt({ agentId: first.agentId, incarnation: first.incarnation, delivery: deliveryFor(first.agentId, "stale") }).pipe(Effect.result))._tag).toBe("Failure");
  })));

live("6.3 hardening: a permission path through a symlink into harness settings is owner-routed", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    mkdirSync(join(rig.work, ".claude"));
    const settings = join(rig.work, ".claude", "settings.local.json");
    writeFileSync(settings, "{}");
    const link = join(rig.work, "ordinary.json");
    symlinkSync(settings, link);
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [[{ step: "permission", toolCallId: "tool-symlink", title: "Edit", locations: [{ path: link }],
      options: [{ optionId: "once", name: "Yes", kind: "allow_once" }] }]] }, echoFile(rig));
    const spawn = yield* spawnFor(rig, harness, account);
    yield* context.runner.start(spawn.input);
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery: deliveryFor(spawn.agentId, "go") });
    expect(yield* context.waitFor((event) => event._tag === "permissionRequested")).toMatchObject({ settingsWrite: true });
  })));

live("6.13 hardening: a failed ceiling set-back terminates the process rather than leaving its elevated mode running", () => {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const raised = { ...modeOption("full-access"), options: [{ value: "full-access", name: "Full access" }] };
  const account = accountFor("first", { strictConfigOptions: true, turns: [[
    { step: "config_options", configOptions: [raised] }, { step: "slow", ms: 1000 },
  ]] }, echoFile(rig));
  return withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
    const rows = yield* eventually(readLog, (rows) => tagged(rows, "AgentCrashed").length === 1);
    expect(tagged(rows, "ModeRefused")).toHaveLength(1);
    expect(tagged(rows, "AgentCrashed")).toHaveLength(1);
    expect(context.logLines.some((line) => line.includes("mode set-back failed"))).toBe(true);
  }));
});
