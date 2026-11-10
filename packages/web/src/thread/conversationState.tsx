import type { Client } from "@lgcode/client/browser"
import type { AgentId, ChannelId, ContextReference, EventSequence, PostId, ProjectId, RequestId, TeamId, WorkspaceId } from "@lgcode/contracts"

export type ConversationIdentity =
  | { readonly _tag: "agent"; readonly agentId: AgentId }
  | { readonly _tag: "team"; readonly projectId: ProjectId; readonly teamId: TeamId; readonly channelId: ChannelId }
  | { readonly _tag: "board"; readonly postId: PostId }
export interface ContextScope {
  readonly projectId: ProjectId
  readonly worktreeId: WorkspaceId
  readonly teamId?: TeamId
}
export const conversationKey = (identity: ConversationIdentity) => identity._tag === "agent"
  ? JSON.stringify([identity._tag, identity.agentId])
  : identity._tag === "team" ? JSON.stringify([identity._tag, identity.projectId, identity.teamId, identity.channelId])
    : JSON.stringify([identity._tag, identity.postId])
export const referenceKey = (ref: ContextReference) => ref._tag === "task" ? JSON.stringify([ref._tag, ref.projectId, ref.taskId])
  : JSON.stringify([ref._tag, ref.projectId, ref.repoId, ref.worktreeId, ref.path])
export interface SelectedContext { readonly reference: ContextReference; readonly label: string }
export type SendPayload = { readonly requestId: RequestId; readonly text: string; readonly context?: ReadonlyArray<ContextReference> } & (
  | { readonly agentId: AgentId }
  | { readonly channelId: ChannelId; readonly to: readonly []; readonly reply: "none" }
)
export interface ConversationState {
  readonly draft: string
  readonly context: ReadonlyArray<SelectedContext>
  readonly status: "ready" | "sending" | "uncertain"
  readonly attempt?: SendPayload | undefined
  readonly message: string
  readonly configurationAttempt?: { readonly requestId: RequestId; readonly model?: string; readonly effort?: string; readonly status: "sending" | "uncertain" } | undefined
  readonly configurationMessage?: string | undefined
  readonly cancelAttempt?: { readonly requestId: RequestId; readonly sentSequence: number; readonly status: "sending" | "uncertain" | "waiting" } | undefined
  readonly cancelMessage?: string | undefined
  readonly lifecycleAttempt?: { readonly action: "stop" | "resume"; readonly payload: { readonly requestId: RequestId; readonly agentId: AgentId; readonly fresh?: true }; readonly status: "sending" | "uncertain" } | undefined
  readonly lifecycleMessage?: string | undefined
  readonly boardAttempt?: { readonly payload: Extract<Parameters<Client["board.post"]>[0], { readonly channelId: ChannelId }> & { readonly replyTo: PostId }; readonly after?: EventSequence; readonly status: "sending" | "uncertain" } | undefined
  readonly boardReplyId?: PostId | undefined
  readonly boardMessage?: string | undefined
  readonly reading?: { readonly sequence?: number; readonly offset: number; readonly bottom: boolean }
  readonly historyCount: number
}
const empty = (): ConversationState => ({ draft: "", context: [], status: "ready", message: "", historyCount: 100 })
export class ConversationEntry {
  state: ConversationState = empty()
  private active = true
  private readonly listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly snapshot = () => this.state
  update(change: Partial<ConversationState>) {
    if (!this.active) return
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }
  clear() {
    this.active = false
    this.state = empty()
    for (const listener of this.listeners) listener()
  }
}
// One instance belongs to one authenticated App mount. Navigation retains it;
// logout, expiry, App unmount and a fresh document discard it. No browser store.
export class ConversationSession {
  readonly controller = new AbortController()
  private readonly entries = new Map<string, ConversationEntry>()
  entry(identity: ConversationIdentity) {
    const key = conversationKey(identity)
    let entry = this.entries.get(key)
    if (entry === undefined) { entry = new ConversationEntry(); this.entries.set(key, entry) }
    return entry
  }
  dispose() {
    this.controller.abort()
    for (const entry of this.entries.values()) entry.clear()
    this.entries.clear()
  }
}
