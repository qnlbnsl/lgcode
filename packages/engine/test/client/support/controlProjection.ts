import type { emptyViews } from "../../../src/views/apply.ts";
type View = ReturnType<typeof emptyViews>;

// This is the permitted control projection, independent of snapshot/roster.
// Fixture strings fit all display bounds; prompt bodies and closed rows do not
// belong in this oracle. The fixed id set keeps visibility changes separate.
export const controlProjection = (view: View, ids: ReadonlySet<string>, owner: boolean) => {
  const requests = Object.values(view.requests).filter((row) => row.status === "open" && ids.has(row.agentId));
  const questions = Object.values(view.questions).filter((row) => row.status === "open" && ids.has(row.agentId));
  return {
    agents: Object.values(view.agents).filter((row) => ids.has(row.agentId)).map((row) => ({
      agentId: row.agentId, name: row.name, role: row.role, groups: row.groups, parent: row.parent,
      state: row.state, harness: row.harness, account: row.account, permission: row.permission,
      folder: row.folder, session: row.session,
      openPermissionRequests: requests.filter((request) => request.agentId === row.agentId).length,
      openQuestionsAsked: questions.filter((question) => question.agentId === row.agentId).length,
      ...(owner ? { capacityHeld: row.capacityHeld === true, reloadable: row.reloadable } : {}),
    })).sort((a, b) => a.agentId.localeCompare(b.agentId)),
    requests: requests.map((row) => ({ id: row.permissionRequestId, agentId: row.agentId, holder: row.holder })).sort((a, b) => a.id.localeCompare(b.id)),
    questions: questions.map((row) => ({ id: row.questionId, agentId: row.agentId, holder: row.holder })).sort((a, b) => a.id.localeCompare(b.id)),
  };
};
export const snapshotControl = (value: any, owner: boolean) => ({
  agents: value.agents.map((row: any) => ({
    agentId: row.agentId, name: row.name, role: row.role, groups: row.groups, parent: row.parent,
    state: row.state, harness: row.harness, account: row.account, permission: row.permission,
    folder: row.folder, session: row.session,
    openPermissionRequests: row.openPermissionRequests, openQuestionsAsked: row.openQuestionsAsked,
    ...(owner ? { capacityHeld: row.capacityHeld, reloadable: row.reloadable } : {}),
  })).sort((a: any, b: any) => a.agentId.localeCompare(b.agentId)),
  requests: value.requests.map(({ id, agentId, holder }: any) => ({ id, agentId, holder })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
  questions: value.questions.map(({ id, agentId, holder }: any) => ({ id, agentId, holder })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
});
export const restoreControl = (snapshot: any, empty: View): View => ({
  ...empty,
  agents: Object.fromEntries(snapshot.agents.map((row: any) => [row.agentId, row])),
  requests: Object.fromEntries(snapshot.requests.map((row: any) => [row.id, { ...row, permissionRequestId: row.id, status: "open" }])),
  questions: Object.fromEntries(snapshot.questions.map((row: any) => [row.id, { ...row, questionId: row.id, status: "open" }])),
});
