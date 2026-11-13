import { randomUUID } from "node:crypto"
import * as NodeServices from "@effect/platform-node/NodeServices"
import type { Event, HarnessInstallation, HarnessInstallResult, RequestId } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import type { ReadHandler } from "../api/reads.ts"
import { freshRequest, readHarnesses, refused, type Input } from "../commands/internal.ts"
import { accountReadiness } from "../project/leadDefaults.ts"
import { resolveCodexHome } from "../accounts/shadowHome.ts"
import { harnessLogin, homeConflict } from "../runner/harnesses.ts"
import { makeHarnessPrograms, quoteCommand, type HarnessPrograms } from "./programs.ts"

const instances = new WeakMap<object, { programs: HarnessPrograms; running: Set<string> }>()
function instance(input: Input) {
  let value = instances.get(input.runtime.log)
  if (!value) {
    // The production entry point supplies the real search path explicitly.
    // An embedded engine (including every test rig) probes configured fake
    // executables only, so a test can never launch a host's CLI bootstrap shim.
    value = { programs: input.runtime.harnessPrograms ?? makeHarnessPrograms({ home: input.runtime.home, path: "" }), running: new Set() }
    instances.set(input.runtime.log, value)
  }
  return value
}
const redactInstallation = (input: Input, value: HarnessInstallation) => Effect.gen(function* () {
  // Settings are executable configuration. Never return altered commands or a
  // private generated path as a suggestion the client could save again.
  const { settings, ...installation } = value
  const safeSettings = settings && (yield* input.runtime.log.redactText(JSON.stringify(settings))) === JSON.stringify(settings) ? settings : undefined
  return { ...installation, ...(safeSettings ? { settings: safeSettings } : {}), ...(value.path === undefined ? {} : { path: yield* input.runtime.log.redactText(value.path) }),
    ...(value.version === undefined ? {} : { version: (yield* input.runtime.log.redactText(value.version)).trim().split(/\r?\n/)[0]!.slice(0, 200) }) }
})
const inspect = (input: Input, programs: HarnessPrograms, id: string, settings?: import("@lgtm/contracts").HarnessSettings) =>
  Effect.tryPromise({ try: () => programs.inspect(id, settings), catch: () => refused("The harness installation could not be read.") })
const audit = (input: Input, events: ReadonlyArray<Event>) => input.runtime.log.append({ _tag: "owner" }, freshRequest(), randomUUID(), events, {}, false)
  .pipe(Effect.catchTag("RequestIdReused", () => Effect.fail(refused("request id reused"))))

const status: ReadHandler = (input, p) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused()
  const { programs } = instance(input), configured = yield* readHarnesses(input.runtime)
  const ids = [...new Set([...programs.ids, ...configured.map((h) => h.id)])]
  const harnesses = []
  for (const id of ids) {
    const saved = configured.find((h) => h.id === id), installation = yield* inspect(input, programs, id, saved)
    const settings = saved ?? (installation.path ? programs.defaultSettings(id, installation.path) : undefined)
    harnesses.push(yield* redactInstallation(input, { ...installation, ...(settings ? { settings } : {}) }))
  }
  return { reply: { requestId: p.requestId, harnesses } }
})
const recipe: ReadHandler = (input, p) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused()
  const value = instance(input).programs.recipe(p.harnessId as string)
  if (!value) return yield* refused("No install recipe is shipped for this harness.")
  // Commands must remain word-for-word. If a registered secret happens to
  // occur in one, refuse to disclose it instead of changing the command.
  if ((yield* input.runtime.log.redactText(JSON.stringify(value))) !== JSON.stringify(value)) return yield* refused("The recipe contains private data and cannot be displayed.")
  return { reply: { requestId: p.requestId, recipe: value } }
})
const install: ReadHandler = (input, p) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused()
  const id = p.harnessId as string, requestId = p.requestId as RequestId
  if ((yield* input.runtime.log.redactText(requestId)) !== requestId || (yield* input.runtime.log.redactText(id)) !== id) return yield* refused()
  const { programs, running } = instance(input), value = programs.recipe(id)
  if (!value?.automatic) return yield* refused(value?.reason ?? "No automatic install recipe is shipped for this harness.")
  if (running.has(id)) return yield* refused("An install is already running for this harness.")
  // All shipped npm recipes share one user prefix. Serialize its writes too.
  if (running.size > 0) return yield* refused("Another harness install is already running.")
  running.add(id)
  return yield* Effect.gen(function* () {
    const settings = (yield* readHarnesses(input.runtime)).find((h) => h.id === id)
    const prior = yield* input.runtime.sql<{ payload_json: string }>`SELECT payload_json FROM events
      WHERE event_type IN ('HarnessInstallStarted', 'HarnessInstallFinished')
      AND json_extract(payload_json, '$.operationRequestId') = ${requestId} ORDER BY sequence`
    if (prior.length) {
      const started = JSON.parse(prior[0]!.payload_json)
      if (started.harnessId !== id) return yield* refused("request id reused")
      const last = JSON.parse(prior.at(-1)!.payload_json)
      const result: HarnessInstallResult = { state: last._tag === "HarnessInstallFinished" ? last.state : "failed", output: "",
        installation: yield* redactInstallation(input, yield* inspect(input, programs, id, settings)),
        ...(last._tag !== "HarnessInstallFinished" ? { reason: "The service stopped before the install outcome was recorded. Check the installation before retrying." }
          : last.reason === undefined ? {} : { reason: last.reason }) }
      return { reply: { requestId, ...result } }
    }
    yield* audit(input, [{ _tag: "HarnessInstallStarted", harnessId: id as HarnessInstallation["harnessId"], operationRequestId: requestId }])
    // Finish even if a browser disconnects. The subprocess has a two-minute
    // deadline and a process-group kill. Output never enters the event log.
    const result = yield* Effect.tryPromise({ try: (signal) => programs.install(id, signal), catch: () => refused("The install command could not run.") })
      .pipe(Effect.catch(() => Effect.succeed({ ok: false, output: "", reason: "The install command could not run." })))
    const installation = yield* inspect(input, programs, id, settings).pipe(Effect.catch(() => Effect.succeed({ harnessId: id as HarnessInstallation["harnessId"], installed: false } as HarnessInstallation)))
    const state = result.ok && installation.installed ? "installed" as const : "failed" as const
    const reason = state === "installed" ? undefined : result.reason ?? "The command ended, but the harness executable was not found."
    const events: Event[] = [{ _tag: "HarnessInstallFinished", harnessId: id as HarnessInstallation["harnessId"], operationRequestId: requestId, state, ...(reason ? { reason } : {}) }]
    if (state === "installed" && settings === undefined && installation.path) {
      const defaults = programs.defaultSettings(id, installation.path)
      if (defaults) events.push({ _tag: "HarnessChanged", harness: defaults })
    }
    yield* audit(input, events)
    return { reply: { requestId, state, installation: yield* redactInstallation(input, installation),
      output: yield* input.runtime.log.redactText(result.output), ...(reason ? { reason: yield* input.runtime.log.redactText(reason) } : {}) } }
  }).pipe(Effect.uninterruptible, Effect.ensuring(Effect.sync(() => { running.delete(id) })))
}).pipe(Effect.catchTag("SqlError", () => Effect.fail(refused("The install record could not be read."))))
const accountCheck: ReadHandler = (input, p) => Effect.gen(function* () {
  if (input.actor._tag !== "owner") return yield* refused()
  const account = input.snapshot.accounts[p.accountId as string]
  if (!account) return yield* refused("The account is no longer registered.")
  const settings = (yield* readHarnesses(input.runtime)).find((h) => h.id === account.harness)
  const state = settings ? yield* accountReadiness(input, settings, account) : "missing-executable"
  const { programs } = instance(input), value = programs.recipe(account.harness)
  const installation = yield* inspect(input, programs, account.harness, settings)
  let command = value?.signInCommand ?? ""
  // Use the executable actually found, and the account's own login directory.
  // This command is displayed as text and is never executed by the engine.
  if (installation.path && value) command = quoteCommand([installation.path, ...value.signInArguments])
  const variable = harnessLogin(account.harness).homeVariable
  const configuredHome = variable === undefined ? undefined : account.environment?.[variable]
  if (configuredHome?.startsWith("secret:") || homeConflict(account.harness, account.home, configuredHome)) return yield* refused("The account's login folder cannot be displayed from these settings.")
  let loginHome = account.home ?? configuredHome
  if (account.harness === "codex") {
    // Additional Codex accounts use a private auth overlay. The displayed
    // command must target the same home the runner and readiness read use.
    // Resolving it does not materialize a folder or copy any credentials.
    const environment = yield* resolveCodexHome({ stateFolder: input.runtime.stateFolder, home: input.runtime.home, accountId: account.id,
      variables: loginHome ? { CODEX_HOME: loginHome } : {}, ...(account.home ? { homePath: account.home } : {}) }).pipe(
      Effect.provide(NodeServices.layer), Effect.mapError(() => refused("The account's login folder could not be read.")))
    loginHome = environment.CODEX_HOME
  }
  if (loginHome && variable) command = `${variable}=${quoteCommand([loginHome])} ${command}`
  return { reply: { requestId: p.requestId, accountId: account.id, state, remoteAuthentication: "not-checked", signInCommand: yield* input.runtime.log.redactText(command) } }
})
export const harnessReads = {
  "client.harness.status": status, "client.harness.recipe": recipe, "client.harness.install": install, "client.harness.account.check": accountCheck
} satisfies Record<string, ReadHandler>
