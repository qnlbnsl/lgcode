import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as SqlClient from "effect/sql/SqlClient";
import { makeRunnerRig, removeRunnerRig, harnessFor, accountFor, echoFile, writeFakeAdapter, withEngine, modeOption, modelOption, peekEcho, framesOf } from "../support/acpRunnerRig.ts";
import { call, ownerCredential, success } from "../support/handlerRig.ts";
import { eventually } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
let rig: ReturnType<typeof makeRunnerRig>;
afterEach(() => { vi.unstubAllEnvs(); if (rig) removeRunnerRig(rig); });
const read = (harnessId: string, extra: Record<string, unknown> = {}) => call(ownerCredential, "client.harness.choices", { harnessId, ...extra }).pipe(Effect.map(success));

for (const fail of [false, true]) it.live(`discovery removes Cursor sessions and its process identity after ${fail ? "failure" : "success"}`, () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("cursor", writeFakeAdapter(rig));
  const account = accountFor("cursor", { turns: [], configOptions: [modeOption(), modelOption()], ...(fail ? { sessionError: "Failure" } : {}) }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const result = yield* read("cursor");
    expect(result.models.options.length).toBe(fail ? 0 : 2);
    const sessions = join(rig.stateFolder, "cursor-sessions");
    expect(existsSync(sessions) ? readdirSync(sessions).filter((id) => id.startsWith("discovery-")) : []).toEqual([]);
    const sql = yield* SqlClient.SqlClient;
    expect(yield* sql`SELECT * FROM processes WHERE agent_id LIKE 'discovery-%'`).toEqual([]);
    expect(() => process.kill(peekEcho(echo)!.pid, 0)).toThrow();
  }));
});

it.live("discovery succeeds when the system temporary directory contains a symbolic link", () => {
  rig = makeRunnerRig();
  const target = join(rig.root, "canonical-tmp"), link = join(rig.root, "linked-tmp");
  mkdirSync(target); symlinkSync(target, link); vi.stubEnv("TMPDIR", link);
  const echo = echoFile(rig), harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [], configOptions: [modeOption(), modelOption()] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    expect((yield* read("first")).models.options).toHaveLength(2);
    expect(peekEcho(echo)!.cwd.startsWith(target + "/")).toBe(true);
    expect(existsSync(peekEcho(echo)!.cwd)).toBe(false);
  }));
});

it.live("a hang at initialize reaches the twenty-second deadline and cleans up before the reply", () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [], initializeGate: join(rig.root, "never-initialize") }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = Date.now();
    const result = yield* read("first");
    expect(result.reason).toBe("The harness did not report its models in time.");
    expect(Date.now() - started).toBeGreaterThanOrEqual(19_900);
    expect(Date.now() - started).toBeLessThan(25_000);
    const child = peekEcho(echo)!;
    expect(framesOf(child, "initialize")).toHaveLength(1);
    expect(framesOf(child, "session/new")).toHaveLength(0);
    expect(() => process.kill(child.pid, 0)).toThrow();
    expect(existsSync(child.cwd)).toBe(false);
    expect(yield* (yield* SqlClient.SqlClient)`SELECT * FROM processes WHERE agent_id LIKE 'discovery-%'`).toEqual([]);
  }));
}, 30_000);

it.live("cancelling initialize removes the Cursor session folder and process identity", () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("cursor", writeFakeAdapter(rig));
  const account = accountFor("cursor", { turns: [], initializeGate: join(rig.root, "never-initialize") }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const request = yield* read("cursor").pipe(Effect.forkScoped);
    yield* eventually(Effect.sync(() => peekEcho(echo)?.inbound.filter((frame) => frame.method === "initialize").length ?? 0), (n) => n === 1);
    const child = peekEcho(echo)!;
    yield* Fiber.interrupt(request);
    expect(() => process.kill(child.pid, 0)).toThrow();
    expect(existsSync(child.cwd)).toBe(false);
    expect(readdirSync(join(rig.stateFolder, "cursor-sessions"))).toEqual([]);
    expect(yield* (yield* SqlClient.SqlClient)`SELECT * FROM processes WHERE agent_id LIKE 'discovery-%'`).toEqual([]);
  }));
});

it.live("two requests for the same account share one negotiating process", () => {
  rig = makeRunnerRig();
  const echo = echoFile(rig), harness = harnessFor("first", writeFakeAdapter(rig));
  const gate = join(rig.root, "release"), entered = join(rig.root, "entered");
  const account = accountFor("first", { turns: [], configOptions: [modeOption(), modelOption()], configuration: { gate, entered } }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const first = yield* read("first", { model: "model-large" }).pipe(Effect.forkScoped);
    expect(yield* eventually(Effect.sync(() => existsSync(entered)), Boolean)).toBe(true);
    const child = peekEcho(echo)!;
    const second = yield* read("first", { model: "model-large" }).pipe(Effect.forkScoped);
    yield* Effect.sleep(100);
    expect(peekEcho(echo)!.pid).toBe(child.pid);
    expect((yield* (yield* SqlClient.SqlClient)`SELECT * FROM processes WHERE agent_id LIKE 'discovery-%'`)).toHaveLength(1);
    yield* Fiber.interrupt(first);
    expect(() => process.kill(child.pid, 0)).not.toThrow();
    yield* Effect.sync(() => writeFileSync(gate, "release"));
    expect((yield* Fiber.join(second)).models.options).toHaveLength(2);
    expect(() => process.kill(child.pid, 0)).toThrow();
    expect(existsSync(child.cwd)).toBe(false);
  }));
});
