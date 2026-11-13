# The rebuilt LGTM Studio mock

This folder is a working mock of the whole LGTM Studio web page. The owner asked for it on
2026-11-10. Opened from this folder, it does not connect to the engine and it never calls an agent.
Every screen works on data held in the browser's memory.
The live website, described below, runs the same files on the engine's records.

## How to open it

Serve the `design/` folder, which is the parent of this folder.

```
cd design
python3 -m http.server 4178 --bind 127.0.0.1
```

Then open `http://127.0.0.1:4178/`, which opens the mock at `http://127.0.0.1:4178/mock/`. The mock has no build step and loads nothing from
the network.

Changes you make stay until you reload the page. The colour mode, the density, and the
sizes of the panels are remembered in the browser. The "Mock controls" button at the foot
of the sidebar switches the connection state, the login state and the first run, and it
resets everything.

## The live website built from this mock

The same files also run as the live website, which reads the engine's real records.
The package `packages/studio` copies this folder, adds the connection to the engine, and
the engine serves the result at `/studio/`.
This folder itself is not changed by that build, and it still opens on its sample data.

Build the live website from the repository root:

```
pnpm --filter @lgtm/studio build
```

Then start the engine with a web password, as the root `README.md` describes, and open
`http://127.0.0.1:8787/studio/`.
The page asks for the web password, and it shows the engine's repositories, projects,
teams, agents and open requests after you sign in.
The current web page stays at `http://127.0.0.1:8787/`.

In live mode the page has no "Mock controls" button and no sample data.
Actions that change something are not connected to the engine yet.
Such an action shows the notice "This is not connected to the service yet. Nothing was
changed." and leaves the page as it was.
The Terminal and Files tabs and the first run say that they are not connected yet.
`js/engine.js` describes the connection object that `mount()` accepts in live mode.

## Using it as a package

This folder is also a local npm package named `lgtm`, so another project can load the
whole website and build on it. It is the basic version of LGTM Studio. The package has no build step and no dependencies.

- Install it by path, for example `npm install ../lgtm-studio/design/mock`. npm links the
  folder rather than copying it, so the links to `design/fonts/`,
  `third_party/htm-preact/` and `third_party/codemirror/` keep working.
- Load the stylesheets that `index.html` loads, from the package's `css/` folder.
- Import `mount` from `lgtm` and call it with an empty element. It seeds the sample
  data, starts the simulation, renders the website, and returns `{ store, act }`.
- A browser page without a build step maps the package's name to its folder with an import
  map, such as `{"imports": {"lgtm": "/node_modules/lgtm/js/app.js",
  "lgtm/": "/node_modules/lgtm/"}}`.

This folder's own page starts the mock the same way, through `js/main.js`.

`mount` takes a second, optional argument, `{ connection, slots }`:

- **`connection`** receives every call the website would make to the engine. The
  website's actions report them through `js/engine.js` as `call(tag, payload)`, using
  the request names from `@lgtm/contracts`, such as `prompt`, `answer`, `stop` and
  `create`. The simulation's updates go through `push(kind, payload)`, such as
  `agent.message` and `agent.activity`. On mounting, the website calls `snapshot`, then
  `subscribe`. Without a connection, the calls go nowhere and the mock behaves as before.
- **`slots`** fills three named places with a component, by name. `sidebar.head` sits
  under the sidebar's brand row. `sidebar.account` sits in the sidebar's foot, above the
  owner's row. `topbar.connection` replaces the "Live" badge in the top bar.

`unmount(el)` removes the website from the element and returns to the default connection.

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
| Files, the inspected worktree as a folder tree and a small editor that saves and commits one file | `/p/console/files`, and one file at `/p/console/files?f=README.md` |
| Git, with generated commit and pull request text | `/p/console/git` |
| Project settings, with the lead's model and the work assignment table | `/p/console/settings` |
| Repository design page, the design file on a canvas | `/r/lgtm/design`, and `/r/<repository>/design/<category>/<item>` |
| Machines, Subscriptions, Notifications, Service settings | `/machines`, `/subscriptions`, `/notifications`, `/settings` |
| Login and first run | `/login`, `/setup` |

A repository without a design file, such as `atlas-docs`, shows the Design page's empty
structure at `/r/atlas-docs/design`.

## How the files are arranged

- `index.html` loads the stylesheets and `js/main.js`, which calls `mount()` from `js/app.js`.
- `package.json` names the folder `lgtm` and lists the paths another project may import.
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
- `plans/` holds plan pages in HTML. `sp-07-phone-layout.html` is the sample plan for
  SP-07, and `plan.css` styles it.
- `js/icons.js` is generated from Lucide. `vendor/htm-preact` is a link to
  `third_party/htm-preact/`. `fonts` is a link to `design/fonts/`.

## Rules the mock keeps

Agents are named by their role, such as Project lead and Builder 1. No agent has an
invented personal name. The page's own text never says that it is a mock or a sample. The
layout and density rules are in the "Layout and density" section of
[../DESIGN.md](../DESIGN.md).

## Notifications in sample and live mode

The Notifications page configures ntfy and email independently.
Email uses the owner's mail server.
Both carriers have an enable switch and a test action.
Quiet hours have a start, an end, a time zone, and a failure override.
Merge reviews and sprint completions use the engine's existing events.
The sample mode simulates delivery without a network request.
The live website sends each action through the authenticated client application programming interface (API).
Secret fields never contain a stored secret.
See [the notification guide](../../docs/notifications.md) for the transport and API details.
