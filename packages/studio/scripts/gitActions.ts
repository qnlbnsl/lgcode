// Wire existing Git controls in the built copy. The design reference stays unchanged.
export function gitActionsSource(path: string, source: string): string {
  const replace = (from: string, to: string) => {
    if (!source.includes(from)) throw new Error(`Git actions integration no longer matches ${path}`)
    source = source.replace(from, to)
  }
  if (path === "js/screens/git.js") {
    replace("function updateFromBase(wid) { if (live.on) return refuse();", "function updateFromBase(wid) { if (live.on) return liveGit.updateFromBase(wid);")
    replace("function abortMerge(s, w) { if (live.on) return refuse();", "function abortMerge(s, w) { if (live.on) return liveGit.abortMerge(w.id);")
  }
  if (path === "js/live/git.js") {
    replace("export function refreshGit(project = screen?.project) { return run('git', () => loadGit(project)); }", "export function refreshGit(project = screen?.project) { if (busy('git')) return false; return run('git-read', () => loadGit(project)); }")
    replace("export function gitDetail(id, commit) { return run('git', () => loadGitDetail(id, commit)); }", "export function gitDetail(id, commit) { return run('git', () => { revision++; return loadGitDetail(id, commit); }); }")
    replace("const conflict = read(await request('project.conflict.choose'", "revision++;\n    const conflict = read(await request('project.conflict.choose'")
    replace("if (w.kind !== 'team') { refuse(); return; }", "if (!['team', 'agent'].includes(w.kind)) { refuse(); return; }")
    replace("const merge = state.mergeHead || changes.items.some((x) => x.conflict) ?", "const resolved = state.mergeHead ? read(await request('project.conflict.resolved', scope(w))) : { items: [], truncated: false };\n    if (version !== revision || S().session.status !== 'in') return;\n    const merge = state.mergeHead || changes.items.some((x) => x.conflict) ?")
    replace("files: changes.items.filter((x) => x.conflict).map", "files: [...changes.items.filter((x) => x.conflict), ...resolved.items.map((file) => ({ ...file, resolved: true }))].map")
    replace("resolved: false, loaded: false })) } : null;", "resolved: !!x.resolved, fingerprint: x.fingerprint, loaded: false })) } : null;")
    replace("truncated: changes.truncated });", "truncated: changes.truncated || resolved.truncated });")
    replace("for (const f of w.merge.files) {", "for (const f of w.merge.files) {\n      if (f.resolved) { files.push({ ...f, loaded: true }); continue; }")
    replace("export function answerReview(id, option) {\n  if (option !== 'merge') { refuse(); return; }", "export function answerReview(id, option, reason) {\n  if (option === 'decline') return declineReview(id, reason);\n  if (option !== 'merge') { refuse(); return; }")
    replace("if (!value) { refuse(); return; }", "if (!value) return reopen(id, fid);")
    source += `
export function abortMerge(id) {
  const w = wt(id);
  try { local(w); } catch (e) { act.toast(e.message, 'error'); return; }
  if (!w.mergeHead) { act.toast('No merge is in progress.', 'error'); return; }
  const expectedHead = w.head, expectedMergeHead = w.mergeHead;
  act.confirm({ title: 'Abort this merge?', body: w.branch + ' goes back to how it was before ' + w.merge.from + ' was merged in. Your conflict choices are lost. Files added during the merge are removed.', action: 'Abort merge',
    onConfirm: () => run('git', async () => {
      revision++;
      try { await request('project.merge.abort', { ...scope(w), expectedHead, expectedMergeHead, confirmed: true }); }
      finally { await loadGit(screen?.project); }
    }) });
}
function reopen(id, fid) {
  const w = wt(id);
  try { local(w); } catch (e) { act.toast(e.message, 'error'); return; }
  const file = w.merge.files.find((f) => f.id === fid);
  const observed = { ...scope(w), path: file.path, expectedHead: w.head, expectedMergeHead: w.mergeHead, fingerprint: file.fingerprint, confirmed: true };
  act.confirm({ title: 'Reopen this conflict?', body: 'The current contents of ' + file.path + ' are replaced by the original conflict. Edits made after the file was last read are refused.', action: 'Reopen file',
    onConfirm: () => run('git', async () => {
      revision++;
      try { await request('project.conflict.reopen', observed); }
      finally { await loadGit(screen?.project); }
    }) });
}
export function updateFromBase(id) { return run('git', async () => {
  const w = wt(id); local(w); const parent = destination(w); local(parent); revision++;
  try { await request('project.update', { ...scope(w), destinationId: parent.id, expectedHead: parent.head }); }
  finally { await loadGit(screen?.project); }
}); }
export function declineReview(id, reason) { return run('git', async () => {
  const w = S().worktrees.find((w) => w.review?.id === id); local(w); const r = w.review; revision++;
  if (!reason?.trim()) throw new Error('Give a reason for sending the review back.');
  const review = read(await request('project.review.decline', { ...scope(w), projectId: r.project, reviewId: r.id, expectedHead: r.head, expectedBaseHead: r.baseHead, reason: reason.trim() }));
  writeWt(w.id, { review: mapping.mapMainReview(review, undefined, r.agent) });
  act.closeDialog(); await loadGit(r.project);
}); }
`
  }
  if (path === "js/actions.js") {
    replace("return liveGit.answerReview(requestId, optionId);", "return liveGit.answerReview(requestId, optionId, text);")
  }
  if (path === "js/dialogs.js") {
    // Reuse the mock's existing send-back form and field, beside the merge action.
    replace("const ev = r.evidence; const ok = ev.tests.ok && ev.review.ok;", "const [back, setBack] = useState(false); const [why, setWhy] = useState('');\n  const ev = r.evidence; const ok = ev.tests.ok && ev.review.ok;")
    replace("<button type=\"button\" class=${cx('btn', ok && 'primary')} disabled=${live.on ?", "${live.on && r.status === 'open' && html`<button type=\"button\" class=\"btn\" disabled=${liveGit.busy('git')} onClick=${() => setBack(true)}>Send back</button>`}\n      <button type=\"button\" class=${cx('btn', ok && 'primary')} disabled=${live.on ?")
    replace("<p class=\"mg-brief\">${r.brief || r.body}</p>", "${live.on && back && html`<form class=\"mg-back\" onSubmit=${(e) => { e.preventDefault(); if (why.trim()) liveGit.answerReview(r.id, 'decline', why.trim()); }}>\n      <label for=${'why-' + r.id}>What should change?</label><div class=\"row\"><input id=${'why-' + r.id} class=\"input\" value=${why} onInput=${(e) => setWhy(e.target.value)} placeholder=\"The redirects should keep the old anchors\" />\n      <button type=\"submit\" class=\"btn\" disabled=${!why.trim() || liveGit.busy('git')}>Send back</button><button type=\"button\" class=\"btn ghost\" onClick=${() => { setBack(false); setWhy(''); }}>Cancel</button></div></form>`}\n    <p class=\"mg-brief\">${r.brief || r.body}</p>")
    replace("onClick=${() => setBack(true)}>Send back", "onClick=${() => setBack(true)} hidden=${back}>Send back")
  }
  return source
}
