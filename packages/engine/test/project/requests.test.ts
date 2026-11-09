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
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder) })
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })

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
