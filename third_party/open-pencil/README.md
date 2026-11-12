# OpenPencil's pinned browser distribution

OpenPencil is developed by Danila Poyarkov and the OpenPencil contributors.
Its source is https://github.com/open-pencil/open-pencil at commit
cb717376a6252b0387f95d1e8bf33a0b196eb9bf, version 0.17.0-beta.2.
The application is licensed under the MIT License. The unchanged upstream
LICENSE file is copied here, with its original copyright line.

## The copied files and generated distribution

The currently copied repository file is LICENSE, from upstream LICENSE.
Its bytes are unchanged. Its SHA-256 is
38ac54d3b48ccb6b3c0044b37bec1d75c21c3dc38b34a5a8c52a3cea34ba514b.
No OpenPencil application source file is copied into LGTM Studio's own source tree.
LGTM Studio's isolated-service launcher and folder/session checks are original
LGTM Studio code. The browser application they will serve is OpenPencil's code,
not LGTM Studio-authored application code.

The build preparation retains the full official pinned archive and its
source-file-manifest.json in the ignored owned preparation directory.
That manifest names every source file, Git blob, executable mode and
SHA-256. All 10,293 tree entries, including 8,320 blobs, were verified against
the captured exact upstream tree. The archive has SHA-256
6d60622e247159718c73df9f539e6757802daed5966bcb81c475ebe34bb78a24.
No source bytes were modified. Dependency downloads, installation and building
were separately approved. The output runtime remains unlaunched.
One plain pinned build has now returned zero;
BUILD.md records its exact recipe, input identities, image and raw evidence.
No generated distribution is accepted or shipped by this unit.

The completed build compiled OpenPencil's existing public-package graph and
its production Vite page with Cloud and feedback disabled. Its generated
dist files were copied unchanged into the editor image at /srv/editor.
Every actual copied output must be named in the retained distribution hash
manifest. BUILD.md records the recipe hash, input source manifest, immutable stages,
direct raw output and final image identity. The image retains its generated
file hash manifest; its contents have not yet been independently extracted
or read. No image tag or source label substitutes for the retained build output.

## Licences and receipts travel with the distribution

The prepared recipe retains the unchanged upstream MIT licence and the
generated THIRD-PARTY-NOTICES.md. The notices identify the bundled dependency
versions and their licences, including the generated service worker.
The recipe also retains the font licence files from packages/core/assets:
Caveat-OFL.txt, Inter-OFL.txt, NotoSansSymbols-OFL.txt and
OpenPencilEmojiMetrics-OFL.txt. These files are copied unchanged into the
image's licence/provenance directory. The licences of dependency-provided
WebAssembly and other runtime assets must remain with their generated
notices. The Caddy runtime and BuildKit tooling retain their own licences.

The successful recipe populated /usr/share/lgtm-editor-provenance with source
identity, input checksums, exact source-file manifest, distribution hashes,
bootstrap/tool versions and operating-system package inventory. The direct
host build output, exit and final image identity must be retained alongside any
distribution of that image. A source label alone is insufficient.
Any future copied or adapted upstream application source must be placed
under third_party/open-pencil, list each original file and change here,
preserve its copyright lines, and receive the required commit-message
credit before integration. Dockerfile.editor is LGTM Studio's original frozen recipe, not copied upstream application code. No commit,
service acceptance or distribution is claimed now.
