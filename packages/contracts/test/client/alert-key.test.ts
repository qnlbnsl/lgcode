import * as Contracts from "../../src/index.ts";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";

it("2.10 an alert source cannot make exempt alertKey carry arbitrary prose", () => {
  const schema = (Contracts as unknown as { AlertSourceRequest?: Schema.Codec<unknown> }).AlertSourceRequest;
  expect(schema, "Unit 2 alert types need a validated AlertSourceRequest for the reactor's sources").toBeDefined();
  const decode = Schema.decodeUnknownSync(schema!);
  expect(decode({ kind: "approval", key: "permission:request-a" })).toMatchObject({ kind: "approval", key: "permission:request-a" });
  expect(() => decode({ kind: "approval", key: "Agent text must never become a redaction-exempt key." })).toThrow();
  expect(() => decode({ kind: "approval", key: "" })).toThrow();
});
