import { existsSync } from "node:fs";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect, it } from "vitest";
import { alertKindNames } from "@sheprd/contracts";
import { append, eventsOf } from "../support/alertsRig.ts";
import { call, ownerCredential, seedAgent, success } from "../support/handlerRig.ts";
import { configure, withCarrier } from "../support/carrierRig.ts";
import { eventually } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

interface Payload { readonly alertId: string; readonly kind: string; readonly agentName?: string; readonly team: readonly string[]; readonly title: string; readonly link?: string }
interface Sender { readonly send: (payload: Payload, ...context: any[]) => Effect.Effect<void, unknown>; readonly clear: (alertId: string, ...context: any[]) => Effect.Effect<void, unknown> }
const titles: Record<string, string> = {
  approval: "Permission needs your approval", question: "A question needs your answer",
  failure: "An agent needs your attention", account: "An account needs your attention", other: "Your attention is needed",
  "client.web-down": "The web server is down", "board.post": "A post needs your reply", "board.no-answer": "An agent has not answered your post",
  "roles.stall": "An agent has stalled", "roles.replace": "A worker needs replacement",
  "roles.runaway": "Work has exceeded its expected length", "roles.rule-first-use": "A permission rule was used for the first time",
};

it("6.6/6.7 every enabled kind reaches only AlertSender, send-time changes take effect, and clear runs once", async () => {
  registerRebuildCheck({ noLog: true });
  const url = new URL("../../src/client/alerts/AlertSender.ts", import.meta.url);
  expect(existsSync(url), "6b must supply the AlertSender service seam").toBe(true);
  const { AlertSender } = await import(/* @vite-ignore */ url.href) as { AlertSender: Context.Key<any, Sender> };
  const sends: Payload[] = []; const clears: string[] = [];
  const extra = Layer.succeed(AlertSender, {
    send: (payload) => Effect.sync(() => { sends.push(payload); }),
    clear: (id) => Effect.sync(() => { clears.push(id); }),
  });
  await withCarrier(() => Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAgent({ id: "worker", state: "working", groups: ["build"] });
    yield* append({ _tag: "client.WebSettingsChanged", settings: { enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: true, publicAddress: "https://sheprd.example" } });
    for (const kind of alertKindNames) {
      yield* append({ _tag: "client.AlertRaised", alertId: `sender-${kind}`, alertKey: `fixture:${kind}`, kind,
        agentId: "worker", title: titles[kind], sourceSequence: 1 });
    }
    expect(sends).toHaveLength(0);
    yield* configure("https://push.example");
    const pushed = yield* eventually(Effect.sync(() => [...sends]), (rows) => rows.length === 11);
    expect(pushed.map((row) => row.kind).sort()).toEqual([
      "account", "approval", "board.no-answer", "board.post", "client.web-down", "failure", "other", "question", "roles.replace", "roles.rule-first-use", "roles.stall",
    ]);
    for (const payload of pushed) {
      expect(payload).toMatchObject({ alertId: `sender-${payload.kind}`, agentName: "name-worker", team: ["build"], title: titles[payload.kind] });
      expect(Object.keys(payload).sort()).toEqual(["alertId", "kind", "agentName", "team", "title", "link"].sort());
      expect(payload.link).toContain("https://sheprd.example");
    }
    success(yield* call(ownerCredential, "client.alerts.settings.set", { kind: "roles.runaway", push: true }));
    expect(yield* eventually(Effect.sync(() => sends.length), (n) => n === 12)).toBe(12);
    expect(sends.at(-1)?.kind).toBe("roles.runaway");
    success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: "sender-other" }));
    expect(yield* eventually(Effect.sync(() => [...clears]), (rows) => rows.length > 0)).toEqual(["sender-other"]);
    success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: "sender-other" }));
    expect(clears).toEqual(["sender-other"]);
    expect((yield* eventsOf("client.AlertCleared")).filter((row) => row.event.alertId === "sender-other")).toHaveLength(1);
  }), { extra });
});
