import { randomBytes } from "node:crypto"
import { existsSync, linkSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { fingerprint } from "../../src/project/artifacts.ts"
import { saveMockEditorFile } from "../../src/project/mockEditorFile.ts"
import { projectView } from "../../src/project/view.ts"
import { provideBoard, snapshot } from "../board/wakeFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { connect } from "../support/socketClient.ts"
import { agentCredential, call, failureOf, freshRequest, makeRig, ownerCredential as owner, readLog, removeRig, success, type Rig } from "../support/handlerRig.ts"
import { screenBundle, seedScreens } from "./mockScreenFixtures.ts"

let rig: Rig
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder) })
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const seedEditor = () => Effect.gen(function* () {
  const f = yield* seedScreens(rig)
  writeFileSync(join(rig.work, "mocks/layout.pen"), "original design")
  const designRevision = success(yield* call(owner, "project.design.record", { projectId: "project", design: { repoId: f.repoId, worktreeId: "workspace", file: "mocks/layout.pen", components: [] } })).revisionId
  const revisionId = success(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: f.revisionId, bundle: { ...screenBundle(), designRevision } })).revisionId
  return { ...f, revisionId, designRevision, payload: { projectId: "project", worktreeId: "workspace", revisionId, designRevision } }
})

it.live("saves exported bytes through the authenticated owner API and records the replacement design and mock revision", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedEditor(), bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "editor.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const api = yield* connect(socket, bearer), agent = yield* connect(socket, f.designer.token)
  const exported = Buffer.from('Edited design; $(touch escaped) `touch escaped` --upload-pack=evil ../../outside <script>data</script>')
  const payload = { requestId: freshRequest(), ...f.payload, content: exported.toString("base64") } as never
  const refused = yield* agent["project.mocks.editor.save"](payload).pipe(Effect.result)
  expect(refused._tag).toBe("Failure")
  if (refused._tag === "Failure") expect(refused.failure).toMatchObject({ reason: "command refused" })
  const saved = yield* api["project.mocks.editor.save"](payload)
  expect(readFileSync(join(rig.work, "mocks/layout.pen"))).toEqual(exported)
  expect(existsSync(join(rig.work, "escaped"))).toBe(false)
  const state = projectView(yield* snapshot)
  expect(state.mockHeads.project).toBe(saved.revisionId)
  expect(Object.values(state.mockRevisions).find((r) => r.revisionId === saved.revisionId)?.bundle.designRevision).toBe(saved.revisionId)
  expect(Object.values(state.designs).find((r) => r.revisionId === saved.revisionId)).toMatchObject({ fileFingerprint: fingerprint(exported), author: { _tag: "owner" } })
  expect(Object.values(state.gitAttempts)).toEqual([])
  const rows = yield* readLog
  expect(JSON.stringify(rows)).not.toContain(exported.toString("base64"))
  expect(JSON.stringify(rows)).not.toContain("touch escaped")
  expect(yield* api["project.mocks.editor.save"](payload)).toEqual(saved)
  expect(yield* readLog).toEqual(rows)
  expect(failureOf(yield* call(owner, "project.mocks.editor.save", { ...f.payload, content: exported.toString("base64") }))?.reason).toBe("mock revision changed; refresh and retry")
  const stale = yield* api["project.mocks.editor.save"]({ ...f.payload, requestId: freshRequest(), content: exported.toString("base64") } as never).pipe(Effect.result)
  expect(stale._tag).toBe("Failure")
  if (stale._tag === "Failure") expect(stale.failure).toMatchObject({ reason: "mock revision changed; refresh and retry" })
  expect(readdirSync(join(rig.work, "mocks")).some((name) => name.startsWith(".lgtm-editor-"))).toBe(false)
})))

it.live("refuses stale files, noncanonical exports, oversized exports and private content without changing recorded file bytes", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedEditor(), path = join(rig.work, "mocks/layout.pen")
  for (const [content, reason] of [
    ['$(touch escaped); ../../outside', "mock editor export must be base64 data of at most 512 KiB"],
    [Buffer.alloc(512 * 1024 + 1, 65).toString("base64"), "mock editor export must be base64 data of at most 512 KiB"],
    [Buffer.from("private-editor-token").toString("base64"), "mock editor export contains private data"]
  ]) expect(failureOf(yield* call(owner, "project.mocks.editor.save", { ...f.payload, content }))?.reason).toBe(reason)
  expect(readFileSync(path, "utf8")).toBe("original design")
  writeFileSync(path, "external change")
  expect(failureOf(yield* call(owner, "project.mocks.editor.save", { ...f.payload, content: Buffer.from("new design").toString("base64") }))?.reason).toBe("registered design needs an unchanged file in a dedicated design folder")
  expect(readFileSync(path, "utf8")).toBe("external change")
  expect(existsSync(join(rig.work, "escaped"))).toBe(false)
}), ["private-editor-token"]))

it.live("refuses symbolic links and hostile identity strings rather than using them as paths or Git options", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedEditor(), path = join(rig.work, "mocks/layout.pen"), outside = join(rig.outside, "layout.pen")
  writeFileSync(outside, "original design"); unlinkSync(path); symlinkSync(outside, path)
  expect(failureOf(yield* call(owner, "project.mocks.editor.save", { ...f.payload, content: Buffer.from("edited").toString("base64") }))?.reason).toBe("registered design needs an unchanged file in a dedicated design folder")
  expect(readFileSync(outside, "utf8")).toBe("original design")
  for (const field of ["projectId", "worktreeId", "revisionId", "designRevision"]) for (const hostile of ['../../outside', '--upload-pack=evil', '$(touch escaped)', '`touch escaped`'])
    expect(failureOf(yield* call(owner, "project.mocks.editor.save", { ...f.payload, [field]: hostile, content: Buffer.from("edited").toString("base64") }))).toBeDefined()
  expect(readFileSync(outside, "utf8")).toBe("original design")
  expect(existsSync(join(rig.work, "escaped"))).toBe(false)
  expect(failureOf(yield* call(agentCredential(f.designer.token), "project.mocks.editor.save", { ...f.payload, content: "ZWRpdGVk" }))?.reason).toBe("command refused")
})))

it.live("refuses parent traversal and linked parent directories, and replaces hard links without writing their outside inode", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  yield* seedEditor()
  const outside = join(rig.outside, "layout.pen"), original = Buffer.from("original design"), edited = Buffer.from("edited design")
  writeFileSync(outside, original)
  yield* Effect.promise(async () => {
    for (const path of ['../outside/layout.pen', 'mocks/../../outside/layout.pen', '/tmp/layout.pen', 'mocks/../layout.pen'])
      await expect(saveMockEditorFile(rig.work, path, fingerprint(original), edited)).rejects.toThrow("mock editor file save failed")
    symlinkSync(rig.outside, join(rig.work, "linked"))
    await expect(saveMockEditorFile(rig.work, "linked/layout.pen", fingerprint(original), edited)).rejects.toThrow("mock editor file save failed")
    expect(readFileSync(outside)).toEqual(original)
    unlinkSync(join(rig.work, "mocks/layout.pen")); linkSync(outside, join(rig.work, "mocks/layout.pen"))
    await saveMockEditorFile(rig.work, "mocks/layout.pen", fingerprint(original), edited)
    expect(readFileSync(outside)).toEqual(original)
    expect(readFileSync(join(rig.work, "mocks/layout.pen"))).toEqual(edited)
  })
})))
