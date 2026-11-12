# The rebuilt LGcode mock

This folder is a working mock of the whole LGcode web page. The owner asked for it on
2026-11-10. It does not connect to the engine and it never calls an agent. Every screen
works on data held in the browser's memory.

## How to open it

Serve the `design/` folder, which is the parent of this folder.

```
cd design
python3 -m http.server 4178 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4178/mock/`. The mock has no build step and loads nothing from
the network.

Changes you make stay until you reload the page. The colour mode, the density, and the
sizes of the panels are remembered in the browser. The "Mock controls" button at the foot
of the sidebar switches the connection state, the login state and the first run, and it
resets everything.

## What is in it

| Screen | Address after `#` |
|---|---|
| Home, one table of everything that waits for the owner | `/home` |
| All projects, one table of every project | `/projects` |
| Project board, as columns, a table, or a roadmap | `/p/console/board`, `/p/console/board/table`, `/p/console/board/roadmap` |
| Sprint page, with its plan and tasks side by side | `/p/console/sprint/sp7` |
| Task and team pages | opened from the board and the sidebar |
| Workflow, the build loop's phases | `/p/console/workflow` |
| Review rounds, Test runs, End result, and the workflow's settings | `/p/rules/workflow/review`, `/p/console/workflow/runs`, `/p/apiref/workflow/result`, `/p/console/workflow/settings` |
| Mocks, for a project in its Design stage | `/p/phone/mocks`, and one screen at `/p/phone/mocks/screen/requests` |
| Chat with any agent | `/p/console/chat` |
| Messages, the agents' message board | `/p/console/messages` |
| Agents, the roster by situation | `/p/console/agents` |
| Terminal | `/p/console/terminal` |
| Files, the inspected worktree as a folder tree and a read-only file view | `/p/console/files`, and one file at `/p/console/files?f=README.md` |
| Git, with generated commit and pull request text | `/p/console/git` |
| Project settings, with the lead's model and the work assignment table | `/p/console/settings` |
| Repository design page, the design file on a canvas | `/r/lgcode/design`, and `/r/<repository>/design/<category>/<item>` |
| Machines, Subscriptions, Phone notifications, Service settings | `/machines`, `/subscriptions`, `/notifications`, `/settings` |
| Login and first run | `/login`, `/setup` |

A repository without a design file, such as `atlas-docs`, shows the Design page's empty
structure at `/r/atlas-docs/design`.

## How the files are arranged

- `index.html` loads the stylesheets and `js/app.js`.
- `css/tokens.css` holds every colour, size and duration. No other file may hold a literal
  colour.
- `css/base.css` holds the shell and the shared components. Each screen has its own
  stylesheet beside it.
- `js/lib.js` holds the store, the router and small helpers.
- `js/data.js` holds the sample data and the functions that read it.
- `js/actions.js` holds every change to the data.
- `js/ui.js` holds the shared components.
- `js/files-data.js` holds the Files tab's listings, file text, and a small highlighter.
- `js/screens/` holds one file for each screen. `js/screens/design.js` holds the Design
  page and the canvas that the Mocks tab reuses for its large preview.
- `plans/` holds plan pages in HTML. `website-replacement.html` is converted from
  `.plans/plans/website-replacement/plan.md`, and `plan.css` styles it.
- `js/icons.js` is generated from Lucide. `vendor/htm-preact` is a link to
  `third_party/htm-preact/`. `fonts` is a link to `design/fonts/`.

## Rules the mock keeps

Agents are named by their role, such as Project lead and Builder 1. No agent has an
invented personal name. The page's own text never says that it is a mock or a sample. The
layout and density rules are in the "Layout and density" section of
[../DESIGN.md](../DESIGN.md).
