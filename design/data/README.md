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
| `first/` | A service with no events, at `?sample=first`, plus what a first run can find. It is committed to git. |
| `prod/` | A real export. Git ignores this folder, because threads hold whatever agents wrote. |
| `local/` | Repositories from the owner's private work, added with `?with=<id>`. Git ignores this folder, because this repository is public. |
| `export.mjs` | Copies a real database into `prod/`. |
| `validate.mjs` | Checks an events file against the engine's contracts. |

Each data folder holds up to three files:

- `events.json` holds rows of the `events` table, with the table's exact columns.
- `meta.json` holds the export time, the fixed clock, the display time zone, and row counts.
- `reads.json` holds what the engine works out at request time and does not store.

## Why the data is one events table

LGcode stores one table of events, in `events.sqlite`. Everything else is a fold over those
events, in `packages/engine/src/views/`. The other tables hold receipts, agent tokens,
processes, and migration records, and the page needs none of them. So `events.json` is the
database, and `stubs.js` folds it into the shapes the page draws.

`reads.json` holds Git state, merge evidence, terminal replies, harness models and logins,
large thread items, context use, default settings, and scripted reactions. The design note says the
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
| `project.TeamAdded`, `project.SprintAdded` | A team with its stage, area, and worktree, and a sprint in a project. |
| `project.StageChanged` | The project moved to Design, Plan, Build, Review, or Hand over. |
| `project.MocksStarted` | The Design team started mocks: where screens are served, the design file, and the data scenarios. |
| `project.MockScreenAdded`, `project.MockScreenRevised` | A screen with its route and note, and one recorded change to it, with who made it. |
| `project.MockDataDrafted` | A field the screens use, with its type and the screens that use it. |
| `project.MockComponentUsed` | A component the screens use, where it lives, and whether it is real or a draft. |
| `project.MocksApproved` | The owner approved the mocks, which promotes the drafts. |
| `project.TaskAdded`, `project.TaskChanged` | A task with its story, and a change to its state. Each step of a story's activity has an `at` time, and a step without one takes the time the task was added. |
| `project.QuestionLinked` | A question's title, recommendation, task, and sprint. |
| `project.AccountPlaced` | The machine an account signs in on. |
| `project.PromptContext` | Files and tasks attached to a prompt, and the chosen account. |
| `project.ReplyStopped` | The owner stopped a reply, and why. |
| `project.SetupProgressed`, `project.SetupFinished` | How far the first run has got, and that it is done. |
| `project.RepositoryForgotten` | A repository found by a scan was dropped when the owner chose another folder. |
| `project.ModelChosen` | The owner chose another model or effort for an agent's next turns. |

## How the page gets its data

`workbench.html` loads `stubs.js`, then calls `api.boot()`. That picks the files in this order:

1. `?sample=heavy` loads `heavy/`, and `?sample=small` loads `sample/`.
2. Otherwise, `prod/` loads if it exists and holds an `AgentStarted` row.
3. Otherwise, `sample/` loads. A 404 for `prod/` is expected.
4. `?with=<id>` adds the rows in `local/<id>/` when `local/index.json` lists that id.

`api.boot()` returns the snapshot, and only then does `workbench.js` start. The Design notes
dialog says which data is showing. The page must be served, because `fetch` cannot read
files from `file://`.

Times are not hardcoded. Home works out each wait from the event's `occurred_at` and the
fixed clock in `meta.json`. Blocked tasks and active agent counts come from the data too.

Home needs three more times, added on 2026-11-08 for the designer's Home findings:

- **When a request was answered.** The reducer copies the answering event's `occurred_at`
  into `answeredAt` on a question or permission, and on a cancelled permission too. Home
  shows it as "Allowed 10:47" or "Answered 10:47". The engine's answer events already carry
  this time, so the real API needs no new field.
- **Since when a merge has waited.** `api.git.state` returns `pendingSince`, the time the
  first unmerged commit arrived, and `mergedAt`, the time of the last merge. The engine reads
  Git at request time, so the real service would take `pendingSince` from the oldest
  unmerged commit's date.
- **A merge that was already waiting.** A worktree in `reads.json` can hold `awaiting`, with
  `since` and its `commits`. The heavy sample uses it for `docs/api-reference`, which has
  waited 1 hour and 25 minutes for the owner's merge.

The composer needs five more facts, added on 2026-11-08 for the designer's composer findings:

- **The model and effort an agent runs with.** The engine's `AgentStarted` event already has
  optional `model` and `effort` fields, and the samples now fill them in. The roster returns them.
- **A change of model or effort while the agent runs.** The engine sets both only at start, so
  `api.agents.choose` writes the proposed `project.ModelChosen` event. The reducer copies its
  fields onto the agent.
- **How much of the context window is in use.** `reads.json` holds `usage`, with `used` and
  `window` in tokens for each agent. `api.agents.usage` returns them with the percentage. The
  real service would read the harness's latest usage report at request time.
- **Model names people read.** `reads.json` holds `harness.modelLabels`, such as "Opus 5.5" for
  `claude-opus-5-5`.
- **A delivery that failed.** The reducer now folds the engine's `DeliveryReturned` and
  `DeliveryWithdrawn` events, and marks the delivery `failed`, so a thread can show it.

Git and the terminal need more, added on 2026-11-08 for the designer's Git and terminal findings:

- **What a conflict looks like.** `reads.json` holds `git.conflicts`, keyed by file path. Each
  file is a list of segments. A shared segment has `line`, the number of its first line, and
  `context`, its lines. A conflict has `ours`, `base`, and `theirs`. `api.git.conflict`
  returns the segments with the branch names and the choices made so far. The real service
  would read the conflict markers from the file at request time.
- **A choice for each conflict.** `api.git.choose` keeps ours, theirs, or both for one
  conflict, and `api.git.resolve` marks the file resolved once every conflict has a choice.
- **Staging and discarding many files.** `api.git.stageAll`, `api.git.unstageAll`, and
  `api.git.discard` act on the worktree in the same way as `api.git.stage`. Stage all and
  Discard leave conflicted files alone.
- **Terminal sessions.** `api.terminal.sessions` lists a worktree's sessions, each with an
  `id` and a `name`. An empty name means the shell's own name, such as "Shell 1".
  `api.terminal.open`, `api.terminal.close`, and `api.terminal.rename` change the list, and
  `api.terminal.complete` completes the last word of a command for the Tab key. Sessions
  live on the machine, so none of this belongs in events.
- **A long list of changed files.** In the heavy sample, Invoice exports has 26 changed files,
  so the Git page shows the long-list case.

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
| `api.agents.choose`, `api.agents.usage` | Proposed: change an agent's model or effort, and read its context use |
| `api.alerts.list`, `api.settings.*` | `client.alerts.list`, `client.alerts.settings`, `client.web.settings` |
| `api.accounts.*` | The account commands, and a terminal on that machine for sign-in |
| `api.project.*`, `api.machines.*` | Proposed |
| `api.git.*`, `api.terminal.*` | Proposed |
| `api.setup.*` | Proposed: the first run's scan of the computer and its progress |
| `api.mocks.*` | Proposed: compare a mock field with the schema, read a repository's design, and approve mocks |

Reads return promises, as the real API will. The page awaits one snapshot at boot and keeps
its live objects, which stands in for a snapshot plus a subscription. Commands take effect
before they return, so a page handler can call one and draw at once. A real client would
wait for the result, and the website must do that. `api.git.state`, `api.git.conflict`, and the
`api.terminal` reads answer synchronously, because the page reads them while it draws.

`api.debug` exists only for Design notes and the checks.

## What is scripted

These parts behave, but they are not real:

- A prompt gets one scripted reply after 900 milliseconds, from `replies.default`.
- A prompt to a lead whose project has no mocks starts a Design team when it mentions screens
  or a design, from the words in `mocks.uiWords`. The screens in `mocks.starter` then arrive
  every `mocks.screenDelay` milliseconds.
- A prompt sent while a mock screen is open matches `mocks.tweaks`, and the change is a small
  piece of style added to the screen. A real Design team would edit the screen's code.
- Approving mocks writes a Planning team and its tasks from the screens, data, and drafts.
- An answered question gets the reactions in `reactions`, or one line from the lead.
- Sign-in and pairing each finish by themselves after 1,200 milliseconds.
- The first run's scan takes 500 milliseconds and returns `setup.scenarios` from `first/reads.json`, chosen by `?setup=`.
- First-run progress and sign-ins are kept in the browser's storage, so a reload can resume. The engine would store them.
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
