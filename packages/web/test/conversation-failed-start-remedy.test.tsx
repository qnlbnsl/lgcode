import { completedSetup } from "../e2e/support/completedSetup.ts"
import { act } from "react"
import * as Effect from "effect/Effect"
import { expect, it, vi } from "vitest"
import type { ClientSnapshot } from "@lgtm/contracts"
import { CommandHandler } from "../../engine/src/commands/CommandHandler.ts"
import { applyPendingConfiguration } from "../../engine/src/commands/configuration.ts"
import { RunnerRejected } from "../../engine/src/runner/Runner.ts"
import { provideBoard } from "../../engine/test/board/wakeFixtures.ts"
import { sessionFor } from "../../engine/test/support/fakeRunner.ts"
import { appendSetup, call, eventOf, freshRequest, harnessSettings, makeRig, ownerCredential, readLog, removeRig, seedAccount, startPayload, success } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { controlledStream } from "./controlled-stream.ts"
import { cleanupThread, mountThread } from "./thread-fixtures.tsx"

const button = (container: HTMLElement, name: string) => [...container.querySelectorAll("button")]
  .find((node) => (node.getAttribute("aria-label") ?? node.textContent) === name)!
const observe = (check: () => void) => vi.waitFor(async () => { await act(async () => {}); check() })

for (const axis of ["model", "effort"] as const) it(`issue 603: mounted ${axis}-refused remedy keeps configuration recovery, real resume and the unsent draft`, async () => {
  const rig = makeRig()
  vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder)
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  let releaseStart: (() => void) | undefined
  let start: Promise<Record<string, unknown>> | undefined
  try {
    await Effect.runPromise(provideBoard(rig, (runner) => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* seedAccount()
      yield* completedSetup()
      yield* appendSetup([eventOf({ _tag: "HarnessChanged", harness: harnessSettings("first", {
        models: ["test-model", "valid-model"], efforts: ["high", "low"],
      }) })])
      const handler = yield* CommandHandler
      const gate = new Promise<void>((resolve) => { releaseStart = resolve })
      // The external adapter alone is controlled. The actual start handler
      // writes AgentStartFailed and revokes its token after this rejection.
      runner.script("start", () => Effect.promise(() => gate).pipe(Effect.flatMap(() =>
        Effect.fail(new RunnerRejected({ reason: "controlled adapter refusal", startFailure: `${axis}-refused` }))),
      ))
      start = Effect.runPromise(handler.execute(ownerCredential, "start", { requestId: freshRequest(), ...startPayload(rig, { name: "Worker one" }) }))
      let agent!: ClientSnapshot["agents"][number]
      yield* Effect.promise(() => vi.waitFor(async () => {
        const snapshot = await Effect.runPromise(handler.execute(ownerCredential, "client.snapshot", { requestId: freshRequest() })) as unknown as ClientSnapshot
        agent = snapshot.agents.find((row) => row.name === "Worker one")!
        expect(agent?.state._tag).toBe("starting")
      }))
      const live = yield* Effect.promise(controlledStream)
      const client: Record<string, unknown> = Object.fromEntries([
        "client.snapshot", "client.thread", "client.requests", "client.alerts.list", "client.sequence", "accounts", "client.agent.configuration", "client.agent.context", "resume",
      ].map((name) => [name, (payload: Record<string, unknown>) => handler.execute(ownerCredential, name, payload)]))
      let configurationCalls = 0
      const configure = vi.fn((payload: Record<string, unknown>) => handler.execute(ownerCredential, "configure", payload).pipe(
        Effect.flatMap((reply) => ++configurationCalls === 1
          ? Effect.fail({ _tag: "ClientError" as const, reason: "controlled lost committed configuration reply" }) : Effect.succeed(reply)),
      ))
      const prompt = vi.fn((payload: Record<string, unknown>) => handler.execute(ownerCredential, "prompt", payload))
      client["client.subscribe"] = () => live.stream; client.configure = configure; client.prompt = prompt
      let container!: HTMLElement
      let after = 0
      const draft = `Retain the ${axis} refusal draft <b>as literal data</b>`
      yield* Effect.promise(async () => {
        container = await mountThread([], client, `/thread/${agent.agentId}`, false)
        await observe(() => {
          expect(container.querySelector('[aria-label="Thread connection"]')?.textContent).toBe("Live")
          expect(button(container, "Model")?.disabled).toBe(false)
        })
        await act(async () => {
          const input = container.querySelector("textarea")!
          expect(input.closest("[hidden]")).toBeNull()
          input.value = draft; input.dispatchEvent(new Event("input", { bubbles: true }))
        })
      })
      const beforeFailure = success(yield* call(ownerCredential, "client.snapshot", {})).sequence as number
      yield* Effect.promise(async () => { releaseStart!(); await start })
      const failed = success(yield* call(ownerCredential, "client.snapshot", {})) as unknown as ClientSnapshot
      expect(failed.agents.find((row) => row.agentId === agent.agentId)?.startFailure).toBe(`${axis}-refused`)
      const failurePage = success(yield* call(ownerCredential, "client.thread", { agentId: agent.agentId, after: beforeFailure, limit: 100 }))
      after = failed.sequence
      yield* Effect.promise(async () => {
        await act(async () => { for (const row of failurePage.items) await live.emit(row) })
        await observe(() => expect(container.querySelector('[aria-label="Agent activity"]')?.textContent).toContain("Failed to start"))
        expect(container.querySelector("textarea")!.value).toBe(draft)
        expect(button(container, "Send prompt").disabled).toBe(true)
        await act(async () => container.querySelector<HTMLFormElement>('form[aria-label="Prompt agent"]')!.requestSubmit())
        expect(prompt).not.toHaveBeenCalled(); expect(runner.callsOf("prompt")).toHaveLength(0)
        expect(container.querySelector("textarea")!.value).toBe(draft)
        // This is the original behavioral boundary: enabled tools must be
        // reachable outside every hidden ancestor of the halted message input.
        expect(button(container, axis === "model" ? "Model" : "Effort").closest("[hidden]")).toBeNull()
        expect(button(container, axis === "model" ? "Model" : "Effort").disabled).toBe(false)
        await act(async () => button(container, axis === "model" ? "Model" : "Effort").click())
        await act(async () => button(container, axis === "model" ? "valid-model" : "low").click())
        await observe(() => expect(button(container, "Recover configuration")).toBeTruthy())
        expect(button(container, "Recover configuration").closest("[hidden]")).toBeNull()
        expect(configure).toHaveBeenCalledTimes(1)
        const original = configure.mock.calls[0]![0]
        expect(original).toMatchObject({ agentId: agent.agentId, requestId: expect.any(String), [axis]: axis === "model" ? "valid-model" : "low" })
        await act(async () => button(container, "Recover configuration").click())
        await observe(() => expect(container.textContent).toContain("Selection recorded."))
        expect(configure).toHaveBeenCalledTimes(2)
        expect(configure.mock.calls[1]![0]).toEqual(original)
        expect(container.querySelector("textarea")!.value).toBe(draft)
        expect(prompt).not.toHaveBeenCalled()
      })
      const chosen = (yield* readLog).filter((row) => row.event._tag === "AgentConfigurationChosen" && row.event.agentId === agent.agentId)
      expect(chosen).toHaveLength(1)
      const pending = success(yield* call(ownerCredential, "client.agent.configuration", { agentId: agent.agentId })).configuration
      expect(pending.status).toBe("pending")
      expect(pending.desired[axis]).toBe(axis === "model" ? "valid-model" : "low")
      expect(pending.applied?.[axis]).not.toBe(pending.desired[axis])
      runner.script("start", (input) => Effect.succeed(sessionFor(input.agentId)))
      yield* Effect.promise(async () => {
        expect(button(container, "Resume agent").closest("[hidden]")).toBeNull()
        await act(async () => button(container, "Resume agent").click())
        await observe(() => expect(container.textContent).toContain("Resume requested."))
      })
      // No queued prompt is needed to prove this remedy. Apply through the
      // existing engine acknowledgement path, with the actual live token.
      expect(yield* applyPendingConfiguration(agent.agentId)).toBe(true)
      const applied = success(yield* call(ownerCredential, "client.agent.configuration", { agentId: agent.agentId })).configuration
      expect(applied.status).toBe("applied"); expect(applied.applied?.[axis]).toBe(applied.desired[axis])
      const resumedPage = success(yield* call(ownerCredential, "client.thread", { agentId: agent.agentId, after, limit: 100 }))
      yield* Effect.promise(async () => {
        await act(async () => { for (const row of resumedPage.items) await live.emit(row) })
        await observe(() => {
          expect(container.querySelector('[aria-label="Agent activity"]')?.textContent).toBe("Idle")
          expect(button(container, "Send prompt")?.disabled).toBe(false)
        })
        expect(container.querySelector("textarea")!.value).toBe(draft)
        expect(prompt).not.toHaveBeenCalled(); expect(runner.callsOf("prompt")).toHaveLength(0)
        await cleanupThread()
        container = await mountThread([], client, `/thread/${agent.agentId}`, false)
        await observe(() => expect(container.querySelector("textarea")?.value).toBe(""))
        expect(button(container, "Recover configuration")).toBeUndefined()
        expect(configure).toHaveBeenCalledTimes(2)
        await cleanupThread()
      })
    })))
  } finally {
    releaseStart?.(); await start?.catch(() => {})
    await cleanupThread(); vi.unstubAllEnvs(); removeRig(rig)
  }
}, 20_000)
