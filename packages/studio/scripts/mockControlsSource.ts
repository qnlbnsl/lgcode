// Wire the copied Mocks screen. The standalone sample keeps its original actions.
export function mockControlsSource(path: string, source: string): string {
  const replace = (from: string, to: string) => {
    if (!source.includes(from)) throw new Error(`Mock controls integration no longer matches ${path}`)
    source = source.replace(from, to)
  }
  if (path === "js/live/mocks.js") {
    replace("  const final = await engine.request('client.sequence', {});", `  const head = items.at(-1);
  const reviews = head ? await Promise.all(head.bundle.screens.map(async (screen) => {
    const reply = await engine.request('project.mocks.screen.read', { projectId, revisionId: head.revisionId, screenId: screen.screenId });
    if (!reply.review) throw new Error('Mock screen feedback is unavailable.');
    return reply.review;
  })) : [];
  const final = await engine.request('client.sequence', {});`)
    replace("return maps().mapMocks(items, approval);", "return maps().mapMocks(items, approval, reviews);")
  }
  if (path === "js/screens/mocks.js") {
    source = "import * as controls from '../live/mock-controls.js';\n" + source
    replace("  if (live.on) { refuse(); return; }\n  const d = designerOf(s, p);", "  if (live.on) return controls.comment(p, sc, text);\n  const d = designerOf(s, p);")
    replace("const send = (e) => { e.preventDefault(); if (!text.trim()) return; comment(s, p, sc, text.trim()); setText(''); };", "const send = async (e) => { e.preventDefault(); if (!text.trim()) return; const sent = await comment(s, p, sc, text.trim()); if (!live.on || sent) setText(''); };")
    replace('<button type="submit" class="btn" disabled=${!text.trim()}>Send</button>', '<button type="submit" class="btn" disabled=${!text.trim() || live.on && mocks.busy(\'mock-comment:\' + sc.id)}>${live.on && mocks.busy(\'mock-comment:\' + sc.id) ? \'Sending…\' : \'Send\'}</button>')
  }
  return source
}
