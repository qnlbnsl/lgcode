// A scripted engine boundary for the L-1 probes. The real liveProbeDriver and
// the real outcome gate (runProbes) run unchanged; only the engine's event log,
// the owner's client and agent token connections are scripted, so a test can
// hand the probe evidence a real run could produce and see what it records.
//
// Agent processes are real: small node processes this file starts, with the
// run's socket variable, a token and the agent's folder as cwd, so the probe's
// /proc snapshot finds them exactly as it finds real adapters. Nothing outside
// a mkdtemp folder under /tmp is read or written, and only processes started
// here are ever signalled.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@shephrd/client";
import type { EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { makeStepRunner } from "../../scripts/live/flow.ts";
import { liveProbeDriver, type LiveProbeOptions } from "../../scripts/live/liveProbes.ts";
import { runProbes, type Observation, type ProbeDriver, type ProbeId } from "../../scripts/live/probes.ts";
import { createReporter } from "../../scripts/live/reporter.ts";
import type { LiveService } from "../../scripts/live/service.ts";
import { registry } from "./probe-fake-registry.ts";

export const LEAD = "agent-lead";
export const WORKER = "agent-worker";
type Harness = "claude" | "codex";
const agentOf: Record<Harness, string> = { claude: LEAD, codex: WORKER };

export interface Option { readonly id: string; readonly kind: string; readonly level: string; readonly persistent: boolean }
export const ONCE: Option = { id: "allow-once", kind: "allow_once", level: "ask", persistent: false };
export const ALWAYS: Option = { id: "allow-always", kind: "allow_always", level: "edit", persistent: true };
export const REJECT: Option = { id: "reject-once", kind: "reject_once", level: "read-only", persistent: false };

export interface Prompted { readonly agentId: string; readonly text: string; readonly deliveryId: string; readonly from: string }
export interface Answered { readonly id: string; readonly optionId: string }
export interface Script {
  // Called after the engine has recorded DeliverySent for a prompt or an ask.
  readonly onPrompt?: (engine: FakeEngine, prompted: Prompted) => void;
  readonly onAnswer?: (engine: FakeEngine, answered: Answered) => void;
  // Called by the probe's restart, before it reconnects with the CLI.
  readonly onRestart?: (engine: FakeEngine, count: number) => void;
}

const sleep = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));

export interface FakeEngine {
  readonly root: string; readonly state: string; readonly work: string; readonly home: string; readonly codexHome: string;
  readonly events: EventEnvelope[];
  readonly answers: Answered[];
  readonly prompts: Prompted[];
  readonly valid: Map<string, string>;
  readonly tokenOf: Map<string, string>;
  readonly sessionOf: Record<Harness, string>;
  script: Script;
  readonly emit: (agentId: string | undefined, event: Record<string, unknown>, extra?: { caller?: unknown; requestId?: string }) => EventEnvelope;
  readonly tool: (agentId: string, callId: string, input: unknown, title?: string) => void;
  readonly finish: (agentId: string, callId: string, status: string, output: string) => void;
  readonly permission: (agentId: string, callId: string, options: ReadonlyArray<Option>, holder?: unknown) => string;
  readonly turnEnded: (agentId: string, compact?: boolean) => void;
  readonly session: (harness: Harness, record: unknown) => void;
  readonly sessionFile: (harness: Harness) => string;
  // Starts (or replaces) the agent's process with a new token. With keepOld,
  // the engine still accepts the agent's previous token.
  readonly rotate: (agentId: string, keepOld?: boolean) => string;
  readonly kill: (agentId: string) => void;
  readonly owner: Client;
  readonly options: (service?: Partial<LiveService>) => LiveProbeOptions;
  readonly cleanup: () => void;
}

// `at` places the run on a real live service's folders (the reload probe's
// command-line reconnect is a real child process that needs a real socket).
export const fakeEngine = (setup: { codexCore?: boolean; agents?: ReadonlyArray<string>; at?: Pick<LiveService, "root" | "state" | "work" | "pid"> } = {}): FakeEngine => {
  const own = realpathSync(mkdtempSync("/tmp/lcpt-"));
  const root = setup.at?.root ?? own;
  const state = setup.at?.state ?? join(root, "state"); const work = setup.at?.work ?? join(root, "work");
  const home = join(own, "home"); const codexHome = join(own, "codex");
  for (const path of [state, join(work, "project"), home, codexHome]) mkdirSync(path, { recursive: true });
  const events: EventEnvelope[] = [];
  const children = new Map<string, ChildProcess>();
  const valid = new Map<string, string>();
  const tokenOf = new Map<string, string>();
  let counter = 0;
  const id = (prefix: string) => `${prefix}-${++counter}`;
  const emit: FakeEngine["emit"] = (agentId, event, extra = {}) => {
    const row = {
      sequence: events.length + 1, eventId: `event-${events.length + 1}`, occurredAt: 1_800_000_000_000,
      caller: extra.caller ?? { _tag: "owner" }, requestId: extra.requestId ?? `request-${events.length + 1}`,
      ...(agentId === undefined ? {} : { agentId }), event,
    } as unknown as EventEnvelope;
    events.push(row);
    return row;
  };
  // A live subscription: every event after `after`, then each new one.
  const subscribe = (after: number) => Stream.fromAsyncIterable({
    async *[Symbol.asyncIterator]() {
      let at = after;
      for (;;) {
        while (at < events.length) yield events[at++]!;
        await sleep(5);
      }
    },
  }, (error) => error);
  const sessionOf = { claude: `claude-${randomBytes(4).toString("hex")}`, codex: `codex-${randomBytes(4).toString("hex")}` };
  const sessionFile = (harness: Harness) => harness === "claude"
    ? join(home, ".claude", "projects", "-tmp-work", `${sessionOf.claude}.jsonl`)
    : join(codexHome, "sessions", "2026", "11", "02", `rollout-2026-11-02T00-00-00-${sessionOf.codex}.jsonl`);

  const folderOf = (agentId: string) => agentId === LEAD ? work : join(work, "project");
  const spawnAgent = (agentId: string, token: string) => {
    const env: Record<string, string> = { SHEPHRD_SOCKET: join(state, "engine.sock"), SHEPHRD_TOKEN: token, PATH: process.env.PATH ?? "" };
    if (agentId === WORKER && setup.codexCore !== false) env.CODEX_CONFIG = JSON.stringify({ shell_environment_policy: { inherit: "core" } });
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: folderOf(agentId), env, stdio: "ignore" });
    children.set(agentId, child);
  };
  const kill = (agentId: string) => { const child = children.get(agentId); if (child !== undefined && child.exitCode === null) child.kill("SIGKILL"); children.delete(agentId); };
  const rotate = (agentId: string, keepOld = false) => {
    const previous = tokenOf.get(agentId);
    if (previous !== undefined && !keepOld) valid.delete(previous);
    kill(agentId);
    const token = `shp_a_${randomBytes(16).toString("hex")}`;
    valid.set(token, agentId); tokenOf.set(agentId, token);
    spawnAgent(agentId, token);
    return token;
  };
  // The service stands in as one of this run's own processes.
  const service = setup.at === undefined ? spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: root, env: { PATH: process.env.PATH ?? "" }, stdio: "ignore" }) : undefined;
  const servicePid = setup.at?.pid ?? service!.pid!;

  const answers: Answered[] = [];
  const prompts: Prompted[] = [];
  const engine: FakeEngine = {
    root, state, work, home, codexHome, events, answers, prompts, valid, tokenOf, sessionOf, script: {},
    emit,
    tool: (agentId, callId, input, title = "Bash") => { emit(agentId, { _tag: "ThreadItem", content: { _tag: "tool-call", callId, title, status: "pending", input: typeof input === "string" ? input : JSON.stringify(input) } }); },
    finish: (agentId, callId, status, output) => { emit(agentId, { _tag: "ThreadItem", content: { _tag: "tool-call", callId, title: "", status, output } }); },
    permission: (agentId, callId, options, holder = { _tag: "owner" }) => {
      const permissionRequestId = id("permission");
      emit(agentId, { _tag: "PermissionRequested", permissionRequestId, toolCallId: callId, holder, description: "run a command", options });
      return permissionRequestId;
    },
    turnEnded: (agentId, compact = false) => { emit(agentId, { _tag: "TurnEnded", agentId, compact }); },
    session: (harness, record) => { const path = sessionFile(harness); mkdirSync(join(path, ".."), { recursive: true }); appendFileSync(path, JSON.stringify(record) + "\n"); },
    sessionFile,
    rotate, kill,
    owner: undefined as unknown as Client,
    options: (overrides = {}) => {
      let restarts = 0;
      const live = { root, state, work, pid: servicePid, output: () => "", exited: () => false, logFile: join(root, "service.log"), stop: async () => [], remove: () => undefined, ...overrides } as LiveService;
      return {
        service: () => live,
        restart: () => Effect.sync(() => { restarts += 1; engine.script.onRestart?.(engine, restarts); }),
        openOwner: () => Effect.succeed(engine.owner),
        environment: { HOME: home, CODEX_HOME: codexHome },
        agentTimeout: 4_000, engineTimeout: 4_000,
        secrets: new Set<string>(),
      };
    },
    cleanup: () => {
      for (const agentId of [...children.keys()]) kill(agentId);
      if (service !== undefined && service.exitCode === null) service.kill("SIGKILL");
      if (registry.current === connector) registry.current = undefined;
      rmSync(own, { recursive: true, force: true });
    },
  };
  const deliver = (agentId: string, text: string, from: string): string => {
    const deliveryId = id("delivery");
    emit(agentId, { _tag: "DeliverySent", deliveryId });
    const prompted = { agentId, text, deliveryId, from };
    prompts.push(prompted);
    if (engine.script.onPrompt === undefined) engine.turnEnded(agentId);
    else engine.script.onPrompt(engine, prompted);
    return deliveryId;
  };
  (engine as { owner: Client }).owner = {
    "debug.compare-views": () => Effect.succeed({ sequence: events.length, equal: true, differences: [] }),
    subscribe: (input: { after: number }) => subscribe(input.after),
    prompt: (input: { agentId: string; text: string }) => Effect.sync(() => ({ deliveryId: deliver(input.agentId, input.text, "owner") })),
    answer: (input: { id: string; optionId: string }) => Effect.sync(() => {
      answers.push({ id: input.id, optionId: input.optionId });
      engine.script.onAnswer?.(engine, { id: input.id, optionId: input.optionId });
      return {};
    }),
  } as unknown as Client;
  const agentClient = (agentId: string) => ({
    ask: (input: { text: string }) => Effect.sync(() => {
      const questionId = id("question");
      const parent = LEAD;
      const deliveryId = id("delivery");
      emit(agentId, { _tag: "QuestionAsked", questionId, holder: { _tag: "agent", agentId: parent }, deliveryId, text: input.text }, { caller: { _tag: "agent", agentId } });
      emit(parent, { _tag: "DeliverySent", deliveryId });
      const prompted = { agentId: parent, text: input.text, deliveryId, from: agentId };
      prompts.push(prompted);
      if (engine.script.onPrompt === undefined) engine.turnEnded(parent); else engine.script.onPrompt(engine, prompted);
      return { questionId };
    }),
    prompt: (input: { agentId: string; text: string }) => Effect.sync(() => ({ deliveryId: deliver(input.agentId, input.text, agentId) })),
    "pass-up": () => Effect.succeed({}),
  });
  const connector = {
    connect: (token: string) => {
      const agentId = valid.get(token);
      return agentId === undefined ? Effect.fail(new Error("the engine refused this identity (HTTP 401)")) : Effect.succeed(agentClient(agentId));
    },
  };
  registry.current = connector;
  for (const agentId of setup.agents ?? [LEAD, WORKER]) rotate(agentId);
  // This run's sessions, as the engine records them and the adapters store them.
  emit(LEAD, { _tag: "SessionOpened", session: { sessionId: sessionOf.claude } });
  emit(WORKER, { _tag: "SessionOpened", session: { sessionId: sessionOf.codex } });
  engine.session("claude", { type: "system", subtype: "init" });
  engine.session("codex", { type: "session_meta", payload: {} });
  return engine;
};

const goodOutcome: Record<ProbeId, string> = {
  "sandbox-mcp": "succeeds", "permission-kinds": "recorded",
  "removed-variables": "refused by ancestry check", "state-read": "no mechanism: the agent read the canary file",
  "slash-up": "escaped; no command", "slash-down": "escaped; no command",
  "always-allow": "scopes recorded; persistent options routed to owner",
  "reload": "old token refused; tool succeeds; found", "token-scan": "not found",
};

export interface ProbeRun { readonly passed: boolean; readonly reason: string; readonly lines: ReadonlyArray<string>; readonly rows: ReadonlyArray<Observation> }

// Runs the shared outcome gate with the real live driver for one probe; the
// other probes return passing rows so the gate reaches the one under test.
export const runProbe = async (engine: FakeEngine, probe: ProbeId, options = engine.options()): Promise<ProbeRun> => {
  const live = liveProbeDriver(options);
  let rows: ReadonlyArray<Observation> = [];
  const driver: ProbeDriver = {
    observe: (id, agents) => id === probe
      ? live.observe(id, agents).pipe(Effect.tap((observed) => Effect.sync(() => { rows = observed; })))
      : Effect.succeed((["claude", "codex"] as const).map((harness) => ({ harness, outcome: goodOutcome[id], detail: "not under test" }))),
  };
  const lines: string[] = [];
  const reporter = createReporter((line) => lines.push(line));
  const notes: string[] = [];
  await Effect.runPromiseExit(Effect.scoped(runProbes(driver, makeStepRunner(reporter), { lead: { agentId: LEAD }, worker: { agentId: WORKER } }, (text) => notes.push(text))));
  const result = reporter.results().find((row) => row.id === probe);
  if (result === undefined) throw new Error(`probe ${probe} did not run: ${lines.join("\n")}`);
  return { passed: result.passed, reason: result.reason ?? "", lines: [...lines, ...notes], rows };
};

export const markerIn = (text: string): string => /"text":"([^"]+)"/.exec(text)?.[1] ?? "";
export const harnessOf = (agentId: string): Harness => agentId === LEAD ? "claude" : "codex";
export { agentOf };
