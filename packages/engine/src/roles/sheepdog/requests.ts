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
// Only canonical action ids identify committed automatic effects on replay.
export const parseActionRequestId = (id: string): ActionIdentity | undefined => {
  try {
    const parts = id.split(":").map(decodeURIComponent);
    if (parts.length !== 7 || parts[0] !== "roles") return;
    const action = { rule: parts[1]!, subject: parts[2]!, triggerSequence: Number(parts[3]), kind: parts[4]!,
      recipient: parts[5]!, occurrence: Number(parts[6]) };
    if (!Number.isSafeInteger(action.triggerSequence) || action.triggerSequence < 1
      || !Number.isSafeInteger(action.occurrence) || action.occurrence < 1 || actionRequestId(action) !== id) return;
    return action;
  } catch { return; }
};
export const baselineRequestId = (sequence?: number): string => sequence === undefined ? "roles:baseline" : `roles:baseline:${sequence}`;
