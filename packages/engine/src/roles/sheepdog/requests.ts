// Encoding each component keeps ids unambiguous even for agent ids containing
// colons. The same decision always produces the same command and record ids.
export interface ActionIdentity {
  readonly rule: string;
  readonly subject: string;
  readonly triggerSequence: number;
  readonly kind: string;
  readonly recipient: string;
  readonly occurrence: number;
}
// One top agent can belong to several idle groups at the same log position.
// Keep those decisions separate, including when their notices are rerouted.
export const actionSubject = (action: { readonly _tag: string; readonly agentId: string; readonly group?: string; readonly stalledPostId?: string }): string =>
  action._tag === "roles.TeamIdleReported" ? JSON.stringify([action.agentId, action.group]) : action.stalledPostId === undefined ? action.agentId : JSON.stringify([action.agentId, action.stalledPostId]);
export const actionRequestId = (action: ActionIdentity): string => [
  "roles", action.rule, action.subject, String(action.triggerSequence), action.kind, action.recipient, String(action.occurrence),
].map(encodeURIComponent).join(":");
export const baselineRequestId = (sequence?: number): string => sequence === undefined ? "roles:baseline" : `roles:baseline:${sequence}`;
