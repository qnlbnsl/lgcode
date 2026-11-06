import { delimiter, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { HarnessId, type Account, type HarnessSettings, type PermissionLevel } from "@sheprd/contracts"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"

// Fix round 1, A9: how an account's login reaches each harness. `homeVariable`
// names the variable that moves the harness's login folder, so the account's
// `home` can be passed without changing HOME. `keyVariable` names the variable
// that carries an API key, which the account's `secret` fills. A harness with
// no entry, or no field, has no such variable to set.
export interface HarnessLogin {
  readonly homeVariable?: string
  readonly keyVariable?: string
}

const harnessLogins: Readonly<Record<string, HarnessLogin>> = {
  claude: { homeVariable: "CLAUDE_CONFIG_DIR", keyVariable: "ANTHROPIC_API_KEY" },
  codex: { homeVariable: "CODEX_HOME", keyVariable: "OPENAI_API_KEY" },
  gemini: { keyVariable: "GEMINI_API_KEY" },
  cursor: { keyVariable: "CURSOR_API_KEY" }
}

export const harnessLogin = (harnessId: string): HarnessLogin =>
  Object.hasOwn(harnessLogins, harnessId) ? harnessLogins[harnessId]! : {}

// Fix round 2, F-1: the fixed reason for an account field the harness has no
// variable for, or undefined when every field the account holds can be applied.
// The mapping is keyed on the harness id, because harness settings record no
// adapter kind, so a custom id has no mapping and its fields are refused. The
// reason names the field and the harness and never holds a value.
export const loginRefusal = (harnessId: string, account: Pick<Account, "home" | "secret">): string | undefined => {
  const login = harnessLogin(harnessId)
  if (account.home !== undefined && login.homeVariable === undefined) return `account home is not supported by harness ${harnessId}`
  if (account.secret !== undefined && login.keyVariable === undefined) return `account secret is not supported by harness ${harnessId}`
  return undefined
}

// The name of the login variable that disagrees with the account's `home`, if
// any. `explicit` is the value the child would get for the harness's home
// variable, after any `secret:` reference is resolved, or undefined when the
// account sets none. An unresolvable reference is passed as an empty string.
// Both naming the same folder is not a conflict. A value that is not an
// absolute path cannot be the same folder as an absolute `home`.
export const homeConflict = (harnessId: string, home: string | undefined, explicit: string | undefined): string | undefined => {
  const variable = harnessLogin(harnessId).homeVariable
  if (variable === undefined || home === undefined || explicit === undefined) return undefined
  return isAbsolute(explicit) && resolve(explicit) === resolve(home) ? undefined : variable
}

export const resolveHarnessDefaults = (options: { readonly binDirectory: string; readonly path: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const harnesses: HarnessSettings[] = []
    const missing: Array<{ id: string; command: string; reason: string }> = []
    const definitions = [
      { id: "claude", command: "claude-agent-acp", args: [], modes: ["plan", "default", "acceptEdits", "bypassPermissions"] },
      { id: "codex", command: "codex-acp", args: [], modes: ["read-only", "read-only", "workspace-write", "agent-full-access"] },
      { id: "gemini", command: "gemini", args: ["--acp"], modes: ["plan", "default", "autoEdit", "yolo"] },
      // Cursor's Ask mode is read-only: https://cursor.com/docs/cli/overview (2026-11-01).
      { id: "cursor", command: "agent", args: ["acp"], modes: ["ask", "ask", "agent", "agent"] }
    ] as const
    for (const definition of definitions) {
      const directories = definition.id === "claude" || definition.id === "codex"
        ? [resolve(options.binDirectory)]
        : options.path.split(delimiter).filter(isAbsolute)
      let adapterPath: string | undefined
      for (const directory of directories) {
        const candidate = join(directory, definition.command)
        const executable = yield* fs.stat(candidate).pipe(
          Effect.map((info) => info.type === "File" && (info.mode & 0o111) !== 0),
          Effect.catch(() => Effect.succeed(false))
        )
        if (executable) { adapterPath = candidate; break }
      }
      if (adapterPath === undefined) {
        missing.push({ id: definition.id, command: definition.command, reason: "Executable not installed in the configured search path" })
        continue
      }
      const [readOnly, ask, edit, full] = definition.modes
      // Fix round 1, A16: the modes the harness reports, each at the lowest
      // level that asks for it, so a harness that serves two levels with one
      // mode (Codex's read-only, Cursor's ask and agent) lists the mode once.
      // An empty list would make every mode change look unrecorded. The
      // levels run from the lowest, so the first one to name a mode keeps it.
      const reportedModes: Array<{ id: string; level: PermissionLevel }> = []
      for (const [id, level] of [[readOnly, "read-only"], [ask, "ask"], [edit, "edit"], [full, "full"]] as const) {
        if (!reportedModes.some((mode) => mode.id === id)) reportedModes.push({ id, level })
      }
      harnesses.push({
        id: Schema.decodeUnknownSync(HarnessId)(definition.id), runMode: "acp", adapterPath, adapterArguments: [...definition.args],
        permissionMapping: { "read-only": readOnly, ask, edit, full },
        reportedModes, defaultPermission: "ask", models: [], efforts: [], denyReadMechanism: { _tag: "none" }
      })
    }
    return { harnesses, missing }
  })

// The defaults for this installation: the pinned adapters in the engine
// package's own bin folder, and Gemini and Cursor on the given search path.
export const localHarnessDefaults = (path: string) =>
  resolveHarnessDefaults({ binDirectory: fileURLToPath(new URL("../../node_modules/.bin", import.meta.url)), path })

// What the service loads on its first start and on `harnesses reset`: the
// harnesses that were found. A missing one is named in the log and not loaded.
export const installedHarnessDefaults = (path: string): Effect.Effect<ReadonlyArray<HarnessSettings>> =>
  localHarnessDefaults(path).pipe(
    Effect.tap(({ missing }) => missing.length === 0 ? Effect.void : Effect.logWarning(`harness adapters not found: ${missing.map((entry) => entry.id).join(", ")}`)),
    Effect.map(({ harnesses }) => harnesses),
    Effect.provide(NodeServices.layer)
  )
