import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { append, withAlerts } from "../support/alertsRig.ts";
import { call, ownerCredential, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const budget = 900 * 1024;
const read = (after = 0, limit = 2, status?: "open" | "cleared") => call(ownerCredential, "client.alerts.list",
  { after, limit, ...(status === undefined ? {} : { status }) }).pipe(Effect.map(success));
const raise = (id: string, subject: string) => append({ _tag: "client.AlertRaised", alertId: id, alertKey: `post:${id}`,
  kind: "board.post", title: "An agent needs your reply", sourceSequence: 1, subject: { _tag: "piece", namespace: "board", id: subject } });

it("FR-045 large escaped subjects close the byte page, and filtered cursors progress without truncating an item", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* raise("first", "é\"".repeat(130_000));
    yield* raise("ignored", "small");
    success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: "ignored" }));
    yield* raise("second", "é\"".repeat(130_000));
    const page = yield* read(0, 2, "open");
    expect(page.items.map((row: { alertId: string }) => row.alertId)).toEqual(["first"]);
    expect(Buffer.byteLength(JSON.stringify(page.items))).toBeLessThanOrEqual(budget);
    expect(page.next).toBeTypeOf("number");
    const next = yield* read(page.next, 2, "open");
    expect(next.items.map((row: { alertId: string }) => row.alertId)).toEqual(["second"]);
    expect(next).not.toHaveProperty("next");
    expect((yield* read(0, 2, "cleared")).items).toHaveLength(1);
    expect((yield* read(0, 1)).items).toHaveLength(1);
  }));
});

it.each([0, 1])("FR-045 the complete encoded items array at budget + %i bytes determines the page boundary", async (over) => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* raise("sample", "x");
    const sample = (yield* read()).items[0];
    // Equal-length ids and keys keep metadata identical. Include JSON array
    // brackets, comma, timestamps and all public fields in the hand-built size.
    const first = { ...sample, alertId: "first1", alertKey: "post:first1", subject: { _tag: "piece", namespace: "board", id: "x" } };
    const second = { ...first, alertId: "second", alertKey: "post:second" };
    const padding = budget - Buffer.byteLength(JSON.stringify([first, second])) + over;
    const source = yield* raise("first1", "x");
    yield* raise("second", "x".repeat(padding + 1));
    const page = yield* read(source[0]!.sequence - 1);
    expect(page.items).toHaveLength(over === 0 ? 2 : 1);
    if (over === 0) {
      expect(Buffer.byteLength(JSON.stringify(page.items))).toBe(budget);
      expect(page).not.toHaveProperty("next");
    } else expect(page.next).toBe(source[0]!.sequence);
  }));
});

it("FR-045 a first item larger than the budget stays whole and advances the cursor", async () => {
  await withAlerts(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const subject = "x".repeat(budget + 1);
    const source = yield* raise("oversized", subject);
    yield* raise("later", "small");
    const page = yield* read();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].subject.id).toBe(subject);
    expect(page.next).toBe(source[0]!.sequence);
    const next = yield* read(page.next);
    expect(next.items.map((row: { alertId: string }) => row.alertId)).toEqual(["later"]);
    expect(next).not.toHaveProperty("next");
  }));
});
