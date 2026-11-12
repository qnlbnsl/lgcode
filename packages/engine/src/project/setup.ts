import { execFile } from "node:child_process"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import type { Discovery, Event } from "@lgtm/contracts"
import { type Input, type Payload, type PiecePlanner, readHarnesses, refused } from "../commands/internal.ts"
import type { ReadHandler } from "../api/reads.ts"
import { localHarnessDefaults } from "../runner/harnesses.ts"
import { accountReadiness, adapterInstalled, leadDefaults } from "./leadDefaults.ts"
import { withGit, gitCall } from "./gitApi.ts"
import { own, projectView } from "./view.ts"

const steps = ["welcome", "found", "project"] as const
const advance: PiecePlanner = (input, raw) => {
  const p = raw as Payload<"project.setup.advance">, setup = projectView(input.snapshot).setup
  const previous = steps.indexOf(setup.step), next = steps.indexOf(p.step)
  if (next > previous + 1) return Effect.fail(refused("complete the preceding setup step first"))
  return Effect.succeed({ events: next > previous && setup.completedAt === undefined ? [{ _tag: "project.SetupAdvanced", step: p.step } as Event] : [], reply: () => ({ requestId: p.requestId }) })
}
const complete: PiecePlanner = (input, raw) => {
  const p = raw as Payload<"project.setup.complete">, view = projectView(input.snapshot), project = own(view.projects, p.projectId)
  const lead = project === undefined ? undefined : own(input.snapshot.agents, project.leadAgentId)
  if (view.setup.completedAt !== undefined) return Effect.fail(refused("setup is already complete"))
  if (view.setup.step !== "project" || project === undefined || lead === undefined || lead.startFailure !== undefined) return Effect.fail(refused("create a project successfully before completing setup"))
  return Effect.succeed({ events: [{ _tag: "project.SetupCompleted", projectId: p.projectId } as Event], reply: () => ({ requestId: p.requestId }) })
}
export const ownerNameSuggestion = (input: Input) => Effect.tryPromise({ try: () => new Promise<string | undefined>((resolve) => {
  const folder = projectView(input.snapshot).settings?.workspaceFolder
  if (folder === undefined) { resolve(undefined); return }
  execFile("git", ["-C", folder, "config", "--get", "user.name"], { timeout: 2000, maxBuffer: 1024, encoding: "utf8" }, (error, stdout) => {
    const value = stdout.trim()
    resolve(error === null && value.length > 0 && [...value].length <= 128 && !/[\x00-\x1f\x7f]/.test(value) ? value : undefined)
  })
}), catch: () => refused("discovery unavailable; retry or change the workspace folder") }).pipe(
  Effect.flatMap((value) => value === undefined ? Effect.succeed(undefined) : input.runtime.log.redactText(value)),
  Effect.catch(() => Effect.succeed(undefined)))
const discover: ReadHandler = (input, raw) => Effect.gen(function* () {
  const configured = yield* readHarnesses(input.runtime)
  const detected = yield* localHarnessDefaults(process.env.PATH ?? "").pipe(Effect.provide(NodeServices.layer))
  const harnesses: Array<typeof Discovery.Type.harnesses[number]> = []
  let truncated = false
  for (const id of ["claude", "codex", "gemini", "cursor"] as const) {
    const saved = configured.find((row) => row.id === id), harness = saved ?? detected.harnesses.find((row) => row.id === id)
    const installed = harness !== undefined && (yield* adapterInstalled(harness))
    const accounts: Array<typeof Discovery.Type.harnesses[number]["accounts"][number]> = []
    const rows = Object.values(input.snapshot.accounts).filter((row) => row.harness === id)
    truncated ||= rows.length > 64
    for (const account of rows.slice(0, 64)) accounts.push({ accountId: account.id,
      state: !installed ? "missing-executable" : !account.enabled || harness === undefined ? "unavailable" : yield* accountReadiness(input, harness, account), remoteAuthentication: "not-checked" })
    harnesses.push({ harness: id, installed, configured: saved !== undefined, accounts })
  }
  const found = yield* withGit(input, (git) => gitCall(git.discover())).pipe(Effect.result)
  const defaults = yield* leadDefaults(input, projectView(input.snapshot).settings?.lead).pipe(Effect.result)
  const name = yield* ownerNameSuggestion(input)
  const repositories: Array<{ name: string; path: string }> = []
  if (found._tag === "Success") for (const row of found.success.items.slice(0, 64)) repositories.push({
    name: yield* input.runtime.log.redactText(row.name), path: yield* input.runtime.log.redactText(row.path) })
  const result: typeof Discovery.Type = { state: found._tag === "Success" ? "available" : "unavailable",
    ...(found._tag === "Success" ? {} : { reason: "discovery unavailable; retry or change the workspace folder" as const }),
    repositories, truncated: truncated || found._tag === "Success" && (found.success.truncated || found.success.items.length > 64), harnesses,
    ...(defaults._tag === "Success" ? { readyDefaults: defaults.success } : {}), ...(name === undefined ? {} : { ownerNameSuggestion: name }) }
  return { reply: { requestId: raw.requestId, result } }
})
export const setupPlanners = { "project.setup.advance": advance, "project.setup.complete": complete }
export const setupReads = { "project.setup": ((input, raw) => Effect.succeed({ reply: { requestId: raw.requestId, setup: projectView(input.snapshot).setup } })) satisfies ReadHandler,
  "project.setup.discover": discover }
