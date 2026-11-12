import { environment, mount, resetData } from "./page-fixtures.tsx"
import * as Effect from "effect/Effect"
import type { Client } from "@lgtm/client/browser"
import { beforeEach, expect, it, vi } from "vitest"
import { readBoard, useProjectBoard } from "../src/pages/projectData.ts"

beforeEach(resetData)
it("scoped board recovery pages actual DTOs and rejects a nonadvancing cursor or revision change", async () => {
  const section = environment.data.snapshot!.project!
  const sequence = vi.fn(() => Effect.succeed({ sequence: 12 }))
  const read = vi.fn<(payload: { collection: string; after?: string }) => Effect.Effect<{ items: readonly unknown[]; next?: string }>>(({ collection, after }) => Effect.succeed(collection === "sprints" ? { items: section.sprints } : after === undefined ? { items: section.tasks, next: "next" } : { items: [] }))
  const client = { "client.sequence": sequence, "project.read": read } as unknown as Client
  const result = await Effect.runPromise(readBoard(client, section.projects[0]!.projectId))
  expect(result.tasks).toEqual(section.tasks)
  expect(read.mock.calls.filter(([payload]) => payload.collection === "tasks")).toHaveLength(2)
  read.mockImplementation(() => Effect.succeed({ items: section.tasks, next: "same" }))
  await expect(Effect.runPromise(readBoard(client, section.projects[0]!.projectId))).rejects.toThrow()
  read.mockImplementation(({ collection }) => Effect.succeed({ items: collection === "tasks" ? section.tasks : section.sprints }))
  sequence.mockReturnValueOnce(Effect.succeed({ sequence: 12 })).mockReturnValueOnce(Effect.succeed({ sequence: 13 }))
  await expect(Effect.runPromise(readBoard(client, section.projects[0]!.projectId))).rejects.toThrow()
})

it("a transient read failure retains the last coherent board and disables mutations at the stale revision", async () => {
  const section = environment.data.snapshot!.project!
  environment.data = { ...environment.data, snapshot: { ...environment.data.snapshot!, project: { ...section, truncated: true } } }
  environment.client["client.sequence"] = () => Effect.succeed({ sequence: 12 })
  environment.client["project.read"] = ({ collection }: { collection: string }) => Effect.succeed({ items: collection === "tasks" ? section.tasks : section.sprints })
  function Probe() { const state = useProjectBoard(section.projects[0]!.projectId); return <div>{state.data?.tasks.map((row) => row.title).join(",")} · {state.ready ? "Ready" : "Read only"}</div> }
  const { container, render } = await mount(<Probe />)
  await vi.waitFor(() => expect(container.textContent).toContain("Implement page · Ready"))
  environment.client["project.read"] = () => Effect.fail({ _tag: "ClientError" })
  environment.data = { ...environment.data, snapshot: { ...environment.data.snapshot!, sequence: 13 as never } }
  await render(<Probe />)
  await vi.waitFor(() => expect(container.textContent).toContain("Implement page · Read only"))
})
