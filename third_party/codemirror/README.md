# CodeMirror 6, the web mock's file editor

The file `codemirror.bundle.js` is a single bundle of
[CodeMirror 6](https://codemirror.net) and the packages it needs. The web mock in
`design/mock/` uses it as the editor in a project's Files tab. The mock has no build
step, so the packages are bundled once, here, into one file that the browser loads
directly.

CodeMirror is copyright Marijn Haverbeke and others. Every bundled package is released
under the MIT License. [LICENSE](LICENSE) holds the licence text of each package, with
its own copyright line, and must stay in this folder for as long as the bundle is in
LGTM Studio.

## How the bundle was made

The bundle was made on 2026-11-12 from these packages on npm, at these exact versions:

| Package | Version |
|---|---|
| `@codemirror/view` | 6.43.15 |
| `@codemirror/state` | 6.7.6 |
| `@codemirror/language` | 6.13.1 |
| `@codemirror/commands` | 6.11.1 |
| `@codemirror/search` | 6.7.2 |
| `@codemirror/lang-javascript` | 6.2.5 |
| `@codemirror/lang-markdown` | 6.5.2 |
| `@codemirror/lang-css` | 6.3.1 |
| `@codemirror/lang-json` | 6.0.2 |
| `@codemirror/lang-yaml` | 6.1.3 |
| `@lezer/highlight` | 1.2.5 |

npm also installed the packages that those depend on: `@codemirror/autocomplete`
6.20.4, `@codemirror/lang-html` 6.4.12, `@codemirror/lint` 6.9.7,
`@codemirror/streamparser` 6.0.0, `@lezer/common` 1.5.5, `@lezer/css` 1.3.9,
`@lezer/html` 1.3.13, `@lezer/javascript` 1.5.6, `@lezer/json` 1.0.3, `@lezer/lr`
1.4.12, `@lezer/markdown` 1.8.1, `@lezer/yaml` 1.0.4, `@marijn/find-cluster-break`
1.0.4, `crelt` 1.0.7, `style-mod` 4.1.4 and `w3c-keyname` 2.2.8.

The entry file is [entry.js](entry.js). It only re-exports names from the packages, and
it is LGTM Studio's own. The command was this:

```
esbuild entry.js --bundle --format=esm --minify --legal-comments=none --target=es2022 --outfile=codemirror.bundle.js
```

esbuild was version 0.28.2. The bundle is 565,155 bytes. Its SHA-256 sum is
`bfb48b2d3e470cbd7d203e6fcac5786d2863b8031e9dc41ec8447cc9137f51c1`. No source file was
changed.

## Where LGTM Studio uses it

The web mock loads the bundle through `design/mock/vendor/codemirror`, a symbolic link to
this folder, so the preview server can serve it. Only `design/mock/js/editor.js` imports
it. No production code uses it.
