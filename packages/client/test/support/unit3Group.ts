// Install only missing unit-3 command definitions in the test process. The
// socket, RPC codec, client decoding, cursor and retry implementation stay real.
import { vi } from "vitest";
vi.mock("@sheprd/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sheprd/contracts")>();
  const tags = ["client.snapshot", "client.roster", "client.thread", "client.event", "client.sequence", "client.subscribe"];
  const missing = [...actual.ClientRpcGroup.requests.values()].filter((rpc) => tags.includes(rpc._tag) && !actual.CommandsRpcGroup.requests.has(rpc._tag as never));
  const RpcGroup = await import("effect/rpc/RpcGroup");
  const Rpc = await import("effect/rpc/Rpc");
  const Schema = await import("effect/Schema");
  const board = actual.CommandsRpcGroup.requests.has("board.status" as never) ? [] : [Rpc.make("board.status", {
    payload: { requestId: Schema.NonEmptyString }, success: Schema.Unknown,
    error: Schema.TaggedStruct("CommandError", { requestId: Schema.NonEmptyString, reason: Schema.String }),
  })];
  const group = actual.CommandsRpcGroup.merge(RpcGroup.make(...missing, ...board));
  return { ...actual, CommandsRpcGroup: group, WireCommandsRpcGroup: actual.wireGroup(group) };
});
