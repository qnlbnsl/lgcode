import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Account as AccountSchema, AgentId, DeliveryId, HarnessSettings as HarnessSchema,
  type Account, type Delivery, type HarnessSettings, type PermissionLevel,
} from "@lgcode/contracts";
import * as SqliteClient from "@lgcode/t3-node-sqlite/nodeSqliteClient";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { MinimumLogLevel } from "effect/References";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as CommandHandler from "../../src/commands/CommandHandler.ts";
import type * as SecretStore from "../../src/commands/SecretStore.ts";
import { checkFolder } from "../../src/identity/ceiling.ts";
import { redactingLoggerLayer } from "../../src/identity/logger.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { mintAgentToken } from "../../src/identity/tokens.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Views from "../../src/views/Views.ts";
// Unit 6a's runner. The module does not exist until the builder writes it.
import * as AcpRunner from "../../src/runner/AcpRunner.ts";
import { Runner, type RunnerEvent } from "../../src/runner/Runner.ts";
import { appendSetup, eventOf, makeFakeSecrets, type FakeSecrets } from "./handlerRig.ts";
import { pause } from "./routingRig.ts";

// Shared setup for the unit 6a runner tests. It holds no assertion; each test
// file registers the rebuild check itself (row 63).
//
// Nothing here starts a real adapter. Every child is the scripted fake agent
// (`packages/testing/src/fakeAgent.ts`) or the replay player
// (`packages/testing/src/replay.ts --match method`), started through a
// harness whose `adapterPath` is a small executable written into the test's
// own temporary folder. That executable is a Node.js script, so the child's
// `process.argv[1]` is the absolute adapter path the runner spawned, and its
// arguments follow. No shell runs in between, so the child's environment is
// exactly what the runner passed.
//
// The fake agent writes its pid, arguments, working folder, environment and
// every raw inbound frame to the file named by `FAKE_AGENT_ECHO`. Both
// `FAKE_AGENT_SCRIPT` and `FAKE_AGENT_ECHO` reach the child as the account's
// own variables, the only way a variable other than the allow-list reaches it.

export type RunnerShape = Context.Service.Shape<typeof Runner>;
export type SpawnInput = Parameters<RunnerShape["start"]>[0];

export const fakeAgentPath = fileURLToPath(new URL("../../../testing/src/fakeAgent.ts", import.meta.url));
export const replayPlayerPath = fileURLToPath(new URL("../../../testing/src/replay.ts", import.meta.url));
export const fixturePath = (name: string) => fileURLToPath(new URL(`../../../testing/fixtures/${name}`, import.meta.url));
// Row 22: the runner's `mcpServers` entry runs this script with `process.execPath`.
export const mcpScriptPath = fileURLToPath(new URL("../../../cli/src/bin.ts", import.meta.url));

export const agentIdOf = Schema.decodeUnknownSync(AgentId);
export const deliveryIdOf = Schema.decodeUnknownSync(DeliveryId);
const decodeHarness = Schema.decodeUnknownSync(HarnessSchema);
const decodeAccount = Schema.decodeUnknownSync(AccountSchema);

export interface RunnerRig {
  readonly root: string;
  readonly home: string;
  readonly stateFolder: string;
  readonly pluginRoot: string;
  readonly work: string;
  readonly bin: string;
  readonly socket: string;
  readonly database: string;
}

export const makeRunnerRig = (): RunnerRig => {
  const root = realpathSync(mkdtempSync("/tmp/lgcode-runner-"));
  const rig: RunnerRig = {
    root, home: join(root, "home"), stateFolder: join(root, "state"), pluginRoot: join(root, "plugin"),
    work: join(root, "work"), bin: join(root, "bin"), socket: join(root, "state", "engine.sock"),
    database: join(root, "events.sqlite"),
  };
  for (const folder of [rig.home, rig.stateFolder, rig.pluginRoot, rig.work, rig.bin]) mkdirSync(folder, { mode: 0o700 });
  return rig;
};

export const removeRunnerRig = (rig: RunnerRig): void => {
  // A child the runner failed to stop must not outlive the test.
  for (const file of echoFiles.splice(0)) {
    try {
      const pid = (JSON.parse(readFileSync(file, "utf8")) as { pid: number }).pid;
      process.kill(-pid, "SIGKILL");
    } catch { /* gone already */ }
  }
  rmSync(rig.root, { recursive: true, force: true });
};

export const folderIn = (rig: RunnerRig, ...names: ReadonlyArray<string>): string => {
  const path = join(rig.work, ...names);
  mkdirSync(path, { recursive: true });
  return path;
};

// An adapter executable that runs the fake agent.
export const writeFakeAdapter = (rig: RunnerRig, name = "fake-adapter"): string => {
  const path = join(rig.bin, name);
  writeFileSync(path, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});\n`);
  chmodSync(path, 0o755);
  return path;
};

// An adapter executable that replays a recorded fixture, matching the
// runner's frames by method (`replay.ts --match method`). The runner's own
// arguments are dropped.
export const writeReplayAdapter = (rig: RunnerRig, fixture: string, workspace: string, name = `replay-${fixture}`): string => {
  const path = join(rig.bin, name);
  const argv = [replayPlayerPath, fixturePath(fixture), "--workspace", workspace, "--match", "method"];
  writeFileSync(path, `#!${process.execPath}\nprocess.argv.splice(1, process.argv.length - 1, ...${JSON.stringify(argv)});\nimport(${JSON.stringify(pathToFileURL(replayPlayerPath).href)});\n`);
  chmodSync(path, 0o755);
  return path;
};

// The fake agent's mode option. Its values are the harness mapping below, so
// the runner can set any of the four levels with `session/set_config_option`.
export const modeOption = (current = "default") => ({
  configId: "mode", name: "Mode", category: "mode", type: "select", currentValue: current,
  options: [
    { value: "read-only", name: "Read only" }, { value: "default", name: "Default" },
    { value: "accept-edits", name: "Accept edits" }, { value: "full-access", name: "Full access" },
  ],
});
export const modelOption = (current = "model-small") => ({
  configId: "model", name: "Model", category: "model", type: "select", currentValue: current,
  options: [{ value: "model-small", name: "Small" }, { value: "model-large", name: "Large" }],
});
export const effortOption = (current = "low") => ({
  configId: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: current,
  options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }],
});

export const harnessFor = (id: string, adapterPath: string, overrides: Record<string, unknown> = {}): HarnessSettings => decodeHarness({
  id, runMode: "acp", adapterPath, adapterArguments: ["--stdio", "--label=fake adapter"],
  permissionMapping: { "read-only": "read-only", ask: "default", edit: "accept-edits", full: "full-access" },
  reportedModes: [
    { id: "read-only", level: "read-only" }, { id: "default", level: "ask" },
    { id: "accept-edits", level: "edit" }, { id: "full-access", level: "full" },
  ],
  defaultPermission: "ask", models: [], efforts: [], denyReadMechanism: { _tag: "none" },
  ...overrides,
});

const echoFiles: Array<string> = [];

// A fresh echo file for one child. The file is removed with the rig.
export const echoFile = (rig: RunnerRig): string => {
  const file = join(rig.root, `echo-${randomUUID()}.json`);
  echoFiles.push(file);
  return file;
};

// The account's variables carry the script and the echo file; `extra` adds
// variables such as a secret reference.
export const accountFor = (harness: string, script: Record<string, unknown>, echo: string, extra: Record<string, string> = {}, id = "primary"): Account =>
  decodeAccount({
    id, harness, displayName: "Primary", enabled: true,
    environment: { FAKE_AGENT_SCRIPT: JSON.stringify({ configOptions: [modeOption()], ...script }), FAKE_AGENT_ECHO: echo, ...extra },
  });

// The service's own environment, which the runner's allow-list filters. It
// holds every kind of variable a child must not get.
export const allowListed = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "TZ"] as const;
export const serviceEnvironment = (rig: RunnerRig): Record<string, string> => ({
  PATH: "/usr/bin:/bin", HOME: rig.home, USER: "lgcode-test", LOGNAME: "lgcode-test", SHELL: "/bin/sh",
  LANG: "C.UTF-8", LC_ALL: "C.UTF-8", LC_CTYPE: "C.UTF-8", TERM: "dumb", TMPDIR: rig.root, TZ: "UTC",
  HERDR_SOCKET_PATH: "/tmp/herdr-planted.sock", HERDR_ENV: "1", HERDR_PANE_ID: "w9:p9",
  ANTHROPIC_API_KEY: "inherited-provider-key-planted-1", OPENAI_API_KEY: "inherited-provider-key-planted-2",
  LGCODE_TOKEN: "shp_a_the-service-own-token-planted", LGCODE_HOME: rig.stateFolder, LGCODE_TEST_DEBUG: "1",
  NODE_OPTIONS: "--require /tmp/planted-preload.js", FAKE_AGENT_SCRIPT: "{\"turns\":[]}", XDG_STATE_HOME: rig.root,
});

export interface EchoFrame {
  readonly id?: string | number;
  readonly method?: string;
  readonly params?: any;
  readonly result?: any;
  readonly error?: any;
}
export interface Echo {
  readonly pid: number;
  readonly argv: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly inbound: ReadonlyArray<EchoFrame>;
}

export const peekEcho = (file: string): Echo | undefined => {
  try { return JSON.parse(readFileSync(file, "utf8")) as Echo; } catch { return undefined; }
};

// The echo once `done` holds, or after about five seconds, whatever it is.
export const readEcho = (file: string, done: (echo: Echo) => boolean = () => true) => Effect.gen(function* () {
  for (let attempt = 0; attempt < 500; attempt++) {
    const echo = peekEcho(file);
    if (echo !== undefined && done(echo)) return echo;
    yield* pause(10);
  }
  const echo = peekEcho(file);
  if (echo === undefined) return yield* Effect.die(new Error("The fake agent never wrote its echo file, so it was never spawned"));
  return echo;
});

export const framesOf = (echo: Echo, method: string) => echo.inbound.filter((frame) => frame.method === method);
export const promptTexts = (echo: Echo): ReadonlyArray<string> =>
  framesOf(echo, "session/prompt").map((frame) => (frame.params.prompt as Array<{ text?: string }>).map((part) => part.text ?? "").join(""));

// Whether a process still runs (zombies count as gone).
export const alive = (pid: number): boolean => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return !/^\d+ \(.*\) Z /.test(stat);
  } catch {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }
};
export const processGroupOf = (pid: number): number => {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
};

export const deliveryFor = (agentId: AgentId, text: string, id: string = `delivery-${randomUUID()}`): Delivery => ({
  id: deliveryIdOf(id), target: agentId, sender: { _tag: "owner" }, content: { _tag: "prompt", text },
});
export const compactFor = (agentId: AgentId, id: string = `compact-${randomUUID()}`): Delivery => ({
  id: deliveryIdOf(id), target: agentId, sender: { _tag: "owner" }, content: { _tag: "compact" },
});

// One spawn's input as the engine builds it: a fresh token and the folder
// grant from the ceiling's own check (issue 49). The incarnation is the
// token's hash (issue 61).
export const spawnFor = (rig: RunnerRig, harness: HarnessSettings, account: Account, overrides: {
  readonly agentId?: string; readonly folder?: string; readonly permission?: PermissionLevel;
  readonly model?: string; readonly effort?: string;
} = {}) => Effect.gen(function* () {
  const folder = overrides.folder ?? rig.work;
  const grant = yield* checkFolder({
    caller: { _tag: "owner" }, parentFolder: folder, folder,
    home: rig.home, stateFolder: rig.stateFolder, pluginRoot: rig.pluginRoot,
  }).pipe(Effect.orDie);
  const minted = mintAgentToken();
  const agentId = agentIdOf(overrides.agentId ?? `agent-${randomUUID().slice(0, 8)}`);
  const input = {
    agentId, token: minted.token, folder: grant.realPath, grant, harness, account,
    permission: overrides.permission ?? "ask",
    ...(overrides.model === undefined ? {} : { model: overrides.model }),
    ...(overrides.effort === undefined ? {} : { effort: overrides.effort }),
  } as SpawnInput;
  return { input, agentId, token: Redacted.value(minted.token), incarnation: minted.tokenHash };
});

export interface RunnerContext {
  readonly runner: RunnerShape;
  // Every runner event, oldest first. The array is live.
  readonly events: ReadonlyArray<RunnerEvent>;
  readonly eventsAfter: (count: number) => ReadonlyArray<RunnerEvent>;
  // The first event after index `from` that matches, or a defect after ten seconds.
  readonly waitFor: (predicate: (event: RunnerEvent) => boolean, from?: number) => Effect.Effect<RunnerEvent>;
  // Lines written by the redacting logger the service installs.
  readonly logLines: ReadonlyArray<string>;
  readonly secrets: FakeSecrets;
}

const waiter = (events: ReadonlyArray<RunnerEvent>) => (predicate: (event: RunnerEvent) => boolean, from = 0) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const found = events.slice(from).find(predicate);
      if (found !== undefined) return found;
      yield* pause(10);
    }
    return yield* Effect.die(new Error(`No matching runner event arrived; saw ${JSON.stringify(events.slice(from).map((event) => event._tag))}`));
  });

// The secret registry the service's redactor reads: the stored account
// secrets and the hashes of every agent token in the database, read on each
// call so a token minted a moment ago is already covered.
const registryFor = (secrets: FakeSecrets, database?: string) => {
  let reader: DatabaseSync | undefined;
  return makeRedactor({
    secrets: () => [...secrets.stored.values()].map((value) => Redacted.make(value)),
    tokenHashes: () => {
      if (database === undefined || !existsSync(database)) return new Set<string>();
      try {
        reader ??= new DatabaseSync(database, { readOnly: true });
        return new Set((reader.prepare("SELECT token_hash FROM agent_tokens").all() as Array<{ token_hash: string }>).map((row) => row.token_hash));
      } catch { return new Set<string>(); }
    },
  });
};

export interface RunnerOptions {
  readonly secrets?: Readonly<Record<string, string>>;
  // Account tests exercise the persistent store through the real handler.
  // `secrets` remains the planted registry used by the service's redactor.
  readonly secretStore?: Layer.Layer<SecretStore.SecretStore>;
  readonly classifyError?: AcpRunner.AcpRunnerOptions["classifyError"];
  readonly environment?: Readonly<Record<string, string>>;
}

const runnerLayer = (rig: RunnerRig, options: RunnerOptions, secrets: FakeSecrets) =>
  AcpRunner.layer({
    socketPath: rig.socket,
    stateFolder: rig.stateFolder,
    environment: options.environment ?? serviceEnvironment(rig),
    ...(options.classifyError === undefined ? {} : { classifyError: options.classifyError }),
  }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, secrets.layer)));

const loggerFor = (redactText: (text: string) => string, lines: Array<string>) => Layer.mergeAll(
  redactingLoggerLayer({ redactText }, (line) => { lines.push(line); }),
  Layer.succeed(MinimumLogLevel, "All"),
);

const fakeSecretsWith = (values: Readonly<Record<string, string>> = {}, persistent?: Layer.Layer<SecretStore.SecretStore>): FakeSecrets => {
  const secrets = makeFakeSecrets();
  for (const [reference, value] of Object.entries(values)) (secrets.stored as Map<string, string>).set(reference, value);
  return persistent === undefined ? secrets : { ...secrets, layer: persistent };
};

// The ACP runner alone, with its event stream collected from before the
// first spawn. The redacting logger is installed before the runner layer is
// built, as the service does (identity/logger.ts).
export const withAcpRunner = <A, E>(rig: RunnerRig, options: RunnerOptions, body: (context: RunnerContext) => Effect.Effect<A, E, Scope.Scope>) => {
  const secrets = fakeSecretsWith(options.secrets, options.secretStore);
  const redactor = registryFor(secrets);
  const lines: Array<string> = [];
  const events: Array<RunnerEvent> = [];
  return Effect.gen(function* () {
    const runner = yield* Runner;
    yield* runner.events.pipe(Stream.runForEach((event) => Effect.sync(() => { events.push(event); })), Effect.forkScoped);
    yield* pause(20);
    return yield* body({
      runner, events, eventsAfter: (count) => events.slice(count), waitFor: waiter(events), logLines: lines, secrets,
    });
  }).pipe(
    Effect.provide(runnerLayer(rig, options, secrets).pipe(Layer.provide(redactor.layer))),
    Effect.provide(loggerFor(redactor.redactText, lines)),
    Effect.scoped,
  );
};

export interface EngineContext extends RunnerContext {
  readonly harness: HarnessSettings;
}

// The ACP runner behind the real command handler, event log and views, as
// the service wires them: the handler is the runner events' only consumer,
// and the test sees each event as the handler reads it. The real redactor
// runs on every append. `setup` writes the harness and the account through
// the log before the body runs.
export const withEngine = <A, E>(
  rig: RunnerRig, options: RunnerOptions & { readonly harness: HarnessSettings; readonly accounts: ReadonlyArray<Account>; readonly capacityHoldCondition?: import("./handlerRig.ts").Fakes["capacityHoldCondition"]; readonly wrapLog?: import("./handlerRig.ts").Fakes["wrapLog"] },
  body: (context: EngineContext) => Effect.Effect<A, E, Scope.Scope | CommandHandler.CommandHandler | EventLog.EventLog | Views.Views | SqlClient.SqlClient | Runner>,
) => {
  const secrets = fakeSecretsWith(options.secrets, options.secretStore);
  const redactor = registryFor(secrets, rig.database);
  const lines: Array<string> = [];
  const events: Array<RunnerEvent> = [];
  const tapped = Layer.effect(Runner, Effect.gen(function* () {
    const real = yield* Runner;
    return { ...real, events: real.events.pipe(Stream.tap((event) => Effect.sync(() => { events.push(event); }))) } as RunnerShape;
  })).pipe(Layer.provide(runnerLayer(rig, options, secrets)));
  const baseLog = EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provide(redactor.layer));
  const log = options.wrapLog === undefined ? baseLog : Layer.effect(EventLog.EventLog, Effect.map(EventLog.EventLog, options.wrapLog)).pipe(Layer.provideMerge(baseLog));
  const services = CommandHandler.layer({ home: rig.home, stateFolder: rig.stateFolder, pluginRoot: rig.pluginRoot,
    ...(options.capacityHoldCondition === undefined ? {} : { capacityHoldCondition: options.capacityHoldCondition }),
  }).pipe(
    Layer.provideMerge(log),
    Layer.provideMerge(tapped),
    Layer.provide(secrets.layer),
  );
  return Effect.gen(function* () {
    yield* migrate;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL`;
    return yield* Effect.scoped(Effect.gen(function* () {
      yield* appendSetup([eventOf({ _tag: "HarnessChanged", harness: options.harness })]);
      for (const account of options.accounts) yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: account.id, account })]);
      const runner = yield* Runner;
      return yield* body({
        runner, events, eventsAfter: (count) => events.slice(count), waitFor: waiter(events), logLines: lines, secrets,
        harness: options.harness,
      });
    })).pipe(Effect.provide(services));
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })),
    Effect.provide(loggerFor(redactor.redactText, lines)),
    Effect.scoped,
  );
};

// The `start` payload for the engine rig's harness and account.
export const startPayloadFor = (harness: HarnessSettings, account: Account, folder: string, overrides: Record<string, unknown> = {}) => ({
  name: "Runner test agent", role: "worker", harness: harness.id, account: { _tag: "named", accountId: account.id },
  permission: "ask", folder, runMode: "acp", groups: [], ...overrides,
});
