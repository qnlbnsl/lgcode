import { ShellDataProvider, useConversation } from "../src/data/ShellDataProvider.tsx"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ProjectId } from "@lgcode/contracts"
import { CommandHandler } from "../../engine/src/commands/CommandHandler.ts"
import { dispatchQueued } from "../../engine/src/routing/deliveries.ts"
import { provideBoard, boardState } from "../../engine/test/board/wakeFixtures.ts"
import { appendSetup, call, eventOf, freshRequest, makeRig, ownerCredential, readLog, removeRig, seedAccount, seedAgent, seedHarness, success } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { Composer } from "../src/thread/composer.tsx"

import { AgentTools } from "../src/thread/agentTools.tsx"
import { TeamConversation } from "../src/thread/team.tsx"

const transport = vi.hoisted(() => ({ client: undefined as unknown }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(transport.client) }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it("mounts real context search, prompt/configuration and owner team peek without consuming member marks", async () => {
  const rig = makeRig()
  vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  const git = (...args: string[]) => execFileSync("/usr/bin/git", ["-C", rig.work, ...args], { stdio: "pipe" })
  const container = document.createElement("div"); document.body.append(container)
  const root = createRoot(container)
  const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal")
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  try {
    git("init", "-b", "main"); git("config", "user.name", "Conversation Test"); git("config", "user.email", "conversation@example.test"); git("config", "commit.gpgsign", "false")
    writeFileSync(join(rig.work, "reference.txt"), "BODY-MUST-NOT-BE-INLINED\n")
    git("add", "reference.txt"); git("commit", "-m", "Fixture")
    await Effect.runPromise(provideBoard(rig, (runner) => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
      const lead = yield* seedAgent({ id: "lead", folder: rig.work })
      const worker = yield* seedAgent({ id: "worker", parent: "lead", folder: rig.work })
      runner.script("choices", () => Effect.succeed({ models: { source: "negotiated", options: [{ id: "test-model" }, { id: "next-model", label: "Next model" }] }, efforts: { source: "unavailable", options: [] } }))
      runner.script("context", () => Effect.succeed({ _tag: "available", used: 0, window: 200, percent: 0, reportedAt: Date.now() }))
      success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "sh" } }))
      const repoId = success(yield* call(ownerCredential, "project.repository.add", { name: "Repository", path: rig.work, machineId: "local" })).repoId
      const worktreeId = success(yield* call(ownerCredential, "project.workspace.register", { repoId, machineId: "local", path: rig.work, branch: "main", checkout: "main" })).worktreeId
      const projectId = Schema.decodeUnknownSync(ProjectId)(`conversation-${freshRequest()}`)
      // Only historical project membership is seeded. New references and
      // every UI command use the real handler, writer and authorization rules.
      yield* appendSetup([eventOf({ _tag: "project.Created", projectId, repoId, worktreeId, leadAgentId: lead.agentId, machineId: "local", name: "Conversation", goal: "" })])
      const team = success(yield* call(ownerCredential, "project.team.create", { projectId, worktreeId, name: "Build" }))
      success(yield* call(ownerCredential, "group", { agentId: worker.agentId, add: [team.group], remove: [] }))
      const sprintId = success(yield* call(ownerCredential, "project.sprint.create", { projectId, label: "SP-1", name: "Build", goal: "", phase: "Build", owner: lead.agentId, needs: [] })).sprintId
      const taskId = success(yield* call(ownerCredential, "project.task.create", { projectId, worktreeId, teamId: team.teamId, sprintId, owner: worker.agentId, state: "queue", label: "TASK-1", title: "Actual task" })).taskId
      const handler = yield* CommandHandler
      const commands: string[] = []
      const completed = new Map<string, number>()
      transport.client = new Proxy({}, { get: (_target, name) => (payload: Record<string, unknown>) => {
        commands.push(String(name))
        return handler.execute(ownerCredential, String(name), payload).pipe(Effect.mapError(() => ({ _tag: "CommandError" as const, reason: "refused" })),
          Effect.ensuring(Effect.sync(() => completed.set(String(name), (completed.get(String(name)) ?? 0) + 1))))
      } })
      const waitForCommand = async (name: string, count: number) => {
        // Wait for I/O, then let act commit its result before checking the DOM.
        await act(async () => { await vi.waitFor(() => expect(completed.get(name) ?? 0).toBeGreaterThanOrEqual(count)) })
      }
      const identity = { _tag: "agent" as const, agentId: worker.agentId }
      const scope = { projectId, worktreeId, teamId: team.teamId }
      const actualAgent = success(yield* call(ownerCredential, "client.snapshot", {})).agents.find((row: { agentId: string }) => row.agentId === worker.agentId)!
      const found = success(yield* call(ownerCredential, "project.context.search", { ...scope, query: "" }))
      expect(found.result.items).toHaveLength(2)
      const tap = async (name: string) => { await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => (node.getAttribute("aria-label") ?? node.textContent) === name)!.click()) }
      const type = async (text: string) => { await act(async () => { const input = container.querySelector("textarea")!; input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })) }) }
      yield* Effect.promise(async () => {
        await act(async () => root.render(<ShellDataProvider onSessionExpired={() => {}}><Composer identity={identity} recipient="Worker" scope={scope} /><AgentTools agentId={worker.agentId} account={{ id: actualAgent.account, harness: actualAgent.harness }} disabled={false} /></ShellDataProvider>))
        await waitForCommand("client.agent.configuration", 1)
        await waitForCommand("accounts", 1)
        expect(container.querySelector(".conversation-subscription")!.textContent).toBe("first · Primary")
        await tap("Add context")
        await waitForCommand("project.context.search", 1)
        expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
        await act(async () => { container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((node) => node.click()) })
        await tap("Add selected context"); await type("Use actual identities")
        await act(async () => container.querySelector("form")!.requestSubmit())
        await waitForCommand("prompt", 1)
        expect(container.textContent).toContain("Prompt sent.")
        expect(container.querySelector("textarea")!.value).toBe("")
        await tap("Model"); await tap("Next model")
        await waitForCommand("configure", 1)
        await waitForCommand("client.agent.configuration", 2)
        expect(container.textContent).toContain("Configuration: pending")
        expect(container.textContent).toContain("Applied model: test-model")
        expect(container.textContent).toContain("0% context")
      })
      const events = yield* readLog
      const queued = events.find((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.target === worker.agentId)!.event
      if (queued._tag !== "DeliveryQueued") throw new Error("Expected the real prompt source")
      expect(queued.delivery.content).toMatchObject({ context: [{ _tag: "task", projectId, taskId }, { _tag: "file", projectId, repoId, worktreeId, path: "reference.txt" }] })
      expect(JSON.stringify(queued)).not.toContain("BODY-MUST-NOT-BE-INLINED")
      // Run the real dispatcher explicitly: this fixture parks automatic
      // followers, so deterministic mounted proof has no background races.
      yield* dispatchQueued(worker.agentId)
      expect(runner.callsOf("prompt")[0]!.input.delivery.content).toMatchObject({ context: queued.delivery.content._tag === "prompt" ? queued.delivery.content.context : undefined })
      expect(runner.callsOf("configure")[0]!.input.desired.model).toBe("next-model")
      yield* Effect.promise(async () => {
        const reads = completed.get("client.agent.configuration") ?? 0
        await tap("Refresh configuration")
        await waitForCommand("client.agent.configuration", reads + 1)
        expect(container.textContent).toContain("Configuration: applied")
        expect(container.textContent).toContain("Applied model: next-model")
      })
      const before = (yield* boardState).readState
      yield* Effect.promise(async () => {
        await act(async () => root.render(<ShellDataProvider onSessionExpired={() => {}}><TeamConversation projectId={projectId} teamId={team.teamId} channelId={team.channelId} name="Build" scope={scope} disabled={false} onSessionExpired={() => { throw new Error("Unexpected expiry") }} /></ShellDataProvider>))
        await waitForCommand("board.peek", 1)
        const searches = completed.get("project.context.search") ?? 0
        await tap("Add context"); await waitForCommand("project.context.search", searches + 1)
        const task = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((node) => node.closest("label")?.textContent?.includes("TASK-1"))!
        await act(async () => task.click()); await tap("Add selected context")
        await type("Actual team direction"); await act(async () => container.querySelector("form")!.requestSubmit())
        await waitForCommand("board.post", 1)
        await tap("Refresh conversation")
        await waitForCommand("board.peek", 2)
        expect(container.textContent).toContain("Actual team direction")
      })
      const board = yield* boardState
      expect(board.readState).toEqual(before)
      expect(commands).toContain("board.peek"); expect(commands).not.toContain("board.read"); expect(commands).not.toContain("board.acknowledge")
      const posted = Object.values(board.posts).find((post) => post.text === "Actual team direction")!
      expect(posted.channelId).toBe(team.channelId); expect(posted.author).toEqual({ _tag: "owner" })
      expect(posted.context).toEqual([{ _tag: "task", projectId, taskId }])
    })))
  } finally {
    await act(async () => root.unmount()); container.remove()
    if (original) Object.defineProperty(HTMLDialogElement.prototype, "showModal", original)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal")
    vi.restoreAllMocks(); vi.unstubAllEnvs(); removeRig(rig)
  }
}, 20_000)
