# Connecting the mock to the engine: a quick plan

The owner asked for this plan on 2026-11-12. The mock in `design/mock/` has changed a lot
since the build loop plan was written. The work is now to make the mock the real website.
That means connecting it to the engine, and building the engine features that the mock
shows and the engine lacks.

This plan was written from a short survey of `master` at commit `8c31294`. The survey
listed the mock's files, the calls the mock reports, and the request names in
`packages/contracts`. Nobody ran the product. The table of gaps below is a first reading,
and step 1 replaces it with a checked one.

## What the survey found

- **The mock is already a package with a place to plug the engine in.** The folder is the
  package `lgtm`. Its `mount()` takes a `connection`. Every action reports a call through
  `design/mock/js/engine.js`, and the simulation reports its updates the same way.
- **The mock reports only 9 kinds of call today.** They are `snapshot`, `subscribe`,
  `prompt`, `answer`, `stop`, `resume`, `configure`, `create` and `team.create`. Every
  other action changes only the browser's memory.
- **The mock still starts from sample data.** `mount()` calls `seed()` and starts a
  simulation. A real connection would be told about calls, but the screens would still
  show the sample.
- **The engine's client API is wide.** `packages/contracts` names about 110 requests. They
  cover agents, the message board, alerts, settings, repositories, projects, sprints,
  tasks, teams, setup, mocks, design records, and nearly all of Git, with review and
  conflicts.
- **The current website is a separate program.** `packages/web` is about 6,400 lines of
  React. The mock is about 7,500 lines of Preact with no build step.

## The one decision that shapes everything

The mock becomes the website. The React page in `packages/web` is retired when the mock
can do what it does.

This is the plan's recommendation, and the owner has not ruled on it. The reasons are that
the owner approved these screens by using them, that the mock already has the connection
seam, and that building the same screens a second time in React is how the website fell
behind the mock before.

One cost comes with it. `AGENTS.md` says the product is written in TypeScript, and the
mock's screens are plain JavaScript. This plan writes the connection and the data mapping
in TypeScript, where the client API's types matter. The screens stay as they are for now.
Moving the screens to TypeScript is a later choice for the owner.

## What each screen needs

"Has it" means a request with that purpose exists in `packages/contracts`. It does not
mean the request returns everything the screen shows.

| Screen in the mock | The engine has | The engine lacks |
|---|---|---|
| Login and first run | Login, `setup` and its steps, `accounts`, `harnesses`, `repository.add` | The Git message model question |
| Sidebar and All projects | `repositories`, project `read`, `roster`, `archive`, `rename` | The running product description of a repository |
| New project | `create`, `goal.set`, `placement.preview` | Creating from a goal alone, and the lead's naming tool |
| Home | `requests`, `answer`, `alerts.*` | The brief fields on a request, and the evidence strip on a merge request |
| Chat | `thread`, `prompt`, `answer`, `stop`, `resume`, `configure`, `compact`, `context.search` | Files and images on a message |
| Board | `sprint.*`, `task.*`, `team.create`, `stage.set` | Epics, priority, the Backlog status, and dates for the roadmap |
| Sprint and task pages | `sprint.update`, `task.note`, `task.history` | A plan stored with the sprint, and a task's link into it |
| Workflow | Nothing | Phases, the moves between them, and the settings |
| Review rounds | Nothing for a project; Git has `review.*` for a merge | Rounds, findings, points, and the stuck statement |
| Test runs | Nothing | Runs, jobs, steps, logs, and "Start full run" |
| End result | Nothing | The numbered statements and "Request change" |
| Mocks | `mocks.record`, `mocks.read`, `mocks.artifact`, `mocks.approve` | Comments on a screen, to be checked |
| Messages | `channels`, `read`, `post`, `acknowledge`, `members` | Nothing found yet |
| Agents | `roster`, `agent.context`, `agent.configuration`, `stop`, `resume` | Turns and tokens for each agent, to be checked |
| Terminal | Nothing found in the client API | A terminal session over the connection |
| Files | Nothing found in the client API | The folder tree, reading a file, and saving one |
| Git | Almost all of it | Generated commit and pull request text |
| Project settings | project `settings`, `settings.set`, `preferences.set` | The work assignment table |
| Repository Design page | `design.record`, `design.read`, the OpenPencil start-up | Saving the design file into the repository |
| Machines | `workspaces`, `workspace.register` | Pairing, and the load figures |
| Subscriptions | `accounts`, `harnesses` | Usage meters, to be checked |
| Phone notifications | `alerts.*` | Nothing found yet |
| Service settings | `settings.get`, `settings.set`, `web.settings` | The Git message model |
| Search | `context.search` | Ranking across repositories, projects and agents |

## The steps

Each step ends with something the owner can do on the real website. The work is on the
branch `area/build-loop`, with one pull request for each step.

### Step 1: one real connection, and the mock stops inventing data

- Write a real connection for the mock. It uses the existing browser client in
  `packages/client`, and it lives in TypeScript.
- Add a live mode to `mount()`. In live mode the mock does not call `seed()` and does not
  start the simulation. It fills its store from `snapshot` and keeps it current from
  `subscribe`.
- Write the mapping from the engine's records to the store's shape, one kind of record at
  a time.
- The engine serves the mock's folder as the website, beside the current page, at its own
  address.
- A screen with no engine data yet shows its empty structure. It never shows the sample.
- Replace the table above with a checked one. For each screen it lists every field the
  screen reads and every action it takes, against the real request.

The owner can then: sign in to the new website on the real service and see the real
repositories, projects and agents in the sidebar.

### Step 2: the daily surfaces work on real data

This step uses only requests the engine already has.

- Home: the table of requests, and answering in place.
- Chat: threads, sending a message, stopping, resuming, and changing the model.
- Board, sprint and task pages, on the engine's sprints and tasks.
- Messages and Agents.
- Git: changes, staging, diffs, commit, history, conflicts, and the merge review.
- New project, first run, Project settings, Service settings and Phone notifications.

Every action in these screens stops changing the browser's memory. It makes its call and
waits for the engine's update.

The owner can then: do everything the current React website does, on the new website. The
React website is retired at the end of this step.

### Step 3: the engine gains what the daily surfaces show and it lacks

These are small additions to records that already exist.

- A request stores its brief, description, recommendation, other answers and references.
- A merge request stores its evidence strip and the "Users will notice" line.
- A project is created from a goal alone, and the lead names it with a tool.
- Sprints gain epics, priority, the Backlog status and dates.
- A sprint stores its plan as an HTML page, and a task links into it.
- A message carries files and images.
- Agents are named by role in the engine.

The owner can then: use Home, Chat, the board and the sprint page exactly as the mock
shows them.

### Step 4: the new surfaces the engine has nothing for

Each of these is a new piece in the engine, a set of requests, and the screen's mapping.

- **Files.** The folder tree of a worktree, reading a file, and saving and committing one.
- **Terminal.** A terminal session on a machine, carried over the connection.
- **Test runs.** Runs, jobs, steps and logs, started from the project's configured command.
- **Machines and Subscriptions.** Pairing, load figures and usage meters.
- **The repository Design page.** OpenPencil saving into the repository. This starts with
  the test of OpenPencil's server against direct edits of the design file.
- **Generated Git text.** The commit message and the pull request text, from the model
  chosen in settings.
- **Search.** Ranking across repositories, projects and agents.

The owner can then: stop opening a terminal for everyday work on a project.

### Step 5: the build loop behind the Workflow tab

This is the build loop plan in `.plans/plans/build-loop/plan.md`, from its step 2 onward.
The Workflow tab, Review rounds, End result and the workflow's settings get their engine
here, because they show the loop and nothing else.

The owner can then: type a goal and next hear from LGTM Studio when the merge request is
ready.

### Step 6: installing and hosting

- The documented steps build the package and install it from the repository.
- The website is served at the owner's address over HTTPS. The owner sets up the proxy.
- A release is published on GitHub.

The owner can then: stop using the terminal, which is the end point the owner set.

## How this fits the build loop plan

The build loop plan put the loop first and brought the website along. The owner's
direction on 2026-11-12 puts the website first: connect the mock, then build what is
missing. This plan keeps the loop as step 5. Steps 1 to 4 here replace the website parts
of the build loop plan's steps 1 and 2.

## Decisions the owner needs to make

1. **Does the mock become the website, with the React page retired?** This plan assumes
   yes.
2. **Do the mock's screens stay in plain JavaScript for now?** This plan assumes yes.
3. **Is the loop step 5, after the website works on real data?** This plan assumes yes.
   The other order is the loop's thin path first, as the build loop plan had it.

## What could go wrong

- **The store's shape and the engine's records disagree.** The mock's data was written
  for the screens. Where they disagree, the mapping absorbs it. The engine changes only
  when the screen needs data that the engine does not hold.
- **Actions that wait for the engine feel slower.** The mock answers at once because it
  changes memory. Step 2 keeps a pending state on each action, so the page still responds
  at once.
- **The terminal is larger than it looks.** A real terminal needs a process on the
  machine and a stream both ways. If it stalls, it becomes its own step.
- **The gap table is a first reading.** Step 1's checked table may move items between
  steps 2, 3 and 4.
