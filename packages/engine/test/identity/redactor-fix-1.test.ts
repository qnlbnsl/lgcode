import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { AgentId, BootId, DeviceId, RequestId, type Event } from "@shepherd/contracts";
import * as SqliteClient from "@shepherd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import * as Credential from "../../src/identity/credential.ts";
import { mintDeviceCredential } from "../../src/identity/devices.ts";
import { redactingLoggerLayer } from "../../src/identity/logger.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { mintAgentToken } from "../../src/identity/tokens.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Views from "../../src/views/Views.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/shepherd-redactor-fix-1-");
  vi.stubEnv("HOME", home);
  vi.stubEnv("SHEPHERD_HOME", home);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const agentId = Schema.decodeUnknownSync(AgentId)("agent-a");
const deviceId = Schema.decodeUnknownSync(DeviceId)("phone");
const requestId = () => Schema.decodeUnknownSync(RequestId)(randomUUID());
const textEvent = (text: string): Event => ({
  _tag: "ThreadItem", agentId, itemId: "text", content: { _tag: "text", text }, replay: false,
});
const redactorFor = (secret: string) => makeRedactor({
  secrets: () => [Redacted.make(secret)], tokenHashes: () => new Set<string>(),
});
const withLog = <A, E>(instance: ReturnType<typeof makeRedactor>, body: Effect.Effect<A, E, EventLog.EventLog | SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    yield* migrate;
    return yield* Effect.gen(function* () {
      yield* registerRebuildCheck();
      return yield* body;
    }).pipe(
      Effect.scoped,
      Effect.provide(EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provide(instance.layer))),
    );
  }).pipe(Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })), Effect.scoped);

// Control bytes make the JSON-escaped form longer than the URL and hex
// forms, so the streaming test also catches a carry window that omits JSON.
const escapedSecret = 'synthetic-"key\\with-quotes-0123456789' + "\u0001".repeat(24);
const escaped = JSON.stringify(escapedSecret).slice(1, -1);
const checkDatabaseBytes = (needles: ReadonlyArray<string>) => {
  for (const name of readdirSync(home)) {
    const bytes = readFileSync(join(home, name));
    for (const needle of needles) expect(bytes.includes(Buffer.from(needle)), `${name} contains a secret form`).toBe(false);
  }
};

it.effect.each(["tool-input", "tool-output", "file-diff"] as const)(
  "U5A-F01 %s: catches JSON-escaped secrets reaching envelopes, receipts or checkpointed database bytes",
  (location) => {
    const serialized = JSON.stringify({ key: escapedSecret, safe: "keep" });
    const event: Event = {
      _tag: "ThreadItem", agentId, itemId: location, replay: false,
      content: location === "file-diff"
        ? { _tag: "file-change", path: "config.json", diff: `-old\n+${serialized}\n` }
        : { _tag: "tool-call", callId: "call", title: "Inspect", status: "completed",
          ...(location === "tool-input" ? { input: serialized } : { output: serialized }) },
    };
    return withLog(redactorFor(escapedSecret), Effect.gen(function* () {
      const log = yield* EventLog.EventLog;
      const sql = yield* SqlClient.SqlClient;
      const envelopes = yield* log.append({ _tag: "owner" }, requestId(), "a".repeat(64), [event], {});
      const stored = yield* sql<{ payload_json: string }>`SELECT payload_json FROM events`;
      const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts`;
      yield* sql`PRAGMA wal_checkpoint(FULL)`;
      // Soft assertions inspect every boundary even on the unfixed baseline.
      const content = envelopes[0]!.event;
      expect.soft(content).toMatchObject({ content: location === "file-diff"
        ? { diff: '-old\n+{"key":"[REDACTED]","safe":"keep"}\n' }
        : location === "tool-input" ? { input: '{"key":"[REDACTED]","safe":"keep"}' }
        : { output: '{"key":"[REDACTED]","safe":"keep"}' } });
      for (const value of [envelopes, stored.map((row) => JSON.parse(row.payload_json)), receipts.map((row) => JSON.parse(row.result_json))]) {
        expect.soft(JSON.stringify(value)).not.toContain(JSON.stringify(escaped).slice(1, -1));
      }
      checkDatabaseBytes([escapedSecret, escaped, JSON.stringify(escaped).slice(1, -1)]);
    }));
  },
);

it.effect("U5A-F01 logger: catches JSON-escaped secrets surviving a pre-serialized message", () => {
  const output: Array<string> = [];
  return Effect.logInfo(JSON.stringify({ key: escapedSecret, safe: "keep" })).pipe(
    Effect.provide(redactingLoggerLayer(redactorFor(escapedSecret), (line) => { output.push(line); })),
    Effect.andThen(Effect.sync(() => {
      expect(output).toHaveLength(1);
      expect(JSON.parse(output[0]!).message).toBe('{"key":"[REDACTED]","safe":"keep"}');
      expect(output.join("\n")).not.toContain(JSON.stringify(escaped).slice(1, -1));
    })),
  );
});

it.effect("U5A-F01 streaming: catches an escaped JSON form split at any boundary or truncated by a raw-length carry", () =>
  Effect.sync(() => {
    for (let cut = 1; cut < escaped.length; cut++) {
      const instance = redactorFor(escapedSecret);
      const first = instance.redactChunk("json", `before ${escaped.slice(0, cut)}`, false);
      const last = instance.redactChunk("json", `${escaped.slice(cut)} after`, true);
      expect(first + last, `escaped form split at ${cut}`).toBe("before [REDACTED] after");
    }
  }),
);

// Alternate the case of hexadecimal letters only, including letters inside
// percent escapes. Literal letters of a URL encoding are never case-folded.
const mixedHex = (value: string) => {
  let index = 0;
  return value.replace(/[a-f]/gi, (letter) => index++ % 2 === 0 ? letter.toLowerCase() : letter.toUpperCase());
};
const caseSecret = "CaseSensitive-ÿÿ+/ key?=0123456789";
const caseForms = [
  ["hex-lower", Buffer.from(caseSecret).toString("hex")],
  ["hex-upper", Buffer.from(caseSecret).toString("hex").toUpperCase()],
  ["hex-mixed", mixedHex(Buffer.from(caseSecret).toString("hex"))],
  ["url-lower", encodeURIComponent(caseSecret).replace(/%[0-9a-f]{2}/gi, (part) => part.toLowerCase())],
  ["url-upper", encodeURIComponent(caseSecret)],
  ["url-mixed", encodeURIComponent(caseSecret).replace(/%[0-9a-f]{2}/gi, mixedHex)],
] as const;

it.effect.each(caseForms)(
  "B6 %s: catches case-sensitive encoded digits in full text and streaming carry",
  ([_name, encoded]) => Effect.sync(() => {
    const instance = redactorFor(caseSecret);
    expect.soft(instance.redactText(`before ${encoded} after`)).toBe("before [REDACTED] after");
    const cut = Math.floor(encoded.length / 2);
    expect(instance.redactChunk("case", `before ${encoded.slice(0, cut)}`, false)
      + instance.redactChunk("case", `${encoded.slice(cut)} after`, true)).toBe("before [REDACTED] after");
  }),
);

it.effect("B6 literal case: catches case-folding literal letters along with percent-escape digits", () => Effect.sync(() => {
  const instance = redactorFor(caseSecret);
  const different = "caseSensitive-ÿÿ+/ key?=0123456789";
  const encoded = encodeURIComponent(different).replace(/%[0-9a-f]{2}/gi, mixedHex);
  for (const text of [different, encoded]) {
    expect(instance.redactText(text)).toBe(text);
    expect(instance.redactChunk(text, text.slice(0, 12), false)
      + instance.redactChunk(text, text.slice(12), true)).toBe(text);
  }
}));

const percentEncode = (value: string) => [...Buffer.from(value)].map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join("");
const encodings: ReadonlyArray<readonly [string, (raw: string) => string]> = [
  ["raw", (raw) => raw],
  ...[0, 1, 2].map((alignment) => [`base64-${alignment}`, (raw: string) =>
    Buffer.from("x".repeat(alignment) + raw + "suffix").toString("base64")] as const),
  ...[0, 1, 2].map((alignment) => [`base64url-${alignment}`, (raw: string) =>
    Buffer.from("x".repeat(alignment) + raw + "suffix").toString("base64url")] as const),
  ["url-lower", percentEncode],
  ["url-upper", (raw) => percentEncode(raw).toUpperCase()],
  ["url-mixed", (raw) => mixedHex(percentEncode(raw))],
  ["hex-lower", (raw) => Buffer.from(raw).toString("hex")],
  ["hex-upper", (raw) => Buffer.from(raw).toString("hex").toUpperCase()],
  ["hex-mixed", (raw) => mixedHex(Buffer.from(raw).toString("hex"))],
];

it.effect.each((["agent", "device"] as const).flatMap((kind) => encodings.map(([encoding, encode]) => ({ kind, encoding, encode }))))(
  "B7 $kind/$encoding: catches encoded stored credentials escaping the hash registry or unknown credentials being removed",
  ({ kind, encode }) => {
    const mint = kind === "agent" ? mintAgentToken : mintDeviceCredential;
    const live = mint();
    const raw = Redacted.value(live.token);
    const unknown = Redacted.value(mint().token);
    const instance = makeRedactor({ secrets: () => [], tokenHashes: () => new Set([live.tokenHash]) });
    return withLog(instance, Effect.gen(function* () {
      const log = yield* EventLog.EventLog;
      const sql = yield* SqlClient.SqlClient;
      yield* log.append({ _tag: "owner" }, requestId(), "b".repeat(64), [kind === "agent"
        ? { _tag: "TurnStarted", agentId }
        : { _tag: "DeviceAdded", deviceId, name: "Phone" }], kind === "agent"
        ? { agentTokens: [{ agentId, tokenHash: live.tokenHash, revokedAt: null }] }
        : { devices: [{ deviceId, name: "Phone", tokenHash: live.tokenHash, createdAt: 1, revokedAt: null }] });
      const rows = kind === "agent"
        ? yield* sql<{ token_hash: string }>`SELECT token_hash FROM agent_tokens`
        : yield* sql<{ token_hash: string }>`SELECT token_hash FROM devices`;
      expect(rows).toEqual([{ token_hash: live.tokenHash }]);
      const encoded = encode(raw);
      const unknownText = `unknown:${encode(unknown)}; safe`;
      expect.soft(instance.redactText(unknownText)).toBe(unknownText);
      const output = instance.redactText(`before ${encoded} after`);
      expect.soft(output).toContain("[REDACTED]");
      expect.soft(output).not.toContain(encoded);
      expect.soft(output.startsWith("before ")).toBe(true);
      expect.soft(output.endsWith(" after")).toBe(true);
      const cut = Math.floor(encoded.length / 2);
      const streamed = instance.redactChunk("token", encoded.slice(0, cut), false)
        + instance.redactChunk("token", encoded.slice(cut), true);
      expect.soft(streamed).toContain("[REDACTED]");
      expect.soft(streamed).not.toContain(encoded);
      const envelopes = yield* log.append({ _tag: "owner" }, requestId(), "c".repeat(64), [textEvent(encoded)], {});
      expect(JSON.stringify(envelopes)).not.toContain(encoded);
    }));
  },
);

it.effect.each(["agent", "device"] as const)("B7 checksum bound/%s: catches hashing malformed encoded candidates before validating their checksum", (kind) => Effect.sync(() => {
  const live = kind === "agent" ? mintAgentToken() : mintDeviceCredential();
  const raw = Redacted.value(live.token);
  const bad = raw.slice(0, -1) + (raw.endsWith("0") ? "1" : "0");
  const hash = vi.spyOn(Credential, "sha256Hex");
  const instance = makeRedactor({ secrets: () => [], tokenHashes: () => new Set([live.tokenHash]) });
  // Positive control: the spy really sees the token-lookup hash boundary.
  expect(instance.redactText(raw)).toBe("[REDACTED]");
  expect(hash.mock.calls.some(([value]) => value === raw)).toBe(true);
  hash.mockClear();
  for (const [, encode] of encodings) {
    const input = `before ${encode(bad)} after`;
    expect(instance.redactText(input)).toBe(input);
  }
  // The fixed-cost checksum may hash its 32 decoded bytes. No invalid
  // candidate string may be hashed for a stored-token lookup.
  expect(hash.mock.calls.filter(([value]) => typeof value === "string")).toEqual([]);
}));

it.effect.each(["device-name", "process-executable"] as const)(
  "U5A-F02 B9 %s: catches free text bypassing redaction in side rows while events and receipts are sanitized",
  (field) => {
    const secret = "side-row-secret-0123456789";
    const live = mintDeviceCredential();
    return withLog(redactorFor(secret), Effect.gen(function* () {
      const log = yield* EventLog.EventLog;
      const sql = yield* SqlClient.SqlClient;
      const envelopes = yield* log.append({ _tag: "owner" }, requestId(), "d".repeat(64), [field === "device-name"
        ? { _tag: "DeviceAdded", deviceId, name: `Phone ${secret}` }
        : textEvent(`Executable /tmp/${secret}/runner`)], field === "device-name"
        ? { devices: [{ deviceId, name: `Phone ${secret}`, tokenHash: live.tokenHash, createdAt: 1, revokedAt: null }] }
        : { processes: [{ agentId, groupId: 42, bootId: Schema.decodeUnknownSync(BootId)("boot"), startTime: "123", userId: 1000, executable: `/tmp/${secret}/runner` }] });
      const rows = field === "device-name"
        ? yield* sql<{ name: string; token_hash: string }>`SELECT name, token_hash FROM devices`
        : yield* sql<{ executable: string }>`SELECT executable FROM processes`;
      expect.soft(rows).toEqual(field === "device-name"
        ? [{ name: "Phone [REDACTED]", token_hash: live.tokenHash }]
        : [{ executable: "/tmp/[REDACTED]/runner" }]);
      const events = yield* sql`SELECT payload_json FROM events`;
      const receipts = yield* sql`SELECT result_json FROM receipts`;
      for (const value of [envelopes, events, receipts]) {
        expect.soft(JSON.stringify(value)).not.toContain(secret);
        expect.soft(JSON.stringify(value)).toContain("[REDACTED]");
      }
      yield* sql`PRAGMA wal_checkpoint(FULL)`;
      checkDatabaseBytes([secret]);
    }));
  },
);

it.effect("U5A-F07 streaming progress: catches merging adjacent matches into a carry that grows without output", () => Effect.sync(() => {
  const secret = "0123456789abcdef";
  const instance = redactorFor(secret);
  let output = "";
  for (let chunk = 0; chunk < 20; chunk++) {
    const previous = output.length;
    output += instance.redactChunk("repeats", secret.repeat(64), false);
    expect.soft(output.length, `output must advance after chunk ${chunk + 1}`).toBeGreaterThan(previous);
    expect(output).not.toContain(secret);
    // The carry is private. Progress on every chunk is the ruling's public
    // observation of its bound; adjacent matches may share a replacement.
  }
  output += instance.redactChunk("repeats", " safe tail", true);
  expect(output).toMatch(/^(?:\[REDACTED\])+ safe tail$/);
}));
