import * as Schema from 'effect/Schema'

export const workflowRoles = ['owner', 'engine', 'project-lead', 'orchestrator', 'planning-lead', 'planner', 'reviewer', 'design-lead', 'designer', 'build-lead', 'build-init', 'builder', 'test-runner', 'evaluator'] as const
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))
export const WorkflowId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/))
const Positive = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1000))
export const WorkflowSettings = Schema.Struct({
  tests: Schema.Boolean, agentReview: Schema.Boolean,
  fullReviewRounds: Positive, approvalAfterRound: Positive,
  maxReviewRounds: Schema.Union([Positive, Schema.Null]),
  stuckPoints: Positive, stuckShare: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  stuckRounds: Positive, autoMergeFix: Schema.Boolean,
})
export const WorkflowBlock = Schema.Struct({
  id: WorkflowId, name: Text, end: Schema.optionalKey(Schema.Boolean), role: Schema.Literals(workflowRoles),
  // Nested spec blocks retain their internal states and decisions as labelled steps.
  steps: Schema.Array(Schema.Struct({ from: Text, to: Text, when: Text, role: Schema.Literals(workflowRoles) })).check(Schema.isMaxLength(100)),
})
const WorkflowShape = Schema.Struct({
  version: Schema.Literal(1), name: Text, settings: WorkflowSettings,
  phases: Schema.Array(Schema.Struct({ id: WorkflowId, name: Text, blocks: Schema.Array(WorkflowBlock).check(Schema.isMinLength(1), Schema.isMaxLength(100)) })).check(Schema.isMinLength(1), Schema.isMaxLength(24)),
  moves: Schema.Array(Schema.Struct({ from: WorkflowId, to: WorkflowId, when: Text })).check(Schema.isMaxLength(1000)),
})
export type WorkflowDefinition = typeof WorkflowShape.Type
const graphError = (value: WorkflowDefinition): string | undefined => {
  const ids = new Set<string>()
  for (const phase of value.phases) {
    if (!phase.name.trim()) return 'Give every phase a name.'
    if (ids.has(phase.id)) return 'Give every phase and block a unique identifier.'
    ids.add(phase.id)
    for (const block of phase.blocks) {
      if (!block.name.trim()) return 'Give every block a name.'
      if (ids.has(block.id)) return 'Give every phase and block a unique identifier.'
      ids.add(block.id)
      if (block.steps.some((step) => !step.from.trim() || !step.to.trim() || !step.when.trim())) return 'Give every inner move a source, target and condition.'
    }
  }
  const blocks = new Set(value.phases.flatMap((p) => p.blocks.map((b) => b.id)))
  const moves = new Set<string>()
  for (const move of value.moves) {
    if (!blocks.has(move.from) || !blocks.has(move.to)) return 'Every move must connect two existing blocks.'
    if (!move.when.trim()) return 'Give every move a condition.'
    if (move.from === move.to) return 'A move must connect two different blocks.'
    const key = JSON.stringify([move.from, move.to, move.when])
    if (moves.has(key)) return 'Remove the duplicate move.'
    moves.add(key)
  }
  if (!value.name.trim()) return 'Give the workflow a name.'
  if (value.settings.approvalAfterRound < value.settings.fullReviewRounds) return 'Ask for approval after the full review rounds.'
  if (value.settings.maxReviewRounds !== null && value.settings.maxReviewRounds < value.settings.approvalAfterRound) return 'Keep the review limit at or above the approval round.'
  return undefined
}
export const WorkflowDefinition = WorkflowShape.check(Schema.makeFilter((value) => graphError(value)))
export const validateWorkflow = (value: unknown): string | undefined => {
  if (value !== null && typeof value === 'object') {
    const d = value as Partial<WorkflowDefinition>
    if (typeof d.name === 'string' && !d.name.trim()) return 'Give the workflow a name.'
    if (Array.isArray(d.phases)) {
      if (!d.phases.length || d.phases.length > 24) return 'Keep between one and 24 phases.'
      for (const p of d.phases) {
        if (typeof p?.name === 'string' && !p.name.trim()) return 'Give every phase a name.'
        if (Array.isArray(p?.blocks)) {
          if (!p.blocks.length || p.blocks.length > 100) return 'Keep between one and 100 blocks in every phase.'
          for (const b of p.blocks) {
            if (typeof b?.name === 'string' && !b.name.trim()) return 'Give every block a name.'
            if (b?.role && !(workflowRoles as readonly string[]).includes(b.role)) return 'Choose a supported role for every block.'
          }
        }
      }
    }
    if (d.settings && typeof d.settings === 'object') for (const [key, setting] of Object.entries(d.settings)) {
      if (['tests', 'agentReview', 'autoMergeFix'].includes(key)) continue
      if (key === 'maxReviewRounds' && setting === null) continue
      if (!Number.isInteger(setting) || Number(setting) < 1 || Number(setting) > (key === 'stuckShare' ? 100 : 1000)) return 'Use positive whole numbers within the setting limits.'
    }
  }
  try { Schema.decodeUnknownSync(WorkflowShape)(value, { onExcessProperty: 'error' }) }
  catch { return 'Use the workflow format with named phases and blocks, supported roles, and valid settings.' }
  return graphError(value as WorkflowDefinition)
}
export const WorkflowScope = Schema.Literals(['default', 'user', 'repository'])
export const WorkflowSummary = Schema.Struct({ scope: WorkflowScope, id: Schema.String, name: Schema.String, readOnly: Schema.Boolean, error: Schema.optionalKey(Schema.String), canDelete: Schema.optionalKey(Schema.Boolean) })
export type WorkflowSummary = typeof WorkflowSummary.Type
export const WorkflowRecord = Schema.Struct({ ...WorkflowSummary.fields, definition: WorkflowDefinition })

export const WorkflowFolder = Schema.Struct({ scope: Schema.Literals(['user', 'repository']), limit: Schema.Int, truncated: Schema.Boolean, error: Schema.optionalKey(Schema.String) })
export type WorkflowFolder = typeof WorkflowFolder.Type
