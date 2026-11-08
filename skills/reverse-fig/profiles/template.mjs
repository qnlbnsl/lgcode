// Reverse Fig profile template. Copy it into the project, for example as
// `.lgcode/reverse-fig.mjs`, and fill it in. Everything specific to a project belongs here, so
// the scripts in `lib/` stay the same for every project. When the first runs show that a
// project needs something the scripts cannot do, change the scripts too, and say why in a
// comment. SKILL.md explains the loop.
//
// Functions marked "runs in the page" are sent to the browser as source text. They cannot use
// variables from this file.

export default {
  // Names the work folder and the default output file.
  name: 'my-app',

  // The page the components render on. Start the project's development server first. A variant
  // can name another page with its own `url`, for projects that show each component on a page
  // of its own, such as a component gallery or a mock sheet.
  url: 'http://127.0.0.1:3000/',

  // Where the design file goes, and where the photographs and the report go. Both are relative
  // to the folder you run the command from. Keep the work folder out of git.
  output: 'design/my-app.fig',
  work: '.reverse-fig/my-app',

  // Runs in Node with the Playwright page. Wait until the app has drawn.
  ready: (page) => page.waitForLoadState('networkidle'),

  // Optional. Runs in Node after `ready`, before anything is staged: sign in, close a banner,
  // or open the view that holds the components.
  // prepare: async (page) => { await page.click('#accept-cookies'); },

  viewport: { width: 1400, height: 900 },
  scale: 2,               // device pixels per CSS pixel
  colorScheme: 'light',
  background: '#ffffff',  // behind staged components; a CSS value such as 'var(--bg)' works

  // The design font. Inter ships with OpenPencil, so it is the default. Another family needs
  // `dir`, the folder that holds its files, and `files`, keyed by CSS weight.
  // font: { family: 'Inter' },
  //
  // Or keep the page's own fonts, when OpenPencil can fetch them by itself (it fetches Google
  // Fonts), and use `map` to turn a page font name into a family and a weight. React Native Web
  // names a family per weight, such as PlusJakartaSans_600SemiBold.
  // font: {
  //   keep: true,
  //   map: (family, weight) => /^material$/i.test(family) ? { family: 'Material Icons', weight: 400 } : { family, weight },
  // },

  // Color tokens become color variables, one mode per entry in `modes`. Set `tokens: false` for
  // a project without tokens. A project whose colors live elsewhere, such as a JSON manifest,
  // gives `read` instead of `prefix` and `modes`. It runs in Node and returns one entry per mode:
  //   read: async (page) => [{ name: 'Light', values: [{ css: '--color-bg', name: 'color/bg', rgb: '#ffffff' }] }]
  tokens: {
    prefix: '--color-',                         // which custom properties are tokens
    collection: 'Color',
    name: (css) => css.replace(/^--color-/, 'color/'),
    background: '--color-bg',                   // painted behind the imported frames
    modes: [
      // `apply` runs in the page and switches the theme before the tokens are read.
      { name: 'Light', apply: () => { document.documentElement.dataset.theme = 'light'; } },
      { name: 'Dark', apply: () => { document.documentElement.dataset.theme = 'dark'; } },
    ],
  },

  // Extra computed CSS properties to copy, beyond the list in lib/extract.mjs.
  // styles: ['text-overflow'],

  // How strict the check is. A pixel counts as different when a channel moves by more than
  // `threshold` and no pixel within `shift` CSS pixels matches. A variant passes when no more
  // than `passRatio` of its pixels differ.
  threshold: 0.1,
  shift: 1,
  passRatio: 0.03,

  // Each component becomes a component set, and each variant one variant in it. A variant comes
  // from one of two places:
  //   html:     markup placed on the page, so the page's own stylesheet styles it.
  //   selector: an element already on the page; `nth` picks one of several matches.
  // Optional per variant: `force` (pseudo-classes such as ['hover'] or ['focus-visible']),
  // `disabled`, `url`, and, for html variants only, `context`: markup with `{slot}` that wraps
  // the variant so it inherits the styles of its usual parent. `context` can also sit on the
  // component.
  // Components hug their content along each axis where that gives the browser's size, and keep
  // the browser's size elsewhere, such as a button with a fixed height. Set `hug: false` to keep
  // the browser's size on both axes.
  components: [
    {
      name: 'Button',
      variants: [
        { props: { Kind: 'Primary', State: 'Default' }, html: '<button class="btn btn-primary">Save</button>' },
        { props: { Kind: 'Primary', State: 'Hover' }, html: '<button class="btn btn-primary">Save</button>', force: ['hover'] },
        { props: { Kind: 'Primary', State: 'Disabled' }, html: '<button class="btn btn-primary" disabled>Save</button>' },
      ],
    },
    {
      name: 'Navigation item',
      hug: false,
      variants: [
        { props: { State: 'Current' }, selector: '.sidebar a[aria-current="page"]' },
        { props: { State: 'Default' }, selector: '.sidebar a:not([aria-current])' },
      ],
    },
  ],
};
