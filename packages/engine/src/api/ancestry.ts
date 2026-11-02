import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { linuxProcessReader, macosProcessReader } from "../recovery/orphans.ts";

// Row 64 is an accident guard, using the caller's claimed ancestry. The
// current process identity must also match the recorded spawn: a reused pid
// or a row from another boot does not identify a live adapter.
export const outsideAdapters = (chain: string | undefined, group: string | undefined) => Effect.gen(function* () {
  if (chain === undefined || group === undefined || !/^[1-9]\d*$/.test(group)) return false;
  const groupId = Number(group);
  const entries = chain.split(",");
  if (!Number.isSafeInteger(groupId) || entries.length === 0 || entries.length > 64) return false;
  const ancestors = new Map<number, string>();
  for (const entry of entries) {
    const pair = /^([1-9]\d*):(\d+)$/.exec(entry);
    if (pair === null) return false;
    const pid = Number(pair[1]);
    if (!Number.isSafeInteger(pid) || ancestors.has(pid)) return false;
    ancestors.set(pid, pair[2]!);
  }
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ group_id: number; boot_id: string; start_time: string; user_id: number; executable: string }>`
    SELECT group_id, boot_id, start_time, user_id, executable FROM processes`;
  const reader = process.platform === "linux" ? linuxProcessReader : macosProcessReader;
  return yield* Effect.sync(() => {
    try {
      for (const row of rows) {
        if (row.boot_id !== reader.bootId()) continue;
        const facts = reader.facts(row.group_id);
        if (facts === undefined || facts.startTime !== row.start_time || facts.userId !== row.user_id || facts.executable !== row.executable) continue;
        if (groupId === row.group_id || ancestors.get(row.group_id) === row.start_time) return false;
      }
      return true;
    } catch { return false; }
  });
}).pipe(Effect.catchCause(() => Effect.succeed(false)));
