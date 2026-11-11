import type { ReachInput } from "../routing/reach.ts"
import { own, projectKey, projectView } from "./view.ts"

export const taskNotificationSource = (id: string) => `task-notification:${id}`

// This predicate owns only owner-task intents. Mock approval has a separate
// source kind and predicate. Dispatch can have no caller, so the durable intent,
// recorded lead and exact bound delivery are the authorization proof here.
export const taskDeliveryReach = ({ snapshot, source, target, deliveryId }: ReachInput): boolean => {
  if (source.namespace !== "project" || !source.id.startsWith("task-notification:")) return false
  const view = projectView(snapshot)
  const intent = own(view.taskNotifications, source.id.slice("task-notification:".length))
  if (intent === undefined || taskNotificationSource(intent.notificationId) !== source.id || intent.targetAgentId !== target
    || intent.deliveryId !== undefined && intent.deliveryId !== deliveryId) return false
  const project = own(view.projects, intent.projectId)
  if (project === undefined || project.leadAgentId !== target || project.archivedAt !== undefined || project.archiving
    || own(view.tasks, projectKey(intent.projectId, intent.taskId)) === undefined) return false
  const delivery = own(snapshot.deliveries, deliveryId)
  return delivery === undefined || delivery.target === target && delivery.source?._tag === "piece"
    && delivery.source.namespace === "project" && delivery.source.id === source.id
}
