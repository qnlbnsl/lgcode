# Replacing the website: the todo list

The owner decided this on 2026-11-06. The mock, `design/workbench.html`, is
golden, and the engine gets whatever the mock needs. There are no stages.

The mock is still being edited, so its later changes add to this list. Its
spelling "shephrd" is the one exception to golden, because the product is Sheprd.

Each line below is one piece of work. "Agent's call" marks a choice the owner has
not ruled on.

## Engine: the data the mock shows

The engine has none of this today. All of it goes in a new `project` piece with
stored events, commands, a client API section and agent tools.

### Settings

- [ ] Store the workspace folder, which holds the owner's repositories. It is an
      owner-only setting. The installer will write it later.
- [ ] Store the defaults for a new project lead: harness, account, model, effort
      and permission. Add Project asks only for a repository and a name, so these
      must already exist. Agent's call.
- [ ] Store the owner's display name for the sidebar. It starts from git's
      `user.name`. Agent's call.

### Repositories, branches and changes

- [ ] List the repositories in the workspace folder, with name, path and project
      count.
- [ ] List a repository's branches and workspaces, with path, owner and activity,
      for the branch picker.
- [ ] Read a workspace's changes: changed files, added and removed line counts,
      and the diff with line numbers. Give the reply a size limit.
- [ ] Record which machine each repository and workspace is on. It is always the
      local machine until client mode exists.

### Projects and teams

- [ ] Add a project record: repository, name, goal, lead and assigned branch.
- [ ] Refuse a second project with the same name in a repository, ignoring case.
- [ ] Add Project starts the lead with the stored defaults, on the repository's
      base workspace, and opens its conversation.
- [ ] Choose each lead's name from a list. Agent's call.
- [ ] Enforce exactly one lead per project.
- [ ] Add a team record under a project, with a name and its agents. Reuse agent
      groups and group board channels, so team chat is the board.
- [ ] Tie every agent to its project and team, so the sidebar tree can be built.
- [ ] Show each agent's status: Needs you, Reviewing, Working or Ready. Reviewing
      and Working come from the agent's task.

### Sprints and tasks

- [ ] Add a sprint record: label such as SP-01, name, goal, phase, owner,
      dependencies, completion and evidence. The phases are the build loop's.
- [ ] Add a task record: label such as SH-12, title, owner, team, sprint, state
      and workspace. The states are up next, in progress, in review, blocked and done.
- [ ] Work out a sprint's column in one shared function, as the mock does: Planned,
      In progress, Review or Done.
- [ ] Refuse new tasks in a completed sprint.
- [ ] Let moving to Done happen only with completion evidence. Keep release status
      separate.
- [ ] Record a task's history for its Work and handoff timeline.
- [ ] Tell the project lead when the owner adds a task. Agent's call.
- [ ] Let leads write sprints and tasks through agent tools, so the board works
      before the workflow runner exists.
- [ ] Let a worker change only its own tasks, and only in its own project.

### Decisions and conversations

- [ ] Extend a question with a title, a recommendation and a proposed answer. The
      mock's decision card shows all three.
- [ ] Link a question to its task and sprint. A linked task shows as blocked while
      the question is open.
- [ ] Answering a linked question marks its task done, as the mock does. A worker
      whose task should continue asks without the link. Agent's call.
- [ ] Surface an open decision in the project lead's conversation, the sidebar and
      the sprint. Only an answer clears it.
- [ ] Add a command to stop a reply without stopping the agent. The runner can
      already cancel a turn, but no command reaches it.
- [ ] Let the owner read a team channel without leaving read marks. Today a board
      read marks posts, so the page waits for a tap.

## Website: rebuild `packages/web` to match the mock

- [ ] Move the Field and Dusk tokens and the mock's styles into files, because the
      site's security policy blocks inline styles and scripts.
- [ ] Rewrite the mock's string-built views in React. Agent data stays plain text.
- [ ] Build the sidebar tree: repositories, projects with lead and branch, teams
      and agents, with chevrons separate from selection.
- [ ] Build the Repositories page and each repository's page.
- [ ] Build the Add Project dialog.
- [ ] Build the sprint board with its four columns and the empty board.
- [ ] Build the lead chat panel on the board: open, close, expand, and a drawer on
      smaller screens with Escape and contained focus.
- [ ] Build the sprint page and the task page, with evidence, dependencies and the
      timeline.
- [ ] Build the Add Task dialog.
- [ ] Build the conversation view: compact header, quiet owner turns, collapsed
      tool details and a growing composer that names its recipient.
- [ ] Build team tabs for Chat, Tasks and Changes, remembering the last tab.
- [ ] Build the Changes view and the branch picker. Picking a branch changes only
      what is viewed.
- [ ] Build the decision card and its links, down to the exact question.
- [ ] Keep each conversation's draft and reading position.
- [ ] Build the color mode switch, following the device until the owner chooses.
- [ ] Build mobile navigation with contained focus.
- [ ] Keep routes in the URL hash, including the alert links `/#/thread/<agentId>`.
- [ ] Remove the mock's sample replies, "Local mock" label and sample data.

## What the mock does not show yet

The current page does these, and the replacement must keep them. The mock session
started designing them on 2026-11-06. Reread the mock when it finishes, and tick
each item that now has a place.

- [ ] Log in, log out and session expiry.
- [ ] Connection state and the last received state while reconnecting.
- [ ] Permission requests. The mock shows only decisions.
- [ ] Stopping and resuming an agent, with the warning when a session cannot reload.
- [ ] Failed-start reasons and crashed, interrupted or paused agents.
- [ ] Large thread items that load on request.
- [ ] Delivery history inside a thread.
- [ ] The Alerts page and the links from alerts into threads.
- [ ] The Settings page, including the alert carrier and its token.
- [ ] Which harness, account and model an agent uses, beyond the tool name.

## Tests and proof

- [ ] Rewrite the 11 browser test files for the new page.
- [ ] Update `live-check-web.ts`, which finds elements by their current names.
- [ ] Port `design/checks.mjs` to the browser suite at 390, 768, 1440 and 2560 pixels
      in both color modes.
- [ ] Add a real-agent proof: Add Project, talk to the lead, the lead writes a
      sprint and a task, and a decision is answered from the board.
- [ ] Run `pnpm check`, `pnpm live-check:web` and `pnpm live-check` before merging,
      because stored events change.

## Attack list

These are on `.scratch/security/attack-todo.md` as what must hold.

- [ ] Git reads and the changes view.
- [ ] Who may write projects, sprints and tasks.
- [ ] Agent-written fields on the page.
- [ ] The client connection in client mode.

## Client mode, after the website

The owner asked for this on 2026-11-06. One main Sheprd holds the event log, the
board and the website. Other machines run Sheprd in client mode, run agents, and
take their commands from the main one, so a project's load spreads across machines.

- [ ] Decide how a client machine proves who it is. The login rule is one user, one
      password and no pairing, so this needs the owner's word.
- [ ] Have the client connect out to the main Sheprd, over HTTPS or loopback only.
- [ ] Run agents through the same runner commands the engine uses locally, with the
      main Sheprd's event log as the only record.
- [ ] Let an agent's Sheprd tools reach the main Sheprd through its client.
- [ ] Rework who-is-calling checks, because the main Sheprd cannot inspect a process
      on another machine.
- [ ] Choose a machine per team or per agent, and show it on the page.
- [ ] Handle each machine's own harness logins, repositories and sandbox.
- [ ] Decide how work moves between machines. Git through the shared remote is the
      obvious route.
- [ ] Handle a client machine going away while its agents are working.
