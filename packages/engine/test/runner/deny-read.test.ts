import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { resolveHarnessDefaults } from "../../src/runner/harnesses.ts";
import {
  accountFor, echoFile, framesOf, harnessFor, makeRunnerRig, readEcho, removeRunnerRig, spawnFor, withAcpRunner,
  writeFakeAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// Criterion 6.14 (task 6a.4; rows 47, 61, 65, 72): each harness with a
// documented launch-time deny rule gets one forbidding reads of the state
// folder and writes to the harness settings paths of row 65. The rule is the
// harness settings' `denyReadMechanism`: `launch-arguments` appends
// `readArguments` once, with `{stateFolder}` replaced by the state folder's
// real path, and `writeArguments` once per settings path, with
// `{settingsPath}` replaced by that path. Placeholders may sit inside a
// longer argument. `none` adds nothing, and that harness is listed in
// SECURITY.md (by the lead, after this unit; row 72).
//
// Reading of row 65 used here: the settings paths are absolute, inside the
// agent's real folder, for every harness's settings (an agent of one harness
// can change another harness's settings for its siblings), with
// `.claude/settings*.json` written as its two files, plus the account's
// `CLAUDE_CONFIG_DIR` when the account sets it.

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPRD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps a missing
// module from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);

const settingsPaths = (folder: string) => [
  ".claude/settings.json", ".claude/settings.local.json", ".claude/commands", ".claude/agents", ".mcp.json",
  ".codex", ".gemini", ".cursor", ".sheprd",
].map((path) => join(folder, path));

// One argument shape per harness, so the expansion is checked inside longer
// arguments and with more than one argument per rule.
const shapes = {
  claude: { readArguments: ["--disallowed-tools", "Read({stateFolder}/**)"], writeArguments: ["--disallowed-tools", "Edit({settingsPath})"] },
  codex: { readArguments: ["-c", "sandbox.deny_read=[\"{stateFolder}\"]"], writeArguments: ["-c", "sandbox.deny_write+=[\"{settingsPath}\"]"] },
  gemini: { readArguments: ["--deny-read={stateFolder}"], writeArguments: ["--deny-write={settingsPath}"] },
  cursor: { readArguments: ["--deny", "read:{stateFolder}"], writeArguments: ["--deny", "write:{settingsPath}"] },
} as const;

const expand = (template: ReadonlyArray<string>, name: "stateFolder" | "settingsPath", value: string) =>
  template.map((argument) => argument.replaceAll(`{${name}}`, value));

for (const [harnessId, shape] of Object.entries(shapes)) {
  live(`6.14 ${harnessId}: the launch-time rule denies reads of the real state folder and writes to every settings path, after the harness's own arguments (breaks if the runner drops the rule, leaves a placeholder unexpanded, names a folder other than the state folder, or skips a settings path)`, () =>
    withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
      const echo = echoFile(rig);
      const harness = harnessFor(harnessId, writeFakeAdapter(rig), { denyReadMechanism: { _tag: "launch-arguments", ...shape } });
      const spawn = yield* spawnFor(rig, harness, accountFor(harnessId, { turns: [] }, echo));
      yield* runner.start(spawn.input);
      const seen = yield* readEcho(echo, (current) => framesOf(current, "session/new").length === 1);
      const extra = seen.argv.slice(2 + harness.adapterArguments.length);
      expect(seen.argv.slice(2, 2 + harness.adapterArguments.length)).toEqual(harness.adapterArguments);
      const read = expand(shape.readArguments, "stateFolder", rig.stateFolder);
      expect(extra.slice(0, read.length)).toEqual(read);
      const writes = extra.slice(read.length);
      const expected = settingsPaths(seen.cwd).flatMap((path) => expand(shape.writeArguments, "settingsPath", path));
      expect([...writes].sort()).toEqual([...expected].sort());
      expect(writes.length).toBe(expected.length);
      expect(seen.argv.join(" ")).not.toMatch(/\{stateFolder\}|\{settingsPath\}/);
    })));
}

live("6.14 CLAUDE_CONFIG_DIR: an account that sets it gets a write rule for that folder too (breaks if the runner protects only the folder-relative settings paths, row 65)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const configDir = join(rig.root, "claude-config");
    const harness = harnessFor("claude", writeFakeAdapter(rig), { denyReadMechanism: { _tag: "launch-arguments", ...shapes.gemini } });
    const spawn = yield* spawnFor(rig, harness, accountFor("claude", { turns: [] }, echo, { CLAUDE_CONFIG_DIR: configDir }));
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo);
    expect(seen.argv).toContain(`--deny-write=${configDir}`);
  })));

live("6.14 none: a harness with no mechanism gets exactly its own arguments (breaks if the runner invents a rule for a harness that documents none)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("codex", writeFakeAdapter(rig));
    const spawn = yield* spawnFor(rig, harness, accountFor("codex", { turns: [] }, echo));
    yield* runner.start(spawn.input);
    expect((yield* readEcho(echo)).argv.slice(2)).toEqual(harness.adapterArguments);
  })));

it.effect("6.14 defaults: every default harness's mechanism is either none or a launch rule that names the state folder and the settings path (breaks if a default rule omits a placeholder, so it would deny nothing)", () =>
  Effect.gen(function* () {
    const defaults = yield* resolveHarnessDefaults({
      binDirectory: new URL("../../node_modules/.bin", import.meta.url).pathname, path: "/usr/bin:/bin",
    });
    for (const harness of defaults.harnesses) {
      const mechanism = harness.denyReadMechanism;
      if (mechanism._tag === "none") continue;
      expect(mechanism.readArguments.join(" "), harness.id).toContain("{stateFolder}");
      expect(mechanism.writeArguments.join(" "), harness.id).toContain("{settingsPath}");
    }
  }).pipe(Effect.provide(NodeServices.layer)));
