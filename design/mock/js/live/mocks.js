// Live actions for mock bundles, repository design and local discovery.
import { store, engineWrite, live, html, useState, useEffect, useRef } from '../lib.js';
import * as engine from '../engine.js';
import { run, busy } from './board.js';
import { toast, closeDialog, confirm } from '../actions.js';
export { busy };
const S = () => store.state;
const maps = () => engine.connection().mocks;
const valid = (state, connection) => live.on && S() === state && engine.connection() === connection && state.session.status === 'in';
export async function readMocks(projectId) {
  const items = [], cursors = new Set(); let after, approval;
  const first = await engine.request('client.sequence', {});
  for (;;) {
    const reply = await engine.request('project.mocks.read', { projectId, limit: 200, ...(after ? { after } : {}) });
    if (!Array.isArray(reply.items)) throw new Error('Mock history is unavailable.');
    for (const r of reply.items) { if (items.some((i) => i.revisionId === r.revisionId)) throw new Error('Mock history changed while loading. Refresh it.'); items.push(r); }
    approval = reply.approval;
    if (!reply.next) break;
    if (!reply.items.length || cursors.has(reply.next)) throw new Error('Mock history did not advance.');
    cursors.add(reply.next); after = reply.next;
  }
  const final = await engine.request('client.sequence', {});
  if (first.sequence !== final.sequence) throw new Error('Mock history changed while loading. Refresh it.');
  return maps().mapMocks(items, approval);
}
export function loadMocks(projectId) {
  return run('read-mocks:' + projectId, async () => {
    const state = S(), connection = engine.connection();
    const m = await readMocks(projectId);
    if (valid(state, connection)) engineWrite({ mocks: { ...S().mocks, [projectId]: m } });
    return m;
  });
}
export function approveMocks(project) {
  const revisionId = S().mocks[project.id]?.revisionId;
  if (!revisionId) return;
  confirm({ title: 'Approve the mocks?', action: 'Approve mocks', danger: false,
    body: `Approve revision ${revisionId}. Its screens become the reference, the project moves to Plan, and the worklist goes to the project lead.`,
    onConfirm: () => run('approve-mocks:' + project.id, async () => {
      const current = await readMocks(project.id);
      if (current.revisionId !== revisionId) throw new Error('The mock revision changed. Refresh and review it before approving.');
      for (const source of current.sources) {
        const reply = await engine.request('project.mocks.artifact', { projectId: project.id, revisionId, sourceId: source.sourceId });
        if (reply.result?._tag !== 'available' || !current.artifacts.some((a) => a.sourceId === source.sourceId && a.fingerprint === reply.result.fingerprint))
          throw new Error('A mock artifact is unavailable or changed. Record a new revision before approving.');
      }
      await engine.request('project.mocks.approve', { projectId: project.id, revisionId });
      await loadMocks(project.id);
    }, 'Mocks approved. The worklist goes to the project lead.') });
}
export function requestChanges(project, screen, text, designer) {
  return run('mock-changes:' + project.id, async () => {
    await engine.request('prompt', { agentId: designer.id, text: screen ? `Change the ${screen.name} screen: ${text.trim()}` : `Change the mocks: ${text.trim()}` });
    closeDialog();
    return true;
  }, 'Change request sent');
}
export function loadDesign(repoId) {
  return run('read-design:' + repoId, async () => {
    const state = S(), connection = engine.connection();
    const reply = await engine.request('project.design.read', { repoId });
    if (!reply.result) throw new Error('Repository design is unavailable.');
    const d = maps().mapDesign(reply.result);
    if (valid(state, connection)) engineWrite({ design: { ...S().design, [repoId]: d } });
    return d;
  });
}
export function loadMachines() {
  return run('read-machines', async () => {
    const state = S(), connection = engine.connection();
    const [discovery, settings, web] = await Promise.all([engine.request('project.setup.discover', {}), engine.request('project.settings', {}), engine.request('client.web.settings', {})]);
    const details = maps().mapMachineDetails(discovery.result, settings.settings, web.port);
    if (valid(state, connection)) engineWrite({ machineDetails: details });
    if (details.reason) toast(details.reason, 'error');
  });
}

// Displays use only identities from engine records. The connection validates the URL.
// A late open is closed after navigation, so it cannot leak an editor session.
export function Display({ selection, title = 'Recorded preview', action = 'Open preview', disabled = false, viewport }) {
  const [frame, setFrame] = useState(null), [pending, setPending] = useState(false);
  const [unclosed, setUnclosed] = useState(false);
  const ref = useRef({ alive: true, frame: null, generation: 0, connection: engine.connection() });
  const release = (f) => ref.current.connection.request('display.close', { id: f.id });
  const close = async () => {
    const r = ref.current; r.generation++; setFrame(null);
    if (!r.frame) { setPending(false); return; }
    setPending(true);
    try { await release(r.frame); r.frame = null; if (r.alive) setUnclosed(false); }
    catch (e) { if (r.alive) { setUnclosed(true); toast(e.message, 'error'); } }
    finally { if (r.alive) setPending(false); }
  };
  const open = async () => {
    const r = ref.current;
    if (pending || r.frame || disabled || !selection) return;
    const generation = ++r.generation; setPending(true);
    try {
      const f = await r.connection.request('display.open', selection);
      if (!r.alive || generation !== r.generation) { await release(f); return; }
      r.frame = f; setFrame(f);
    } catch (e) { if (r.alive) toast(e.message, 'error'); }
    finally { if (r.alive && generation === r.generation) setPending(false); }
  };
  useEffect(() => { const r = ref.current; r.alive = true; return () => {
    r.alive = false; r.generation++; if (r.frame) void release(r.frame).catch(() => {});
  }; }, []);
  useEffect(() => { if (disabled) void close(); }, [disabled]);
  useEffect(() => { if (!frame) return; const timer = setTimeout(() => void close(), Math.max(0, frame.expiresAt - Date.now())); return () => clearTimeout(timer); }, [frame]);
  return html`<section aria-label=${title} aria-busy=${pending}>
    ${frame ? html`<iframe title=${title} src=${frame.url} sandbox=${selection._tag === 'editor' ? 'allow-scripts allow-same-origin' : 'allow-scripts'} referrerpolicy="same-origin" style=${{ border: '0', width: viewport === 'phone' ? '390px' : '100%', maxWidth: '100%', height: '780px', background: 'white' }}></iframe>
      <button type="button" class="btn sm" disabled=${pending} onClick=${close}>Close display</button>`
      : html`<button type="button" class="btn sm" disabled=${pending || disabled || !selection || unclosed} onClick=${open}>${pending ? 'Opening…' : action}</button>`}
    ${unclosed && html`<button type="button" class="btn sm" disabled=${pending} onClick=${close}>Retry closing display</button>`}
  </section>`;
}
