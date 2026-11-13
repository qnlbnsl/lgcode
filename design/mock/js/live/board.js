// Live actions for projects, the board and first run. Transport stays in the connection.
import { store, update, engineWrite, live, refuse, go } from '../lib.js';
import * as engine from '../engine.js';
import { toast, nameFromGoal, closeDialog, openDialog } from '../actions.js';
const S = () => store.state;
const maps = () => engine.connection().board;
export const busy = (key) => !!S()?.ui?.boardBusy?.[key];
const valid = (state, connection) => live.on && S() === state && engine.connection() === connection && state.session.status === 'in';
export async function run(key, work, success) {
  if (busy(key)) return;
  const state = S(), connection = engine.connection();
  update((s) => { (s.ui.boardBusy ||= {})[key] = true; });
  try {
    const reply = await work();
    if (!valid(state, connection)) return;
    if (success) toast(success);
    return reply;
  } catch (error) {
    if (valid(state, connection)) toast(error.message || 'The service could not confirm the request.', 'error');
  } finally { if (S() === state) update((s) => { delete s.ui.boardBusy[key]; }); }
}
export async function pages(tag, payload = {}) {
  const rows = [], cursors = new Set(); let after;
  for (;;) {
    const reply = await engine.request(tag, { ...payload, limit: 200, ...(after ? { after } : {}) });
    if (!Array.isArray(reply.items)) throw new Error('The service did not return the requested records.');
    rows.push(...reply.items);
    if (!reply.next) return rows;
    if (!reply.items.length || cursors.has(reply.next)) throw new Error('The service returned a repeated page.');
    cursors.add(reply.next); after = reply.next;
  }
}
export function archiveProject(projectId, archived) {
  return run('project:' + projectId, () => engine.request(archived ? 'project.archive' : 'project.restore', { projectId }), archived ? 'Project archived' : 'Project restored');
}
export function renameProject(projectId, name) {
  return run('project:' + projectId, () => engine.request('project.rename', { projectId, name }), 'Project renamed');
}
export function saveGoal(projectId, goal) {
  return run('project:' + projectId, () => engine.request('project.goal.set', { projectId, goal }), 'Goal saved');
}
export function createProject(input, { setup = false } = {}) {
  return run('create-project', async () => {
    const payload = maps().projectPayload(input, nameFromGoal(input.goal));
    await engine.request('project.placement.preview', payload);
    const reply = await engine.request('project.create', payload);
    if (setup) { update((s) => { s.ui.setupCreated = reply.projectId; }); await engine.request('project.setup.complete', { projectId: reply.projectId }); engineWrite({ session: { status: 'in', firstRun: false } }); }
    closeDialog(); go(`/p/${reply.projectId}/board`);
    return reply.projectId;
  });
}
export async function addRepository({ path, name, repo, back }) {
  return run('add-repository', async () => {
    const reply = await engine.request(repo ? 'project.repository.locate' : 'project.repository.add',
      { ...(repo ? { repoId: repo } : { name }), path: path.trim(), machineId: 'local' });
    if (back) openDialog({ ...back, machine: 'local', repo: repo || reply.repoId }); else closeDialog();
    return repo || reply.repoId;
  }, 'Repository added');
}
export function addTask(project, sprint, title, teamId) {
  return run('task:' + sprint.id, async () => {
    const team = S().teams.find((t) => t.id === (teamId || sprint.team)) || S().teams.find((t) => t.project === project.id);
    if (!team?.worktreeId) throw new Error('A team with a worktree is needed before adding a task.');
    return engine.request('project.task.create', { projectId: project.id, sprintId: sprint.id, title: title.trim(),
      owner: project.lead, teamId: team.id, worktreeId: team.worktreeId, state: 'queue' });
  }, 'Task added. The project lead was told.');
}
export function loadTask(project, task) {
  return run('read-task:' + task.id, async () => {
    const state = S(), connection = engine.connection();
    const [history, changes] = await Promise.allSettled([pages('project.task.history', { projectId: project.id, taskId: task.id }),
      engine.request('project.changes', { projectId: project.id, worktreeId: task.worktreeId })]);
    const workspace = S().worktrees.find((w) => w.id === task.worktreeId);
    const detail = maps().mapTaskDetails(history.status === 'fulfilled' ? history.value : [], { files: changes.status === 'fulfilled' ? changes.value.result?.items || [] : [] }, workspace && { branch: workspace.branch, path: workspace.folder });
    if (valid(state, connection)) engineWrite({ taskDetails: { ...S().taskDetails, [task.id]: detail } });
    for (const result of [history, changes]) if (result.status === 'rejected') toast(result.reason.message, 'error');
    return detail;
  });
}
export function loadAgents(ids) {
  return run('read-agents:' + ids.join(','), async () => {
    const state = S(), connection = engine.connection();
    const entries = await Promise.all(ids.map(async (agentId) => {
      const [choices, context] = await Promise.all([engine.request('client.agent.configuration', { agentId }), engine.request('client.agent.context', { agentId })]);
      return [agentId, maps().mapAgentDetails(choices, context.context)];
    }));
    if (valid(state, connection)) engineWrite({ boardAgents: { ...S().boardAgents, ...Object.fromEntries(entries) } });
  });
}
export function configureLead(agentId, patch) {
  return run('configure:' + agentId, async () => {
    const reply = await engine.request('configure', { agentId, ...patch });
    await loadAgents([agentId]); return reply;
  }, 'Configuration requested');
}
const messageReads = new Map();
export function loadMessages(projectId, channelId, threadId) {
  const previous = messageReads.get(projectId);
  if (previous) { previous.next = [projectId, channelId, threadId]; return previous.promise; }
  const slot = { next: null, promise: null };
  const operation = run('read-board:' + projectId, async () => {
    const state = S(), connection = engine.connection();
    const rows = await pages('board.channels');
    const channels = maps().mapChannels(rows, S());
    const own = channels.filter((c) => c.project === projectId);
    const selected = channelId || own[0]?.id;
    const targets = selected === 'waiting' ? own : own.filter((c) => c.id === selected);
    const all = await Promise.all(targets.map((c) => pages('board.peek', { channelId: c.id })));
    let posts = all.flat();
    if (threadId) posts.push(...await pages('board.read', { repliesTo: threadId }));
    const unique = [...new Map(posts.map((p) => [p.postId, p])).values()];
    // Times belong to event envelopes, not BoardPost. Read the matching event lazily.
    const mapped = await Promise.all(unique.map(async (p) => {
      const cached = S().posts.find((row) => row.id === p.postId && row.ts != null);
      const event = cached ? null : await engine.request('client.event', { sequence: p.sequence });
      return maps().mapPost(p, cached?.ts ?? event?.envelope?.occurredAt);
    }));
    if (selected && selected !== 'waiting') await pages('board.read', { channelId: selected });
    if (valid(state, connection)) engineWrite({ channels, posts: [...S().posts.filter((p) => !targets.some((c) => c.id === p.channel)), ...mapped] });
    return true;
  });
  slot.promise = operation.finally(() => { messageReads.delete(projectId); if (slot.next && live.on && S().session.status === 'in') void loadMessages(...slot.next); });
  messageReads.set(projectId, slot);
  return slot.promise;
}
export function sendPost(input) {
  return run('post:' + (input.replyTo || input.channel), async () => {
    const ch = S().channels.find((c) => c.id === input.channel);
    const reply = await engine.request('board.post', maps().postPayload(input, ch?.members || []));
    await loadMessages(ch.project, ch.id, input.replyTo);
    return reply;
  });
}
export function setClosed(id, closed) {
  if (!closed) { refuse(); return; }
  return run('close-post:' + id, async () => {
    const reply = await engine.request('board.close', { postId: id });
    const post = S().posts.find((p) => p.id === id), ch = S().channels.find((c) => c.id === post?.channel);
    if (ch) await loadMessages(ch.project, ch.id);
    return reply;
  }, 'Post withdrawn');
}
export function loadSetup() {
  return run('read-setup', async () => {
    const state = S(), connection = engine.connection();
    const [setup, discovery, settings] = await Promise.all([engine.request('project.setup', {}), engine.request('project.setup.discover', {}), engine.request('project.settings', {})]);
    const data = maps().mapSetup(setup.setup, discovery.result, settings.settings);
    if (valid(state, connection)) engineWrite({ setupData: data });
    return data;
  });
}
export function advanceSetup(step) {
  return run('setup', async () => { await engine.request('project.setup.advance', { step: ['welcome', 'found', 'project'][step] }); return loadSetup(); });
}
export function saveSetupSettings(patch) {
  return run('setup-settings', async () => {
    const current = await engine.request('project.settings', {});
    const settings = { ...current.settings, ...patch };
    await engine.request('project.settings.set', { settings });
    return loadSetup();
  }, 'Settings saved');
}
export function registerSetupRepository(path) {
  return run('setup-repository', async () => {
    const known = S().repos.find((r) => Object.values(r.folders).includes(path.trim()));
    if (known) return { repo: known.id, path: path.trim(), name: known.name };
    const reply = await engine.request('project.repository.add', { path: path.trim(), name: path.trim().replace(/\/+$/, '').split('/').pop(), machineId: 'local' });
    return { repo: reply.repoId, path: path.trim() };
  });
}
