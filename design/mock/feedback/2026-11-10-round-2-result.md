# The result of the second round of the LGTM Studio mock

This file answers `design/mock/ROUND-2-BRIEF.md`. The work is on the branch
`area/mock-rebuild`, in five commits. Nothing is merged into `master`.

| Commit | What it holds |
|---|---|
| `3726dad` | Group 1: Home, the sidebar, empty structure, and Chat. |
| `a6bdb62` | Group 2: New project, the board, and the Workflow, Test runs and End result cleanup. |
| `5ed608a` | Group 3: Search, the repository Design page, Git messages, and the settings table. |
| `24f08b8` | Group 4: the direct message avatars and the Mocks rebuild. |
| `d57bca7` | A fix to the Mocks tables at phone width. |

The documents commit that holds this file follows them.

## How the work was checked

Every changed screen was opened in a headless Chromium browser at 1440 by 900 pixels, at
1720 by 1000 pixels, and at 390 by 844 pixels, in the light and the dark colour mode. That
is 21 addresses in 6 sizes and modes, or 126 pages. No page printed a console error or a
failed request. No page scrolled sideways. The screenshots were read by eye.

The interactions were driven by small browser scripts. They created a project from a goal,
ran the search queries, pressed "Generate" in Git and in the merge dialog, expanded rows,
and switched the board's views.

Three checks from the screen-build skill were not run. The ui-test space checks were not
run, so the density gate was judged by eye from the screenshots. No blind reviewer saw the
screens. No worst-case data fixture was built.

## Each part of the brief

### Home becomes one triage table: done

Home is one table with the columns Title, Type, Repository, Project, Stage, Agent and
Waiting. Each heading sorts. The Type, Repository and Project filters sit above the table,
with a small count beside each type. The projects section is gone. The addresses
`/home/questions` and `/home/approvals` open the same page with the Type filter set. An
expanded row labels its long text "Description". A failed start shows "Sign in on
Buildbox" and "Open thread". "Show answered" adds the answered requests to the same table.
The phone notification offer is one line with "Set up" and "Not now". It sits on the
title line, above the filters.

Checked by screenshots of the sorted, filtered and expanded table at all three widths.

### All projects is its own destination: done

The projects table lives at `/projects`. A button beside the "Repositories" heading opens
it. Checked by screenshot.

### Search ranks repositories, then projects, then agents: done

The line "Projects and what needs you" is gone. One ranked list is shown. The scoring is
the function `searchScore(query, item)` in `js/dialogs.js`. It drops stop words, stems the
remaining words, and scores them against each item's name, goal, description and agent
names. Ties order Repository, Project, Agent, then Page.

Checked with a script. "lgtm" puts the repository first. "lgtm lead" puts "Project
lead · Agent console" first. "which project was working on the git worktree" puts "Agent
console" first.

### The sidebar is headed "Repositories": done

The heading reads "Repositories". One click on a row opens it. One click on the arrow
folds it. A double click on a row folds it too. The repository page shows the product
description under the remote, with the time and the project lead that last updated it.
The label "on" became "Base branch".

Checked by screenshot and by clicking in the browser.

### A new project starts from a goal: done

The New project dialog has one "Goal" field, with the placeholder "Make a mock for the
LGTM Studio phone app". The project appears in the sidebar as "Naming…". The simulated lead
then names it from the goal. The subscriptions are a small table with Harness,
Subscription, Machine and Models. The first run at `/setup` uses the same Goal field, and
it also asks for the model that writes commit and pull request messages.

Checked with a script that created a project and read the sidebar before and after it was
named.

### The project board follows GitHub Projects: done

The data has epics, and each sprint belongs to one. The board has Board, Table and Roadmap
views at `/p/console/board`, `/p/console/board/table` and `/p/console/board/roadmap`. The
Board view has a Backlog lane and fixed-width lanes that scroll sideways. Each item has a
Priority. A status line, "Build · Phase 4 of 8", links to Workflow and replaces the stage
strip. A focus button hides the sidebar, the lead panel, the tab row and the top bar, and
the Escape key leaves focus. "Phone companion" shows its lanes with no cards.

Checked by screenshot with the lead panel open and closed. The card widths did not change.

### The repository Design page is a near full screen canvas: done, with a different file

The canvas fills the page under one thin bar. The bar holds the Projects and Design tabs,
the category menu, the item menu with counts, the file's name, the zoom controls, Fit, and
"Open in OpenPencil". A repository with no design file shows the same bar and canvas, with
"Create design file".

A Design lead agent was started before the page was built. It was given the design file
`design/lgtm.fig`, the tokens, and this mock's screens. Its answer is
`design/mock/feedback/2026-11-10-design-categories.md`. The two menus are built from it.
The categories used are Screens, Components and Palette. Screens holds one item per flow:
Sign in and setup, Home, Project, Workflow, Mocks, Conversations, Code, Repository and
Service. Components holds Overview, Actions, Inputs, Navigation, Overlays, Status, Data,
Agents and Code. Palette holds Colour, Type, Space and density, Shape, Motion and Icons. The owner has not
approved these.

The brief named `js/screens/mocks.js` for this page. The page is in a new file,
`js/screens/design.js`, with `css/design.css`, because the Mocks tab reuses its canvas.

Checked by screenshots of every category at all three widths.

### Workflow separates status from titles: done

"Phase 4 of 8 · Build" and the sprint counts are a small status line, not a heading. The
phase track stays. Each phase's detail is five labelled parts: What happens, Run by, Your
part, Ends, and Produced. The agents follow the Waiting, Working and Idle rules, and a
project with no agents shows one "Agents" group that says "No agents running".

Checked by screenshots of a project in each phase.

### Review rounds get balanced weight: done

The round stack is full width and smaller. The repeated "next step" text and the counts
summary are gone. The findings table always shows, with an empty row when a round has no
findings. Checked by screenshot.

### Test runs show status and logs only: done

The page follows GitHub Actions. The run list is on the left. The selected run shows its
jobs, the steps of the selected job, and the log of the selected step. "Start full run"
names no command. "Run again" and "Open builder" are gone. Checked by screenshot.

### End result drops the sentence title: done

The page has a status line with a badge and a progress bar. The button reads "Request
change". "Always allow this command" became "Always allow" everywhere. The buttons in the
whole mock were read for the same fault. Checked by screenshot and by a text search of the
screens.

### Mocks is rebuilt on the Workflow pattern: done

The Mocks tab uses the Workflow tab row, spacing and padding. Its tabs are Screens,
Changes, Data and Components, with counts. A status line holds the approved count, the
changes not seen, "Request changes", and the one primary button, "Approve mocks". Each tab
is a table that keeps its header and an empty row when it has no data. One screen opens on
the Design page's canvas, with zoom, Fit, and the phone and desktop switch.

Checked by screenshots of each tab, of a project with no screens, and of one screen at all
three widths.

### Chat puts the owner on the right: done

The owner's messages sit on the right in a filled bubble. The agent's messages sit on the
left. A question or an approval is a card with a border and a background. It offers an
answer in place, "Accept recommendation", and "Open thread". "Open thread" opens the asking
agent's thread in the side panel. The panel's header names that agent and its team, and it
has a "Back to the project lead" button. When the main view shows another agent, the top
bar and the tab row name that agent.

Checked by clicking "Open thread" in the browser and reading the panel.

### Only the project lead has a message box: done

The project lead's thread always has the message box. Any other agent's thread is
read-only. It gains a reply box only while that agent has an open question. Checked by
screenshots of the project lead's thread and of other agents' threads.

### Messages, Agents and Terminal change little: done

A direct message shows one avatar, a short dash, and the second avatar. Agents and
Terminal are unchanged. Checked by screenshot.

### Git writes the commit message: done

The commit box has a "Generate" button. It writes a conventional commit message from the
staged files, with no attribution line. The merge review dialog has a pull request title
with a count against a limit of 72 characters, a "Generate" button, and a description.
Service settings has a "Git messages" section with the model, where it runs, and an
example. The first run asks once.

Checked with a script that pressed both "Generate" buttons and read the results.

### Settings gains models, effort and an assignment table: done

The lead row picks a subscription, a model and an effort. A model with no effort setting,
such as Haiku 5.5, shows "No effort setting". The "Assignment" section is a table of Plan,
Build, Review and Test by Harness, Model and Effort. It reads "Proposed by the project
lead", with an "Approve" button. An "Every row" menu with "Apply" sets one model on every
row. The defaults use only the harnesses the owner has signed in to.

Checked by screenshot and by changing the rows in the browser.

## Choices the owner has not ruled on

The first three were made by the brief.

1. A question in a thread is answered in a card in place. The side panel is the second
   step, reached by "Open thread".
2. Only the project lead's thread has a message box. Every other agent's thread is
   read-only, unless that agent has an open question.
3. The Design page's categories come from the Design lead agent's proposal. The owner has
   not approved them.

The rest were made while building.

4. On the repository page, "on" became "Folders". "Base branch" stays as its own row.
5. Home sorts by how long a request has waited, the longest first.
6. Buttons inside a card are outlined, not filled. The screen's one filled button stays
   outside the cards.
7. A new project's name is made from its goal by dropping small words and keeping four.
   "Add worktree cleanup to the git panel" becomes "Worktree cleanup git panel".
8. The priority words are Urgent, High, Medium and Low.
9. Focus on the board also hides the top bar.
10. Search no longer lists teams.
11. The Design page's screen frames are drawn from the mock's own addresses, marked "Only
    in code". Frames were added for screens the design file lacks, such as the board's
    Table and Roadmap views and the empty states.
12. The work assignment defaults come from the harnesses the owner has signed in to.
13. Haiku 5.5 is the default model for Git messages.
14. The search scoring weights a name match three times a text match, and boosts the kind
    the query names.
15. The Mocks tab uses tables, not cards, for screens, changes, data and components.
16. The jobs and steps in Test runs are made up from each run, because the data has none.
17. The Test runs log shows the project's configured command. The page's own text does not
    name it.
18. The first run keeps its short opening lines on steps 1 and 2.
19. Each row of the workflow's settings keeps its one explaining sentence under the
    setting's name.

## Problems found and not fixed

These are recorded in `docs/issues.md`.

- Issue 614: the design file lags the mock. Its Agent row shows the name "Rowan". It has
  15 colours to the mock's 38, and it has no type, space, density, shape or motion
  variables.
- Issue 615: the Git tab replaces its structure with "No worktrees yet" when a project has
  no worktree.
- Issue 616: the Design page loads a full copy of the mock for every screen frame, which
  is slow on the larger flows.

## Documents updated

- `design/mock/README.md` lists the new addresses and `js/screens/design.js`.
- `design/DESIGN.md` updates "Layout and density", "Agent names" and "Libraries".
