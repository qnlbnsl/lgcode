// The mock's small toolkit: rendering, a store, a hash router, and time helpers.
// Rendering comes from Preact and htm (third_party/htm-preact, MIT and Apache-2.0).
import {
  html, render, h, Component, createContext,
  useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer,
} from '../vendor/htm-preact/standalone.module.js';
import { ICONS } from './icons.js';

export {
  html, render, h, Component, createContext,
  useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer,
};

// ---- class names ---------------------------------------------------------
export function cx(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === 'string') out.push(p);
    else if (Array.isArray(p)) out.push(cx(...p));
    else for (const k in p) if (p[k]) out.push(k);
  }
  return out.join(' ');
}

// ---- icons ---------------------------------------------------------------
export function Icon({ name, size = 16, class: cls, title }) {
  const inner = ICONS[name];
  if (!inner) return html`<span class="icon-missing" title=${name}>?</span>`;
  return html`<svg class=${cx('icon', cls)} width=${size} height=${size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden=${title ? null : 'true'} role=${title ? 'img' : null} aria-label=${title || null}
    dangerouslySetInnerHTML=${{ __html: inner }}></svg>`;
}

// ---- store ---------------------------------------------------------------
// One mutable state object. `update` runs a mutation and tells every subscriber.
const listeners = new Set();
export const store = { state: null };
let scheduled = false;
export function notify() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; for (const l of [...listeners]) l(); });
}
export function update(fn) {
  if (!live.on) { fn(store.state); notify(); return; }
  // In live mode, a change that the engine does not take yet is refused as a whole. Nothing
  // else changes in the same turn either, so no "Saved" or success notice follows it.
  if (live.refusedTurn) return;
  try { fn(store.state); } catch (e) { if (!refusal(e)) throw e; refuse(); }
  notify();
}

// ---- live mode -------------------------------------------------------------
// In live mode the engine owns the records in the store. The connection writes them through
// engineWrite(), and they are frozen, so a screen that tries to change one is refused, with
// a short notice, instead of changing the browser's copy. The page's own state, such as the
// preferences, the open dialog and the drafts, stays writable.
export const ENGINE_OWNED = new Set([
  'session', 'conn', 'owner', 'machines', 'subscriptions', 'repos', 'projects', 'teams', 'agents', 'epics', 'sprints', 'tasks',
  'requests', 'channels', 'posts', 'worktrees', 'workflow', 'mocks', 'design', 'notifications', 'settings',
]);
export const live = { on: false, refusedTurn: false, onRefuse: null };
let engineWriting = false;
class Refused extends Error {}
export function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const k of Object.keys(value)) freeze(value[k]); }
  return value;
}
// Wraps the live store, so that only engineWrite() can replace a record the engine owns.
export function guardStore(state) {
  for (const k of ENGINE_OWNED) if (k in state) freeze(state[k]);
  return new Proxy(state, {
    // Writing back the value a key already holds changes nothing, so it is allowed.
    set(target, key, value) { if (ENGINE_OWNED.has(key) && !engineWriting && target[key] !== value) throw new Refused(String(key)); target[key] = value; return true; },
    deleteProperty(target, key) { if (ENGINE_OWNED.has(key) && !engineWriting) throw new Refused(String(key)); delete target[key]; return true; },
  });
}
// The connection's only way to change the records it owns. Each value it writes is frozen.
export function engineWrite(patch) {
  engineWriting = true;
  try { for (const [k, v] of Object.entries(patch)) store.state[k] = freeze(v); } finally { engineWriting = false; }
  notify();
}
// True for the error a refused change throws: a write to a frozen record, or a replaced one.
export function refusal(e) {
  return e instanceof Refused || (e instanceof TypeError && /read[- ]only|not extensible|Cannot (add|delete|define|assign)|can't (define|delete|assign)/i.test(e.message));
}
export function refuse() {
  if (live.refusedTurn) return;
  live.refusedTurn = true;
  setTimeout(() => { live.refusedTurn = false; }, 0);
  live.onRefuse?.();
}
export function useStore() {
  const [, bump] = useReducer((n) => n + 1, 0);
  useLayoutEffect(() => { listeners.add(bump); return () => listeners.delete(bump); }, []);
  return store.state;
}

// ---- router --------------------------------------------------------------
// The address after # is the route, so a refresh or a shared link keeps the place.
export function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts, query: new URLSearchParams(query), path: '/' + parts.join('/') };
}
export function go(path) {
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === target) return;
  location.hash = target;
}
export function href(path) { return '#' + (path.startsWith('/') ? path : '/' + path); }
export function useRoute() {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

// ---- time ----------------------------------------------------------------
// The mock's clock is real time, so waits grow while the page is open.
export const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export function ago(ts, now = Date.now()) {
  const d = Math.max(0, now - ts);
  if (d < MIN) return 'now';
  if (d < HOUR) return Math.floor(d / MIN) + ' min';
  if (d < DAY) { const hrs = Math.floor(d / HOUR), m = Math.floor((d % HOUR) / MIN); return m && hrs < 6 ? `${hrs} hr ${m} min` : `${hrs} hr`; }
  const days = Math.floor(d / DAY);
  return days === 1 ? '1 day' : days + ' days';
}
export function clock(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}
export function dayLabel(ts, now = Date.now()) {
  const a = new Date(ts), b = new Date(now);
  const same = a.toDateString() === b.toDateString();
  if (same) return 'Today';
  const y = new Date(now - DAY);
  if (a.toDateString() === y.toDateString()) return 'Yesterday';
  return a.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
export function useNow(every = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [every]);
  return now;
}

// ---- small helpers -------------------------------------------------------
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
export function uid(prefix = 'id') { return prefix + '-' + Math.random().toString(36).slice(2, 9); }
export function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
export function persist(key, fallback) {
  try { const v = localStorage.getItem('lgtm-mock:' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
// True when the page is drawn inside a frame on the repository Design page. A framed copy
// never writes to storage, so it cannot change the page around it.
export const FRAMED = (() => { try { return window.top !== window.self; } catch { return true; } })();
export function remember(key, value) {
  if (FRAMED) return;
  try { localStorage.setItem('lgtm-mock:' + key, JSON.stringify(value)); } catch { /* storage is optional */ }
}
export function useMedia(query) {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => { const m = matchMedia(query); const f = () => setOn(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, [query]);
  return on;
}
export function useKey(handler, deps = []) {
  useEffect(() => { addEventListener('keydown', handler); return () => removeEventListener('keydown', handler); }, deps);
}
export function useOutside(ref, onOutside, active = true) {
  useEffect(() => {
    if (!active) return;
    const f = (e) => { if (ref.current && !ref.current.contains(e.target)) onOutside(e); };
    const t = setTimeout(() => addEventListener('pointerdown', f), 0);
    return () => { clearTimeout(t); removeEventListener('pointerdown', f); };
  }, [active]);
}
