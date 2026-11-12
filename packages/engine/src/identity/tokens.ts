import type { AgentId } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";

import {
  CredentialCheckFailed, hasValidChecksum, InvalidCredential, mintCredential, sha256Hex,
} from "./credential.ts";

// A new token for one spawn of one agent (decision rows 32 and 73). The raw
// value goes only into the agent's environment; the caller stores
// `tokenHash` through `EventLog.append` side rows.
export const mintAgentToken = (): {
  readonly token: Redacted.Redacted<string>;
  readonly tokenHash: string;
} => mintCredential("shp_a_");

// The agent a token belongs to, while that token is unrevoked. The query runs
// on whatever connection the caller's fiber holds, so inside the writer
// transaction it sees that transaction's own revocations (criterion 5.1).
// Nothing is cached.
export const verifyAgentToken = (
  raw: string,
): Effect.Effect<AgentId, InvalidCredential | CredentialCheckFailed, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    if (!hasValidChecksum(raw, "shp_a_")) return yield* new InvalidCredential({ reason: "invalid credential" });
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ agent_id: AgentId }>`
      SELECT agent_id FROM agent_tokens WHERE token_hash = ${sha256Hex(raw)} AND revoked_at IS NULL`.pipe(
      Effect.mapError(() => new CredentialCheckFailed({ reason: "credential check failed" })),
    );
    const row = rows[0];
    if (row === undefined) return yield* new InvalidCredential({ reason: "invalid credential" });
    return row.agent_id;
  });
