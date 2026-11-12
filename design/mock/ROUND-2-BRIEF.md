# Brief for the second round of the LGcode mock

This brief hands the mock in `design/mock/` to the agent that builds its second round.
The owner asked for the brief on 2026-11-10, after a 40 minute walkthrough of the first
round. You do not need any earlier conversation. Everything you need is in this file and
in the files it names.

## What you are asked to do

Change the mock so that it matches the owner's walkthrough feedback. The feedback is in
[feedback/2026-11-10-owner-walkthrough.md](feedback/2026-11-10-owner-walkthrough.md).
That file is the source of truth. This brief turns it into work, and it records the
choices the feedback left open.

The owner's instruction is to prefer a redesign over a patch. Where a screen is too dense
or repeats itself, rebuild the screen. Do not hide the fault with smaller type.

The mock stays a mock. It does not connect to the engine and it never calls an agent.
Every screen must still work on the data held in the browser.

## Read these first, in this order

1. [feedback/2026-11-10-owner-walkthrough.md](feedback/2026-11-10-owner-walkthrough.md),
   the owner's feedback.
2. [README.md](README.md), which says how to open the mock and how its files are arranged.
3. The sections "Layout and density", "Agent names" and "Libraries" at the end of
   [../DESIGN.md](../DESIGN.md).
4. `css/tokens.css`, `css/base.css`, `js/lib.js`, `js/data.js`, `js/actions.js` and
   `js/ui.js`. These are the shared foundation.
5. The screen you are about to change, in `js/screens/`, with its stylesheet in `css/`.

Load the user interface skills before you design. The route is the `ui-router` skill. It
sends a build to the `screen-build` skill, which reads `design/DESIGN.md` first.

## How to open and check the mock

Serve the `design/` folder and open `/mock/`.

```
cd design
python3 -m http.server 4178 --bind 127.0.0.1
```

The owner looks at the mock on port 9000 of the same machine. Ask before you stop or move
that server.

Check every screen you change at 1440 by 900 pixels, at 1720 pixels wide, and at 390 by
844 pixels. Check it in the light theme and the dark theme. Look at the screenshot
yourself before you call a screen finished. A page error in the browser console is a
defect.

## Rules that already hold and must keep holding

- An agent is named by its role, such as Project lead and Builder 1. No agent has an
  invented personal name.
- The page's own text never says that it is a mock or a sample.
- Every colour comes from `css/tokens.css`. No other file holds a literal colour.
- The mock has no build step and loads nothing from the network.
- A list of like things is a table or a list of rows. A card is for an item that moves on
  its own. A card never sits inside another card.
- Each screen has at most one filled primary button.
- Enter sends a message.

## The five principles from the owner

These come from the top of the feedback file. Test every screen against them.

1. One surface does one job. Needs attention is for triage. The sidebar and the projects
   list are for navigation. The same list does not appear in three places.
2. Less density and less repetition. Remove text that repeats the row's title, explains
   the system, or sounds like speech on a button.
3. An empty state keeps the structure. An empty board shows its lanes. An empty list
   shows its columns. No screen swaps to a different blank page.
4. The owner talks to the project lead. Builders and test runners are there to be
   watched, not operated.
5. A sentence is not a title. A status such as "Phase 4 of 8" is shown as secondary
   status. A button is a short verb or noun.

## The work, screen by screen

Each part names the file, the change, and what "done" means. The section numbers in
brackets point at the feedback file.

### Home becomes one triage table (feedback section 1)

Files: `js/screens/home.js`, `css/screens.css`.

- Replace the large lead sentence and the request rows with one sortable, filterable
  table. The columns are Title, Type, Repository, Project, Stage, Agent and Waiting.
- Clicking a column heading sorts by it. Filters sit above the table for Type,
  Repository and Project. A small count beside each filter replaces the large numbers.
- Remove the projects section from this page.
- Remove the separate Questions and Approvals tabs. The Type filter does their job. Keep
  the old addresses working by turning them into the same page with the filter set.
- A row still expands in place. Inside the expanded row:
  - Label the long text "Description".
  - Show only the actions that do something different. A failed start shows "Sign in on
    Buildbox" and "Open thread". Show "Resume" only when resuming is a real next step
    after the fault is fixed elsewhere.
  - Remove the line that repeats the agent and team from the row.
- Answered requests stay reachable through a "Show answered" filter, not a second list.
- The phone notification offer becomes one compact line with "Set up" and "Not now". It
  must not be a wide strip. Place it at the top of the page, above the filters.

Done means: the page has one table and no second list, a sort and each filter work, and
an expanded failed start shows a description and two or three distinct actions.

### All projects is its own destination (feedback section 2)

Files: `js/screens/home.js`, `js/app.js`.

- Keep the projects table as its own page at `/projects`.
- Reach it from the sidebar, beside the "Repositories" heading.

### Search ranks repositories, then projects, then agents (feedback section 3)

File: `js/dialogs.js`.

- Remove the line "Projects and what needs you".
- Show one ranked list. Repositories come first, then projects, then agents.
- Make a loose question work, such as "which project was working on the git worktree".
  The real product will use a small embedding model. The mock imitates it by scoring the
  words of the query against each project's goal, description and agent names. Keep the
  scoring in one small function, so the website team can see what is being imitated.

Done means: "lgcode" puts the repository first, "lgcode lead" puts a project lead first,
and the loose question above finds the right project.

### The sidebar is headed "Repositories" (feedback section 4)

Files: `js/app.js`, `js/screens/project.js`.

- Rename the heading from "Projects" to "Repositories".
- A single click on a row opens it. A single click on the arrow folds or unfolds it. A
  double click on the row folds or unfolds it too.
- On the repository page, show a running product description under the remote and the
  base branch. The project lead keeps this description current. Replace the label "on"
  with "Base branch".

### A new project starts from a goal (feedback section 5)

Files: `js/dialogs.js`, `js/actions.js`.

- Replace the name field with one "Goal" field. The goal is the first message to the
  project lead. The placeholder is an example, such as "Make a mock for the LGcode phone
  app".
- The project appears in the sidebar as "Naming…". The simulated lead then names it in
  its first turn, and the sidebar shows the new name.
- Show the subscriptions as a small table. The columns are Harness, Subscription,
  Machine and Models. The "Models" column lists the models that subscription offers.
- The first run page at `/setup` uses the same goal field.

### The project board follows GitHub Projects (feedback section 6)

Files: `js/screens/project.js`, `css/screens.css`, `js/app.js`, `js/data.js`.

- A project is one goal with one or more epics under it. Add epics to the data. Each
  sprint belongs to one epic.
- Offer three views of the same items: Board, Table and Roadmap. The Board groups by
  status. The Table has columns for Epic, Priority, Team, Stage and Status, and it sorts
  and filters. The Roadmap shows epics and sprints along a time line.
- Add a Backlog lane and a Priority field.
- Replace the stage strip at the top with a compact status line that links to Workflow.
  The stage of each item is a field on the item.
- Give each lane a fixed width, and let the board scroll sideways. Opening the project
  lead panel must not change the width of a card or the gaps between cards.
- Add a focus control that hides the sidebar, the lead panel and the tab row, so the
  board fills the window. The Escape key leaves focus.
- A project with no sprints shows the same lanes with no cards. Remove the "no sprint
  yet" page. Apply the same rule to review rounds, test runs and mocks.

Done means: opening and closing the lead panel leaves every card the same size, the
"Phone companion" project shows empty lanes, and the three views show the same items.

### The repository Design page is a near full screen canvas (feedback section 7)

Files: `js/screens/mocks.js`, `css/mocks.css`.

- Make the canvas fill the page under one thin bar.
- The bar holds two menus. The first picks a category. The second picks an item inside
  that category.
- Show the whole design file: its screens, its components and its palette.
- The owner does not want engineering to invent the categories alone. The owner calls
  the right author "Apple Hat". The owner explained on 2026-11-10 that this is an agent
  launched with instructions to think like a senior user interface and user experience
  lead from Apple.
- Start one such agent before you build this page. In the mock and in every document,
  call it the Design lead, because agents are named by role. Give it the design file
  under `design/`, the tokens, and the list of screens in this mock. Ask it for a
  standard that says how a design file is stored and how its content maps into a first
  menu and a second menu.
- Build the two menus from its answer. Save its answer as
  `design/mock/feedback/2026-11-10-design-categories.md`.
- If you cannot start that agent, use the starting list below and say so in your
  hand-over.
  - Screens, grouped by flow, such as Onboarding, Home and Project.
  - Components, grouped by kind, such as Buttons, Forms and Navigation.
  - Palette, with Colour, Type and Spacing.
- The owner has not approved any set of categories. Report the set you used.

### Workflow separates status from titles (feedback section 8)

Files: `js/screens/workflow.js`, `css/workflow.css`.

- Show "Phase 4 of 8" and the sprint count as small secondary status. It is not a
  heading.
- Keep the phase track.
- Break each phase's detail into short labelled parts. No part is a wall of text.
- Group the agents as Waiting, Working and Idle, with these rules:
  - Hide Waiting when it is empty.
  - When the project has any agent, show Working and Idle. Hide one of them only when it
    is empty and another group is showing.
  - When the project has no agent, show one "Agents" group that says "No agents running".

### Review rounds get balanced weight (feedback section 9)

File: `css/workflow.css`, with `js/screens/workflow.js`.

- The owner liked this view. Rebalance the large cards against the thin colour bar on
  their left edge. Either make the mark strong enough to read or reduce the card.
- Remove text that the table already says.

### Test runs show status and logs only (feedback section 10)

File: `js/screens/workflow.js`.

- Remove the explaining subtitles, including the sentences about passing reports and
  `pnpm check`.
- Model the page on GitHub Actions. A run list is on the left. The selected run shows
  its jobs, their steps, and the log of the selected step.
- "Start full run" runs whatever the project has configured. The page does not name the
  command.
- The owner does not operate a test runner or a builder from this page.

### End result drops the sentence title (feedback section 11)

File: `js/screens/workflow.js`.

- Remove or demote any statement shown as a title or subtitle.
- Rename "Ask the project lead to change it" to "Request change".
- Read every button in the mock for the same fault. A button is a short verb or noun.

### Mocks is rebuilt on the Workflow pattern (feedback section 12)

Files: `js/screens/mocks.js`, `css/mocks.css`.

- Use the same secondary tab row, spacing and page padding as Workflow.
- Show the real structure when there are no screens yet.
- The large preview of a screen uses the same canvas frame as the repository Design
  page.

### Chat puts the owner on the right (feedback section 13)

Files: `js/ui.js`, `css/base.css`, `js/screens/chat.js`, `js/app.js`.

- The owner's messages sit on the right. The agent's messages sit on the left.
- A question or an approval inside a thread is a clear card with a border and a
  background. It is never bare text that happens to be a link.
- The card offers three things: answer in place, accept the recommendation, and "Open
  thread".
- "Open thread" opens the asking agent's thread in the side panel, scrolled to the
  question. The panel's header then names that agent and its team, and it has a control
  that returns to the project lead. The panel closes that thread when the question is
  answered.
- When the main view shows another agent's thread, the top bar and the tab row name that
  agent. The page must never look like the project lead's while it shows another agent.
- This brief chose the in-place card as the default and the side panel as the second
  step. The feedback offered them as alternatives. Tell the owner in your hand-over.

### Only the project lead has a message box (principle 4)

Files: `js/screens/chat.js`, `js/ui.js`.

- The project lead's thread always has the message box.
- Any other agent's thread is read-only. It gains a reply box only while that agent has
  an open question for the owner.
- This is this brief's reading of "you talk to the project lead". Tell the owner in your
  hand-over.

### Messages, Agents and Terminal change little (feedback section 14)

File: `js/screens/messages.js`, `css/messages.css`.

- In the direct message list, replace the two overlapping avatars with one avatar, a
  short dash, and the second avatar.
- Leave Agents and Terminal as they are.

### Git writes the commit message (feedback section 15)

Files: `js/screens/git.js`, `js/dialogs.js`, `js/screens/service.js`, `js/screens/auth.js`.

- Add a "Generate" control to the commit box. It writes a short conventional commit
  message from the staged diff. The message carries no attribution line.
- The merge review dialog gains a generated pull request title and description, made
  from the list of commits. The title respects the length limit and shows a count.
- Service settings gains a "Git messages" part where the owner picks the model for both.
  The first run asks the same question once.

### Settings gains models, effort and an assignment table (feedback section 16)

File: `js/screens/service.js`.

- The lead subscription row also picks a model. It picks an effort when the model
  supports effort.
- Replace the harness multi-select for teams with an assignment table. Each row is a
  kind of work, such as Plan, Build, Review and Test. The columns are Harness, Model and
  Effort.
- The project lead proposes the table, and the owner approves or changes it. One control
  applies a single model to every row.
- The table defaults to the harnesses the owner has signed in to.

## The order to work in

The feedback file ends with a priority table. Follow it, with one correction. Its second
row says "rename Repositories to Projects". Section 4 of the same file says the opposite,
and section 4 is right. The heading becomes "Repositories".

1. Home, the sidebar, empty structure everywhere, and Chat.
2. New project, the board, and the text cleanup in Workflow, Test runs and End result.
3. Search, the repository Design page, Git messages, and the settings table.
4. The direct message avatars and the Mocks rebuild.

Commit after each numbered group, on the branch `area/mock-rebuild`.

## What you must not do

- Do not add explaining sentences to a title or a button.
- Do not make a builder or a test runner something the owner operates.
- Do not replace a screen's structure with a blank page when it has no data.
- Do not decide the design file's categories yourself. The Design lead agent proposes
  them, and the owner approves them.
- Do not edit `design/workbench.html`, `design/data/` or anything under `packages/`.
- Do not merge into `master`. The owner approves that through a pull request.
- Do not add a `Co-Authored-By` line to a commit message.

## What to hand back

Write a short hand-over in `design/mock/feedback/2026-11-10-round-2-result.md`. For each
part above, say whether it is done, and how you checked it. List every choice you made
that the owner has not ruled on. Start that list with the three this brief already made:
the in-place question card, the read-only threads, and the design categories that the
Design lead agent proposed.
Update `design/mock/README.md` and the three sections at the end of `design/DESIGN.md`
where your work changes them. Record any problem you find and do not fix in
`docs/issues.md`.
