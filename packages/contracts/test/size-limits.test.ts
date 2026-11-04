import * as Contracts from "../src/index.ts";
import * as Schema from "effect/Schema";
import * as RpcSchema from "effect/rpc/RpcSchema";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import { expect, it } from "vitest";
import { definitions } from "./client/support.ts";

const envelope = (event: unknown) => ({ sequence: 1, eventId: "size-event", occurredAt: 0,
  caller: { _tag: "owner" }, agentId: "agent-a", event });
const frame = (value: unknown) => RpcSerialization.json.makeUnsafe().encode(value)!;
const bytes = (value: unknown) => {
  const encoded = frame(value);
  return typeof encoded === "string" ? Buffer.byteLength(encoded) : encoded.byteLength;
};

// The board contract's size table includes a 256 KiB encoded wake body.
// Quotes and backslashes ensure we measure escaping, not raw character count.
const wakeText = '"\\'.repeat(65_535);
const wake = { _tag: "PromptSent", agentId: "agent-a", deliveryId: "delivery-a",
  sender: { _tag: "piece", namespace: "board" }, text: wakeText };

it("2.6 the board's maximal wake, encoded as a strict engine event and a real RPC chunk, fits a whole page but needs a filtered-stream marker", () => {
  const encoded = Schema.encodeSync(Contracts.EventEnvelope)(Schema.decodeUnknownSync(Contracts.EventEnvelope)(envelope(wake)));
  const message = { _tag: "Chunk", requestId: "1", values: [encoded] };
  const measured = bytes(message);
  expect(measured).toBeGreaterThan(256 * 1024);
  expect(measured).toBeLessThan(900 * 1024);
  const rpc = definitions().requests.get("client.subscribe")!;
  expect(RpcSchema.isStreamSchema(rpc.successSchema)).toBe(true);
  if (!RpcSchema.isStreamSchema(rpc.successSchema)) return;
  const marker = { _tag: "client.Oversized", sequence: 1, tag: "PromptSent", agentId: "agent-a", bytes: measured };
  const decoded = Schema.decodeUnknownSync(rpc.successSchema.success as Schema.Codec<unknown>)(marker);
  expect(decoded).toEqual(marker);
  expect(bytes({ _tag: "Chunk", requestId: "1", values: [decoded] })).toBeLessThan(256 * 1024);
});

it("2.6 a whole oversized event page preserves all escaping and remains under the 900 KiB transport budget", () => {
  const rpc = definitions().requests.get("client.thread")!;
  // Owner/service pages carry the original envelope. Agent data envelopes
  // and the server's pagination algorithm are exercised by unit 3.
  const reply = { requestId: "page-size", items: [envelope(wake)] };
  const decoded = Schema.decodeUnknownSync(rpc.successSchema as Schema.Codec<unknown>)(reply);
  const encoded = Schema.encodeSync(rpc.successSchema as Schema.Codec<unknown>)(decoded);
  const message = { _tag: "Exit", requestId: "1", exit: { _tag: "Success", value: encoded } };
  expect(JSON.parse(String(frame(message))).exit.value.items[0].event.text).toBe(wakeText);
  expect(bytes(message)).toBeLessThan(900 * 1024);
});

it("2.6 future piece maxima survive the tolerant wire encoder and real chunk wrappers within the shared page budget", () => {
  const wire = (Contracts as unknown as { WireEnvelope?: Schema.Codec<unknown> }).WireEnvelope;
  expect(wire, "E25 must export WireEnvelope from contracts").toBeDefined();
  // The roles' 64 KiB file cap is on encoded data. Escaped text occupies
  // that budget in this fixture. The board's 16,384-character post uses
  // multibyte text to exercise its approximately 64 KiB encoded maximum.
  const samples = [
    { _tag: "roles.RoleFileSet", text: '"\\'.repeat(16_383) },
    { _tag: "board.PostWritten", text: "😀".repeat(16_384), addressees: Array.from({ length: 16 }, (_, i) => `agent-${i}`) },
  ];
  for (const event of samples) {
    const decoded = Schema.decodeUnknownSync(wire!)(envelope(event));
    const encoded = Schema.encodeSync(wire!)(decoded);
    expect(JSON.parse(String(frame({ _tag: "Chunk", requestId: "1", values: [encoded] }))).values[0].event).toEqual(event);
    expect(bytes({ _tag: "Chunk", requestId: "1", values: [encoded] })).toBeLessThan(900 * 1024);
  }
});
