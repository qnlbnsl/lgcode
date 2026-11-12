// Hand-written wire examples for roles unit 1. Standing-rule contracts wait
// for the owner's harness recordings and are deliberately absent.
export const roleFile = {
  name: "Example team",
  roles: { builder: { advice: "Report the result to your lead.", limits: { stallMinutes: 10 } } },
};

export const roleFileContent = JSON.stringify(roleFile);
export const roleFileHash = "a".repeat(64);

export const rolesCommands = {
  "roles.orient": ["agent"],
  "roles.handoff": ["owner", "agent"],
  "roles.role-file.set": ["owner"],
  "roles.role-file.get": ["owner"],
  "roles.settings.get": ["owner"],
  "roles.settings.set": ["owner"],
  "roles.snooze": ["owner"],
  "roles.actions.list": ["owner"],
  "roles.record": ["service"],
} as const;

export const action = {
  agentId: "agent-self", noticeRecipient: "owner", triggerSequence: 1,
  sourceSequence: 2, occurrence: 1, notice: "sent", postId: "post-example",
};

// Functions match the subscription suite's existing sample convention.
export const rolesSamples: Record<string, (agentId: string, nonce: string) => Record<string, unknown>> = {
  "roles.RoleFileSet": () => ({ content: roleFileContent, roleFileHash }),
  "roles.SettingsChanged": () => ({ settings: { stallWatch: true, limits: { stallMinutes: 10 } } }),
  "roles.Snoozed": () => ({ group: "example", until: 1_900_000_000_000 }),
  "roles.StallWatchBaseline": () => ({ position: 2, on: true }),
  "roles.StallNoticePlanned": (agentId, nonce) => ({ agentId, noticeRecipient: agentId, triggerSequence: 1,
    sourceSequence: 2, occurrence: 1, stalledPostId: `owed-${nonce}`, kind: "roles.StallSeen" }),
  ...Object.fromEntries([
    "TeamIdleReported", "StallSeen", "ReplaceAdvised", "RunawayReported", "CapacityRetried",
    "CrashAdmitted", "CrashRetried", "GaveUp", "RoleAdviceBroken", "CacheFlushed",
    "CompactRequested", "StallEnded",
  ].map((kind) => [`roles.${kind}`, (agentId: string, nonce: string) => ({
    ...action, agentId, postId: `post-${nonce}`,
    ...(kind === "TeamIdleReported" ? { group: "example" } : {}),
    ...(kind === "GaveUp" ? { cause: "crash", engineAlertOpen: false } : {}),
  })])),
};

export const rolesEvents = Object.entries(rolesSamples).map(([tag, sample]) => ({
  _tag: tag, ...sample("agent-self", "example"),
}));
