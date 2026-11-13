import { createHash } from "node:crypto"
import { ChannelId, type BoardAddressee, type BoardView, type Event, type Project } from "@lgtm/contracts"
import * as Schema from "effect/Schema"
import type { Snapshot } from "../commands/internal.ts"
import { own, projectView } from "./view.ts"

// Stable keys identify the channels after a rename and across engine starts.
// The owner can change the initial set and its membership rules here.
export const defaultProjectChannels = [
  { key: "general", name: "General", audience: "project" },
  { key: "leads", name: "Leads", audience: "team-leads" },
] as const

type Opened = Extract<Event, { _tag: "board.ChannelOpened" }>
export const openDefaultProjectChannels = (project: Pick<Project, "projectId" | "leadAgentId">): ReadonlyArray<Opened> =>
  defaultProjectChannels.map(({ key, name }) => ({
    _tag: "board.ChannelOpened", channelId: Schema.decodeUnknownSync(ChannelId)(`project-default:${createHash("sha256").update(JSON.stringify([project.projectId, key])).digest("hex")}`),
    name, kind: "plain", opener: { _tag: "owner" }, manager: { _tag: "owner" }, anchorAgentId: project.leadAgentId,
    members: [{ _tag: "owner" }, { _tag: "agent", agentId: project.leadAgentId }],
  }))

// The board reactor calls this under the writer permit, on startup and after
// project membership changes. It appends facts without rewriting old events.
export const defaultProjectChannelEvents = (snapshot: Snapshot): ReadonlyArray<Event> => {
  const view = projectView(snapshot), board = snapshot.board as BoardView
  const events: Event[] = []
  for (const project of Object.values(view.projects)) {
    for (const [index, opened] of openDefaultProjectChannels(project).entries()) {
      const channel = own(board.channels, opened.channelId)
      // A pre-existing unrelated channel must never acquire project members.
      if (channel !== undefined && (channel.kind !== "plain" || channel.anchorAgentId !== project.leadAgentId)) continue
      const members: BoardAddressee[] = [{ _tag: "owner" }, { _tag: "agent", agentId: project.leadAgentId }]
      for (const agent of Object.values(snapshot.agents)) {
        if (agent.agentId === project.leadAgentId || own(view.agentProjects, agent.agentId) !== project.projectId) continue
        if (defaultProjectChannels[index]!.audience === "project" || agent.role === "team-lead"
          && Object.values(view.teams).some((team) => team.projectId === project.projectId && team.group !== undefined && agent.groups.includes(team.group))) {
          members.push({ _tag: "agent", agentId: agent.agentId })
        }
      }
      if (channel === undefined) events.push({ ...opened, members })
      else {
        const membersAdded = members.filter((member) => !channel.members.some((existing) => member._tag === existing._tag
          && (member._tag === "owner" || existing._tag === "agent" && member.agentId === existing.agentId)))
        if (membersAdded.length > 0) events.push({ _tag: "board.ChannelMembersChanged", channelId: channel.channelId, membersAdded, membersRemoved: [] })
      }
    }
  }
  return events
}
