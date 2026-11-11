// The login page and the three first-run pages. LGcode has one user and one password,
// so there is no user name, no account and no pairing here.
import { html, useState, useEffect, useRef, Icon, cx, update, go, href, parseRoute } from '../lib.js';
import { HARNESSES, machineOf } from '../data.js';
import * as act from '../actions.js';

const LOOPBACK = /^(localhost|127(\.\d+){3}|\[::1\])$/;
// The service accepts sign-in only over HTTPS or from the computer it runs on.
function insecureOrigin() {
  if (parseRoute().query.get('insecure') === '1') return true;
  return location.protocol !== 'https:' && !LOOPBACK.test(location.hostname);
}
function Brand({ sub }) {
  return html`<div class="auth-brand"><span class="auth-mark">LG</span><div><h1>LGcode</h1>${sub && html`<p>${sub}</p>`}</div></div>`;
}
function Spinner({ size = 14 }) { return html`<${Icon} name="loader-circle" size=${size} class="auth-spin" />`; }

// ---- login --------------------------------------------------------------------
export function Login({ s }) {
  const status = s.session.status; // out | rejected | expired | unavailable | in
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [caps, setCaps] = useState(false);
  const field = useRef(null);
  const insecure = insecureOrigin();
  const master = s.machines.find((m) => m.role === 'master') || s.machines[0];
  const down = status === 'unavailable';
  const blocked = insecure || down;
  useEffect(() => { if (!blocked) field.current?.focus(); }, [status, blocked]);

  const submit = (e) => {
    e.preventDefault();
    if (blocked || busy) return;
    if (!pw) { setEmpty(true); field.current?.focus(); return; }
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      if (pw.trim().toLowerCase() === 'wrong') { setPw(''); act.setSession('rejected'); return; }
      act.setSession('in');
      go(s.session.firstRun ? '/setup' : '/home');
    }, 700);
  };
  const retry = () => { setRetrying(true); setTimeout(() => { setRetrying(false); act.setSession('out'); act.toast('The service is answering again'); }, 1200); };
  const typed = (e) => { setPw(e.target.value); setEmpty(false); if (status === 'rejected') act.setSession('out'); };
  const error = empty ? 'Enter the password.' : status === 'rejected' ? 'That password is wrong. Nothing was signed in.' : null;

  return html`<main class="auth">
    <div class="auth-card">
      <${Brand} sub=${`Sign in to the service on ${master.name}`} />

      ${status === 'expired' && !insecure && html`<div class="callout info" role="status"><${Icon} name="clock" size=${14} /><span>You were signed out because the session expired. Sign in again and you return to where you were.</span></div>`}
      ${down && !insecure && html`<div class="callout error" role="alert"><${Icon} name="wifi-off" size=${14} />
        <span class="grow"><b>The service is not answering.</b> This page could not reach <span class="mono">${master.address}</span>. Agents that were running keep running. Start the service again with <span class="mono">lgcode serve --detach</span>.</span></div>`}
      ${insecure && html`<div class="callout warn" role="alert"><${Icon} name="shield-alert" size=${14} />
        <span><b>This page is not on a secure connection.</b> LGcode accepts the password only over HTTPS, or from the computer the service runs on. Open the HTTPS address, or forward the port and open <span class="mono">127.0.0.1</span>.</span></div>`}

      <form class="auth-form" onSubmit=${submit} novalidate>
        <div class="field">
          <label for="login-password">Password</label>
          <div class="auth-pass">
            <input ref=${field} id="login-password" class=${cx('input lg', error && 'invalid')} type=${show ? 'text' : 'password'} value=${pw} autocomplete="current-password"
              aria-invalid=${!!error} aria-describedby="login-note" disabled=${blocked || busy} onInput=${typed}
              onKeyUp=${(e) => setCaps(!!e.getModifierState?.('CapsLock'))} />
            <button type="button" class="icon-btn" aria-label=${show ? 'Hide the password' : 'Show the password'} aria-pressed=${show} disabled=${blocked} onClick=${() => { setShow(!show); field.current?.focus(); }}>
              <${Icon} name=${show ? 'eye-off' : 'eye'} size=${15} /></button>
          </div>
          <span id="login-note" class=${error ? 'error' : 'hint'} role=${error ? 'alert' : null}>
            ${error || (caps ? html`<span class="warn-text">Caps Lock is on.</span>` : html`The one password set on the service as <span class="mono">LGCODE_WEB_PASSWORD</span>.`)}</span>
        </div>
        ${down
          ? html`<button type="button" class="btn lg block" disabled=${retrying} onClick=${retry}>${retrying ? html`<${Spinner} /><span>Trying…</span>` : html`<${Icon} name="refresh-cw" size=${14} /><span>Try again</span>`}</button>`
          : html`<button type="submit" class="btn primary lg block" disabled=${blocked || busy}>${busy ? html`<${Spinner} /><span>Signing in…</span>` : html`<span>Sign in</span>`}</button>`}
      </form>

      <div class="auth-foot">
        <span class="auth-conn"><i class=${cx('dot', down ? 'failed' : insecure ? 'waiting' : 'working')}></i>${down ? 'Service unreachable' : insecure ? 'Sign-in is blocked on this connection' : 'Service reachable'}</span>
        <span class="mono">${insecure ? location.host : master.address}</span>
      </div>
    </div>
  </main>`;
}

// ---- first run ------------------------------------------------------------------
const STEPS = ['Subscription', 'Repository', 'First project'];
const PLANS = { claude: 'Max', codex: 'Pro' };
const CODES = { claude: 'WXKP-3QHD', codex: 'R7MN-42TC' };

function Steps({ step, go: goTo, reach }) {
  return html`<ol class="auth-steps" aria-label="Setup steps">
    ${STEPS.map((label, i) => html`<li key=${label} class=${cx(i < step && 'done', i === step && 'now')} aria-current=${i === step ? 'step' : null}>
      <button type="button" disabled=${i > reach} onClick=${() => goTo(i)}>
        <span class="mark">${i < step ? html`<${Icon} name="check" size=${11} />` : i + 1}</span><span class="word">${label}</span>
      </button></li>`)}
  </ol>`;
}

function checkPath(raw, s) {
  const path = raw.trim().replace(/\/+$/, '');
  if (!path) return { error: 'Enter the folder that holds the repository.' };
  if (!/^(~|\/)/.test(path)) return { error: 'Use a full path, such as ~/projects/my-app.' };
  const name = path.split('/').pop();
  if (!name || name === '~' || path.split('/').length < 3) return { error: 'That is a folder of projects, not one repository. Add the repository folder to the path.' };
  if (/\s/.test(name)) return { error: 'No Git repository was found there. Check the spelling of the folder.' };
  const known = s.repos.find((r) => Object.values(r.folders).includes(path)) || s.repos.find((r) => r.name === name);
  return known
    ? { name: known.name, repo: known.id, branch: known.main, remote: known.remote, commits: known.id === 'lgcode' ? '1,204' : '386', path }
    : { name, repo: null, branch: 'main', remote: null, commits: '57', path };
}

export function FirstRun({ s }) {
  const master = s.machines.find((m) => m.role === 'master') || s.machines[0];
  const [step, setStep] = useState(0);
  const [reach, setReach] = useState(0);
  const [harness, setHarness] = useState('claude');
  const [signin, setSignin] = useState({}); // harness -> 'waiting' | 'done'
  const [path, setPath] = useState(master.workspace + '/');
  const [checked, setChecked] = useState(null); // result of the folder check
  const [checking, setChecking] = useState(false);
  const [gitModel, setGitModel] = useState(s.settings.gitModel || 'Haiku 5.5');
  const [goal, setGoal] = useState('');
  const [tried, setTried] = useState(false);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  const to = (i) => { setTried(false); setStep(i); setReach((r) => Math.max(r, i)); };
  const connected = Object.keys(signin).filter((h) => signin[h] === 'done');
  const startSignin = (h) => { setSignin((v) => ({ ...v, [h]: 'waiting' })); later(() => setSignin((v) => (v[h] === 'waiting' ? { ...v, [h]: 'done' } : v)), 2600); };
  const cancelSignin = (h) => setSignin((v) => { const n = { ...v }; delete n[h]; return n; });

  // The folder is checked a moment after typing stops.
  useEffect(() => {
    if (step !== 1) return;
    setChecking(true); setChecked(null);
    const t = setTimeout(() => { setChecking(false); setChecked(checkPath(path, s)); }, 550);
    return () => clearTimeout(t);
  }, [path, step]);
  const found = checked && !checked.error ? checked : null;
  const suggestions = s.repos.filter((r) => r.folders[master.id]).map((r) => r.folders[master.id]);
  const goalError = !goal.trim() ? 'Write the goal.' : null;

  const finish = () => {
    setTried(true);
    if (goalError || !found) return;
    const sub = s.subscriptions.find((x) => x.harness === (connected.includes(harness) ? harness : connected[0]) && x.signedIn) || s.subscriptions[0];
    act.setSession('in');
    update((st) => { st.session.firstRun = false; st.settings.gitModel = gitModel; });
    act.createProject({ repo: found.repo, newRepo: found.repo ? null : found.name, goal: goal.trim(), machine: master.id, subscription: sub.id });
  };
  const next = (e) => {
    e?.preventDefault();
    setTried(true);
    if (step === 0 && connected.length) to(1);
    else if (step === 1 && found) to(2);
    else if (step === 2) finish();
  };
  const skipAll = () => { act.setSession('in'); go('/home'); };

  let body;
  if (step === 0) {
    body = html`
      <h2>Connect a subscription</h2>
      <p class="auth-lede">Agents run through a coding harness that you already pay for. Sign in to one now. You can add more later under Subscriptions.</p>
      <div class="auth-options" role="radiogroup" aria-label="Harness">
        ${Object.entries(HARNESSES).map(([id, h]) => {
          const state = signin[id]; const on = harness === id;
          return html`<div key=${id} class=${cx('auth-option', on && 'on', state === 'done' && 'done')}>
            <button type="button" class="auth-option-head" role="radio" aria-checked=${on} onClick=${() => setHarness(id)}>
              <span class="radio"></span>
              <span class="grow"><b>${h.name}</b><small>${h.models.slice(0, 3).join(', ')} · ${h.runMode} mode</small></span>
              ${state === 'done' && html`<span class="success-text auth-ok"><${Icon} name="circle-check" size=${14} /> Signed in · ${PLANS[id]}</span>`}
            </button>
            ${on && state !== 'done' && html`<div class="auth-option-body">
              ${state === 'waiting' ? html`
                <p>A sign-in page opened in your browser. Approve the request there, and check that it shows this code.</p>
                <div class="auth-code" aria-label="Sign-in code">${CODES[id]}</div>
                <div class="row" style="gap:8px"><${Spinner} /><span class="muted grow">Waiting for you to approve…</span><button type="button" class="btn sm ghost" onClick=${() => cancelSignin(id)}>Cancel</button></div>`
              : html`
                <p>${h.name} signs in on <b>${master.name}</b>, the computer the service runs on. LGcode never sees your ${h.name} password.</p>
                <div><button type="button" class="btn" onClick=${() => startSignin(id)}><${Icon} name="log-in" size=${14} /><span>Sign in with ${h.name}</span></button></div>`}
            </div>`}
          </div>`;
        })}
      </div>
      ${tried && !connected.length && html`<p class="error-text auth-need" role="alert">Sign in to one harness to continue, or skip this step.</p>`}`;
  } else if (step === 1) {
    body = html`
      <h2>Add a repository</h2>
      <p class="auth-lede">Point LGcode at a Git repository on <b>${master.name}</b>. Agents work in worktrees beside it, and never on the branch you have checked out.</p>
      <div class="field">
        <label for="setup-path">Repository folder</label>
        <input id="setup-path" class=${cx('input lg mono', tried && checked?.error && 'invalid')} value=${path} spellcheck=${false} autocapitalize="off" autocomplete="off" onInput=${(e) => setPath(e.target.value)} autofocus />
        <div class="auth-check" aria-live="polite">
          ${checking ? html`<${Spinner} size=${13} /><span class="muted">Looking in the folder…</span>`
            : found ? html`<${Icon} name="circle-check" size=${14} class="success-text" /><span><b>Git repository found.</b> Branch <span class="mono">${found.branch}</span>, ${found.commits} commits${found.remote ? html`, remote <span class="mono">${found.remote}</span>` : ', no remote'}.</span>`
            : checked?.error ? html`<${Icon} name="circle-alert" size=${14} class=${tried ? 'error-text' : 'faint'} /><span class=${tried ? 'error-text' : 'muted'}>${checked.error}</span>` : null}
        </div>
      </div>
      <div class="auth-suggest">
        <span class="label">Found in <span class="mono">${master.workspace}</span></span>
        <ul>${suggestions.map((p) => html`<li key=${p}><button type="button" class=${cx('auth-pick', path.replace(/\/+$/, '') === p && 'on')} onClick=${() => setPath(p)}>
          <${Icon} name="folder-git-2" size=${14} /><span class="mono truncate">${p}</span></button></li>`)}</ul>
      </div>`;
  } else {
    const sub = connected.length ? `${HARNESSES[connected.includes(harness) ? harness : connected[0]].name} · ${PLANS[connected.includes(harness) ? harness : connected[0]]}` : null;
    body = html`
      <h2>Start the first project</h2>
      <div class="field">
        <label for="setup-goal">Goal</label>
        <textarea id="setup-goal" class=${cx('textarea', tried && goalError && 'invalid')} rows="4" value=${goal} placeholder="Make a mock for the LGcode phone app" onInput=${(e) => setGoal(e.target.value)} autofocus></textarea>
        ${tried && goalError && html`<span class="error" role="alert">${goalError}</span>`}
      </div>
      <div class="field">
        <label for="setup-git">Model for commit and pull request messages</label>
        <select id="setup-git" class="select" value=${gitModel} onChange=${(e) => setGitModel(e.target.value)}>
          ${Object.entries(HARNESSES).map(([id, h]) => html`<optgroup label=${h.name}>${h.models.map((m) => html`<option value=${m}>${m}</option>`)}</optgroup>`)}</select>
        <span class="hint">Asked once. Change it later in Service settings.</span>
      </div>
      <dl class="dl auth-summary">
        <dt>Repository</dt><dd>${found ? html`<span class="mono">${found.path}</span> <span class="muted">on ${found.branch}</span>` : html`<button type="button" class="link" onClick=${() => to(1)}>Add a repository first</button>`}</dd>
        <dt>Project lead</dt><dd>${sub || html`<span class="warn-text">No subscription yet.</span> <span class="muted">The lead starts once you sign in under Subscriptions.</span>`}</dd>
        <dt>Machine</dt><dd>${master.name} <span class="muted">· this computer</span></dd>
      </dl>
      ${tried && !found && html`<p class="error-text auth-need" role="alert">A project needs a repository.</p>`}`;
  }

  const waiting = step === 0 && Object.values(signin).includes('waiting');
  return html`<main class="auth setup">
    <header class="auth-top">
      <${Brand} />
      <button type="button" class="btn ghost" onClick=${skipAll}>Skip setup</button>
    </header>
    <form class="auth-card wide" onSubmit=${next} novalidate>
      <${Steps} step=${step} reach=${reach} go=${to} />
      <div class="auth-step" key=${step}>${body}</div>
      <div class="auth-actions">
        ${step > 0 && html`<button type="button" class="btn lg" onClick=${() => to(step - 1)}><${Icon} name="arrow-left" size=${14} /><span>Back</span></button>`}
        <span class="grow"></span>
        ${step === 0 && !connected.length && html`<button type="button" class="btn lg ghost" disabled=${waiting} onClick=${() => to(1)}>Skip for now</button>`}
        <button type="submit" class="btn primary lg" disabled=${(step === 0 && waiting) || (step === 1 && checking)}>
          <span>${step === 2 ? 'Create project' : 'Continue'}</span>${step < 2 && html`<${Icon} name="arrow-right" size=${14} />`}</button>
      </div>
    </form>
    <p class="auth-under">Step ${step + 1} of 3 · Everything here can be changed later in Service settings.</p>
  </main>`;
}

export function seedAuth() {}
