import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Client } from "@lgcode/client";
import type { EventEnvelope } from "@lgcode/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";

// Unit 8c: the helpers that the acceptance harness (`test/support/acceptance.ts`)
// and the live check (`scripts/live-check.ts`) both use. They import nothing
// from vitest, so a plain Node script can load them; `acceptance.ts` re-exports
// them, so the 8b scenarios keep their imports.

export const requestId = (): string => `request-${randomUUID()}`;

// A call of the client, as an effect that never fails for a refusal: the
// refusal reason is the value. Used where a scenario asserts a refusal.
export const refusal = <A>(effect: Effect.Effect<A, unknown>): Effect.Effect<string | undefined> =>
  effect.pipe(Effect.exit, Effect.map((exit) => {
    if (Exit.isSuccess(exit)) return undefined;
    const failure = Cause.findErrorOption(exit.cause);
    const error = failure._tag === "Some" ? failure.value as { _tag?: string; reason?: string } : undefined;
    return error?._tag === "CommandError" ? error.reason : `not a refusal: ${String(exit.cause)}`.slice(0, 300);
  }));

export const head = (client: Client): Effect.Effect<number> =>
  (client["debug.compare-views"]({ requestId: requestId() } as never) as Effect.Effect<{ sequence: number }, unknown>).pipe(
    Effect.map((reply) => reply.sequence), Effect.orDie,
  );

// Every event after `after`, up to and including the first that `last`
// accepts; fails with `what` if none arrives within `limit`.
export const eventsUntil = (
  client: Client, after: number, what: string, last: (envelope: EventEnvelope) => boolean, limit = 20_000,
): Effect.Effect<ReadonlyArray<EventEnvelope>> =>
  (client.subscribe({ requestId: requestId(), after } as never) as Stream.Stream<EventEnvelope, unknown>).pipe(
    Stream.takeUntil(last), Stream.runCollect,
    Effect.timeoutOrElse({ duration: limit, orElse: () => Effect.die(new Error(`Timed out after ${limit} ms waiting for ${what}`)) }),
    Effect.map((events) => [...events]), Effect.orDie,
  );

export const next = (
  client: Client, after: number, what: string, predicate: (envelope: EventEnvelope) => boolean, limit = 20_000,
): Effect.Effect<EventEnvelope> =>
  eventsUntil(client, after, what, predicate, limit).pipe(Effect.map((events) => events[events.length - 1]!));

// The events committed after `after`, up to the head now. Used to count
// what one step caused, never totals (issue 55).
export const since = (client: Client, after: number): Effect.Effect<ReadonlyArray<EventEnvelope>> => Effect.gen(function* () {
  const end = yield* head(client);
  if (end <= after) return [];
  return yield* eventsUntil(client, after, `catching up to sequence ${end}`, (envelope) => envelope.sequence >= end, 30_000);
});

export const tagged = (events: ReadonlyArray<EventEnvelope>, tag: string, agentId?: string): ReadonlyArray<EventEnvelope> =>
  events.filter((envelope) => envelope.event._tag === tag && (agentId === undefined || envelope.agentId === agentId));

export const isTag = (tag: string, agentId?: string) => (envelope: EventEnvelope): boolean =>
  envelope.event._tag === tag && (agentId === undefined || envelope.agentId === agentId);

export const stateIs = (agentId: string, state: string) => (envelope: EventEnvelope): boolean =>
  envelope.agentId === agentId && envelope.event._tag === "StateChanged" && (envelope.event as { state: { _tag: string } }).state._tag === state;

// The agent's own words in its thread, in order.
export const threadText = (events: ReadonlyArray<EventEnvelope>, agentId: string): string =>
  events.filter((envelope) => envelope.agentId === agentId && envelope.event._tag === "ThreadItem")
    .map((envelope) => {
      const content = (envelope.event as { content: { _tag: string; text?: string } }).content;
      return content._tag === "text" ? content.text ?? "" : `[${content._tag}]`;
    }).join("");

// The owner credential of a service, in the forms a leak could take. The file
// is the service's own, in the state folder of the `/tmp` root it was given.
// A file that cannot be read is an error, not an empty list: a scan with
// nothing to look for would pass, and so would a redaction that hides nothing.
export const readOwnerCredentialFrom = (stateFolder: string): ReadonlyArray<string> => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(stateFolder, "owner-credential"));
  } catch (error) {
    throw new Error(`the owner credential could not be read (${error instanceof Error && "code" in error ? String(error.code) : "unreadable"}), so nothing can be scanned for or hidden`);
  }
  if (bytes.length === 0) throw new Error("the owner credential could not be read (the file is empty), so nothing can be scanned for or hidden");
  return [bytes.toString("base64url"), bytes.toString("base64"), bytes.toString("hex")];
};

// ---- The secret scan (criterion 8.5, security rules) ---------------------
//
// A value can reach an event or an output in more forms than the raw one: JSON
// escaped, base64 at any alignment inside a longer text, base64url, hex, and
// percent encoded. `findLeaks` looks for every form of every secret in every
// source and returns only labels ("secret 3 (base64) in output of process 2"),
// never a value, so a failing scan does not print the credential it found.
const base64Forms = (value: string): ReadonlyArray<string> => {
  const bytes = Buffer.from(value, "utf8");
  return [0, 1, 2].flatMap((offset) => {
    // Inside a longer text, only the characters whose six bits all come from
    // the value are the same whatever surrounds it.
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString("base64");
    const from = Math.ceil(offset * 8 / 6);
    const to = Math.floor((offset + bytes.length) * 8 / 6);
    return to > from ? [encoded.slice(from, to)] : [];
  });
};

const formsOf = (value: string): ReadonlyArray<readonly [string, string]> => {
  const url = (text: string) => text.replaceAll("+", "-").replaceAll("/", "_");
  return [
    ["raw", value],
    ["json", JSON.stringify(value).slice(1, -1)],
    ...base64Forms(value).map((form) => ["base64", form] as const),
    ...base64Forms(value).map((form) => ["base64url", url(form)] as const),
    ["hex", Buffer.from(value, "utf8").toString("hex")],
    ["percent", encodeURIComponent(value)],
  ];
};

export interface LeakSource {
  readonly label: string;
  readonly text: string;
}

export const findLeaks = (secrets: Iterable<string>, sources: ReadonlyArray<LeakSource>): ReadonlyArray<string> => {
  const found = new Set<string>();
  let index = 0;
  for (const secret of secrets) {
    index += 1;
    const seen = new Set<string>();
    for (const [form, needle] of formsOf(secret)) {
      // A form that equals one already tried (a plain secret is its own JSON
      // and percent form) is reported once, under the first name.
      if (needle.length < 8 || seen.has(needle)) continue;
      seen.add(needle);
      for (const source of sources) if (source.text.includes(needle)) found.add(`secret ${index} (${form}) in ${source.label}`);
    }
  }
  return [...found];
};

// The text with every form of every secret replaced, longest form first so a
// form that contains a shorter one is hidden whole. Only the forms `findLeaks`
// looks for are hidden, so what the scan can find is what the printer hides.
export const redactSecrets = (text: string, secrets: Iterable<string>): string => {
  const needles = new Set<string>();
  for (const secret of secrets) for (const [, needle] of formsOf(secret)) if (needle.length >= 8) needles.add(needle);
  let result = text;
  for (const needle of [...needles].sort((left, right) => right.length - left.length)) result = result.replaceAll(needle, "[redacted]");
  return result;
};

// Shapes that look like a credential whatever the run knows: a bearer or basic
// token, and a value assigned to a name such as token, password or api key.
export const redactShapes = (text: string): string => text
  .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, "$1 [redacted]")
  .replace(/\b(authorization|token|secret|password|passwd|api[_-]?key|credential)(["']?\s*[:=]\s*["']?)(?!\[redacted\]|Bearer\b|Basic\b)([^\s"',;}]+)/gi, "$1$2[redacted]");

// Each agent's own words in one string, text items only, so a secret that an
// agent's output split over two items is one string again.
export const threadSources = (events: ReadonlyArray<EventEnvelope>): ReadonlyArray<LeakSource> => {
  const byAgent = new Map<string, string>();
  for (const envelope of events) {
    if (envelope.event._tag !== "ThreadItem" || envelope.agentId === undefined) continue;
    const content = (envelope.event as { content: { _tag: string; text?: string } }).content;
    if (content._tag === "text") byAgent.set(envelope.agentId, (byAgent.get(envelope.agentId) ?? "") + (content.text ?? ""));
  }
  return [...byAgent.values()].map((text, index) => ({ label: `thread of agent ${index + 1}`, text }));
};

// A reply or a refusal, as the text a scan reads.
export const show = (value: unknown): string => {
  try {
    if (value instanceof Error) return JSON.stringify({ ...value, name: value.name, message: value.message });
    return JSON.stringify(value) ?? String(value);
  } catch { return String(value); }
};

// Records every reply and every refusal of a client call, so the final scan
// reads what the API said, not only what the log holds. Streams are not
// recorded; their events are read from the log.
export const recordReplies = (client: Client, sink: Array<string>): Client => new Proxy(client, {
  get(target, key, receiver) {
    const value: unknown = Reflect.get(target, key, receiver);
    if (typeof value !== "function") return value;
    return (...args: ReadonlyArray<unknown>) => {
      const result: unknown = value.apply(target, args);
      if (!Effect.isEffect(result)) return result;
      return (result as Effect.Effect<unknown, unknown>).pipe(
        Effect.tap((reply) => Effect.sync(() => { sink.push(show(reply)); })),
        Effect.tapError((error) => Effect.sync(() => { sink.push(show(error)); })),
      );
    };
  },
});
