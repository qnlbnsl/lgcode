import { useEffect, useRef, useState, type FormEvent } from "react"
import type { Client } from "@lgtm/client/browser"
import type { Project, SprintId, TaskId, TeamId } from "@lgtm/contracts"
import { projectTeamGroup } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"
import { requestId, withClient } from "../thread/client.ts"
import { visibleText } from "../thread/text.tsx"
import type { BoardData } from "./projectData.ts"

type Payload = Parameters<Client["project.task.create"]>[0]
// Preserve an uncertain operation across leaving and reopening its page. Only a
// confirmed receipt releases its command identity. No optimistic task is added.
const pending = new Map<string, Payload>()
let session = 0
export function clearAddTaskAttempts(): void {
  session += 1
  pending.clear()
}
export function AddTask({ project, board, open, teamId, sprintId, onClose, onCreated }: {
  readonly project: Project; readonly board: BoardData; readonly open: boolean
  readonly teamId?: TeamId; readonly sprintId?: SprintId; readonly onClose: () => void; readonly onCreated: (taskId: TaskId) => void
}) {
  const { navigation, snapshot, complete, retry } = useShellData()
  const disabled = useMutationDisabled()
  const dialog = useRef<HTMLDialogElement>(null)
  const controller = useRef<AbortController | undefined>(undefined)
  const attempt = useRef<Payload | undefined>(pending.get(project.projectId))
  const [title, setTitle] = useState(attempt.current?.title ?? "")
  const [team, setTeam] = useState(attempt.current?.teamId ?? teamId ?? navigation?.teams.find((row) => row.projectId === project.projectId)?.teamId ?? "")
  const [sprint, setSprint] = useState(attempt.current?.sprintId ?? sprintId ?? board.sprints.find((row) => row.completion === undefined)?.sprintId ?? "")
  const [owner, setOwner] = useState(attempt.current?.owner ?? project.leadAgentId)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(attempt.current !== undefined)
  const [message, setMessage] = useState(attempt.current === undefined ? "" : "This task's creation is unconfirmed. Retry the same operation to recover its receipt.")
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current?.close()
  }, [open])
  useEffect(() => () => controller.current?.abort(), [])
  const teams = navigation?.teams.filter((row) => row.projectId === project.projectId) ?? []
  const selectedTeam = teams.find((row) => row.teamId === team)
  const workspace = navigation?.workspaces.find((row) => row.worktreeId === selectedTeam?.worktreeId)
  const members = new Set(navigation?.agents.filter((row) => row.projectId === project.projectId).map((row) => row.agentId))
  const owners = snapshot?.agents.filter((agent) => members.has(agent.agentId) && (agent.agentId === project.leadAgentId
    || selectedTeam !== undefined && agent.groups.includes(selectedTeam.group ?? projectTeamGroup(project.projectId, selectedTeam.teamId)))) ?? []
  const sprints = board.sprints.filter((row) => row.completion === undefined)
  const ready = complete && !disabled && !project.archiving && project.archivedAt === undefined
    && selectedTeam !== undefined && workspace !== undefined && owners.some((row) => row.agentId === owner) && sprints.some((row) => row.sprintId === sprint)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (controller.current !== undefined || disabled || !complete || (!uncertain && !ready) || !title.trim()) return
    const operation = new AbortController()
    const operationSession = session
    controller.current = operation
    setBusy(true)
    setMessage("")
    if (attempt.current === undefined) attempt.current = { requestId: requestId(), projectId: project.projectId, title,
      owner, teamId: selectedTeam!.teamId, sprintId: sprints.find((row) => row.sprintId === sprint)!.sprintId,
      worktreeId: selectedTeam!.worktreeId, state: "queue" }
    pending.set(project.projectId, attempt.current)
    void withClient((client) => Effect.result(client["project.task.create"](attempt.current!)), operation.signal).then((result) => {
      if (operation.signal.aborted || operationSession !== session) return
      if (result._tag === "Failure") {
        if (result.failure._tag === "CommandError") {
          pending.delete(project.projectId)
          attempt.current = undefined
          setUncertain(false)
          setMessage("The engine refused this task. Refresh the project and check its team, owner, and incomplete sprint before trying again.")
          retry()
        } else {
          setUncertain(true)
          setMessage("Could not confirm Add task. Retry the same operation to check its receipt.")
        }
        return
      }
      pending.delete(project.projectId)
      attempt.current = undefined
      setUncertain(false)
      setTitle("")
      retry()
      onCreated(result.success.taskId)
    }).catch(() => {
      if (!operation.signal.aborted && operationSession === session) { setUncertain(true); setMessage("Could not confirm Add task. Retry the same operation to check its receipt. The lead is notified by the engine when the task is created.") }
    }).finally(() => { if (!operation.signal.aborted && operationSession === session) { controller.current = undefined; setBusy(false) } })
  }
  return <dialog ref={dialog} className="pages add-task-dialog" aria-labelledby="add-task-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={submit}><h2 id="add-task-title">Add task</h2>
      <fieldset disabled={busy || uncertain || disabled || !complete}>
        <label>Task<input name="title" required maxLength={128} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Team<select value={team} onChange={(event) => setTeam(event.target.value)}>{teams.map((row) => <option key={row.teamId} value={row.teamId}>{visibleText(row.name)}</option>)}</select></label>
        <label>Sprint<select value={sprint} onChange={(event) => setSprint(event.target.value)}>{sprints.map((row) => <option key={row.sprintId} value={row.sprintId}>{visibleText(row.label)} · {visibleText(row.name)}</option>)}</select></label>
        <label>Owner<select value={owner} onChange={(event) => setOwner(event.target.value as typeof owner)}>{owners.map((row) => <option key={row.agentId} value={row.agentId}>{visibleText(row.name)}</option>)}</select></label>
        {workspace !== undefined && <p>Worktree: <code>{visibleText(workspace.path)}</code></p>}
      </fieldset>
      {!teams.length ? <p>No teams are available for this project.</p> : !sprints.length ? <p>No incomplete sprints are available. Completed sprints cannot accept tasks.</p> : !owners.length ? <p>No owners are available for this team.</p> : workspace === undefined ? <p>This team's workspace is unavailable.</p> : null}
      {(project.archiving || project.archivedAt !== undefined) && <p>Restore the project before adding tasks.</p>}
      {message && <p role="alert">{message}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || disabled || !complete || (!uncertain && !ready) || !title.trim()}>{busy ? "Adding…" : uncertain ? "Retry Add task" : "Add task"}</button></footer>
    </form>
  </dialog>
}
