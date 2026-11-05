import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { append, eventsOf } from "../support/alertsRig.ts";
import { call, ownerCredential, success } from "../support/handlerRig.ts";
import { configure, delivered, ntfyServer, posts, raiseQuestion, withCarrier } from "../support/carrierRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { settledDelivery } from "../support/settledDelivery.ts";

it("6.8 unset delivery leaves alerts readable, then a carrier makes only non-baseline open alerts pending", async () => {
  const server = await ntfyServer();
  const delivery = settledDelivery();
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const id = yield* raiseQuestion();
      expect(posts(server)).toHaveLength(0);
      expect(yield* eventsOf("client.AlertDeliveryFailed")).toHaveLength(0);
      expect(success(yield* call(ownerCredential, "client.alerts.list", { after: 0, limit: 100 })).items)
        .toContainEqual(expect.objectContaining({ alertId: id, status: "open" }));
      yield* append({ _tag: "client.AlertRaised", alertId: "baseline-6b", alertKey: "question:baseline-6b", kind: "question", title: "A question needs your answer", sourceSequence: 1, baseline: true });
      yield* configure(server.origin);
      expect(yield* delivered(id)).toHaveLength(1);
      yield* delivery.settle;
      expect(posts(server)).toHaveLength(1);
      expect((yield* eventsOf("client.AlertDelivered")).some((row) => row.event.alertId === "baseline-6b")).toBe(false);
      expect((yield* eventsOf("client.AlertDeliveryFailed")).some((row) => row.event.alertId === "baseline-6b")).toBe(false);
    }), { lists: delivery.lists });
  } finally { await server.close(); }
});

it("6.8 engine and contract sources contain no baked-in public ntfy or home-server address", () => {
  registerRebuildCheck({ noLog: true });
  const offending: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.name.endsWith(".ts") && /ntfy\.sh|192\.168\./.test(readFileSync(child, "utf8"))) offending.push(child);
    }
  };
  visit("packages/engine/src"); visit("packages/contracts/src");
  expect(offending).toEqual([]);
});
