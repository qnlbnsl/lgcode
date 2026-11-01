import type { Event } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { Redactor } from "../log/Redactor.ts";
import { credentialLength, hasValidChecksum, sha256Hex } from "./credential.ts";

const replacement = "[REDACTED]";

// Encoded forms shorter than this are not matched on their own. Only the
// partial base64 runs of a very short secret are that short, and matching
// them would blank unrelated text. The full forms are always matched.
const minimumPartialLength = 8;

// The characters of base64 output that depend only on the secret's bytes
// when the secret starts `alignment` bytes into a longer encoded value
// (decision row 73: all three alignments). The leading and trailing
// characters that mix in neighbouring bytes are left out.
const base64Run = (bytes: Buffer, alignment: number): string => {
  const padded = Buffer.concat([Buffer.alloc(alignment), bytes, Buffer.alloc(2)]);
  const first = Math.ceil((8 * alignment) / 6);
  const end = Math.floor((8 * (alignment + bytes.byteLength)) / 6);
  return padded.toString("base64").slice(first, end);
};

// Every form of one secret that is matched (decision rows 57 and 73): raw,
// base64 and base64url (whole, and at each byte alignment inside a longer
// value), URL-encoded (upper- and lower-case escapes, and `+` for a space),
// and hexadecimal in both cases.
const formsOf = (secret: string): ReadonlyArray<string> => {
  if (secret.length === 0) return [];
  const bytes = Buffer.from(secret, "utf8");
  const base64 = bytes.toString("base64");
  const url = encodeURIComponent(secret);
  const hex = bytes.toString("hex");
  const partial: Array<string> = [];
  for (const alignment of [0, 1, 2]) {
    const run = base64Run(bytes, alignment);
    partial.push(run, run.replaceAll("+", "-").replaceAll("/", "_"));
  }
  const forms = [
    secret, base64, bytes.toString("base64url"),
    url, url.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()), url.replaceAll("%20", "+"),
    hex, hex.toUpperCase(),
    ...partial.filter((run) => run.length >= minimumPartialLength),
  ];
  return [...new Set(forms)];
};

type Interval = readonly [start: number, end: number];

// Every occurrence of every form, overlapping ones included, plus every
// token-shaped substring whose SHA-256 digest is a stored token or device
// hash. Only substrings that start with a credential prefix and pass the
// fixed-cost checksum are hashed, so the work is bounded by the text length
// (decision row 73).
const findMatches = (
  text: string, forms: ReadonlyArray<string>, tokenHashes: ReadonlySet<string>,
): Array<Interval> => {
  const found: Array<Interval> = [];
  for (const form of forms) {
    for (let at = text.indexOf(form); at !== -1; at = text.indexOf(form, at + 1)) found.push([at, at + form.length]);
  }
  if (tokenHashes.size > 0) {
    for (let at = text.indexOf("shp_"); at !== -1; at = text.indexOf("shp_", at + 1)) {
      const candidate = text.slice(at, at + credentialLength);
      if (hasValidChecksum(candidate) && tokenHashes.has(sha256Hex(candidate))) found.push([at, at + credentialLength]);
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of found) {
    const last = merged[merged.length - 1];
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
};

const render = (text: string, intervals: ReadonlyArray<Interval>, end: number): string => {
  let output = "";
  let at = 0;
  for (const [start, stop] of intervals) {
    if (stop > end) break;
    output += text.slice(at, start) + replacement;
    at = stop;
  }
  return output + text.slice(at, end);
};

// Copies a value with every string, and every object key, redacted. The
// input is never changed.
const redactValue = (value: unknown, redactText: (text: string) => string): unknown => {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, redactText));
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      // Defined, not assigned, so a `__proto__` key stays an ordinary field.
      Object.defineProperty(copy, redactText(key), {
        value: redactValue(item, redactText), enumerable: true, writable: true, configurable: true,
      });
    }
    return copy;
  }
  return value;
};

// The real redactor (task 5a.3). Both registries are read on every call, so a
// secret or a token hash added after construction is redacted at once.
// `layer` provides the `log/Redactor.ts` service that `EventLog.append` runs
// on every event before it is stored or returned (decision row 59).
export const makeRedactor = (registry: {
  readonly secrets: () => ReadonlyArray<Redacted.Redacted<string>>;
  readonly tokenHashes: () => ReadonlySet<string>;
}): {
  readonly layer: Layer.Layer<Redactor>;
  readonly redactText: (text: string) => string;
  readonly redactChunk: (itemId: string, text: string, final: boolean) => string;
} => {
  const currentForms = (): ReadonlyArray<string> => {
    const forms = new Set<string>();
    for (const secret of registry.secrets()) for (const form of formsOf(Redacted.value(secret))) forms.add(form);
    return [...forms];
  };

  const redactWith = (forms: ReadonlyArray<string>, tokenHashes: ReadonlySet<string>) => (text: string): string => {
    const intervals = findMatches(text, forms, tokenHashes);
    return intervals.length === 0 ? text : render(text, intervals, text.length);
  };
  const redactText = (text: string): string => redactWith(currentForms(), registry.tokenHashes())(text);

  // Streamed text is joined per item (decision row 57). Each call releases
  // only the part that no later chunk can turn into a match: everything
  // before the last (window - 1) characters, where the window is the longest
  // matched form, and never part of a match that reaches into that tail.
  const carries = new Map<string, string>();
  const redactChunk = (itemId: string, text: string, final: boolean): string => {
    const joined = (carries.get(itemId) ?? "") + text;
    if (final) {
      carries.delete(itemId);
      return redactText(joined);
    }
    const forms = currentForms();
    const window = Math.max(credentialLength, ...forms.map((form) => form.length));
    const intervals = findMatches(joined, forms, registry.tokenHashes());
    let cut = Math.max(0, joined.length - (window - 1));
    for (const [start, end] of intervals) {
      if (start < cut && end > cut) cut = start;
    }
    carries.set(itemId, joined.slice(cut));
    return render(joined, intervals, cut);
  };

  const layer = Layer.succeed(Redactor, {
    redact: (event: Event) => Effect.sync(() =>
      redactValue(event, redactWith(currentForms(), registry.tokenHashes())) as Event),
  });

  return { layer, redactText, redactChunk };
};
