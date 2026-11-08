// Criterion 7.10 (unit 7a; rows 31, 52, 66; PB-A7, PB-A8; issues 153, 159):
// after SIGKILL, a restarted service removes the stale socket, listens,
// refuses every upgrade with HTTP 503 "recovering" until recovery step 9,
// then serves; a reloaded fake agent's tool call during its carry-on turn
// succeeds; the old token is refused. Issue 153: an adapter started by the
// killed service is recorded, and the restarted service's sweep stops its
// group. Issue 159: if recovery fails, the service exits non-zero and nothing
// listens. Both services are real child processes.
//
// The window before step 9 is held open by the fake agent's `loadGate`: the
// reloaded adapter does not answer its session/load until the test creates
// the gate file, so recovery waits in step 7 for as long as the test checks.
// The tool call reads the reloaded agent's token from the fake agent's own
// recorded environment (its echo file) and calls through the test client.
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, expect, it } from "@effect/vitest";
import type { EventEnvelope } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ancestryHeaders, authorization, connect, ownerBearer, upgradeStatus } from "../support/socketClient.ts";
import {
  agentToken, alive, makeServiceRoot, ownerClient, peekEcho, promptTexts, requestId, startFakeAgent, startService,
  stopAllServices, waitFor, waitServing, type ServiceProcess,
} from "../support/serviceProcess.ts";

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps the missing
// production modules from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout: number) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, timeout);
afterEach(async () => { await stopAllServices(); });

const answers = async (socket: string): Promise<boolean> => {
  try { await upgradeStatus(socket, {}); return true; } catch { return false; }
};

const killed = (service: ServiceProcess) => Effect.gen(function* () {
  service.child.kill("SIGKILL");
  return yield* Effect.promise(() => service.exit);
});

live("7.10 after SIGKILL the restarted service replaces the stale socket, refuses every upgrade with 503 recovering until step 9, sweeps the killed service's adapter, then serves the reloaded agent's carry-on tool call and refuses its old token (breaks if the stale socket blocks listening, any upgrade is served or 401'd during recovery, the sweep finds no process row, or the old token survives)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const gate = join(root.root, "load-gate");
    const first = startService(root);
    yield* waitServing(root, first);
    const owner = ownerBearer(root.state);

    const agent = yield* Effect.scoped(Effect.gen(function* () {
      const client = yield* ownerClient(root);
      const started = yield* startFakeAgent(root, client, client, {
        script: { outliveStdin: true, loadGate: gate, turns: [[{ step: "plan", entries: [] }, { step: "slow", ms: 60_000 }]] },
        prompt: "Work on the log.",
      });
      // The turn is committed as accepted before the crash, so the agent was working (row 52, step 6).
      const events = client.subscribe({ requestId: requestId(), after: 0 } as never) as Stream.Stream<EventEnvelope, unknown>;
      yield* events.pipe(
        Stream.takeUntil((envelope) => envelope.event._tag === "DeliveryAccepted" && envelope.agentId === started.agentId),
        Stream.runDrain, Effect.timeout(30_000),
      );
      return started;
    }));
    const before = yield* agentToken(agent);
    expect(promptTexts(before.echo).join("\n")).toContain("Work on the log.");

    const exit = yield* killed(first);
    expect(exit.signal).toBe("SIGKILL");
    expect(lstatSync(root.socket).isSocket(), "SIGKILL left no stale socket to remove").toBe(true);
    const staleInode = lstatSync(root.socket).ino;
    expect(yield* Effect.promise(() => answers(root.socket)), "a dead service's socket still answered").toBe(false);
    // Without a sweep the adapter would keep running: it outlives its closed input.
    expect(alive(before.pid), "the adapter died with the service, so the sweep cannot be observed").toBe(true);

    const second = startService(root);
    yield* waitFor("the restarted service to answer on its socket", () => {
      if (second.exited()) throw new Error("service exited");
      return answers(root.socket);
    }, 30_000);
    expect(lstatSync(root.socket).ino).not.toBe(staleInode);

    // Recovery is held in step 7 until the gate exists.
    const reloaded = yield* waitFor("the reloaded adapter to receive its load", () => {
      const echo = peekEcho(agent.echo);
      return echo !== undefined && echo.pid !== before.pid
        && echo.inbound.some((frame) => frame.method === "session/resume" || frame.method === "session/load") ? echo : undefined;
    }, 30_000);
    expect(existsSync(gate)).toBe(false);
    for (const headers of [
      { ...authorization(owner), ...ancestryHeaders() },
      { ...authorization(before.token), ...ancestryHeaders() },
      { ...ancestryHeaders() },
    ]) {
      const outcome = yield* Effect.promise(() => upgradeStatus(root.socket, headers));
      expect([Object.keys(headers).join(","), outcome.status, outcome.body.trim()]).toEqual([Object.keys(headers).join(","), 503, "recovering"]);
    }
    // Issue 153: step 5 ran before the reload, and stopped the killed service's adapter.
    yield* waitFor("the old adapter to be stopped by the sweep", () => !alive(before.pid), 15_000);

    writeFileSync(gate, "");
    yield* waitServing(root, second);
    const after = yield* agentToken(agent, before.pid);
    expect(after.pid).toBe(reloaded.pid);
    expect(after.token).not.toBe(before.token);
    yield* waitFor("the reloaded agent's carry-on prompt", () => {
      const echo = peekEcho(agent.echo);
      return echo !== undefined && echo.pid === after.pid && promptTexts(echo).length > 0;
    }, 30_000);

    // During the carry-on turn (the script's slow step), the new token calls a tool.
    const asked = yield* Effect.scoped(Effect.gen(function* () {
      const client = yield* connect(root.socket, after.token);
      return yield* client.ask({ requestId: requestId(), text: "Is the log done?" } as never) as Effect.Effect<{ questionId: string }, unknown>;
    }));
    expect(asked.questionId.length).toBeGreaterThan(0);
    expect(alive(after.pid)).toBe(true);
    const old = yield* Effect.promise(() => upgradeStatus(root.socket, { ...authorization(before.token), ...ancestryHeaders() }));
    expect(old.status).toBe(401);
    expect(old.body).not.toContain(before.token);
  }), 180_000);

// The service's database: the one SQLite file in the state folder with an events table.
const databaseIn = (folder: string): string => {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (!lstatSync(path).isFile() || name === "engine.lock") continue;
    if (readFileSync(path).subarray(0, 16).toString("latin1") !== "SQLite format 3\u0000") continue;
    const database = new DatabaseSync(path);
    try {
      if (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events'").all().length > 0) return path;
    } finally { database.close(); }
  }
  throw new Error("No event database in the state folder");
};

live("7.10 issue 159: when recovery fails the service exits non-zero, never serves, and leaves nothing listening (breaks if a failed recover is logged and the service stays up behind 503, or serves without recovery)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const first = startService(root);
    yield* waitServing(root, first);
    first.child.kill("SIGTERM");
    yield* Effect.promise(() => first.exit);

    // Fault injection: step 4's revocation of every agent token fails in SQLite.
    const database = new DatabaseSync(databaseIn(root.state));
    try {
      database.exec(`INSERT INTO agent_tokens (token_hash, agent_id, revoked_at) VALUES ('planted-hash', 'agent-planted', NULL);
        CREATE TRIGGER planted_revocation_failure BEFORE UPDATE ON agent_tokens BEGIN SELECT RAISE(ABORT, 'planted failure'); END;`);
    } finally { database.close(); }

    const second = startService(root);
    const statuses: Array<number> = [];
    const deadline = Date.now() + 60_000;
    while (!second.exited() && Date.now() < deadline) {
      // Not listening yet, or already closed, is no status at all.
      const status = yield* Effect.promise(() => upgradeStatus(root.socket, { ...authorization(ownerBearer(root.state)), ...ancestryHeaders() })
        .then((outcome) => outcome.status, () => undefined));
      if (status !== undefined) statuses.push(status);
      yield* Effect.sleep(25);
    }
    expect(second.exited(), "the service kept running after its recovery failed").toBe(true);
    const exit = yield* Effect.promise(() => second.exit);
    expect(exit.signal).toBeNull();
    expect(exit.code).not.toBe(0);
    expect(statuses.filter((status) => status !== 503)).toEqual([]);
    expect(yield* Effect.promise(() => answers(root.socket))).toBe(false);
  }), 120_000);
