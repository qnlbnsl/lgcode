// Reverse Fig profile for LGTM Studio's web mock, `design/workbench.html`.
// Serve that folder on port 4178 first:  python3 -m http.server 4178 --bind 127.0.0.1
const sidebar = '<aside class="sidebar" style="position:static;display:block;width:248px;height:auto;padding:4px 0">{slot}</aside>';
const statusDot = (cls) => `<span class="dot ${cls}" style="display:block"></span>`;
const agentRow = (dot, label) => `<button class="agent-link"><span class="dot ${dot}"></span><span class="agent-name">Rowan</span><small>${label}</small></button>`;

export default {
  name: 'lgtm-mock',
  url: process.env.MOCK_URL || 'http://127.0.0.1:4178/workbench.html',
  output: 'design/lgtm.fig',
  work: '.reverse-fig/lgtm-mock',
  ready: (page) => page.waitForFunction(() => window.lgtmReady),
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
      variants: ['primary', 'secondary'].flatMap((kind) => [
        { props: { Kind: kind[0].toUpperCase() + kind.slice(1), State: 'Default' }, html: `<button class="${kind}">New project</button>` },
        { props: { Kind: kind[0].toUpperCase() + kind.slice(1), State: 'Hover' }, html: `<button class="${kind}">New project</button>`, force: ['hover'] },
        { props: { Kind: kind[0].toUpperCase() + kind.slice(1), State: 'Disabled' }, html: `<button class="${kind}" disabled>New project</button>` },
      ]),
    },
    {
      name: 'Status dot',
      variants: [['Working', ''], ['Waiting', 'wait'], ['Idle', 'idle'], ['Failed', 'error'], ['Stopped', 'stopped']]
        .map(([status, cls]) => ({ props: { Status: status }, html: statusDot(cls) })),
    },
    {
      name: 'Agent row',
      hug: false,
      context: sidebar,
      variants: [['Waiting', 'wait', 'Needs answer'], ['Running', '', 'Working'], ['Idle', 'idle', 'Idle']]
        .map(([status, dot, label]) => ({ props: { Status: status }, html: agentRow(dot, label) })),
    },
    {
      name: 'Connection status',
      variants: [['Live', '', 'Live'], ['Waiting', 'wait', 'Reconnecting'], ['Offline', 'idle', 'Offline']]
        .map(([status, dot, label]) => ({ props: { Status: status }, html: `<span class="connection-status"><span class="dot ${dot}"></span><span>${label}</span></span>` })),
    },
    {
      name: 'Segmented control',
      variants: [{ props: { Selected: 'First' }, html: '<span class="segmented"><button aria-pressed="true">Unified</button><button aria-pressed="false">Split</button></span>' }],
    },
    {
      name: 'Inline link',
      variants: [
        { props: { State: 'Default' }, html: '<button class="inline-link">Open sprint board →</button>' },
        { props: { State: 'Hover' }, html: '<button class="inline-link">Open sprint board →</button>', force: ['hover'] },
      ],
    },
    { name: 'Attention number', variants: [{ props: {}, html: '<span class="attention-number">3</span>' }] },
    {
      name: 'Task state',
      variants: [['Up next', 'queue'], ['In progress', 'active'], ['In review', 'review'], ['Done', 'done'], ['Blocked', 'blocked']]
        .map(([state, cls]) => ({ props: { State: state }, html: `<span class="task-state ${cls}" style="display:block"></span>` })),
    },
  ],
};
