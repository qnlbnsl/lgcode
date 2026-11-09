import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { App } from "../src/app.tsx"
import { CommandHandler } from "../../engine/src/commands/CommandHandler.ts"
import { provideBoard } from "../../engine/test/board/wakeFixtures.ts"
import { decisionSetup } from "../../engine/test/support/projectDecisionFixtures.ts"
import { call, freshRequest, makeRig, ownerCredential, removeRig, success } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"

const transport = vi.hoisted(() => ({ client: undefined as unknown }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(transport.client) }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it("mounts the actual shell, answers a real linked request, reads its durable history, and keeps Done evidence-gated", async () => {
  const rig = makeRig()
  vi.stubEnv("HOME", rig.home)
  vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  history.replaceState({}, "", "/#/")
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
      yield* registerRebuildCheck()
      const fixture = yield* decisionSetup()
      const taskId = success(yield* call(fixture.leadCredential, "project.task.create", fixture.task)).taskId as string
      const asked = success(yield* call(fixture.workerCredential, "ask", { text: "What should this task deliver?", title: "Choose the actual goal", proposedAnswer: "Use the current contracts", projectId: fixture.projectId, taskId }))
      success(yield* call(fixture.leadCredential, "pass-up", { subject: { _tag: "question", id: asked.questionId } }))
      const handler = yield* CommandHandler
      const execute = (name: string, payload: Record<string, unknown>) => handler.execute(ownerCredential, name, { requestId: freshRequest(), ...payload })
      // Only transport, the session probe and the external harness are replaced.
      // Every DTO, authorization check, receipt, request and board read below
      // comes from the real handler and SQLite writer. This is mounted proof,
      // not a claim about cookies, WebSockets, layout or a browser execution.
      transport.client = new Proxy({}, { get: (_target, name) => name === "client.subscribe" ? () => Stream.never
        : (payload: Record<string, unknown>) => execute(String(name), payload).pipe(Effect.mapError(() => ({ _tag: "CommandError" as const, reason: "refused" }))) })
      yield* Effect.promise(async () => {
        await act(async () => root.render(<App />))
        const wait = async (check: () => void) => {
          await vi.waitFor(async () => {
            await act(async () => {})
            check()
          })
        }
        const tap = async (selector: string) => {
          const node = container.querySelector<HTMLElement>(selector)
          expect(node, selector).not.toBeNull()
          await act(async () => node!.click())
        }
        await wait(() => expect(container.querySelector(`[data-home-item="question:${asked.questionId}"]`)).not.toBeNull())
        await tap(`[data-home-item="question:${asked.questionId}"]`)
        await wait(() => expect(container.querySelector<HTMLTextAreaElement>('textarea[name="answer"]')?.value).toBe("Use the current contracts"))
        await act(async () => container.querySelector('form[aria-label="Answer question"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
        await wait(() => expect(container.querySelector(`[data-home-item="question:${asked.questionId}"]`)).toBeNull())
        const taskRead = await Effect.runPromise(execute("project.read", { projectId: fixture.projectId, collection: "tasks" }))
        expect(taskRead.items).toEqual(expect.arrayContaining([expect.objectContaining({ taskId, state: "done" })]))
        await act(async () => container.querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="Home views"] button')[1]!.click())
        await tap(`.project-table a[href="/#/project/${fixture.projectId}/board"]`)
        await wait(() => expect(container.querySelector('[aria-label="Planned"] .sprint-card')).not.toBeNull())
        expect(container.querySelector('[aria-label="Done"] .sprint-card')).toBeNull()
        const refused = await Effect.runPromise(execute("project.sprint.complete", { projectId: fixture.projectId, sprintId: fixture.sprintId, completion: "Merged", evidence: "" }).pipe(Effect.result))
        expect(refused._tag).toBe("Failure")
        await Effect.runPromise(execute("project.sprint.complete", { projectId: fixture.projectId, sprintId: fixture.sprintId, completion: "Merged", evidence: "Reviewed and verified through the real handler" }))
        await tap('button[aria-label="Reconnect now"]')
        await wait(() => expect(container.querySelector('[aria-label="Done"] .sprint-card')).not.toBeNull())
        await tap(`.sprint-card[data-sprint="${fixture.sprintId}"]`)
        await wait(() => expect(container.textContent).toContain("Reviewed and verified through the real handler"))
        expect(container.textContent).toContain("Release status is tracked separately")
        expect(container.querySelector(".section-heading button")).toBeNull()
        await tap(`.task-title a[href="/#/project/${fixture.projectId}/task/${taskId}"]`)
        await wait(() => expect(container.querySelector(".task-timeline")?.textContent).toContain("Question answered"))
        const requestRead = await Effect.runPromise(execute("client.requests", { after: 0, limit: 200 }))
        const answered = (requestRead.items as Array<{ id: string; answeredAt: number }>).find((row) => row.id === asked.questionId)!
        const historyTime = [...container.querySelectorAll(".task-timeline li")].find((row) => row.textContent?.includes("Question answered"))!.querySelector("time")!
        expect(historyTime.dateTime).toBe(new Date(answered.answeredAt).toISOString())
      })
    })))
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    history.replaceState({}, "", "/")
    removeRig(rig)
  }
})
