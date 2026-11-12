// Unit 2 defines commands but does not install their handlers. This test build
// supplies the future filtered stream to the real public connection. No client
// transport, dispatch, retry, decoding or cursor code is mocked.
import { vi } from "vitest";

vi.mock("@lgtm/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lgtm/contracts")>();
  const Schema = await import("effect/Schema");
  const Rpc = await import("effect/rpc/Rpc");
  const RpcGroup = await import("effect/rpc/RpcGroup");
  const fixture = RpcGroup.make(Rpc.make("client.subscribe", {
    payload: { requestId: Schema.NonEmptyString, after: actual.EventSequence, filter: Schema.optionalKey(Schema.Unknown) },
    success: Schema.Unknown, stream: true,
    error: Schema.TaggedStruct("CommandError", { requestId: Schema.NonEmptyString, reason: Schema.String }),
  }));
  const wire = (actual as unknown as { WireCommandsRpcGroup?: typeof actual.CommandsRpcGroup }).WireCommandsRpcGroup;
  return { ...actual, CommandsRpcGroup: actual.CommandsRpcGroup.merge(fixture),
    WireCommandsRpcGroup: (wire ?? actual.CommandsRpcGroup).merge(fixture) };
});
