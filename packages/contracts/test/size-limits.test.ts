// Board unit 1.11: measure actual schema-encoded RPC frames, including the
// stream Chunk or terminal Exit wrapper. A character count is not a byte cap.
import * as Contracts from "../src/index.ts";
import * as Schema from "effect/Schema";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import type { ResponseChunkEncoded, ResponseExitEncoded } from "effect/rpc/RpcMessage";
import { expect, it } from "vitest";
import { agent, codec, envelope, exported, post } from "./board/fixtures.ts";

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
  const decoded = Schema.decodeUnknownSync(schema)(envelope(event));
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
  const event = { _tag: "board.WakeBuilt", wakeId: "wake-1", targetAgentId: "target", carried: ids, mustReply: ids, completions: [], reminders: [], noAnswers: [] };
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
    const { _tag: _tag, ...fields } = post;
    const item = { ...fields, postId: `post-${i}`, text: '\\"\n'.repeat(5_000), sequence: i + 1, status: "open", acknowledged: [], dispositions: [] };
    if (Buffer.byteLength(JSON.stringify([...items, item])) > 512 * 1024) break;
    items.push(item);
  }
  expect(Buffer.byteLength(JSON.stringify(items))).toBeGreaterThan(480 * 1024);
  const page = { requestId: "request-page", items, next: "cursor-next" };
  const decoded = Schema.decodeUnknownSync(schema)(page);
  expect(decoded).toEqual(page);
  expect(frameBytes(Schema.encodeSync(schema)(decoded), false)).toBeLessThan(900 * 1024);
});
