# The pinned OpenPencil build completed without launching the editor

## The owner selects the local runtime image by name and tag

The owner ruled on 2026-11-10 that the engine and native case use `lgtm-openpencil:w10b-cb71737-build1` on every host.
Each launch inspects that local tag and requires Linux on AMD64.
No digest lookup or digest equality decides image presence.
The launch retains `--pull=never` and all existing confinement and resource limits.
A missing image is refused without a fallback, build, pull or retag.
The identifiers below record the historical build output, rather than runtime presence gates.
Issue 601 records the source correction; its new remote proof remains pending.

## The original build evidence remains

Confirmed live: The separately approved ordinary Docker build returned zero on 2026-11-10 UTC. The new local image is lgtm-openpencil:w10b-cb71737-build1, with image identifier sha256:775d40eba3a588fe7219b7963a136d48a94dad07ce8b11fc3a49d223ace1f46d. It was not pushed or launched. The preexisting lgtm-openpencil:cb71737 image remains sha256:14c372ece8e88094a4ca84883345a2d079137784e8b8e11ab3ff094901f23cd4.

Dockerfile.editor is LGTM Studio's original recipe, copied byte-for-byte from the approved build input. Its SHA-256 is 58b4df505516892a90dc7d6fe167e064ae38242b466705495ae421ec050f429d. Its preparation comment is retained as part of those exact frozen bytes; the actual build outcome is recorded here. The input is the unchanged official OpenPencil cb717376a6252b0387f95d1e8bf33a0b196eb9bf archive, SHA-256 6d60622e247159718c73df9f539e6757802daed5966bcb81c475ebe34bb78a24. The exact source-file manifest has SHA-256 ca5670713b166723f0ff486f7decdce999a2789dda374b51e5abccd221d67a26. It is also supplied as the recipe's small named provenance context.

The immutable linux/amd64 stages are Bun docker.io/oven/bun@sha256:3f23864d3e8c923975c61971cabe67ee3d5a728f1e25a559256b95af719a3478, Playwright mcr.microsoft.com/playwright@sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7 and Caddy docker.io/library/caddy@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83. The recipe executes the upstream ordinary public-package graph and production page, including its generated-demo browser prerequisite. It does not run a desktop editor, Cloud service or display service.

The existing default Docker backend used eight available CPUs. A live build-step cgroup read confirmed CPU set 8,11-12,14,17,21,23-24, CPU quota 800000 per 100000 microseconds, memory maximum 17179869184 bytes and swap maximum zero. Fresh admission load was 21.75146484375. The command had a 1,800-second timeout. No new builder was created. The preexisting shared default builder was retained; no cleanup removal was necessary. The earlier separately approved wrapper failed before build and remains a consumed, preserved failure.

The raw command, log and direct exit are retained in website-1/w10b-approved-build-attempts. They must accompany any distribution of this image, alongside the attribution and licence files. No new build wrapper or receipt framework is used. The existing immutable source archive is retained once in website-1/w10b-pinned-build-preparation.

The successful raw log, plain-build-1.log, is 911589 bytes with SHA-256 fc7ce8f8a5a2d4dda0e6a78b1108d0641b83e7ca2f556a8e834a2f61aee9cfdc. plain-build-1.exit contains 0. The log preserves the upstream warnings and the final input/license verification. The recipe copied generated THIRD-PARTY-NOTICES.md, the exact upstream MIT licence, font licences, source-file inventory and distribution hashes into the image. Its internal files have not yet been independently extracted or read. No actual editor pixels, opaque-origin compatibility, file import or browser isolation is established by this build.
