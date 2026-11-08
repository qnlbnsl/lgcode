# Inter, the interface font

The file in this folder is the Inter typeface by Rasmus Andersson and the Inter
Project Authors. It is released under the SIL Open Font License, version 1.1
(OFL). The licence text is in [OFL.txt](OFL.txt) next to this file, and it must
stay there for as long as the font is in LGcode.

## Which file, and from where

- `InterVariable-latin.woff2` is Inter version 4.001 (git `66647c0bb`), a
  variable font with a weight axis from 100 to 900.
- It was downloaded on 2026-11-08 from Google Fonts, which serves Inter in
  subsets. This is the Latin subset, the one Google Fonts names `latin`
  (U+0000 to U+00FF and common punctuation). Its address was
  `https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2`.
- The licence text came from `ofl/inter/OFL.txt` in the `google/fonts`
  repository on GitHub.
- The file is unchanged. It is 48,256 bytes. It keeps the tabular figures
  feature (`tnum`) that the web mock turns on.

## Where LGcode uses it

The web mock in `design/` loads it through `design/fonts/inter`, a symbolic link
to this folder, so the preview server can serve it.
