// Independent samples for exact inventories, wire decoding, and visibility.
export const gitReportSample = {
  reportId: "report-one", projectId: "project-one", worktreeId: "project-workspace", head: "a".repeat(40),
  kind: "review", status: "failed", summary: "Reported review outcome", threadAgentId: "agent-self", threadSequence: 1,
  reportedBy: { _tag: "agent", agentId: "agent-self" }, provenance: "reported", recordedAt: 1000,
} as const
export const gitReviewSample = {
  reviewId: "review-one", projectId: "project-one", worktreeId: "project-workspace", destinationId: "base-workspace",
  head: "a".repeat(40), baseHead: "b".repeat(40), branch: "feature", base: "main",
  evidence: { tests: { state: "missing", report: null }, review: { state: "current", report: gitReportSample } },
  openedAt: 1000, decision: null, outcome: "open", mergeHead: null, reason: null, decidedAt: null,
} as const
