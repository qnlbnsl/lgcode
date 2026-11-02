import { delimiter, isAbsolute, join, resolve } from "node:path"
import { HarnessId, type HarnessSettings } from "@shephrd/contracts"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"

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
      harnesses.push({
        id: Schema.decodeUnknownSync(HarnessId)(definition.id), runMode: "acp", adapterPath, adapterArguments: [...definition.args],
        permissionMapping: { "read-only": readOnly, ask, edit, full },
        reportedModes: [], defaultPermission: "ask", models: [], efforts: [], denyReadMechanism: { _tag: "none" }
      })
    }
    return { harnesses, missing }
  })
