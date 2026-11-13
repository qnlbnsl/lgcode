// Owner screen controls. Only acknowledged reads publish product state.
import { store } from '../lib.js';
import * as engine from '../engine.js';
import { run } from './board.js';
import { loadMocks } from './mocks.js';
export function comment(project, screen, text) {
  return run('mock-comment:' + screen.id, async () => {
    await engine.request('project.mocks.comment', { projectId: project.id, revisionId: screen.rev, screenId: screen.id, text });
    await loadMocks(project.id);
    return true;
  }, 'Comment saved');
}
export const state = () => store.state;
export function approve(project, screen) {
  return run('mock-approve:' + screen.id, async () => {
    await engine.request('project.mocks.screen.approve', { projectId: project.id, revisionId: screen.rev, screenId: screen.id, approved: screen.status !== 'approved' });
    await loadMocks(project.id);
    return true;
  }, screen.status === 'approved' ? 'Approval withdrawn' : 'Screen approved');
}
