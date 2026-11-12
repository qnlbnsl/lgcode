// Reverse Fig profile for LGTM Studio's web mock in `design/mock/`.
// Serve the design folder on port 4178 first:  cd design && python3 -m http.server 4178 --bind 127.0.0.1
// The snippets below copy the mock's own markup, so they use its class names from
// `design/mock/css/base.css`. Agents are named by their role, as everywhere in LGTM Studio.
const sidebar = '<aside class="sidebar" style="position:static;display:block;width:264px;height:auto;padding:4px 0">{slot}</aside>';
const statusDot = (cls) => `<i class="dot ${cls}" style="display:block"></i>`;
const agentRow = (dot, label, state) => `<div class="tree-row agent" style="padding-left:46px"><span class="twist none"></span>`
  + `<a href="#"><span class="avatar sm"><i class="dot ${dot}"></i></span><span class="label">${label}</span></a>`
  + (state ? `<span class="state warn">${state}</span>` : '') + '</div>';
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export default {
  name: 'lgtm-mock',
  url: process.env.MOCK_URL || 'http://127.0.0.1:4178/mock/#/home',
  output: 'design/lgtm.fig',
  work: '.reverse-fig/lgtm-mock',
  ready: (page) => page.waitForSelector('.sidebar'),
  background: 'var(--color-bg)',
  tokens: {
    prefix: '--color-',
    collection: 'Color',
    name: (css) => css.replace(/^--color-/, 'color/'),
    background: '--color-bg',
    modes: [
      { name: 'Field', apply: () => { document.documentElement.dataset.theme = 'light'; } },
      { name: 'Dusk', apply: () => { document.documentElement.dataset.theme = 'dark'; } },
    ],
  },
  components: [
    {
      name: 'Button',
      variants: [['primary', 'btn primary'], ['secondary', 'btn'], ['ghost', 'btn ghost']].flatMap(([kind, cls]) => [
        { props: { Kind: cap(kind), State: 'Default' }, html: `<button type="button" class="${cls}">New project</button>` },
        { props: { Kind: cap(kind), State: 'Hover' }, html: `<button type="button" class="${cls}">New project</button>`, force: ['hover'] },
        { props: { Kind: cap(kind), State: 'Disabled' }, html: `<button type="button" class="${cls}" disabled>New project</button>` },
      ]),
    },
    {
      name: 'Status dot',
      variants: [['Working', 'working'], ['Waiting', 'waiting'], ['Idle', 'idle'], ['Failed', 'failed'], ['Stopped', 'stopped'], ['Starting', 'starting']]
        .map(([status, cls]) => ({ props: { Status: status }, html: statusDot(cls) })),
    },
    {
      name: 'Agent row',
      hug: false,
      context: sidebar,
      variants: [['Waiting', 'waiting', 'Builder 2', 'Needs approval'], ['Working', 'working', 'Builder 1', ''], ['Idle', 'idle', 'Test runner', '']]
        .map(([status, dot, label, state]) => ({ props: { Status: status }, html: agentRow(dot, label, state) })),
    },
    {
      name: 'Connection status',
      variants: [['Live', '', 'working', 'Live'], ['Reconnecting', 'reconnecting', 'waiting', 'Reconnecting'], ['Offline', 'offline', 'failed', 'Offline']]
        .map(([status, cls, dot, label]) => ({ props: { Status: status }, html: `<button type="button" class="live ${cls}"><i class="dot ${dot}"></i><span>${label}</span></button>` })),
    },
    {
      name: 'Segmented control',
      variants: [{ props: { Selected: 'First' }, html: '<div class="seg" role="tablist"><button type="button" aria-pressed="true">Changes<span class="count">8</span></button><button type="button" aria-pressed="false">History</button></div>' }],
    },
    {
      name: 'Inline link',
      variants: [
        { props: { State: 'Default' }, html: '<a class="link" href="#">Open the history</a>' },
        { props: { State: 'Hover' }, html: '<a class="link" href="#">Open the history</a>', force: ['hover'] },
      ],
    },
    {
      name: 'Count',
      variants: [['Default', ''], ['Warning', 'warn'], ['Error', 'error']]
        .map(([tone, cls]) => ({ props: { Tone: tone }, html: `<span class="count ${cls}">3</span>` })),
    },
    {
      name: 'Badge',
      variants: [['Default', ''], ['Warning', 'warn'], ['Error', 'error'], ['Success', 'success'], ['Info', 'info']]
        .map(([tone, cls]) => ({ props: { Tone: tone }, html: `<span class="badge ${cls}">Needs answer</span>` })),
    },
  ],
};
