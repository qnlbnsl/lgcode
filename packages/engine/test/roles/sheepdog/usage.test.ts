import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readTranscriptUsage } from "../../../src/roles/sheepdog/usage.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const usageRow = JSON.stringify({ type: "assistant", timestamp: "2026-11-04T12:00:00.000Z", message: {
  id: "req-7", content: [{ type: "text", text: "PRIVATE_TRANSCRIPT_TEXT" }], usage: {
    input_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 30,
    cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 },
  },
} });

it("U01 returns only the latest request's numeric usage and timestamp", () => {
  const folder = mkdtempSync(join(tmpdir(), "sheprd-usage-"));
  try {
    const transcript = join(folder, `${sessionId}.jsonl`);
    writeFileSync(transcript, `${JSON.stringify({ type: "user", message: "OLD" })}\n${usageRow}\n`);
    expect(readTranscriptUsage(transcript, sessionId)).toEqual({
      requestStartedAt: Date.parse("2026-11-04T12:00:00.000Z"), inputTokens: 100, cachedReadTokens: 200,
      cachedWriteTokens: 30, cachedWrite5mTokens: 10, cachedWrite1hTokens: 20,
    });
    expect(JSON.stringify(readTranscriptUsage(transcript, sessionId))).not.toContain("PRIVATE_TRANSCRIPT_TEXT");
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

it("U02 refuses a malformed session id and a path whose filename is not that session", () => {
  const folder = mkdtempSync(join(tmpdir(), "sheprd-usage-"));
  try {
    const transcript = join(folder, `${sessionId}.jsonl`);
    writeFileSync(transcript, `${usageRow}\n`);
    expect(readTranscriptUsage(transcript, "../../secret")).toBeUndefined();
    expect(readTranscriptUsage(transcript, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeUndefined();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

it("U03 refuses a symbolic link instead of following it to another file", () => {
  const folder = mkdtempSync(join(tmpdir(), "sheprd-usage-"));
  try {
    const outside = join(folder, "outside.jsonl");
    const transcript = join(folder, `${sessionId}.jsonl`);
    writeFileSync(outside, `${usageRow}\n`);
    symlinkSync(outside, transcript);
    expect(readTranscriptUsage(transcript, sessionId)).toBeUndefined();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

it("U04 reads a bounded tail and returns no usage when the transcript is missing", () => {
  const folder = mkdtempSync(join(tmpdir(), "sheprd-usage-"));
  try {
    const transcript = join(folder, `${sessionId}.jsonl`);
    mkdirSync(join(folder, "nested"));
    writeFileSync(transcript, `${"x".repeat(1_000_000)}\n${usageRow}\n`);
    expect(readTranscriptUsage(transcript, sessionId)).toMatchObject({ inputTokens: 100, cachedReadTokens: 200 });
    expect(readTranscriptUsage(join(folder, "nested", `${sessionId}.jsonl`), sessionId)).toBeUndefined();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});


it.each(["missing", "malformed", "partial", "future", "pending-request", "incomplete-json", "missing-usage"])(
  "U05 rejects stale high usage when the current request is %s", (current) => {
    const folder = mkdtempSync(join(tmpdir(), "sheprd-current-usage-"));
    try {
      const transcript = join(folder, `${sessionId}.jsonl`);
      const startedAt = Date.parse("2026-11-04T12:01:00.000Z");
      const endedAt = startedAt + 60_000;
      const row = { type: "assistant", timestamp: new Date(startedAt).toISOString(), message: {
        usage: { input_tokens: 200_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 10 } },
      } };
      const latest = current === "missing" ? "" : current === "incomplete-json" ? '{"type":"assistant",'
        : current === "missing-usage" ? JSON.stringify({ ...row, message: {} }) : current === "malformed" ? JSON.stringify({ ...row, timestamp: "invalid" })
        : current === "partial" ? JSON.stringify({ ...row, message: { usage: { cache_creation_input_tokens: 0 } } })
        : current === "future" ? JSON.stringify({ ...row, timestamp: new Date(endedAt + 1).toISOString() })
        : JSON.stringify({ type: "user", timestamp: new Date(startedAt + 1).toISOString(), message: { content: "Next request" } });
      writeFileSync(transcript, `${usageRow}\n${["pending-request", "incomplete-json", "missing-usage"].includes(current) ? JSON.stringify(row) + "\n" : ""}${latest}\n`);
      expect(readTranscriptUsage(transcript, sessionId, { startedAt, endedAt })).toBeUndefined();
    } finally { rmSync(folder, { recursive: true, force: true }); }
  },
);

it("U06 a proven current read-only request inherits the earlier write lifetime", () => {
  const folder = mkdtempSync(join(tmpdir(), "sheprd-current-read-"));
  try {
    const transcript = join(folder, `${sessionId}.jsonl`);
    const startedAt = Date.parse("2026-11-04T12:01:00.000Z");
    writeFileSync(transcript, `${usageRow}\n${JSON.stringify({ type: "assistant", timestamp: new Date(startedAt).toISOString(), message: {
      usage: { input_tokens: 100, cache_read_input_tokens: 200_000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } },
    } })}\n`);
    expect(readTranscriptUsage(transcript, sessionId, { startedAt, endedAt: startedAt + 60_000 }))
      .toMatchObject({ requestStartedAt: startedAt, inputTokens: 100, cachedReadTokens: 200_000, lastWriteLifetimeMinutes: 5 });
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
