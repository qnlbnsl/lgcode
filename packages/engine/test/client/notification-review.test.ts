import { randomUUID } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";
import { quietNow } from "../../src/client/alerts/quiet.ts";
import { clientPieceView, emptyClientView } from "../../src/client/alerts/view.ts";
import { alertLog } from "../support/alertsRig.ts";
import { configure, delivered, failed, ntfyServer, posts, raiseQuestion, setToken, storedValues, withCarrier } from "../support/carrierRig.ts";
import { call, makeRig, ownerCredential, removeRig, success } from "../support/handlerRig.ts";
import { eventually, pause, snapshot } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { smtpServer } from "../support/smtpServer.ts";

const email = (port: number) => ({ _tag: "email" as const, host: "127.0.0.1", port, security: "plain" as const, username: "local-user", from: "owner@local.test", to: "owner@local.test" });
const settings = () => call(ownerCredential, "client.alerts.settings", {}).pipe(Effect.map(success));
const alerts = () => call(ownerCredential, "client.alerts.list", { after: 0, limit: 100 }).pipe(Effect.map((reply) => success(reply).items));
const configureEmail = (port: number) => Effect.gen(function* () {
  success(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: email(port) }));
  success(yield* call(ownerCredential, "client.alerts.carrier.set-token", { name: "email", origin: JSON.stringify(["127.0.0.1", port, "plain", "local-user"]), nonce: randomUUID(), value: Redacted.make("synthetic-review-password") }));
  success(yield* call(ownerCredential, "client.alerts.carrier.enabled.set", { name: "email", enabled: true }));
});
const quiet = { enabled: true, start: "22:00", end: "07:00", timeZone: "UTC", failureOverride: false };
const clockAt = Date.parse("2026-11-13T23:00:00Z");

it("review 1: a sender-only save preserves delivery identity, a recipient change resends, and a save preserves off", async () => {
  const smtp = await smtpServer();
  try { await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configureEmail(smtp.port);
    const id = yield* raiseQuestion("save-email"); yield* delivered(id);
    const before = (yield* alerts()).find((row: any) => row.alertId === id).deliveries;
    for (const carrier of [email(smtp.port), { ...email(smtp.port), from: "new-sender@local.test" }]) {
      success(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier }));
      yield* pause(25);
      expect((yield* alerts()).find((row: any) => row.alertId === id).deliveries).toEqual(before);
      expect(smtp.messages).toHaveLength(1);
    }
    success(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: { ...email(smtp.port), to: "new-recipient@local.test" } }));
    yield* delivered(id, 2); expect(smtp.messages).toHaveLength(2);
    success(yield* call(ownerCredential, "client.alerts.carrier.enabled.set", { name: "email", enabled: false }));
    success(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: email(smtp.port) }));
    expect((yield* settings()).carriers.find((c: any) => c.name === "email").enabled).toBe(false);
    yield* pause(25); expect(smtp.messages).toHaveLength(2);
  })); } finally { await smtp.close(); }
});

it.each(["host", "port", "security", "username", "to"])("review 1: changing email %s invalidates its prior delivery", (field) => {
  registerRebuildCheck({ noLog: true });
  const carrier = email(2525), mark = { status: "delivered", generation: 1, attempt: 1, sequence: 2 };
  const view = { ...emptyClientView(), destinations: { email: { carrier, enabled: false, tokenSet: false, generation: 1, delivery: { alert: mark } } } };
  const changed = { ...carrier, [field]: ({ host: "mail.example.test", port: 2526, security: "starttls", username: "new-user", to: "other@local.test" } as Record<string, unknown>)[field] };
  const next = clientPieceView.reduce(view, { _tag: "client.AlertDestinationChanged", name: "email", carrier: changed }, 3) as typeof view;
  expect(next.destinations.email.delivery).toEqual({});
  expect(next.destinations.email.generation).toBe(3);
  expect(next.destinations.email.enabled).toBe(false);
});

it("review 1 and 8: ntfy saves preserve off, and enabling sends an alert raised while off exactly once", async () => {
  const ntfy = await ntfyServer();
  try { await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configure(ntfy.origin); yield* setToken(ntfy.origin, randomUUID());
    success(yield* call(ownerCredential, "client.alerts.carrier.enabled.set", { name: "ntfy", enabled: false }));
    const id = yield* raiseQuestion("raised-while-off"); yield* pause(30); expect(posts(ntfy)).toHaveLength(0);
    yield* configure(ntfy.origin);
    expect((yield* settings()).carriers.find((c: any) => c.name === "ntfy").enabled).toBe(false);
    yield* pause(30); expect(posts(ntfy)).toHaveLength(0);
    success(yield* call(ownerCredential, "client.alerts.carrier.enabled.set", { name: "ntfy", enabled: true }));
    yield* delivered(id); yield* pause(30); expect(posts(ntfy)).toHaveLength(1);
  })); } finally { await ntfy.close(); }
});

it.each(["failure", "account", "client.web-down"])("review 2: the urgent override includes %s", (kind) => {
  registerRebuildCheck({ noLog: true });
  expect(quietNow({ ...quiet, failureOverride: true }, kind, clockAt)).toBe(false);
  expect(quietNow(quiet, kind, clockAt)).toBe(true);
  expect(quietNow({ ...quiet, failureOverride: true }, "question", clockAt)).toBe(true);
});

it("review 3: a changed credential destination reports the retired password and turns email off", async () => {
  const smtp = await smtpServer();
  try { await withCarrier((rig) => Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configureEmail(smtp.port);
    const reply = success(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: { ...email(smtp.port), username: "new-user" } }));
    expect(reply).toMatchObject({ enabled: false, tokenSet: false, passwordRequired: true });
    expect((yield* settings()).carriers.find((c: any) => c.name === "email")).toMatchObject({ enabled: false, tokenSet: false });
    expect(yield* eventually(Effect.sync(() => Object.values(storedValues(rig))), (values) => !values.includes("synthetic-review-password"))).not.toContain("synthetic-review-password");
  })); } finally { await smtp.close(); }
});

it("review 5: removing email retires its password, settings and delivery state without changing ntfy", async () => {
  const smtp = await smtpServer(), ntfy = await ntfyServer();
  try { await withCarrier((rig) => Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configure(ntfy.origin); yield* setToken(ntfy.origin, "synthetic-ntfy-token"); yield* configureEmail(smtp.port);
    success(yield* call(ownerCredential, "client.alerts.carrier.remove", { name: "email" }));
    const carriers = (yield* settings()).carriers;
    expect(carriers.find((c: any) => c.name === "email")).toMatchObject({ carrier: { _tag: "none" }, enabled: false, tokenSet: false });
    expect(carriers.find((c: any) => c.name === "ntfy")).toMatchObject({ enabled: true, tokenSet: true });
    expect(yield* eventually(Effect.sync(() => Object.values(storedValues(rig))), (values) => !values.includes("synthetic-review-password"))).not.toContain("synthetic-review-password");
    const id = yield* raiseQuestion("after-email-removal"); yield* delivered(id); expect(smtp.messages).toHaveLength(0); expect(posts(ntfy)).toHaveLength(1);
  })); } finally { await smtp.close(); await ntfy.close(); }
});

it.each([
  ["2026-03-07T15:30:00Z", true], ["2026-03-09T15:30:00Z", false], ["2026-03-09T14:30:00Z", true],
  ["2026-10-31T14:30:00Z", true], ["2026-11-02T14:30:00Z", false], ["2026-11-02T15:30:00Z", true],
] as const)("review 8: Chicago daytime quiet hours at %s follow daylight-saving changes", (instant, held) => {
  registerRebuildCheck({ noLog: true });
  expect(quietNow({ ...quiet, start: "09:00", end: "10:00", timeZone: "America/Chicago" }, "question", Date.parse(instant))).toBe(held);
});

it.each(["from", "to"])("review 8: email refuses carriage returns and line feeds in %s", async (field) => {
  await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    for (const value of ["owner@local.test\rBcc: other@local.test", "owner@local.test\nBcc: other@local.test"]) {
      expect(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: { ...email(2525), [field]: value } })).toMatchObject({ _tag: "Failure" });
    }
  }));
});

it("review 7 and 8: a failed email retry is held during quiet hours and recovers after restart", async () => {
  const smtp = await smtpServer(), rig = makeRig(), lines: string[] = []; smtp.reject(); let id: string;
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configureEmail(smtp.port); id = yield* raiseQuestion("restart-failed-email"); yield* failed(id);
      const mark = (yield* alerts()).find((row: any) => row.alertId === id).deliveries.find((d: any) => d.carrier === "email");
      success(yield* call(ownerCredential, "client.alerts.quiet.set", { quiet }));
      const reply = yield* call(ownerCredential, "client.alerts.retry", { name: "email", alertId: id, generation: mark.generation, attempt: mark.attempt });
      expect(reply).toMatchObject({ _tag: "Failure", failure: { reason: "This alert is held during quiet hours." } });
      expect(smtp.authAttempts()).toBe(1);
      expect(JSON.stringify({ reply, events: yield* alertLog, lines })).not.toContain("private rejection");
      expect((yield* alerts()).find((row: any) => row.alertId === id)).toMatchObject({ held: true });
    }), { rig, clockAt, lines });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const row = (yield* alerts()).find((row: any) => row.alertId === id);
      expect(row).toMatchObject({ held: true, deliveries: [expect.objectContaining({ carrier: "email", status: "failed", attempt: 1 })] });
      success(yield* call(ownerCredential, "client.alerts.quiet.set", { quiet: { ...quiet, enabled: false } }));
      yield* TestClock.adjust(60_000); yield* failed(id!, 2);
      const retried = (yield* alerts()).find((row: any) => row.alertId === id).deliveries[0];
      expect(retried).toMatchObject({ status: "failed", reason: "carrier delivery failed" });
      expect(retried.attempt).toBeGreaterThanOrEqual(2);
      expect(smtp.authAttempts()).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify({ events: yield* alertLog, lines })).not.toContain("private rejection");
    }), { rig, initialize: false, clockAt, lines });
  } finally { await smtp.close(); removeRig(rig); }
});

it("review 7 and 8: an email held before its first delivery stays held across restart and then sends once", async () => {
  const smtp = await smtpServer(), rig = makeRig(); let id: string;
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configureEmail(smtp.port);
      success(yield* call(ownerCredential, "client.alerts.quiet.set", { quiet }));
      id = yield* raiseQuestion("restart-held-email");
      expect((yield* alerts()).find((row: any) => row.alertId === id)).toMatchObject({ held: true });
      yield* pause(30); expect(smtp.messages).toHaveLength(0);
    }), { rig, clockAt });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect((yield* alerts()).find((row: any) => row.alertId === id)).toMatchObject({ held: true });
      yield* pause(30); expect(smtp.messages).toHaveLength(0);
      success(yield* call(ownerCredential, "client.alerts.quiet.set", { quiet: { ...quiet, enabled: false } }));
      yield* TestClock.adjust(60_000); yield* delivered(id!); yield* pause(30); expect(smtp.messages).toHaveLength(1);
      expect((yield* alerts()).find((row: any) => row.alertId === id)).toMatchObject({ held: false });
    }), { rig, initialize: false, clockAt });
  } finally { await smtp.close(); removeRig(rig); }
});

it("review 3: legacy email activation survives replay and a cleared password disables it", () => {
  registerRebuildCheck({ noLog: true });
  let view: any = clientPieceView.reduce(emptyClientView(), { _tag: "client.AlertDestinationChanged", name: "email", carrier: email(2525) }, 1);
  // The original event implied activation. New API saves append an explicit
  // disabled event until a password is stored, while old logs keep their state.
  expect(view.destinations.email.enabled).toBe(true);
  view = clientPieceView.reduce(view, { _tag: "client.AlertDestinationTokenSet", name: "email", origin: "legacy", carrierGeneration: "legacy-password" }, 2);
  view = clientPieceView.reduce(view, { _tag: "client.AlertDestinationTokenCleared", name: "email" }, 3);
  expect(view.destinations.email).toMatchObject({ enabled: false, tokenSet: false });
});

it("review 3: initial API setup reports a required password and refuses enabling until it is set", async () => {
  await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    expect(success(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: email(2525) }))).toMatchObject({ enabled: false, tokenSet: false, passwordRequired: true });
    expect(yield* call(ownerCredential, "client.alerts.carrier.enabled.set", { name: "email", enabled: true })).toMatchObject({ _tag: "Failure", failure: { reason: "Set an email password before turning email on." } });
  }));
});
