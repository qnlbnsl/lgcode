import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, deliveryFor, echoFile, framesOf, harnessFor, makeRunnerRig, readEcho, removeRunnerRig, spawnFor,
  withAcpRunner, writeFakeAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// Criterion 6.12 (task 6a.1; rows 33, 34; SECURITY.md): the engine
// advertises no file or terminal capability, and `fs/*` and `terminal/*`
// requests from the adapter are refused. Agents read and write files only
// through their own harness's sandbox, never through Sheprd.

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPRD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps a missing
// module from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);

// Every key at any depth of the initialize parameters whose value turns a
// file or terminal capability on.
const grantedCapabilities = (value: unknown, path: ReadonlyArray<string> = []): ReadonlyArray<string> => {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const here = [...path, key];
    const named = /^(fs|terminal|readTextFile|writeTextFile|terminals?)$/i.test(key);
    if (named && item !== false && item !== undefined && item !== null) return [here.join(".")];
    return grantedCapabilities(item, here);
  });
};

live("6.12 initialize offers no file or terminal capability, in either the version 2 or the version 1 field (breaks if the runner copies T3's client capabilities or turns on fs or terminal)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", { turns: [] }, echo));
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo, (current) => framesOf(current, "initialize").length === 1);
    const params = framesOf(seen, "initialize")[0]!.params;
    expect(grantedCapabilities(params)).toEqual([]);
    expect(JSON.stringify(params)).not.toMatch(/readTextFile|writeTextFile|"terminal"\s*:\s*true/);
  })));

live("6.12 fs and terminal requests are refused: reads, writes and terminal calls fail, nothing is written, no planted file text reaches the agent, and the turn still ends (breaks if the runner serves any fs/* or terminal/* method, or a refusal ends the agent's turn or process)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const planted = join(rig.work, "planted.txt");
    writeFileSync(planted, "planted-file-text-6f2b");
    const target = join(rig.work, "written-by-adapter.txt");
    const methods = [
      { method: "fs/read_text_file", params: { sessionId: "${session}", path: planted } },
      { method: "fs/write_text_file", params: { sessionId: "${session}", path: target, content: "should not exist" } },
      { method: "terminal/create", params: { sessionId: "${session}", command: "/bin/sh", args: ["-c", `echo created > ${join(rig.work, "terminal-ran.txt")}`] } },
      { method: "terminal/output", params: { sessionId: "${session}", terminalId: "t-1" } },
      { method: "terminal/wait_for_exit", params: { sessionId: "${session}", terminalId: "t-1" } },
      { method: "terminal/kill", params: { sessionId: "${session}", terminalId: "t-1" } },
      { method: "terminal/release", params: { sessionId: "${session}", terminalId: "t-1" } },
    ];
    const echo = echoFile(rig);
    const turn = [...methods.map((entry) => ({ step: "client_request", ...entry })), { step: "text", text: "turn finished" }];
    const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", { turns: [turn] }, echo));
    yield* context.runner.start(spawn.input);
    const delivery = deliveryFor(spawn.agentId, "go");
    const before = context.events.length;
    yield* context.runner.prompt({ sentSequence: 1, agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
    yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === delivery.id, before);
    const texts = context.eventsAfter(before).flatMap((event) => event._tag === "deliveryUpdate" ? [event.text] : []);
    for (const { method } of methods) {
      const report = texts.find((text) => text.startsWith(`client_request:${method}:`));
      expect(report, method).toMatch(new RegExp(`^client_request:${method}:error:`));
    }
    expect(texts).toContain("turn finished");
    expect(texts.join("\n")).not.toContain("planted-file-text-6f2b");
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(rig.work, "terminal-ran.txt"))).toBe(false);
  })));
