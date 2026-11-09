import type { ReachInput } from "../routing/reach.ts"
import { own, projectKey, projectView } from "./view.ts"
export const mockApprovalSource = (projectId: string, approvalId: string, revisionId: string) => JSON.stringify(["mock-approval", projectId, approvalId, revisionId])
// Valid at admission and at later dispatch, where the caller is absent.
export const mockReach = ({ snapshot, source, target, deliveryId, caller }: ReachInput): boolean => {
  if (source.namespace !== "project" || caller !== undefined && caller._tag !== "owner") return false
  const view = projectView(snapshot)
  const approval = Object.values(view.mockApprovals).find((row) => mockApprovalSource(row.projectId, row.approvalId, row.revisionId) === source.id)
  if (approval === undefined || approval.leadAgentId !== target || own(view.mockHeads, approval.projectId) !== approval.revisionId) return false
  const project = own(view.projects, approval.projectId), revision = own(view.mockRevisions, projectKey(approval.projectId, approval.revisionId))
  if (project?.leadAgentId !== target || project.archiving || project.archivedAt !== undefined || revision === undefined) return false
  const delivery = own(snapshot.deliveries, deliveryId)
  if (delivery !== undefined && (delivery.target !== target || delivery.source?._tag !== "piece"
    || delivery.source.namespace !== "project" || delivery.source.id !== source.id)) return false
  // A second delivery cannot reuse an approved source, even under another id.
  return !Object.values(snapshot.deliveries).some((row) => row.id !== deliveryId && row.source?._tag === "piece"
    && row.source.namespace === "project" && row.source.id === source.id)
}
