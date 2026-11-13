import { smtpServer } from "../support/smtpServer.ts";
import { randomUUID } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";
import { alertLog, append, awaitRaised } from "../support/alertsRig.ts";
import { configure, delivered, ntfyServer, posts, raiseQuestion, setToken, storedValues, withCarrier } from "../support/carrierRig.ts";
import { call, makeRig, ownerCredential, removeRig, seedAgent, success } from "../support/handlerRig.ts";
import { eventually, pause, snapshot } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const emailSettings = (port: number) => ({ _tag: "email", host: "127.0.0.1", port, security: "plain", username: "local-user", from: "owner@local.test", to: "owner@local.test" });
const setupEmail = (port: number, secret: string) => Effect.gen(function* () {
  success(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: emailSettings(port) }));
  success(yield* call(ownerCredential, "client.alerts.carrier.set-token", { name: "email", origin: JSON.stringify(["127.0.0.1", port, "plain", "local-user"]), nonce: randomUUID(), value: Redacted.make(secret) }));
});

it("email uses the owner's SMTP server, reports acceptance and rejection, and never returns or records its secret", async () => {
  const smtp = await smtpServer(); const secret = randomUUID(); const lines: string[] = [];
  try { await withCarrier((rig) => Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* setupEmail(smtp.port, secret);
    const before = yield* alertLog;
    expect(success(yield* call(ownerCredential, "client.alerts.test", { name: "email" }))).toMatchObject({ accepted: true });
    expect(smtp.messages).toHaveLength(1); expect(smtp.messages[0]).toContain("LGTM Studio test notification");
    const settings = success(yield* call(ownerCredential, "client.alerts.settings", {}));
    expect(settings.carriers).toContainEqual({ name: "email", enabled: true, carrier: emailSettings(smtp.port), tokenSet: true });
    expect(Object.values(storedValues(rig))).toContain(secret);
    expect(JSON.stringify({ settings, snapshot: yield* snapshot, events: yield* alertLog, lines })).not.toContain(secret);
    expect(yield* alertLog).toEqual(before);
    smtp.reject(); expect(success(yield* call(ownerCredential, "client.alerts.test", { name: "email" }))).toMatchObject({ accepted: false, reason: "carrier delivery failed" });
    expect(JSON.stringify(yield* alertLog)).not.toContain("private rejection");
  }), { lines }); } finally { await smtp.close(); }
});

it("both enabled carriers receive alerts independently, and disabling email leaves ntfy on", async () => {
  const smtp = await smtpServer(); const ntfy = await ntfyServer();
  ntfy.respond(({ response }) => { response.writeHead(503); response.end(); });
  try { await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configure(ntfy.origin); yield* setToken(ntfy.origin, randomUUID()); yield* setupEmail(smtp.port, randomUUID());
    const id = yield* raiseQuestion("both-carriers");
    yield* delivered(id); expect(smtp.messages).toHaveLength(1); expect(posts(ntfy)).toHaveLength(1);
    const page = success(yield* call(ownerCredential, "client.alerts.list", { after: 0, limit: 100 }));
    expect(page.items.find((row: any) => row.alertId === id).deliveries).toEqual(expect.arrayContaining([expect.objectContaining({ carrier: "email", status: "delivered" }), expect.objectContaining({ carrier: "ntfy", status: "failed" })]));
    success(yield* call(ownerCredential, "client.alerts.carrier.enabled.set", { name: "email", enabled: false }));
    const settings = success(yield* call(ownerCredential, "client.alerts.settings", {}));
    expect(settings.carriers.find((c: any) => c.name === "ntfy").enabled).toBe(true);
    expect(settings.carriers.find((c: any) => c.name === "email").enabled).toBe(false);
  })); } finally { await smtp.close(); await ntfy.close(); }
});

it("quiet hours hold alerts until the end in the chosen time zone, and the failure override is honored", async () => {
  const ntfy = await ntfyServer(); const start = Date.parse("2026-11-13T04:59:00Z");
  try { await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configure(ntfy.origin); yield* setToken(ntfy.origin, randomUUID());
    success(yield* call(ownerCredential, "client.alerts.quiet.set", { quiet: { enabled: true, start: "22:00", end: "23:00", timeZone: "America/Chicago", failureOverride: true } }));
    const id = yield* raiseQuestion("quiet-question"); yield* pause(30); expect(posts(ntfy)).toHaveLength(0);
    yield* seedAgent({ id: "failed-agent", state: "working" });
    yield* append({ _tag: "AgentCrashed", agentId: "failed-agent", exitCode: 1, signal: null, stderr: "test crash" });
    yield* append({ _tag: "OwnerNeeded", agentId: "failed-agent", reason: "agent crashed" });
    yield* eventually(Effect.sync(() => posts(ntfy)), (rows) => rows.length === 1);
    yield* TestClock.adjust(60_000); yield* delivered(id); expect(posts(ntfy)).toHaveLength(2);
    expect(yield* call(ownerCredential, "client.alerts.quiet.set", { quiet: { enabled: true, start: "25:00", end: "07:00", timeZone: "Not/AZone", failureOverride: false } })).toMatchObject({ _tag: "Failure" });
  }), { clockAt: start }); } finally { await ntfy.close(); }
});

it("sprint completion and an opened main merge review raise their notification kinds", async () => {
  await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* append({ _tag: "project.SprintCompleted", projectId: "project-notify", sprintId: "sprint-notify", completion: "done", evidence: "test" });
    expect(yield* awaitRaised("sprint:project-notify:sprint-notify")).toHaveLength(1);
    const review = { reviewId: "merge-notify", projectId: "project-notify", worktreeId: "worktree-notify", destinationId: "main-worktree",
      head: "aaa", baseHead: "bbb", branch: "feature", base: "main", evidence: { tests: { state: "missing", report: null }, review: { state: "missing", report: null } },
      openedAt: 1_800_000_000_000, decision: null, outcome: "open", mergeHead: null, reason: null, decidedAt: null };
    yield* append({ _tag: "project.MainReviewOpened", review });
    const raised = yield* awaitRaised("merge:merge-notify"); expect(raised).toHaveLength(1);
    yield* append({ _tag: "project.MainReviewDecided", review: { ...review, outcome: "refused", decidedAt: 1_800_000_000_001 } });
    const cleared = yield* eventually(snapshot, (state) => (state.client as any).alerts[raised[0]!.event.alertId]?.status === "cleared");
    expect((cleared.client as any).alerts[raised[0]!.event.alertId]?.status).toBe("cleared");
    expect(success(yield* call(ownerCredential, "client.alerts.settings", {})).kinds).toEqual(expect.arrayContaining([{ kind: "sprint", push: false }, { kind: "merge", push: true }]));
  }));
});

it("email credentials survive replay, are retired on destination change, and are unavailable to other actors", async () => {
  const smtp = await smtpServer(), rig = makeRig(), secret = randomUUID();
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* setupEmail(smtp.port, secret);
    }), { rig });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect(success(yield* call(ownerCredential, "client.alerts.test", { name: "email" }))).toMatchObject({ accepted: true });
      const worker = yield* seedAgent({ id: "private-settings-worker", state: "working" });
      const { agentCredential } = yield* Effect.promise(() => import("../support/handlerRig.ts"));
      for (const command of ["client.alerts.settings", "client.alerts.carrier.enabled.set", "client.alerts.quiet.set", "client.alerts.test"]) {
        expect(yield* call(agentCredential(worker.token), command, { name: "email", enabled: false })).toMatchObject({ _tag: "Failure" });
      }
      success(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: { ...emailSettings(smtp.port), username: "replacement-user" } }));
      expect(success(yield* call(ownerCredential, "client.alerts.test", { name: "email" }))).toMatchObject({ accepted: false, reason: "token missing" });
      expect(yield* eventually(Effect.sync(() => Object.values(storedValues(rig))), (values) => !values.includes(secret))).not.toContain(secret);
      expect(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: { ...emailSettings(smtp.port), host: "mail.example.test" } })).toMatchObject({ _tag: "Failure" });
    }), { rig, initialize: false });
  } finally { await smtp.close(); removeRig(rig); }
});

it("quiet hours respect daytime windows, overnight windows and daylight-saving transitions", async () => {
  registerRebuildCheck({ noLog: true });
  const { quietNow, validQuietHours } = await import("../../src/client/alerts/quiet.ts");
  const quiet = { enabled: true, start: "22:00", end: "07:00", timeZone: "America/Chicago", failureOverride: false };
  expect(quietNow(quiet, "failure", Date.parse("2026-11-01T07:30:00Z"))).toBe(true);
  expect(quietNow(quiet, "question", Date.parse("2026-11-01T13:00:00Z"))).toBe(false);
  expect(quietNow({ ...quiet, failureOverride: true }, "failure", Date.parse("2026-11-01T07:30:00Z"))).toBe(false);
  expect(quietNow({ ...quiet, start: "09:00", end: "17:00" }, "question", Date.parse("2026-11-13T16:00:00Z"))).toBe(true);
  expect(validQuietHours({ ...quiet, start: "07:00" })).toBe(false);
  expect(validQuietHours({ ...quiet, timeZone: "Invalid/Zone" })).toBe(false);
});

it("an SMTP rejection does not block ntfy, and email retries use their own delivery identity", async () => {
  const smtp = await smtpServer(), ntfy = await ntfyServer(); smtp.reject();
  try { await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configure(ntfy.origin); yield* setToken(ntfy.origin, randomUUID()); yield* setupEmail(smtp.port, randomUUID());
    const id = yield* raiseQuestion("smtp-failed");
    const rows = yield* eventually(call(ownerCredential, "client.alerts.list", { after: 0, limit: 100 }).pipe(Effect.map((reply) => success(reply).items)), (rows) => rows.find((row: any) => row.alertId === id)?.deliveries?.length === 2);
    const deliveries = rows.find((row: any) => row.alertId === id).deliveries;
    expect(deliveries).toEqual(expect.arrayContaining([expect.objectContaining({ carrier: "ntfy", status: "delivered" }), expect.objectContaining({ carrier: "email", status: "failed" })]));
    const mark = deliveries.find((mark: any) => mark.carrier === "email");
    expect(success(yield* call(ownerCredential, "client.alerts.retry", { name: "email", alertId: id, generation: mark.generation, attempt: mark.attempt }))).toMatchObject({ accepted: false, reason: "carrier delivery failed" });
    expect(posts(ntfy)).toHaveLength(1);
  }), { clockAt: 1_800_000_000_000 }); } finally { await smtp.close(); await ntfy.close(); }
});
