import { constants } from "node:fs"
import { access, stat } from "node:fs/promises"
import * as NodeServices from "@effect/platform-node/NodeServices"
import type { Account, HarnessSettings, ProjectLeadDefaults } from "@lgcode/contracts"
import { HomeDirectory } from "@lgcode/t3-provider-instance/HostProcess"
import { mergeProviderInstanceEnvironment } from "@lgcode/t3-provider-instance/instanceEnvironment"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { pickAccount } from "../accounts/pick.ts"
import { credentialSourceFor } from "../accounts/credentialSource.ts"
import { withCodexHome } from "../accounts/shadowHome.ts"
import { buildBaseEnvironment } from "../runner/baseEnvironment.ts"
import { harnessLogin, homeConflict, loginRefusal } from "../runner/harnesses.ts"
import { readHarnesses, refused, type Input } from "../commands/internal.ts"

// Readiness is local evidence, not a provider usage report. The normal runner
// still establishes authentication when it opens the actual ACP session.
const ready = (input: Input, harness: HarnessSettings, account: Account) => Effect.gen(function* () {
  if (harness.runMode !== "acp" || loginRefusal(harness.id, account) !== undefined) return false
  // Follow executable symlinks, but do not mistake directory search access for a runnable file.
  if (!(yield* Effect.tryPromise(() => stat(harness.adapterPath))).isFile()) return false
  if (!(yield* Effect.tryPromise(() => access(harness.adapterPath, constants.X_OK)).pipe(Effect.isSuccess))) return false
  let variables: Record<string, string> = {}
  for (const [name, raw] of Object.entries(account.environment ?? {})) {
    if (name.startsWith("LGCODE_") || name.startsWith("HERDR_")) continue
    if (raw.startsWith("secret:")) {
      if (raw.startsWith("secret:client.")) return false
      const value = yield* input.runtime.secrets.resolve(raw)
      if (value === undefined) return false
      variables[name] = Redacted.value(value)
    } else variables[name] = raw
  }
  const login = harnessLogin(harness.id)
  if (homeConflict(harness.id, account.home, login.homeVariable === undefined ? undefined : variables[login.homeVariable]) !== undefined) return false
  if (account.home !== undefined && login.homeVariable !== undefined && harness.id !== "codex") variables[login.homeVariable] = account.home
  if (account.secret !== undefined) {
    if (account.secret.startsWith("secret:client.")) return false
    const value = yield* input.runtime.secrets.resolve(account.secret)
    if (value === undefined) return false
    if (login.keyVariable !== undefined && variables[login.keyVariable] === undefined) variables[login.keyVariable] = Redacted.value(value)
  }
  if (harness.id === "codex") variables = yield* withCodexHome({ stateFolder: input.runtime.stateFolder, home: input.runtime.home,
    accountId: account.id, variables, ...(account.home === undefined ? {} : { homePath: account.home }) }).pipe(Effect.provide(NodeServices.layer))
  const base = buildBaseEnvironment({ parent: process.env, accountVariables: variables, lgcodeSocket: "", lgcodeToken: "" })
  const environment = yield* mergeProviderInstanceEnvironment(Object.entries(variables).map(([name, value]) => ({ name, value, sensitive: false })), base)
    .pipe(Effect.provideService(HomeDirectory, process.env.HOME ?? input.runtime.home))
  const effective = Object.fromEntries(Object.entries(environment).filter((pair): pair is [string, string] => pair[1] !== undefined))
  const source = credentialSourceFor({ harnessId: harness.id, home: effective.HOME ?? input.runtime.home, variables: effective })
  const fileCredential = yield* source.hasCredential
  // A key must belong to this harness and reach its actual spawn environment.
  // Unknown harnesses have no established local authentication evidence.
  return fileCredential || (login.keyVariable !== undefined && Boolean(effective[login.keyVariable]?.trim()))
}).pipe(Effect.catch(() => Effect.succeed(false)))

export const leadDefaults = (input: Input, saved?: typeof ProjectLeadDefaults.Type) => Effect.gen(function* () {
  const harnesses = (yield* readHarnesses(input.runtime)).filter((row) => saved === undefined || row.id === saved.harness)
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const harness of harnesses) {
    let remaining = input.snapshot.accounts
    let account: Account | undefined
    for (;;) {
      const candidate = pickAccount({ ...input.snapshot, accounts: remaining }, harness.id, saved?.account ?? { _tag: "any" })
      if (candidate === undefined) break
      if (yield* ready(input, harness, candidate)) { account = candidate; break }
      remaining = Object.fromEntries(Object.entries(remaining).filter(([id]) => id !== candidate.id))
    }
    if (account === undefined) continue
    const model = saved?.model ?? harness.defaultModel, effort = saved?.effort ?? harness.defaultEffort
    const permission = saved?.permission ?? harness.defaultPermission
    if (model !== undefined && harness.models.length > 0 && !harness.models.includes(model)
      || effort !== undefined && harness.efforts.length > 0 && !harness.efforts.includes(effort)
      || harness.reportedModes.length > 0 && !harness.reportedModes.some((row) => row.id === harness.permissionMapping[permission])) continue
    return { harness: harness.id, account: { _tag: "named" as const, accountId: account.id }, permission,
      ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) }
  }
  return yield* refused("no ready signed-in lead account is available")
})
