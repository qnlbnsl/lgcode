# LGTM Studio: finding work, answering requests, and using space

Reviewed on 2026-11-06 against the running browser prototype. Product source revision: `85533f5`; the design directory remains uncommitted. This follows the owner's request for another critique, a global Home page, remote project creation, and denser screens.

## The remaining design problem

Judgment: the workspace has become more coherent, but its individual screens developed faster than the route through them. A usable conversation, board, and Git view do not help enough if the owner must search the repository tree to discover who needs an answer. Increasing the number of cards or adding another sidebar destination would make that problem worse.

Confirmed live before this pass: the app opened inside Workspace app. Four unresolved items were available through the attention bell. There was no global Home page, no dedicated cross-project question list, and no machine choice in Add Project. Machines spent a large row on each host. The before captures are `previews/home-before-board-1440.png` and `previews/home-before-attention-1440.png`.

## Cursor sets the standard for context and working space

The official [Cursor agents-window documentation](https://cursor.com/docs/agent/agents-window) describes work across repositories and environments with files and diffs available alongside agents. The official [Cursor 3 announcement](https://cursor.com/blog/cursor-3) describes moving between local and cloud environments and reviewing, staging, and committing changes. Its published agents-window image was inspected during this pass.

Judgment from that reference: the useful standard is clear working context, a compact frame, and nearby results. LGTM Studio should make the selected project, conversation, branch, and host understandable without repeating all of them in oversized headers. It should spend room on the conversation or diff that the owner is reading.

[T3 Code](https://t3.codes/) remains a secondary reference for a direct agent workspace. The owner's difficulty discovering some of its controls is a constraint on LGTM Studio. This review does not claim that a specific T3 control caused that difficulty. LGTM Studio needs visible, named destinations and useful default views before it adds shortcut-only workflows. No external implementation code was copied for this pass.

## The changes in this pass

| Problem | Implemented response | Evidence |
|---|---|---|
| The owner had to hunt through project branches for requests. | Home is the initial view and a permanent navigation entry. Needs attention collects questions, permissions, failed starts, and pending project merges across projects. | `workbench.html:570`, `previews/home-checks.json`. |
| A bell summary could locate an item but could not serve as the owner's queue. | Home has Needs attention, All projects, Questions, and Approvals. Questions and permissions can be answered in the detail pane. Project merge requests use the existing explicit review dialog. | `workbench.html:589`, `workbench.html:594`. |
| Answered items disappeared from the immediate task path. | Questions and Approvals retain answered history. Search and repository, project, agent, machine, and status filters combine. Open items sort first. Source links preserve the working conversation draft. | `workbench.html:580`, `previews/home-cold-verification.md`. |
| Choosing a machine happened outside project creation. | Add Project chooses Run on before the project name and previews that host's branch and folder. Offline hosts and hosts without the repository cannot start work. An explicitly selected unavailable host stays visible instead of silently switching. | `workbench.html:450`, `workbench.html:603`. |
| Machines used excessive vertical space for comparable records. | A semantic table aligns Machine, Status, Role, Agent slots, Projects, and Start project. A second compact table handles future placement. The observed machine rows are 43 pixels tall at 1440 pixels. | `workbench.html:288`, `previews/machines-final-1440.png`. |
| Global requests risked losing the correct work context. | Permission and failed-start details identify the requesting team's branch. Remote unchecked projects identify the main checkout on that host. Future placement does not relabel running work as migrated. | `previews/home-cold-verification.md`. |

Home uses a list and detail pane rather than a grid of summary cards. Its rows use two lines: the title and status, then the request kind and compact source context. All projects uses aligned project entries. The work frame is capped at 1380 pixels and centered on wide screens. At narrow widths the detail moves below the list, and choosing a request scrolls to it. Machines scrolls within its table container on phones.

## Space is a product constraint

The UI skills were reread in Operate mode, emphasizing scanability, task completion, native interaction, and density. The owner explicitly called out the machine rows: “could just be a table.” That is the right pattern for repeated records with comparable fields.

The resulting rule is concrete: use tables for fleet and placement comparisons, compact lists for incoming requests, and a reading column for conversations. Reserve cards for the requested Kanban board, where the spatial grouping expresses sprint state. Do not fill available space merely because it exists. Do not make paragraph text tiny to compensate for oversized framing.

The Field/Dusk palette blocks remain unchanged. Subscription entries and Git control spacing were also reduced. Permission and failed-start boundaries use the existing one-pixel rule. The automated design detector could only run in regex fallback because its parser dependencies were unavailable; its lack of findings is not a full accessibility or craft audit.

## What still falls short of Cursor

These are judgments for the next design decision, not newly implemented features:

1. **Chat still needs a stronger treatment of a long working session.** The composer and grouped activity are clearer, but the owner needs to judge a sustained run with several tool groups, revisions, interruptions, and changed files. A short initial conversation cannot establish that experience.
2. **Git still has substantial control chrome.** This pass tightened its spacing. A focused review of a long diff should decide which worktree controls stay visible, which can collapse, and whether reviewing multiple files feels continuous. The diff should retain the largest share of the work area.
3. **The project tree still carries several purposes.** It identifies ownership, navigation, status, and branch assignment. Home removes the need to use it as an inbox. It still needs a larger-project stress case before its density can be called successful.
4. **Home's filters have a visible cost on a phone.** Explicit controls aid discovery, but five filters take more vertical room. A later collapsed filter drawer should be judged with actual mobile use rather than added as another hidden layer now.
5. **A live system needs stronger lifecycle truth.** Persistent requests, concurrent answers, host disconnection, and real Git results must come from the service. This browser prototype establishes the proposed interactions, not those guarantees.

## Verification and next judgment

The functional evidence is in the five browser suites and their JSON results under `previews/`. Independent cold verification recorded 42 successful checks with zero JavaScript errors. It reproduced draft loss, unavailable-host fallback, placement ambiguity, incorrect branch labels, missing tab keyboard navigation, and a wrong checkout label before independently confirming their fixes.

Final visual captures are `previews/home-final-{light,dark}-{390,1440,2560}.png`, `previews/machines-final-1440.png`, `previews/machines-final-390.png`, and `previews/project-machine-final-1440.png`. The next useful owner judgment is whether Home makes all outstanding decisions easy to find, and whether the compact Machines page is appropriately dense. This pass does not claim Cursor parity.

## Subsequent owner correction: inline requests and a coherent sidebar

Later on 2026-11-06, the owner rejected the split request view and described
the sidebar as disjointed. This supersedes the list/detail composition above.
Needs attention, Questions, and Approvals now use collapsed single-line rows.
Each row toggles its details immediately underneath, with one expansion at
a time. Desktop rows measured 42 pixels; phone rows measured 44 pixels.

Home and a bordered Find project or agent control form one navigation group.
Projects groups New project with Only projects needing you and the repository
tree. The duplicate Repositories destination is removed; repository names
still open their project lists. Visible rules separate these groups and the
service pages. The approved palette is unchanged. New captures use
`previews/inline-requests-` and `previews/inline-sidebar-`.
