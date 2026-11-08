import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { randomBytes } from "node:crypto";
import { RequestId } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { rulesFixture, useRules } from "../support/callerRules.ts";
import { call, freshRequest } from "../support/handlerRig.ts";

it("1.40 catches secret handling hard-coded to accounts set-secret: labels, value-independent hashes and replay", async () => {
  const base = await rulesFixture();
  const value = randomBytes(32).toString("hex");
  const group = RpcGroup.make(Rpc.make("set-secret", {
    payload: { requestId: RequestId, nonce: Schema.String, value: Schema.RedactedFromValue(Schema.String, { label: "secret value" }) },
    success: Schema.Struct({ requestId: RequestId }), error: Schema.Unknown,
  })).prefix("client.");
  const lists = {
    ...base, commands: base.commands.merge(group), commandGroups: [...base.commandGroups, { namespace: "client", group }],
    access: { ...base.access, "client.set-secret": ["owner" as const] },
    secretCommands: [...base.secretCommands, "client.set-secret"],
    planners: { ...base.planners, "client.set-secret": (_input: unknown, payload: Record<string, unknown>) => Effect.succeed({ events: [], reply: () => ({ requestId: payload.requestId }) }) },
  };
  await useRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
    const id = freshRequest();
    const payload = { requestId: id, value: Redacted.make(value), nonce: "nonce" };
    const first = yield* call({ _tag: "owner" }, "client.set-secret", payload);
    expect(first._tag, "a secret-setting command must normalize the Redacted label before validation").toBe("Success");
    expect(yield* call({ _tag: "owner" }, "client.set-secret", { ...payload, value: Redacted.make(randomBytes(32).toString("hex")) })).toEqual(first);
    expect(yield* call({ _tag: "owner" }, "client.set-secret", { ...payload, nonce: "changed" })).toMatchObject({ _tag: "Failure", failure: { reason: "request id reused" } });
    const otherId = freshRequest();
    expect((yield* call({ _tag: "owner" }, "client.set-secret", { ...payload, requestId: otherId, value: Redacted.make(randomBytes(32).toString("hex")) }))._tag).toBe("Success");
    const sql = yield* SqlClient.SqlClient;
    const receipts = yield* sql<{ body_hash: string; result_json: string }>`SELECT body_hash, result_json FROM receipts WHERE caller = 'owner' ORDER BY rowid`;
    expect(receipts).toHaveLength(2);
    expect(receipts[0]!.body_hash).toBe(receipts[1]!.body_hash);
    expect(receipts.every((r) => !r.result_json.includes(value))).toBe(true);
    expect(yield* sql`SELECT event_type FROM events WHERE request_id IN (${id}, ${otherId})`).toEqual([]);
  }));
});
