import { click, environment, mount, questionEvent, request, resetData } from "./page-fixtures.tsx"
import { act } from "react"
import * as Effect from "effect/Effect"
import { beforeEach, expect, it, vi } from "vitest"
import { AddTask, clearAddTaskAttempts } from "../src/pages/AddTask.tsx"
import { HomePage } from "../src/pages/HomePage.tsx"
import { SprintPage } from "../src/pages/SprintPage.tsx"
import { TaskPage, EvidenceText } from "../src/pages/TaskPage.tsx"
import { ProjectPage } from "../src/pages/ProjectPage.tsx"

beforeEach(resetData)
const board = () => environment.data.snapshot!.project!

it("Home sorts owner requests oldest first, places real failures first, and keeps held requests out of owner counts", async () => {
  const data = environment.data
  environment.data = { ...data, snapshot: { ...data.snapshot!, agents: [{ ...data.snapshot!.agents[0]!, startFailure: "not-signed-in" }] },
    requests: [request({ id: "new", openedAt: 200 }), request({ id: "held", holder: { _tag: "agent", agentId: "worker" }, canAnswer: false }), request({ id: "old", openedAt: 100 })] }
  const { container } = await mount(<HomePage route={{ page: "home" }} />)
  expect([...container.querySelectorAll("[data-home-item]")].map((row) => row.getAttribute("data-home-item"))).toEqual(["question:old", "question:new"])
  expect(container.querySelector(".failed-start-list")!.compareDocumentPosition(container.querySelector(".request-list")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(container.querySelector('[role="tab"][aria-selected=true]')!.textContent).toContain("3")
  expect(container.querySelectorAll("time.is-long")).toHaveLength(2)
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2]!.click())
  expect(location.hash).toContain("view=questions")
})

it("Home retains durable answered outcome and answer time, and a project row uses real route identities", async () => {
  const row = request({ status: "answered", answeredAt: 1_700_000_000_000, answer: "Recorded direction", canAnswer: false, closedSequence: 11 })
  environment.data = { ...environment.data, requests: [row] }
  environment.client["client.event"] = ({ sequence }: { sequence: number }) => Effect.succeed({ envelope: sequence === 10 ? questionEvent() : { ...questionEvent(), sequence: 11, event: { _tag: "QuestionAnswered", agentId: "worker", questionId: "question", text: "Recorded direction", answeredBy: { _tag: "owner" } } } })
  history.replaceState({}, "", "/#/?view=questions")
  const { container } = await mount(<HomePage route={{ page: "home" }} />)
  expect(container.textContent).toContain("No open requests.")
  expect(container.querySelector<HTMLDetailsElement>(".home-answered")!.open).toBe(false)
  expect(container.querySelector("time")!.dateTime).toBe(new Date(row.answeredAt!).toISOString())
  await act(async () => (container.querySelector("[data-home-item]") as HTMLButtonElement).click())
  await vi.waitFor(() => expect(container.textContent).toContain("Recorded direction"))
  await act(async () => container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click())
  expect(container.querySelector('.project-table a')!.getAttribute("href")).toBe("/#/project/p/board")
})

it("Sprint blockers precede the goal and completed sprints do not offer Add task or empty evidence", async () => {
  environment.data = { ...environment.data, requests: [request()] }
  environment.client["client.event"] = () => Effect.succeed({ envelope: questionEvent() })
  const { container, render } = await mount(<SprintPage route={{ page: "sprint", projectId: board().projects[0]!.projectId, sprintId: board().sprints[0]!.sprintId }} />)
  await vi.waitFor(() => expect(container.textContent).toContain("Choose a plan"))
  const blocker = container.querySelector(".detail-blockers")!
  expect(blocker.compareDocumentPosition(container.querySelector(".sprint-detail>.agent-data, .sprint-detail>div>.agent-data")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(container.querySelector("script")).toBeNull()
  expect(container.textContent).not.toContain("Completion evidence")
  const value = environment.data.snapshot!
  environment.data = { ...environment.data, snapshot: { ...value, project: { ...value.project!, sprints: [{ ...value.project!.sprints[0]!, completion: "Merged", evidence: "[Task](task:task)", completedAt: 5000 }] } } }
  await render(<SprintPage route={{ page: "sprint", projectId: board().projects[0]!.projectId, sprintId: board().sprints[0]!.sprintId }} />)
  expect(container.textContent).toContain("Completion evidence")
  expect(container.textContent).toContain("Release status is tracked separately")
  expect(container.querySelector('.detail-section .evidence-text a')!.getAttribute("href")).toBe("/#/project/p/task/task")
  expect([...container.querySelectorAll(".section-heading button")].some((row) => row.textContent === "Add task")).toBe(false)
})

it("Task history shows durable times, task-specific approvals, and safe links only to actual targets", async () => {
  const row = request({ kind: "permission", id: "approval", display: { preview: "Allow action", options: [], optionCount: 0, bytes: 1 } })
  environment.data = { ...environment.data, requests: [row] }
  environment.client["client.sequence"] = () => Effect.succeed({ sequence: 12 })
  environment.client["project.task.history"] = () => Effect.succeed({ items: [{ sequence: 10, at: 123_000, title: "Approval requested", detail: "[Task](task:task) <img src=x>", state: "blocked" }] })
  environment.client["client.event"] = () => Effect.fail({ _tag: "ClientError" })
  const { container } = await mount(<TaskPage route={{ page: "task", projectId: board().projects[0]!.projectId, taskId: board().tasks[0]!.taskId }} />)
  await vi.waitFor(() => expect(container.querySelector(".task-timeline time")!.getAttribute("datetime")).toBe(new Date(123_000).toISOString()))
  expect(container.textContent).toContain("Blocked by an approval")
  expect(container.querySelector('.task-timeline a')!.getAttribute("href")).toBe("/#/project/p/task/task")
  expect(container.querySelector("img")).toBeNull()
  const evidence = await mount(<EvidenceText text="[Bad](task:missing) [Unsafe](https://example.com)" projectId={board().projects[0]!.projectId} board={board()} />)
  expect(evidence.container.querySelector("a")).toBeNull()
})

it("task work and handoff use supplied durable times and the actual answered question outcome", async () => {
  const value = environment.data.snapshot!
  const task = value.project!.tasks[0]!
  const event = questionEvent().event
  if (event._tag !== "QuestionAsked") throw new Error("Expected a question fixture")
  environment.data = { ...environment.data, snapshot: { ...value, project: { ...value.project!, tasks: [{ ...task, story: { summary: "Work summary", done: [], activity: [
    { title: "Handed over", detail: "[Sprint](sprint:s)", at: 12000 },
    { question: event.questionId, at: 1, open: { title: "Waiting", detail: "Need direction" }, answered: { title: "Direction received", detail: "Apply owner direction" } }
  ] } }] } }, requests: [request({ status: "answered", answeredAt: 34000, canAnswer: false })] }
  environment.client["client.sequence"] = () => Effect.succeed({ sequence: 12 })
  environment.client["project.task.history"] = () => Effect.succeed({ items: [] })
  const { container } = await mount(<TaskPage route={{ page: "task", projectId: task.projectId, taskId: task.taskId }} />)
  expect(container.querySelector(".story-timeline")!.textContent).toContain("Direction received")
  expect([...container.querySelectorAll<HTMLTimeElement>(".story-timeline time")].map((row) => row.dateTime)).toEqual([new Date(12000).toISOString(), new Date(34000).toISOString()])
  expect(container.querySelector(".story-timeline a")!.getAttribute("href")).toBe("/#/project/p/sprint/s")
})

it("Add task reuses an uncertain command after unmount, and only a confirmed receipt opens its task", async () => {
  const create = vi.fn().mockReturnValueOnce(Effect.fail({ _tag: "ClientError" })).mockReturnValue(Effect.succeed({ taskId: "created-task" }))
  environment.client["project.task.create"] = create
  const created = vi.fn()
  const props = { project: board().projects[0]!, board: board(), open: true, onClose: vi.fn(), onCreated: created }
  const { container, render } = await mount(<AddTask {...props} />)
  const title = container.querySelector<HTMLInputElement>('input[name="title"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "A real task")
    title.dispatchEvent(new Event("input", { bubbles: true }))
  })
  // React's controlled input change is driven through its native change event.
  await act(async () => title.dispatchEvent(new Event("change", { bubbles: true })))
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(created).not.toHaveBeenCalled()
  const first = create.mock.calls[0]![0]
  await render(<div />)
  await render(<AddTask {...props} />)
  expect(container.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe("A real task")
  await click(container, "Retry Add task")
  await vi.waitFor(() => expect(created).toHaveBeenCalledWith("created-task"))
  expect(create.mock.calls[1]![0]).toEqual(first)
})

it("A board uses engine sprint status and never offers empty progress bars", async () => {
  const { container } = await mount(<ProjectPage route={{ page: "project", projectId: board().projects[0]!.projectId, tab: "board" }} />)
  expect(container.querySelector('[aria-label="In progress"] [data-sprint="s"]')).not.toBeNull()
  expect(container.querySelector("progress")).toBeNull()
  expect(container.querySelector('[aria-current="step"]')!.textContent).toBe("Build")
})

it.each(["failed", "sending"] as const)("session end drops an unconfirmed %s Add task draft and ignores its old receipt", async (status) => {
  let settle: (() => void) | undefined
  const create = vi.fn(() => status === "failed" ? Effect.fail({ _tag: "ClientError" })
    : Effect.promise(() => new Promise<{ taskId: string }>((resolve) => { settle = () => resolve({ taskId: "old-session-task" }) })))
  environment.client["project.task.create"] = create
  const created = vi.fn()
  const props = { project: board().projects[0]!, board: board(), open: true, onClose: vi.fn(), onCreated: created }
  const { container, render } = await mount(<AddTask {...props} />)
  const title = container.querySelector<HTMLInputElement>('input[name="title"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Private old session draft")
    title.dispatchEvent(new Event("input", { bubbles: true }))
    title.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  await render(null)
  clearAddTaskAttempts()
  await render(<AddTask {...props} />)
  expect(container.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe("")
  expect(container.textContent).not.toContain("Retry Add task")
  await act(async () => settle?.())
  expect(created).not.toHaveBeenCalled()
  expect(container.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe("")
})
