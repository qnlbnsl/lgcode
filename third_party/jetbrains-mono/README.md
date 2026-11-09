# JetBrains Mono, the code font

The file in this folder is the JetBrains Mono typeface by JetBrains and the
JetBrains Mono Project Authors. It is released under the SIL Open Font License,
version 1.1 (OFL). The licence text is in [OFL.txt](OFL.txt) next to this file,
and it must stay there for as long as the font is in LGcode.

## Which file, and from where

- `JetBrainsMono-latin.woff2` is JetBrains Mono version 2.211, a variable font
  with a weight axis from 400 to 800.
- It was downloaded on 2026-11-08 from Google Fonts, which serves the font in
  subsets. This is the Latin subset, the one Google Fonts names `latin`
  (U+0000 to U+00FF and common punctuation). Its address was
  `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2`.
- The licence text came from `ofl/jetbrainsmono/OFL.txt` in the `google/fonts`
  repository on GitHub.
- The file is unchanged. It is 31,432 bytes. The web mock turns its ligatures
  off in code, diffs, and the terminal, so `=>` stays two characters.

## Where LGcode uses it

The web mock in `design/` loads it through `design/fonts/jetbrains-mono`, a
symbolic link to this folder, so the preview server can serve it.

The production shell imports this same font from
`packages/web/src/tokens.css`.
Vite emits the unchanged font file into the production static assets.
