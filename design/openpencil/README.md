# OpenPencil for the web mock

The mock's "Edit design" button and the Design tab's Edit mode show
[OpenPencil](https://openpencil.dev), an open-source design editor, in a frame.
This folder builds OpenPencil's web editor and serves it on port 8443 of this
computer, together with each repository's design files.

## Starting it

Run these commands from the `design/` folder's parent, the repository root:

```sh
docker compose -f design/openpencil/compose.yml up -d --build
```

The first build takes several minutes, because it builds OpenPencil from source.
To add private projects, such as Ananke, name their folders in
`design/data/local/openpencil.compose.yml`, which git ignores, and start with
both files:

```sh
docker compose -f design/openpencil/compose.yml -f design/data/local/openpencil.compose.yml up -d --build
```

Open `https://<this computer>:8443/` once in the browser and accept its
certificate. Until you do, the mock says that OpenPencil is not reachable.

## Why it is built here

OpenPencil publishes no image of its editor alone. Its Cloud image is private,
and it forbids being shown in a frame. The Dockerfile builds the same editor
without Cloud, at a pinned OpenPencil commit, and Caddy serves it. This build
sends no usage reports, because OpenPencil only sends them when built with
`VITE_OPENPENCIL_FEEDBACK=on`.

## Why it uses HTTPS

OpenPencil opens a file named in its address, `?file=<address>`, only when that
address uses HTTPS. Caddy therefore serves the editor and the design files from
one HTTPS address, with a certificate from its own local certificate authority.
The certificate is kept in a Docker volume, so it survives restarts.

## Where design files live

Each repository keeps its design file in its own `design/` folder, for example
`design/lgcode.fig` here and `design/ananke.fig` in Ananke. The compose files
mount each folder read-only at `/files/<repository id>/`. Caddy serves only
`.fig` and `.pen` files from them.

## What does not work yet

The editor cannot save back into the repository. OpenPencil keeps edits in the
browser, and its Save command downloads a copy to the viewer's computer. Saving
into the repository needs a small LGcode endpoint, or OpenPencil's own
automation bridge. The entry "The design file is the source of truth" in
`docs/features.md` records this gap.
