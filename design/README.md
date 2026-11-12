# LGTM Studio's design folder

This folder holds the working mock of the LGTM Studio web page, the design contract it
follows, and the design file.

## Opening the mock

Serve this folder, then open its address. The address opens the mock straight away.

```
cd design
python3 -m http.server 4178 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4178/`. The mock itself lives at `http://127.0.0.1:4178/mock/`,
and [mock/README.md](mock/README.md) lists its screens and how to use it as a package.

To open the mock from another computer or a phone, use `--bind 0.0.0.0` and the server's
address. That address has no password, so anyone on the network can open it. The server
shares this whole folder, which includes `data/prod/` if a real export exists, so do not bind
to the network while an export is there.

## What is in this folder

| Path | What it holds |
|---|---|
| `index.html` | The front door. It sends the browser on to `mock/`. |
| `mock/` | The working mock of the whole web page, rebuilt from 2026-11-10. |
| `DESIGN.md` | The design contract: colours, type, density, and the rules the screens keep. |
| `tokens.css` | The approved colour and type tokens for light and dark mode. |
| `fonts/` | Links to Inter and JetBrains Mono in `third_party/`. |
| `lgtm.fig` | The design file, which OpenPencil opens. |
| `openpencil/` | The OpenPencil editor that the mock's Design tab shows. |
| `data/` | Sample events in the engine's database shape. A contracts test reads them. |

## The older workbench was removed

The first mock was one page, `workbench.html`, with its app in `workbench.js`, its browser
check suites, its screenshots in `previews/`, its critiques and its feature parity map. The
rebuilt mock in `mock/` replaced it. The owner had the workbench removed on 2026-11-12, so
that the server's address opens only the current mock. The removed files are in the git
history, in the commit before the one that removed them.

## Where the visual directions came from

The UI plugin's local design catalog was queried for a cool, dense agent workspace, a
bright botanical team workspace, and a warm, focused workspace. All three palettes were
custom explorations. Harbor used layered blue surfaces. Field used green-tinted light
surfaces. Dusk used layered plum surfaces with a peach action colour.

The owner selected Field as light mode and Dusk as dark mode on 2026-11-05. `DESIGN.md`
records the palette decision, and `tokens.css` holds the approved tokens. Since
2026-11-08 the mock uses Inter and JetBrains Mono, served from the repository.

## Interface copy

The owner asked for normal product language on 2026-11-06. The interface carries no sample,
mock or preview disclaimers. What the mock does not connect to is documented in this
folder instead.
