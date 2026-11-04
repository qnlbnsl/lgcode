import { randomUUID } from "node:crypto";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { alertLog } from "../support/alertsRig.ts";
import { call, ownerCredential, success } from "../support/handlerRig.ts";
import { configure, failed, ntfyServer, raiseQuestion, setToken, withCarrier } from "../support/carrierRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

it("6.12 token input and a carrier response echoing it leak into no event, receipt, reply, or service log", async () => {
  const token = randomUUID(); const lines: string[] = []; const server = await ntfyServer();
  server.respond(({ response }) => { response.writeHead(401); response.end(token); });
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      const reply = yield* setToken(server.origin, token);
      const id = yield* raiseQuestion(); expect(yield* failed(id)).toHaveLength(1);
      const sql = yield* SqlClient.SqlClient;
      const persisted = yield* sql`SELECT * FROM receipts`;
      const settings = success(yield* call(ownerCredential, "client.alerts.settings", {}));
      const alerts = success(yield* call(ownerCredential, "client.alerts.list", { after: 0, limit: 100 }));
      for (const output of [reply, settings, alerts, persisted, yield* alertLog, lines]) {
        expect(JSON.stringify(output).includes(token), "carrier token escaped into a public or durable surface").toBe(false);
      }
      expect(settings.tokenSet).toBe(true);
    }), { lines });
  } finally { await server.close(); }
});
