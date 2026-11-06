import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { call, headSequence, makeRig, ownerCredential, removeRig, seedAgent, success, type Rig } from "../support/handlerRig.ts";
import { append, awaitRaised, barrier, clientView, eventsOf, permission, question, quietLists, raised, withAlerts } from "../support/alertsRig.ts";

interface CrashPoint { readonly phase: string; readonly questionId: string; readonly sourceSequence: number; readonly staged: number }
const killAt = async (rig: Rig, mode: "source" | "baseline") => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../support/alertCrashChild.ts", import.meta.url)), JSON.stringify(rig), mode], {
    env: { PATH: process.env.PATH, HOME: rig.home, SHEPRD_HOME: rig.stateFolder }, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const exited = once(child, "exit");
  let errors = "";
  child.stderr?.on("data", (data) => { errors += String(data); });
  try {
    const message = await new Promise<CrashPoint>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`crash fixture missed ${mode} boundary: ${errors}`)), 15_000);
      child.once("message", (value) => { clearTimeout(timer); resolve(value as CrashPoint); });
      child.once("error", () => { clearTimeout(timer); reject(new Error("crash fixture failed to start")); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`crash fixture exited before ${mode}: ${errors}`)); });
    });
    expect(message.phase).toBe(mode === "source" ? "source-read" : "baseline-uncommitted");
    if (mode === "baseline") expect(message.staged).toBe(3);
    child.kill("SIGKILL");
    expect((await exited)[1]).toBe("SIGKILL");
    return message;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
};

it("FR-075 SIGKILL after an active follower reads the source, before its write, recovers one reaction across two reopens", async () => {
  const rig = makeRig();
  try {
    const message = await killAt(rig, "source");
    const database = new DatabaseSync(rig.database, { readOnly: true });
    try {
      const sources = database.prepare("SELECT sequence FROM events WHERE json_extract(payload_json, '$._tag') = 'OwnerNeeded'").all();
      expect(sources).toEqual([{ sequence: message.sourceSequence }]);
      expect(database.prepare("SELECT COUNT(*) AS count FROM events WHERE json_extract(payload_json, '$._tag') = 'client.AlertRaised'").get()).toMatchObject({ count: 0 });
    } finally { database.close(); }
    let alertId = "";
    for (const reopening of [1, 2]) await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const rows = yield* awaitRaised(`question:${message.questionId}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.event.baseline).not.toBe(true);
      expect(rows[0]!.event.sourceSequence).toBe(message.sourceSequence);
      if (reopening === 1) alertId = rows[0]!.event.alertId;
      expect(rows[0]!.event.alertId).toBe(alertId);
      const later = yield* barrier(`source-reopen-${reopening}`);
      expect(yield* raised(`question:${message.questionId}`)).toHaveLength(1);
      expect((yield* clientView).position).toBe(later[0]!.event.sourceSequence);
      expect(yield* eventsOf("client.AlertBaseline")).toHaveLength(1);
    }), { rig, initialize: false });
  } finally { removeRig(rig); }
});

it("FR-075 SIGKILL inside the baseline transaction leaves no partial scan and retries it completely", async () => {
  const rig = makeRig();
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "worker", state: "working" });
      yield* question(); yield* permission();
    }), { rig, lists: quietLists() });
    await killAt(rig, "baseline");
    const database = new DatabaseSync(rig.database, { readOnly: true });
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM events WHERE json_extract(payload_json, '$._tag') IN ('client.AlertBaseline', 'client.AlertRaised')").get()).toMatchObject({ count: 0 });
    } finally { database.close(); }
    let baselineIds: string[] = [];
    for (const reopening of [1, 2]) await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const rows = (yield* raised()).filter((row) => row.event.baseline);
      expect(rows.map((row) => row.event.alertKey).sort()).toEqual(["permission:request-1", "question:question-1"]);
      const baseline = yield* eventsOf("client.AlertBaseline");
      expect(baseline).toHaveLength(1);
      expect(rows.every((row) => row.requestId === baseline[0]!.requestId)).toBe(true);
      if (reopening === 1) baselineIds = rows.map((row) => row.event.alertId);
      expect(rows.map((row) => row.event.alertId)).toEqual(baselineIds);
      const later = yield* barrier(`baseline-reopen-${reopening}`);
      expect((yield* clientView).position).toBe(later[0]!.event.sourceSequence);
      expect(later[0]!.event.sourceSequence).toBeGreaterThan(baseline[0]!.event.position);
      expect((yield* raised()).filter((row) => row.event.baseline)).toHaveLength(2);
    }), { rig, initialize: false });
  } finally { removeRig(rig); }
});

it("6.3 reopening after source COMMIT but before the reactor write creates exactly one alert, even after another restart", async () => {
  const rig = makeRig();
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "worker", state: "working" });
      yield* append({ _tag: "client.AlertBaseline", position: yield* headSequence });
      yield* question();
      expect(yield* raised()).toEqual([]);
      // Closing this scope drops all volatile state before the new service.
    }), { rig, lists: quietLists() });
    let alertId = "";
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const rows = yield* awaitRaised("question:question-1");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.event.baseline).not.toBe(true);
      alertId = rows[0]!.event.alertId;
    }), { rig, initialize: false });
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect(yield* barrier()).toHaveLength(1);
      const rows = yield* raised("question:question-1");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.event.alertId).toBe(alertId);
      expect(yield* eventsOf("client.AlertBaseline")).toHaveLength(1);
    }), { rig, initialize: false });
  } finally { removeRig(rig); }
});

it.each(["permission", "question", "crash", "sign-in", "usage"] as const)(
  "6.1 replay skips a historical %s source whose current subject is closed", async (kind) => {
    const rig = makeRig();
    try {
      await withAlerts(() => Effect.gen(function* () {
        yield* registerRebuildCheck();
        yield* seedAgent({ id: "worker", state: "working" });
        yield* append({ _tag: "client.AlertBaseline", position: yield* headSequence });
        if (kind === "permission") {
          yield* permission();
          yield* append({ _tag: "PermissionCancelled", agentId: "worker", permissionRequestId: "request-1", reason: "agent stopped" });
        } else if (kind === "question") {
          yield* question();
          yield* append({ _tag: "QuestionAnswered", agentId: "worker", questionId: "question-1", answeredBy: { _tag: "owner" }, text: "Use foundation.", deliveryId: "answer-1" });
        } else if (kind === "crash") {
          yield* append({ _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "Historical crash." },
            { _tag: "OwnerNeeded", agentId: "worker", reason: "agent crashed" },
            { _tag: "StateChanged", agentId: "worker", state: { _tag: "idle" } });
        } else {
          yield* append(kind === "sign-in" ? { _tag: "AccountNeedsSignIn", accountId: "primary", reason: "account needs sign-in" }
            : { _tag: "AccountOutOfUsage", accountId: "primary" });
          yield* append({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" });
        }
      }), { rig, lists: quietLists() });
      await withAlerts(() => Effect.gen(function* () {
        yield* registerRebuildCheck();
        expect(yield* barrier()).toHaveLength(1);
        expect((yield* raised()).filter((row) => row.event.alertKey !== "question:barrier")).toEqual([]);
      }), { rig, initialize: false });
    } finally { removeRig(rig); }
  },
);

it("6.2 dismiss during reactor lag cannot advance position past an unhandled source", async () => {
  const rig = makeRig();
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAgent({ id: "worker", state: "working" });
      yield* append({ _tag: "client.AlertBaseline", position: yield* headSequence });
      const old = yield* question("worker", "old");
      yield* append({ _tag: "client.AlertRaised", alertId: "old-alert", alertKey: "question:old", kind: "question", agentId: "worker",
        subject: { _tag: "question", id: "old" }, title: "A question needs your answer", sourceSequence: old.at(-1)!.sequence });
      yield* question("worker", "unhandled");
      const before = yield* clientView;
      expect(before.position).toBe(old.at(-1)!.sequence);
      success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: "old-alert" }));
      const after = yield* clientView;
      expect(after.position).toBe(before.position);
      const ends = yield* eventsOf("client.AlertCleared");
      expect(ends).toHaveLength(1);
      expect(ends[0]!.event).not.toHaveProperty("sourceSequence");
    }), { rig, lists: quietLists() });
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect(yield* awaitRaised("question:unhandled")).toHaveLength(1);
      expect(yield* raised("question:old")).toHaveLength(1);
    }), { rig, initialize: false });
  } finally { removeRig(rig); }
});
