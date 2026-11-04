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
  const folder = mkdtempSync(join(tmpdir(), "shephrd-usage-"));
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
  const folder = mkdtempSync(join(tmpdir(), "shephrd-usage-"));
  try {
    const transcript = join(folder, `${sessionId}.jsonl`);
    writeFileSync(transcript, `${usageRow}\n`);
    expect(readTranscriptUsage(transcript, "../../secret")).toBeUndefined();
    expect(readTranscriptUsage(transcript, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeUndefined();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

it("U03 refuses a symbolic link instead of following it to another file", () => {
  const folder = mkdtempSync(join(tmpdir(), "shephrd-usage-"));
  try {
    const outside = join(folder, "outside.jsonl");
    const transcript = join(folder, `${sessionId}.jsonl`);
    writeFileSync(outside, `${usageRow}\n`);
    symlinkSync(outside, transcript);
    expect(readTranscriptUsage(transcript, sessionId)).toBeUndefined();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

it("U04 reads a bounded tail and returns no usage when the transcript is missing", () => {
  const folder = mkdtempSync(join(tmpdir(), "shephrd-usage-"));
  try {
    const transcript = join(folder, `${sessionId}.jsonl`);
    mkdirSync(join(folder, "nested"));
    writeFileSync(transcript, `${"x".repeat(1_000_000)}\n${usageRow}\n`);
    expect(readTranscriptUsage(transcript, sessionId)).toMatchObject({ inputTokens: 100, cachedReadTokens: 200 });
    expect(readTranscriptUsage(join(folder, "missing.jsonl"), sessionId)).toBeUndefined();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
