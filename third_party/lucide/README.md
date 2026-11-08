# Icon paths taken from Lucide

The web mock draws its icons with paths copied from
[Lucide](https://lucide.dev), copyright Lucide Contributors 2022, with portions
copyright Cole Bemis 2013 to 2022 as part of Feather (MIT License). Lucide is
released under the ISC License. The licence text is in [LICENSE](LICENSE) next
to this file, and it must stay there for as long as these paths are in LGcode.

## Which icons, and from where

The paths were copied on 2026-11-08 from the `lucide-static` package, version
0.460.0, file `icons/<name>.svg` for each name below. Only the inner path,
circle, and rectangle elements were copied. Lucide's `<svg>` wrapper was not
copied, and `line` elements were written as equivalent `path` elements.
LGcode's own stylesheet sets the stroke width to 1.6 instead of Lucide's 2.

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
| `smartphone` | Alerts, which go to the owner's phone. |
| `monitor` | Machines. |
| `user` | Subscriptions. |
| `settings` | Settings. |
| `menu` | The phone navigation button. |
| `circle-help` | Design notes. |
| `git-branch` | Branch names. |
| `kanban` | The project board. |
| `message-square` | Requests in a thread. |
| `folder` | Repositories and folders. |

## Where the paths live

The paths are inline in `design/workbench.html` (static buttons) and in the
`paths` table near the top of `design/workbench.js`. A comment beside the table
names this folder. The LGcode logo mark is LGcode's own drawing, not Lucide's.
