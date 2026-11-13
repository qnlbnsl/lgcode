import { existsSync } from "node:fs";
import { join } from "node:path";
import * as Fiber from "effect/Fiber";
import { eventually } from "../support/routingRig.ts";
import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { makeRunnerRig, removeRunnerRig, harnessFor, accountFor, echoFile, writeFakeAdapter, withEngine, modeOption, peekEcho, framesOf } from "../support/acpRunnerRig.ts";
import { appendSetup, eventOf, call, ownerCredential, seedAgent, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

let rig: ReturnType<typeof makeRunnerRig>;
afterEach(() => { if (rig) removeRunnerRig(rig); });
const choices = [{ ...modeOption() }, { configId: "model", type: "select", category: "model", name: "Model", currentValue: "reported-model", options: [{ value: "reported-model", name: "Reported model" }] }, { configId: "effort", type: "select", category: "thought_level", name: "Effort", currentValue: "high", options: [{ value: "high", name: "High" }] }];
const read = (payload: Record<string, unknown> = {}) => call(ownerCredential, "client.harness.choices", { harnessId: "first", ...payload }).pipe(Effect.map(success));
const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) => it.live(name, () => body() as Effect.Effect<void, unknown, never>, 30_000);

for (const protocolVersion of [1, 2]) live(`harness discovery v${protocolVersion}: returns reported models before any agent exists, remembers them per account, and ends the child before replying`, () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { protocolVersion, configOptions: choices, turns: [] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const result = yield* read();
    expect(result.models.options).toEqual([{ id: "reported-model", label: "Reported model" }]);
    expect(result.efforts.options).toEqual([{ id: "high", label: "High" }]);
    expect(result.accountId).toBe(account.id);
    const child = peekEcho(echo)!;
    expect(framesOf(child, "session/new")).toHaveLength(1);
    expect(framesOf(child, "session/prompt")).toHaveLength(0);
    expect(() => process.kill(child.pid, 0)).toThrow();
    expect(success(yield* call(ownerCredential, "client.roster", {})).agents).toHaveLength(0);
    expect((yield* read()).models).toEqual(result.models);
    expect(peekEcho(echo)!.pid).toBe(child.pid);
    const other = accountFor("first", { configOptions: choices.map((o) => o.category === "model" ? { ...o, currentValue: "other-model", options: [{ value: "other-model", name: "Other model" }] } : o), turns: [] }, echoFile(rig), {}, "other");
    yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: other.id, account: other })]);
    expect((yield* read({ accountId: other.id })).models.options[0].id).toBe("other-model");
    expect((yield* read({ accountId: account.id })).models.options[0].id).toBe("reported-model");
    expect((yield* read({ accountId: account.id, refresh: true })).models.options[0].id).toBe("reported-model");
    expect(peekEcho(echo)!.pid).not.toBe(child.pid);
    expect(() => process.kill(peekEcho(echo)!.pid, 0)).toThrow();
  }));
});

live("harness discovery: no account, disabled account and missing adapter give plain reasons without configured fallback", () => {
  rig = makeRunnerRig();
  const harness = harnessFor("first", writeFakeAdapter(rig), { models: ["never-invent-this"] });
  return withEngine(rig, { harness, accounts: [] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    expect(yield* read()).toMatchObject({ models: { options: [] }, reason: "No account is registered for this harness." });
    const account = accountFor("first", {}, echoFile(rig));
    yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: account.id, account: { ...account, enabled: false } })]);
    expect((yield* read()).reason).toBe("No enabled account is registered for this harness.");
    yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: account.id, account })]);
    yield* appendSetup([eventOf({ _tag: "HarnessChanged", harness: { ...harness, adapterPath: "/missing-adapter" } })]);
    expect(yield* read()).toMatchObject({ models: { options: [] }, reason: "The harness is not installed." });
    expect((yield* read({ harnessId: "missing" })).reason).toBe("The harness is not installed.");
  }));
});

live("harness discovery: signed-out and unreported sessions return no invented choices and do not leave a child", () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [], sessionError: "Authentication required" }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    expect(yield* read()).toMatchObject({ models: { options: [] }, reason: "Sign in to this harness account to see its models." });
    const signedOutPid = peekEcho(echo)!.pid;
    expect((yield* read()).reason).toBe("Sign in to this harness account to see its models.");
    expect(peekEcho(echo)!.pid).toBe(signedOutPid);
    expect(() => process.kill(peekEcho(echo)!.pid, 0)).toThrow();
    const changed = accountFor("first", { turns: [] }, echo);
    yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: changed.id, account: changed })]);
    expect(yield* read()).toMatchObject({ models: { options: [] }, efforts: { options: [] }, reason: "This harness did not report model choices.", effortReason: "This harness did not report effort choices." });
    expect(() => process.kill(peekEcho(echo)!.pid, 0)).toThrow();
  }));
});

live("harness discovery: cancelling a request closes its negotiating child and removes its temporary folder", () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("first", writeFakeAdapter(rig));
  const gate = join(rig.root, "allow-config"), entered = join(rig.root, "entered-config");
  const account = accountFor("first", { turns: [], configOptions: choices, configuration: { gate, entered } }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const request = yield* read({ model: "reported-model" }).pipe(Effect.forkScoped);
    expect(yield* eventually(Effect.sync(() => existsSync(entered)), Boolean)).toBe(true);
    const child = peekEcho(echo)!;
    expect(() => process.kill(child.pid, 0)).not.toThrow();
    yield* Fiber.interrupt(request);
    expect(() => process.kill(child.pid, 0)).toThrow();
    expect(existsSync(child.cwd)).toBe(false);
  }));
});

live("harness discovery: legacy session models are real choices even when there is no model config selector, and no effort is invented", () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { protocolVersion: 1, turns: [], legacyModels: { currentModelId: "legacy-reported", availableModels: [{ modelId: "legacy-reported", name: "Legacy reported" }] } }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    expect(yield* read()).toMatchObject({ models: { source: "negotiated", options: [{ id: "legacy-reported", label: "Legacy reported" }] }, efforts: { options: [] }, effortReason: "This harness did not report effort choices." });
    expect(() => process.kill(peekEcho(echo)!.pid, 0)).toThrow();
  }));
});

live("harness discovery: effort choices follow the requested reported model and caches do not mix models", () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("first", writeFakeAdapter(rig));
  const models = { configId: "model", type: "select", category: "model", name: "Model", currentValue: "small", options: [{ value: "small", name: "Small" }, { value: "large", name: "Large" }] };
  const effort = (id: string) => ({ configId: "effort", type: "select", category: "thought_level", name: "Effort", currentValue: id, options: [{ value: id, name: id }] });
  const account = accountFor("first", { turns: [], configOptions: [modeOption(), models, effort("low")], configuration: { optionsByModel: { large: [modeOption(), { ...models, currentValue: "large" }, effort("high")] } } }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    expect((yield* read()).efforts.options.map((o: any) => o.id)).toEqual(["low"]);
    expect((yield* read({ model: "large" })).efforts.options.map((o: any) => o.id)).toEqual(["high"]);
    expect((yield* read()).efforts.options.map((o: any) => o.id)).toEqual(["low"]);
  }));
});

live("harness discovery: a stopped agent can read and save its account's reported configuration without restarting the owner's agent", () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [], configOptions: choices }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker", name: "Worker", state: "stopped", folder: rig.work });
    // The saved old model need not be in today's report.
    const current = success(yield* call(ownerCredential, "client.agent.configuration", { agentId: "worker" }));
    expect(current.models.options).toEqual([{ id: "reported-model", label: "Reported model" }]);
    success(yield* call(ownerCredential, "configure", { agentId: "worker", model: "reported-model", effort: "high" }));
    const updated = success(yield* call(ownerCredential, "client.agent.configuration", { agentId: "worker" }));
    expect(updated.configuration.desired).toEqual({ model: "reported-model", effort: "high" });
    expect(framesOf(peekEcho(echo)!, "session/prompt")).toHaveLength(0);
    expect(() => process.kill(peekEcho(echo)!.pid, 0)).toThrow();
    expect(success(yield* call(ownerCredential, "client.roster", {})).agents).toHaveLength(1);
  }));
});

live("harness discovery: a session failure gives one plain sentence and closes its child", () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [], sessionError: "controlled session failure" }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    expect(yield* read()).toMatchObject({ models: { options: [] }, reason: "The harness could not report its models on this account." });
    expect(() => process.kill(peekEcho(echo)!.pid, 0)).toThrow();
  }));
});
