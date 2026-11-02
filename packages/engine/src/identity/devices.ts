import type { DeviceId } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";

import {
  CredentialCheckFailed, hasValidChecksum, InvalidCredential, mintCredential, sha256Hex,
} from "./credential.ts";

// A credential for one paired device (SECURITY.md rule 4). Each device has
// its own row, so one can be revoked without signing out the others.
export const mintDeviceCredential = (): {
  readonly token: Redacted.Redacted<string>;
  readonly tokenHash: string;
} => mintCredential("shp_d_");

// The device a credential belongs to, while that device is not revoked.
export const verifyDeviceCredential = (
  raw: string,
): Effect.Effect<DeviceId, InvalidCredential | CredentialCheckFailed, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    if (!hasValidChecksum(raw, "shp_d_")) return yield* new InvalidCredential({ reason: "invalid credential" });
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ device_id: DeviceId }>`
      SELECT device_id FROM devices WHERE token_hash = ${sha256Hex(raw)} AND revoked_at IS NULL`.pipe(
      Effect.mapError(() => new CredentialCheckFailed({ reason: "credential check failed" })),
    );
    const row = rows[0];
    if (row === undefined) return yield* new InvalidCredential({ reason: "invalid credential" });
    return row.device_id;
  });
