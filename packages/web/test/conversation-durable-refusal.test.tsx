import { execFileSync } from "node:child_process"
import { unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/sql/SqlClient"
import { ProjectId, type AgentChoices } from "@lgcode/contracts"
import { CommandHandler } from "../../engine/src/commands/CommandHandler.ts"
import { provideBoard } from "../../engine/test/board/wakeFixtures.ts"
import { appendSetup, call, eventOf, freshRequest, makeRig, ownerCredential, readLog, removeRig, seedAccount, seedAgent, seedHarness, success } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { ShellDataProvider, useConversation } from "../src/data/ShellDataProvider.tsx"
import { AgentTools } from "../src/thread/agentTools.tsx"
import { Composer } from "../src/thread/composer.tsx"
import type { ConversationEntry, ConversationIdentity } from "../src/thread/conversationState.tsx"

const transport = vi.hoisted(() => ({ client: undefined as unknown }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(transport.client) }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const eventually = async (check: () => void) => vi.waitFor(async () => { await act(async () => {}); check() })
let entry: ConversationEntry
function Probe({ identity }: { identity: ConversationIdentity }) { entry = useConversation(identity).entry; return null }
const tap = async (container: HTMLElement, name: string) => {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => (node.getAttribute("aria-label") ?? node.textContent) === name)
  expect(button, name).toBeTruthy()
  await act(async () => button!.click())
}
const type = async (container: HTMLElement, text: string) => act(async () => {
  const input = container.querySelector("textarea")!; input.value = text; input.dispatchEvent(new Event("input", { bubbles: true }))
})
const allChoices: AgentChoices = {
  models: { source: "negotiated", options: [{ id: "test-model" }, { id: "old-model" }, { id: "corrected-model" }] },
  efforts: { source: "negotiated", options: [{ id: "high" }, { id: "old-effort" }, { id: "corrected-effort" }] },
}

// The browser connection and external runner are controlled. Context search,
// file validation, choice validation, authorization, SQLite and receipts are real.
it.each(["prompt", "board.post", "model", "effort"] as const)("605 retires only a durable %s refusal and permits a corrected new request", async (kind) => {
  const rig = makeRig()
  vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  const container = document.createElement("div"); document.body.append(container)
  const root = createRoot(container)
  const dialog = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal")
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  try {
    const git = (...args: string[]) => execFileSync("/usr/bin/git", ["-C", rig.work, ...args], { stdio: "pipe" })
    git("init", "-b", "main"); git("config", "user.name", "Refusal Test"); git("config", "user.email", "refusal@example.test"); git("config", "commit.gpgsign", "false")
    const file = join(rig.work, "reference.txt")
    writeFileSync(file, "Context stays a reference.\n"); git("add", "reference.txt"); git("commit", "-m", "Fixture")
    await Effect.runPromise(provideBoard(rig, (runner) => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
      const lead = yield* seedAgent({ id: "lead", folder: rig.work })
      const worker = yield* seedAgent({ id: "worker", parent: "lead", folder: rig.work })
      let choices = allChoices
      runner.script("choices", () => Effect.succeed(choices))
      success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "sh" } }))
      const repoId = success(yield* call(ownerCredential, "project.repository.add", { name: "Repository", path: rig.work, machineId: "local" })).repoId
      const worktreeId = success(yield* call(ownerCredential, "project.workspace.register", { repoId, machineId: "local", path: rig.work, branch: "main", checkout: "main" })).worktreeId
      const projectId = Schema.decodeUnknownSync(ProjectId)(`refusal-${freshRequest()}`)
      yield* appendSetup([eventOf({ _tag: "project.Created", projectId, repoId, worktreeId, leadAgentId: lead.agentId, machineId: "local", name: "Refusal", goal: "" })])
      const team = success(yield* call(ownerCredential, "project.team.create", { projectId, worktreeId, name: "Build" }))
      success(yield* call(ownerCredential, "group", { agentId: worker.agentId, add: [team.group], remove: [] }))
      const handler = yield* CommandHandler
      const sql = yield* SqlClient.SqlClient
      const command = kind === "model" || kind === "effort" ? "configure" : kind
      const sent: Array<Record<string, unknown>> = []
      const execute = (name: string, payload: Record<string, unknown>) => handler.execute(ownerCredential, name, payload)
        .pipe(Effect.mapError(() => ({ _tag: "CommandError" as const, requestId: payload.requestId, reason: "command refused" })))
      transport.client = new Proxy({}, { get: (_target, name) => (payload: Record<string, unknown>) => {
        if (name === command) sent.push(payload)
        return execute(String(name), payload)
      } })
      const identity = kind === "board.post" ? { _tag: "team" as const, projectId, teamId: team.teamId, channelId: team.channelId }
        : { _tag: "agent" as const, agentId: worker.agentId }
      yield* Effect.promise(async () => {
        await act(async () => root.render(<ShellDataProvider onSessionExpired={() => {}}><Probe identity={identity} />
          <Composer identity={identity} recipient="Worker" scope={{ projectId, worktreeId, teamId: team.teamId }}
            tools={identity._tag === "agent" ? <AgentTools agentId={worker.agentId} disabled={false} /> : undefined} />
        </ShellDataProvider>))
        await type(container, "Keep the original draft.")
        if (kind === "model" || kind === "effort") {
          const label = kind === "model" ? "Model" : "Effort"
          await eventually(() => expect(container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.disabled).toBe(false))
          await tap(container, label)
          // The actual menu was read before the external harness changes its
          // advertised choices. The real configure planner must now refuse it.
          choices = { ...allChoices, [kind === "model" ? "models" : "efforts"]: { source: "negotiated", options: [{ id: `corrected-${kind}` }] } }
          await tap(container, `old-${kind}`)
          await eventually(() => expect(entry.state.configurationAttempt?.status).not.toBe("sending"))
        } else {
          await tap(container, "Add context")
          await eventually(() => expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1))
          await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
          await tap(container, "Add selected context")
          expect(entry.state.context[0]?.reference).toMatchObject({ _tag: "file", path: "reference.txt" })
          unlinkSync(file)
          await act(async () => container.querySelector("form")!.requestSubmit())
          await eventually(() => expect(entry.state.status).not.toBe("sending"))
        }
        expect(sent).toHaveLength(1)
      })
      const original = sent[0]!
      const rows = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE caller = 'owner' AND request_id = ${String(original.requestId)}`
      expect(rows).toHaveLength(1)
      expect(JSON.parse(rows[0]!.result_json)).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: expect.objectContaining({ _tag: "CommandRefused", command }) }),
      ]))
      // Repairing the cause cannot change the receipted outcome for this key.
      writeFileSync(file, "Context stays a reference.\n"); choices = allChoices
      expect(yield* Effect.result(execute(command, original))).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandError" } })
      const before = yield* readLog
      expect(before.filter((row) => row.requestId === original.requestId && row.event._tag !== "CommandRefused")).toHaveLength(0)
      yield* Effect.promise(async () => {
        expect(entry.state.draft).toBe("Keep the original draft.")
        if (kind === "model" || kind === "effort") {
          expect(entry.state.configurationAttempt).toBeUndefined()
          const label = kind === "model" ? "Model" : "Effort"
          await tap(container, label); await tap(container, `corrected-${kind}`)
          await eventually(() => expect(entry.state.configurationMessage).toContain("Selection recorded"))
        } else {
          expect(entry.state.context).toHaveLength(1)
          expect(container.querySelector<HTMLButtonElement>(`[aria-label="${kind === "prompt" ? "Send prompt" : "Send message"}"]`)?.disabled).toBe(false)
          await type(container, "Corrected explicit draft.")
          await act(async () => container.querySelector("form")!.requestSubmit())
          await eventually(() => expect(entry.state.message).toBe(kind === "prompt" ? "Prompt sent." : "Message posted."))
        }
        expect(sent).toHaveLength(2)
        expect(sent[1]!.requestId).not.toBe(original.requestId)
        expect(sent[1]).toMatchObject(kind === "model" || kind === "effort" ? { [kind]: `corrected-${kind}` } : { text: "Corrected explicit draft.", context: original.context })
      })
      const final = yield* readLog
      const effectTag = kind === "model" || kind === "effort" ? "AgentConfigurationChosen" : kind === "prompt" ? "DeliveryQueued" : "board.PostWritten"
      expect(final.filter((row) => row.requestId === sent[1]!.requestId && row.event._tag === effectTag)).toHaveLength(1)
      expect(yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE caller = 'owner' AND request_id = ${String(original.requestId)}`).toEqual(rows)
    })))
  } finally {
    await act(async () => root.unmount()); container.remove()
    if (dialog) Object.defineProperty(HTMLDialogElement.prototype, "showModal", dialog)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal")
    vi.restoreAllMocks(); vi.unstubAllEnvs(); removeRig(rig)
  }
}, 20_000)
