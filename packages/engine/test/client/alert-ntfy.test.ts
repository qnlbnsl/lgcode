import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { call, ownerCredential, success } from "../support/handlerRig.ts";
import { awaitRaised, question } from "../support/alertsRig.ts";
import { seedAgent } from "../support/handlerRig.ts";
import { configure, delivered, ntfyServer, posted, posts, setToken, withCarrier } from "../support/carrierRig.ts";
import { eventually } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

it("6.5/6.9 ntfy receives the stable identity and only labelled, sanitised alert data, then DELETE by that identity", async () => {
  const server = await ntfyServer();
  const token = `test-only-${crypto.randomUUID()}`;
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* configure(server.origin, "phone_6b"); yield* setToken(server.origin, token);
      yield* seedAgent({ id: "worker", name: "W\n\u001b\u202eorker" + "x".repeat(90), groups: Array.from({ length: 10 }, (_, i) => `T${i}\n\u2066` + "y".repeat(30)), state: "working" });
      yield* question("worker", "payload-prose");
      const id = (yield* awaitRaised("question:payload-prose"))[0]!.event.alertId;
      expect(yield* delivered(id)).toHaveLength(1);
      expect(yield* posted(server)).toHaveLength(1);
      const sent = posts(server)[0]!;
      expect(sent.headers.authorization === `Bearer ${token}`, "configured token must be bearer-only").toBe(true);
      const json = sent.headers["content-type"]?.includes("application/json") ? JSON.parse(sent.body) as Record<string, unknown> : undefined;
      const path = new URL(sent.url, server.origin).pathname;
      const sequence = json?.sequence_id ?? sent.headers["x-sequence-id"] ?? sent.headers["sequence-id"] ?? sent.headers.sid ?? decodeURIComponent(path.split("/")[2] ?? "");
      expect(sequence).toBe(id);
      expect(json?.topic ?? path.split("/")[1]).toBe("phone_6b");
      const title = json?.title ?? sent.headers.title ?? sent.headers["x-title"];
      expect(title).toBe("A question needs your answer");
      const text = String(json?.message ?? sent.body);
      expect(text).toContain("question");
      expect(text).toMatch(/Agent: /); expect(text).toMatch(/Team: /);
      const name = text.match(/Agent: ([^\r\n]*)/)?.[1];
      const team = text.match(/Team: ([^\r\n]*)/)?.[1];
      expect(name).toBe("Worker" + "x".repeat(58));
      expect(team).toBeDefined(); expect(team!.length).toBeLessThanOrEqual(128);
      expect(team).not.toMatch(/T8|T9/);
      expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/);
      expect(text).not.toContain("Which branch?");
      success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: id }));
      const deletes = yield* eventually(Effect.sync(() => server.requests.filter((row) => row.method === "DELETE")), (rows) => rows.length > 0);
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.url).toBe(`/phone_6b/${encodeURIComponent(id)}`);
      expect(deletes[0]!.headers.authorization === `Bearer ${token}`).toBe(true);
    }));
  } finally { await server.close(); }
});

it("6.5 a team with ten short labels still sends at most eight, independently of the character limit", async () => {
  const server = await ntfyServer();
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      yield* seedAgent({ id: "worker", state: "working", groups: ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"] });
      yield* question("worker", "short-labels");
      const id = (yield* awaitRaised("question:short-labels"))[0]!.event.alertId;
      expect(yield* delivered(id)).toHaveLength(1);
      const sent = posts(server)[0]!;
      const text = sent.headers["content-type"]?.includes("application/json") ? String(JSON.parse(sent.body).message) : sent.body;
      expect(text.match(/A\d/g)).toEqual(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
    }));
  } finally { await server.close(); }
});
