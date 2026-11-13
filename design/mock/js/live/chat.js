// Live actions and on-demand reads. Domain records only change from replies or events.
import { live, store, update, engineWrite, refuse } from '../lib.js';
import * as engine from '../engine.js';
import { confirm, toast } from '../actions.js';

let mapping;
export function setMapping(value) { mapping = value; }
let generation = 0;
const oversized = new Map();
const histories = new Map(), details = new Map(), sources = new Map();
let accountNames = [], accountRead = null;
let actions = [], readers = 0, loadingRequests = null, requestVersion = 0;
const S = () => store.state;
export const busy = (key) => !!S()?.ui?.chatBusy?.[key];
export const requestBusy = (row) => busy('request:' + row.id) || row.kind === 'failed' && busy('agent:' + row.agent);
function notice(text) { toast(text, 'error'); }
async function attempt(key, fn) {
  if (busy(key)) return false;
  const epoch = generation;
  update((s) => { (s.ui.chatBusy ||= {})[key] = true; });
  try { await fn(); return epoch === generation; }
  catch (e) { if (epoch === generation) notice(e.message || String(e)); return false; }
  finally { if (epoch === generation) update((s) => { delete s.ui.chatBusy[key]; }); }
}
export function reset() {
  generation++; accountNames = []; accountRead = null; oversized.clear(); histories.clear(); details.clear(); sources.clear(); actions = []; loadingRequests = null; requestVersion++;
  if (S()?.ui) { S().ui.chatBusy = {}; S().drafts = {}; }
}
export function enrich(patch) {
  if (!mapping) return patch;
  if (patch.subscriptions) patch.subscriptions = mapping.mapSubscriptionNames(patch.subscriptions, accountNames);
  if (patch.agents) patch.agents = patch.agents.map((a) => ({ ...a,
    context: null, ...mapping.mapRosterDetails(a, patch.tasks || S().tasks, actions), ...(details.get(a.id) || {}),
    runMode: histories.has(a.id) ? mapping.mapThread([...histories.get(a.id).values()], a.id, patch.tasks || S().tasks).runMode : null,
    lastOutputAt: histories.has(a.id) ? mapping.mapThread([...histories.get(a.id).values()], a.id, patch.tasks || S().tasks).lastOutputAt : null }));
  if (patch.requests || patch.agents) {
    const previous = new Map(S().requests.map((r) => [r.id, r]));
    patch.requests = (patch.requests || S().requests).filter((r) => r.kind !== 'failed').map((r) => {
      const old = previous.get(r.id);
      return old?.sourceSequence === r.sourceSequence ? { ...r, body: old.body, command: old.command, options: old.options } : r;
    });
    for (const old of previous.values()) if (old.kind !== 'failed' && old.status !== 'open' && !patch.requests.some((r) => r.id === old.id)) patch.requests.push(old);
    patch.requests.push(...(patch.agents || S().agents).flatMap((a) => mapping.mapFailedStart(a) || []));
  }
  return patch;
}
function put(envelope) {
  if (!mapping || !('event' in envelope)) return;
  const e = envelope.event;
  if (['PermissionRequested', 'QuestionAsked'].includes(e._tag)) {
    sources.set(envelope.sequence, envelope);
    if (sources.size > 64) sources.delete(sources.keys().next().value);
  }
  if ('agentId' in e && histories.has(e.agentId)) {
    oversized.get(e.agentId)?.delete(envelope.sequence);
    histories.get(e.agentId).set(envelope.sequence, envelope); publishThread(e.agentId);
  }
}
function publishThread(agentId) {
  const mapped = mapping.mapThread([...histories.get(agentId).values()], agentId, S().tasks);
  engineWrite({ threads: { ...S().threads, [agentId]: [...mapped.items, ...[...(oversized.get(agentId)?.values() || [])]].sort((a, b) => Number(a.id) - Number(b.id)) }, pending: { ...S().pending, [agentId]: mapped.pending },
    agents: S().agents.map((a) => a.id === agentId ? { ...a, lastOutputAt: mapped.lastOutputAt } : a) });
}
export function receive(item) {
  if (!mapping || !item) return;
  if ('event' in item) {
    put(item);
    if (readers && ['client.AlertPromptDismissed', 'client.AlertCarrierChanged'].includes(item.event._tag)) void readPhoneOffer();
    if (readers && item.event._tag.startsWith('Account')) void readAccountNames();
    if (item.event._tag.startsWith('roles.')) {
      actions.push({ ...item.event, sequence: item.sequence }); engineWrite(enrich({ agents: S().agents }));
    }
    if (readers && /Question|Permission|AgentStart|AgentStopped/.test(item.event._tag)) void readRequests();
    if ('agentId' in item.event && histories.has(item.event.agentId)
      && (['TurnEnded', 'SessionOpened'].includes(item.event._tag) || item.event._tag.startsWith('AgentConfiguration'))) void readDetails(item.event.agentId);
  } else if (item._tag === 'client.Oversized') {
    const epoch = generation;
    // Content stays an explicit placeholder until the owner loads it.
    if (item.tag === 'ThreadItem' && histories.has(item.agentId)) {
      if (!oversized.has(item.agentId)) oversized.set(item.agentId, new Map());
      oversized.get(item.agentId).set(item.sequence, { id: String(item.sequence), ts: null,
        type: 'large', title: item.tag, size: `${item.bytes} B`, sequence: item.sequence });
      publishThread(item.agentId);
    } else engine.request('client.event', { sequence: item.sequence }).then((reply) => {
      if (epoch === generation && reply.envelope) receive(reply.envelope);
    }).catch((e) => { if (epoch === generation) notice(e.message); });
  }
}
async function source(sequence) {
  if (sources.has(sequence)) return sources.get(sequence);
  const reply = await engine.request('client.event', { sequence });
  if (!reply.envelope || reply.envelope.sequence !== sequence) throw new Error('The request source is unavailable.');
  return reply.envelope;
}
export async function loadRequest(id) {
  const row = S().requests.find((r) => r.id === id);
  if (!row?.sourceSequence) return;
  return attempt('request:' + id, async () => {
    const epoch = generation;
    const envelope = await source(row.sourceSequence);
    if (epoch !== generation) return;
    sources.set(envelope.sequence, envelope);
    await readRequests();
  });
}
async function readRequests() {
  if (loadingRequests) { requestVersion++; return loadingRequests; }
  const epoch = generation;
  loadingRequests = (async () => {
    let version;
    do {
      version = requestVersion;
      const rows = []; let after = 0;
      for (;;) {
        const reply = await engine.request('client.requests', { after, limit: 100 });
        if (epoch !== generation) return;
        rows.push(...reply.items);
        if (reply.next === undefined) break;
        if (reply.next <= after) throw new Error('The request cursor did not advance.');
        after = reply.next;
      }
      if (version !== requestVersion) continue;
      const requests = rows.flatMap((r) => mapping.mapHomeRequest(r, S().agents, sources.get(r.sourceSequence)) || []);
      requests.push(...S().agents.flatMap((a) => mapping.mapFailedStart(a) || []));
      engineWrite({ requests: requests.map((r) => ({ ...r, blocks: S().tasks.find((t) => t.id === r.task)?.label || null })) });
    } while (version !== requestVersion);
  })().catch((e) => { if (epoch === generation) notice(e.message); }).finally(() => { if (epoch === generation) loadingRequests = null; });
  return loadingRequests;
}
export function watchHome() {
  if (!live.on || !mapping) return;
  readers++; if (S().conn.status === 'live') { void readRequests(); void readPhoneOffer(); void readAccountNames(); }
  return () => { readers--; };
}
export function watchThread(agentId) {
  if (!live.on || !mapping) return;
  const epoch = generation;
  readers++;
  if (!histories.has(agentId)) histories.set(agentId, new Map());
  void attempt('thread:' + agentId, async () => {
    let after = 0;
    for (;;) {
      const reply = await engine.request('client.thread', { agentId, after, limit: 100 });
      if (epoch !== generation) return;
      if (!reply.items) throw new Error('The agent thread is unavailable.');
      for (const item of reply.items) put(item);
      if (reply.next === undefined) break;
      if (reply.next <= after) throw new Error('The thread cursor did not advance.');
      after = reply.next;
    }
    await readRequests();
    // Open request cards need full, authoritative options and text, even if oversized.
    for (const r of S().requests.filter((r) => r.agent === agentId && r.sourceSequence)) {
      const envelope = await source(r.sourceSequence);
      if (epoch !== generation) return;
      sources.set(envelope.sequence, envelope);
    }
    await readRequests();
  });
  void readDetails(agentId); void readAgentActions(agentId);
  const timer = setInterval(() => { void readDetails(agentId); }, 5000);
  return () => { readers--; clearInterval(timer); };
}
async function readDetails(agentId) {
  void readAccountNames();
  const epoch = generation;
  try {
    const [configuration, context] = await Promise.all([engine.request('client.agent.configuration', { agentId }), engine.request('client.agent.context', { agentId })]);
    if (epoch !== generation) return;
    details.set(agentId, mapping.mapAgentDetails({ ...configuration, ...context }));
    engineWrite(enrich({ agents: S().agents }));
  } catch (e) { if (epoch === generation) notice(e.message); }
}
export function watchRoster(projectId) {
  if (!live.on || !mapping) return;
  const epoch = generation;
  let active = true;
  const read = async () => {
    try {
      const collected = []; let after;
      for (;;) {
        const reply = await engine.request('roles.actions.list', { ...(after === undefined ? {} : { after }), limit: 100 });
        if (!active || epoch !== generation) return;
        collected.push(...reply.items);
        if (reply.next === undefined) break;
        if (after !== undefined && reply.next >= after) throw new Error('The actions cursor did not advance.');
        after = reply.next;
      }
      actions = collected; engineWrite(enrich({ agents: S().agents }));
      await Promise.all(S().agents.filter((a) => a.project === projectId).map(async (a) => {
        await readDetails(a.id);
        if (!histories.has(a.id)) histories.set(a.id, new Map());
        let cursor = Math.max(0, ...histories.get(a.id).keys());
        for (;;) {
          const reply = await engine.request('client.thread', { agentId: a.id, after: cursor, limit: 100 });
          if (!active || epoch !== generation) return;
          if (!reply.items) throw new Error('The agent thread is unavailable.');
          for (const item of reply.items) put(item);
          if (reply.next === undefined) break;
          if (reply.next <= cursor) throw new Error('The thread cursor did not advance.');
          cursor = reply.next;
        }
      }));
    } catch (e) { if (active && epoch === generation) notice(e.message); }
  };
  void read(); const timer = setInterval(read, 5000);
  return () => { active = false; clearInterval(timer); };
}
export async function sendMessage(agentId, text, context = [], files = []) {
  if (files.length) { refuse(); return false; }
  if (!text.trim()) return false;
  return attempt('agent:' + agentId, async () => {
    const epoch = generation;
    await engine.request('prompt', { agentId, text: text.trim(), ...(context.length ? { context: context.map((c) => c.reference) } : {}) });
    if (epoch === generation) update((s) => { if (s.drafts['thread:' + agentId] === text) s.drafts['thread:' + agentId] = ''; });
  });
}
export function stopReply(agentId) { return attempt('agent:' + agentId, () => engine.request('cancel-reply', { agentId })); }
export function stopAgent(agentId) {
  const agent = S().agents.find((a) => a.id === agentId);
  const approvals = S().requests.filter((r) => r.agent === agentId && r.kind === 'approval' && r.status === 'open');
  const send = () => attempt('agent:' + agentId, () => engine.request('stop', { agentId }));
  if (agent?.state === 'working' || approvals.length) return confirm({ title: `Stop ${agent.name}?`,
    body: 'The agent stops where it is. Resume continues from its last turn.',
    lost: approvals.length ? [`${approvals.length} waiting approvals will be cancelled`] : [], action: 'Stop agent', onConfirm: send });
  return send();
}
export function resumeAgent(agentId) { return attempt('agent:' + agentId, () => engine.request('resume', { agentId })); }
export function compact(agentId) { return attempt('agent:' + agentId, () => engine.request('compact', { agentId })); }
export function setAgentConfig(agentId, patch) {
  if (Object.keys(patch).some((key) => !['model', 'effort'].includes(key))) { refuse(); return; }
  return attempt('agent:' + agentId, async () => { await engine.request('configure', { agentId, ...patch }); await readDetails(agentId); });
}
export function answerRequest(id, optionId, text) {
  const r = S().requests.find((r) => r.id === id);
  if (!r) return;
  if (r.kind === 'failed') return resumeAgent(r.agent);
  if (!['question', 'approval'].includes(r.kind)) { refuse(); return; }
  return attempt('request:' + id, async () => {
    await engine.request('answer', r.kind === 'approval' ? { kind: 'permission', id, optionId }
      : { kind: 'question', id, text: text || r.options.find((o) => o.id === optionId)?.label || '' });
    await readRequests();
  });
}
export async function searchContext(agent, query) {
  const project = S().projects.find((p) => p.id === agent.project);
  const team = S().teams.find((t) => t.id === agent.team);
  const worktree = S().worktrees.find((w) => w.id === (team?.worktree || project.worktree));
  if (!worktree) return [];
  const reply = await engine.request('project.context.search', { projectId: project.id, worktreeId: worktree.id, query, limit: 12 });
  return mapping.mapContextSearch(reply.result);
}
export function loadLarge(item) {
  return attempt('large:' + item.sequence, async () => {
    const epoch = generation;
    const reply = await engine.request('client.event', { sequence: item.sequence });
    if (epoch !== generation) return;
    if (!reply.envelope) throw new Error('The event is unavailable.');
    put(reply.envelope);
  });
}

export function nudge(agentId) {
  return attempt('agent:' + agentId, () => engine.request('board.post', { direct: { _tag: 'agent', agentId },
    text: 'Status check: what are you on, and is anything in your way?', to: [{ _tag: 'agent', agentId }], reply: 'any' }));
}

async function readPhoneOffer() {
  const epoch = generation;
  try {
    const reply = await engine.request('client.alerts.settings', {});
    if (epoch === generation) engineWrite(mapping.mapPhoneOffer(reply));
  } catch (e) { if (epoch === generation) notice(e.message); }
}
export function declinePhoneOffer() {
  return attempt('phone-offer', async () => { await engine.request('client.alerts.prompt.dismiss', {}); await readPhoneOffer(); });
}

export function connected() { if (mapping && readers) { void readRequests(); void readPhoneOffer(); void readAccountNames(); } }

async function readAgentActions(agentId) {
  const epoch = generation;
  try {
    let after;
    const rows = [];
    for (;;) {
      const reply = await engine.request('roles.actions.list', { agentId, ...(after === undefined ? {} : { after }), limit: 100 });
      if (epoch !== generation) return;
      rows.push(...reply.items);
      if (reply.next === undefined) break;
      if (after !== undefined && reply.next >= after) throw new Error('The actions cursor did not advance.');
      after = reply.next;
    }
    const bySequence = new Map([...rows, ...actions].map((a) => [a.sequence, a]));
    actions = [...bySequence.values()]; engineWrite(enrich({ agents: S().agents }));
  } catch (e) { if (epoch === generation) notice(e.message); }
}

async function readAccountNames() {
  if (accountRead) return accountRead;
  const epoch = generation;
  accountRead = engine.request('accounts', { operation: 'list' }).then((reply) => {
    if (epoch !== generation) return;
    // Retain display fields only, never account environment or secret references.
    accountNames = reply.accounts.map(({ id, harness, displayName }) => ({ id, harness, ...(displayName ? { displayName } : {}) }));
    engineWrite({ subscriptions: mapping.mapSubscriptionNames(S().subscriptions, accountNames) });
  }).catch((e) => { if (epoch === generation) notice(e.message); }).finally(() => { if (epoch === generation) accountRead = null; });
  return accountRead;
}
