import { afterEach, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import { Redactor } from "../../src/log/Redactor.ts"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { makeHarnessPrograms, runRecipe } from "../../src/harnesses/programs.ts"
import { fixtureHarnessPrograms } from "../support/fixtureHarnessPrograms.ts"
import { installRecipes } from "../../src/harnesses/recipes.ts"
import { makeRig, removeRig, provideRig, makeFakeSecrets, call, ownerCredential, success, harnessSettings, appendSetup, eventOf, seedAgent, agentCredential, readLog } from "../support/handlerRig.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"

let rig: ReturnType<typeof makeRig>
afterEach(() => { if (rig) removeRig(rig) })

it("ships fixed, versioned, sourced recipes and refuses Cursor's shell installer", () => {
  expect(installRecipes.map((r) => r.harnessId)).toEqual(["claude", "codex", "gemini", "cursor"])
  for (const r of installRecipes.filter((r) => r.automatic)) {
    expect(r.packages.length).toBeGreaterThan(0)
    for (const pkg of r.packages) expect(pkg).toMatch(/^@[a-z-]+\/[a-z-]+@\d+\.\d+\.\d+$/)
    expect(r.source).toMatch(/^https:\/\//)
    expect(r.registry).toBe("https://registry.npmjs.org")
  }
  expect(installRecipes.find((r) => r.harnessId === "cursor")).toMatchObject({ automatic: false, manualCommand: "curl https://cursor.com/install -fsS | bash" })
})

it.live("executes literal arguments, bounds output and time, and never invokes a shell", () => Effect.promise(async () => {
  rig = makeRig()
  const marker = join(rig.root, "must-not-exist")
  const cancelled = await runRecipe([{ executable: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`] }], { home: rig.home, timeoutMs: 2000, signal: AbortSignal.abort() })
  expect(cancelled).toMatchObject({ ok: false, reason: "The install was cancelled." })
  expect(existsSync(marker)).toBe(false)
  const literal = `$(touch ${marker}); echo bad`
  const result = await runRecipe([{ executable: process.execPath, args: ["-e", "process.stdout.write(process.argv[1])", literal] }], { home: rig.home, timeoutMs: 2000 })
  expect(result).toMatchObject({ ok: true, output: literal })
  expect(existsSync(marker)).toBe(false)
  const timed = await runRecipe([{ executable: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] }], { home: rig.home, timeoutMs: 100 })
  expect(timed).toMatchObject({ ok: false, reason: "The install exceeded its time limit." })
  const failed = await runRecipe([{ executable: process.execPath, args: ["-e", "process.stderr.write('failed');process.exit(7)"] }], { home: rig.home, timeoutMs: 2000 })
  expect(failed).toMatchObject({ ok: false, reason: "The install command exited with code 7.", output: "failed" })
  const large = await runRecipe([{ executable: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(1024 * 1024))"] }], { home: rig.home, timeoutMs: 2000 })
  expect(large).toMatchObject({ ok: false, reason: "The install produced too much output." })
  expect(large.output).toBe("")
  expect(Buffer.byteLength(large.output)).toBeLessThanOrEqual(64 * 1024)
}))

it.live("redacts the entire version before shortening it for the client", () => Effect.gen(function* () {
  rig = makeRig()
  const executable = join(rig.root, "version-fixture")
  writeFileSync(executable, `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify("x".repeat(195) + "synthetic-secret")});\n`, { mode: 0o700 })
  const programs = makeHarnessPrograms({ home: rig.home, path: "" }), runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), harnessPrograms: programs,
    redactor: Layer.succeed(Redactor, { redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text.replaceAll("synthetic-secret", "[REDACTED]")) }) }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    yield* appendSetup([eventOf({ _tag: "HarnessChanged", harness: harnessSettings("first", { adapterPath: executable }) })])
    const result = success(yield* call(ownerCredential, "client.harness.status", { refresh: true }))
    expect(result.harnesses.find((h: any) => h.harnessId === "first").version).toBe("x".repeat(195) + "[REDA")
  }))
}))

it.live("reads missing programs, shows an exact fake recipe, installs once, redacts output, and audits without output", () => Effect.gen(function* () {
  rig = makeRig()
  const executable = join(rig.root, "fake-harness")
  const script = join(rig.root, "install.cjs")
  writeFileSync(script, `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(executable)}, '#!/bin/sh\\necho 1.2.3\\n');fs.chmodSync(${JSON.stringify(executable)}, 0o700);process.stdout.write('synthetic-secret');`)
  const programs = fixtureHarnessPrograms({ home: rig.home, executable, script })
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), harnessPrograms: programs,
    redactor: Layer.succeed(Redactor, { redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text.replaceAll("synthetic-secret", "[REDACTED]")) }) }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    yield* appendSetup([eventOf({ _tag: "HarnessChanged", harness: harnessSettings("first", { adapterPath: executable }) })])
    const before = success(yield* call(ownerCredential, "client.harness.status", {}))
    expect(before.harnesses.find((h: any) => h.harnessId === "first")).toMatchObject({ installed: false })
    const recipe = success(yield* call(ownerCredential, "client.harness.recipe", { harnessId: "first" }))
    expect(recipe.recipe.commands).toEqual([`'${process.execPath}' '${script}'`])
    const result = success(yield* call(ownerCredential, "client.harness.install", { harnessId: "first", requestId: "fake-install", commands: ["malicious"], recipe: { executable: "malicious" } }))
    expect(result).toMatchObject({ state: "installed", installation: { version: "1.2.3", path: executable } })
    expect(result.output).toBe("[REDACTED]")
    const again = success(yield* call(ownerCredential, "client.harness.install", { harnessId: "first", requestId: "fake-install" }))
    expect(again.state).toBe("installed")
    expect(again.output).toBe("")
    const after = success(yield* call(ownerCredential, "client.harness.status", {}))
    expect(after.harnesses.find((h: any) => h.harnessId === "first")).toMatchObject({ installed: true, version: "1.2.3", path: executable })
    const audit = (yield* readLog).filter((row) => row.event._tag.startsWith("HarnessInstall"))
    expect(audit.map((row) => row.event._tag)).toEqual(["HarnessInstallStarted", "HarnessInstallFinished"])
    expect(JSON.stringify(audit)).not.toContain("synthetic-secret")
    expect(JSON.stringify(audit)).not.toContain("output")
    const child = yield* seedAgent({ id: "worker", name: "Builder" })
    expect((yield* call(agentCredential(child.token), "client.harness.install", { harnessId: "first" }))._tag).toBe("Failure")
  }))
}))

it.live("refuses overlapping installs, client-supplied recipes and automatic Cursor installs", () => Effect.gen(function* () {
  rig = makeRig()
  const base = makeHarnessPrograms({ home: rig.home, path: "" })
  let calls = 0, release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const programs = { ...base, install: async () => { calls++; await Promise.race([gate, new Promise((resolve) => setTimeout(resolve, 1000))]); return { ok: false, output: "", reason: "Fixture failure." } } }
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), harnessPrograms: programs }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const first = yield* call(ownerCredential, "client.harness.install", { harnessId: "gemini" }).pipe(Effect.forkScoped)
    while (!calls) yield* Effect.sleep(5)
    const concurrent = yield* call(ownerCredential, "client.harness.install", { harnessId: "gemini", commands: ["malicious"] })
    expect(concurrent).toMatchObject({ _tag: "Failure", failure: { reason: "An install is already running for this harness." } })
    expect(yield* call(ownerCredential, "client.harness.install", { harnessId: "codex" })).toMatchObject({ _tag: "Failure", failure: { reason: "Codex is bundled. There is nothing to install." } })
    release!()
    expect(success(yield* Fiber.join(first))).toMatchObject({ state: "failed", reason: "Fixture failure." })
    expect(calls).toBe(1)
    expect(yield* call(ownerCredential, "client.harness.install", { harnessId: "cursor" })).toMatchObject({ _tag: "Failure" })
    expect(yield* call(ownerCredential, "client.harness.recipe", { harnessId: "unknown" })).toMatchObject({ _tag: "Failure" })
    expect(calls).toBe(1)
  }))
}))

it.live("checks only local sign-in evidence without launching a provider", () => Effect.gen(function* () {
  rig = makeRig()
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    yield* appendSetup([
      eventOf({ _tag: "HarnessChanged", harness: harnessSettings("claude", { adapterPath: process.execPath }) }),
      eventOf({ _tag: "AccountChanged", accountId: "owner-account", account: { id: "owner-account", harness: "claude", home: join(rig.home, "account"), enabled: true } })
    ])
    expect(success(yield* call(ownerCredential, "client.harness.account.check", { accountId: "owner-account" })).state).toBe("signed-out")
    mkdirSync(join(rig.home, "account"), { recursive: true })
    writeFileSync(join(rig.home, "account", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "synthetic-owner-token" } }))
    expect(success(yield* call(ownerCredential, "client.harness.account.check", { accountId: "owner-account" })).state).toBe("local-credential")
    expect(runner.calls).toHaveLength(0)
  }))
}))

it.live("shows the private Codex account's actual login folder without creating it", () => Effect.gen(function* () {
  rig = makeRig()
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    yield* appendSetup([
      eventOf({ _tag: "HarnessChanged", harness: harnessSettings("codex", { adapterPath: process.execPath }) }),
      eventOf({ _tag: "AccountChanged", accountId: "second-codex", account: { id: "second-codex", harness: "codex", enabled: true } })
    ])
    const before = success(yield* call(ownerCredential, "client.harness.account.check", { accountId: "second-codex" }))
    expect(before.state).toBe("signed-out")
    const folder = /^CODEX_HOME='([^']+)' /.exec(before.signInCommand)?.[1]
    expect(folder).toBeDefined()
    expect(folder!.startsWith(rig.stateFolder + "/")).toBe(true)
    expect(existsSync(folder!)).toBe(false)
    mkdirSync(folder!, { recursive: true })
    writeFileSync(join(folder!, "auth.json"), JSON.stringify({ tokens: { access_token: "synthetic-private-token" } }))
    expect(success(yield* call(ownerCredential, "client.harness.account.check", { accountId: "second-codex" })).state).toBe("local-credential")
    expect(runner.calls).toHaveLength(0)
  }))
}))
