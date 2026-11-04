import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";

import * as Server from "../../src/api/server.ts";
import { boardPlaceholderPlanners, boardPlaceholderReads } from "../../src/board/placeholders.ts";
import { fixtureClient, loadLists, withFixture } from "../support/fixturePiece.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const payloads: Record<string, Record<string, unknown>> = {
  "board.open": { name: "Review" },
  "board.members": { channelId: "channel", add: ["member"], remove: [] },
  "board.post": { channelId: "channel", text: "A question.", to: [{ _tag: "agent", agentId: "member" }], reply: "all" },
  "board.close": { postId: "post" },
  "board.acknowledge": { postId: "post" },
  "board.flush": { agentId: "member" },
  "board.read": { channelId: "channel" },
  "board.channels": {},
  "board.status": { agentId: "member" },
};

// Later units remove a placeholder when they install that command's handler.
// The engine's unchanged inventory test keeps requiring complete coverage.
const planners = Object.keys(boardPlaceholderPlanners);
const reads = Object.keys(boardPlaceholderReads);
for (const command of [...planners, ...reads]) {
  it(`159 ${command} refuses through the API without board events or duplicate refusal records`, async () => {
    const lists = await loadLists();
    const isPlanner = planners.includes(command);
    expect(payloads[command], "Every remaining placeholder needs a valid request fixture").toBeDefined();
    expect(lists.planners[command]).toBe(isPlanner ? boardPlaceholderPlanners[command as keyof typeof boardPlaceholderPlanners] : undefined);
    expect(lists.reads[command]).toBe(isPlanner ? undefined : boardPlaceholderReads[command as keyof typeof boardPlaceholderReads]);
    await withFixture(lists, (rig, bearer) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const socketPath = join(rig.stateFolder, "engine.sock");
      yield* Server.serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: false, lists });
      const client = yield* fixtureClient(socketPath, bearer, lists);
      const requestId = `disabled-${command}`;
      const payload = { requestId, ...payloads[command] };
      for (let attempt = 0; attempt < 2; attempt++) {
        const outcome = yield* client[command]!(payload).pipe(Effect.result);
        expect(outcome._tag).toBe("Failure");
        if (outcome._tag === "Failure") {
          expect(outcome.failure).toEqual({ _tag: "CommandError", requestId, reason: "board disabled" });
        }
      }
      const sql = yield* SqlClient.SqlClient;
      const events = yield* sql<{ payload_json: string }>`SELECT payload_json FROM events ORDER BY sequence`;
      expect(events.map((row) => JSON.parse(row.payload_json))).toEqual(isPlanner
        ? [{ _tag: "CommandRefused", command, reason: "board disabled" }] : []);
      const receipts = yield* sql<{ request_id: string }>`SELECT request_id FROM receipts`;
      expect(receipts).toEqual(isPlanner ? [{ request_id: requestId }] : []);
    }));
  });
}
