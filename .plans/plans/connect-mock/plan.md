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

## What the owner ruled on 2026-11-12

- **The mock becomes the website.** The React page in `packages/web` is replaced by it.
- **The mock is connected as it is.** The owner ruled later on 2026-11-12 that the
  website is not converted first. The mock's plain JavaScript screens are connected to the
  engine. The owner starts the conversion to React and TypeScript, or to another
  framework, after the website works.
- **The contract moves to gRPC and Protocol Buffers.** The owner ruled: "gRPC is the way to
  go."
- **LGTM Studio is the first project, and it is used on itself.** As soon as the website
  can run a project on the real engine, the rest of this plan is built as projects inside
  LGTM Studio, on its own repository.

## How the website talks to the engine, and whether to change it

The owner wants calls from the website to the server to be very fast, and wants the
contract typed in Protocol Buffers. The owner named the technology that Firestore uses.
That technology is gRPC, with Protocol Buffers as its message format.

What exists today, read from `packages/client/src/browser.ts` and
`packages/client/src/core.ts`:

- The website opens one WebSocket to the engine and keeps it open.
- Every request and every update travels over that one connection, as Effect RPC messages.
- The messages are written as JSON.
- The contract is typed once, in TypeScript, in `packages/contracts`.

So the website does not pay the cost of a new HTTP request for each call today. A call is
one small message on a connection that is already open. That is the same idea gRPC uses.

The choices:

| Choice | What changes | What it costs |
|---|---|---|
| Keep the WebSocket, and switch the message format from JSON to a compact binary one | One line on each side. Effect RPC ships a MessagePack format. | Almost nothing. Messages get smaller. The contract stays in TypeScript. |
| Move the contract to Protocol Buffers, and carry it over the same WebSocket | About 110 requests are rewritten as `.proto` files, and code is generated for TypeScript. | Large. The contract no longer comes from Effect, so code copied from T3 Code needs adapting. A phone app in Swift or Kotlin could then use the same contract. |
| Move to gRPC | The same rewrite, plus a different server. A browser cannot speak gRPC directly, so it needs gRPC-Web or Connect, and a proxy or a second listener. | Largest. It replaces the working API layer. |

The owner chose gRPC on 2026-11-12. The rest of this section says how this plan carries
that out. The owner has not ruled on these details.

**When the move happens.** The mock is connected first over the WebSocket that exists, in
steps 1 and 2. The move to gRPC is step 3. This order gets a working website soonest. The
mapping from the engine's records to the screens does not depend on the transport, so it
is not written twice.

**How a browser reaches gRPC.** A browser cannot speak gRPC itself. This plan suggests the
Connect protocol. One server answers gRPC, gRPC-Web and Connect on the same port, from the
same `.proto` files. The command, the Model Context Protocol server and a future phone app
use gRPC. The browser uses Connect, with no proxy between. The library's current
documentation is read before any code is written.

**The owner's idea of a server-rendered website in the middle.** The owner suggested
Next.js or Nuxt, with the website's own server calling the engine over gRPC. This plan
advises against it for this product, for three reasons.

1. The slow part of any call is the trip between the browser and the server. A middle
   server adds a second trip and does not shorten the first.
2. The engine and the middle server would run on the same machine, where gRPC saves
   nothing a person could notice.
3. The pages are live and signed in. Server rendering helps pages that must load fast for
   strangers and search engines. Live updates would still need their own open connection
   to the browser.

The engine keeps serving the website's files, and the browser talks to the engine
directly. The choice of framework for the screens is separate, and it is made when the
conversion starts.

## What each screen needs

The table below is a first reading, made from request names alone. The checked table is
[gap-table.md](gap-table.md), written on 2026-11-13 from the source. Where the two differ,
the checked table is right. The mock reports 14 kinds of call, not 9.

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
| Notifications | `alerts.*` | Nothing found yet |
| Service settings | `settings.get`, `settings.set`, `web.settings` | The Git message model |
| Search | `context.search` | Ranking across repositories, projects and agents |

## The steps

Each step ends with something the owner can do on the real website. The work is on the
branch `area/build-loop`, with one pull request for each step.

### Step 1: one real connection, and the website stops inventing data

- Write a real connection for the mock. It uses the existing browser client in
  `packages/client`, and it lives in TypeScript. Nothing else in the mock knows which
  transport it uses, so step 3 changes only this file.
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
- New project, first run, Project settings, Service settings and Notifications.

Every action in these screens stops changing the browser's memory. It makes its call and
waits for the engine's update.

The owner can then: do everything the old website did, on the new one. The old pages are
removed at the end of this step.

From here on, LGTM Studio is used on itself. The owner creates a project in the LGTM
Studio repository for each later step, and its project lead runs the work. Until step 6
is built, the lead is steered by hand: the owner, or the orchestrating agent, tells it
what to do next. After step 6 the workflow does that.

### Step 3: the contract moves to gRPC and Protocol Buffers

- The requests in `packages/contracts` are written as `.proto` files, and the TypeScript
  types are generated from them.
- The engine answers gRPC and Connect. The website, the command and the Model Context
  Protocol server move to it.
- The old WebSocket API is removed when nothing uses it.
- A call and a pushed update are timed before and after the move, on the real website.

The owner can then: use the same website, with every call on the new contract.

### Step 4: the engine gains what the daily surfaces show and it lacks

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

### Step 5: the new surfaces the engine has nothing for

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

### Step 6: the autonomous workflow behind the Workflow tab

"Build loop" here means the product feature: the autonomous workflow that moves a project
through its eight phases without the owner. It does not mean the way this plan itself is
built. Its plan is `.plans/plans/build-loop/plan.md`, from its step 2 onward.
The Workflow tab, Review rounds, End result and the workflow's settings get their engine
here, because they show the loop and nothing else.

The owner can then: type a goal and next hear from LGTM Studio when the merge request is
ready.

### Step 7: installing and hosting

- The documented steps build the package and install it from the repository.
- The website is served at the owner's address over HTTPS. The owner sets up the proxy.
- A release is published on GitHub.

The owner can then: stop using the terminal, which is the end point the owner set.

## How this fits the build loop plan

The build loop plan put the loop first and brought the website along. The owner's
direction on 2026-11-12 puts the website first: connect the mock, then build what is
missing. This plan keeps the loop as step 6. Steps 1 to 5 here replace the website parts
of the build loop plan's steps 1 and 2.

## Decisions the owner needs to make

1. **Is the move to gRPC step 3, after the website works on the existing connection?**
   This plan assumes yes.
2. **Does the browser reach the engine directly through Connect, with no server-rendered
   website in the middle?** This plan recommends yes.
3. **Is the autonomous workflow step 6, after the website works on real data?** This plan
   assumes yes.

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
  steps 2, 4 and 5.
