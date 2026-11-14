import { createHash } from "node:crypto"
import { ChannelId, PostId, parseRole, type BoardAddressee, type BoardView, type Event, type Project } from "@lgtm/contracts"
import { boardLimits } from "@lgtm/contracts/board/limits"
import { BoardPostText } from "@lgtm/contracts/board/schemas"
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
    if (project.archiving === true || project.archivedAt !== undefined) continue
    for (const [index, opened] of openDefaultProjectChannels(project).entries()) {
      const channel = own(board.channels, opened.channelId)
      // A pre-existing unrelated channel must never acquire project members.
      if (channel !== undefined && (channel.kind !== "plain" || channel.anchorAgentId !== project.leadAgentId)) continue
      const eligible: BoardAddressee[] = [{ _tag: "owner" }]
      // Seat the project lead first, including when it has a legacy role name.
      const lead = own(snapshot.agents, project.leadAgentId)
      const active = (agent: NonNullable<typeof lead>) => agent.state._tag !== "stopped" && agent.state._tag !== "crashed"
      if (lead !== undefined && active(lead)) eligible.push({ _tag: "agent", agentId: lead.agentId })
      for (const agent of Object.values(snapshot.agents)) {
        if (agent.agentId === project.leadAgentId || !active(agent) || own(view.agentProjects, agent.agentId) !== project.projectId) continue
        if (defaultProjectChannels[index]!.audience === "project" || parseRole(agent.role).kind === "lead"
          && Object.values(view.teams).some((team) => team.projectId === project.projectId && team.group !== undefined && agent.groups.includes(team.group))) {
          eligible.push({ _tag: "agent", agentId: agent.agentId })
        }
      }
      const members = [...(channel?.members ?? [])], membersAdded: BoardAddressee[] = [], notices: Event[] = []
      for (const member of eligible) {
        if (members.some((existing) => member._tag === existing._tag
          && (member._tag === "owner" || existing._tag === "agent" && member.agentId === existing.agentId))) continue
        // Removal history survives replay and manual re-additions. A later sync
        // must never reverse a manager's removal, even after a service restart.
        if (member._tag === "agent" && own(own(board.lastMemberLeft, opened.channelId) ?? {}, member.agentId) !== undefined) continue
        const noticeId = Schema.decodeUnknownSync(PostId)(`project-default-full:${createHash("sha256").update(JSON.stringify([opened.channelId, member])).digest("hex")}`)
        // The visible service post also records a skipped automatic admission.
        // Once skipped, admission is left to the owner rather than retried.
        if (own(board.posts, noticeId) !== undefined) continue
        if (members.length >= boardLimits.channelMembers) {
          notices.push({ _tag: "board.PostWritten", postId: noticeId, channelId: opened.channelId,
            author: { _tag: "service", service: "board" }, to: [], reply: "none",
            text: Schema.decodeUnknownSync(BoardPostText)(`Automatic membership skipped for ${member._tag === "agent" ? member.agentId : "owner"}: this channel has reached its ${boardLimits.channelMembers}-member limit. The owner can make room and add the member manually.`) })
          continue
        }
        members.push(member)
        membersAdded.push(member)
      }
      if (channel === undefined) events.push({ ...opened, members })
      else if (membersAdded.length > 0) events.push({ _tag: "board.ChannelMembersChanged", channelId: channel.channelId, membersAdded, membersRemoved: [] })
      events.push(...notices)
    }
  }
  return events
}
