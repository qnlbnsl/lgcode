import { existsSync, mkdirSync, realpathSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, alive, allowListed, echoFile, framesOf, harnessFor, makeRunnerRig, mcpScriptPath, modelOption, modeOption, peekEcho, processGroupOf, readEcho,
  removeRunnerRig, serviceEnvironment, spawnFor, startPayloadFor, withAcpRunner, withEngine, writeFakeAdapter,
  type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";

// Criterion 6.1 (task 6a.1; rows 18, 22, 33, 39, 57, 60; issue 64): starting
// an agent spawns its adapter from the harness's absolute path, at its stored
// real folder, in a new process group, with exactly the allow-listed
// environment plus the account's variables and exactly `SHEPHRD_SOCKET` and
// `SHEPHRD_TOKEN`. Except for Codex (issue 236, shephrd-server.test.ts),
// `session/new` gets the `shephrd mcp` server with `process.execPath` and
// an absolute script path. The session id and negotiated version are recorded.
//
// The child is the fake agent, which writes what it was started with to its
// echo file (support/acpRunnerRig.ts). Each test name says which production
// change makes it fail.

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

const plantedSecret = "sk-ant-api03-PLANTEDSTARTSECRET0123456789abcdef";

// Every requirement is provided inside the test; the cast keeps a missing
// module from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);

registerRebuildCheck({ noLog: true });

live("6.1 environment: the child gets exactly the allow-list, the account's variables with secrets resolved, and the runner's own SHEPHRD_SOCKET and SHEPHRD_TOKEN (breaks if the runner extends process.env, passes HERDR_* or a SHEPHRD_* wildcard, lets an account override the socket, or passes a secret reference unresolved)", () =>
  withAcpRunner(rig, { secrets: { "secret:planted-key": plantedSecret } }, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [] }, echo, {
      PLANTED_API_KEY: "secret:planted-key", PLAIN_SETTING: "plain value", HERDR_ENV: "account-herdr", SHEPHRD_SOCKET: "/tmp/account-forged.sock",
    });
    const spawn = yield* spawnFor(rig, harness, account);
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo);
    const service = serviceEnvironment(rig);
    const expected: Record<string, string> = {};
    for (const name of allowListed) expected[name] = service[name]!;
    Object.assign(expected, {
      FAKE_AGENT_SCRIPT: account.environment!.FAKE_AGENT_SCRIPT, FAKE_AGENT_ECHO: echo,
      PLANTED_API_KEY: plantedSecret, PLAIN_SETTING: "plain value",
      SHEPHRD_SOCKET: rig.socket, SHEPHRD_TOKEN: spawn.token,
    });
    expect(seen.env).toEqual(expected);
    expect(Object.keys(seen.env).filter((name) => name.startsWith("HERDR_"))).toEqual([]);
  })));

live("6.1 spawn: the adapter runs from the harness's absolute path with its arguments, at the stored real folder, as the leader of a new process group (breaks if the runner resolves the command on PATH, spawns at the requested spelling or the service's folder, or leaves the child in the service's group)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const real = join(rig.work, "real-folder");
    mkdirSync(real);
    const link = join(rig.work, "linked-folder");
    symlinkSync(real, link);
    const echo = echoFile(rig);
    const adapterPath = writeFakeAdapter(rig);
    const harness = harnessFor("first", adapterPath);
    const spawn = yield* spawnFor(rig, harness, accountFor("first", { turns: [] }, echo), { folder: link });
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo, (current) => framesOf(current, "session/new").length > 0);
    expect(seen.argv[1]).toBe(adapterPath);
    expect(seen.argv.slice(2)).toEqual(harness.adapterArguments);
    expect(seen.cwd).toBe(realpathSync(real));
    expect(framesOf(seen, "session/new")[0]!.params.cwd).toBe(realpathSync(real));
    if (process.platform === "linux") {
      expect(processGroupOf(seen.pid)).toBe(seen.pid);
      expect(processGroupOf(seen.pid)).not.toBe(processGroupOf(process.pid));
    }
  })));

live("6.1 adapter path: a stored adapter path containing /../ is refused at start and nothing is spawned, per row 39 (breaks if the runner spawns a path that was not resolved when the harness was stored)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    writeFakeAdapter(rig);
    const harness = harnessFor("first", `${rig.bin}/../bin/fake-adapter`);
    const spawn = yield* spawnFor(rig, harness, accountFor("first", { turns: [] }, echo));
    const result = yield* runner.start(spawn.input).pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("RunnerRejected");
      expect(result.failure.reason.length).toBeGreaterThan(0);
    }
    expect(existsSync(echo), "the fake agent wrote its echo file, so the unresolved path was spawned").toBe(false);
  })));

live("6.1 tool server: session/new gets one stdio server that runs process.execPath on the absolute path of packages/cli/src/bin.ts with `mcp`, and no argument carries the token (breaks if the runner sends no mcpServers, uses `node` or `shephrd` from PATH, a relative script, or puts the token in the arguments)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", { turns: [] }, echo));
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo, (current) => framesOf(current, "session/new").length > 0);
    const servers = framesOf(seen, "session/new")[0]!.params.mcpServers as ReadonlyArray<{
      name: string; command: string; args?: ReadonlyArray<string>; env?: ReadonlyArray<{ name: string; value: string }>;
    }>;
    expect(servers).toHaveLength(1);
    expect(servers[0]!.command).toBe(process.execPath);
    expect(servers[0]!.args).toEqual([mcpScriptPath, "mcp"]);
    expect(JSON.stringify(servers[0]!.args)).not.toContain(spawn.token);
    for (const variable of servers[0]!.env ?? []) expect(["SHEPHRD_SOCKET", "SHEPHRD_TOKEN"]).toContain(variable.name);
  })));

live("6.1 session: start returns the adapter's session id and the negotiated protocol version, for version 2 and for a version 1 adapter that advertises loadSession (breaks if the runner reports the version it offered, or a session id of its own)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const adapter = writeFakeAdapter(rig);
    const two = yield* spawnFor(rig, harnessFor("first", adapter), accountFor("first", { turns: [] }, echoFile(rig)));
    const opened = yield* runner.start(two.input);
    expect(opened.session).toEqual({ _tag: "acp", sessionId: "fake-session-1" });
    expect(opened.protocolVersion).toBe(2);
    const one = yield* spawnFor(rig, harnessFor("first", adapter), accountFor("first", { protocolVersion: 1, turns: [] }, echoFile(rig)));
    const older = yield* runner.start(one.input);
    expect(older.protocolVersion).toBe(1);
    expect(older.reloadable).toBe(true);
  })));

live("6.1 issue 64: a start through the engine writes SessionOpened with the runner's session reference, protocol version and reloadable flag, and the agent becomes idle (breaks if start.ts discards the SessionInfo the runner returns)", () =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [] }, echo);
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
      const rows = yield* eventually(readLog, (current) => tagged(current, "SessionOpened").length > 0);
      const opened = tagged(rows, "SessionOpened");
      expect(opened).toHaveLength(1);
      expect(opened[0]!.agentId).toBe(reply.agentId);
      expect(opened[0]!.session).toEqual({ _tag: "acp", sessionId: "fake-session-1" });
      expect(opened[0]!.protocolVersion).toBe(2);
      expect(typeof opened[0]!.reloadable).toBe("boolean");
      expect(tagged(rows, "AgentStartFailed")).toEqual([]);
    }));
  }));

live("6.1 issue 49: the runner re-checks the folder grant at spawn, so a folder replaced after the check is refused and no adapter runs in the replacement (breaks if the runner spawns at the folder string without folderForSpawn)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const folder = join(rig.work, "granted");
    mkdirSync(folder);
    const echo = echoFile(rig);
    const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", { turns: [] }, echo), { folder });
    renameSync(folder, join(rig.work, "granted-original"));
    mkdirSync(folder);
    const result = yield* runner.start(spawn.input).pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure._tag).toBe("RunnerRejected");
    const seen = peekEcho(echo);
    if (seen !== undefined) {
      // Spawned and then stopped on the /proc/<pid>/cwd check: it never got a session.
      expect(framesOf(seen, "session/new")).toEqual([]);
      const gone = yield* eventually(Effect.sync(() => alive(seen.pid)), (running) => !running);
      expect(gone).toBe(false);
    }
  })));

live("6.1 issue 62 token table: stop, a crash and a rejected start each write exactly their own event, revoke every token of the agent and leave no adapter running (breaks if any path leaves a live token, writes a crash for a stop, or keeps the child)", () =>
  Effect.gen(function* () {
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const echoes = { stop: echoFile(rig), crash: echoFile(rig), "rejected start": echoFile(rig) };
    const accounts = {
      stop: accountFor("first", { turns: [] }, echoes.stop, {}, "stopper"),
      crash: accountFor("first", { turns: [[{ step: "crash", exitCode: 3 }]] }, echoes.crash, {}, "crasher"),
      "rejected start": accountFor("first", { configOptions: [modeOption(), modelOption()], strictConfigOptions: true, turns: [] }, echoes["rejected start"], {}, "rejecter"),
    };
    return yield* withEngine(rig, { harness, accounts: Object.values(accounts) }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const sql = yield* SqlClient.SqlClient;
      const lifecycle = ["SessionOpened", "AgentStopped", "AgentCrashed", "AgentStartFailed"] as const;
      const row = (agentId: string, opened: boolean) => Effect.gen(function* () {
        const rows = (yield* readLog).filter((entry) => "agentId" in entry.event && entry.event.agentId === agentId);
        const written = rows.map((entry) => entry.event._tag).filter((tag) => (lifecycle as ReadonlyArray<string>).includes(tag) && (opened || tag !== "SessionOpened"));
        const tokens = yield* sql<{ revoked_at: number | null }>`SELECT revoked_at FROM agent_tokens WHERE agent_id = ${agentId}`;
        return { written, tokens: tokens.length, revoked: tokens.every((token) => token.revoked_at !== null) };
      });
      const endedWith = (agentId: string, tag: string) => eventually(readLog, (rows) => rows.some((entry) => entry.event._tag === tag && "agentId" in entry.event && entry.event.agentId === agentId));

      const stopped = success(yield* call(ownerCredential, "start", startPayloadFor(harness, accounts.stop, rig.work)));
      yield* endedWith(stopped.agentId, "SessionOpened");
      success(yield* call(ownerCredential, "stop", { agentId: stopped.agentId }));
      yield* endedWith(stopped.agentId, "AgentStopped");

      const crashed = success(yield* call(ownerCredential, "start", startPayloadFor(harness, accounts.crash, rig.work, { prompt: "go" })));
      yield* endedWith(crashed.agentId, "AgentCrashed");

      const rejected = success(yield* call(ownerCredential, "start", startPayloadFor(harness, accounts["rejected start"], rig.work, { model: "model-missing" })));
      yield* endedWith(rejected.agentId, "AgentStartFailed");

      yield* Effect.sleep("300 millis");
      const table = {
        stop: { ...(yield* row(stopped.agentId, false)), childAlive: alive((yield* readEcho(echoes.stop)).pid) },
        crash: { ...(yield* row(crashed.agentId, false)), childAlive: alive((yield* readEcho(echoes.crash)).pid) },
        "rejected start": { ...(yield* row(rejected.agentId, true)), childAlive: alive((yield* readEcho(echoes["rejected start"])).pid) },
      };
      expect(table).toEqual({
        stop: { written: ["AgentStopped"], tokens: 1, revoked: true, childAlive: false },
        crash: { written: ["AgentCrashed"], tokens: 1, revoked: true, childAlive: false },
        "rejected start": { written: ["AgentStartFailed"], tokens: 1, revoked: true, childAlive: false },
      });
      expect(tagged(yield* readLog, "AgentCrashed").find((event) => event.agentId === crashed.agentId)?.exitCode).toBe(3);
    }));
  }));
