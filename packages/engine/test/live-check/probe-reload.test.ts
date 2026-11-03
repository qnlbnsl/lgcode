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
import { connect } from "@shephrd/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RESTART_ACTIVE_PROMPT, RESTART_PENDING_PROMPT, RESTART_PREPARE_PROMPT } from "../../scripts/live/prompts.ts";
import { startLiveService, type LiveService } from "../../scripts/live/service.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { fakeEngine, LEAD, markerIn, runProbe, WORKER, type FakeEngine, type Script } from "./probe-fake-engine.ts";

vi.mock("@shephrd/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@shephrd/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...original, connect: (options: Parameters<typeof original.connect>[0]) => (fakeConnect(options) ?? original.connect(options)) as never };
});

registerRebuildCheck({ noLog: true });

const services: LiveService[] = [];
const engines: FakeEngine[] = [];
const homes: string[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) engine.cleanup();
  for (const service of services.splice(0)) { await service.stop(); service.remove(); }
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

const serving = async (service: LiveService) => {
  const until = Date.now() + 30_000;
  for (;;) {
    const result = await Effect.runPromiseExit(Effect.scoped(connect({ environment: { SHEPHRD_HOME: service.state }, attempts: 1 })));
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
        e.tool(p.agentId, `hold-${p.agentId}`, { command: "sleep 120" });
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
          e.tool(agentId, `ask-${agentId}`, { server: "shephrd", tool: "ask", arguments: { text: markers.get(agentId) } }, "mcp__shephrd__ask");
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
    expect(run.reason).toContain("not attempted");
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
