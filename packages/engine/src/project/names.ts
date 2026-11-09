import { ProjectName, type Project } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { refused, type Input } from "../commands/internal.ts"
import { projectView } from "./view.ts"
export const cleanName = (input: Input, name: string) => Effect.gen(function* () {
  const result = (yield* input.runtime.log.redactText(name)).trim()
  if (!Schema.is(ProjectName)(result)) return yield* refused("name is invalid after redaction")
  return result
})
export const duplicateName = (input: Input, project: Pick<Project, "repoId" | "machineId" | "name">, except?: string) =>
  Object.values(projectView(input.snapshot).projects).some((row) => row.projectId !== except && row.repoId === project.repoId
    && row.machineId === project.machineId && row.name.toLowerCase() === project.name.toLowerCase())
  || Object.values(projectView(input.snapshot).creations).some((row) => row.projectId !== except && row.repository.repoId === project.repoId
    && row.workspace.machineId === project.machineId && row.name.toLowerCase() === project.name.toLowerCase())
