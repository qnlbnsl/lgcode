import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { serve } from "../../src/api/server.ts";
import { rulesFixture, useRules } from "../support/callerRules.ts";
import { ancestryHeaders, authorization, upgradeStatus } from "../support/socketClient.ts";

it("1.13/1.34 catches accepting a retired device bearer even when its old database row remains", async () => {
  await useRules(await rulesFixture(), (rig, bearer) => Effect.gen(function* () {
      yield* registerRebuildCheck();
    const sql = yield* SqlClient.SqlClient;
    const bytes = randomBytes(32);
    const old = `shp_d_${bytes.toString("base64url")}_${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}`;
    const hash = createHash("sha256").update(old).digest("hex");
    // A stale table must not restore an authentication path that was removed.
    yield* sql`CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, name TEXT, token_hash TEXT UNIQUE, created_at INTEGER, revoked_at INTEGER)`;
    yield* sql`INSERT INTO devices VALUES ('retired', 'Old test device', ${hash}, 1, NULL)`;
    const socket = join(rig.stateFolder, "engine.sock");
    yield* serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false });
    const response = yield* Effect.promise(() => upgradeStatus(socket, { ...ancestryHeaders(), ...authorization(old) }));
    expect(response.status).toBe(401);
    expect(response.body.includes(old)).toBe(false);
  }));
});
