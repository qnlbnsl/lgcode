import type { Delivery, Event, EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import { encodedBytes } from "../client/reads/display.ts";
import { refused, type Input } from "../commands/internal.ts";
import { agentRead } from "../log/agentRead.ts";
import { envelope, escapeLeadingSlash } from "../routing/envelope.ts";
import { holderAbove, mayActForHolder } from "../routing/holders.ts";

const sectionLimit = 20 * 1024;
const replyLimit = Math.min(16_000 * 3, 64 * 1024);
const cutMarker = (sequence: number) => `[Cut at sequence ${sequence}]`;
interface Piece { readonly sequence: number; readonly text: string; readonly bulk: boolean }
interface Range { from: number; to: number }

// All prefixes end at Unicode code points. The predicate measures JSON, so
// quotes, backslashes and control characters cost their encoded size.
const fitText = (text: string, sequence: number, fits: (value: string) => boolean): string | undefined => {
  if (fits(text)) return text;
  const suffix = `\n${cutMarker(sequence)}`;
  if (!fits(suffix)) return undefined;
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(characters.slice(0, middle).join("") + suffix)) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join("") + suffix;
};

const preview = (piece: Piece): string => {
  const characters = Array.from(piece.text);
  const marker = ` ${cutMarker(piece.sequence)}`;
  return characters.length <= 240 ? piece.text
    : characters.slice(0, 240 - Array.from(marker).length).join("") + marker;
};

const deliveryText = (delivery: Delivery): string => delivery.content._tag === "compact"
  ? "Compaction requested." : escapeLeadingSlash(delivery.content.text);

const contentText = (content: Extract<Event, { _tag: "ThreadItem" }>["content"], sequence: number): string => {
  switch (content._tag) {
    case "text": return escapeLeadingSlash(content.text);
    case "plan": return content.entries.map((entry) => `${entry.priority}, ${entry.status}:\n${escapeLeadingSlash(entry.content)}`).join("\n");
    case "file-change": return `File:\n${escapeLeadingSlash(content.path)}\n${escapeLeadingSlash(content.diff)}`;
    case "tool-call": {
      // When both fields are large, leave room for output as well as input.
      // Messages receive their allocation before either of these fields.
      const input = content.input === undefined ? undefined : escapeLeadingSlash(content.input);
      const output = content.output === undefined ? undefined : escapeLeadingSlash(content.output);
      const boundedInput = input !== undefined && output !== undefined && encodedBytes(input) + encodedBytes(output) > sectionLimit
        ? fitText(input, sequence, (value) => encodedBytes(value) <= sectionLimit / 2)! : input;
      return [`Tool (${content.status}):\n${escapeLeadingSlash(content.title)}`,
        ...(boundedInput === undefined ? [] : [`Input:\n${boundedInput}`]),
        ...(output === undefined ? [] : [`Output:\n${output}`]),
      ].join("\n");
    }
  }
};

const omittedRanges = (sources: ReadonlyArray<Piece>, retained: ReadonlySet<number>): Range[] => {
  const ranges: Range[] = [];
  for (const source of sources) {
    if (retained.has(source.sequence)) continue;
    const previous = ranges.at(-1);
    // A gap can belong to another agent or to a non-content event. Never
    // widen a range across it, even if both ends belong to this thread.
    if (previous !== undefined && previous.to + 1 === source.sequence) previous.to = source.sequence;
    else ranges.push({ from: source.sequence, to: source.sequence });
  }
  return ranges;
};

export const buildHandoff = (agentId: string, requestId: unknown, rows: ReadonlyArray<EventEnvelope>) => {
  const sources: Piece[] = [];
  const items: Piece[] = [];
  const deliveries = new Map<string, Piece>();
  let first: Piece | undefined;
  let lastSent: Extract<EventEnvelope["event"], { _tag: "DeliverySent" }> | undefined;
  let sentSequence = 0;
  for (const row of rows) {
    const event = row.event;
    if (event._tag === "AgentStarted" && event.firstPromptDelivery !== undefined) {
      first = { sequence: row.sequence, text: deliveryText(event.firstPromptDelivery), bulk: false };
      sources.push(first);
      deliveries.set(event.firstPromptDelivery.id, first);
    } else if (event._tag === "DeliveryQueued") {
      const piece = { sequence: row.sequence, text: deliveryText(event.delivery), bulk: false };
      sources.push(piece);
      deliveries.set(event.delivery.id, piece);
    } else if (event._tag === "ThreadItem") {
      const piece = { sequence: row.sequence, text: contentText(event.content, row.sequence),
        bulk: event.content._tag === "tool-call" || event.content._tag === "file-change" };
      sources.push(piece);
      items.push(piece);
    } else if (event._tag === "DeliverySent") {
      lastSent = event;
      sentSequence = row.sequence;
    }
  }

  const retained = new Set<number>();
  const body = { agentId, firstPrompt: first === undefined ? "No first prompt was recorded." : "",
    lastExchange: "No exchange was recorded.", recent: [] as Array<{ sequence: number; text: string }>, omitted: [] as Range[] };
  // Inserting the JSON body into the envelope adds one further JSON string
  // encoding. The marker has a fixed length, including when redrawn to avoid
  // a collision. Generate the actual envelope only after selection is final.
  const overhead = encodedBytes({ requestId, data: envelope("read", "") });
  const fitsReply = () => {
    body.omitted = omittedRanges(sources, retained);
    return overhead + encodedBytes(JSON.stringify(body)) - 2 <= replyLimit;
  };
  if (!fitsReply()) return undefined;

  if (first !== undefined) {
    retained.add(first.sequence);
    const fitted = fitText(first.text, first.sequence, (value) => {
      body.firstPrompt = value;
      return encodedBytes(value) <= sectionLimit && fitsReply();
    });
    if (fitted === undefined) return undefined;
    body.firstPrompt = fitted;
  }

  if (lastSent !== undefined) {
    const user = deliveries.get(lastSent.deliveryId);
    const pieces: Piece[] = [user ?? { sequence: sentSequence,
      text: `${cutMarker(sentSequence)}: the prompt is unavailable to this caller.`, bulk: false },
    ...items.filter((piece) => piece.sequence > sentSequence)];
    const selected = new Map<Piece, string>();
    const render = () => pieces.flatMap((piece, index) => {
      const text = selected.get(piece);
      return text === undefined ? [] : [`${index === 0 ? "User" : "Agent"} (sequence ${piece.sequence}):\n${text}`];
    }).join("\n\n");
    body.lastExchange = "";
    const select = (piece: Piece, text: string) => {
      const wasRetained = retained.has(piece.sequence);
      const previous = selected.get(piece);
      retained.add(piece.sequence);
      const fitted = fitText(text, piece.sequence, (value) => {
        selected.set(piece, value);
        body.lastExchange = render();
        return encodedBytes(body.lastExchange) <= sectionLimit && fitsReply();
      });
      if (fitted === undefined) {
        if (previous === undefined) selected.delete(piece);
        else selected.set(piece, previous);
        if (!wasRetained) retained.delete(piece.sequence);
      } else selected.set(piece, fitted);
      body.lastExchange = render();
    };
    // Reserve a preview of each message before expanding any one of them.
    // A large user prompt must leave evidence of the answer in the section.
    const messages = pieces.filter((piece) => !piece.bulk);
    for (const piece of messages) select(piece, preview(piece));
    for (const piece of messages) select(piece, piece.text);
    // Tools and diffs get only the space left by messages. Their position in
    // the rendered exchange still follows the original thread order.
    for (const piece of pieces.filter((piece) => piece.bulk)) select(piece, piece.text);
  }

  // Tools and file changes not already represented form a suffix: stop at
  // the first one that cannot fit, rather than filling holes with older ones.
  for (const piece of items.filter((piece) => piece.bulk && !retained.has(piece.sequence)).reverse()) {
    retained.add(piece.sequence);
    body.recent.unshift({ sequence: piece.sequence, text: preview(piece) });
    if (!fitsReply()) {
      body.recent.shift();
      retained.delete(piece.sequence);
      break;
    }
  }
  if (!fitsReply()) return undefined;
  return { requestId, data: envelope("read", JSON.stringify(body)) };
};

export const handoff = (input: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
  const agentId = payload.agentId as string;
  const snapshot = yield* input.runtime.views.snapshot;
  if (snapshot.agents[agentId] === undefined || (input.actor._tag !== "owner" && input.actor._tag !== "agent")
    || !mayActForHolder(snapshot, input.actor, holderAbove(snapshot, agentId))) return yield* refused();
  const rows: EventEnvelope[] = [];
  let after = 0;
  for (;;) {
    const page = yield* agentRead({ caller: input.actor, agentId, after, limit: 500 }, input.runtime.lists);
    rows.push(...page.items);
    if (page.next === undefined) break;
    after = page.next;
  }
  // Reading can span pages. Check management again against the current view
  // before releasing any data if the effective holder changed meanwhile.
  const current = yield* input.runtime.views.snapshot;
  if (!mayActForHolder(current, input.actor, holderAbove(current, agentId))) return yield* refused();
  const reply = buildHandoff(agentId, payload.requestId, rows);
  return reply === undefined ? yield* refused("hand-off metadata exceeds the reply budget") : { reply };
});
