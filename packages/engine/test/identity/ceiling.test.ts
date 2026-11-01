import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { it } from "@effect/vitest";
import { AgentId, type Actor, type PermissionLevel } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  checkFolder, folderForSpawn, canUseMode, canAnswerOption,
} from "../../src/identity/ceiling.ts";

let root: string;
let parent: string;
let ownerHome: string;
let stateFolder: string;
let pluginRoot: string;
beforeEach(() => {
  root = mkdtempSync("/tmp/shepherd-ceiling-");
  parent = join(root, "workspace");
  ownerHome = join(root, "protected", "home");
  stateFolder = join(root, "protected", "state");
  pluginRoot = join(root, "protected", "plugin");
  for (const path of [parent, ownerHome, stateFolder, pluginRoot]) mkdirSync(path, { recursive: true, mode: 0o700 });
  vi.stubEnv("HOME", ownerHome);
  vi.stubEnv("SHEPHERD_HOME", stateFolder);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

const owner: Actor = { _tag: "owner" };
const agent: Actor = { _tag: "agent", agentId: Schema.decodeUnknownSync(AgentId)("parent") };
// These are trusted service configuration values, not command arguments.
// The service resolves pluginRoot from its own script; no real home is read.
const options = (folder: string, caller: Actor = agent, parentFolder = parent) => ({
  caller, parentFolder, folder, home: ownerHome, stateFolder, pluginRoot,
});
const directory = (path: string) => { mkdirSync(path, { recursive: true }); return path; };

it.effect.each(["start", "resume", "reload"] as const)(
  "5.12 stored path/%s: catches passing an unresolved alias instead of the stored real path to spawn",
  (operation) => Effect.gen(function* () {
    const real = directory(join(parent, "real"));
    const alias = join(root, "alias");
    symlinkSync(real, alias);
    const grant = yield* checkFolder(options(alias));
    expect(grant.realPath).toBe(realpathSync(real));
    expect(yield* folderForSpawn(grant, operation)).toBe(realpathSync(real));
  }),
);

it.effect.each(["start", "resume", "reload"] as const)(
  "5.12 alias swap/%s: catches accepting a symlink redirected after the ceiling check",
  (operation) => Effect.gen(function* () {
    const real = directory(join(parent, "real"));
    const outside = directory(join(root, "outside"));
    const alias = join(root, "alias");
    symlinkSync(real, alias);
    const grant = yield* checkFolder(options(alias));
    rmSync(alias);
    symlinkSync(outside, alias);
    expect(Result.isFailure(yield* folderForSpawn(grant, operation).pipe(Effect.result))).toBe(true);
  }),
);

it.effect.each(["start", "resume", "reload"] as const)(
  "5.12 stored inode swap/%s: catches checking only an alias while the stored directory was replaced",
  (operation) => Effect.gen(function* () {
    const folder = directory(join(parent, "child"));
    const grant = yield* checkFolder(options(folder));
    renameSync(folder, join(parent, "old-child"));
    symlinkSync(directory(join(root, "outside")), folder);
    expect(Result.isFailure(yield* folderForSpawn(grant, operation).pipe(Effect.result))).toBe(true);
  }),
);

it.effect("5.12 containment: catches textual path-prefix containment allowing an unrelated sibling directory", () =>
  Effect.gen(function* () {
    const sibling = directory(`${parent}-other`);
    expect(Result.isFailure(yield* checkFolder(options(sibling)).pipe(Effect.result))).toBe(true);
    const child = directory(join(parent, "child"));
    expect((yield* checkFolder(options(child))).realPath).toBe(child);
  }),
);

const worktrees = () => {
  const common = directory(join(root, "repository", ".git"));
  const child = directory(join(root, "linked-child"));
  for (const [name, folder] of [["parent", parent], ["child", child]] as const) {
    const gitdir = directory(join(common, "worktrees", name));
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    writeFileSync(join(gitdir, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(folder, ".git"), `gitdir: ${relative(folder, gitdir)}\n`);
  }
  writeFileSync(join(common, "HEAD"), "ref: refs/heads/main\n");
  return { child, common };
};

it.effect("5.12 worktree without git: catches shelling out instead of reading .git and commondir directly", () =>
  Effect.gen(function* () {
    const { child } = worktrees();
    vi.stubEnv("PATH", directory(join(root, "empty-path")));
    expect((yield* checkFolder(options(child))).realPath).toBe(child);
  }),
);

it.effect("5.12 git trap: catches attempting any PATH-resolved git command during worktree validation", () =>
  Effect.gen(function* () {
    const { child } = worktrees();
    const bin = directory(join(root, "bin"));
    const marker = join(root, "git-ran");
    writeFileSync(join(bin, "git"), `#!/bin/sh\n: > '${marker}'\nexit 1\n`, { mode: 0o700 });
    vi.stubEnv("PATH", bin);
    expect((yield* checkFolder(options(child))).realPath).toBe(child);
    expect(existsSync(marker)).toBe(false);
  }),
);

it.effect("5.12 common directory: catches accepting every worktree or comparing unnormalized commondir text", () =>
  Effect.gen(function* () {
    const { child, common } = worktrees();
    const different = directory(join(root, "different", ".git"));
    writeFileSync(join(common, "worktrees", "child", "commondir"), `${different}\n`);
    expect(Result.isFailure(yield* checkFolder(options(child)).pipe(Effect.result))).toBe(true);
    const alias = join(root, "common-alias");
    symlinkSync(common, alias);
    writeFileSync(join(common, "worktrees", "child", "commondir"), `${alias}\n`);
    expect((yield* checkFolder(options(child))).realPath).toBe(child);
  }),
);

it.effect("5.12 main checkout: catches supporting .git files while rejecting a parent whose .git is a directory", () =>
  Effect.gen(function* () {
    const common = directory(join(parent, ".git"));
    const child = directory(join(root, "linked-child"));
    const gitdir = directory(join(common, "worktrees", "child"));
    writeFileSync(join(child, ".git"), `gitdir: ${relative(child, gitdir)}\n`);
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    writeFileSync(join(gitdir, "HEAD"), "ref: refs/heads/child\n");
    expect((yield* checkFolder(options(child))).realPath).toBe(child);
  }),
);

it.effect.each(["start", "resume", "reload"] as const)(
  "5.12 worktree recheck/%s: catches trusting a common-directory check made before the spawn",
  (operation) => Effect.gen(function* () {
    const { child, common } = worktrees();
    const grant = yield* checkFolder(options(child));
    const other = directory(join(root, "other-common"));
    writeFileSync(join(common, "worktrees", "child", "commondir"), `${other}\n`);
    expect(Result.isFailure(yield* folderForSpawn(grant, operation).pipe(Effect.result))).toBe(true);
  }),
);

it.effect.each(["home", "state", "plugin"] as const)(
  "5.12 protected/%s: catches allowing an agent to use, descend into or contain a protected inode",
  (which) => Effect.gen(function* () {
    const protectedPath = which === "home" ? ownerHome : which === "state" ? stateFolder : pluginRoot;
    const inside = directory(join(protectedPath, "nested"));
    // root supplies a legitimate parent relationship for each refusal, so
    // rejecting only for being outside the parent cannot satisfy this test.
    for (const candidate of [protectedPath, inside, join(root, "protected"), root]) {
      expect(Result.isFailure(yield* checkFolder(options(candidate, agent, root)).pipe(Effect.result))).toBe(true);
    }
  }),
);

it.effect.each(["home", "state", "plugin"] as const)(
  "5.12 protected symlink/%s: catches comparing protected folder spellings instead of real identities",
  (which) => Effect.gen(function* () {
    const protectedPath = which === "home" ? ownerHome : which === "state" ? stateFolder : pluginRoot;
    const alias = join(parent, "apparently-safe-child");
    symlinkSync(protectedPath, alias);
    expect(Result.isFailure(yield* checkFolder(options(alias, agent, root)).pipe(Effect.result))).toBe(true);
    const safe = directory(join(parent, "protected-home-backup"));
    expect((yield* checkFolder(options(safe))).realPath).toBe(safe);
  }),
);

it.effect.each(["home", "state", "plugin"] as const)(
  "5.12 owner exception/%s: catches applying the agent-only protected-folder ban to the owner",
  (which) => Effect.gen(function* () {
    const protectedPath = which === "home" ? ownerHome : which === "state" ? stateFolder : pluginRoot;
    for (const candidate of [protectedPath, directory(join(protectedPath, "nested")), root]) {
      const grant = yield* checkFolder(options(candidate, owner));
      expect(yield* folderForSpawn(grant, "start")).toBe(realpathSync(candidate));
    }
  }),
);

// A real bind mount requires a private user/mount namespace. Never mount in
// the worker's namespace or request host mount privileges. Report a skip if
// this kernel disallows unprivileged namespaces; do not replace stat with a mock.
const bindProbeHome = mkdtempSync("/tmp/shepherd-bind-probe-");
const bindProbe = spawnSync("/usr/bin/unshare", ["--user", "--map-root-user", "--mount", "/usr/bin/true"], {
  env: { PATH: "/usr/bin:/bin", HOME: bindProbeHome, SHEPHERD_HOME: bindProbeHome }, encoding: "utf8",
});
const bindSupported = bindProbe.error === undefined && bindProbe.status === 0;
rmSync(bindProbeHome, { recursive: true, force: true });

it.skipIf(!bindSupported)("5.12 bind inode: catches allowing a protected folder mounted under an unrelated spelling", async () => {
  const alias = directory(join(parent, "bound-home"));
  const script = `
    import { execFileSync } from 'node:child_process';
    import { statSync } from 'node:fs';
    import * as Effect from ${JSON.stringify(fileURLToPath(import.meta.resolve("effect/Effect")))};
    import { checkFolder } from ${JSON.stringify(fileURLToPath(new URL("../../src/identity/ceiling.ts", import.meta.url)))};
    execFileSync('/usr/bin/mount', ['--bind', ${JSON.stringify(ownerHome)}, ${JSON.stringify(alias)}]);
    const source = statSync(${JSON.stringify(ownerHome)});
    const bound = statSync(${JSON.stringify(alias)});
    if (source.dev !== bound.dev || source.ino !== bound.ino) throw new Error('Invalid bind fixture');
    const result = await Effect.runPromise(Effect.result(checkFolder(${JSON.stringify(options(alias))})));
    if (result._tag !== 'Failure') throw new Error('Protected bind mount accepted');
    console.log('protected bind refused');
  `;
  const child = spawnSync("/usr/bin/unshare", ["--user", "--map-root-user", "--mount", process.execPath, "--input-type=module", "-e", script], {
    cwd: root, env: { HOME: ownerHome, SHEPHERD_HOME: stateFolder, PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 10_000,
  });
  expect(child.error).toBeUndefined();
  expect(child.stderr).toBe("");
  expect(child.status).toBe(0);
  expect(child.stdout).toContain("protected bind refused");
  expect(statSync(alias).ino).not.toBe(statSync(ownerHome).ino);
});

const modes: ReadonlyArray<readonly [PermissionLevel, PermissionLevel, boolean]> = [
  ["read-only", "read-only", true], ["read-only", "ask", false], ["read-only", "edit", false], ["read-only", "full", false],
  ["ask", "read-only", true], ["ask", "ask", true], ["ask", "edit", false], ["ask", "full", false],
  ["edit", "read-only", true], ["edit", "ask", true], ["edit", "edit", true], ["edit", "full", false],
  ["full", "read-only", true], ["full", "ask", true], ["full", "edit", true], ["full", "full", true],
];
it.effect.each(modes)(
  "5a.2 mode/%s/%s: catches an inverted or equal-level-exclusive ceiling comparison",
  ([parentMode, requestedMode, allowed]) => Effect.sync(() => {
    expect(canUseMode(agent, parentMode, requestedMode)).toBe(allowed);
    expect(canUseMode(owner, parentMode, requestedMode)).toBe(true);
  }),
);

it.effect.each([
  ["allow_once", "ask", false, "ask", "allow"],
  ["allow_once", "full", false, "edit", "refuse"],
  ["allow_once", "edit", false, "edit", "allow"],
  ["allow_always", "read-only", false, "full", "owner"],
  ["allow_once", "read-only", true, "full", "owner"],
  ["reject_once", "read-only", false, "read-only", "allow"],
  ["reject_always", "read-only", true, "full", "owner"],
  ["unknown-kind", "read-only", false, "full", "owner"],
] as const)(
  "5a.2 option/%s/%s/%s/%s: catches permission-kind, raised-level or persistence checks being bypassed",
  ([kind, level, persistent, mode, expected]) => Effect.sync(() => {
    const option = { kind, level, persistent };
    expect(canAnswerOption({ caller: agent, mode, option })).toBe(expected);
    expect(canAnswerOption({ caller: owner, mode, option })).toBe("allow");
  }),
);

it.effect.each([
  ".claude/settings.json", ".claude/settings.local.json", ".claude/settings.custom.json",
  ".claude/commands/run.md", ".claude/agents/worker.md", ".mcp.json",
  ".codex/config.toml", ".codex/other.toml", ".gemini/settings.json", ".cursor/permissions.json",
] as const)(
  "5a.2 settings/%s: catches allowing persistent harness changes merely because the answerer has full mode",
  (settingsPath) => Effect.sync(() => {
    const option = { kind: "allow_once", level: "read-only" as const, persistent: false };
    const path = join(parent, settingsPath);
    expect(canAnswerOption({ caller: agent, mode: "full", option, settingsPath: path })).toBe("owner");
    expect(canAnswerOption({ caller: owner, mode: "read-only", option, settingsPath: path })).toBe("allow");
    expect(canAnswerOption({ caller: agent, mode: "full", option, settingsPath: join(parent, "src", "settings.json") })).toBe("allow");
  }),
);

it.effect("5a.2 custom configuration: catches ignoring a trusted harness configuration directory override", () => Effect.sync(() => {
  const configDir = directory(join(root, "custom-harness-config"));
  const option = { kind: "allow_once", level: "read-only" as const, persistent: false };
  expect(canAnswerOption({ caller: agent, mode: "full", option, settingsPath: join(configDir, "settings.json"), configDir })).toBe("owner");
}));
