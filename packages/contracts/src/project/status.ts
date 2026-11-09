import type { Sprint, Task } from "./schema.ts"

export const sprintStatus = (sprint: Pick<Sprint, "completion">, tasks: ReadonlyArray<Pick<Task, "state">>): "done" | "active" | "review" | "planned" =>
  sprint.completion !== undefined ? "done" : tasks.some((task) => task.state === "active" || task.state === "blocked") ? "active"
    : tasks.some((task) => task.state === "review") ? "review" : "planned"
export const projectAgentStatus = (input: { readonly needsOwner: boolean; readonly state: string; readonly tasks: ReadonlyArray<Pick<Task, "state">> }): "Needs you" | "Reviewing" | "Working" | "Ready" =>
  input.needsOwner ? "Needs you" : !["idle", "working"].includes(input.state) ? "Ready" : input.tasks.some((task) => task.state === "review") ? "Reviewing"
    : input.state === "working" || input.tasks.some((task) => task.state === "active") ? "Working" : "Ready"
