import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { EventEnvelope, HarnessSettings } from "@shepherd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";

import { modeOption } from "./acpRunnerRig.ts";
import { ancestryHeaders, authorization, connect, ownerBearer, upgradeStatus, type Client } from "./socketClient.ts";

// Unit 7a: the service as a real child process (`packages/engine/src/service.ts`).
// Every folder lives under one short `mkdtemp` root in /tmp, so each socket
// path stays under 100 bytes (row 54). Every service a test starts is
// stopped and awaited by `stopAllServices`, which each file calls in
// `afterEach`, even when the test failed. Fake agents the services started
// are stopped too, but only a pid whose command line names this root.

export const servicePath = fileURLToPath(new URL("../../src/service.ts", import.meta.url));
export const fakeAgentPath = fileURLToPath(new URL("../../../testing/src/fakeAgent.ts", import.meta.url));

export interface ServiceRoot {
  readonly root: string;
  readonly home: string;
  // SHEPHERD_HOME. Not created here: the service creates it (criterion 7.1).
  readonly state: string;
  readonly socket: string;
  readonly work: string;
  readonly bin: string;
}

const roots: Array<string> = [];

export const makeServiceRoot = (prefix = "/tmp/sh7-"): ServiceRoot => {
  const root = realpathSync(mkdtempSync(prefix));
  roots.push(root);
  const result = {
    root, home: join(root, "home"), state: join(root, "state"), socket: join(root, "state", "engine.sock"),
    work: join(root, "work"), bin: join(root, "bin"),
  };
  for (const folder of [result.home, result.work, result.bin]) mkdirSync(folder, { mode: 0o700 });
  return result;
};

export interface ServiceProcess {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly output: () => string;
  readonly exit: Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
  readonly exited: () => boolean;
}

const services: Array<ServiceProcess> = [];

// The environment every service gets unless a test overrides a name. TMPDIR
// is /tmp, so a root made here is inside the service's temporary folder
// (row 74), whatever the test runner's own TMPDIR is.
export const serviceEnvironment = (root: ServiceRoot): Record<string, string> => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: root.home,
  SHEPHERD_HOME: root.state,
  XDG_STATE_HOME: join(root.root, "xdg"),
  CODEX_HOME: join(root.root, "codex"),
  TMPDIR: "/tmp",
  LANG: "C.UTF-8",
});

export const startService = (root: ServiceRoot, options: {
  readonly env?: Record<string, string | undefined>;
  // Run under this umask instead of the test runner's (criterion 7.1).
  readonly umask?: number;
} = {}): ServiceProcess => {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...serviceEnvironment(root), ...options.env })) if (value !== undefined) env[name] = value;
  const child = options.umask === undefined
    ? spawn(process.execPath, [servicePath], { env, stdio: ["ignore", "pipe", "pipe"] })
    : spawn("/bin/sh", ["-c", `umask ${options.umask.toString(8).padStart(3, "0")}; exec "$0" "$@"`, process.execPath, servicePath], { env, stdio: ["ignore", "pipe", "pipe"] });
  const out: Array<string> = [];
  const err: Array<string> = [];
  const both: Array<string> = [];
  child.stdout!.setEncoding("utf8").on("data", (chunk: string) => { out.push(chunk); both.push(chunk); });
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => { err.push(chunk); both.push(chunk); });
  let done = false;
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => { done = true; resolve({ code, signal }); });
  });
  const service: ServiceProcess = {
    child, pid: child.pid!, exit, exited: () => done,
    stdout: () => out.join(""), stderr: () => err.join(""), output: () => both.join(""),
  };
  services.push(service);
  return service;
};

const commandLineNames = (pid: number, root: string): boolean => {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(root) || readFileSync(`/proc/${pid}/environ`, "utf8").includes(root); } catch { return false; }
};

export const alive = (pid: number): boolean => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
  } catch { return false; }
};

// Stops every service this file started, then every fake agent a service
// started under one of this file's roots, then removes the roots.
export const stopAllServices = async (): Promise<void> => {
  for (const service of services.splice(0)) {
    if (!service.exited()) {
      try { service.child.kill("SIGTERM"); } catch { /* gone */ }
      const stopped = await Promise.race([service.exit.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000))]);
      if (!stopped) { try { service.child.kill("SIGKILL"); } catch { /* gone */ } }
      await service.exit;
    }
  }
  for (const root of roots.splice(0)) {
    for (const pid of echoPids(root)) {
      if (alive(pid) && commandLineNames(pid, root)) { try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ } }
    }
    rmSync(root, { recursive: true, force: true });
  }
};

const echoPids = (root: string): Array<number> => {
  const pids: Array<number> = [];
  for (const name of existsSync(root) ? readdirSync(root) : []) {
    if (!name.startsWith("echo-")) continue;
    const echo = peekEcho(join(root, name));
    if (echo !== undefined) pids.push(echo.pid);
  }
  return pids;
};

// Polls a named condition until it holds, never longer than `limit`.
export const waitFor = <A>(what: string, check: () => A | undefined | false | Promise<A | undefined | false>, limit = 20_000) =>
  Effect.gen(function* () {
    const deadline = Date.now() + limit;
    for (;;) {
      const value = yield* Effect.promise(async () => { try { return await check(); } catch { return undefined; } });
      if (value !== undefined && value !== false) return value as A;
      if (Date.now() > deadline) return yield* Effect.die(new Error(`Timed out after ${limit} ms waiting for ${what}`));
      yield* Effect.sleep(25);
    }
  });

export const ownerHeaders = (root: ServiceRoot): Record<string, string> => ({ ...authorization(ownerBearer(root.state)), ...ancestryHeaders() });

// The service accepts the owner's upgrade: recovery has finished (row 52,
// step 9). A service that exits first fails at once, with its output.
export const waitServing = (root: ServiceRoot, service?: ServiceProcess, limit = 30_000) => Effect.gen(function* () {
  const deadline = Date.now() + limit;
  for (;;) {
    if (service?.exited() === true) return yield* Effect.die(new Error(`The service exited before serving; output:\n${service.output().slice(-4000)}`));
    const ready = yield* Effect.promise(async () => {
      if (!existsSync(join(root.state, "owner-credential"))) return false;
      try { return (await upgradeStatus(root.socket, ownerHeaders(root))).status === 101; } catch { return false; }
    });
    if (ready) return;
    if (Date.now() > deadline) return yield* Effect.die(new Error(`Timed out after ${limit} ms waiting for the service to accept the owner's upgrade; output:\n${service?.output().slice(-4000) ?? ""}`));
    yield* Effect.sleep(25);
  }
});

export const ownerClient = (root: ServiceRoot): Effect.Effect<Client, never, import("effect/Scope").Scope> =>
  connect(root.socket, ownerBearer(root.state));

export const requestId = (): string => `request-${randomUUID()}`;

// An adapter executable that runs the fake agent, as the runner tests do.
export const writeFakeAdapter = (root: ServiceRoot, name = "fake-adapter"): string => {
  const path = join(root.bin, name);
  writeFileSync(path, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});\n`);
  chmodSync(path, 0o755);
  return path;
};

export const fakeHarness = (adapterPath: string, id = "fake"): HarnessSettings => ({
  id, runMode: "acp", adapterPath, adapterArguments: [],
  permissionMapping: { "read-only": "read-only", ask: "default", edit: "accept-edits", full: "full-access" },
  reportedModes: [
    { id: "read-only", level: "read-only" }, { id: "default", level: "ask" },
    { id: "accept-edits", level: "edit" }, { id: "full-access", level: "full" },
  ],
  defaultPermission: "ask", models: [], efforts: [], denyReadMechanism: { _tag: "none" },
}) as unknown as HarnessSettings;

export interface Echo {
  readonly pid: number;
  readonly env: Readonly<Record<string, string>>;
  readonly inbound: ReadonlyArray<{ readonly method?: string; readonly params?: any }>;
}

export const peekEcho = (file: string): Echo | undefined => {
  try { return JSON.parse(readFileSync(file, "utf8")) as Echo; } catch { return undefined; }
};

export const promptTexts = (echo: Echo): ReadonlyArray<string> => echo.inbound
  .filter((frame) => frame.method === "session/prompt")
  .map((frame) => (frame.params.prompt as Array<{ text?: string }>).map((part) => part.text ?? "").join(""));

export interface FakeAgentSpec {
  readonly script: Record<string, unknown>;
  // Account variables beside the script and the echo file, such as a secret reference.
  readonly environment?: Record<string, string>;
  // Secrets stored with `accounts set-secret` before the start, by variable name.
  readonly secrets?: Record<string, string>;
  readonly prompt?: string;
  readonly name?: string;
  readonly accountId?: string;
}

export interface StartedAgent {
  readonly agentId: string;
  readonly echo: string;
  readonly accountId: string;
}

// Writes the fake harness once per root, through the owner's `harnesses set`.
export const ensureFakeHarness = (root: ServiceRoot, owner: Client) => Effect.gen(function* () {
  const adapter = join(root.bin, "fake-adapter");
  if (!existsSync(adapter)) writeFakeAdapter(root);
  yield* owner.harnesses({ requestId: requestId(), operation: "set", harness: fakeHarness(adapter) } as never);
});

// Adds an account that runs `spec.script`, then starts an agent on it as
// `caller` (the owner's client or an agent's). Each agent has its own
// account, because the script travels in the account's variables.
export const startFakeAgent = (root: ServiceRoot, owner: Client, caller: Client, spec: FakeAgentSpec) => Effect.gen(function* () {
  yield* ensureFakeHarness(root, owner);
  const accountId = spec.accountId ?? `acct${randomUUID().slice(0, 8)}`;
  const echo = join(root.root, `echo-${randomUUID()}.json`);
  yield* owner.accounts({
    requestId: requestId(), operation: "add",
    account: {
      id: accountId, harness: "fake", displayName: accountId, enabled: true,
      environment: { FAKE_AGENT_SCRIPT: JSON.stringify({ configOptions: [modeOption()], ...spec.script }), FAKE_AGENT_ECHO: echo, ...spec.environment },
    },
  } as never);
  for (const [name, value] of Object.entries(spec.secrets ?? {})) {
    yield* owner["accounts set-secret"]({ requestId: requestId(), accountId, name, nonce: `nonce-${randomUUID()}`, value } as never);
  }
  const reply = yield* (caller.start({
    requestId: requestId(), name: spec.name ?? "Service test agent", role: "worker", harness: "fake",
    account: { _tag: "named", accountId }, permission: "ask", folder: root.work, runMode: "acp", groups: [],
    ...(spec.prompt === undefined ? {} : { prompt: spec.prompt }),
  } as never) as Effect.Effect<{ agentId: string }, unknown>);
  return { agentId: reply.agentId, echo, accountId } satisfies StartedAgent;
});

// The agent's token, read from the fake agent's own recorded environment
// (its echo file), once the process with a pid other than `notPid` wrote it.
export const agentToken = (agent: StartedAgent, notPid?: number) =>
  waitFor("the fake agent's environment", () => {
    const echo = peekEcho(agent.echo);
    if (echo === undefined || echo.pid === notPid || echo.env.SHEPHERD_TOKEN === undefined) return undefined;
    return { token: echo.env.SHEPHERD_TOKEN, pid: echo.pid, echo };
  });

// Waits for the agent's first turn to end, through the owner's subscription.
export const turnEnded = (owner: Client, agentId: string) =>
  (owner.subscribe({ requestId: requestId(), after: 0 } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
    Stream.takeUntil((envelope) => envelope.event._tag === "TurnEnded" && envelope.agentId === agentId),
    Stream.runDrain, Effect.timeout(30_000),
  );

// The debug RPC (row 62), as an exit.
export const compareViews = (client: Client) =>
  (client["debug.compare-views"]({ requestId: requestId() } as never) as Effect.Effect<{ sequence: number; equal: boolean; differences: ReadonlyArray<string> }, unknown>).pipe(Effect.exit);

// What a call's exit shows: served and answered, refused by the handler, or unknown to the server.
export const kindOf = (exit: Exit.Exit<unknown, unknown>): "success" | "refused" | "not served" | "other" => {
  if (Exit.isSuccess(exit)) return "success";
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "Some" && (error.value as { _tag?: string })._tag === "CommandError") return "refused";
  if (Cause.hasDies(exit.cause) && String(Cause.squash(exit.cause)).includes("Unknown request tag")) return "not served";
  return "other";
};

