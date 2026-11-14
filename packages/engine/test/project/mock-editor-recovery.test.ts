import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { LogWriteFailed } from "../../src/log/EventLog.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { provideRestart, recover } from "../support/restartRig.ts"
import { call, failureOf, freshRequest, makeFakeSecrets, makeRig, ownerCredential as owner, provideRig, readLog, removeRig, success, type Fakes, type Rig } from "../support/handlerRig.ts"
import { screenBundle, seedScreens } from "./mockScreenFixtures.ts"

let rig: Rig
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder) })
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const original = Buffer.from('{"version":"2.8","children":[]}')
const edited = Buffer.from('{"version":"2.8","children":[],"name":"Edited"}')
const seedEditor = (kind = "pen") => Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig), file = join(rig.work, "mocks/layout." + kind)
  writeFileSync(file, kind === "pen" ? original : Buffer.concat([Buffer.from("fig-kiwi"), Buffer.alloc(20)]))
  const designRevision = success(yield* call(owner, "project.design.record", { projectId: "project", design: { repoId: f.repoId, worktreeId: "workspace", file: "mocks/layout." + kind, components: [] } })).revisionId
  const revisionId = success(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: f.revisionId, bundle: { ...screenBundle(), designRevision } })).revisionId
  return { file, payload: { projectId: "project", worktreeId: "workspace", revisionId, designRevision, content: edited.toString("base64"), confirmed: true } }
})

it.live("review item 5: refuses a missing or false editor confirmation before changing file bytes", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    const f = yield* seedEditor(), { confirmed: _, ...unconfirmed } = f.payload
    for (const payload of [unconfirmed, { ...f.payload, confirmed: false }])
      expect(failureOf(yield* call(owner, "project.mocks.editor.save", payload))?.reason).toBe("mock editor save requires confirmation")
    expect(readFileSync(f.file)).toEqual(original)
  }))
}))

for (const kind of ["pen", "fig"]) it.live(`review item 6: refuses bytes that do not match the recorded .${kind} design signature`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    const f = yield* seedEditor(kind), before = readFileSync(f.file)
    const invalid = kind === "pen" ? ["plain text", "fig-kiwi binary", "{}", "[]"] : ["plain text", edited.toString()]
    for (const bytes of invalid) expect(failureOf(yield* call(owner, "project.mocks.editor.save", { ...f.payload, content: Buffer.from(bytes).toString("base64") }))?.reason)
      .toBe("mock editor export does not match the recorded design format")
    expect(readFileSync(f.file)).toEqual(before)
  }))
}))

it.live("review item 10: refuses a payload above the contract cap before creating an external attempt", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    const f = yield* seedEditor(), before = yield* readLog
    expect(failureOf(yield* call(owner, "project.mocks.editor.save", { ...f.payload, content: "A".repeat(700 * 1024 + 1) }))?.reason).toBe("command refused")
    expect((yield* readLog).slice(before.length).some((row) => row.event._tag === "project.GitAttempted")).toBe(false)
    expect(readFileSync(f.file)).toEqual(original)
  }))
}))

it.live("review item 8: restores original bytes after recording fails and permits a new confirmed save after restart", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  let armed = false, observedRename = false
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
    if (armed && events.some((event) => event._tag === "project.DesignRecorded")) {
      armed = false
      observedRename = readFileSync(join(rig.work, "mocks/layout.pen")).equals(edited)
      return Effect.fail(new LogWriteFailed({ reason: "injected recording failure after rename" }))
    }
    return append(actor, id, hash, events, rows, receipt)
  })) })
  const secrets = makeFakeSecrets()
  const { f, requestId } = yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    const f = yield* seedEditor(), requestId = freshRequest()
    armed = true
    expect(failureOf(yield* call(owner, "project.mocks.editor.save", { ...f.payload, requestId }))).toBeDefined()
    expect(observedRename).toBe(true)
    expect(readFileSync(f.file)).toEqual(original)
    // Infrastructure write failures latch this writer for its lifetime. The
    // restored bytes must remain usable after the ordinary engine restart.
    return { f, requestId }
  }))
  // The helper's optional recovering=false branch retains Restart in its type;
  // this call uses the default branch, which supplies that service.
  yield* (provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck()
    yield* recover
    expect(readFileSync(f.file)).toEqual(original)
    const retry = failureOf(yield* call(owner, "project.mocks.editor.save", { ...f.payload, requestId }))
    expect(retry?.reason).toMatch(/mock editor/i)
    expect(retry?.reason).not.toContain("Git")
    success(yield* call(owner, "project.mocks.editor.save", f.payload))
    expect(readFileSync(f.file)).toEqual(edited)
  }), { secrets }) as Effect.Effect<void, unknown, never>)
}))

it.live("review item 8: keeps committed edited bytes when only the response is lost", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  let armed = false
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => {
    let recorded = false
    return real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
      if (armed && events.some((event) => event._tag === "project.MockRecorded")) recorded = true
      return append(actor, id, hash, events, rows, receipt)
    })).pipe(Effect.flatMap((result) => {
      if (armed && recorded) { armed = false; return Effect.fail(new LogWriteFailed({ reason: "injected lost response after commit" })) }
      return Effect.succeed(result)
    }))
  } })
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), wrapLog }, Effect.gen(function* () {
    const f = yield* seedEditor(), requestId = freshRequest()
    armed = true
    expect(failureOf(yield* call(owner, "project.mocks.editor.save", { ...f.payload, requestId }))).toBeDefined()
    expect(readFileSync(f.file)).toEqual(edited)
    expect(success(yield* call(owner, "project.mocks.editor.save", { ...f.payload, requestId }))).toMatchObject({ revisionId: requestId })
    expect(readFileSync(f.file)).toEqual(edited)
  }))
}))
