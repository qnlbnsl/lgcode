// Wire the copied live screen without changing the frozen sample design.
export function serviceSettingsSource(path: string, source: string): string {
  if (path === 'js/live/git.js') {
    source = source.replace("['stallWatch', 'standingRules'].includes(key)", "['stallWatch', 'standingRules', 'assignedStallMinutes', 'leadStallMinutes'].includes(key)")
    source = source.replace("const key = Object.keys(patch)[0];", "if ('stallAssigned' in patch) patch = { assignedStallMinutes: patch.stallAssigned };\n  if ('stallLead' in patch) patch = { leadStallMinutes: patch.stallLead };\n  const key = Object.keys(patch)[0];")
  }
  return source
}
