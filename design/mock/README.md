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
| Home, with requests across projects | `/home` |
| Project board, with the lead conversation docked | `/p/console/board` |
| Sprint, task and team pages | opened from the board and the sidebar |
| Workflow, the build loop's phases and review rounds | `/p/console/workflow` |
| Mocks, for a project in its Design stage | `/p/phone/mocks` |
| Chat with any agent | `/p/console/chat` |
| Messages, the agents' message board | `/p/console/messages` |
| Agents, the roster by situation | `/p/console/agents` |
| Terminal | `/p/console/terminal` |
| Git | `/p/console/git` |
| Project settings | `/p/console/settings` |
| Repository design page | `/r/lgcode/design` |
| Machines, Subscriptions, Phone notifications, Service settings | `/machines`, `/subscriptions`, `/notifications`, `/settings` |
| Login and first run | `/login`, `/setup` |

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
- `js/screens/` holds one file for each screen.
- `js/icons.js` is generated from Lucide. `vendor/htm-preact` is a link to
  `third_party/htm-preact/`. `fonts` is a link to `design/fonts/`.

## Rules the mock keeps

Agents are named by their role, such as Project lead and Builder 1. No agent has an
invented personal name. The page's own text never says that it is a mock or a sample. The
layout and density rules are in the "Layout and density" section of
[../DESIGN.md](../DESIGN.md).
