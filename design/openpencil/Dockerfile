# syntax=docker/dockerfile:1
# OpenPencil's web editor, built from source and served with each project's design files.
# OpenPencil publishes no image of the editor alone. Its Cloud image is private and refuses to be
# shown in a frame, so this builds the same editor without Cloud and serves it from Caddy.
# Build and start it with compose.yml in this folder; README.md explains why it needs HTTPS.

FROM oven/bun:1.4.4 AS bun

# Playwright's Chromium draws OpenPencil's demo document during the build, as in its own image.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
# The HTML engine's WebAssembly module is built with Rust. Rustup installs the toolchain that
# OpenPencil pins in rust-toolchain.toml the first time Cargo runs.
RUN apt-get update && apt-get install --yes --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
ENV PATH=/root/.cargo/bin:$PATH
ARG OPENPENCIL_COMMIT=cb717376a6252b0387f95d1e8bf33a0b196eb9bf
ADD https://github.com/open-pencil/open-pencil.git#${OPENPENCIL_COMMIT} /src
WORKDIR /src
RUN bun install --frozen-lockfile
RUN bun run build:packages
# Without Cloud the editor keeps documents in the browser. Feedback and usage reports stay off
# unless VITE_OPENPENCIL_FEEDBACK is "on", so this build sends nothing.
RUN VITE_OPENPENCIL_CLOUD=off bunx vite build

FROM caddy:2.10.2-alpine
COPY --from=build /src/dist /srv/editor
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 8443
