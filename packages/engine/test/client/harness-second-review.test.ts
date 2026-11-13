import { afterEach, expect, it } from "@effect/vitest"
import { vi } from "vitest"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import * as Effect from "effect/Effect"
import { makeHarnessPrograms, userHarnessPrefix } from "../../src/harnesses/programs.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { makeRig, removeRig, provideRig, makeFakeSecrets, call, ownerCredential, readLog, appendSetup, eventOf } from "../support/handlerRig.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn }))
let rig: ReturnType<typeof makeRig>
afterEach(() => { vi.clearAllMocks(); if (rig) removeRig(rig) })

it.live("a bare embedded engine refuses installation before spawning or auditing", () => Effect.gen(function* () {
  rig = makeRig(); const runner = yield* makeFakeRunner()
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true })
    queueMicrotask(() => child.emit("close", 7)); return child
  })
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    expect(yield* call(ownerCredential, "client.harness.install", { harnessId: "gemini" })).toMatchObject({ _tag: "Failure", failure: { reason: "No automatic install recipe is shipped for this harness." } })
    expect(spawn).not.toHaveBeenCalled()
    expect((yield* readLog).filter((row) => row.event._tag.startsWith("HarnessInstall"))).toHaveLength(0)
  }))
}))

it("Codex is bundled with nothing to install and no unused download recipe", async () => {
  rig = makeRig(); const programs = makeHarnessPrograms({ home: rig.home, path: "" })
  expect(programs.recipe("codex")).toMatchObject({ automatic: false, commands: [], packages: [], source: "", reason: "Codex is bundled. There is nothing to install." })
  expect(await programs.install("codex", AbortSignal.abort())).toMatchObject({ ok: false, reason: "Codex is bundled. There is nothing to install." })
  expect(spawn).not.toHaveBeenCalled()
})

it("a recognized PATH find allows adding an account before its version is checked, including after restart", async () => {
  rig = makeRig(); const bin = join(rig.home, "bin"), pkg = join(rig.home, "node_modules/@google/gemini-cli")
  mkdirSync(bin); mkdirSync(pkg, { recursive: true })
  const program = join(pkg, "gemini.js"); writeFileSync(program, "#!/bin/sh\necho 0.68.0\n", { mode: 0o700 }); symlinkSync(program, join(bin, "gemini"))
  for (let restart = 0; restart < 2; restart++) {
    expect(await makeHarnessPrograms({ home: rig.home, path: bin }).inspect("gemini")).toMatchObject({ installed: true, path: program, reason: "Found, version not checked yet. Press Check again." })
  }
  expect(spawn).not.toHaveBeenCalled()
})

it("a nested payload below a matching path substring does not identify the expected package", async () => {
  rig = makeRig(); const bin = join(rig.home, "bin"), payload = join(rig.home, "node_modules/@google/gemini-cli/node_modules/payload")
  mkdirSync(bin); mkdirSync(payload, { recursive: true })
  const program = join(payload, "gemini"); writeFileSync(program, "#!/bin/sh\necho 0.68.0\n", { mode: 0o700 }); symlinkSync(program, join(bin, "gemini"))
  spawn.mockImplementation(() => { throw new Error("The unrelated program must not be launched") })
  expect(await makeHarnessPrograms({ home: rig.home, path: bin }).inspect("gemini", undefined, true)).toMatchObject({ installed: false })
  expect(spawn).not.toHaveBeenCalled()
})

it.live("startup cleans malformed, unreadable and unknown pending intents and records a terminal failure", () => Effect.gen(function* () {
  rig = makeRig(); const runner = yield* makeFakeRunner(), records = join(rig.stateFolder, "harness-installations")
  const programs = makeHarnessPrograms({ home: rig.home, path: "", stateFolder: rig.stateFolder }), fakes = { runner, secrets: makeFakeSecrets(), harnessPrograms: programs }
  yield* provideRig(rig, fakes, Effect.gen(function* () {
    yield* registerRebuildCheck()
    yield* appendSetup([eventOf({ _tag: "HarnessInstallStarted", harnessId: "gemini", operationRequestId: "damaged-intent" })])
  }))
  mkdirSync(records, { recursive: true })
  const bad = join(records, randomUUID() + ".pending.json"), unreadable = join(records, randomUUID() + ".pending.json"), unknown = join(records, randomUUID() + ".pending.json")
  writeFileSync(bad, "{truncated"); mkdirSync(unreadable)
  writeFileSync(unknown, JSON.stringify({ id: "removed-harness", operation: randomUUID(), boot: "old-boot", user: process.getuid!() }))
  const prefix = join(userHarnessPrefix(rig.home), "gemini"), former = join(userHarnessPrefix(rig.home), "removed-harness")
  mkdirSync(prefix, { recursive: true }); writeFileSync(join(prefix, "partial"), "fixture"); mkdirSync(former)
  yield* provideRig(rig, fakes, Effect.gen(function* () {
    yield* registerRebuildCheck()
    expect((yield* readLog).find((row) => row.event._tag === "HarnessInstallFinished")?.event).toMatchObject({ state: "failed", operationRequestId: "damaged-intent" })
    for (const path of [bad, unreadable, unknown, prefix, former]) expect(existsSync(path)).toBe(false)
  }))
}))
