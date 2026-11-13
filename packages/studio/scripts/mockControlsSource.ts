// Wire the copied Mocks screen. The standalone sample keeps its original actions.
export function mockControlsSource(path: string, source: string): string {
  const replace = (from: string, to: string) => {
    if (!source.includes(from)) throw new Error(`Mock controls integration no longer matches ${path}`)
    source = source.replace(from, to)
  }
  if (path === "js/live/mocks.js") {
    replace("  const final = await engine.request('client.sequence', {});", `  const reviews = [];
  for (const revision of items) for (const screen of revision.bundle.screens) {
    const reply = await engine.request('project.mocks.screen.read', { projectId, revisionId: revision.revisionId, screenId: screen.screenId });
    if (!reply.review) throw new Error('Mock screen feedback is unavailable.');
    reviews.push(reply.review);
  }
  const final = await engine.request('client.sequence', {});`)
    replace("return maps().mapMocks(items, approval);", "return maps().mapMocks(items, approval, reviews);")
  }
  if (path === "js/screens/mocks.js") {
    source = "import * as controls from '../live/mock-controls.js';\n" + source
    const approveStart = source.indexOf("          ${sc.status !== 'approved' && html`")
    const approveEnd = source.indexOf("</button>`}", approveStart) + "</button>`}".length
    if (approveStart < 0 || approveEnd < "</button>`}".length) throw new Error(`Mock approval integration no longer matches ${path}`)
    const sampleApprove = source.slice(approveStart, approveEnd).trim()
    source = source.slice(0, approveStart) + "          ${live.on ? html`<button type=\"button\" class=${sc.status === 'approved' ? 'btn' : 'btn primary'} disabled=${mocks.busy('mock-approve:' + sc.id)} onClick=${() => controls.approve(p, sc)}><${Icon} name=\"check\" size=${14} />${mocks.busy('mock-approve:' + sc.id) ? 'Saving…' : sc.status === 'approved' ? 'Withdraw approval' : 'Approve'}</button>` : html`" + sampleApprove + "`}\n" + source.slice(approveEnd)
    replace("  if (live.on) { refuse(); return; }\n  const d = designerOf(s, p);", "  if (live.on) return controls.comment(p, sc, text);\n  const d = designerOf(s, p);")
    replace("const send = (e) => { e.preventDefault(); if (!text.trim()) return; comment(s, p, sc, text.trim()); setText(''); };", "const send = async (e) => { e.preventDefault(); if (!text.trim()) return; const sent = await comment(s, p, sc, text.trim()); if (!live.on || sent) setText(''); };")
    replace('<button type="submit" class="btn" disabled=${!text.trim()}>Send</button>', '<button type="submit" class="btn" disabled=${!text.trim() || live.on && mocks.busy(\'mock-comment:\' + sc.id)}>${live.on && mocks.busy(\'mock-comment:\' + sc.id) ? \'Sending…\' : \'Send\'}</button>')
    replace("const unseen = live.on ? 0 : m.changes.filter((c) => !c.seen).length;", "const unseen = m.changes.filter((c) => !c.seen).length;")
    replace("onClick=${() => update(() => { for (const c of m.changes) c.seen = true; })}", "disabled=${live.on && mocks.busy('mock-seen:' + p.id)} onClick=${() => live.on ? controls.markSeen(p, m) : update(() => { for (const c of m.changes) c.seen = true; })}")
    replace('size=${13} />Mark seen</button>', "size=${13} />${live.on && mocks.busy('mock-seen:' + p.id) ? 'Saving…' : 'Mark seen'}</button>")
    source = source.replaceAll("!live.on && !c.seen", "!c.seen")
  }
  return source
}
