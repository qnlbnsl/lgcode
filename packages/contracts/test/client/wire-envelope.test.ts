import * as Contracts from "../../src/index.ts";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";

it("2.4 WireEnvelope leaves the event and caller unknown while validating envelope identity, time and sequence", () => {
  const schema = (Contracts as unknown as { WireEnvelope?: Schema.Codec<unknown> }).WireEnvelope;
  expect(schema, "E25 must export the tolerant RPC WireEnvelope").toBeDefined();
  const decode = Schema.decodeUnknownSync(schema!);
  const future = { sequence: 7, eventId: "future-7", occurredAt: 0,
    caller: { _tag: "new-caller" }, event: { _tag: "board.Future", text: "Future data." } };
  expect(decode(future)).toEqual(future);
  for (const sequence of [-1, 0.5, "7", Number.MAX_SAFE_INTEGER + 1]) expect(() => decode({ ...future, sequence })).toThrow();
  expect(() => decode({ ...future, eventId: "" })).toThrow();
  expect(() => decode({ ...future, occurredAt: -1 })).toThrow();
});
