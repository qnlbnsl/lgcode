import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { AgentId, DeliveryId, PermissionRequestId, RequestId, type Event } from "@lgtm/contracts";
import * as AcpClient from "@lgtm/t3-effect-acp/client";
import * as SqliteClient from "@lgtm/t3-node-sqlite/nodeSqliteClient";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Stream from "effect/Stream";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { makeRedactor } from "../../src/identity/redactor.ts";
import { redactingLoggerLayer } from "../../src/identity/logger.ts";
import { mintAgentToken } from "../../src/identity/tokens.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Views from "../../src/views/Views.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { Redactor } from "../../src/log/Redactor.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/lgtm-redactor-");
  vi.stubEnv("HOME", home);
  vi.stubEnv("LGTM_HOME", home);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });

const agentId = Schema.decodeUnknownSync(AgentId)("agent-a");
const secret = "ÿÿaccount+/ key?=0123456789ABCdef";
const secondSecret = "another-secret-9876543210";
const forms = [
  ["raw", secret],
  ["base64", Buffer.from(secret).toString("base64")],
  ["base64url", Buffer.from(secret).toString("base64url")],
  ["url", encodeURIComponent(secret)],
  ["hex-lower", Buffer.from(secret).toString("hex")],
  ["hex-upper", Buffer.from(secret).toString("hex").toUpperCase()],
] as const;
const redactor = () => makeRedactor({
  secrets: () => [Redacted.make(secret), Redacted.make(secondSecret)],
  tokenHashes: () => new Set<string>(),
});
const textEvent = (text: string): Event => ({
  _tag: "ThreadItem", agentId, itemId: "item-a", content: { _tag: "text", text }, replay: false,
});
const redactEvent = (event: Event) => Effect.gen(function* () {
  const service = yield* Redactor;
  return yield* service.redact(event);
}).pipe(Effect.provide(redactor().layer));

it.effect.each(forms)(
  "5.11 encoding/%s: catches removing raw secrets while retaining this encoded representation",
  ([_name, encoded]) => Effect.gen(function* () {
    const output = yield* redactEvent(textEvent(`before ${encoded} after`));
    expect(output).toEqual(textEvent("before [REDACTED] after"));
  }),
);

it.effect("5.11 live registry: catches caching secrets at construction or redacting only the first secret", () => {
  const secrets = [Redacted.make(secret)];
  const instance = makeRedactor({ secrets: () => secrets, tokenHashes: () => new Set<string>() });
  secrets.push(Redacted.make(secondSecret));
  return Effect.gen(function* () {
    const service = yield* Redactor;
    expect(yield* service.redact(textEvent(`${secret} + ${secondSecret}`)))
      .toEqual(textEvent("[REDACTED] + [REDACTED]"));
  }).pipe(Effect.provide(instance.layer));
});

it.effect("5.11 recursive strings: catches redacting only thread text or only top-level event properties", () =>
  Effect.gen(function* () {
    const input: Event = {
      _tag: "PermissionRequested", agentId,
      permissionRequestId: Schema.decodeUnknownSync(PermissionRequestId)("request-a"),
      holder: { _tag: "owner" },
      deliveryId: Schema.decodeUnknownSync(DeliveryId)("delivery-a"), toolCallId: `tool-${secret}`,
      description: `description ${secret}`,
      options: [{ id: `option-${secret}`, name: `${secondSecret} option`, kind: `kind-${secret}`, level: "ask", persistent: false }],
      settingsWrite: false,
    };
    const output = yield* redactEvent(input);
    expect(output).toMatchObject({
      _tag: "PermissionRequested", description: "description [REDACTED]", toolCallId: "tool-[REDACTED]",
      options: [{ id: "option-[REDACTED]", name: "[REDACTED] option", kind: "kind-[REDACTED]", level: "ask", persistent: false }],
      holder: { _tag: "owner" }, settingsWrite: false,
    });
    expect(JSON.stringify(output)).not.toContain(secret);
    expect(JSON.stringify(output)).not.toContain(secondSecret);
    expect(input.description).toContain(secret);
  }),
);

it.effect("5.11 tool input: catches leaving a secret in serialized structured tool-call input or output", () =>
  Effect.gen(function* () {
    const output = yield* redactEvent({
      _tag: "ThreadItem", agentId, itemId: "tool-a", replay: false,
      content: {
        _tag: "tool-call", callId: "call-a", title: `Read ${secret}`, status: "completed",
        input: JSON.stringify({ headers: { Authorization: secret }, args: [secondSecret] }),
        output: `result: ${secret}`,
      },
    });
    expect(output).toMatchObject({ content: {
      title: "Read [REDACTED]", output: "result: [REDACTED]",
      input: '{"headers":{"Authorization":"[REDACTED]"},"args":["[REDACTED]"]}',
    } });
  }),
);

it.effect("5.11 string arrays: catches treating primitive array elements as already safe", () =>
  Effect.gen(function* () {
    expect(yield* redactEvent({ _tag: "AgentGrouped", agentId, groups: [secret, `prefix ${secondSecret}`] }))
      .toEqual({ _tag: "AgentGrouped", agentId, groups: ["[REDACTED]", "prefix [REDACTED]"] });
  }),
);

it.effect("5.11 file diff: catches redacting messages while leaking a path or patch", () =>
  Effect.gen(function* () {
    const output = yield* redactEvent({
      _tag: "ThreadItem", agentId, itemId: "diff-a", replay: false,
      content: { _tag: "file-change", path: `/tmp/${secret}/config`, diff: `-old\n+TOKEN=${secret}\n+KEY=${secondSecret}` },
    });
    expect(output).toMatchObject({ content: {
      path: "/tmp/[REDACTED]/config", diff: "-old\n+TOKEN=[REDACTED]\n+KEY=[REDACTED]",
    } });
  }),
);

it.effect.each(forms)(
  "5.11 split/%s: catches leaking a secret across streamed chunks or using a raw-length carry window",
  ([_name, encoded]) => Effect.sync(() => {
    // Every boundary includes the adversarial boundary near the end of a
    // long encoding. A fresh item avoids cross-case carry state.
    for (let cut = 1; cut < encoded.length; cut++) {
      const instance = redactor();
      const first = instance.redactChunk("item-a", `before ${encoded.slice(0, cut)}`, false);
      expect(first).not.toContain(encoded.slice(0, cut));
      const last = instance.redactChunk("item-a", `${encoded.slice(cut)} after`, true);
      expect(first + last).toBe("before [REDACTED] after");
    }
  }),
);

it.effect("5.11 item isolation: catches combining unrelated stream items or dropping the final safe tail", () =>
  Effect.sync(() => {
    const instance = redactor();
    const cut = 12;
    const a = instance.redactChunk("a", secret.slice(0, cut), false);
    const b = instance.redactChunk("b", secret.slice(cut), true);
    const end = instance.redactChunk("a", " safe tail", true);
    expect(a + end).toBe(secret.slice(0, cut) + " safe tail");
    expect(b).toBe(secret.slice(cut));
  }),
);

it.effect.each([0, 1, 2])(
  "5.11 base64 alignment/%i: catches matching only a separately encoded secret at byte alignment zero",
  (alignment) => Effect.gen(function* () {
    const encoded = Buffer.from("x".repeat(alignment) + secret + "suffix").toString("base64");
    const instance = redactor();
    const output = instance.redactText(`before ${encoded} after`);
    expect(output).toContain("before ");
    expect(output).toContain(" after");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain(encoded);
    expect(Buffer.from(output.slice(7, -6), "base64").toString()).not.toContain(secret);
    const cut = Math.floor(encoded.length / 2);
    const joined = instance.redactChunk("encoded", encoded.slice(0, cut), false)
      + instance.redactChunk("encoded", encoded.slice(cut), true);
    expect(joined).toContain("[REDACTED]");
    expect(Buffer.from(joined, "base64").toString()).not.toContain(secret);
    const event = yield* redactEvent(textEvent(encoded));
    expect(JSON.stringify(event)).not.toContain(encoded);
  }),
);

it.effect.each(["agent"] as const)(
  "5.11 stored hash/%s: catches requiring the raw token in the live-secret registry or ignoring embedded prefixes",
  (kind) => Effect.gen(function* () {
    const minted = mintAgentToken();
    const raw = Redacted.value(minted.token);
    const sql = yield* SqlClient.SqlClient;
    yield* migrate;
    const tokenHashes = new Set<string>();
    const instance = makeRedactor({ secrets: () => [], tokenHashes: () => tokenHashes });
    yield* Effect.gen(function* () {
      yield* registerRebuildCheck();
      const log = yield* EventLog.EventLog;
      yield* log.append({ _tag: "owner" }, Schema.decodeUnknownSync(RequestId)(randomUUID()), "a".repeat(64), [
        { _tag: "TurnStarted", agentId },
      ], { agentTokens: [{ agentId, tokenHash: minted.tokenHash, revokedAt: null }] });
    }).pipe(Effect.scoped, Effect.provide(EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provide(instance.layer))));
    const rows = yield* sql<{ token_hash: string }>`SELECT token_hash FROM agent_tokens`;
    for (const row of rows) tokenHashes.add(row.token_hash);
    yield* Effect.gen(function* () {
      const service = yield* Redactor;
      expect(yield* service.redact(textEvent(`bearer:${raw}; safe`))).toEqual(textEvent("bearer:[REDACTED]; safe"));
      const unknown = Redacted.value((mintAgentToken()).token);
      expect(instance.redactText(`unknown:${unknown}; safe`)).toBe(`unknown:${unknown}; safe`);
    }).pipe(Effect.provide(instance.layer));
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })), Effect.scoped,
  ),
);

it.live("5.11 time bound: catches unbounded token hashing or rescanning a one-megabyte event", () =>
  Effect.gen(function* () {
    const text = "x".repeat(524_288) + secret + "y".repeat(524_288);
    const started = performance.now();
    const output = yield* redactEvent(textEvent(text));
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(JSON.stringify(output)).not.toContain(secret);
    expect(output).toEqual(textEvent("x".repeat(524_288) + "[REDACTED]" + "y".repeat(524_288)));
  }),
);

it.live("5.11 fake agent: catches a printed token or account key reaching event, receipt, reply or database bytes", () =>
  Effect.gen(function* () {
    const minted = mintAgentToken();
    const raw = Redacted.value(minted.token);
    const instance = makeRedactor({
      secrets: () => [Redacted.make(secret)], tokenHashes: () => new Set([minted.tokenHash]),
    });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [fileURLToPath(import.meta.resolve("@lgtm/testing/fakeAgent"))], {
      cwd: home,
      env: {
        HOME: home, LGTM_HOME: home, TMPDIR: home, PATH: "/usr/bin:/bin",
        LGTM_TOKEN: raw, ACCOUNT_KEY: secret,
        FAKE_AGENT_SCRIPT: JSON.stringify({ turns: [[{ step: "print_env" }]] }),
      },
    }));
    yield* child.stderr.pipe(Stream.runDrain, Effect.forkScoped);
    const chunks: Array<string> = [];
    const diagnostics: Array<string> = [];
    yield* Effect.gen(function* () {
      const acp = yield* AcpClient.AcpClient;
      yield* acp.handleSessionUpdate((notification) => Effect.sync(() => {
        const update = notification.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") chunks.push(update.content.text);
      }));
      yield* acp.agent.initialize({ protocolVersion: 2 });
      const session = yield* acp.agent.createSession({ cwd: home, mcpServers: [] });
      yield* acp.agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "print environment" }] });
    }).pipe(
      Effect.provide(AcpClient.layerChildProcess(child)),
      Effect.provide(redactingLoggerLayer(instance, (line: string) => { diagnostics.push(line); })),
      Effect.timeout("15 seconds"), Effect.orDie,
    );
    // Prove the fixture printed both secrets before testing the real boundary.
    expect(chunks.join("")).toContain(raw);
    expect(chunks.join("")).toContain(secret);
    expect(diagnostics.join("\n")).not.toContain(raw);
    expect(diagnostics.join("\n")).not.toContain(secret);
    yield* migrate;
    yield* Effect.gen(function* () {
      yield* registerRebuildCheck();
      const log = yield* EventLog.EventLog;
      const sql = yield* SqlClient.SqlClient;
      const result = yield* log.append({ _tag: "owner" }, Schema.decodeUnknownSync(RequestId)(randomUUID()), "b".repeat(64), [textEvent(chunks.join(""))], {
        agentTokens: [{ agentId, tokenHash: minted.tokenHash, revokedAt: null }],
      });
      const stored = yield* sql`SELECT payload_json FROM events`;
      const receipts = yield* sql`SELECT result_json FROM receipts`;
      for (const output of [JSON.stringify(result), JSON.stringify(stored), JSON.stringify(receipts)]) {
        expect(output).not.toContain(raw);
        expect(output).not.toContain(secret);
        expect(output).toContain("[REDACTED]");
        expect(output).toContain("ACCOUNT_KEY=");
      }
      yield* sql`PRAGMA wal_checkpoint(FULL)`;
      for (const name of readdirSync(home)) {
        const bytes = readFileSync(join(home, name));
        expect(bytes.includes(Buffer.from(raw))).toBe(false);
        expect(bytes.includes(Buffer.from(secret))).toBe(false);
      }
    }).pipe(Effect.scoped, Effect.provide(EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provide(instance.layer))));
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })),
    Effect.provide(NodeServices.layer), Effect.scoped,
  ),
);

it.effect.each(["message", "annotation", "cause", "nested-error"] as const)(
  "5.11 logger/%s: catches service diagnostics bypassing redaction before reaching the output sink",
  (location) => {
    const output: Array<string> = [];
    const inheritedOutput: Array<string> = [];
    const inherited = Logger.make((options) => { inheritedOutput.push(Logger.formatJson.log(options)); });
    const log = location === "message" ? Effect.logInfo("diagnostic marker", { nested: { secret } })
      : location === "annotation" ? Effect.logInfo("diagnostic marker").pipe(Effect.annotateLogs({ [secret]: { value: secret } }))
      : location === "cause" ? Effect.logError("diagnostic marker", Cause.fail({ nested: { message: secret } }))
      : Effect.logError("diagnostic marker", Cause.die(new Error("outer diagnostic", { cause: new Error(secret) })));
    return log.pipe(
      Effect.provide(redactingLoggerLayer(redactor(), (line: string) => { output.push(line); })),
      Effect.provide(Logger.layer([inherited])),
      Effect.andThen(Effect.sync(() => {
        expect(output.length).toBeGreaterThan(0);
        expect(output.join("\n")).toContain("diagnostic marker");
        expect(output.join("\n")).toContain("[REDACTED]");
        // Merging a safe logger beside an inherited raw logger still leaks.
        for (const [, encoded] of forms) expect([...output, ...inheritedOutput].join("\n")).not.toContain(encoded);
      })),
    );
  },
);
