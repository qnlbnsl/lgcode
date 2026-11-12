import type { Client } from "@lgtm/client/browser"
import type { ProjectId, RequestId } from "@lgtm/contracts"
import { requestId } from "../thread/client.ts"

type Attempt = Parameters<Client["project.mocks.approve"]>[0]

// The owner mount owns this object. Leaving Mocks must not replace an uncertain
// approval identity; logout/expiry disposes it with the other session drafts.
export class MockApprovalSession {
  private readonly attempts = new Map<ProjectId, Attempt>()
  private alive = true
  get = (projectId: ProjectId) => this.attempts.get(projectId)
  begin(projectId: ProjectId, revisionId: RequestId): Attempt | undefined {
    if (!this.alive) return undefined
    const attempt = this.attempts.get(projectId) ?? { projectId, revisionId, requestId: requestId() }
    this.attempts.set(projectId, attempt)
    return attempt
  }
  settle(projectId: ProjectId, approvalId: RequestId) {
    if (this.attempts.get(projectId)?.requestId === approvalId) this.attempts.delete(projectId)
  }
  dispose = () => { this.alive = false; this.attempts.clear() }
}
