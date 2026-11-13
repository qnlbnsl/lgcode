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
