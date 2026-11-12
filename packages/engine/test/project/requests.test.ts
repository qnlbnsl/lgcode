import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { provideBoard } from "../board/wakeFixtures.ts"
import { unwrap } from "../client/support/readRig.ts"
import { decisionProject, decisionSetup } from "../support/projectDecisionFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { connect } from "../support/socketClient.ts"
import { call, freshRequest, makeRig, ownerCredential as owner, readLog, removeRig, success, type Rig } from "../support/handlerRig.ts"

let rig: Rig
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder) })
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })

for (const actor of ["owner", "lead"] as const) {
  for (const empty of ["project", "kind", "status", "cursor"] as const) {
    it.live(`authenticated ${actor} ${empty} empty page checks the complete reply budget`, () => provideBoard(rig, Effect.gen(function* () {
      yield* registerRebuildCheck()
      const f = yield* decisionSetup()
      const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "empty-requests.sock")
      yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
      const lead = yield* connect(socket, f.lead.token), api = actor === "lead" ? lead : yield* connect(socket, bearer)
      const credential = actor === "lead" ? f.leadCredential : owner
      const projectId = f.projectId as never
      let after: string | undefined
      if (empty !== "project") {
        const question = yield* lead.ask({ requestId: freshRequest(), text: "A real open question" })
        const reply = yield* api["project.requests"]({ requestId: freshRequest(), projectId })
        const page = "data" in reply ? unwrap(reply) : reply
        expect(page.items).toEqual([expect.objectContaining({ id: question.questionId, status: "open", kind: "question", canAnswer: actor === "owner" })])
        if (empty === "cursor") after = String(page.items[0].sourceSequence)
      }
      const filter = empty === "kind" ? { kind: "permission" as const }
        : empty === "status" ? { status: "answered" as const } : after === undefined ? {} : { after }
      const before = yield* readLog
      // Both ordinary identifiers and substantial escaped identifiers still fit.
      for (const requestId of [freshRequest(), '"'.repeat(40_000) as never]) {
        const payload = { requestId, projectId, ...filter }
        const reply = yield* api["project.requests"](payload)
        expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThanOrEqual(256 * 1024)
        expect("data" in reply ? unwrap(reply) : reply).toEqual({ requestId, items: [] })
        const direct = success(yield* call(credential, "project.requests", payload))
        expect(Buffer.byteLength(JSON.stringify(direct))).toBeLessThanOrEqual(256 * 1024)
        expect("data" in direct ? unwrap(direct) : direct).toEqual({ requestId, items: [] })
      }
      // Preserve the independent probe's original valid identifier verbatim.
      const requestId = '"'.repeat(140_000) as never, payload = { requestId, projectId, ...filter }
      const result = yield* api["project.requests"](payload).pipe(Effect.result)
      if (result._tag === "Success") console.info(`${actor}/${empty} oversized reply bytes: ${Buffer.byteLength(JSON.stringify(result.success))}`)
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") expect(result.failure).toMatchObject({ _tag: "CommandError", requestId, reason: "record exceeds the read budget" })
      expect(yield* call(credential, "project.requests", payload)).toMatchObject({ _tag: "Failure", failure: { reason: "record exceeds the read budget" } })
      expect(yield* readLog).toEqual(before)
    })).pipe(Effect.orDie))
  }
}

it.live("an empty lead page budgets the escaped data envelope even when the owner reply fits", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup()
  const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "envelope-budget.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const lead = yield* connect(socket, f.lead.token), api = yield* connect(socket, bearer)
  const before = yield* readLog, requestId = '"'.repeat(50_000) as never, payload = { requestId, projectId: f.projectId as never }
  const reply = yield* api["project.requests"](payload)
  expect(reply).toEqual({ requestId, items: [] })
  expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThanOrEqual(256 * 1024)
  const result = yield* lead["project.requests"](payload).pipe(Effect.result)
  expect(result._tag).toBe("Failure")
  if (result._tag === "Failure") expect(result.failure.reason).toBe("record exceeds the read budget")
  expect(yield* readLog).toEqual(before)
})).pipe(Effect.orDie))

it.live("authenticated scoped pages bound the encoded agent envelope and preserve every current/history request without read side effects", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck(); const f = yield* decisionSetup(), other = yield* decisionProject("other")
  const ids: string[] = []
  for (let i = 0; i < 205; i++) ids.push(success(yield* call(f.leadCredential, "ask", { text: '"'.repeat(512), title: '"'.repeat(256), recommendation: '"'.repeat(512), proposedAnswer: '"'.repeat(512) })).questionId)
  success(yield* call(other.leadCredential, "ask", { text: "Other project" }))
  success(yield* call(owner, "answer", { kind: "question", id: ids[0], text: "Recorded" }))
  const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "requests.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const lead = yield* connect(socket, f.lead.token), api = yield* connect(socket, bearer)
  const before = yield* readLog
  const found: string[] = []
  let after: string | undefined, pages = 0
  do {
    const reply = yield* lead["project.requests"]({ requestId: freshRequest(), projectId: f.projectId as never, limit: 200, ...(after === undefined ? {} : { after }) })
    expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThanOrEqual(256 * 1024)
    if (!("data" in reply)) return yield* Effect.die(new Error("An agent request read must return a data envelope"))
    const page = unwrap(reply)
    expect(page.items.length).toBeGreaterThan(0); expect(page.items.length).toBeLessThanOrEqual(200)
    expect(page.items.every((row: { projectId: string; canAnswer: boolean }) => row.projectId === f.projectId && !row.canAnswer)).toBe(true)
    found.push(...page.items.map((row: { id: string }) => row.id))
    after = page.next
    pages++; expect(pages).toBeLessThanOrEqual(ids.length)
    expect(new Set(found).size).toBe(found.length)
  } while (after !== undefined)
  expect(pages).toBeGreaterThan(1); expect(found).toEqual(ids)
  const answered = yield* api["project.requests"]({ requestId: freshRequest(), projectId: f.projectId as never, status: "answered", kind: "question" })
  expect("items" in answered && answered.items).toEqual([expect.objectContaining({ id: ids[0], status: "answered", canAnswer: false, answer: "Recorded" })])
  expect((yield* lead["project.requests"]({ requestId: freshRequest(), projectId: f.projectId as never, after: "unknown" }).pipe(Effect.result))._tag).toBe("Failure")
  expect(yield* readLog).toEqual(before)
})).pipe(Effect.orDie))
