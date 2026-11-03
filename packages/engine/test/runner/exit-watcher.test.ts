import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  accountFor, deliveryFor, echoFile, harnessFor, makeRunnerRig, processGroupOf, readEcho, removeRunnerRig,
  spawnFor, startPayloadFor, withAcpRunner, withEngine, writeFakeAdapter, type Echo, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, pause, tagged } from "../support/routingRig.ts";

// Unit 6c fix round 1, findings F-1 and F-2 of the focused review of f07a721.
//
// F-1: a helper the adapter starts in its own session, outside the adapter's
// process group, that inherits stderr, keeps the stderr pipe open after the
// adapter dies. The exit watcher must still emit `exited` (and the engine
// must still record the crash and revoke the token) within a bound.
//
// F-2 (plan check PB-A1): a child in the adapter's process group, which is a
// group of its own, apart from the engine's, is gone after the agent is
// stopped through the runner and after the adapter exits by itself.
//
// Every process these tests start is stopped in their own cleanup: the helper
// by the pid the fake agent recorded, the adapter's group by the rig.

let rig: RunnerRig;
const helpers = new Set<number>();
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});
afterEach(() => {
  // The helper is in a session of its own, so removing the rig does not reach it.
  for (const pid of helpers) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  helpers.clear();
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});
registerRebuildCheck({ noLog: true });
const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => body() as Effect.Effect<unknown, unknown, never>, 30_000);

type Extended = Echo & { readonly helperPids?: ReadonlyArray<number>; readonly grandchildPids?: ReadonlyArray<number> };
const withPids = (file: string, field: "helperPids" | "grandchildPids") =>
  readEcho(file, (echo) => ((echo as Extended)[field]?.length ?? 0) >= 1).pipe(Effect.map((echo) => ({ echo, pids: (echo as Extended)[field] ?? [] })));

// The pids in the group, as `ps` lists them, for the evidence of check PB-A1.
const psOfGroup = (groupId: number): string => {
  const lines = execFileSync("ps", ["-eo", "pid,pgid,sid,comm"], { encoding: "utf8" }).split("\n");
  return [lines[0], ...lines.slice(1).filter((line) => Number(line.trim().split(/\s+/)[1]) === groupId)].join("\n");
};
const gone = (pid: number): boolean => { try { process.kill(pid, 0); return false; } catch { return true; } };
const goneSoon = (pid: number) => Effect.gen(function* () {
  for (let attempt = 0; attempt < 300 && !gone(pid); attempt++) yield* pause(10);
  return gone(pid);
});

// ---------------------------------------------------------------------------
// F-1
// ---------------------------------------------------------------------------

live("6.6 F-1 a detached helper that holds stderr open does not keep the runner from reporting the exit: `exited` arrives within 5 seconds, with the tail the adapter wrote (breaks if the exit watcher joins the stderr reader without a bound)", () => {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const echo = echoFile(rig);
  const account = accountFor("first", { turns: [[
    { step: "stderr", text: "adapter diagnostic before dying" }, { step: "spawn_detached_helper" }, { step: "crash", exitCode: 3 },
  ]] }, echo);
  return withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const spawn = yield* spawnFor(rig, harness, account);
    yield* context.runner.start(spawn.input);
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery: deliveryFor(spawn.agentId, "go") });
    const { pids } = yield* withPids(echo, "helperPids");
    for (const pid of pids) helpers.add(pid);
    // The helper is its own session leader, outside the adapter's group, and it is still running.
    expect(pids).toHaveLength(1);
    expect(gone(pids[0]!)).toBe(false);
    expect(processGroupOf(pids[0]!)).toBe(pids[0]);
    const exited = yield* context.waitFor((event) => event._tag === "exited" && event.agentId === spawn.agentId).pipe(
      Effect.timeoutOption("5 seconds"),
    );
    if (Option.isNone(exited)) return yield* Effect.die(new Error("No `exited` event within 5 seconds of the adapter dying while a detached helper held stderr open"));
    expect(exited.value).toMatchObject({ exitCode: 3, signal: null });
    expect((exited.value as { stderr: string }).stderr).toContain("adapter diagnostic before dying");
    // The helper was not ours to stop through the group; the runner must not have needed it gone.
    expect(gone(pids[0]!)).toBe(false);
  }));
});

live("6.6 F-1 through the command handler: with a detached helper holding stderr open, the crash is recorded within 5 seconds of the exit, the stderr stored is redacted, and the dead agent's token is revoked (breaks if the exit is never reported, so no crash is written and the token stays valid)", () => {
  const secret = "sk-planted-helper-secret-0123456789abcdef";
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const echo = echoFile(rig);
  // The secret is written in two parts with a pause between, so the stderr
  // tail must complete the redaction with what the reader has when it stops.
  const account = accountFor("first", { turns: [[
    { step: "stderr_part", text: `fatal: key ${secret.slice(0, 15)}` }, { step: "slow", ms: 80 },
    { step: "stderr_part", text: `${secret.slice(15)} refused\n` },
    { step: "spawn_detached_helper" }, { step: "crash", exitCode: 2 },
  ]] }, echo, { PLANTED_API_KEY: "secret:helper" });
  return withEngine(rig, { harness, accounts: [account], secrets: { "secret:helper": secret } }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
    const { pids } = yield* withPids(echo, "helperPids");
    for (const pid of pids) helpers.add(pid);
    expect(pids).toHaveLength(1);
    const crashed = yield* eventually(readLog, (rows) => tagged(rows, "AgentCrashed").length === 1).pipe(
      Effect.timeoutOption("5 seconds"),
    );
    // `eventually` waits about four seconds and returns what it saw.
    const rows = Option.getOrElse(crashed, () => []);
    const crash = tagged(rows, "AgentCrashed").find((event) => event.agentId === reply.agentId);
    if (crash === undefined) return yield* Effect.die(new Error("No AgentCrashed event within 5 seconds while a detached helper held stderr open"));
    expect(crash).toMatchObject({ exitCode: 2, signal: null });
    expect(crash.stderr).toContain("fatal: key [REDACTED] refused");
    // The account's script is logged as configuration and holds both halves as text the test chose,
    // so the half-secret scan leaves out the account and harness rows; the whole secret is checked everywhere.
    expect(JSON.stringify([rows, context.logLines])).not.toContain(secret);
    const scanned = JSON.stringify([rows.filter((row) => row.event._tag !== "AccountChanged" && row.event._tag !== "HarnessChanged"), context.logLines]);
    expect(scanned).not.toContain(secret.slice(0, 15));
    expect(scanned).not.toContain(secret.slice(15));
    // The dead agent's token no longer works: none of its tokens is left unrevoked.
    const sql = yield* SqlClient.SqlClient;
    const live = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM agent_tokens WHERE agent_id = ${reply.agentId as string} AND revoked_at IS NULL`;
    expect(live[0]?.n).toBe(0);
    const exited = context.events.find((event) => event._tag === "exited" && event.agentId === reply.agentId);
    expect(exited).toBeDefined();
  }));
});

// ---------------------------------------------------------------------------
// F-2
// ---------------------------------------------------------------------------

// The test setup silences the console, so the evidence goes to the file named by PB_A1_EVIDENCE, when set.
const groupEvidence = (label: string, groupId: number, when: "before" | "after") => {
  const path = process.env.PB_A1_EVIDENCE;
  if (path !== undefined) appendFileSync(path, `PB-A1 ${label} ${when} (group ${groupId}):\n${psOfGroup(groupId)}\n\n`);
};

live("6.1 F-2 (PB-A1) a child in the adapter's own process group is gone after the agent is stopped through the runner (breaks if stop signals only the adapter's pid, or leaves the group alive)", () => {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const echo = echoFile(rig);
  const account = accountFor("first", { turns: [[{ step: "spawn_grandchild" }, { step: "slow", ms: 30_000 }]] }, echo);
  return withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const spawn = yield* spawnFor(rig, harness, account);
    yield* context.runner.start(spawn.input);
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery: deliveryFor(spawn.agentId, "go") });
    const { echo: written, pids } = yield* withPids(echo, "grandchildPids");
    const child = pids[0]!;
    expect(gone(child)).toBe(false);
    // The child shares the adapter's group, which is the adapter's own pid and not the engine's group.
    expect(processGroupOf(child)).toBe(written.pid);
    expect(processGroupOf(child)).not.toBe(processGroupOf(process.pid));
    groupEvidence("stop", written.pid, "before");
    yield* context.runner.stop({ agentId: spawn.agentId });
    expect(yield* goneSoon(child)).toBe(true);
    expect(gone(written.pid)).toBe(true);
    groupEvidence("stop", written.pid, "after");
  }));
});

live("6.1 F-2 (PB-A1) a child in the adapter's own process group is gone after the adapter exits by itself, and the exit is reported (breaks if the exit watcher leaves the group's other members running)", () => {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const echo = echoFile(rig);
  const account = accountFor("first", { turns: [[{ step: "spawn_grandchild" }, { step: "slow", ms: 1500 }, { step: "crash", exitCode: 4 }]] }, echo);
  return withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const spawn = yield* spawnFor(rig, harness, account);
    yield* context.runner.start(spawn.input);
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery: deliveryFor(spawn.agentId, "go") });
    const { echo: written, pids } = yield* withPids(echo, "grandchildPids");
    const child = pids[0]!;
    expect(gone(child)).toBe(false);
    expect(processGroupOf(child)).toBe(written.pid);
    expect(processGroupOf(child)).not.toBe(processGroupOf(process.pid));
    groupEvidence("crash", written.pid, "before");
    const exited = yield* context.waitFor((event) => event._tag === "exited" && event.agentId === spawn.agentId);
    expect(exited).toMatchObject({ exitCode: 4 });
    expect(yield* goneSoon(child)).toBe(true);
    groupEvidence("crash", written.pid, "after");
  }));
});
