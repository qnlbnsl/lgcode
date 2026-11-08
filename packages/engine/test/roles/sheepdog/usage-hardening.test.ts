import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readTranscriptUsage, transcriptPath, transcriptTailBytes } from "../../../src/roles/sheepdog/usage.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
const session = "123e4567-e89b-42d3-a456-426614174000";
const row = (usage: unknown, timestamp = "2026-11-04T12:00:00Z") => JSON.stringify({ type: "assistant", timestamp,
  message: { usage, content: "PRIVATE FILE TEXT" } });
const withTranscript = (body: (folder: string, path: string) => void) => {
  const folder = mkdtempSync(join(tmpdir(), "lgcode-usage-hardening-"));
  try { body(folder, join(folder, `${session}.jsonl`)); }
  finally { rmSync(folder, { recursive: true, force: true }); }
};

it("does not follow a symbolic link in any parent directory", () => withTranscript((folder) => {
  mkdirSync(join(folder, "real"));
  writeFileSync(join(folder, "real", `${session}.jsonl`), row({ input_tokens: 200_000 }));
  symlinkSync(join(folder, "real"), join(folder, "linked"));
  expect(readTranscriptUsage(join(folder, "linked", `${session}.jsonl`), session)).toBeUndefined();
}));

it("retains only finite nonnegative integral counters from the latest request", () => withTranscript((_folder, path) => {
  writeFileSync(path, row({ input_tokens: 200_000 }) + "\n" + row({ input_tokens: "PRIVATE FILE TEXT",
    cache_read_input_tokens: -1, cache_creation_input_tokens: 0.5,
    cache_creation: { ephemeral_1h_input_tokens: 1e100, ephemeral_5m_input_tokens: 2 }, raw: "PRIVATE FILE TEXT" }, "invalid") + "\n");
  expect(readTranscriptUsage(path, session)).toEqual({ cachedWrite5mTokens: 2 });
}));

it("keeps the latest proven write lifetime for later read-only requests without retaining request text", () => withTranscript((_folder, path) => {
  writeFileSync(path, row({ input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 10 } }) + "\n"
    + row({ input_tokens: 200, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 0 }, "2026-11-04T12:30:00Z") + "\n");
  expect(readTranscriptUsage(path, session)).toEqual({ requestStartedAt: Date.parse("2026-11-04T12:30:00Z"),
    inputTokens: 200, cachedReadTokens: 200_000, cachedWriteTokens: 0, lastWriteLifetimeMinutes: 60 });
}));

it("does not parse an incomplete first line or reach beyond the bounded tail for an older write", () => withTranscript((_folder, path) => {
  writeFileSync(path, row({ input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 10 } }) + "\n"
    + "x".repeat(transcriptTailBytes) + "\n" + row({ input_tokens: 200, cache_read_input_tokens: 200_000 }) + "\n");
  expect(readTranscriptUsage(path, session)?.lastWriteLifetimeMinutes).toBeUndefined();
  expect(readTranscriptUsage(path, session)?.inputTokens).toBe(200);
}));

it("builds one expected project path and refuses unsupported or malformed inputs", () => {
  expect(transcriptPath("/config", "/work/project", session)).toBe(`/config/projects/-work-project/${session}.jsonl`);
  expect(transcriptPath("/config", "/work/project", "../credentials")).toBeUndefined();
  expect(transcriptPath("relative", "/work/project", session)).toBeUndefined();
  expect(transcriptPath("/config", "/" + "x".repeat(201), session)).toBeUndefined();
});
