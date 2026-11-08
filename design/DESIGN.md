# LGcode’s approved palette pair

The owner selected Field for light mode and Dusk for dark mode on
2026-11-05. The two palettes give the same app a brighter daytime surface
and a muted dark surface. Harbor is no longer an active option.

## What is approved

`tokens.css` is the color contract for future LGcode app mockups.
The workbench embeds the same token blocks so it can be opened as one file.
Keep those blocks identical when the tokens change.

The layout, typography, sample roster, and product flows remain exploratory.
The owner's palette selection does not approve those other choices.

Cursor is the primary design reference. T3 Code is a secondary usability
reference, with the owner's discoverability concerns treated as a constraint.
Repositories contain projects. Each project has exactly one lead, a sprint
board, and teams. Selecting a project opens its board with a lead chat
panel on the right. The repository has a page listing its projects. Branch and workspace inspection
has its own context menu and cannot rebind the project repository.

The chat uses one compact header, a restrained user turn, plain agent
replies, grouped tool activity, and a growing composer. Sprint cards are
used for the Kanban board requested by the owner. Sprint and task details
open as pages. The lead panel contains the real conversation and its
composer. It does not repeat project summary cards. Field and Dusk remain unchanged. The owner approved the critique-driven refinement pass on 2026-11-06.

## The board and its lead conversation

Selecting a project opens the board. There is no separate Board row in the
navigation tree. At desktop widths, a right sidebar shows Sage's existing
conversation and composer beside the sprints. Other projects show their
own single lead. Drafts, messages, pending replies, and reading positions
stay with that conversation when it is opened full size.

The lead button at the right end of the tab row opens and closes the panel.
On a desktop it is the only control that does, so the panel has no close
button and no expand button; the Chat tab opens the full conversation. At
widths of 1100 pixels or less the panel starts closed, and the lead button
opens it as a drawer over the board. The drawer keeps its close button,
because it covers the lead button. The drawer contains keyboard focus,
Escape closes it, and focus returns to the lead button. The board retains
its own scroll position while the conversation scrolls.

## Preserve the existing page’s operational controls

The redesign retains authentication states, connection status, permission
requests, agent stop/resume, safe failed-start reasons, explicit large-item
loading, tool calls, delivery history, Phone notifications, and Settings. Permission
controls show the actual action input before answer buttons. Hidden input
and unconfirmed answers have explicit states. Stop cancels permissions.
Logout and expiry wipe entered secrets. Reconnecting preserves reading
context but disables mutations. These remain sample flows in the mock.

Phone notifications, Machines, Subscriptions, and Service settings belong to
the service, so they sit in global navigation, as a row of icons at the foot of
the sidebar. The project workspace has Board, Chat, Terminal, Git, and Project
settings tabs, and a team adds Tasks. Git combines the repository worktree hierarchy, staged and unstaged files,
commit messages, synchronization, direct file diffs, and integration controls.
History uses that same diff pane. Workspace Settings shows the assigned
repository, branch, checkout folder, and machine, plus a per-project shell
preference. Service settings remain in global navigation. Terminal replaces the main chat. Machines describes one
master and its paired workers. Project placement and branch inspection are
separate. Subscriptions uses independently named accounts; one harness can
have several accounts on a machine. Additional Codex sign-ins stay private.

Terminal execution, Git mutations, remote pairing, project movement, and provider sign-in
are not wired to live services. This boundary is documented here rather
than repeated in product copy, at the owner’s request on 2026-11-06.
FEATURE-PARITY.md records the integration requirements and source evidence.

## Project branch placement

The branch shows once, in the top bar, in the control that says Inspecting.
The sidebar, the board header, and the composer do not repeat it, decided by
the designer's critique of 2026-11-06 and applied on 2026-11-08. The control
says Inspecting because it changes the code you look at, not where agents work.
A long branch name is cut at its start, so the end, which differs between
branches, stays visible. Hover text gives the full name. Inspecting another
worktree does not move the work: the list marks the assigned worktree as
Assigned, and the control's hover text names it.
A new project still starts with its lead to shape the first plan.
Start work tree is checked beneath its name by default. A safe version of
the project name becomes the branch and worktree folder. Existing names get
a numeric suffix. Unchecking uses the repository’s main checkout. The dialog
previews the exact branch and folder before creating the sample project.

## How the modes behave

Field is the default token block. Dusk overrides it under
`:root[data-theme="dark"]`. Both modes share spacing, type roles, shape,
and motion values. A first visit follows the device's color mode.
The choice lives in Service settings, under Appearance, as Light, Dark, and
Match system. The labels do not name the Field and Dusk palettes. A manual
light or dark choice takes precedence and is remembered when browser storage
is available. Match system forgets that choice, and the page follows the
device again.

The prototype migrates a previously selected Field or Dusk candidate to
the matching mode. A previous Harbor selection falls back to the device
setting.

## What the colors mean

| Role | Field light mode | Dusk dark mode |
|---|---|---|
| Workspace | Green-tinted white. | Muted plum. |
| Navigation | Soft green. | Deeper plum. |
| Surface and elevation | White and pale green. | Progressively lighter plum. |
| Primary action | Deep green with white text. | Peach with dark plum text. |
| Body and secondary text | Dark green and readable grey-green. | Pale text and readable muted pink-grey. |
| Progress | Deep green. | Soft green. |
| Needs owner attention | Dark amber. | Pale amber. |
| Error | Dark red. | Soft red-pink. |

## Type and reading

The workbench uses Inter for interface text and JetBrains Mono for code,
paths, and branch names. Both are served from the repository, as the
"Fonts" section below says. Keep long replies within roughly 68 characters
per line, with enough line spacing to follow paragraphs.

The current proposal uses a shared frame for the compact conversation
header, chat, and composer. That frame stays centered within the available workspace on wide
screens. Message text has a separate 70-character reading measure. Boards
and plan details use a wider frame. Titles,
authors, replies, and metadata have distinct sizes. The composer's label and
placeholder name its recipient. While a draft is typed, the line under the tabs
or the lead panel's header still names the agent.

## Interaction rules

- Use semantic tokens for every interface color.
- Keep the same layout and state meanings across both modes.
- Pair status colors with readable labels.
- Preserve visible keyboard focus and reduced-motion support.
- Require at least 4.5:1 contrast for normal text and action labels.
- Show the owner why a decision needs their attention and what each action does.
- Use normal product copy in the workbench. Keep prototype limitations in
  the design documentation rather than repeated labels or disclaimers.
- Separate chevron disclosure from repository, project, and team selection.
- Preserve each conversation's draft and reading position while navigating.
- Restore the last tab when returning to a team.
- Surface a team request in the project lead conversation and sidebar.
- Link every request entry to the requesting agent's exact question.
- Clear attention only when the request is answered.
- Keep a task's assigned workspace separate from the viewed code context.
- Keep sprint completion evidence separate from release status.
- Connect assignments to their agent, review handoff, and changed files.
- Keep mobile navigation focus contained while open and return focus to
  the menu or newly selected view when it closes.

## Visual constraints

Keep the layered, hue-tinted dark surfaces. Do not replace Dusk with flat
black and a bright accent. Do not introduce gradient text, decorative
metrics, or a marketing hero into the working app. Use actual app flows
to judge the palette.

The live visual reference is `workbench.html`. Captures and browser
verification results are in `previews/`. No separate brand brief exists
in this design directory; this contract records the owner's choice and
the UI skill's craft rules applied during the workshop.

## Scope and workspace controls

One tab row serves the selected project, team, or agent. Team Tasks remains
available in team scope, as the last tab. Git selects the team worktree when
opened from a team. The top bar names the selected repository, project, team,
and branch. Selecting a
worktree in Git or Terminal follows its owning project and machine. Opening
a project lead restores that project's assigned worktree.

The left navigation and desktop lead panel have drag handles. Arrow keys
resize a focused handle. Home or a double click restores its default size.
The browser remembers these widths. Four board columns fit beside the lead
at desktop width. A compact status strip lets phone users jump to a column.

Git has independent state for each worktree. Staging and unstaging change the
commit selection. A commit records the selected files and message. Fetch,
Pull, and Push expose incoming and outgoing counts. Conflicts require an
explicit resolution before staging. A clean team branch integrates into its
project branch. A clean project branch requires an explicit review before
main. Uncommitted destination changes block integration. All of these are
in-memory interactions, with no repository mutation.

Agent progress and Stop sit above the composer, and Resume replaces its input.
Subscription choices are filtered by harness and machine. Files and tasks can be attached as
context, and sent turns retain those references. Grouped activity links to
its changed files. The bell lists questions, approvals, and
failed starts in one order. Only projects needing you filters projects. Quick switch searches
projects, teams, and agents by name, and opens with Command or Control + K.
Terminal sessions preserve separate input and history in each worktree.

## Home gathers work across projects

Home is the initial page and a permanent navigation destination. It offers
Needs attention, All projects, Questions, and Approvals. Needs attention
gathers unresolved questions, permissions, failed starts, and project merge
reviews. Questions and Approvals keep answered history under a collapsed
Answered section. Search combines with repository, project, agent, and machine
filters behind one Filter button, and All projects adds a status filter. Open
entries sort first, in the bell's order. Filters stay selected on return, and
Clear filters appears while one is set.

A single-line request row expands its details directly underneath. All rows
start collapsed. Selecting the same row closes it. Only one request expands
at a time. The owner can answer questions and
permissions without leaving Home. Merge approval uses the existing explicit
review dialog and records its result in place. Source links open the precise
conversation or project board. Discussion preserves any existing draft.
Request context names the requesting team's worktree where applicable.
Keyboard arrows, Home, and End operate the tabs. Filter changes retain focus.

The row retains keyboard focus when toggled. Its chevron and expanded state
expose the disclosure. The footer of the expanded content names the machine and
the worktree. Narrow screens keep the title and status on the first line and
the kind on the second. On wide
monitors Home stays in a centered frame capped at 1380 pixels.
If an answer removes its request from the queue, focus moves to the next
remaining row. Finishing a filtered queue focuses the empty result. Answered
requests that remain in history keep their inline detail available.

## Sidebar groups controls by purpose

The first section has Home and a bordered Find project or agent search
control. A divider separates Projects, New project, and the explicitly named
Only projects needing you filter from global navigation. Repository names
within that tree open their project lists. The former separate Repositories
destination is removed. Another divider separates service pages from the
project tree, and thin rules separate repository groups. The service pages
are a row of icons above the account. Search remains available with Command or
Control + K.

## Density and machine-aware creation

Use tables for comparable fleet records and compact lists for requests.
Machine rows show identity, status, role, agent slots, project count, and a
Start project action. At 1440 pixels the observed rows are 43 pixels tall.
Project placement is a second compact table. Keep comfortable paragraph
measure in conversations; compact the framing instead of shrinking body text.
The Kanban board retains cards because their grouping communicates sprint state.

Add Project asks Run on before the project name. Only an online machine
with the repository can start work. The preview resolves that host's branch,
checkout type, and folder. Name collisions are checked per repository and
machine. Opting out of a worktree uses that machine's main checkout.

Starting from a machine keeps that host selected. If no repository exists
there, Start remains disabled with a concrete reason. A future placement
change never relabels the current running workspace or implies migration.
Actual repository registration and project transport remain service work.

The latest critique and remaining design judgments are recorded in
`UI-CRITIQUE-2026-11-06-HOME.md`.

## Rules added by the review of 2026-11-06

Claude took over this mock from Codex on 2026-11-06. The first pass applied these rules.

### The tab row and page edges stay still

The tab row keeps the same left edge on every project view. The page title shares
that edge. Only the conversation body is centered, so its text keeps a readable
measure. Home is the exception, because it has no tabs and stays in a centered frame.

### Terminal and Git get the whole window

Terminal and Git hide the page title, because the top bar already names the project
and the tab names the tool. Both reach the bottom of the window at any height. A
terminal is a character grid, not a form. It has no input box, no Enter button, and
no placeholder, so the page can host programs such as vim and agent command lines.

Git puts the commit message above the file list, as VS Code does. Each of its three
columns scrolls on its own. Team worktrees show the end of their branch name, because
that is the part that differs. All files stacks every changed file with a sticky name.

### Names

| Name | Means |
|---|---|
| New project | The only name for starting a project, everywhere. Create project confirms it. |
| Git | The tab and the page. |
| Project settings | The per-project tab. Service settings is the global page. |
| Worktree | A checkout on disk. Workspace folder is the one folder that holds repositories. |
| Needs attention | Work waiting for the owner. The bell, Home, and the sidebar counts add up to the same number. |
| Question | A kind of attention: an agent asked something. The short form is Needs answer. |
| Approval | A kind of attention: an agent waits for permission to run a tool. The short form is Needs approval. |
| Merge | A kind of attention: a project branch waits for the owner's merge into main. It was called Approval until 2026-11-08. |
| Failed start | A kind of attention: an agent could not start. It wears the error color. |
| Uncommitted changes | Files changed in a worktree. "Working tree" is not used. |
| Thread | One agent's conversation. Chat stays the name of the tab. |
| Phone notifications | Notifications sent to the owner's phone. Its badge counts failed notifications only. It was named Alerts until 2026-11-08, which a first reader confused with the bell. |
| Inspecting | The top bar's control for the worktree whose code you look at. It was named Viewing. |

### One density rule for records

Comparable records are tables with rows of 46 pixels or less: Machines, Project
placement, Subscriptions, Phone notifications, All projects, the repository page, and
tasks. Requests are single-line rows
that say how long they have waited and what they block. At 900 pixels and narrower, a request
row has a second line that starts with its kind. Expanded rows do not repeat
their own title. No text is smaller than 11 pixels, and metadata is 12 pixels.

### Threads open at the latest message

A thread with no saved position opens at its true end, in the lead panel as well as
the Chat tab. Closing and reopening a panel keeps the position. A pending approval is
the last thing in the thread, so its buttons are visible when the thread opens. Away
from the end, a Latest button appears, and it says how many requests are below.

### Fonts

The interface uses Inter, and code uses JetBrains Mono, decided by the designer's
critique of 2026-11-06 and applied on 2026-11-08. They replace `system-ui`, which drew
a wide face on Linux and a different face on every operating system.

- **Both fonts are self-hosted.** Each is a variable font, cut to Google Fonts' Latin
  subset, in `third_party/inter/` and `third_party/jetbrains-mono/`. The mock reaches
  them through symbolic links in `design/fonts/`. There is no request to a font service.
- **The measured cost is 79,688 bytes.** Inter 4.001 is 48,256 bytes, and JetBrains Mono
  2.211 is 31,432 bytes. The critic estimated about 150 kilobytes.
- **Numbers are tabular.** The body turns on Inter's tabular figures, so counts and times
  line up in rows.
- **Code has no ligatures.** Code, diffs, and the terminal turn JetBrains Mono's
  ligatures off, so `=>` stays two characters.

## Rules added by the designer's critique of 2026-11-06

The owner chose the 15 Must fix findings, the two naming findings, and Enter to send.

- **Status colors:** green means running. A failed agent has the error color and a filled
  dot. A stopped agent has a hollow gray dot. Amber means that something waits for the owner.
- **A blind approval looks different.** It has no filled button, and its button says "Allow
  without seeing input".
- **Destructive changes ask first.** Stopping an agent with waiting requests or running work
  asks, and it names what is lost. Changing a machine's role asks, and it names who depends
  on that machine.
- **A merge to main shows its evidence.** The review shows tests, the review result with a
  link to its thread, commits, and every file's diff. Without evidence, the button says
  "Approve without evidence" and is not filled.
- **A split diff lines up.** Rows pair across the sides with blank filler rows, long lines
  wrap, and both sides scroll as one. It needs 900 pixels, the threshold Visual Studio Code
  uses, and below that it reads as unified and says so. At 1440 pixels it hides the worktree
  list to make room, and it says so.
- **A failure offers its fix in place.** Sign-in opens on the right machine, and a refused
  model offers the choice beside the message.
- **Provider sign-in runs the harness's own login** in a terminal session on the account's
  machine, as the design note says. The critic recommended a device code screen, and Claude
  kept the design note's approach, because each harness has its own flow.

## The first run, built from Ananke's onboarding rules

A service with no projects opens a first run after login. It has three pages, and each does one
job. The rules come from Ananke's onboarding specs and session reports, read on 2026-11-07.

- **Value comes before any ask.** The first page says what LGcode does and asks for nothing. Its
  three paired promises state only what the product does. The third says "You approve what users
  would notice", not "you approve every merge", because a fix sprint users would not notice merges
  by itself after a full test run.
- **The second page shows what was found and asks nothing.** It lists harnesses, sign-in state,
  and repositories in the workspace folder. It says that LGcode only looked. A harness that is
  installed but signed out offers its sign-in in place, through the usual sign-in dialog.
- **The third page is the first real ask, with its answers filled in.** It starts on the most
  recent repository, a name from that repository, and a new worktree. It hides the machine when
  there is one, and it hides the harness when one is signed in. It is the New project form moved
  into the page, not a second form.
- **Setup hands off to the lead.** Creating the project opens the lead's conversation with its
  greeting and the composer focused. There is no tour and no setup page for the conversation.
- **Look around first is a link, not a step.** It opens the sample, which offers Back to setup.
- **Back never loses the place.** Reopening resumes at the furthest step reached, and a lower step
  never lowers it. A sign-in survives a reload.
- **Every wait has a way out.** The scan offers Back while it runs. A failed scan says why, with
  Try again and Back. With nothing installed, each harness shows its install command, and Check
  again finds what was installed since. An empty folder leads to Change folder or a new repository.
- **Setup is gated by a positive record.** Finishing writes a record, so a person who later has no
  projects does not see setup again. Ananke's tour replayed for finished users, because it checked
  for an absent flag.

Login still comes first, because the service has one password from its environment. The first run
does not cover push alerts or a computer that joins as a worker.

## Stages, stage teams, and mocks, decided on 2026-11-07

The owner set this direction on 2026-11-07, after looking at how Ananke makes its mocks.

- **A project moves through stages.** The stages are Design, Plan, Build, Review, and Hand over.
  Each project board starts with a strip that shows them, and the repository page lists each
  project's stage. A project that draws no screens starts in Plan.
- **Teams are named for their stage.** The names are Design team, Planning team, Build team, and
  Review team. Two teams in one stage add their area after a middle dot, such as Build team ·
  Exports. The earlier names, such as App shell, were chosen one at a time.
- **The Design team makes the mocks.** When the conversation with the lead turns to screens, the
  lead starts a Design team, the Mocks tab appears after Board, and the screens arrive while the
  owner watches. A new project's board stays empty until then, and it points to the mocks.
- **Mocks are the project's own code.** Each screen is a page from the project's code, framed at
  phone or desktop size, with realistic but invented data. Ananke's mocks work the same way: its
  screens import the real components, and new parts stay drafts until the owner approves them.
- **Changes go through the AI.** The owner asks the lead for a change while a screen is open. The
  screen changes in place without reloading, and the change is recorded with who made it.
- **The data is drafted with the screens.** The Data pane lists each field the screens use, and it
  marks it as new, matching the schema, or different from it.
- **Approval hands the work to planning.** Approve mocks promotes the draft components, moves the
  project to Plan, and gives a Planning team the tasks: move each draft into the real components,
  change the schema, and wire each screen to real data. Building is not part of design.
- **The design file is the source of truth, and the mocks show exactly what it says.** OpenPencil
  runs only while someone designs or edits. Looking at the mocks needs only the code. Edit design
  and the repository Design tab's Edit mode show OpenPencil's web editor in a frame, open on the
  repository's design file. It runs from `openpencil/` on port 8443 and cannot save into the
  repository yet. When it is not running, the page says so and gives the command that starts it.
- **Converting the design into code belongs to the Build team.** Decided by the owner on
  2026-11-08. Reverse Fig goes one way only, from existing code to the design file. The conversion
  from the design file to code is a separate tool, built later as part of the Build team. The mocks,
  built from that code, then show the result.
- **The repository has a Design tab.** It shows the colors and the components that every project
  in the repository draws from, with live previews. A component that a project's approval promoted
  says which project it came from.

A repository from the owner's other work can appear in the mock without being committed, because
this repository is public. Its rows go in `data/local/`, which git ignores.

## The data behind the mock

The mock draws what stub functions return, and those functions read JSON files shaped like the
engine's events table. [data/README.md](data/README.md) lists the files, the functions, and the
event types the engine does not have yet. Text in a thread comes from stored items, so the page
works out its links: a task identifier links to its task, and a Markdown-style link can name a
task or the sprint board. Open requests appear in the lead's latest turn, and a lead's reaction
to an answer is a new turn, so the earlier text stays as it was written. Team chat is board posts,
which hold only text, so it no longer shows the tool activity it showed when it was hardcoded.

## Visual foundations, set on 2026-11-08

These rules come from the designer's critique of 2026-11-06. Claude applied them on
2026-11-08, after the rename to LGcode. They are the base that later screen work builds on.

### One type scale

- **Five sizes.** Text is 11, 12, 13, 15, or 20 pixels, named `--text-xs` to `--text-xl`.
  The body is 13 pixels. Agent replies are 15 pixels. The login heading is 20 pixels.
- **One exception.** Text fields on phones are 16 pixels, named `--text-input`, because a
  smaller field makes iOS zoom the page.
- **Three weights.** Text is 400, 500, or 600, named `--weight-body`, `--weight-medium`, and
  `--weight-strong`.
- **Page titles are quiet.** A page title is 15 pixels at weight 600. The application
  shell section below says which pages keep one.
- **A check enforces the scale.** `revision-checks.mjs` fails when the stylesheet or the
  script holds a raw font size, and when a rendered page shows a size outside the scale.

### Spacing and shape

- **Spacing sits on a 4 pixel grid.** Padding, margins, and gaps use `--space-1` (4 pixels)
  to `--space-12` (48 pixels), where the number times 4 is the size. One and two pixel
  nudges are allowed for hairlines. Values above 48 pixels are written as multiples of 4.
- **Three radii.** Controls use 4 pixels, panels and dialogs use 8 pixels, and dots and
  pills are fully round.

### Controls

- **Two heights.** Buttons, inputs, and selects are 32 pixels, named `--control`. Dense
  places use 28 pixels, named `--control-dense`: the top bar picker, the Git sync row, table
  rows, agent stop and resume, and the composer's tools. A form uses one height for its
  inputs, selects, and buttons.
- **Phones keep larger targets where they had them.** Icon buttons stay 40 to 44 pixels on
  phones, and the first run's buttons stay 44 pixels.
- **A disabled button is an outline.** It has no fill, and its text uses the muted color,
  which keeps at least 3 to 1 contrast. A disabled action that needs something says what,
  beside the button. Commit says "Add a message and stage a file."
- **Links go somewhere, and buttons change something.** Clear filters, Load full item, Try
  reconnecting (now Reconnect now), Confirm pairing, New project here, Connect subscription, Add task, Check
  again, and Change folder are buttons now. A small action in a row uses the `secondary
  dense` classes.

### Color

- **The primary color has two jobs.** It marks the one primary action in a view, and links
  in body text. The tab underline, the avatar initials, the logo, and save messages no
  longer use it.
- **Amber is for attention only.** The Modified letter in Git is muted. The failed alerts
  count uses the error color, as a failed start does. Stop agent is a neutral outline.
- **The toast is a notice, not a button.** It is a raised neutral surface at the top right,
  below the bell, so it never covers the composer.

### Icons

- **One icon set.** Every icon uses Lucide's paths, credited in `third_party/lucide/`. No text
  character stands in for an icon, so there is no ×, ←, →, ↗, ⌘, ✓, or ＋ in a button.
- **The shortcut matches the system.** The switcher shows the Command icon and K on Apple
  systems, and Ctrl K elsewhere.
- **Phone notifications use a phone icon,** because they are sent to the owner's phone.

### Motion, focus, tabs, and dialogs

- **Rows move in 120 milliseconds.** An expanded Home row eases in, and an answered request
  folds away instead of vanishing. Reduced motion turns both off. Nothing else animates.
- **Focus rings are not clipped.** The tree's scrolling area has 8 pixels of padding, so a
  disclosure's whole ring shows.
- **Tabs do not move.** Every tab has weight 500, selected or not, so selecting one changes
  no widths. The selected tab has the text color and an underline. Hover changes the color
  without a fill.
- **Every dialog closes the same way.** A Cancel button sits left of the action, and the
  corner close stays. A dialog with nothing to confirm, such as Design notes, has Close.
  The quick switcher is a search box rather than a form, so Escape closes it.
- **Resize handles show a grip on hover.** The target is 8 pixels wide. Hovering or
  focusing it shows a line, a grip, and the resize cursor.

### Login

- **The page names the product.** The logo mark sits above the heading "Sign in to
  LGcode", which suits a first visit and a return alike. The button says Sign in.
- **A password manager can fill the field.** The field has `autocomplete="current-password"`.
- **Messages show their severity under the field.** A rejected password uses the error
  color. An expired session uses the muted color. On the unavailable page, Try again is the
  primary button, because it is the only thing to do.

## The application shell, set on 2026-11-08

These rules come from the designer's critique of 2026-11-06. Claude applied them on
2026-11-08. They cover the sidebar, the top bar, the tab row, and the two switchers.

### The sidebar folds into a rail

- **Control + B folds the sidebar.** On Apple systems it is Command + B. The button at the
  top of the sidebar does the same, and its hover text names the keys.
- **The rail is 48 pixels wide.** It keeps Home, Find, New project, the service pages, Design
  notes, and the owner's initials as icons. Each icon names itself on hover. The project tree
  hides until the sidebar opens again.
- **The browser remembers the choice.** A phone keeps its drawer, and the drawer has no rail.
- **The terminal keeps Control + B.** Programs such as tmux and the shell use it, so the
  shortcut does nothing while the terminal has focus.

### Sidebar rows

- **Every row is one line of 28 pixels on a desktop.** Phones keep their 40 to 46 pixel
  targets.
- **Only the selected project has a second line.** It names the project's lead. The branch
  is in the top bar, so the tree does not repeat it.
- **Only the current row is filled.** Its project and team above it are bold, without a
  fill. A selected repository fills its whole row too.
- **A row is one hover target.** Its disclosure and its name share one surface, so no seam
  shows between them.
- **A project with no teams has no disclosure.** It draws no tree line either.
- **The current row stays clear of the fade.** After each navigation, the tree scrolls so that
  the current row sits 8 pixels above the fade at its foot.
- **Service pages are one row of 40 pixel icons.** Phone notifications, Machines,
  Subscriptions, and Service settings sit in that row, with Design notes at its end. A
  red count on the phone icon says how many notifications failed.

### The top bar and the titles

- **Each place in the top bar opens.** The repository opens its projects, the project opens
  its board, and the team opens the team.
- **A page does not repeat its place.** The top bar names the place, and the selected tab
  names the view. Home, Chat, team Tasks, Terminal, Git, Project settings, and the service
  pages show no title. The board, Mocks, and the repository page keep their summary line
  without a title. Sprints and tasks keep their own titles, because nothing else names them.
  Each page still has a heading for screen readers.
- **Home keeps New project in its tab row.** The sidebar's New project is the same action.
- **Chat has one line of 32 pixels under the tabs.** It names the agent, its role, and its
  status. A team's chat says how many agents share it.

### The tab row

- **Tasks is the last tab.** The order is Board, Mocks when the project has them, Chat,
  Terminal, Git, Project settings, and then Tasks for a team. A team's Tasks tab therefore
  moves no other tab. The critic suggested Tasks after Git with Project settings pinned to the
  right end. Claude kept Project settings in the row instead, because the lead panel narrows
  the board, so a tab pinned to the right would move between the board and the other views.

### The two switchers

- **Inspecting lists worktrees as Git does.** Main checkouts come first, then each project,
  with its teams indented beneath it. Each worktree is one line of 32 pixels with its name,
  its branch, and its machine at the right. A search field sits at the top. The list has no
  footer.
- **The quick switcher matches names only.** A name that starts with the query comes first,
  then a name with a word that starts with it, then any other name that contains it. Rows are
  36 pixels and show the attention count. The switcher has no title and no close button.
  Escape closes it.
- **Design notes says what it is.** Its previews are grouped as Session, Connection, and
  Requests.

## Connection, the bell, and empty states, set on 2026-11-08

These rules come from the designer's critique of 2026-11-06. Claude applied them on
2026-11-08.

### The connection lives in the Live indicator

- **Nothing is inserted into the layout.** The top bar's Live indicator carries the state.
  The connection banner is gone, so a lost connection moves no content and hides no button.
- **There are four states.** Live has a green dot. Connecting and Reconnecting have an amber
  dot. Offline has a red dot.
- **Reconnecting turns into Offline after 30 seconds.** Both states say when the page last
  heard from the service, such as "Last updated 2 minutes ago". The time keeps counting.
- **Reconnect now is a small button.** It sits beside the indicator, with a refresh icon and
  no arrow. On a phone it shows only the icon.
- **Data stays readable, and actions wait.** Threads, lists, and links keep working. Every
  control that changes state is disabled, and its hover text gives the reason, such as
  "LGcode is offline. This works again when the connection returns." Drafts can still be
  typed. Starting a project, a new terminal, and refreshing notifications also wait.
- **The bell's count is muted while stale.** Its hover text says that the count is from the
  last update.
- **The terminal keeps its grid.** Its notice, such as "Reconnecting. Input is paused.",
  sits in the terminal's own bar, so the rows and columns do not change.

### The bell is a short copy of Home

- **The bell uses Home's kinds.** They are Question, Approval, Merge, and Failed start.
- **The bell's order is shared.** Failed starts come first, then the request that has waited
  longest. The comparator is `byAttention` in `workbench.js`, and `attentionQueue()` returns
  the open queue in that order, so Home can use the same order.
- **Rows are 44 pixels.** Each row has the request, its age at the right, and a second line
  with the kind, the agent, and the project.
- **The bell shows at most six rows.** "View all 10" follows them and opens Needs attention
  on Home. An empty bell says "Nothing needs your attention." and has no link.

### Empty states

- **One short sentence and at most one action.** The helper `emptyState(line, action)` in
  `workbench.js` draws one. Examples are "No sprints until you approve the mocks." with
  Open the mocks, and "No matching requests." with Clear filters.
- **An empty list is not shown.** A table with no rows becomes its sentence. A sprint shows
  Completion evidence only once it has evidence. Only projects needing you says "Nothing
  needs you." when no project does.
- **Home's empty queue keeps its line about running work.** "Nothing needs you" is followed
  by how many agents are working, linked to All projects, as the Home finding asked.

## Home and its requests, set on 2026-11-08

These rules come from the designer's critique of 2026-11-06. Claude applied them on
2026-11-08. They cover Home's list and the request block that Home shares with threads.

### Order and age

- **Home uses the bell's order.** Failed starts come first, then the request that has waited
  longest. The comparator is `byAttention` in `workbench.js`.
- **Sort offers Oldest first and Newest first.** Newest first flips only the age, so failed
  starts still lead.
- **A long wait is amber.** A request that has waited an hour or more shows its age in the
  attention color, on Home and in the bell.

### Filters

- **One search field, one Filter button, and Sort.** The Filter button opens a menu with the
  repository, project, agent, and machine filters. All projects adds Status. Escape or a
  click outside closes the menu. The band is one row on a desktop and two short rows on a
  phone, where it used to take about 200 pixels.
- **A set filter is a chip.** Each chip names its filter and value, such as "Machine:
  Studio", and removes that filter when selected. Clear filters sits after the chips and
  appears only while a filter or a search is set.
- **The count line is for filtered lists.** Without a filter, the tab counts say the same
  thing, so the line is read only by screen readers.

### Rows

- **The kinds are Question, Approval, Merge, and Failed start.** Failed start is red, and
  the others are amber while open. On narrow screens the second line starts with the kind as
  one word, and Failed start becomes Failed.
- **An approval's row shows its command.** The first 60 characters follow the title in
  JetBrains Mono, so the row shows what will run, not only what the agent called it.
- **A merge row waits like any other.** It says how long the merge has waited, and it says
  Merge rather than Approval.

### Answered requests

- **Tab counts are open requests only.** They match the bell.
- **Answered requests fold away.** Questions and Approvals end with a collapsed Answered
  section, most recent first. An answered row says Allowed, Denied, Answered, Merged, or
  Cancelled, with the time.

### The expanded row and the request block

- **The expanded row starts with the request.** It has no header and no close button,
  because the row above names the agent, the project, and the title, and its chevron closes
  it. The footer has the links, the machine, and the worktree.
- **One request block.** Questions, approvals, merges, and failed starts use
  `requestBlock(kind, …)` in `workbench.js`. It has a 2 pixel left rule and a label that
  names the kind. Both are amber while a question, approval, or merge is open, red for a
  failed start, and the line color once closed. It has no top rule.
- **The block spans the thread.** A question sits inside its agent's turn, so it reaches
  back over the avatar column to the thread's full width, the same as an approval. On Home
  the label and title are hidden, because the row shows them.
- **An approval names its command and folder.** Command and Folder are labelled lines in
  JetBrains Mono, above the answer buttons. The request, tool, and call identifiers and the
  raw input wait under a closed Details disclosure.
- **One filled button.** An expanded row holds at most one primary button, so Home never shows
  two.

## The composer and agent threads, set on 2026-11-08

These rules come from the designer's critique of 2026-11-06. Claude applied them on
2026-11-08. They cover the composer, Add context, and what a thread shows besides messages.

### One input over one tool row

- **The composer is 74 pixels tall.** It is one input with one tool row beneath it, inside one
  border, in Chat and in the lead panel alike. The recipient line, the worktree line, and the
  keyboard hint are gone. The input's label still names the agent, and the hint is read only by
  screen readers.
- **Both places have a top rule.** A line separates the thread from the composer in Chat, as it
  already did in the lead panel, so thread text never runs into it.
- **The tool row holds, in order:** Add context, the subscription, the model, the effort, the share
  of the context window in use, and Send at the right end. Stop response takes Send's place while
  a reply is running.
- **The subscription shows its own name,** such as "Claude Code · Team". It no longer says Host
  profile. The agent's own subscription is chosen until the owner picks another.
- **Each menu fits its label.** Subscription, model, and effort are buttons that open one shared
  menu above them, so no fixed width leaves a gap before the chevron. Arrow keys move through the
  menu, and Escape returns to its button.
- **The model and effort belong to the agent.** The data layer stores them, and the next turn
  uses them. The context share is the harness's latest usage report, such as "34% context".
- **Narrow composers drop words, not controls.** Below 600 pixels the subscription drops its
  harness name. Below 420 pixels, as in the lead panel and on phones, Add context shows only its
  icon and "context" leaves the percentage.

### The line above the composer

- **It shows only while the agent is busy or something waits.** Examples are "Waiting for
  approval · Run the web tests" and "Working on your message". An idle agent has no line.
- **Stop shows only while the agent works or waits on a tool.** Waiting for an approval or an
  answer counts, because the agent is mid-turn. A lead with no sprints in flight,
  such as Nico before the mocks are approved, offers no Stop.

### A stopped or failed agent cannot take a message

- **The state and its remedy replace the input.** A failed start says "Ash failed to start." and
  its reason, with Sign in on Buildbox and Resume. A refused model or effort offers the model and
  effort menus and Try again. A stopped agent says so and offers Resume as the primary button.
- **The draft is kept.** The panel says "Your draft is kept." when there is one, and the input
  returns with it after Resume.
- **The thread keeps the failed start as a record.** Its block says what went wrong and how to fix
  it, and the controls live in the composer, so a thread never shows two Resume buttons. Home's
  failed-start rows keep their own controls.
- **A row with two states says both.** A stopped agent with an open question says "Stopped · Needs
  answer" and wears a hollow amber dot. A sidebar narrower than 210 pixels per row drops
  "Stopped · ", and the hollow dot and the hover text still say it.

### What a thread shows besides messages

- **An approval holds its tool call.** The call, its state, its input, and its output sit under
  the approval's Details, so the command shows once.
- **A request held by the lead names the lead.** It says "Held by Sage, the project lead", with a
  link to Sage's thread. The sidebar says "Waiting on Sage", as the line above the composer does.
- **An unconfirmed answer can be refreshed.** "Refresh this request" re-reads it before the owner
  answers again.
- **Delivery history is quiet unless something failed.** It is a muted Delivery details
  disclosure at 12 pixels. A message that was returned or withdrawn opens as "Message not
  delivered" in the error color.
- **A large item is named by its content and size,** such as "Review trace (192 kilobytes)".
  Loaded, it shows its first 12 lines with Open in full and Copy. A failed load offers Retry.
- **Open in full fills the main area.** The whole text is one plain block, so the browser's find
  reaches all of it. The link back and Escape return to the thread, at the item.

### Add context

- **Search, then groups.** The list has a search field and two groups, Tasks and Files, with rows
  of 32 pixels. Enter in the search field adds what is checked.
- **Typing @ opens the same list.** An @ typed at the start of the draft or after a space opens it.
  Adding context removes that @, and Cancel leaves it in the draft.

## The board, sprints, tasks, and wide screens, set on 2026-11-08

These rules come from the designer's critique of 2026-11-06. Claude applied them on
2026-11-08. They cover the board's cards, the sprint and task pages, the project and task
tables, and what a monitor wider than 1800 pixels shows.

### Board cards

- **A card leads with what waits for the owner.** A card that needs an answer or an approval
  starts with that line, in amber, and has an amber left rule. Two or more requests read
  "2 requests need you".
- **Then the card names the sprint.** It shows the identifier and phase, the title, one line
  of goal cut with an ellipsis, the owner with the others working on it, and the progress.
- **Progress is not an empty bar.** A sprint with no finished task says how many tasks it
  has. The bar appears once a task is done, as "1 of 2 done".
- **Column headings have no dot.** The name and the count say everything.
- **Cards stop at 300 pixels.** A column with more cards is wider, so its cards sit side by
  side. A column is at least 180 pixels wide, so four fit beside the lead at 1440 pixels.

### Sprint and task pages

- **A sprint's status is in the line under its title,** such as "SP-02 · Build · In progress
  · 2 requests need you". The Plan line is gone.
- **What the page waits for comes first.** A sprint's open questions, and the approvals that
  block its tasks, sit above its goal in the shared request block, so they can be answered
  there. Only the first block keeps a filled button.
- **A task blocked by its owner's approval says "Blocked by an approval".** The owner's open
  approval blocks the task that owner is working on.
- **A task page's actions sit at the top right,** beside the link back to the sprint. Talk to
  the owner is the primary button unless a request waits, and then the request's answer is.
- **A task page links its owner** and does not repeat the identifier and status from the line
  under its title. Folders and branches are cut at their start, with the full path on hover.
- **Each activity step says when it happened,** as a time today or a date and time before.
- **A section's action sits on its heading's line.** Add task lines up with Plan tasks.

### Tables

- **Tasks are one line.** Sprint and team task lists are tables with Task, Title, Status, and
  Owner columns, at 40 pixels a row. Team tasks use the wide frame, so they start at the tab
  row's left edge.
- **All projects and the repository page share one table.** Its columns are Project,
  Repository, Lead, Stage, Machine, Status, and Branch, one line a row. The repository page
  leaves out Repository and drops its filler sentences. Status uses the same words as All
  projects: Needs attention with its count, Working, Designing, or Planning.

### The thread panel and wide screens

- **The panel docks the current thread.** It shows the agent whose view you came from: the
  lead on the board, or Iris on Git after Iris's thread. A team's views dock the team chat.
- **Git offers the panel at every width.** Below 1801 pixels it starts closed on Git, because
  Git's three columns need the width, and the lead button opens it.
- **Above 1800 pixels the panel stays open beside every project view,** including sprints,
  tasks, Terminal, Project settings, and team Tasks. Chat is the thread itself, so it shows
  the agent's task and changed files beside the thread instead. A lead shows its sprints in
  flight.
- **A lead's status counts its team's requests.** The line under Chat says "Waiting on 3
  requests", as the line above the composer does.
- **A request held by the lead does not count for the owner.** The bell and Home's Needs
  attention leave it out until the lead releases it.
