# Icon paths taken from Lucide

The web mock draws its icons with paths copied from
[Lucide](https://lucide.dev), copyright Lucide Contributors 2022, with portions
copyright Cole Bemis 2013 to 2022 as part of Feather (MIT License). Lucide is
released under the ISC License. The licence text is in [LICENSE](LICENSE) next
to this file, and it must stay there for as long as these paths are in LGTM Studio.

## Which icons, and from where

The paths were copied on 2026-11-08 from the `lucide-static` package, version
0.460.0, file `icons/<name>.svg` for each name below. Only the inner path,
circle, and rectangle elements were copied. Lucide's `<svg>` wrapper was not
copied, and `line` elements were written as equivalent `path` elements.
LGTM Studio's own stylesheet sets the stroke width to 1.6 instead of Lucide's 2.

| Icon in Lucide | Used for |
|---|---|
| `x` | Every close button, and removing an attached context item. |
| `arrow-left` | Back links on the sprint and task pages. |
| `arrow-right` | Links that go somewhere, and a branch merging into another. |
| `arrow-up-right` | Opening the lead's full thread. |
| `arrow-up` | Send. |
| `square` | Stop response. |
| `check` | A clean worktree, and the attention filter's check box. |
| `plus` and `minus` | New project, Add context, Add task, and staging a file. |
| `chevron-right` and `chevron-down` | Disclosures, and the stage strip's separator. |
| `house` | Home. |
| `search` | Find project or agent. |
| `command` | The Command key in the switcher shortcut on Apple systems. |
| `bell` | Needs attention. |
| `smartphone` | Phone notifications, which go to the owner's phone. |
| `monitor` | Machines. |
| `user` | Subscriptions. |
| `settings` | Service settings. |
| `menu` | The phone navigation button. |
| `panel-left` | Folding the sidebar into a rail, added on 2026-11-08. |
| `circle-help` | Design notes. |
| `refresh-cw` | Reconnect now, beside the Live indicator, added on 2026-11-08. |
| `git-branch` | Branch names. |
| `arrow-down` and `arrow-up` | Git's incoming and outgoing counts, and the phone terminal's arrow keys, added on 2026-11-08. `arrow-up` is also Send. |
| `arrow-left` and `arrow-right` | The phone terminal's arrow keys, too. |
| `triangle-alert` | A file or worktree with a Git conflict, added on 2026-11-08. |
| `terminal` | Open in Terminal, on a conflict, added on 2026-11-08. Its `polyline` and `line` elements were written as equivalent `path` elements. |
| `panel-left-close` and `panel-left-open` | Folding Git's worktree list into a rail and opening it, added on 2026-11-08. |
| `kanban` | The project board. |
| `message-square` | Requests in a thread. |
| `folder` | Repositories and folders. |
| `folder-plus` | Add repository, in a machine's row menu, added on 2026-11-08. |
| `list-filter` | Home's Filter button, added on 2026-11-08. |
| `copy` | Copying a large thread item, added on 2026-11-08. |
| `maximize-2` | Opening a large thread item in full, added on 2026-11-08. Its `polyline` and `line` elements were written as equivalent `path` elements. |
| `ellipsis` | The row menu on Machines and Subscriptions, added on 2026-11-08. |
| `pencil` | Rename, added on 2026-11-08. |
| `trash-2` | Remove, added on 2026-11-08. Its `line` elements were written as equivalent `path` elements. LGTM Studio stores it under the key `trash`. |
| `archive` and `archive-restore` | Archive and Restore in Project settings, added on 2026-11-08. |
| `rotate-ccw` | Retry on a failed phone notification, added on 2026-11-08. |
| `send` | Send test notification, added on 2026-11-08. LGTM Studio stores it under the key `paper-plane`, because `send` already names the arrow-up Send icon. |

## Where the paths live

The paths were inline in `design/workbench.html` (static buttons) and in the
`paths` table near the top of `design/workbench.js`. Those two files were removed on
2026-11-12, and the rebuilt mock's paths are in `design/mock/js/icons.js`, described
below. The LGTM Studio logo mark is LGTM Studio's own drawing, not Lucide's.

## Production shell paths

`packages/web/src/shell/Icon.tsx` reuses the credited `lucide-static` 0.460.0
paths from `design/workbench.js` and `design/workbench.html` at LGTM Studio commit
`bef4b1090a8dc783075f835e7c5e90dbc3b8aad9`.
The source files are `icons/chevron-right.svg`, `icons/chevron-down.svg`,
`icons/git-branch.svg`, `icons/check.svg`, `icons/x.svg`, `icons/command.svg`,
`icons/house.svg`, `icons/search.svg`, `icons/smartphone.svg`, `icons/monitor.svg`,
`icons/user.svg`, `icons/settings.svg`, `icons/panel-left.svg`, `icons/menu.svg`,
`icons/bell.svg`, `icons/refresh-cw.svg`, and `icons/arrow-left.svg`.
The elements are React JSX rather than HTML strings.
The stylesheet keeps LGTM Studio's 1.6 stroke width.
The production file retains the copyright and licence provenance comment.

## The rebuilt mock's icon file, added on 2026-11-10

The rebuilt mock in `design/mock/` keeps its icons in one generated file,
`design/mock/js/icons.js`. The file holds 146 icons from the same
`lucide-static` package, version 0.460.0. Each entry is the inner markup of
`icons/<name>.svg`, unchanged, under the icon's Lucide name. Lucide's `<svg>`
wrapper was not copied. The mock's own `Icon` component in
`design/mock/js/lib.js` draws the wrapper and sets the stroke width. The names
in that file are the list of icons the rebuilt mock may use.
