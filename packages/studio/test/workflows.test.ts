import { expect, test, vi } from 'vitest'

test('reload waits for the connection and reconnect preserves an unsaved workflow', async () => {
  const lib = await import('../../../design/mock/js/lib.js' as string)
  const engine = await import('../../../design/mock/js/engine.js' as string)
  const { Workflows } = await import('../../../design/mock/js/screens/workflows.js' as string)
  const element = document.createElement('div'); document.body.append(element)
  const definition = { version: 1, name: 'Connection copy', settings: { tests: true, agentReview: true, fullReviewRounds: 3, approvalAfterRound: 4, maxReviewRounds: null, stuckPoints: 12, stuckShare: 30, stuckRounds: 3, autoMergeFix: true }, phases: [{ id: 'p', name: 'Phase', blocks: [{ id: 'a', name: 'Block', role: 'builder', steps: [] }] }], moves: [] }
  const record = { scope: 'user', id: 'connection-copy', readOnly: false, name: definition.name, definition }
  let connected = false
  const calls: string[] = []
  lib.live.on = true
  engine.setConnection({ request: async (tag: string) => {
    calls.push(tag)
    if (!connected) throw new Error('The service is not connected.')
    if (tag.endsWith('.list')) return { items: [record] }
    if (tag.endsWith('.read')) return { workflow: record }
    return { valid: true }
  } })
  const draw = () => lib.render(lib.h(Workflows, { s: { repos: [], conn: { status: connected ? 'live' : 'reconnecting' } } }), element)
  try {
    draw()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(calls).toEqual([])
    connected = true; draw()
    await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('#wfl-name')?.value).toBe('Connection copy'))
    const name = element.querySelector<HTMLInputElement>('#wfl-name')!
    name.value = 'Unsaved name'; name.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(element.textContent).toContain('Unsaved changes'))
    const reads = calls.filter((tag) => tag.endsWith('.read')).length
    connected = false; draw(); await new Promise((resolve) => setTimeout(resolve, 80))
    connected = true; draw(); await new Promise((resolve) => setTimeout(resolve, 80))
    expect(element.querySelector<HTMLInputElement>('#wfl-name')?.value).toBe('Unsaved name')
    expect(calls.filter((tag) => tag.endsWith('.read'))).toHaveLength(reads)
  } finally { lib.render(null, element); element.remove(); lib.live.on = false; engine.setConnection(null) }
})
