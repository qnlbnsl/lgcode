# Preact and htm, the web mock's rendering library

The file in this folder is the standalone build of
[htm](https://github.com/developit/htm), which bundles
[Preact](https://github.com/preactjs/preact) and its hooks. The web mock in
`design/mock/` uses it to draw its screens without a build step.

htm is copyright 2018 Google Inc., released under the Apache License 2.0.
Preact is copyright 2015 to present Jason Miller, released under the MIT
License. Both licence texts must stay in this folder for as long as the file
is in LGTM Studio: [LICENSE](LICENSE) is htm's, and
[preact.LICENSE](preact.LICENSE) is Preact's.

## Which file, and from where

- `standalone.module.js` is `preact/standalone.module.js` from the `htm`
  package on npm, version 3.1.1 (git `f5c8bec76fb527f917c55b0b9342a18c69aa543d`).
- It was downloaded on 2026-11-10 from
  `https://registry.npmjs.org/htm/-/htm-3.1.1.tgz`.
- The file is unchanged. It is 13,194 bytes. Its SHA-256 sum is
  `72284e8e9079c87817145df1110f74e8a2aa040b2fc384922e18dfcb46fc1fd7`.
- The bundle holds htm 3.1.1 and the Preact 10 release that htm's build used.
  The file is minified and carries no copyright line of its own.

## Where LGTM Studio uses it

The web mock loads it through `design/mock/vendor/htm-preact`, a symbolic
link to this folder, so the preview server can serve it. Only
`design/mock/js/lib.js` imports it. No production code uses it.
