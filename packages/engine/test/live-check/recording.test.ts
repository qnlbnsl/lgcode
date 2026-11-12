// Unit 8c: the last step of `pnpm live-check` re-records the fixtures of
// Claude Code and Codex and fails when the recorder reports a failure for either.
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessSettings } from "@lgtm/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { RECORDER_PROMPT } from "../../scripts/live/prompts.ts";
import { judge, recordLive, type RecordResults } from "../../scripts/live/recording.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const folders: Array<string> = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

const recorded = (harness: string, extra: Record<string, unknown> = {}) =>
  ({ harness, status: "recorded", file: `${harness}.ndjson`, workspace: "/tmp/x", droppedExtensionFrames: 0, ...extra });

const results = (...items: ReadonlyArray<Record<string, unknown>>): RecordResults => items as unknown as RecordResults;

describe("the recording step", () => {
  it("passes when claude and codex both recorded without a probe or sample failure (breaks if a clean recording fails)", () => {
    const outcome = judge(results(recorded("claude"), recorded("codex")));
    expect(outcome.passed).toBe(true);
    expect(outcome.report).toContain("claude: recorded");
  });

  it("fails when either was skipped, failed, or is missing (breaks if one adapter can be left out and still pass)", () => {
    expect(judge(results(recorded("claude"))).passed).toBe(false);
    expect(judge(results(recorded("claude"), { harness: "codex", status: "skipped", reason: "Harness is not installed" })).reason).toContain("codex did not record");
    expect(judge(results({ harness: "claude", status: "failed", reason: "auth" }, recorded("codex"))).reason).toContain("claude did not record");
  });

  it("fails when a recorded harness has a signed-out probe or error-sample failure (breaks if a partial failure passes)", () => {
    const probe = judge(results(recorded("claude", { probe: { status: "failed", category: "other" } }), recorded("codex")));
    expect(probe.passed).toBe(false);
    expect(probe.reason).toBe("the recorder reported a failure");
    expect(judge(results(recorded("claude"), recorded("codex", { samples: { status: "failed", category: "other" } }))).passed).toBe(false);
  });

  it("gives the recorder only claude and codex, the named prompt, the owner's home, and the error samples, in a temporary folder that is removed after (breaks if gemini or cursor are recorded, or the folder is left behind)", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sh8c-rec-")));
    folders.push(root);
    const output = join(root, "fixtures");
    mkdirSync(join(output, "errors"), { recursive: true });
    writeFileSync(join(output, "errors", "claude-signed-out.json"), JSON.stringify({ harness: "claude", kind: "signed-out", text: "x", source: "s" }));
    writeFileSync(join(output, "errors", "README.md"), "not a sample");
    const settings = (id: string) => ({ id, runMode: "acp" }) as unknown as HarnessSettings;
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith("lgtm-live-record-"));
    let seen: Record<string, unknown> | undefined;
    const outcome = await recordLive({
      environment: { HOME: "/home/owner", PATH: "/usr/bin", CODEX_HOME: "/home/owner/.codex", CLAUDE_CONFIG_DIR: undefined },
      settings: ["claude", "codex", "gemini", "cursor"].map(settings), outputDirectory: output,
      record: async (options) => { seen = options as unknown as Record<string, unknown>; return results(recorded("claude"), recorded("codex")); },
    });
    expect(outcome.passed).toBe(true);
    expect((seen!.harnesses as Array<{ id: string; accountVariables: Record<string, string> }>).map((harness) => harness.id)).toEqual(["claude", "codex"]);
    expect((seen!.harnesses as Array<{ accountVariables: Record<string, string> }>)[1]!.accountVariables).toEqual({ CODEX_HOME: "/home/owner/.codex" });
    expect(seen).toMatchObject({ prompt: RECORDER_PROMPT, homeDirectory: "/home/owner", outputDirectory: output, captureSignedOut: true });
    expect(seen!.errorSamples).toHaveLength(1);
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith("lgtm-live-record-"))).toEqual(before);
  });

  it("fails without a home instead of recording into the wrong one (breaks if a missing HOME is guessed)", async () => {
    const outcome = await recordLive({ environment: {}, settings: [], outputDirectory: "/nonexistent", record: async () => { throw new Error("must not record"); } });
    expect(outcome).toMatchObject({ passed: false, reason: "HOME is not set" });
  });
});
