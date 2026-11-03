// Failure rule 7: leftover processes after a hard crash. The runner records
// each adapter's process group and start time. On the next start the engine
// stops any recorded group that is still alive, after checking the start time,
// so it never stops an unrelated program that reused the number. Issue 153
// (recording and removing process rows) is fixed; these scenarios rely on it.
// Criteria 8.3 to 8.5.
import { spawn } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  alive, eventsUntil, isTag, peekEcho, runSql, scenario, stopAllServices, waitFor,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

scenario("7 leftovers: after the service is killed its adapter and the adapter's own child keep running, and the restarted service stops both before it serves (breaks if the restart leaves a recorded adapter or its child running, or the process record is never written)", (w) => Effect.gen(function* () {
  const agent = yield* w.start(w.owner, {
    name: "Leaver", permission: "ask", prompt: "Work.",
    script: { outliveStdin: true, turns: [[{ step: "plan", entries: [] }, { step: "spawn_grandchild" }, { step: "slow", ms: 60_000 }]] },
  });
  yield* eventsUntil(w.owner, 0, "the work to be taken", isTag("DeliveryAccepted", agent.agentId));
  const { pid } = yield* w.token(agent);
  const grandchild = yield* waitFor("the adapter's child to be recorded", () =>
    (peekEcho(agent.echo) as unknown as { grandchildPids?: number[] } | undefined)?.grandchildPids?.[0]);

  yield* w.kill("SIGKILL");
  // Without a sweep these would run on: the adapter outlives its closed input.
  expect(alive(pid), "the adapter died with the service, so the sweep cannot be observed").toBe(true);
  expect(alive(grandchild), "the adapter's child died with the service, so the sweep cannot be observed").toBe(true);

  yield* w.boot();
  yield* waitFor("the old adapter and its child to be stopped", () => (!alive(pid) && !alive(grandchild) ? true : undefined), 20_000);
  // The agent itself is back, on a new process.
  const reloaded = yield* waitFor("the reloaded adapter", () => {
    const echo = peekEcho(agent.echo);
    return echo !== undefined && echo.pid !== pid ? echo : undefined;
  }, 30_000);
  expect(alive(reloaded.pid)).toBe(true);
  expect(reloaded.pid).not.toBe(pid);
}));

scenario("7 leftovers: a recorded group whose number now belongs to an unrelated program is left alone, and the same record with the right start time is stopped (breaks if the sweep signals a process by its number without checking the recorded start time, or never reads the records)", (w) => Effect.gen(function* () {
  // The agent only exists so that the first service has written its records; the bystander is a program this test starts.
  const agent = yield* w.start(w.owner, { name: "Bystander's neighbour", permission: "ask", prompt: "Hello." });
  yield* eventsUntil(w.owner, 0, "the first turn", isTag("TurnEnded", agent.agentId));
  const bystander = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  bystander.unref();
  const bystanderPid = bystander.pid!;
  yield* Effect.addFinalizer(() => Effect.sync(() => { try { process.kill(bystanderPid, "SIGKILL"); } catch { /* already gone */ } }));
  yield* waitFor("the bystander to run", () => (alive(bystanderPid) ? true : undefined));

  yield* w.kill("SIGKILL");
  // A record that names the bystander's group and everything about it correctly except the start time.
  const stat = readFileSync(`/proc/${bystanderPid}/stat`, "utf8");
  const realStart = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const executable = readlinkSync(`/proc/${bystanderPid}/exe`).replaceAll("'", "''");
  const record = (startTime: string) => runSql(w.root, `INSERT INTO processes (agent_id, group_id, boot_id, start_time, user_id, executable)
    VALUES ('00000000-0000-4000-8000-000000000000', ${bystanderPid}, '${bootId}', '${startTime}', ${process.getuid!()}, '${executable}')`);
  record(String(Number(realStart) - 1));

  yield* w.boot();
  // The restarted service has finished recovery, including its sweep. Its own adapter for the agent is up.
  yield* waitFor("the reloaded adapter", () => {
    const echo = peekEcho(agent.echo);
    return echo !== undefined && echo.inbound.some((frame) => frame.method === "session/load" || frame.method === "session/resume") ? echo : undefined;
  }, 30_000);
  expect(alive(bystanderPid), "the sweep stopped an unrelated program that only shared a recorded group number").toBe(true);

  // Control: with the right start time the same record is the bystander's own, and the sweep does stop it.
  // This shows the start time was the deciding fact, not a record that was never read.
  yield* w.kill("SIGKILL");
  record(realStart);
  yield* w.boot();
  yield* waitFor("the sweep to stop the bystander once its record is right", () => (alive(bystanderPid) ? undefined : true), 20_000);
}));
