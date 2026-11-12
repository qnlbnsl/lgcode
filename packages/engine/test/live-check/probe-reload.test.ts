// L-1 reload probe (PB-A7, PB-A8, PB-A11, PB-A12), adversarial. The probe's
// command-line reconnect runs the real CLI as a child process, so each test
// starts a real live service in a new /tmp folder (no adapter: it has no
// agents) for that reconnect to reach. The event log, the agent tokens and the
// restart itself are scripted by probe-fake-engine.ts; the real driver and the
// real outcome gate decide. A test marked "issue 222" fails today on purpose;
// see docs/issues.md.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { connect } from "@lgtm/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RESTART_ACTIVE_PROMPT, RESTART_PENDING_PROMPT, RESTART_PREPARE_PROMPT } from "../../scripts/live/prompts.ts";
import { startLiveService, type LiveService } from "../../scripts/live/service.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ALWAYS, ONCE, REJECT, fakeEngine, LEAD, markerIn, runProbe, WORKER, type FakeEngine, type Script } from "./probe-fake-engine.ts";

vi.mock("@lgtm/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@lgtm/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...original, connect: (options: Parameters<typeof original.connect>[0]) => (fakeConnect(options) ?? original.connect(options)) as never };
});

registerRebuildCheck({ noLog: true });

// Literal expected command, independently derived from the requested shell probe.
const HOLD = `'${process.execPath}' -e 'setTimeout(() => console.log("LCP_HOLD_DONE"), 120000)'`;
const services: LiveService[] = [];
const engines: FakeEngine[] = [];
const homes: string[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) engine.cleanup();
  for (const service of services.splice(0)) { await service.stop(); service.remove(); }
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const serving = async (service: LiveService) => {
  const until = Date.now() + 30_000;
  for (;;) {
    const result = await Effect.runPromiseExit(Effect.scoped(connect({ environment: { LGTM_HOME: service.state }, attempts: 1 })));
    if (result._tag === "Success") return;
    if (service.exited() || Date.now() > until) throw new Error("service did not serve: " + service.output());
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const onRealService = async (setup: { agents?: ReadonlyArray<string> } = {}) => {
  const engineHome = mkdtempSync("/tmp/lcpt-home-");
  homes.push(engineHome);
  const service = startLiveService({ HOME: engineHome, PATH: process.env.PATH });
  services.push(service);
  await serving(service);
  mkdirSync(join(service.work, "project"), { recursive: true });
  const engine = fakeEngine({ ...setup, at: service });
  engines.push(engine);
  return engine;
};

interface Reload {
  // Restart 1: a working turn is carried on. Restart 2: pending deliveries.
  readonly keepOldTokens?: (restart: number) => boolean;
  readonly endHoldEarly?: boolean;
  readonly carryOnCaller?: (agentId: string) => string;
  readonly second?: (engine: FakeEngine, agentId: string, pending: string) => void;
}

// Scripts both restart phases the way a correct engine and cooperative models
// would; each test changes one part to hand the probe misleading evidence.
const reload = (plan: Reload = {}): Script => {
  const markers = new Map<string, string>();
  const pending = new Map<string, string>();
  let counter = 0;
  return {
    onPrompt: (e, p) => {
      if (p.text.startsWith(RESTART_PENDING_PROMPT.slice(0, 30))) { pending.set(p.agentId, p.deliveryId); return; }
      if (p.text.startsWith(RESTART_PREPARE_PROMPT.slice(0, 40))) { markers.set(p.agentId, markerIn(p.text)); e.turnEnded(p.agentId); return; }
      if (p.text.startsWith(RESTART_ACTIVE_PROMPT.slice(0, 30))) {
        e.tool(p.agentId, `hold-${p.agentId}`, { command: HOLD });
        if (plan.endHoldEarly === true) e.turnEnded(p.agentId);
        return;
      }
      e.turnEnded(p.agentId);
    },
    onRestart: (e, restart) => {
      for (const agentId of [LEAD, WORKER]) {
        e.rotate(agentId, plan.keepOldTokens?.(restart) ?? false);
        if (restart === 1) {
          const session = `reload-1-${agentId}`;
          e.emit(agentId, { _tag: "SessionOpened", session: { sessionId: `s1-${agentId}` } }, { requestId: session });
          const carry = `carry-${++counter}`;
          e.emit(agentId, { _tag: "DeliveryQueued", delivery: { id: carry, target: agentId, content: { _tag: "carry-on" } } });
          e.emit(agentId, { _tag: "DeliverySent", deliveryId: carry });
          e.tool(agentId, `ask-${agentId}`, { server: "lgtm", tool: "ask", arguments: { text: markers.get(agentId) } }, "mcp__lgtm__ask");
          const caller = plan.carryOnCaller?.(agentId) ?? agentId;
          e.emit(caller, { _tag: "QuestionAsked", questionId: `q-${agentId}`, holder: { _tag: "owner" }, deliveryId: `qd-${agentId}`, text: markers.get(agentId) }, { caller: { _tag: "agent", agentId: caller } });
          e.turnEnded(agentId);
        } else if (plan.second !== undefined) {
          plan.second(e, agentId, pending.get(agentId)!);
        } else {
          // A correct reload: the replayed history holds the delivery, accepted
          // in the same transaction as the new session.
          const session = `reload-2-${agentId}`;
          e.emit(agentId, { _tag: "SessionOpened", session: { sessionId: `s2-${agentId}` } }, { requestId: session });
          e.emit(agentId, { _tag: "DeliveryAccepted", deliveryId: pending.get(agentId) }, { requestId: session });
          e.emit(agentId, { _tag: "DeliverySent", deliveryId: `carry-${++counter}` });
          e.turnEnded(agentId);
        }
      }
    },
  };
};

describe("reload (PB-A7, PB-A8, PB-A11, PB-A12) on a scripted engine and a real reconnect", () => {
  it("control: refused old tokens, a carry-on MCP call and a recovery receipt record found and pass", async () => {
    const engine = await onRealService();
    engine.script = reload();
    const run = await runProbe(engine, "reload");
    expect(run.reason).toBe("claude: old token refused; tool succeeds; found | codex: old token refused; tool succeeds; found");
  }, 60_000);

  it("fails when the engine still accepts the old token after the restart", async () => {
    const engine = await onRealService();
    engine.script = reload({ keepOldTokens: (restart) => restart === 1 });
    const run = await runProbe(engine, "reload");
    expect(run.passed).toBe(false);
    expect(run.reason).toContain("old token accepted");
  }, 60_000);

  it("fails when the hold turn ended before SIGKILL, so nothing was carried on", async () => {
    const engine = await onRealService();
    engine.script = reload({ endHoldEarly: true });
    const run = await runProbe(engine, "reload");
    expect(run.passed).toBe(false);
    expect(run.reason).toContain("hold turn ended before SIGKILL");
  }, 60_000);

  it("fails when the carry-on question comes from the other agent's identity", async () => {
    const engine = await onRealService();
    engine.script = reload({ carryOnCaller: (agentId) => agentId === LEAD ? WORKER : LEAD });
    const run = await runProbe(engine, "reload");
    expect(run.passed).toBe(false);
  }, 60_000);

  it("fails when recovery neither accepts nor re-queues the pending delivery", async () => {
    const engine = await onRealService();
    engine.script = reload({ second: (e, agentId) => {
      e.emit(agentId, { _tag: "SessionOpened", session: { sessionId: `s2-${agentId}` } }, { requestId: `reload-2-${agentId}` });
      e.emit(agentId, { _tag: "DeliverySent", deliveryId: `other-${agentId}` });
      e.turnEnded(agentId);
    } });
    const run = await runProbe(engine, "reload");
    expect(run.passed).toBe(false);
    expect(run.reason).toContain("attempted; failed");
  }, 60_000);

  it("fails when the pending delivery was accepted before the kill and recovery accepts it again", async () => {
    const engine = await onRealService();
    engine.script = reload({ second: (e, agentId, pending) => {
      e.emit(agentId, { _tag: "DeliveryAccepted", deliveryId: pending }, { requestId: `before-kill-${agentId}` });
      e.emit(agentId, { _tag: "SessionOpened", session: { sessionId: `s2-${agentId}` } }, { requestId: `reload-2-${agentId}` });
      e.emit(agentId, { _tag: "DeliveryAccepted", deliveryId: pending }, { requestId: `reload-2-${agentId}` });
      e.emit(agentId, { _tag: "DeliverySent", deliveryId: `carry-after-${agentId}` });
      e.turnEnded(agentId);
    } });
    expect((await runProbe(engine, "reload")).passed).toBe(false);
  }, 60_000);

  it("issue 222: fails when the pending delivery was accepted before the kill and then re-queued (a duplicate, not a re-send)", async () => {
    // The acceptance lands after the probe's pre-kill check read the log and
    // before SIGKILL. The probe never looks at the pre-kill acceptance again
    // and records "re-send on restart".
    const engine = await onRealService();
    engine.script = reload({ second: (e, agentId, pending) => {
      e.emit(agentId, { _tag: "DeliveryAccepted", deliveryId: pending }, { requestId: `before-kill-${agentId}` });
      e.emit(agentId, { _tag: "SessionOpened", session: { sessionId: `s2-${agentId}` } }, { requestId: `reload-2-${agentId}` });
      e.emit(agentId, { _tag: "DeliveryRequeued", deliveryId: pending });
      e.emit(agentId, { _tag: "DeliverySent", deliveryId: pending });
      e.turnEnded(agentId);
    } });
    const run = await runProbe(engine, "reload");
    expect(run.passed).toBe(false);
  }, 60_000);

  it("issue 222: the second restart's \"old token refused\" must test the tokens issued at the first reload", async () => {
    // Tokens issued at the first reload survive the second restart. The probe
    // re-tests only the tokens from before the first restart.
    const engine = await onRealService();
    engine.script = reload({ keepOldTokens: (restart) => restart === 2 });
    const run = await runProbe(engine, "reload");
    expect(run.passed).toBe(false);
  }, 60_000);
});

// Only the second-phase permission stream changes in these scripts. Recovery
// receipts, token rotation and the first carry-on stay identical to the control.
describe("m-7: permissions for a replayed pending hold", () => {
  it.each([
    { name: "one exact re-request per agent passes with allow-once", commands: [HOLD], passed: true, answers: [ONCE.id, ONCE.id] },
    { name: "a second exact re-request per agent is denied and fails", commands: [HOLD, HOLD], passed: false, answers: [ONCE.id, REJECT.id, ONCE.id, REJECT.id] },
    { name: "a different command is denied and fails", commands: [HOLD + "; id"], passed: false, answers: [REJECT.id, REJECT.id] },
  ])("$name", async ({ commands, passed, answers }) => {
    const engine = await onRealService();
    const waiting = new Map<string, { agent: string; call: string; next: number }>();
    const request = (e: FakeEngine, agent: string, next: number) => {
      const call = `replay-hold-${agent}-${next}`;
      e.tool(agent, call, { command: commands[next] });
      const id = e.permission(agent, call, [ALWAYS, ONCE, REJECT]);
      waiting.set(id, { agent, call, next: next + 1 });
    };
    const script = reload({ second: (e, agent, pending) => {
      const transaction = `reload-2-${agent}`;
      e.emit(agent, { _tag: "SessionOpened", session: { sessionId: `s2-${agent}` } }, { requestId: transaction });
      e.emit(agent, { _tag: "DeliveryAccepted", deliveryId: pending }, { requestId: transaction });
      e.emit(agent, { _tag: "DeliverySent", deliveryId: `carry-${agent}` });
      request(e, agent, 0);
    } });
    engine.script = { ...script, onAnswer: (e, answer) => {
      const item = waiting.get(answer.id)!;
      e.finish(item.agent, item.call, answer.optionId === ONCE.id ? "completed" : "failed", "");
      if (item.next < commands.length) request(e, item.agent, item.next);
      else e.turnEnded(item.agent);
    } };
    const result = await runProbe(engine, "reload");
    expect(result.passed).toBe(passed);
    // Requests are consumed serially, but the two agents can interleave.
    expect(engine.answers.map((a) => a.optionId).sort()).toEqual([...answers].sort());
    for (const agent of [LEAD, WORKER]) {
      const own = engine.answers.filter((a) => waiting.get(a.id)?.agent === agent).map((a) => a.optionId);
      expect(own).toEqual(commands.length === 2 ? [ONCE.id, REJECT.id] : [passed ? ONCE.id : REJECT.id]);
    }
    if (!passed) expect(result.reason).toContain("denied unexpected restart request");
  }, 60_000);
});

describe("issue 245: only the exact foreground Node hold can be replayed", () => {
  it.each([
    { name: "the two-minute Node shell command", input: { command: HOLD }, allowed: true },
    { name: "the former standalone sleep", input: { command: "sleep 120" }, allowed: false },
    { name: "a clock timer", input: { duration_ms: 120000 }, allowed: false },
    { name: "background execution of the exact command", input: { command: HOLD, run_in_background: true }, allowed: false },
  ])("$name", async ({ input, allowed }) => {
    const engine = await onRealService();
    const pending = new Map<string, { agent: string; call: string }>();
    const script = reload({ second: (e, agent, delivery) => {
      const transaction = `restart-${agent}`;
      e.emit(agent, { _tag: "SessionOpened", session: { sessionId: transaction } }, { requestId: transaction });
      e.emit(agent, { _tag: "DeliveryAccepted", deliveryId: delivery }, { requestId: transaction });
      e.emit(agent, { _tag: "DeliverySent", deliveryId: `carry-${agent}` });
      const call = `hold-again-${agent}`;
      e.tool(agent, call, input, "duration_ms" in input ? "clock.sleep" : "Terminal");
      pending.set(e.permission(agent, call, [ONCE, REJECT]), { agent, call });
    } });
    engine.script = { ...script, onAnswer: (e, answer) => {
      const { agent, call } = pending.get(answer.id)!;
      e.finish(agent, call, answer.optionId === ONCE.id ? "completed" : "failed", "");
      e.turnEnded(agent);
    } };
    const result = await runProbe(engine, "reload");
    expect(result.passed).toBe(allowed);
    expect(engine.answers.map((answer) => answer.optionId)).toEqual(allowed ? [ONCE.id, ONCE.id] : [REJECT.id, REJECT.id]);
    if (!allowed) expect(result.reason).toContain("denied unexpected restart request");
    const holds = engine.prompts.filter((p) => p.text.startsWith(RESTART_ACTIVE_PROMPT.slice(0, 30)) || p.text.startsWith(RESTART_PENDING_PROMPT.slice(0, 30)));
    expect(holds).toHaveLength(4);
    expect(holds.every((p) => p.text.includes(HOLD) && p.text.includes("the command takes about two minutes; wait for it"))).toBe(true);
  }, 60_000);
});

it("m-8: a stale first-reload token snapshot fails the distinct-generation guard before a second restart", async () => {
  const engine = await onRealService();
  const originalTokens = new Map(engine.tokenOf);
  const fromEntries = Object.fromEntries;
  let firstRestart = false;
  let restarts = 0;
  // Only the /proc environment decoder is stale. The actual token registry,
  // auth refusals, arguments and all carry-on events are unchanged.
  vi.spyOn(Object, "fromEntries").mockImplementation((entries) => {
    const environment = fromEntries(entries);
    if (firstRestart && environment.LGTM_SOCKET === join(engine.state, "engine.sock")) {
      const agent = [...engine.tokenOf].find(([, token]) => token === environment.LGTM_TOKEN)?.[0];
      if (agent !== undefined) environment.LGTM_TOKEN = originalTokens.get(agent);
    }
    return environment;
  });
  const script = reload();
  engine.script = { ...script, onRestart: (e, count) => {
    restarts = count;
    script.onRestart!(e, count);
    firstRestart = true;
  } };
  const result = await runProbe(engine, "reload");
  expect(result.passed).toBe(false);
  expect(result.reason).toContain("first-reload tokens were not captured before the second restart");
  expect(restarts).toBe(1);
}, 60_000);

describe("safety: the restart's SIGKILL reaches only the service the wrapper started", () => {
  it("a process this test started inside the run's folder survives the restart, and only the old service exits", async () => {
    const home = mkdtempSync("/tmp/lcpt-home-");
    homes.push(home);
    const first = startLiveService({ HOME: home, PATH: process.env.PATH });
    services.push(first);
    await serving(first);
    // Stands in for an adapter: it belongs to the run, but recovery, not the
    // restart, owns it. The test started it, so the test may stop it.
    const bystander = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: first.work, stdio: "ignore" });
    let signalled: string | null = null;
    bystander.once("exit", (_code, signal) => { signalled = signal; });
    try {
      const next = await first.restart!();
      services.push(next);
      await serving(next);
      expect(first.exited()).toBe(true);
      expect(next.pid).not.toBe(first.pid);
      expect(signalled).toBeNull();
      expect(bystander.exitCode).toBeNull();
      expect(() => process.kill(bystander.pid!, 0)).not.toThrow();
    } finally {
      bystander.kill("SIGKILL");
    }
  }, 60_000);
});
