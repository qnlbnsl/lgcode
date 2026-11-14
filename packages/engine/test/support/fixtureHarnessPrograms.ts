import { existsSync } from "node:fs"
import type { HarnessPrograms, InstallStep } from "../../src/harnesses/programs.ts"
import { quoteCommand, runRecipe } from "../../src/harnesses/programs.ts"
import type { HarnessInstallation, HarnessRecipe } from "@lgtm/contracts"
// The fake is a complete dependency of the test engine. Production recipes
// contain no test steps or configured-path exception.
export const fixtureHarnessPrograms = (options: { home: string; executable: string; script: string; id?: string; name?: string; version?: string }): HarnessPrograms => {
  const id = options.id ?? "first", step: InstallStep = { executable: process.execPath, args: [options.script] }
  return {
    ids: [id],
    recipe: (key) => key !== id ? undefined : ({ harnessId: id as HarnessRecipe["harnessId"], name: options.name ?? "Fixture", automatic: true,
      packages: ["fixture@1.2.3"], registry: "https://example.test", source: "https://example.test/install", commands: [quoteCommand([step.executable, ...step.args])],
      signInCommand: quoteCommand([options.executable, "login"]), signInArguments: ["login"] }),
    inspect: async (key) => ({ harnessId: key as HarnessInstallation["harnessId"], installed: existsSync(options.executable),
      ...(existsSync(options.executable) ? { path: options.executable, version: options.version ?? "1.2.3" } : {}) }),
    install: (_, signal) => runRecipe([step], { home: options.home, timeoutMs: 2000, signal }), defaultSettings: () => undefined
  }
}
