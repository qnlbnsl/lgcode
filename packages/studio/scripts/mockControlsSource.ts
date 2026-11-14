// Wire the copied Mocks screen. The standalone sample keeps its original actions.
export function mockControlsSource(path: string, source: string): string {
  const replace = (from: string, to: string) => {
    if (!source.includes(from)) throw new Error(`Mock controls integration no longer matches ${path}`)
    if (source.indexOf(from) !== source.lastIndexOf(from)) throw new Error(`Mock controls integration needs a unique match in ${path}`)
    source = source.replace(from, to)
  }
  if (path === "js/live/mocks.js") {
    replace("  const first = await engine.request('client.sequence', {});", "")
    replace("  const final = await engine.request('client.sequence', {});\n  if (first.sequence !== final.sequence) throw new Error('Mock history changed while loading. Refresh it.');", `  const feedback = await engine.request('project.mocks.reviews.read', { projectId });
  if (!Array.isArray(feedback.reviews)) throw new Error('Mock screen feedback is unavailable.');
  if (feedback.revisionId !== items.at(-1)?.revisionId) throw new Error('Mock history changed while loading. Refresh it.');
  const reviews = feedback.reviews;
  approval = feedback.approval;`)
    replace("return maps().mapMocks(items, approval);", "return maps().mapMocks(items, approval, reviews);")
  }
  if (path === "js/screens/mocks.js") {
    source = "import * as controls from '../live/mock-controls.js';\n" + source
    replace("${live.on ? html`<${mocks.Display} key=${m.designRevision} title=\"Mock design editor\"", "${live.on ? html`<${controls.SaveEditor} project=${p} mocks=${m} /><${mocks.Display} key=${m.designRevision} title=\"Mock design editor\"")
    const approveAnchor = "          ${sc.status !== 'approved' && html`"
    const approveStart = source.indexOf(approveAnchor)
    if (approveStart !== source.lastIndexOf(approveAnchor)) throw new Error(`Mock approval integration needs a unique match in ${path}`)
    const approveEnd = source.indexOf("</button>`}", approveStart) + "</button>`}".length
    if (approveStart < 0 || approveEnd < "</button>`}".length) throw new Error(`Mock approval integration no longer matches ${path}`)
    const sampleApprove = source.slice(approveStart, approveEnd).trim()
    replace(source.slice(approveStart, approveEnd), "          ${live.on ? html`<button type=\"button\" class=${sc.status === 'approved' ? 'btn' : 'btn primary'} disabled=${mocks.busy('mock-approve:' + sc.id)} onClick=${() => controls.approve(p, sc)}><${Icon} name=\"check\" size=${14} />${mocks.busy('mock-approve:' + sc.id) ? 'Saving…' : sc.status === 'approved' ? 'Withdraw approval' : 'Approve'}</button>` : html`" + sampleApprove + "`}")
    replace("  if (live.on) { refuse(); return; }\n  const d = designerOf(s, p);", "  if (live.on) return controls.comment(p, sc, text);\n  const d = designerOf(s, p);")
    replace("const send = (e) => { e.preventDefault(); if (!text.trim()) return; comment(s, p, sc, text.trim()); setText(''); };", "const send = async (e) => { e.preventDefault(); if (!text.trim()) return; const sent = await comment(s, p, sc, text.trim()); if (!live.on || sent) setText(''); };")
    replace('<button type="submit" class="btn" disabled=${!text.trim()}>Send</button>', '<button type="submit" class="btn" disabled=${!text.trim() || live.on && mocks.busy(\'mock-comment:\' + sc.id)}>${live.on && mocks.busy(\'mock-comment:\' + sc.id) ? \'Sending…\' : \'Send\'}</button>')
    replace("const unseen = live.on ? 0 : m.changes.filter((c) => !c.seen).length;", "const unseen = m.changes.filter((c) => !c.seen).length;")
    replace("onClick=${() => update(() => { for (const c of m.changes) c.seen = true; })}", "disabled=${live.on && mocks.busy('mock-seen:' + p.id)} onClick=${() => live.on ? controls.markSeen(p, m) : update(() => { for (const c of m.changes) c.seen = true; })}")
    replace('size=${13} />Mark seen</button>', "size=${13} />${live.on && mocks.busy('mock-seen:' + p.id) ? 'Saving…' : 'Mark seen'}</button>")
    replace("!live.on && !c.seen && 's-warn'", "!c.seen && 's-warn'")
    replace("!live.on && !c.seen && html`", "!c.seen && html`")
    replace("${since(c.ts, now)}</time></p><p>${c.text}</p>", "${since(c.ts, now)}</time></p>${live.on && html`<p class=\"muted\">Revision ${c.revisionId}</p>`}<p>${c.text}</p>")
  }
  return source
}
