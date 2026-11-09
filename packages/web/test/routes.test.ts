import { describe, expect, it } from "vitest"
import { parseShellRoute, shellHref, type ShellRoute } from "../src/routes.ts"

describe("shell URL selection", () => {
  it.each([
    ["/#/", { page: "home" }],
    ["/?page=alerts", { page: "service", service: "alerts" }],
    ["/?page=settings", { page: "service", service: "settings" }],
    ["/#/thread/worker%20one?subject=board%3Apost-42", { page: "thread", agentId: "worker one", subject: "board:post-42" }],
    ["/thread/worker?subject=question%3Aq-1", { page: "thread", agentId: "worker", subject: "question:q-1" }],
    ["/#/repository/repo/design", { page: "repository", repoId: "repo", tab: "design" }],
    ["/#/project/garden/team/build/tasks?workspace=branch%2Fone", { page: "project", projectId: "garden", teamId: "build", tab: "tasks", workspaceId: "branch/one" }],
    ["/#/project/garden/task/t1", { page: "task", projectId: "garden", taskId: "t1" }],
    ["/#/project/garden/sprint/s1", { page: "sprint", projectId: "garden", sprintId: "s1" }],
  ])("parses %s and preserves its selection through a generated hash", (url, expected) => {
    const route = parseShellRoute(url)
    expect(route).toEqual(expected)
    expect(parseShellRoute(shellHref(route))).toEqual(expected)
  })
  it.each(["/#/thread/%E0%A4%A", "/#/thread/%00", "/#/thread/worker/extra", "/#/project/p/team/", "/#/project/p/tasks", "/#/service/unknown", "/#/repository/r/design/extra", "/#/project/p?workspace=", "/#/thread/a?subject=%00"]) ("refuses malformed address %s without throwing", (url) => {
    expect(parseShellRoute(url)).toEqual({ page: "invalid" })
  })
  it("keeps scoped identifiers distinct even when they contain URL delimiters", () => {
    const route = { page: "project", projectId: "p/1", teamId: "t?1", workspaceId: "w#1", tab: "git" } as ShellRoute
    expect(parseShellRoute(shellHref(route))).toEqual(route)
  })
})
