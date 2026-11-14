import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { SecretStore } from "../commands/SecretStore.ts"
import * as Layer from "effect/Layer"
import { Runner, RunnerRejected } from "../runner/Runner.ts"
import { validateManagedProgram } from "./programs.ts"
export const guardedRunner = (runner: Runner["Service"], options: { home: string; stateFolder: string; resolveSecret?: SecretStore["Service"]["resolve"] }): Runner["Service"] => {
  const guard = (input: Parameters<Runner["Service"]["start"]>[0]) => Effect.gen(function* () {
    const paths = [input.harness.adapterPath]
    for (const name of ["CODEX_PATH", "CLAUDE_CODE_EXECUTABLE"]) {
      const raw = input.account.environment?.[name]
      if (!raw) continue
      if (raw.startsWith("secret:")) {
        if (!options.resolveSecret) return yield* new RunnerRejected({ reason: "The executable override could not be read." })
        const value = yield* options.resolveSecret(raw)
        if (value) paths.push(Redacted.value(value))
      } else paths.push(raw)
    }
    yield* Effect.try({ try: () => { for (const path of paths) validateManagedProgram(options.home, path, options.stateFolder) },
      catch: () => new RunnerRejected({ reason: "The harness executable changed since install." }) })
  })
  return { ...runner,
    discover: (input) => guard(input).pipe(Effect.flatMap(() => runner.discover(input))),
    start: (input) => guard(input).pipe(Effect.flatMap(() => runner.start(input))),
    load: (input) => guard(input).pipe(Effect.flatMap(() => runner.load(input))) }
}
export const layer = (options: { home: string; stateFolder: string }) => Layer.effect(Runner, Effect.gen(function* () {
  const secrets = yield* SecretStore
  return guardedRunner(yield* Runner, { ...options, resolveSecret: secrets.resolve })
}))
