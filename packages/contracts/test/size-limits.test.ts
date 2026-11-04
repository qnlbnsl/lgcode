// Board unit 1.11: measure actual schema-encoded RPC frames, including the
// stream Chunk or terminal Exit wrapper. A character count is not a byte cap.
import * as Contracts from "../src/index.ts";
import * as Schema from "effect/Schema";
import * as RpcSchema from "effect/rpc/RpcSchema";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import type { ResponseChunkEncoded, ResponseExitEncoded } from "effect/rpc/RpcMessage";
import { expect, it } from "vitest";
import { agent, codec, envelope as boardEnvelope, exported, post } from "./board/fixtures.ts";
import { definitions } from "./client/support.ts";

interface Limits {
  readonly postCharacters: number;
  readonly addressees: number;
  readonly wakeBytes: number;
  readonly pageBytes: number;
  readonly completionReplyIds: number;
}
const limits = () => exported<Limits>("boardLimits");
const frameBytes = (value: unknown, stream: boolean) => {
  const frame: ResponseChunkEncoded | ResponseExitEncoded = stream
    ? { _tag: "Chunk", requestId: "123", values: [value] }
    : { _tag: "Exit", requestId: "123", exit: { _tag: "Success", value } };
  const bytes = RpcSerialization.json.makeUnsafe().encode(frame);
  expect(bytes).toBeDefined();
  return typeof bytes === "string" ? Buffer.byteLength(bytes, "utf8") : bytes!.byteLength;
};
const eventBytes = (event: unknown) => {
  const schema = Contracts.EventEnvelope;
  const decoded = Schema.decodeUnknownSync(schema)(boardEnvelope(event));
  expect(decoded.event).toEqual(event);
  return frameBytes(Schema.encodeSync(schema)(decoded), true);
};

it("1.11 declared limits keep the board's largest data within the API budgets", () => {
  expect(limits()).toEqual({ postCharacters: 16_384, addressees: 16, wakeBytes: 256 * 1024, pageBytes: 512 * 1024, completionReplyIds: 17 });
});
it("1.11 a PostWritten of 16,384 four-byte characters and sixteen addressees stays below the marker threshold", () => {
  limits();
  const event = { ...post, text: "𐀀".repeat(16_384), to: Array.from({ length: 16 }, (_, i) => agent(`agent-${i}`)) };
  expect(Array.from(event.text)).toHaveLength(16_384);
  expect(Buffer.byteLength(event.text, "utf8")).toBe(65_536);
  expect(Schema.decodeUnknownSync(codec("BoardEvent"))(event)).toEqual(event);
  expect(eventBytes(event)).toBeLessThan(256 * 1024);
});
it("1.11 a full-body WakeBuilt index of the smallest questions stays below the marker threshold", () => {
  limits();
  // Every must-reply entry needs its own id and this mandatory fixed line in
  // the body, even before its author, channel, state and fresh markers. Using
  // only that cost overestimates how many entries can fit, so it is a safe
  // upper bound without implementing the future wake builder in a test.
  const id = "00000000-0000-4000-8000-000000000001";
  const minimumItemBytes = Buffer.byteLength(JSON.stringify(`${id}\nRun board.acknowledge with this post's id when you start responding.\n`)) - 2;
  const count = Math.floor((256 * 1024 - 2) / minimumItemBytes);
  const ids = Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const event = { _tag: "board.WakeBuilt", wakeId: "wake-1", targetAgentId: "target", carried: ids, mustReply: ids, completions: [], completionReplyText: [], reminders: [], noAnswers: [] };
  expect(ids.length).toBeGreaterThan(1000);
  expect(Schema.decodeUnknownSync(codec("BoardEvent"))(event)).toEqual(event);
  expect(eventBytes(event)).toBeLessThan(256 * 1024);
});
for (const escape of ["x", '"', "\\", "\n"]) {
  for (const tag of ["DeliveryQueued", "PromptSent"]) {
    it(`1.11 ${tag} with a full JSON body (${JSON.stringify(escape)}) fits a 900 KiB RPC page including escaping`, () => {
      limits();
      const perCharacter = Buffer.byteLength(JSON.stringify(escape)) - 2;
      const body = escape.repeat(Math.floor((256 * 1024 - 2) / perCharacter));
      expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThanOrEqual(256 * 1024 - 1);
      const sender = { _tag: "piece", namespace: "board" };
      const event = tag === "DeliveryQueued"
        ? { _tag: tag, delivery: { id: "delivery-1", target: "target", sender, source: { _tag: "piece", namespace: "board", id: "wake-1" }, content: { _tag: "prompt", text: body } } }
        : { _tag: tag, agentId: "target", deliveryId: "delivery-1", sender, text: body };
      const size = eventBytes(event);
      expect(size).toBeGreaterThan(256 * 1024);
      expect(size).toBeLessThan(900 * 1024);
    });
  }
}
it("1.11 a board.read page filled to 512 KiB of encoded items fits the 900 KiB RPC budget", () => {
  limits();
  const command = Contracts.CommandsRpcGroup.requests.get("board.read");
  expect(command, "board.read must join CommandsRpcGroup").toBeDefined();
  const schema = command!.successSchema;
  const items: Array<Record<string, unknown>> = [];
  for (let i = 0; ; i++) {
    const { _tag: _tag, replyToPostId, ...fields } = post;
    const item = { ...fields, replyTo: replyToPostId, postId: `post-${i}`, text: '\\"\n'.repeat(5_000), sequence: i + 1, status: "open", acknowledged: [], dispositions: [] };
    if (Buffer.byteLength(JSON.stringify([...items, item])) > 512 * 1024) break;
    items.push(item);
  }
  expect(Buffer.byteLength(JSON.stringify(items))).toBeGreaterThan(480 * 1024);
  const page = { requestId: "request-page", items, next: "cursor-next" };
  const decoded = Schema.decodeUnknownSync(schema)(page);
  expect(decoded).toEqual(page);
  expect(frameBytes(Schema.encodeSync(schema)(decoded), false)).toBeLessThan(900 * 1024);
});

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
