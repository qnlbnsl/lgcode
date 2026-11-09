// A4: only the branded identities declared in contracts/{ids,events,
// accounts,harnesses,commands}.ts bypass string-value redaction. A shape is
// local to its schema position: an environment entry named `id` is text.
// Unbranded adapter strings (itemId, callId, optionId, sessionId) stay text.
export interface RedactionStructure {
  readonly identity?: true;
  readonly freeText?: true;
  readonly fields?: Readonly<Record<string, RedactionStructure>>;
  readonly taggedFields?: Readonly<Record<string, Readonly<Record<string, RedactionStructure>>>>;
  readonly elements?: RedactionStructure;
}

const identity: RedactionStructure = { identity: true };
const actor: RedactionStructure = { fields: { agentId: identity, service: identity, rule: identity, namespace: identity } };
const account: RedactionStructure = { identity: true, fields: {
  id: identity, harness: identity, environment: { freeText: true },
} };
const harness: RedactionStructure = { identity: true, fields: { id: identity } };
const member: RedactionStructure = { identity: true, fields: { agentId: identity, service: identity, rule: identity, namespace: identity } };
const context: RedactionStructure = { elements: { fields: { projectId: identity, taskId: identity, repoId: identity, worktreeId: identity } } };
const delivery: RedactionStructure = { fields: {
  id: identity, target: identity, sender: actor, source: { fields: { id: identity, namespace: identity } },
  content: { fields: { context } },
} };

// Project owners differ by schema: a workspace owner is display text, while
// sprint and task owners are AgentIds. Keep all new identities at their exact
// event positions, including array elements in sprint dependencies.
const workspace = { worktreeId: identity, repoId: identity, projectId: identity, teamId: identity, parentId: identity };
const project = { projectId: identity, repoId: identity, leadAgentId: identity, worktreeId: identity };
const sprint = { projectId: identity, sprintId: identity, owner: identity, needs: { elements: identity } };
const task = { projectId: identity, taskId: identity, owner: identity, teamId: identity, sprintId: identity, worktreeId: identity };

export const eventStructure: RedactionStructure = { taggedFields: {
  "project.SettingsChanged": { settings: { fields: { lead: { fields: { harness: identity, account: { fields: { accountId: identity } } } } } } },
  "project.CreationPlanned": { creation: { fields: { requestId: identity, projectId: identity,
    bodyHash: identity, repository: { fields: { repoId: identity } }, workspace: { fields: workspace },
    lead: { fields: { harness: identity, account: { fields: { accountId: identity } } } },
    repositoryIdentity: { fields: { device: identity, inode: identity } }, folderIdentity: { fields: { device: identity, inode: identity } } } } },
  "project.CreationClaimed": { creationRequestId: identity, identity: { fields: { device: identity, inode: identity } } },
  "project.CreationFinished": { creationRequestId: identity },
  "project.GoalChanged": { projectId: identity },
  "project.ArchiveStarted": { projectId: identity },
  "project.Archived": { projectId: identity },
  "project.Restored": { projectId: identity },
  "project.RepositoryAdded": { repoId: identity },
  "project.RepositoryLocated": { repoId: identity },
  "project.WorktreeCreated": workspace,
  "project.Created": project,
  "project.Placed": { projectId: identity, worktreeId: identity },
  "project.PreferencesChanged": { projectId: identity },
  "project.Renamed": { projectId: identity },
  "project.StageChanged": { projectId: identity },
  "project.TeamAdded": { projectId: identity, teamId: identity, worktreeId: identity, channelId: identity },
  "project.SprintAdded": sprint,
  "project.SprintChanged": sprint,
  "project.SprintCompleted": { projectId: identity, sprintId: identity },
  "project.TaskAdded": task,
  "project.TaskChanged": task,
  "project.TaskNoted": { projectId: identity, taskId: identity },
}, fields: {
  agentId: identity, accountId: identity, deliveryId: identity,
  // The configuration events' top-level revision is a branded RequestId.
  // A revision key inside prose or a free-text record remains ordinary text.
  revision: identity,
  context,
  roleFileHash: identity, noticeRecipient: identity, postId: identity, stalledPostId: identity,
  channelId: identity, wakeId: identity, anchorAgentId: identity, targetAgentId: identity,
  decidingPostId: identity, replyToPostId: identity,
  permissionRequestId: identity, questionId: identity, waitId: identity, alertId: identity, alertKey: identity, carrierGeneration: identity,
  account, harness, parent: actor, sender: actor, holder: actor, answeredBy: actor, from: actor,
  to: { ...actor, elements: actor }, author: actor, reader: actor, opener: actor, closer: actor, manager: actor, addressee: actor,
  membersAdded: { elements: member }, membersRemoved: { elements: member },
  carried: { elements: identity }, mustReply: { elements: identity }, completions: { elements: identity },
  reminders: { elements: identity }, postIds: { elements: identity },
  noAnswers: { elements: { fields: { postId: identity, addressee: actor } } },
  toolInput: { freeText: true },
  completionReplyText: { elements: identity },
  delivery, firstPromptDelivery: delivery, subject: { fields: { id: identity, namespace: identity } },
  member, members: { elements: member }, process: { fields: { bootId: identity } },
} };

export const receiptStructure: RedactionStructure = { fields: {
  repoId: identity, worktreeId: identity, projectId: identity, teamId: identity, sprintId: identity, taskId: identity,
  requestId: identity, agentId: identity, deliveryId: identity, questionId: identity, waitId: identity, alertId: identity,
  roleFileHash: identity, channelId: identity, postId: identity, wakeId: identity,
  accounts: { elements: account }, harnesses: { elements: harness }, members: { elements: member },
  envelopes: { elements: { fields: {
    eventId: identity, requestId: identity, agentId: identity, caller: actor, event: eventStructure,
  } } },
} };

export const fieldStructure = (structure: RedactionStructure | undefined, key: string, tag?: unknown): RedactionStructure | undefined => {
  // A free-text record's `_tag` entry is not a tagged-struct discriminator.
  if (structure?.freeText === true) return structure;
  if (key === "_tag") return identity;
  const tagged = typeof tag === "string" && structure?.taggedFields !== undefined && Object.hasOwn(structure.taggedFields, tag)
    ? structure.taggedFields[tag] : undefined;
  return tagged !== undefined && Object.hasOwn(tagged, key) ? tagged[key]
    : structure?.fields !== undefined && Object.hasOwn(structure.fields, key) ? structure.fields[key] : undefined;
};
