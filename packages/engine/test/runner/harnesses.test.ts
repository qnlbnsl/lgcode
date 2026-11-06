// Task 8a.3, decision rows 18, 39 and 59: the four harnesses' default settings, resolved to
// absolute adapter paths at install.
//
//   `resolveHarnessDefaults({ binDirectory, path })` (module
//   `packages/engine/src/runner/harnesses.ts`) returns an Effect of
//   `{ harnesses: ReadonlyArray<HarnessSettings>, missing: ReadonlyArray<{ id, command, reason }> }`.
//   It needs the `FileSystem` service. `binDirectory` is the engine package's `node_modules/.bin`;
//   `path` is a PATH-style text (colon separated) that is the only place it looks for Gemini and
//   Cursor; it never reads `process.env` (issue 14). The harnesses come in the order claude, codex,
//   gemini, cursor, and each one found is a complete `HarnessSettings` value (it decodes with the
//   contracts schema):
//     claude  -> `<binDirectory>/claude-agent-acp`, arguments []
//     codex   -> `<binDirectory>/codex-acp`, arguments []
//     gemini  -> first executable file named `gemini` on `path`, arguments ["--acp"]
//     cursor  -> first executable file named `agent` on `path`, arguments ["acp"]
//   A harness whose program is not found is listed in `missing` (with `id`, the `command` name and
//   a non-empty `reason`) and is not in `harnesses`; nothing is guessed, and Claude and Codex are
//   never taken from `path` or run through `npx -y`.
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, it } from "@effect/vitest"
import { HarnessSettings } from "@sheprd/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { afterEach, beforeEach, vi } from "vitest"

import { resolveHarnessDefaults } from "../../src/runner/harnesses.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"

registerRebuildCheck({ noLog: true })

let root: string
let binDirectory: string
let pathDirectory: string
let otherPathDirectory: string

const program = async (directory: string, name: string, mode = 0o755) => {
  const file = join(directory, name)
  await writeFile(file, "#!/bin/sh\nexit 0\n", { mode })
  return file
}

beforeEach(async () => {
  // Keep the formerly random `npx` ancestor deterministic (issue 361).
  root = await mkdtemp(join(tmpdir(), "sheprd-harnesses-npx-"))
  binDirectory = join(root, "bin")
  pathDirectory = join(root, "path-one")
  otherPathDirectory = join(root, "path-two")
  await Promise.all([mkdir(binDirectory), mkdir(pathDirectory), mkdir(otherPathDirectory)])
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

const resolve = (path: string) => resolveHarnessDefaults({ binDirectory, path })
const byId = (result: { harnesses: ReadonlyArray<any> }, id: string) => result.harnesses.find((harness) => harness.id === id)

// `it.layer` hands its callback a test API without `live`, and the tests need the real clock, so
// each test provides the Node services itself.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout?: number) =>
  it.live(name, () => test().pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<void, unknown, never>, timeout)

live("resolves the four harnesses to absolute adapter paths with the documented arguments (breaks if a default is a bare name, an npx command or has the wrong argument; rows 18 and 39)", () =>
  Effect.gen(function*() {
    const claude = yield* Effect.promise(() => program(binDirectory, "claude-agent-acp"))
    const codex = yield* Effect.promise(() => program(binDirectory, "codex-acp"))
    const gemini = yield* Effect.promise(() => program(pathDirectory, "gemini"))
    const cursor = yield* Effect.promise(() => program(pathDirectory, "agent"))
    const result = yield* resolve(pathDirectory)
    assert.deepEqual(result.missing, [])
    assert.deepEqual(result.harnesses.map((harness) => harness.id), ["claude", "codex", "gemini", "cursor"])
    assert.deepEqual(
      result.harnesses.map((harness) => [harness.adapterPath, [...harness.adapterArguments]]),
      [[claude, []], [codex, []], [gemini, ["--acp"]], [cursor, ["acp"]]]
    )
    for (const harness of result.harnesses) {
      assert.match(harness.adapterPath, /^\//)
      // Exact paths and argument vectors above reject an npx invocation
      // without rejecting a legitimate ancestor containing that substring.
      assert.notInclude([...harness.adapterArguments], "-y")
    }
  }))

live("every resolved harness decodes with the contracts schema, in acp run mode with a read-only mapping (breaks if a default is a partial object the engine would later refuse)", () =>
  Effect.gen(function*() {
    for (const name of ["claude-agent-acp", "codex-acp"]) yield* Effect.promise(() => program(binDirectory, name))
    for (const name of ["gemini", "agent"]) yield* Effect.promise(() => program(pathDirectory, name))
    const result = yield* resolve(pathDirectory)
    assert.equal(result.harnesses.length, 4)
    for (const harness of result.harnesses) {
      const decoded = Schema.decodeUnknownSync(HarnessSettings)(harness)
      assert.equal(decoded.runMode, "acp")
      assert.isTrue(decoded.permissionMapping["read-only"].length > 0)
    }
  }))

live("every resolved harness records its modes with a level, so a mode change is checked against the ceiling (breaks if the defaults leave reportedModes empty, which refuses every mode change; fix round 1, A16)", () =>
  Effect.gen(function*() {
    for (const name of ["claude-agent-acp", "codex-acp"]) yield* Effect.promise(() => program(binDirectory, name))
    for (const name of ["gemini", "agent"]) yield* Effect.promise(() => program(pathDirectory, name))
    const result = yield* resolve(pathDirectory)
    for (const harness of result.harnesses) {
      const ids = harness.reportedModes.map((mode) => mode.id)
      assert.equal(new Set(ids).size, ids.length, `${harness.id} lists a mode twice`)
      // Every mode Sheprd asks for is a mode the harness reports, at the level that asks for it or below.
      const levels = ["read-only", "ask", "edit", "full"] as const
      for (const [index, level] of levels.entries()) {
        const reported = harness.reportedModes.find((mode) => mode.id === harness.permissionMapping[level])
        assert.isDefined(reported, `${harness.id} does not report its ${level} mode`)
        assert.isTrue(levels.indexOf(reported!.level) <= index, `${harness.id} reports ${level} above its level`)
      }
    }
    assert.deepEqual(byId(result, "codex").reportedModes, [
      { id: "read-only", level: "read-only" }, { id: "workspace-write", level: "edit" }, { id: "agent-full-access", level: "full" }
    ])
    assert.deepEqual(byId(result, "claude").reportedModes, [
      { id: "plan", level: "read-only" }, { id: "default", level: "ask" }, { id: "acceptEdits", level: "edit" }, { id: "bypassPermissions", level: "full" }
    ])
    assert.deepEqual(byId(result, "cursor").reportedModes, [{ id: "ask", level: "read-only" }, { id: "agent", level: "edit" }])
  }))

live("a missing harness is reported with its command and a reason, and is not guessed (breaks if a missing program is silently dropped, listed with an invented path, or fails the whole resolution)", () =>
  Effect.gen(function*() {
    yield* Effect.promise(() => program(binDirectory, "claude-agent-acp"))
    yield* Effect.promise(() => program(binDirectory, "codex-acp"))
    yield* Effect.promise(() => program(pathDirectory, "agent"))
    const result = yield* resolve(pathDirectory) // no gemini anywhere
    assert.deepEqual(result.harnesses.map((harness) => harness.id), ["claude", "codex", "cursor"])
    assert.equal(result.missing.length, 1)
    const [missing] = result.missing
    assert.equal(missing!.id, "gemini")
    assert.equal(missing!.command, "gemini")
    assert.isTrue(missing!.reason.length > 0)
  }))

live("Claude and Codex come only from the engine's bin folder, never from PATH (breaks if a copy on PATH, an unpinned global install, stands in for the pinned adapter; row 18)", () =>
  Effect.gen(function*() {
    yield* Effect.promise(() => program(pathDirectory, "claude-agent-acp"))
    yield* Effect.promise(() => program(pathDirectory, "codex-acp"))
    const result = yield* resolve(pathDirectory)
    assert.deepEqual(result.harnesses, [])
    assert.deepEqual(result.missing.map((entry) => [entry.id, entry.command]), [
      ["claude", "claude-agent-acp"],
      ["codex", "codex-acp"],
      ["gemini", "gemini"],
      ["cursor", "agent"]
    ])
  }))

live("Gemini and Cursor come from the PATH text given, first match wins (breaks if the resolver reads process.env.PATH instead of its argument, or takes a later entry; issue 14)", () =>
  Effect.gen(function*() {
    const first = yield* Effect.promise(() => program(pathDirectory, "gemini"))
    yield* Effect.promise(() => program(otherPathDirectory, "gemini"))
    yield* Effect.promise(() => program(otherPathDirectory, "agent"))
    vi.stubEnv("PATH", "/nonexistent-planted")
    const result = yield* resolve(`${pathDirectory}:${otherPathDirectory}`)
    assert.equal(byId(result, "gemini").adapterPath, first)
    assert.equal(byId(result, "cursor").adapterPath, join(otherPathDirectory, "agent"))
  }))

live("an empty PATH finds nothing even when process.env.PATH would (breaks if the resolver falls back to the process PATH)", () =>
  Effect.gen(function*() {
    yield* Effect.promise(() => program(pathDirectory, "gemini"))
    vi.stubEnv("PATH", pathDirectory)
    const result = yield* resolve("")
    assert.deepEqual(result.harnesses, [])
    assert.deepEqual(result.missing.map((entry) => entry.id), ["claude", "codex", "gemini", "cursor"])
  }))

live("a file that is not executable, or a folder with the program's name, does not count as installed (breaks if any directory entry with the right name is accepted, so the adapter fails later at spawn)", () =>
  Effect.gen(function*() {
    yield* Effect.promise(() => program(pathDirectory, "gemini", 0o644))
    yield* Effect.promise(() => mkdir(join(pathDirectory, "agent")))
    const result = yield* resolve(pathDirectory)
    assert.deepEqual(result.harnesses, [])
    assert.deepEqual(result.missing.map((entry) => entry.id), ["claude", "codex", "gemini", "cursor"])
  }))

live("a relative PATH entry is never used, so every adapter path stays absolute (breaks if '.' or a relative folder on PATH yields a relative adapter path; row 39)", () =>
  Effect.gen(function*() {
    yield* Effect.promise(() => program(pathDirectory, "gemini"))
    const result = yield* resolve(`relative-folder:.:${pathDirectory}`)
    const gemini = byId(result, "gemini")
    assert.equal(gemini.adapterPath, join(pathDirectory, "gemini"))
  }))

live("a link in the bin folder resolves to the link's own absolute path (breaks if the resolver returns the link target, which pnpm changes on update, or a relative path)", () =>
  Effect.gen(function*() {
    const target = yield* Effect.promise(() => program(root, "real-adapter.js"))
    yield* Effect.promise(() => symlink(target, join(binDirectory, "claude-agent-acp")))
    yield* Effect.promise(() => program(binDirectory, "codex-acp"))
    const result = yield* resolve("")
    assert.equal(byId(result, "claude").adapterPath, join(binDirectory, "claude-agent-acp"))
  }))

live("the engine's real bin folder holds the two pinned adapters, found as absolute paths (breaks if the dependencies are not installed or are renamed; row 18)", () =>
  Effect.gen(function*() {
    const realBin = fileURLToPath(new URL("../../node_modules/.bin", import.meta.url)).replace(/\/$/, "")
    const result = yield* resolveHarnessDefaults({ binDirectory: realBin, path: "" })
    assert.equal(byId(result, "claude").adapterPath, join(realBin, "claude-agent-acp"))
    assert.equal(byId(result, "codex").adapterPath, join(realBin, "codex-acp"))
    assert.deepEqual(result.missing.map((entry) => entry.id), ["gemini", "cursor"])
  }))

it("the engine package pins the two adapters to exact versions (breaks if a range such as ^ or ~ replaces 0.99.1 or 2.5.0, so an install can change the adapter; row 18)", async () => {
  const manifest = JSON.parse(
    await readFile(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")
  ) as { dependencies: Record<string, string> }
  assert.equal(manifest.dependencies["@agentclientprotocol/claude-agent-acp"], "0.99.1")
  assert.equal(manifest.dependencies["@agentclientprotocol/codex-acp"], "2.5.0")
})
