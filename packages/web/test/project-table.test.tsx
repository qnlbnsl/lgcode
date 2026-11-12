import { act } from "react"
import * as Schema from "effect/Schema"
import { Project } from "@lgtm/contracts"
import { beforeEach, expect, it } from "vitest"
import { environment, mount, request, resetData } from "./page-fixtures.tsx"
import { HomePage, ProjectTable } from "../src/pages/HomePage.tsx"
import { RepositoryPage } from "../src/pages/RepositoryPage.tsx"

beforeEach(resetData)
const project = () => environment.data.navigation!.projects[0]!
const headers = (container: HTMLElement) => [...container.querySelectorAll("th")].map((cell) => cell.textContent)

it("Home shows the repository separately and preserves project, lead and branch identities", async () => {
  history.replaceState({}, "", "/#/?view=projects")
  const { container } = await mount(<HomePage route={{ page: "home" }} />)
  expect(headers(container)).toEqual(["Project", "Repository", "Lead", "Stage", "Machine", "Status", "Branch"])
  const cells = container.querySelector("tbody tr")!.children
  expect([...cells].map((cell) => cell.textContent)).toEqual(["Real project", "Repository", "Worker", "Build", "local", "Ready", "feature"])
  expect(cells[0]!.querySelector("a")!.getAttribute("href")).toBe("/#/project/p/board")
  expect(cells[2]!.querySelector("a")!.getAttribute("href")).toBe("/#/thread/worker")
  expect(cells[6]!.querySelector("code")!.title).toBe("feature")
})

it("Repository projects keeps the same stage and lead cells while excluding another repository", async () => {
  const navigation = environment.data.navigation!
  const other = Schema.decodeUnknownSync(Project)({ ...project(), projectId: "other-project", repoId: "other-repository", name: "Other project" })
  environment.data = { ...environment.data, navigation: { ...navigation, projects: [...navigation.projects, other],
    repositories: [...navigation.repositories, { ...navigation.repositories[0]!, repoId: other.repoId, name: "Other repository" }] } }
  const { container } = await mount(<RepositoryPage route={{ page: "repository", repoId: project().repoId }} />)
  expect(headers(container)).toEqual(["Project", "Lead", "Stage", "Machine", "Status", "Branch"])
  expect(container.querySelectorAll("tbody tr")).toHaveLength(1)
  expect(container.textContent).not.toContain("Other project")
  expect([...container.querySelector("tbody tr")!.children].map((cell) => cell.textContent)).toEqual(["Real project", "Worker", "Build", "local", "Ready", "feature"])
})

it.each([
  ["design", "Design"], ["plan", "Plan"], ["build", "Build"], ["review", "Review"], ["handover", "Hand over"], [undefined, "Not started"]
] as const)("shows the stored %s stage with its visible label %s", async (stage, label) => {
  const { stage: previous, ...unstaged } = project()
  const row = Schema.decodeUnknownSync(Project)({ ...unstaged, ...(stage === undefined ? {} : { stage }) })
  const { container } = await mount(<ProjectTable projects={[row]} />)
  expect(container.querySelector(".stage-cell")!.textContent).toBe(label)
})

it("a failed project member needs attention, and resolved or held requests stop counting", async () => {
  const value = environment.data.snapshot!
  environment.data = { ...environment.data, snapshot: { ...value, agents: [{ ...value.agents[0]!, startFailure: "not-signed-in" }] },
    requests: [request({ id: "held", holder: { _tag: "agent", agentId: "worker" } }), request({ id: "closed", status: "answered" })] }
  const { container, render } = await mount(<ProjectTable projects={[project()]} />)
  expect(container.querySelector(".stack-status")!.textContent).toBe("Needs attention")
  expect(container.textContent).not.toContain("Failed start")
  environment.data = { ...environment.data, requests: [...environment.data.requests!, request()] }
  await render(<ProjectTable projects={[project()]} />)
  expect(container.querySelector(".stack-status")!.textContent).toBe("Needs attention · 1")
  environment.data = { ...environment.data, snapshot: value, requests: [] }
  await render(<ProjectTable projects={[project()]} />)
  expect(container.querySelector(".stack-status")!.textContent).toBe("Ready")
})

it("archived state wins over old failures and live stage updates stay plain text", async () => {
  const value = environment.data.snapshot!
  environment.data = { ...environment.data, snapshot: { ...value, agents: [{ ...value.agents[0]!, startFailure: "not-signed-in" }] }, requests: [request()] }
  const name = "<img src=x onerror=alert(1)>"
  const row = Schema.decodeUnknownSync(Project)({ ...project(), name, archivedAt: 100 })
  const { container, render } = await mount(<ProjectTable projects={[row]} />)
  expect(container.querySelector(".stack-status")!.textContent).toBe("Archived")
  expect(container.querySelector(".project-attention-status")).toBeNull()
  expect(container.querySelector("img")).toBeNull()
  expect(container.querySelector("tbody a")!.textContent).toBe(name)
  await render(<ProjectTable projects={[{ ...row, archiving: true, stage: "handover" }]} />)
  expect(container.querySelector(".stack-status")!.textContent).toBe("Archiving")
  expect(container.querySelector(".stage-cell")!.textContent).toBe("Hand over")
  await act(async () => container.querySelector<HTMLAnchorElement>("tbody a")!.focus())
  expect(document.activeElement).toBe(container.querySelector("tbody a"))
})
