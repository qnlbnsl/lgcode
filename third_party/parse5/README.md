# The HTML parser used for private mock delivery

The engine uses the public parser and source-location interfaces of parse5
8.1.0, from https://github.com/inikulin/parse5.
The exact package and its integrity are pinned in pnpm-lock.yaml.
It is a declared engine dependency, rather than an incidental development dependency.
No parse5 implementation source is copied or modified in LGTM Studio's source tree.
The markup delivery helper in packages/engine/src/client/web/display/markup.ts
is original LGTM Studio code that calls those interfaces.

LICENSE is copied unchanged from LICENSE in the installed parse5 8.1.0 package.
It retains Copyright (c) 2013-2019 Ivan Nikulin and the MIT License text.
The package's entity decoder is entities 9.0.0, from
https://github.com/fb55/entities, pinned by the same lockfile.
entities.LICENSE is copied unchanged from LICENSE in that package.
It retains Copyright (c) Felix Böhm and the BSD 2-Clause licence text.
These are the only copied files in this directory.
The source identities here are the exact published package versions and lockfile
integrities; no unverified upstream Git commit identity is asserted.

Any distribution containing these dependencies must retain their licence texts.
No upstream parser examples, application code or tests were copied into LGTM Studio.
