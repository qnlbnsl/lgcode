// Live actions for Git and the service pages. Only replies and fresh reads write records.
import { store, live, engineWrite, update, notify, refuse, go } from '../lib.js';
import * as engine from '../engine.js';
import * as act from '../actions.js';
import { HARNESSES } from '../data.js';
let mapping;
export function installMappings(value) { mapping = value; }
const S = () => store.state;
export const busy = (key) => !!S()?.ui?.gitPending?.[key];
const pending = (key, value) => { S().ui.gitPending ||= {}; S().ui.gitPending[key] = value; notify(); };
export async function run(key, work) {
  if (busy(key)) return false;
  pending(key, true);
  const state = S();
  try { await work(); return true; }
  catch (e) { if (state === S() && S().session.status === 'in') act.toast(e.message || 'The service did not complete the request.', 'error'); return false; }
  finally { if (state === S()) pending(key, false); }
}
const request = (tag, payload = {}) => engine.request(tag, payload);
const settingsPatch = (patch) => engineWrite({ settings: { ...S().settings, ...patch } });
let service;
let accounts;
let statuses;
let subscriptionsLoaded = false;
let screen;
let revision = 0;
let refreshTimer;
let retryPending;
// A connection snapshot can replace the skeletons. Keep already-read detail while refreshing.
export function observe(patch) {
  if (patch.session && patch.session.status !== 'in') {
    service = accounts = statuses = retryPending = undefined; subscriptionsLoaded = false; S().ui.serviceReady = false; revision++; clearTimeout(refreshTimer);
    Object.assign(patch, { notifications: [], settings: { ntfyServer: '', ntfyTopic: '', ntfyToken: '', tokenSet: false, ntfyEnabled: false, email: {}, notifyOn: {}, quiet: {} } });
  }
  if (patch.worktrees) patch.worktrees = patch.worktrees.map((w) => ({ ...w, ...(S().worktrees?.find((x) => x.id === w.id && x.folder === w.folder && x.branch === w.branch) || {}), ...Object.fromEntries(Object.entries(w).filter(([k]) => !['files', 'commits', 'ahead', 'behind', 'merge'].includes(k))) }));
  if (patch.subscriptions && subscriptionsLoaded) patch.subscriptions = S().subscriptions;
  if (screen && (patch.conn?.status === 'live' || patch.projects)) {
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refreshScreen(), 100);
  }
}
export function openScreen(name, project) {
  if (!live.on) return () => {};
  screen = { name, project };
  void refreshScreen();
  const refresh = () => { if (screen) void refreshScreen(); };
  addEventListener('focus', refresh);
  return () => { screen = undefined; revision++; clearTimeout(refreshTimer); removeEventListener('focus', refresh); };
}
async function refreshScreen() {
  if (!mapping || !screen || S().session.status !== 'in') return;
  if (screen.name === 'git') return refreshGit(screen.project);
  if (busy('read-service')) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshScreen, 200); return; }
  return run('read-service', () => loadService(screen?.name));
}
async function loadService(name) {
  const version = revision;
  if (name === 'notifications' || name === 'phone-offer') {
    const settings = await request('client.alerts.settings');
    if (name === 'phone-offer') {
      if (version === revision && S().session.status === 'in') {
        settingsPatch(mapping.mapAlertSettings(settings));
        engineWrite({ phoneOffer: mapping.mapPhoneOffer(settings) });
      }
      return;
    }
    const items = []; let after = 0;
    for (;;) { const page = await request('client.alerts.list', { after, limit: 200 }); items.push(...page.items); if (page.next === undefined || page.next <= after) break; after = page.next; }
    const requests = []; after = 0;
    for (;;) { const page = await request('client.requests', { after, limit: 200 }); requests.push(...page.items); if (page.next === undefined || page.next <= after) break; after = page.next; }
    if (version !== revision || S().session.status !== 'in') return;
    settingsPatch(mapping.mapAlertSettings(settings));
    engineWrite({ notifications: mapping.mapAlerts(items, S().agents, requests), phoneOffer: mapping.mapPhoneOffer(settings) });
    return;
  }
  const [accountReply, harnessReply, project, roles, web, roleFile, snapshot] = await Promise.all([
    request('accounts', { operation: 'list' }), request('harnesses', { operation: 'list' }), request('project.settings'),
    request('roles.settings.get'), request('client.web.settings'), request('roles.role-file.get'), request('client.snapshot')
  ]);
  if (version !== revision || S().session.status !== 'in') return;
  service = { harnesses: harnessReply.harnesses, project: project.settings, roles: roles.settings, web, roleFile: roleFile.file };
  accounts = accountReply.accounts; statuses = snapshot.accounts;
  Object.keys(HARNESSES).forEach((k) => { delete HARNESSES[k]; });
  Object.assign(HARNESSES, mapping.mapHarnesses(service.harnesses));
  settingsPatch(mapping.mapServiceSettings(service.project, service.harnesses, service.roles, service.web, service.roleFile));
  engineWrite({ subscriptions: mapping.mapAccounts(accounts, statuses, service.harnesses, service.project) });
  subscriptionsLoaded = true; S().ui.serviceReady = true; notify();
}
export const accountAction = (id, operation, patch = {}) => run('subscriptions', async () => {
  const account = accounts?.find((a) => a.id === id);
  if (!account) throw new Error('Refresh subscriptions before changing this account.');
  await request('accounts', operation === 'set' ? { operation, account: { ...account, ...patch } } : { operation, accountId: id });
  await loadService('subscriptions');
});
export const addAccount = (harness, name) => run('subscriptions', async () => {
  await request('accounts', { operation: 'add', account: { id: 'account-' + crypto.randomUUID(), harness, displayName: name, enabled: true } });
  await loadService('subscriptions'); act.closeDialog();
});
export const makeDefault = (id) => run('subscriptions', async () => {
  const account = accounts?.find((a) => a.id === id), h = service?.harnesses.find((h) => h.id === account?.harness);
  if (!service?.project || !h) throw new Error('Configure project lead defaults first.');
  const lead = service.project.lead?.harness === h.id ? service.project.lead : { harness: h.id, permission: h.defaultPermission,
    ...(h.defaultModel ? { model: h.defaultModel } : {}), ...(h.defaultEffort ? { effort: h.defaultEffort } : {}) };
  await request('project.settings.set', { settings: { ...service.project, lead: { ...lead, account: { _tag: 'named', accountId: id } } } });
  await loadService('subscriptions');
});
export const accountModel = (harness, model) => run('subscriptions', async () => {
  const h = service?.harnesses.find((x) => x.id === harness);
  if (!h) throw new Error('Refresh harness settings first.');
  await request('harnesses', { operation: 'set', harness: { ...h, defaultModel: model } }); await loadService('subscriptions');
});
export const markAvailable = (id) => run('subscriptions', async () => { await request('accounts mark-available', { accountId: id }); await loadService('subscriptions'); });
export const saveSettings = (patch) => run('settings', async () => {
  if (!service) throw new Error('Wait for the service settings to load.');
  const key = Object.keys(patch)[0];
  const limits = { stallWorker: 'stallMinutes', capacityBackoff: 'capacityBackoffMinutes', capacityRetries: 'capacityRetries', crashRetries: 'crashRetries', teamIdle: 'teamIdleMinutes' };
  if (key in limits || ['stallWatch', 'standingRules'].includes(key)) {
    const settings = key in limits ? { ...service.roles, limits: { ...service.roles.limits, [limits[key]]: patch[key] } } : { ...service.roles, [key]: patch[key] };
    await request('roles.settings.set', { settings });
  } else if (['defaultHarness', 'defaultModel', 'defaultEffort', 'defaultPermission'].includes(key)) {
    if (!service.project) throw new Error('Configure the project workspace and shell first.');
    const h = service.harnesses.find((h) => h.id === (patch.defaultHarness || service.project.lead?.harness));
    if (!h) throw new Error('Choose a harness first.');
    const permission = { 'Read only': 'read-only', 'Ask before every change': 'ask', 'Edit files without asking': 'edit', 'Full access': 'full' };
    const lead = key === 'defaultHarness' || !service.project.lead ? { harness: h.id, account: { _tag: 'any' }, permission: h.defaultPermission,
      ...(h.defaultModel ? { model: h.defaultModel } : {}), ...(h.defaultEffort ? { effort: h.defaultEffort } : {}) } : { ...service.project.lead };
    if (key === 'defaultModel') lead.model = patch[key];
    if (key === 'defaultEffort') lead.effort = patch[key];
    if (key === 'defaultPermission') lead.permission = permission[patch[key]];
    await request('project.settings.set', { settings: { ...service.project, lead } });
  } else if (key === 'webEnabled') {
    const { requestId, serverState, ...previous } = service.web;
    const settings = { ...previous, enabled: patch.webEnabled, port: patch.port, heartbeatSeconds: patch.checkIn, proxyMode: patch.proxyMode };
    if (patch.publicAddress) settings.publicAddress = patch.publicAddress; else delete settings.publicAddress;
    await request('client.web.settings.set', { settings });
  } else { refuse(); return; }
  await loadService('settings');
});
export const saveCarrier = (form) => run('notifications', async () => {
  const carrier = form.server ? { _tag: 'ntfy', server: form.server, topic: form.topic } : { _tag: 'none' };
  await request('client.alerts.carrier.set', { carrier });
  if (carrier._tag === 'none') await request('client.alerts.carrier.clear-token');
  else if (form.token) await request('client.alerts.carrier.set-token', { origin: new URL(form.server).origin, nonce: crypto.randomUUID(), value: form.token });
  await loadService('notifications');
});
export const clearToken = () => run('notifications', async () => { await request('client.alerts.carrier.clear-token'); await loadService('notifications'); });
export const notifyKind = (kind, push) => run('notifications', async () => {
  await request('client.alerts.settings.set', { kind: kind === 'failed' ? 'failure' : kind, push }); await loadService('notifications');
});
export const sendTest = (name = 'ntfy') => run('notifications', async () => {
  const r = await request('client.alerts.test', { name });
  if (!r.accepted) throw new Error(r.reason === 'token missing' ? 'Set a password or access token first.' : r.reason === 'service missing' ? 'Configure this carrier first.' : 'The carrier delivery failed. Check your settings and try again.');
  act.toast(name === 'email' ? 'Your mail server accepted the test email.' : 'The ntfy server accepted the test notification.');
});
export const saveEmail = (form) => run('notifications', async () => {
  const { secret, enabled, tokenSet, ...fields } = form;
  const carrier = { _tag: 'email', host: fields.host.trim(), port: Number(fields.port), security: fields.security, username: fields.username.trim(), from: fields.from.trim(), to: fields.to.trim() };
  await request('client.alerts.carrier.set', { carrier });
  if (secret) await request('client.alerts.carrier.set-token', { name: 'email', origin: JSON.stringify([carrier.host, carrier.port, carrier.security, carrier.username]), nonce: crypto.randomUUID(), value: secret });
  await loadService('notifications');
});
export const carrierEnabled = (name, enabled) => run('notifications', async () => { await request('client.alerts.carrier.enabled.set', { name, enabled }); await loadService('notifications'); });
export const clearEmailSecret = () => run('notifications', async () => { await request('client.alerts.carrier.clear-token', { name: 'email' }); await loadService('notifications'); });
export const saveQuiet = (quiet) => run('notifications', async () => {
  await request('client.alerts.quiet.set', { quiet: { enabled: quiet.on, start: quiet.from, end: quiet.to, timeZone: quiet.timeZone, failureOverride: quiet.failed } }); await loadService('notifications');
});
export const retryAlert = (n) => run('notifications', async () => {
  if (retryPending && retryPending.alertId !== n.id) throw new Error('Recover the pending notification retry first.');
  retryPending ||= { alertId: n.id, generation: n.generation, attempt: n.attempt, ...(n.carrier ? { name: n.carrier } : {}) };
  let r;
  try { r = await request('client.alerts.retry', retryPending); }
  catch (e) { if (e.refused) retryPending = undefined; throw e; }
  retryPending = undefined;
  await loadService('notifications');
  if (!r.accepted) throw new Error(r.reason);
});
export const dismissAlerts = () => run('notifications', async () => { for (const n of S().notifications.filter((n) => !n.read)) await request('client.alerts.dismiss', { alertId: n.id }); await loadService('notifications'); });
export const dismissOffer = () => run('notifications', async () => { await request('client.alerts.prompt.dismiss'); await loadService('notifications'); });
// Git reads and actions follow below.
const wt = (id) => S().worktrees.find((w) => w.id === id);
const scope = (w) => ({ worktreeId: w.id });
const read = (reply) => { if (!('result' in reply)) throw new Error('The service returned no usable Git record.'); return reply.result; };
const writeWt = (id, patch) => engineWrite({ worktrees: S().worktrees.map((w) => w.id === id ? { ...w, ...patch } : w) });
function local(w) { if (!w || w.machine !== 'local') throw new Error('Git is available only for a workspace on local.'); }
function destination(w) { return S().worktrees.find((x) => x.repo === w.repo && x.id === w.parentId); }
async function loadGit(project) {
  if (!mapping) return;
  const version = revision;
  const list = S().worktrees.filter((w) => w.project === project || w.kind === 'base' && w.repo === S().projects.find((p) => p.id === project)?.repo);
  for (const w of list) {
    local(w);
    const state = read(await request('project.git.state', { ...scope(w), ...(w.parent ? { target: w.parent } : {}) }));
    const changes = read(await request('project.changes', scope(w)));
    if (version !== revision || S().session.status !== 'in') return;
    const files = mapping.mapGitChanges(changes.items);
    const merge = state.mergeHead || changes.items.some((x) => x.conflict) ? { from: state.mergeHead || '', by: null, startedAt: null, files: changes.items.filter((x) => x.conflict).map((x) => ({ ...(w.merge?.files.find((f) => f.path === x.path) || {}), id: x.path, path: x.path, parts: w.merge?.files.find((f) => f.path === x.path)?.parts || [], resolved: false, loaded: false })) } : null;
    writeWt(w.id, { ...mapping.mapGitState(state, w.parent), files, merge, ready: !changes.truncated, truncated: changes.truncated });
    if (w.kind === 'project') {
      const status = read(await request('project.review.status', { ...scope(w), projectId: project }));
      if (version !== revision) return;
      if (status.review) {
        const fresh = mapping.mapMainReview(status.review, undefined, S().projects.find((p) => p.id === project)?.lead || '');
        const old = wt(w.id).review;
        const review = old?.id === fresh.id && old.head === fresh.head && old.baseHead === fresh.baseHead ? { ...old, ...fresh, files: old.files, evidence: { ...old.evidence, tests: fresh.evidence.tests, review: fresh.evidence.review } } : fresh;
        writeWt(w.id, { review, merged: status.review.outcome === 'merged' && status.review.head === state.head ? status.review.decidedAt : null });
      }
    }
  }
  const selected = list.find((w) => w.branch === S().inspecting[project]) || list.find((w) => w.kind === 'project') || list[0];
  if (selected) await loadGitDetail(selected.id);
}
async function loadGitDetail(id, selectedCommit) {
  const w = wt(id); local(w); const version = revision;
  const ui = S().gitUi[id] || {}, tab = ui.tab || (w.merge ? 'conflicts' : 'changes');
  if (tab === 'history') {
    const [history, branches] = await Promise.all([request('project.history', { ...scope(w), limit: 200 }), request('project.branches', { repoId: w.repo })]);
    if (version !== revision) return;
    const commits = read(history).items.map((c) => mapping.mapGitCommit(c, read(branches).items));
    writeWt(id, { commits, historyTruncated: read(history).truncated });
    const commit = selectedCommit || ui.commit || commits[0]?.hash;
    if (commit) {
      const files = mapping.mapCommitFiles(read(await request('project.commit.files', { ...scope(w), commit })).items);
      for (let i = 0; i < files.length; i++) files[i] = { ...files[i], ...mapping.mapGitDiff(read(await request('project.diff', { ...scope(w), path: files[i].path, commit }))), loaded: true };
      if (version !== revision) return;
      writeWt(id, { commits: wt(id).commits.map((c) => c.hash === commit ? { ...c, files, loaded: true } : c) });
    }
  } else if (tab === 'conflicts' && w.merge) {
    const files = [];
    for (const f of w.merge.files) {
      const conflict = read(await request('project.conflict', { ...scope(w), path: f.path }));
      const old = wt(id)?.merge?.files.find((x) => x.id === f.id);
      if (old?.selection?.fingerprint === conflict.fingerprint && old.selection.head === conflict.head) conflict.choices = old.selection.choices;
      files.push({ ...mapping.mapConflict(conflict), loaded: true });
    }
    if (version !== revision) return;
    writeWt(id, { merge: { ...w.merge, files } });
  } else {
    const files = [];
    for (const f of w.files) files.push(f.conflict ? f : { ...f, ...mapping.mapGitDiff(read(await request('project.diff', { ...scope(w), path: f.path, staged: f.staged }))), loaded: true });
    if (version !== revision) return;
    writeWt(id, { files });
  }
}
export function refreshGit(project = screen?.project) { return run('git', () => loadGit(project)); }
export function gitDetail(id, commit) { return run('git', () => loadGitDetail(id, commit)); }
export function selectGit(id, tab, commit) {
  update((s) => { const w = wt(id); s.inspecting[w.project || screen?.project] = w.branch; s.gitUi[id] = { ...s.gitUi[id], ...(tab ? { tab } : {}), ...(commit ? { commit } : {}) }; });
  return gitDetail(id, commit);
}
export function stage(id, ids, staged, all = false) { return run('git', async () => {
  const w = wt(id); local(w); revision++;
  if (all) await request(staged ? 'project.stage.all' : 'project.unstage.all', scope(w));
  else for (const fid of ids) { const f = w.files.find((f) => f.id === fid); if (f) await request(staged ? 'project.stage' : 'project.unstage', { ...scope(w), path: f.path }); }
  await loadGit(screen?.project);
}); }
export function discard(w, files) { return run('git-plan', async () => {
  local(w);
  const plan = read(await request('project.discard.plan', { ...scope(w), paths: [...new Set(files.map((f) => f.path))] }));
  act.confirm({ title: 'Discard changes?', body: 'The planned changes will be discarded. This cannot be undone.', lost: plan.paths, action: 'Discard', onConfirm: () => run('git', async () => {
    revision++; await request('project.discard', { ...scope(w), plan, confirmed: true }); await loadGit(screen?.project);
  }) });
}); }
export function commit(id, message) { return run('git', async () => {
  const w = wt(id); local(w); revision++;
  await request('project.commit', { ...scope(w), message });
  update((s) => { s.gitUi[id] = { ...s.gitUi[id], message: '' }; });
  await loadGit(screen?.project);
}); }
export function syncGit(id, operation) { return run('git', async () => {
  const w = wt(id); local(w); revision++;
  try { await request('project.' + operation, scope(w)); } finally { await loadGit(screen?.project); }
}); }
export function integrate(id) { return run('git', async () => {
  const w = wt(id); local(w); const target = destination(w); local(target);
  if (w.kind !== 'team') { refuse(); return; }
  revision++;
  try { await request('project.integrate', { ...scope(w), destinationId: target.id, expectedHead: w.head }); } finally { await loadGit(screen?.project); }
}); }
export function openReview(w, project) { return run('git', async () => {
  local(w); const target = destination(w); local(target); revision++;
  const prepared = read(await request('project.review.prepare', { ...scope(w), projectId: project.id, destinationId: target.id }));
  writeWt(w.id, { review: mapping.mapMainReview(prepared.review, prepared.comparison, project.lead) });
  act.openDialog({ type: 'merge-review', worktreeId: w.id, requestId: prepared.review.reviewId });
}); }
export function answerReview(id, option) {
  if (option !== 'merge') { refuse(); return; }
  return run('git', async () => {
    const w = S().worktrees.find((w) => w.review?.id === id); local(w); const r = w.review; revision++;
    const review = read(await request('project.review.approve', { ...scope(w), projectId: r.project, reviewId: r.id, expectedHead: r.head, expectedBaseHead: r.baseHead, confirmed: true,
      decision: r.evidence.tests.ok && r.evidence.review.ok ? 'approve' : 'approve_without_evidence' }));
    writeWt(w.id, { review: mapping.mapMainReview(review, undefined, r.agent) });
    if (review.outcome === 'merged') act.closeDialog();
    await loadGit(r.project);
    if (review.outcome !== 'merged') throw new Error(review.reason || 'The merge was refused.');
  });
}
export function choose(id, fid, kid, choice) { return run('git', async () => {
  const w = wt(id); local(w); const file = w.merge.files.find((f) => f.id === fid), part = file.parts.find((p) => p.id === kid);
  if (!choice || !file?.selection) { refuse(); return; }
  const conflict = read(await request('project.conflict.choose', { ...scope(w), selection: file.selection, hunk: part.hunk, choice }));
  writeWt(id, { merge: { ...w.merge, files: w.merge.files.map((f) => f.id === fid ? { ...mapping.mapConflict(conflict), loaded: true } : f) } });
}); }
export function resolve(id, fid, value) {
  if (!value) { refuse(); return; }
  return run('git', async () => {
    const w = wt(id); local(w); const f = w.merge.files.find((x) => x.id === fid); revision++;
    await request('project.conflict.resolve', { ...scope(w), selection: f.selection });
    update((s) => { s.gitUi[id] = { ...s.gitUi[id], tab: 'changes' }; });
    await loadGit(screen?.project);
    act.toast('File resolved. Stage it before continuing the merge.');
  });
}
export function continueMerge(id) {
  const message = S().gitUi[id]?.message?.trim();
  if (!message) { act.toast('Write the merge commit message in Changes, then stage the resolved files.', 'error'); return; }
  return commit(id, message);
}
