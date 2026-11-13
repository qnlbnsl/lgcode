// Owner screen controls. Only acknowledged reads publish product state.
import { html, useRef } from '../lib.js';
import * as engine from '../engine.js';
import { run } from './board.js';
import { loadMocks, loadDesign } from './mocks.js';
import { busy } from './board.js';
export function comment(project, screen, text) {
  return run('mock-comment:' + screen.id, async () => {
    await engine.request('project.mocks.comment', { projectId: project.id, revisionId: screen.rev, screenId: screen.id, text });
    await loadMocks(project.id);
    return true;
  }, 'Comment saved');
}
export function approve(project, screen) {
  return run('mock-approve:' + screen.id, async () => {
    await engine.request('project.mocks.screen.approve', { projectId: project.id, revisionId: screen.rev, screenId: screen.id, approved: screen.status !== 'approved' });
    await loadMocks(project.id);
    return true;
  }, screen.status === 'approved' ? 'Approval withdrawn' : 'Screen approved');
}
export function markSeen(project, mocks) {
  return run('mock-seen:' + project.id, async () => {
    try {
      for (const change of mocks.changes.filter((c) => !c.seen))
        await engine.request('project.mocks.seen', { projectId: project.id, revisionId: change.to, screenId: change.screen });
      return true;
    } finally { await loadMocks(project.id); }
  }, 'Changes marked seen');
}

export function saveEditor(project, mocks, file) {
  return run('mock-editor:' + project.id, async () => {
    if (!file || file.size < 1 || file.size > 512 * 1024) throw new Error('Choose an editor export of at most 512 KiB.');
    const reply = await engine.request('project.design.read', { repoId: project.repo, projectId: project.id, revisionId: mocks.designRevision });
    if (reply.result?._tag !== 'registered' || reply.result.record.revisionId !== mocks.designRevision) throw new Error('The recorded mock design is unavailable.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const saved = await engine.request('project.mocks.editor.save', { projectId: project.id, revisionId: mocks.revisionId,
      designRevision: mocks.designRevision, worktreeId: reply.result.record.design.worktreeId, content: btoa(binary) });
    await loadMocks(project.id); await loadDesign(project.repo);
    return saved;
  }, 'Editor changes saved');
}

// OpenPencil's existing Save exports a file. The owner selects that export;
// its name is ignored and the engine alone resolves the registered destination.
export function SaveEditor({ project, mocks }) {
  const input = useRef(null), pending = busy('mock-editor:' + project.id);
  return html`<input ref=${input} type="file" accept=".fig,.pen" hidden aria-label="Editor export" onChange=${async (event) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (file) await saveEditor(project, mocks, file);
  }} /><button type="button" class="btn ghost" disabled=${pending || !mocks.designRevision} title="Export in the editor, then choose that file." onClick=${() => input.current?.click()}>${pending ? 'Saving…' : 'Save changes from editor'}</button>`;
}
