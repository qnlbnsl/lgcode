# The mock's data files and stub functions

The mock runs on hardcoded data, with no service behind it. The data is shaped like the
engine's database, and functions named after the engine's commands hand it to the page.
A real export can replace the sample without changing the page. This is the same idea as
Ananke's `apps/mocks`, which loads a production export without standing up the servers.

## What the files are

| File | What it holds |
|---|---|
| `stubs.js` | The global `api` object that stands in for the client API. |
| `sample/` | The small sample, and the page's default. It is committed to git. |
| `heavy/` | 10 projects, 31 agents, and a long lead thread, at `?sample=heavy`. It is committed to git. |
| `prod/` | A real export. Git ignores this folder, because threads hold whatever agents wrote. |
| `export.mjs` | Copies a real database into `prod/`. |
| `validate.mjs` | Checks an events file against the engine's contracts. |

Each data folder holds up to three files:

- `events.json` holds rows of the `events` table, with the table's exact columns.
- `meta.json` holds the export time, the fixed clock, the display time zone, and row counts.
- `reads.json` holds what the engine works out at request time and does not store.

## Why the data is one events table

Sheprd stores one table of events, in `events.sqlite`. Everything else is a fold over those
events, in `packages/engine/src/views/`. The other tables hold receipts, agent tokens,
processes, and migration records, and the page needs none of them. So `events.json` is the
database, and `stubs.js` folds it into the shapes the page draws.

`reads.json` holds Git state, merge evidence, terminal replies, harness models and logins,
large thread items, default settings, and scripted reactions. The design note says the
engine reads Git from the worktree at request time, so none of it belongs in events.

## Which event types are real and which are proposed

`validate.mjs` decodes every row with a real event type against
`packages/contracts/src`. It also compares `thread_agent_id` with the engine's rule. Run it
after changing the sample:

```sh
node design/data/validate.mjs design/data/sample/events.json design/data/heavy/events.json
```

The engine has no project, sprint, task, machine, or repository records yet. The website
todo names a new `project` piece for them. The sample uses these proposed types, and
`validate.mjs` only lists them:

| Proposed event type | What it records |
|---|---|
| `project.MachineAdded`, `project.MachineChanged` | A paired machine, its role, and its status. |
| `project.MasterJoined` | This computer joined a master as a worker. |
| `project.RepositoryAdded`, `project.RepositoryLocated` | A repository, and its folder on a machine. |
| `project.WorktreeCreated` | A worktree, with its branch, folder, project, and team. |
| `project.Created`, `project.Placed` | A project with its lead, and the machine for its next run. |
| `project.PreferencesChanged` | The preferred shell for a project's terminals. |
| `project.TeamAdded`, `project.SprintAdded` | A team and its worktree, and a sprint in a project. |
| `project.TaskAdded`, `project.TaskChanged` | A task with its story, and a change to its state. |
| `project.QuestionLinked` | A question's title, recommendation, task, and sprint. |
| `project.AccountPlaced` | The machine an account signs in on. |
| `project.PromptContext` | Files and tasks attached to a prompt, and the chosen account. |
| `project.ReplyStopped` | The owner stopped a reply, and why. |

## How the page gets its data

`workbench.html` loads `stubs.js`, then calls `api.boot()`. That picks the files in this order:

1. `?sample=heavy` loads `heavy/`, and `?sample=small` loads `sample/`.
2. Otherwise, `prod/` loads if it exists and holds an `AgentStarted` row.
3. Otherwise, `sample/` loads. A 404 for `prod/` is expected.

`api.boot()` returns the snapshot, and only then does `workbench.js` start. The Design notes
dialog says which data is showing. The page must be served, because `fetch` cannot read
files from `file://`.

Times are not hardcoded. Home works out each wait from the event's `occurred_at` and the
fixed clock in `meta.json`. Blocked tasks and active agent counts come from the data too.

## Which stub stands for which real command

The real command names come from `packages/contracts/src/client/commands.ts`. "Proposed"
means the engine has no such command yet.

| Stub | Real command |
|---|---|
| `api.client.snapshot`, `api.client.thread`, `api.client.roster` | `client.snapshot`, `client.thread`, `client.roster` |
| `api.client.subscribe`, `api.client.sequence` | `client.subscribe`, `client.sequence` |
| `api.client.prompt`, `api.client.stopReply` | The prompt and interrupt commands, and a board post for a team |
| `api.client.largeItem` | The thread item read |
| `api.questions.answer`, `api.permissions.answer` | The question and permission answers |
| `api.agents.stop`, `api.agents.resume` | The stop and resume commands |
| `api.alerts.list`, `api.settings.*` | `client.alerts.list`, `client.alerts.settings`, `client.web.settings` |
| `api.accounts.*` | The account commands, and a terminal on that machine for sign-in |
| `api.project.*`, `api.machines.*` | Proposed |
| `api.git.*`, `api.terminal.run` | Proposed |

Reads return promises, as the real API will. The page awaits one snapshot at boot and keeps
its live objects, which stands in for a snapshot plus a subscription. Commands take effect
before they return, so a page handler can call one and draw at once. A real client would
wait for the result, and the website must do that. `api.git.state` and `api.terminal.run`
answer synchronously, because the page reads them while it draws.

`api.debug` exists only for Design notes and the checks.

## What is scripted

These parts behave, but they are not real:

- A prompt gets one scripted reply after 900 milliseconds, from `replies.default`.
- An answered question gets the reactions in `reactions`, or one line from the lead.
- Sign-in and pairing each finish by themselves after 1,200 milliseconds.
- The terminal answers a fixed list of commands, and `help` prints the list.
- Everything resets when the page reloads, because nothing is saved.

## How to load a real export

Run this on the machine that has the engine's database. It reads `events.sqlite` from the
state folder, or from the path you give it:

```sh
node design/data/export.mjs [path/to/events.sqlite]
```

The export reads the `events` table and nothing else, so tokens and receipts stay behind.
It removes account secrets and carrier topics. The rest of an event is copied as it is, so
treat `prod/` as private. Reload the page to see it, and delete the folder to go back.

A real export has no `project.*` rows yet. The stubs then make one project from each agent
group, and one repository from each agent's folder. Boards stay empty until the project
piece exists, because no sprints or tasks are recorded. Threads, Home, approvals, questions,
alerts, and team chat show real data. No real database exists on the machine where this was
built, so the export has only run against a database built from the engine's own migrations.
