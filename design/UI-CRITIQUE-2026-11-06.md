# UI critique against T3 Code, VS Code, and Cursor

Observed: 2026-11-06.
Verified against: `85533f5`, with the current uncommitted design changes.
Scope: Assessment only. No interface code, styles, tokens, or behavior changed.

## Verdict

The visual direction is coherent. The remaining gap is consistency between
context, panel layout, and available actions. Adding more individual pages
without resolving those relationships will make the product harder to operate.
Keep Field and Dusk, repository/project/team navigation, project selection
opening the board, and the project lead alongside the board.

## Evidence inspected in this pass

Confirmed live: Fresh browser captures covered 15 screen states at 1440px,
2560px, and 390px, including Field and Dusk. These included the project board,
lead chat, Rowan’s decision, shared team chat, team Changes, Git history,
workspace picker, workspace Settings, Terminal, Machines, and the lead drawer.
There were no browser JavaScript errors or document-level horizontal overflow
in these captures. Internal horizontal scrolling still affects the board.
Evidence: design/previews/critique-current/observations.json and measurements.json.
Screenshots are alongside those files. No interaction regression suite was run
for this assessment because the interface was not changed.

Reference material was inspected this session:

- T3 Code’s official interface screenshot, linked from https://t3.codes/:
  https://t3.codes/_astro/app-desktop.BHuzLVLF.webp.
- VS Code’s official Source Control screenshot and documentation:
  https://code.visualstudio.com/docs/sourcecontrol/overview.
- VS Code’s layout and keyboard navigation documentation:
  https://code.visualstudio.com/docs/editing/getting-started/userinterface.
- VS Code’s worktree documentation:
  https://code.visualstudio.com/docs/sourcecontrol/branches-worktrees.
- Cursor’s Agents Window announcement and worktree documentation:
  https://cursor.com/blog/cursor-3 and https://cursor.com/docs/configuration/worktrees.

The T3 Code and VS Code screenshots were visually inspected. Cursor comparison
uses its official documented workflows; no running Cursor installation was
used to establish its current appearance.

## 1. The navigation does not make scope consistent

Confirmed live: A team has Chat, Tasks, and Changes controls in its header,
while the project workspace below has Board, Chat, Terminal, Git, and Settings.
On team Changes, Chat remains selected in the lower workspace row while
Changes is selected above. The Git view presents the same changed-file content
through another path. The project remains highlighted while its team or agent
can also be selected. Global Settings and workspace Settings share a name.

Judgment: The user has to remember what each control applies to. The interface
needs a consistent scope header for project, team, or agent. Team-specific
Changes should open the unified Git surface with that team’s worktree selected.
Workspace Settings should identify its scope clearly. Preserve direct access
to the board and the one-lead-per-project relationship.

Source anchors: design/workbench.html:269, :292, :337, :350.

## 2. Panel geometry wastes space and hides project status

Confirmed live: At a 1440px viewport, the sidebar is 276px and Sage is 390px.
The board’s visible width is 718px, but its four columns require 936px.
Done starts at x=1018 while the board’s visible right edge is x=1022.
The last column therefore requires horizontal scrolling. There is no visible
resize handle. At 2560px, the chat reading column remains 800px wide at x=340,
leaving 1420px to its right. The composer follows the same left alignment.

Judgment: Keep readable text width. Center the focused conversation within
its available pane, and make the sidebar and Sage panel resizable. Give the
board width intentionally, with a compact density and an explicit overflow
cue when all statuses cannot fit. Do not solve this by stretching prose.

Source anchors: design/workbench.html:34, :35, :41.
Evidence: measurements.json, board-dark-1440.png, lead-chat-light-2560.png.

## 3. Chat lacks a strong connection between conversation and work

Confirmed live: Names, roles, tool labels, user turns, collapsed execution
details, and actionable questions are present. Sage’s header says Running,
while operational progress and handoffs are separate disclosures in the
transcript. The composer shows a recipient and send action, but no active
harness/account or task-context control. Running and Stop agent are separated
across the full main width.

Judgment: Group each execution’s progress, tool activity, changed files, and
result into a readable unit. Put current progress near the composer and keep
Stop close to that progress. Show the current agent/harness and relevant
workspace context without putting an entire settings form in the composer.
Support attaching a file or task to a message. Preserve visible message authors
and direct question/permission links.

Comparison: T3 Code’s official screenshot connects its thread to active
subagents, machine, branch, commit, and changes. Its composer supports explicit
context and model selection. Borrow that relationship between work and chat,
while keeping Shephrd’s persistent project/team structure.

Source anchors: design/workbench.html:200, :302, :305, :325, :373.

## 4. Git stops before the workflow the owner described

Confirmed live: Git opens a file’s diff directly and supports unified/split
layouts and history. It has no commit-message input, staging controls, commit,
sync, project/team worktree tree, or merge destination. The picker lists flat
workspaces. The latest team-to-project worktree relationship was discussed but
has not been drawn into the interface.

Judgment: Give Git a project/team worktree tree, staged and unstaged groups,
a commit message, and branch-specific commit/sync actions. Show the integration
target explicitly: team to project, then project to main. Include incoming and
outgoing commits, conflicts, and integration readiness. The diff remains the
main review surface.

Comparison: VS Code groups selection, staging, commit, branch, and sync around
source control. Cursor’s published workflow connects agents to isolated
worktrees and subsequent review/commit work. Shephrd should expose its additional
team-to-project relationship rather than hiding it in a generic branch list.

Source anchors: design/workbench.html:112, :262, :263, :265, :352.

## 5. Attention needs a useful summary without losing its source

Confirmed live: Rowan and Iris have attention labels in the tree. Sage links
to Rowan’s question and to permissions. The board also flags a blocked sprint.
The board offers both a Sage toggle and Talk to Sage while the Sage panel is
already visible. Important branch, role, task-count, and execution text often
uses 10–12px type.

Judgment: Keep the contextual highlights, but provide a small actionable
attention summary for decisions, permissions, and failures. Make the blocking
relationship explicit so the owner can tell which answer frees which team.
Reduce repeated navigation actions. Raise the type size of information needed
to choose an action; keep timestamps and paths secondary.

Source anchors: design/workbench.html:34, :35, :292, :331, :346.

## 6. Navigation has not been tested against the intended volume of work

Confirmed live: The current sidebar shows four projects across two repositories.
There is no visible search, quick switcher, or attention-only filter. The
sidebar expands repositories, projects, teams, and agents through nested rows.
Keyboard handling covers dialogs, navigation drawers, tab rows, and send, but
no global command or entity switcher appears in the inspected interface.
At 390px, the board shows one full column and part of the next; the status
across the whole project is not summarized above it.

Judgment: Add a keyboard-accessible project/team/agent switcher and an
attention filter before testing a larger roster. Test with 10 projects and
30 agents. On phones, give the board a status summary or column selector.
Keep the full Terminal mode the owner requested; give terminal sessions a
clear name and worktree/machine identity as the number of sessions grows.

Comparison: T3 Code’s official screenshot exposes search and activity grouping.
VS Code documents Quick Open and a Command Palette. These are useful ways to
avoid making every navigation operation depend on an expanded tree.

Source anchors: design/workbench.html:256, :292, :440.

## Recommended order

1. Resolve project/team/worktree scope across the header, tabs, Git, and Terminal.
2. Fix panel sizing and the board’s hidden status at normal desktop widths.
3. Draw the complete team-to-project Git integration workflow.
4. Improve chat execution grouping, composer context, and current-progress display.
5. Refine attention summaries, typography, roster search, and phone navigation.

This is a recommendation for the next design pass. No UI changes were made.
