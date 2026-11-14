import { expect, it } from "vitest"
import { mapInstalledHarnesses } from "../src/git.ts"
import { HarnessId, HarnessInstallation, HarnessRecipe } from "@lgtm/contracts"
import * as Schema from "effect/Schema"

it("keeps missing harnesses visible, preserves reported choices, and quotes the actual sign-in executable", () => {
  const recipe = Schema.decodeUnknownSync(HarnessRecipe)({ harnessId: "codex", name: "Codex", automatic: true, packages: ["@openai/codex@0.166.0"], commands: ["fixed command"], registry: "https://registry.npmjs.org", source: "https://learn.chatgpt.com/docs/codex/cli", signInCommand: "codex login", signInArguments: ["login"] })
  const statuses = Schema.decodeUnknownSync(Schema.Array(HarnessInstallation))([{ harnessId: "codex", installed: true, path: "/home/owner's folder/codex", version: "1.2.3" }, { harnessId: "gemini", installed: false }])
  const result = mapInstalledHarnesses({ codex: { name: Schema.decodeUnknownSync(HarnessId)("codex"), runMode: "ACP", models: ["reported"], efforts: ["high"], noEffort: [] } }, statuses, [recipe])
  expect(result.codex).toMatchObject({ name: "Codex", installed: true, models: ["reported"], version: "1.2.3", signInCommand: "'/home/owner'\\''s folder/codex' 'login'" })
  expect(result.gemini).toMatchObject({ installed: false, models: [], efforts: [] })
})
