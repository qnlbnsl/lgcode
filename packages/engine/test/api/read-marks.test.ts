import { join } from "node:path";
import { RequestId, AgentId, EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import * as Server from "../../src/api/server.ts";
import { refused, type Input } from "../../src/commands/internal.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { asEvent, FixtureEvent, fixtureClient, fixtureLists, loadLists, withFixture, type EngineLists } from "../support/fixturePiece.ts";
import { appendSetup, freshRequest, seedAgent } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const ReadMark = Schema.TaggedStruct("client.FixtureRead", { agentId: AgentId });
const ReadGroup = RpcGroup.make(Rpc.make("read", {
  payload: { requestId: RequestId, agentId: AgentId },
  success: Schema.Struct({ requestId: RequestId, items: Schema.Array(FixtureEvent) }),
  error: Schema.TaggedStruct("CommandError", { requestId: RequestId, reason: Schema.String }),
})).prefix("client.");
const withRead = (base: EngineLists): EngineLists => {
  const event = Schema.Union([base.event, ReadMark]);
  return { ...base, commands: base.commands.merge(ReadGroup), event,
    envelope: Schema.Struct({ ...EventEnvelope.fields, event }),
    commandGroups: [...base.commandGroups, { namespace: "client", group: ReadGroup }],
    eventGroups: [...base.eventGroups, { namespace: "client", events: ReadMark }],
    access: { ...base.access, "client.read": ["owner", "agent"] },
    visibility: { ...base.visibility, "client.FixtureRead": "owner-only" },
    reads: { ...base.reads, "client.read": (input: Input, payload: { requestId: string; agentId: string }) => Effect.gen(function* () {
      const parent = input.snapshot.agents[payload.agentId]?.parent;
      if (input.actor._tag !== "owner" && !(input.actor._tag === "agent" && parent?._tag === "agent" && parent.agentId === input.actor.agentId)) return yield* refused();
      const records = (input.snapshot as unknown as { client: { records: Array<{ id: string; text: string }> } }).client.records;
      return { reply: { requestId: payload.requestId, items: records.map((row) => ({ _tag: "client.FixtureRecorded", id: row.id, text: row.text })) },
        marks: [{ _tag: "client.FixtureRead", agentId: payload.agentId }],
      };
    }) },
  };
};

it("1.27 a resent read recomputes its page and marks without writing a receipt or storing page text", async () => {
  const lists = withRead(fixtureLists(await loadLists()));
  await withFixture(lists, (rig, bearer) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const socket = join(rig.stateFolder, "engine.sock");
    yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false, ...{ lists } });
    const client = yield* fixtureClient(socket, bearer, lists);
    const log = yield* EventLog;
    yield* log.append({ _tag: "owner" }, freshRequest(), "1".repeat(64), [asEvent({ _tag: "client.FixtureRecorded", id: "a", text: "Page text A." })], {}, false);
    const payload = { requestId: "same-read", agentId: "target" };
    const first = yield* client["client.read"]!(payload);
    yield* log.append({ _tag: "owner" }, freshRequest(), "2".repeat(64), [asEvent({ _tag: "client.FixtureRecorded", id: "b", text: "Page text B." })], {}, false);
    const second = yield* client["client.read"]!(payload);
    expect(first.items).toEqual([{ _tag: "client.FixtureRecorded", id: "a", text: "Page text A." }]);
    expect(second.items).toEqual([
      { _tag: "client.FixtureRecorded", id: "a", text: "Page text A." }, { _tag: "client.FixtureRecorded", id: "b", text: "Page text B." },
    ]);
    const sql = yield* SqlClient.SqlClient;
    expect(yield* sql`SELECT COUNT(*) AS n FROM events WHERE event_type = 'client.FixtureRead'`).toEqual([{ n: 2 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 0 }]);
  }));
});

it("1.27 losing read access before retry refuses the same request id and writes no second mark", async () => {
  const lists = withRead(fixtureLists(await loadLists()));
  await withFixture(lists, (rig, bearer) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const lead = yield* seedAgent({ id: "lead" });
    yield* seedAgent({ id: "target", parent: "lead" });
    const socket = join(rig.stateFolder, "engine.sock");
    yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false, ...{ lists } });
    const client = yield* fixtureClient(socket, lead.token, lists);
    const payload = { requestId: "lost-read", agentId: "target" };
    yield* client["client.read"]!(payload); // Discard the first reply, as on a lost connection.
    const sql = yield* SqlClient.SqlClient;
    const before = yield* sql`SELECT caller FROM events WHERE event_type = 'client.FixtureRead'`;
    expect(before).toEqual([{ caller: "agent:lead" }]);
    // A real change in the target's ancestry removes this lead's read.
    yield* seedAgent({ id: "target" });
    const retry = yield* client["client.read"]!(payload).pipe(Effect.result);
    expect(retry._tag).toBe("Failure");
    expect(yield* sql`SELECT caller FROM events WHERE event_type = 'client.FixtureRead'`).toEqual(before);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts WHERE request_id = 'lost-read'`).toEqual([{ n: 0 }]);
  }));
});
