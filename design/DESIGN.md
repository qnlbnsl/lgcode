# Shephrd’s approved palette pair

The owner selected Field for light mode and Dusk for dark mode on
2026-11-05. The two palettes give the same app a brighter daytime surface
and a muted dark surface. Harbor is no longer an active option.

## What is approved

`tokens.css` is the color contract for future Shephrd app mockups.
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

The lead button and close control can collapse the panel. At widths of
1100 pixels or less it starts closed. The lead button opens a drawer over
the board. The drawer contains keyboard focus, Escape closes it, and focus
returns to the lead button. Its expand control opens the full conversation.
The board retains its own scroll position while the conversation scrolls.

## Preserve the existing page’s operational controls

The redesign retains authentication states, connection status, permission
requests, agent stop/resume, safe failed-start reasons, explicit large-item
loading, tool calls, delivery history, Alerts, and Settings. Permission
controls show the actual action input before answer buttons. Hidden input
and unconfirmed answers have explicit states. Stop cancels permissions.
Logout and expiry wipe entered secrets. Reconnecting preserves reading
context but disables mutations. These remain sample flows in the mock.

Alerts, Machines, Subscriptions, and Settings belong to the service, so they
sit in global navigation. The project workspace has Board, Chat, Terminal,
Git, and Settings tabs. Git combines the repository worktree hierarchy, staged and unstaged files,
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

The assigned branch sits beneath each project name beside its lead in the
sidebar. The board repeats it beside the project title as quiet monospace
text with a branch icon. Long names truncate in the sidebar and wrap onto
the next title line when needed. Hover text exposes the full branch name.
The top-right picker says Viewing, because it changes the inspected
workspace. Inspecting another branch does not change the project label.
A new project still starts with its lead to shape the first plan.
Start work tree is checked beneath its name by default. A safe version of
the project name becomes the branch and worktree folder. Existing names get
a numeric suffix. Unchecking uses the repository’s main checkout. The dialog
previews the exact branch and folder before creating the sample project.

## How the modes behave

Field is the default token block. Dusk overrides it under
`:root[data-theme="dark"]`. Both modes share spacing, type roles, shape,
and motion values. A first visit follows the device's color mode.
A manual light or dark choice takes precedence and is remembered when
browser storage is available. Device changes are followed until the owner
makes a manual choice.

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

The current workbench uses available system sans-serif fonts for interface
text and a system monospace stack for file references. Final font selection
is open. Keep long replies within roughly 68 characters per line, with
enough line spacing to follow paragraphs.

The current proposal uses a shared frame for the compact conversation
header, chat, and composer. That frame stays centered within the available workspace on wide
screens. Message text has a separate 70-character reading measure. Boards
and plan details use a wider frame. Titles,
authors, replies, and metadata have distinct sizes. The composer always
names its recipient, including after a draft replaces the placeholder.

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
available in team scope. Git selects the team worktree when opened from a
team. The header names the selected team, branch, and machine. Selecting a
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

Agent progress and stop/resume sit next to the composer. Subscription choices
are filtered by harness and machine. Files and tasks can be attached as
context, and sent turns retain those references. Grouped activity links to
its changed files. The attention menu separates decisions, permissions, and
failed starts. Only projects needing you filters projects. Quick switch searches
projects, teams, and agents, and opens with Command or Control + K.
Terminal sessions preserve separate input and history in each worktree.

## Home gathers work across projects

Home is the initial page and a permanent navigation destination. It offers
Needs attention, All projects, Questions, and Approvals. Needs attention
gathers unresolved questions, permissions, failed starts, and project merge
reviews. Questions and Approvals retain answered history. Search combines
with repository, project, agent, machine, and status filters. Open entries
sort first. Filters stay selected on return, with a visible Clear filters action.

A single-line request row expands its details directly underneath. All rows
start collapsed. Selecting the same row closes it. Only one request expands
at a time. The owner can answer questions and
permissions without leaving Home. Merge approval uses the existing explicit
review dialog and records its result in place. Source links open the precise
conversation or project board. Discussion preserves any existing draft.
Request context names the requesting team's worktree where applicable.
Keyboard arrows, Home, and End operate the tabs. Filter changes retain focus.

The row retains keyboard focus when toggled. Its chevron and expanded state
expose the disclosure. Full source context lives in the expanded content;
narrow screens retain the title and status on the summary line. On wide
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
project tree, and thin rules separate repository groups. The account and
theme controls retain their existing boundaries. Search remains available
with Command or Control + K.

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
