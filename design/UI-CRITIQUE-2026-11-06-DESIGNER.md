# Design critique of the LGTM Studio web mock, 2026-11-06

This critique judges `workbench.html` from about 350 real screenshots and from measurements taken in a browser. The screenshots cover the Field color mode, which is light, and the Dusk color mode, which is dark. They were taken at window widths of 1440, 2560, and 390 pixels, with some extra captures at 900 and 1100 pixels. The default sample and the `?sample=heavy` sample were both used. All measurements are in pixels at a 1440 by 900 window unless the entry says otherwise.

The screenshots and scripts are in `/tmp/claude-1000/-home-qnlbnsl-projects-personal-herdr-synapse/32ed82f1-73b8-4c01-afb9-f84c5c6cabb4/scratchpad/critique/`. No file in `design/` was changed except this one. The check suites were not run.

Comparisons with Cursor, T3 Code, and Visual Studio Code rest on my knowledge of those products. I did not measure them during this session.

Each finding has a stable identifier, a severity, the screen or part, what I see, why it matters, and a recommendation. "Must fix" means that it misleads, blocks, or breaks the work. "Should fix" means that it clearly hurts daily use or the sense of quality. "Polish" means that a careful designer would notice it.

## Part 1. The verdict and the five findings that matter most

### The verdict

The mock looks like one product, and that is a real achievement. The color application is disciplined in both modes, and contrast passes almost everywhere.

It is not yet a working instrument. It is a calm administration console that happens to contain agent threads.

LGTM Studio has one job that nothing else does, which is to tell a solo owner where to look across many agents and to give that owner enough evidence to answer. The mock is weakest exactly there. The sidebar misreports attention, a failed start wears the success color, and the most consequential approval in the product shows less evidence than the row behind it.

The chrome is also too heavy. Next to Cursor, every screen spends more of its height and width on labels, repeated names, and controls than on the work. The Git diff gets 46 percent of the window width.

### The five findings that matter most

1. **The sidebar misreports attention (SIDE-1 and STATUS-1).** A project with a failed agent shows no dot, collapsed teams and repositories hide their requests, and failed or stopped agents wear the success green. The owner's main map of the fleet cannot be trusted.
2. **The merge to main is approved without evidence (MERGE-1).** The dialog shows a branch arrow, the text "1 commits ready for review", and one commit message. It has no file list, no test results, no review result, no diff, and no Cancel button.
3. **Permission requests tell the owner false or contradictory things (PERM-1, PERM-2, and THREAD-1).** A blind approval looks exactly like an informed one. A cancelled request says "Answer recorded" in green. A status line says "No owner action needed" directly above a waiting permission.
4. **The split diff lines up the wrong lines (GIT-1).** The two sides do not correspond row by row, they scroll separately, and each hides about half of its text. A reviewer can read the wrong change as the right one.
5. **The chrome outweighs the work on every screen (WHOLE-1).** The first request on Home starts 30 percent of the way down the window, chat gets 64 percent of the height, and the sidebar cannot be collapsed. This is rated Should fix because it misleads no one, but it is the largest cost the owner pays every day.

## Part 2. The complete list of screens and states

The "Reached" column says what I captured. "Dusk" and "Field" name the color modes. "Heavy" means the `?sample=heavy` data.

| Number | Screen or state | Reached |
|---|---|---|
| 1 | Login, logged out | Reached in Dusk at 1440, 2560, and 390, and in Field at 1440. |
| 2 | Login, session expired | Reached in Dusk at 1440 and 2560, and in Field at 1440. Not captured at 390. |
| 3 | Login, rejected password | Reached in Dusk at 1440 and 2560, and in Field at 1440. Not captured at 390. |
| 4 | Login, session service unavailable | Reached in Dusk at 1440 and 2560, and in Field at 1440. Not captured at 390. |
| 5 | Connecting banner | Reached in Dusk at 1440, 2560, and 390, and in Field at 1440. |
| 6 | Reconnecting banner | Reached in Dusk at 1440, 2560, and 390, and in Field at 1440. |
| 7 | Offline state | Not reached, because the mock has no such state. The preview offers only Connecting and Reconnecting. "Offline" exists only as a machine status. |
| 8 | Home, Needs attention tab | Reached in both modes at 1440, 2560, and 390, with heavy at 1440 and 2560. |
| 9 | Home, All projects tab | Reached in both modes at 1440 and 390, in Dusk at 2560, with heavy. |
| 10 | Home, Questions tab, open and answered | Reached in both modes at 1440 and 390, in Dusk at 2560, with heavy. |
| 11 | Home, Approvals tab, open and answered | Reached in both modes at 1440 and 390, in Dusk at 2560, with heavy. |
| 12 | Home, expanded question | Reached in both modes at 1440, and in Dusk at 390. |
| 13 | Home, expanded approval | Reached in both modes at 1440, and in Dusk at 390. |
| 14 | Home, expanded approval with hidden input | Reached in Dusk at 1440. |
| 15 | Home, expanded failed start | Reached in Dusk at 1440. |
| 16 | Home, expanded merge approval and its dialog | Reached in Dusk at 1440. |
| 17 | Home, filters that match nothing | Reached in Field at 1440. |
| 18 | Home, truly empty queue | Reached in Dusk at 1440, only by forcing Ash's state with a script, because a failed start cannot be cleared from Home. |
| 19 | Bell popover, normal, heavy, and empty | Reached in Dusk at 1440, in Field at 1440, and at 390. |
| 20 | Quick switcher, empty and typed | Reached in Dusk at 1440 and at 390. |
| 21 | Sidebar, default and heavy | Reached in both modes, at every width. |
| 22 | Sidebar, Only projects needing you filter | Reached in Dusk at 1440, with heavy in both modes. |
| 23 | Repository page | Reached in both modes at 1440, in Dusk at 2560, 900, and 390, with heavy. |
| 24 | Board with the lead panel open | Reached in both modes at 1440, in Dusk at 2560, 1100, 900, and 390, with heavy. |
| 25 | Board with the lead panel closed | Reached in both modes at 1440, and in Dusk at 2560 and 900. |
| 26 | Board with the lead panel as a drawer | Reached in Dusk at 900 and 390. |
| 27 | Empty board, Desktop companion | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 28 | Sprint page | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 29 | Task page | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 30 | Add Task dialog | Reached in both modes at 1440, and in Dusk at 2560. Not captured at 390. |
| 31 | Lead in full chat, default and heavy | Reached in both modes at 1440, in Dusk at 2560 and 390, and heavy in both modes. |
| 32 | Team chat | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 33 | Team tasks | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 34 | Iris, with permission, tool call, large item, and delivery history | Reached in both modes at 1440, and in Dusk at 2560. The permission view was also captured at 390. |
| 35 | Rowan, with a decision | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 36 | Finch, with redacted input | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 37 | Ash, failed start | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 38 | Stopped agent with Resume, and the fresh resume state | The stopped state was reached in both modes at 1440, and in Dusk at 2560 and 390. The fresh resume state was not captured at 390. |
| 39 | Thread failure states: unconfirmed answer, held request, failed large item, refused model | Reached in Dusk at 1440. Only the "Model refused" option of the failure list was captured. The other reasons were read from the source. |
| 40 | Terminal, normal | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 41 | Terminal, vim | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 42 | Terminal, multiple sessions | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 43 | Terminal, paused when reconnecting | Reached in both modes at 1440, and in Dusk at 2560, with heavy. Not captured at 390. |
| 44 | Git, one file | Reached in both modes at 1440, in Dusk at 2560, 1100, and 390, with heavy. |
| 45 | Git, all files | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 46 | Git, split diff | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 47 | Git, history, staged, and committed | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 48 | Git, conflict and its dialog | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 49 | Git, merge and its review | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 50 | Git, team worktree | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 51 | Project settings | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 52 | Branch picker | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 53 | Alerts, including loaded older items | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 54 | Machines as master, including a pending worker | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 55 | Machines as worker, unpaired and paired | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 56 | Machines, connect dialog | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 57 | Subscriptions | Reached in both modes at 1440, in Dusk at 2560 and 390, with heavy. |
| 58 | Add subscription dialog | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 59 | Subscription sign-in dialog | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 60 | Service settings | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 61 | New project, existing repository | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 62 | New project, new repository | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 63 | New project, unavailable host | Reached in Dusk at 1440. |
| 64 | Add context dialog | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 65 | Design notes dialog | Reached in both modes at 1440, and in Dusk at 2560 and 390. |
| 66 | Phone navigation | Reached in Dusk at 390. |

### The limits of what I could judge

- Native select menus do not appear in headless screenshots. I read their options and disabled options from the page instead.
- Motion was judged from the source, because still screenshots cannot show it.
- The heavy sample does not stress every screen. It leaves the board at 4 sprints with about 1 card per column, Git at 2 files, Alerts at 2 rows, and Subscriptions unchanged. Density under load on those screens is therefore unproven.
- The `system-ui` font renders here as a wide face similar to DejaVu Sans. Some truncation I report will ease with a narrower font, which is one more reason to settle the font.

## Part 3. The page as a whole and the shared parts

### The page as a whole

First impression: this is a calm, tidy, slightly oversized console. It reads as one product from login to Service settings.

Hierarchy is clear on most pages but spent on the wrong things. The largest type on nearly every screen names something the owner already knows, such as the page they just clicked. The thing they came to act on, such as a waiting request, is 13 pixel text in a row.

The visual language is consistent in color and loose in geometry. Corners, control heights, and request treatments vary more than the calm surface suggests.

#### WHOLE-1. Should fix. The chrome outweighs the work on every screen.

Part or screen: Whole application.

What I see: The sidebar is a fixed presence of 248 pixels that can be resized but not collapsed. The first request on Home starts at y=270, which is 30 percent of the window. The chat body gets 578 of 900 pixels, which is 64 percent. The diff text gets 656 of 1440 pixels, which is 46 percent, with 744 pixels of chrome to its left. On a board, the branch appears four times: in the sidebar, the title, the Viewing control, and the composer. The project name appears three times: in the sidebar, the breadcrumb, and the page title.

Why it matters: The owner supervises many agents at once, so every line of repeated chrome is one less line of work on screen. Cursor gives the same user far more thread and diff in the same window, and that comparison is the one the owner chose.

Recommendation: Add a sidebar collapse to a 48 pixel icon rail, bound to Command or Control + B. Remove the page title on Home's tabs and on Chat, because the top bar already names the page. Show the branch once in the top bar and nowhere else on the page. Make the sidebar's service pages icons in the collapsed rail.

#### WHOLE-2. Should fix. The application does not use a wide monitor.

Part or screen: Whole application at 2560 pixels.

What I see: The sidebar, board cards, and thread simply get more margin at 2560 pixels. On the board, cards stretch to 365 pixels wide and about 70 percent of the page stays empty. On the sprint page, the content stops about 1400 pixels from the left edge. In Chat, the title sits at the left edge while the conversation is centered about 570 pixels away from it.

Why it matters: An owner with a large monitor would want several things visible at once, and this owner runs many agents. The extra space currently buys nothing.

Recommendation: Above 1800 pixels, keep the lead panel open beside every project tab. Let the Chat tab show the thread beside the task and changed-files panel. Cap board cards at 300 pixels and let columns add cards side by side, so the extra width shows more work.

#### WHOLE-3. Should fix. Attention has at least seven different names.

Part or screen: Whole application.

What I see: Home says Question, Approval, and Failed start. The bell says Decision, Permission, and Failed start. The sidebar says "Needs you" and "Needs approval". A board card says "Needs your decision", the sprint page says "Needs your direction", a thread says "Decision needed", and a permission is headed "LGTM Studio permission request". `DESIGN.md` defines one term, Needs attention, but no vocabulary below it.

Why it matters: The owner must learn that Question, Decision, and Direction are the same thing, and that Approval and Permission are the same thing. Every mismatch adds a small doubt about whether two counts refer to the same items.

Recommendation: Add three kinds to the `DESIGN.md` names table: Question, Approval, and Failed start. Use those three words in every surface. Use "Needs answer" and "Needs approval" as the short forms in the sidebar.

#### WHOLE-4. Should fix. The worktree concept has eight names.

Part or screen: Whole application.

What I see: The mock uses worktree, work tree, Working tree, workspace, Assigned workspace, Base workspace, "Start work tree", and "Branches & workspaces". `DESIGN.md` says that Worktree is the name. Conversation and thread are also used interchangeably, and so are Quick switch and "Find project or agent".

Why it matters: Git's own term for one of these, "working tree", means something different from a worktree, so the drift is confusing even to an expert. The rule already exists and the mock breaks it.

Recommendation: Use Worktree everywhere. Use "Uncommitted changes" in place of "Working tree". Use thread in place of conversation. Name the switcher "Find project or agent" everywhere.

#### WHOLE-5. Polish. Compared with Cursor, the product feels like a set of pages rather than one workspace.

Part or screen: Whole application.

What I see: Moving from a request to a thread to a diff replaces the whole main area each time. No panel lets the owner keep a thread open while reading its diff, except the lead panel on the board.

Why it matters: An approval often needs both at once. Cursor's agent view keeps the conversation and the changes side by side, which is why it feels like one instrument.

Recommendation: Allow the lead panel, or any agent's thread, to stay docked on the right over the Git tab as well as the Board tab.

### The sidebar

#### SIDE-1. Must fix. The sidebar hides attention that exists.

Part or screen: Sidebar.

What I see: Agent recovery has no dot, although its agent Ash has a failed start. All projects says "Needs attention" with a count of 1 for that project, and the Only projects needing you filter keeps it. So the dot disagrees with both. The collapsed Review team shows only "1", which is its member count, and hides Finch's waiting request. Collapsed repositories such as atlas-docs, billing-api, infra, and mobile-app in the heavy sample show nothing, although they hold attention. `DESIGN.md` says that the bell, Home, and the sidebar dots all count Needs attention.

Why it matters: The sidebar is the owner's map of the fleet. A project that looks quiet while its agent has failed is the exact failure this product exists to prevent.

Recommendation: Roll attention up on every project, team, and repository row, counting failed starts as well as requests. Show a number rather than a dot, right-aligned, and never reuse that position for a member count. Move the member count to the row's hover state or remove it.

#### SIDE-2. Should fix. Sidebar rows are too tall and the tree is starved.

Part or screen: Sidebar.

What I see: The project row is 56 pixels tall with a pitch of about 62. The tree occupies 440 of 900 pixels, which is 49 percent. The footer occupies 204 pixels. About seven projects fit, and at an 800 pixel window only two and a half fit. Branch names truncate at the part that differs: "feat/invoic…", "chore/runner…", and "fix/push-retr…".

Why it matters: The heavy sample has 10 projects and 31 agents, so the owner scrolls a map that should fit on one screen. A truncated branch hides the only distinguishing text, which breaks the rule `DESIGN.md` applies to team worktrees.

Recommendation: Make every project row one line of 28 pixels with the name and the attention count. Show the lead and branch as a second line only on the selected project. Replace the five service rows with an icon row of 40 pixels. Truncate branches from the start, keeping the end.

#### SIDE-3. Should fix. The theme control takes a permanent row and shows the palette names.

Part or screen: Sidebar.

What I see: The footer holds a permanent "Field / Light" and "Dusk / Dark" switch of about 40 pixels. Field and Dusk are the names of the palettes.

Why it matters: The owner changes this rarely, while the tree it displaces is used all the time.

Recommendation: Move it to Service settings, under Appearance. Label the choices Light, Dark, and Match system.

#### SIDE-4. Polish. Selecting a team highlights two rows equally.

Part or screen: Sidebar.

What I see: When a team is selected, both the project row and the team row have the same selected fill. A selected project row also shows a two-tone seam at x=44 on hover.

Why it matters: Two equal highlights do not say where the owner is. The seam looks like a rendering fault.

Recommendation: Use the full fill only on the current row, and bold text without fill on its ancestors. Make the row one hover target, so the seam disappears.

#### SIDE-5. Polish. A stray tree line sits under an expanded project with no teams.

Part or screen: Sidebar.

What I see: Expanding Desktop companion draws a short tree mark at about x=41, y=620 with nothing under it.

Why it matters: It looks like a missing row.

Recommendation: Do not draw the tree line when a project has no teams, and do not offer a disclosure on that project.

### The top bar

#### TOP-1. Should fix. The breadcrumb looks like navigation but cannot be clicked.

Part or screen: Top bar.

What I see: The items in "lgtm / Agent console / App shell" are `span` and `strong` elements with no action. The reader's habit from every other product says that these go somewhere.

Why it matters: The owner will click them. T3 Code taught this owner that an affordance which does not behave as expected is a real defect.

Recommendation: Make each segment a link to that repository, project, or team.

#### TOP-2. Polish. The Viewing control's chevron points the wrong way.

Part or screen: Top bar.

What I see: The Viewing control opens a dropdown below it, but its chevron points right, which means "go somewhere".

Why it matters: This is a small lie about what the control does.

Recommendation: Use a downward chevron.

#### TOP-3. Should fix. The phone top bar is overcrowded.

Part or screen: Top bar at 390 pixels.

What I see: The bar holds the menu, a breadcrumb reduced to "lgtm ," or "s… / Projects", the bell, the Live indicator, the word Viewing, and an ellipsized branch.

Why it matters: Nothing in the bar is legible enough to use, and the bell is the one thing a phone user came for.

Recommendation: On a phone, show the menu, the current project or agent name, and the bell. Move Live to a dot on the bell or the menu. Move the branch into the tab content.

### The tab row

#### TAB-1. Should fix. The Tasks tab moves every tab after it.

Part or screen: Tab row.

What I see: In project scope, Terminal sits at x=394 and Git at x=473. In team scope, the inserted Tasks tab moves Terminal to x=451 and Git to x=530. `DESIGN.md` says that the tab row stays still, but it only guards the left edge.

Why it matters: Muscle memory fails when the owner moves between a project and its team. The owner aims for Terminal and hits Tasks.

Recommendation: Move Tasks after Git, in the order Board, Chat, Terminal, Git, Tasks, and pin Project settings to the right end of the row. Then no shared tab moves when Tasks appears.

#### TAB-2. Should fix. Selecting a tab makes the other tabs jump.

Part or screen: Tab row.

What I see: The selected tab turns bold, which widens it. With Board through Settings selected in turn, the positions were `272,339,394,473,515`, `272,334,392,471,514`, `272,334,389,475,518`, `272,334,389,468,513`, and `272,334,389,468,510`. That is a movement of up to 8 pixels in a row that is meant to stay still.

Why it matters: This is visible every time the owner changes tabs. It is the kind of thing that makes an application feel unfinished.

Recommendation: Reserve the bold width for each tab with a hidden bold copy of its label, or use a medium weight with no width change.

#### TAB-3. Polish. The tab hover block has no padding.

Part or screen: Tab row.

What I see: The global button hover fill applies to tabs whose padding is 0 by 1 pixel in the workspace and 10 by 0 pixels on Home. The fill therefore touches the text.

Why it matters: It looks like a mistake on every hover.

Recommendation: Give tabs 8 pixels of side padding with a negative margin, or use a color change with no fill.

#### TAB-4. Should fix. The title above the tabs behaves differently on each tab.

Part or screen: Tab row and page title.

What I see: Chat shows the agent's name as the title. Team tasks shows "Tasks". Git and Terminal hide it. Chat keeps an 81 pixel header while its two sibling tools drop it.

Why it matters: Chat is the tab where height matters most, and it is the one that keeps the header.

Recommendation: Remove the title from Chat as `DESIGN.md` already does for Terminal and Git. Put the agent's name, role, and status on one line of 32 pixels above the thread.

### The composer

#### COMP-1. Should fix. The composer is five rows tall.

Part or screen: Composer.

What I see: The composer takes 159 pixels in Chat and 193 pixels in the lead panel. Status, the input, the tools, the worktree, and the recipient sit on separate rows. "To Sage" repeats the placeholder "Message Sage…". The branch repeats the top bar.

Why it matters: The composer costs up to a third of the lead panel's height. Cursor's composer is a single input with one tool row.

Recommendation: Use one input with one tool row beneath it, for a total of about 76 pixels. Put status above the composer only when something is waiting. Remove the recipient line and the worktree line.

#### COMP-2. Should fix. Enter inserts a newline and does not send.

Part or screen: Composer.

What I see: Typing "hello" and pressing Enter produces the value `hello\n`. Only Command or Control + Enter sends. A small hint appears at the bottom right of the composer.

Why it matters: Cursor, T3 Code, and nearly every chat product send on Enter. This owner will send to dozens of agents a day and will trip on this each time.

Recommendation: Send on Enter, and insert a newline on Shift + Enter. Offer the reverse as a setting if the owner wants it.

#### COMP-3. Should fix. The composer has no model, effort, or context controls.

Part or screen: Composer.

What I see: The composer offers Add context and a subscription picker labeled "Claude Code · Host profile". It has no model selector, no effort selector, no context meter, and no `@` mention for files or tasks. A search of the source found no such control anywhere.

Why it matters: Cursor shows these in the composer because the owner adjusts them per turn. A thread that nearly fills its context with no warning surprises the owner. See THREAD-7 for the case where the absence becomes a dead end.

Recommendation: Add model and effort selectors to the tool row, and show context use as a small percentage beside them. Let `@` open the same list as Add context. Replace "Host profile" with the subscription's own name.

#### COMP-4. Polish. Thread text clips against the composer in Chat.

Part or screen: Composer.

What I see: The Chat composer has no top rule, although the lead panel's composer has one. Thread text therefore runs directly into "Waiting on 3 answers".

Why it matters: It looks like overlapping content.

Recommendation: Use the same top rule in both places.

#### COMP-5. Should fix. A failed or stopped agent still invites a message.

Part or screen: Composer.

What I see: Ash's composer says "Message Ash…" with a dim Send button, although Ash failed to start and cannot receive anything. The same composer appears for stopped agents.

Why it matters: The owner may type a message and then have to work out why it cannot go.

Recommendation: Replace the input with the state and the remedy, such as "Ash failed to start" with an Open sign-in button and a Resume button. Keep the draft if one exists.

#### COMP-6. Polish. The subscription select leaves a gap before its chevron.

Part or screen: Composer.

What I see: The select has a fixed width, so a short name leaves a gap between the label and the chevron.

Why it matters: This is the only raw native control in the row, and it looks it.

Recommendation: Use a compact custom menu button that fits its label.

### Tables and rows

#### ROW-1. Should fix. Record rows break the 46 pixel rule.

Part or screen: Tables and rows.

What I see: `DESIGN.md` limits comparable records to 46 pixels. All projects rows are 57 pixels and Repository rows are 86 pixels. Team task rows are about 67 pixels. Request rows at 42, Subscriptions rows at 39 to 43, and Machines rows at 43 meet the rule.

Why it matters: All projects is the fleet overview, and it fits a third fewer rows than it should.

Recommendation: Bring all three to one line of at most 46 pixels. Move lead and branch into columns of their own.

### Buttons and controls

#### BTN-1. Should fix. A disabled filled button still looks like the main action.

Part or screen: Buttons.

What I see: Disabled Commit and Send keep a peach fill at reduced strength, with a contrast of 2.34 to 1 in Dusk and 2.88 to 1 in Field. Commit gives no reason for being disabled. Disabled outline buttons such as Pull and "Review merge to main" are 3.81 and 3.60 to 1 in Dusk, and 2.44 and 2.48 to 1 in Field.

Why it matters: The eye goes to the filled block as the next step. The owner then clicks it, and nothing happens, with no explanation.

Recommendation: Render disabled buttons as outlines with muted text. Show the reason beside the button, such as "Add a message and stage a file". Keep at least 3 to 1 for the disabled text.

#### BTN-2. Should fix. Control heights do not follow a scale.

Part or screen: Buttons and controls.

What I see: The primary button is 38 pixels. Search and filter selects are 32. The top bar picker and Fetch are 28. Clear filters is 23. Within one dialog form, the select is 40 and the input is 44.

Why it matters: Controls side by side visibly misalign, and a primary button of 38 pixels is too large for a working application.

Recommendation: Use two heights only: 28 pixels in dense places and 32 pixels elsewhere. Use the same height for an input, a select, and a button in one form.

#### BTN-3. Polish. Actions and links are mixed without a rule.

Part or screen: Buttons and controls.

What I see: "Resume agent" and "Stop agent" are links in the primary color. "Try again" is a secondary button as the only action on the page. "New project here" is a link, and "Connect machine" is a button.

Why it matters: A reader cannot tell which things change state and which things navigate.

Recommendation: Use links only for navigation, and buttons for anything that changes state.

### Dialogs

#### DLG-1. Should fix. Dialogs do not close in the same way.

Part or screen: Dialogs.

What I see: Only New project has a Cancel button. Merge review, Add subscription, Conflict, and others offer only the × in the corner beside their action.

Why it matters: On the merge dialog, the single large filled button is the most consequential action in the product, and backing out is a small × at the top of the dialog.

Recommendation: Use a Cancel button in every dialog, to the left of the action, and keep the × for consistency.

### Status and attention indicators

#### STATUS-1. Must fix. Failed and stopped agents wear the success color.

Part or screen: Status indicators.

What I see: Ash's "Failed to start" row in the sidebar has a dot of `rgb(179,209,179)`, which is the same green as a healthy agent, and plain text that is neither amber nor red. A stopped agent such as Iris has the same green dot. Needs-attention rows, by contrast, are amber.

Why it matters: The worst state in the product looks like the best one, and it looks calmer than an ordinary question.

Recommendation: Use the error color that the thread already uses, with a red dot and a red "Failed to start" label on the row. Show stopped agents with a hollow gray dot and the label "Stopped". Reserve green for running.

#### STATUS-2. Should fix. Failed start uses the same amber as a question.

Part or screen: Status indicators.

What I see: On Home, the kinds Question, Approval, and Failed start are the same amber text. On a phone, the kind column is hidden altogether, so a question and an approval cannot be told apart.

Why it matters: A failed start means that work has stopped, while a question means that one agent is waiting. They need different urgency.

Recommendation: Use red for Failed start. Keep amber for the other two. On a phone, keep the kind as a short word at the start of the row's second line.

#### STATUS-3. Should fix. One idea has three visual treatments.

Part or screen: Status indicators.

What I see: A permission request is a box at x=444, 800 wide, with a left amber rule. A decision request is a box at x=475, 637 wide, with a top rule. A failed start has a red left rule.

Why it matters: These are all "the agent needs you". Three shapes make the owner learn three things.

Recommendation: Use one request component with a left rule, the same width as the thread, and the rule's color and label set by kind.

### Typography and the type scale

#### TYPE-1. Should fix. The final font should be Inter with JetBrains Mono.

Part or screen: Typography.

What I see: The `system-ui` stack renders as a wide face here, and as a different face on every operating system. Wide letterforms cause the truncation seen in the sidebar and on Home's kinds, including "Merge appr…".

Why it matters: The golden mock should look the same for the owner on each machine. A narrower face also returns real width in a dense layout.

Recommendation: Self-host variable Inter with tabular numbers at a 13 pixel base, and JetBrains Mono for code and paths. A Latin subset of both should cost about 150 kilobytes, which is my estimate and has not been measured.

#### TYPE-2. Should fix. The type scale is defined and not used.

Part or screen: Typography.

What I see: The rendered page uses 12 font sizes (11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, and 30) and 6 weights (400, 450, 500, 550, 600, and 650). The `--scale-*` and `--space-*` tokens are defined in `tokens.css` and have no uses in `workbench.html`.

Why it matters: Adjacent sizes such as 17, 18, and 19 cannot be told apart, so they add noise and no hierarchy. Tokens that no rule reads will not protect the real build.

Recommendation: Use five sizes (11, 12, 13, 15, and 20) and three weights (400, 500, and 600). Apply the tokens, and fail a check when a raw size appears.

#### TYPE-3. Should fix. Page titles are the loudest thing on the page and the least useful.

Part or screen: Typography.

What I see: Page titles are 22 pixels and bold, while requests are 13 pixels. "Home" appears in the top bar, in the sidebar selection, and as a title of 22 pixels.

Why it matters: The eye is sent to a label the owner just clicked.

Recommendation: Remove repeated titles, as in WHOLE-1. Where one stays, use 15 pixels at weight 600.

### Spacing and alignment

#### SPACE-1. Should fix. The spacing has no visible grid, and the shape has too many radii.

Part or screen: Spacing and shape.

What I see: The source uses 12 border radii (0, 2, 3, 4, 5, 6, 7, 8, 9, 10, and 20 pixels, and 50 percent). The `--space-*` tokens are not applied.

Why it matters: Neighboring corners at 6, 7, and 8 pixels read as carelessness once noticed. The effect is mild alone and adds up across the application.

Recommendation: Use three radii (4 pixels for controls, 8 pixels for panels, and full for dots), and a 4 pixel spacing grid.

#### SPACE-2. Should fix. Content edges change between pages under the same tabs.

Part or screen: Spacing and alignment.

What I see: On Team tasks, the rows start at x=444 while the title and tabs start at x=272, a jump of 172 pixels. On the sprint page at 2560 pixels, the heading "Plan tasks" sits at y=287 and its Add task action sits lower, at y=295.

Why it matters: The eye loses the edge when changing tabs, which `DESIGN.md` tries to prevent. Only the conversation body is meant to be centered.

Recommendation: Start Team tasks at the tab row's left edge, as Board does. Align Add task to the heading's baseline.

### Color use in both modes

Field and Dusk hold up. Body, muted, and amber text all pass contrast: muted is 7.34 to 1 in Dusk and 5.21 to 1 in Field, and amber is 10.27 to 1 in Dusk and 5.79 to 1 in Field. The diff tints are readable in both modes. Parity between modes is good.

#### COLOR-1. Should fix. The primary peach is doing four jobs.

Part or screen: Color use.

What I see: Peach marks primary buttons, links, the toast, and the Stop agent link. Amber marks everything that needs attention, while also marking the Modified letter in Git and the Alerts count.

Why it matters: A destructive action wearing the same color as a harmless link defeats the color's meaning.

Recommendation: Keep peach for one primary action per view, and for links in body text. Render Stop in a neutral outline. Give the Modified letter the muted color, and keep amber for attention alone.

#### COLOR-2. Polish. The toast looks like a button.

Part or screen: Toast.

What I see: The toast is a solid peach block at the bottom center of the window, and it covers the composer's tools. In the capture of the failed large item, it hides the subscription picker and the branch.

Why it matters: The filled primary color says "press me", and its position covers controls in use.

Recommendation: Use a raised neutral surface at the top right, below the bell.

### Icons

#### ICON-1. Polish. Icons mix drawn vectors with text characters.

Part or screen: Icons.

What I see: Scalable Vector Graphics (SVG) icons sit beside text glyphs: × in 15 places, ←, →, ↗, ⌘, ✓, and a fullwidth ＋. On Linux, the ⌘ K hint is shown where Control + K is the real shortcut. The Alerts paper plane says "send", and the bell is what actually counts things needing the owner.

Why it matters: Text glyphs change with the font and do not align to the icon grid.

Recommendation: Use one SVG icon set, such as Lucide, throughout. Show the shortcut for the operating system in use. Use a phone icon for phone notifications.

### Motion

#### MOTION-1. Polish. The application has one transition and no feedback for change.

Part or screen: Motion, judged from the source.

What I see: The source has exactly one transition, which is `transform var(--motion-fast)`, and no keyframes. Rows expand instantly. New messages and resolved requests appear and vanish at once.

Why it matters: Answering a request removes its row with no sign of where it went. Motion here would explain, not decorate.

Recommendation: Animate row expansion and row removal at 120 milliseconds, and honor the reduced motion setting. Add nothing else.

### Hover and focus

The focus ring holds up on rows: 2 pixels of solid primary color with a 3 pixel offset, plainly visible in both modes.

#### FOCUS-1. Polish. The focus ring is clipped on tree disclosures.

Part or screen: Hover and focus.

What I see: On the lgtm repository disclosure, the left side of the ring is cut off by the edge of the tree's scrolling area.

Why it matters: A keyboard user sees a broken ring. The disclosure is only 23 by 30 pixels, and the add button is only 25 by 26.

Recommendation: Add 4 pixels of padding to the tree's scrolling area. Alternatively, use an inner ring on tree rows.

### Empty states

#### EMPTY-1. Should fix. Empty states explain the product rather than say what to do.

Part or screen: Empty states.

What I see: The truly empty queue is wrong (see HOME-1). The bell's empty state still offers "View all attention". The completion evidence area on a sprint reads like instructions.

Why it matters: "Nothing needs you" is the best thing the owner can hear, and the mock has no form of that sentence.

Recommendation: Use one short sentence and at most one action in every empty state, and never offer a list that is empty.

### Discoverability

Discoverability is good on the Git toggles: "This file", "All files", "Unified", and "Split" are all visible, which is the right lesson from T3 Code.

#### DISC-1. Should fix. Essential actions do not exist, so they cannot be discovered.

Part or screen: Discoverability.

What I see: A search of the source and every screen found no Stage all, no Discard, no way to close or rename a terminal session, no project archive or delete, no way to rename or remove a machine, and no Remove on a subscription. No test notification can be sent.

Why it matters: These are the daily actions of a Git user and of a person who runs many projects. Project sprawl has no exit.

Recommendation: Add each action at the point of use: Stage all and Discard on the Changes header, × on terminal tabs, and Archive in Project settings. Add Remove in a row menu on Machines and Subscriptions.

#### DISC-2. Polish. The sidebar and lead panel resize handles are invisible at rest.

Part or screen: Discoverability.

What I see: The screenshots show only the 1 pixel border where the handles sit. `DESIGN.md` says that they exist, with keyboard support.

Why it matters: The owner was bothered by exactly this in T3 Code.

Recommendation: Show a small grip on hover over a wider 8 pixel target, and use the resize cursor.

## Part 4. Each screen, in the order of the list

### Screen 1. Login, logged out

This screen is clean and holds up. Its problems are small.

#### LOGIN-1. Should fix. The login form blocks password managers.

Part or screen: Login.

What I see: The password field is set to `autocomplete="off"`.

Why it matters: This is about usability and not about the settled login design. The owner has one long password from an environment variable and should not have to type it by hand on a phone.

Recommendation: Set `autocomplete="current-password"` on the field.

#### LOGIN-2. Polish. The login greets a first visitor as a returning one.

Part or screen: Login.

What I see: The heading says "Back to your workspace" on a first visit too. The page also has no logo mark of any weight.

Why it matters: It is a small wrong note on the first screen the owner ever sees.

Recommendation: Use "Sign in to LGTM Studio" with the logo mark above it.

### Screen 2. Login, session expired

The state is plainly worded, and it holds up apart from LOGIN-3.

### Screen 3. Login, rejected password

#### LOGIN-3. Polish. Login messages have no hierarchy of severity.

Part or screen: Login.

What I see: The rejected password message uses the body color, and the expired message uses the same style.

Why it matters: A rejection can be missed on a quiet page, because nothing in it looks like an error.

Recommendation: Use the error color for rejection and the muted color for expiry. Place both directly under the password field.

### Screen 4. Login, session service unavailable

#### LOGIN-4. Polish. The only action on the unavailable page is a secondary button.

Part or screen: Login.

What I see: "Try again" is a secondary button, although it is the only thing to do. The wording of the state itself is fine.

Why it matters: The page has no focal point.

Recommendation: Make "Try again" the primary button.

### Screen 5. Connecting banner

#### CONN-1. Should fix. The connection banner moves the page and hides Allow and Deny.

Part or screen: Connecting and Reconnecting banners.

What I see: The banner pushes the layout down by 41 pixels. In a thread, the Allow and Deny buttons move under the clip line of the composer.

Why it matters: Controls that move while the owner reaches for them are how the wrong button gets pressed. During a reconnect, this is also when the owner is watching most closely.

Recommendation: Do not insert the banner into the layout. Put the connection state in the top bar's Live indicator, as an amber "Reconnecting" with a retry action, and disable mutations in place.

### Screen 6. Reconnecting banner

#### CONN-2. Should fix. The banner does not say how stale the page is.

Part or screen: Reconnecting banner.

What I see: The banner has no last-updated time and no escalation with time. The bell keeps its count, which may be out of date, with no marking.

Why it matters: The owner cannot tell if the 4 requests are current. After several minutes offline, the page looks the same as after several seconds.

Recommendation: Add "Last updated 2 minutes ago", and mark the bell count as stale by rendering it in the muted color.

#### CONN-3. Polish. "Try reconnecting" is styled as navigation.

Part or screen: Reconnecting banner.

What I see: The action reads "Try reconnecting →", with an arrow that implies leaving the page, in amber text with no surface behind it.

Why it matters: The arrow misdescribes the action.

Recommendation: Use a small button labeled "Reconnect now", with no arrow.

### Screen 7. Offline state

#### CONN-4. Should fix. No offline state exists.

Part or screen: Offline state, not reached because it does not exist.

What I see: The mock has Connecting and Reconnecting and no state for a long loss of connection. The word Offline appears only as a machine status.

Why it matters: An owner on a phone in a train will spend real time in this state. A golden mock without it will get an accidental design in the build.

Recommendation: After 30 seconds of failed reconnects, change the indicator to "Offline" with the last-updated time. Keep all data readable and disable all actions with a tooltip that gives the reason.

### Screen 8. Home, Needs attention tab

#### HOME-3. Should fix. Requests are sorted by kind, so the oldest are not first.

Part or screen: Home, Needs attention.

What I see: Questions come first, then approvals, then failures. Questions are aged 18 minutes, 1 hour 12, 3 hours 40, and 2 days in the heavy sample, with the oldest last. Approvals are aged 6, 2, 27, 9, and 51 minutes, in no order. A failed start is always last. Age has no emphasis.

Why it matters: A request waiting for 2 days sits at the bottom of its group, and a failed start, which stops all work, sits below everything.

Recommendation: Sort by failed starts first, then by oldest wait. Add a Sort menu with Oldest and Newest. Render waits of over one hour in amber.

#### HOME-4. Should fix. The filter band is larger than the list it filters.

Part or screen: Home, filters.

What I see: The band holds a search field, five labeled selects, and Clear filters, in 51 pixels plus a count line. It sits above a list of about 4 rows. At 390 pixels it takes about 200 pixels. Clear filters remains visible when no filter is set.

Why it matters: The band pushes the first request to 30 percent of the window height. The owner rarely filters a list this short.

Recommendation: Show a search field and one Filter button that opens a popover. Show active filters as removable chips. Show Clear only when a filter is active.

#### HOME-5. Should fix. A request's row title hides the actual action.

Part or screen: Home, Needs attention and Approvals.

What I see: The approval row says "Run the web tests", which the agent wrote. The real command, `pnpm --filter @lgtm/web test`, is visible only after expanding it.

Why it matters: A title written by the agent is a claim, not a fact. An owner scanning approvals should see what will actually run.

Recommendation: Show the first 60 characters of the command in monospace in the row, after the title.

### Screen 9. Home, All projects tab

This table is the right idea. Its row height breaks the rule in ROW-1, and on a phone its Status column clips to "Needs a". See PHONE-3.

### Screen 10. Home, Questions tab

#### HOME-6. Should fix. Tab counts include answered items.

Part or screen: Home, Questions and Approvals.

What I see: After every item is answered, the tabs still say Questions 1 and Approvals 2, while the bell says 0. Answered rows show "Answered" and not Allowed or Denied.

Why it matters: A count on a tab is read as work to do, so the owner goes to look and finds nothing. An approval's result is also the one fact worth keeping.

Recommendation: Count only open items on the tabs. Show answered items under a collapsed "Answered" section. Show Allowed or Denied with the time.

### Screen 11. Home, Approvals tab

The tab is correct apart from HOME-5, HOME-6, and HOME-9.

### Screen 12. Home, expanded question

#### HOME-7. Should fix. The expanded row repeats its own row.

Part or screen: Home, expanded rows.

What I see: The expanded panel repeats the agent, project, and title that are on the row directly above it. An × in its corner duplicates the row's chevron. `DESIGN.md` says that expanded rows do not repeat their own title.

Why it matters: The repetition costs about 100 pixels of height on the one screen where the owner answers many things quickly.

Recommendation: Start the panel with the question's body. Remove the header and the ×.

### Screen 13. Home, expanded approval

#### HOME-8. Should fix. Approvals show engine vocabulary and raw data.

Part or screen: Home, expanded approval, and the thread permission.

What I see: The panel says "Request: perm-iris · Tool: execute · Call: call-iris" above raw JavaScript Object Notation (JSON). The JSON has two fields, `command` and `cwd`.

Why it matters: The owner needs only to know what will run and where, and those two facts are buried in syntax. Identifiers such as `call-iris` have no use at this moment.

Recommendation: Show "Command" and "Folder" as two labeled monospace lines. Put identifiers and the raw JSON under a "Details" disclosure.

### Screen 14. Home, expanded approval with hidden input

#### PERM-1. Must fix. A blind approval looks the same as an informed one.

Part or screen: Home, expanded approval, and Finch's thread.

What I see: Finch's request says "The action's input is not visible. Part of the action's input is hidden because redaction changed it." The two sentences contradict each other about whether part or all of it is hidden. The same peach "Allow once" sits beneath it, in the same position as for a request whose command is visible.

Why it matters: The owner approves many requests a day and will build a habit of pressing the same button in the same place. This is the one approval where the habit is dangerous.

Recommendation: Say what is known and what is not, such as "Finch wants to run the read tool. LGTM Studio cannot show its input." Make both buttons secondary. Label the approval "Allow without seeing input".

### Screen 15. Home, expanded failed start

#### HOME-2. Must fix. A failed start has no action, and its remedy dead-ends.

Part or screen: Home, failed start, and Ash's thread.

What I see: The expanded row has only navigation links. Its remedy says to sign in to Codex on Buildbox, and the thread says "the assigned host" without naming it. Subscriptions lists Codex only on Studio, so no row exists where the owner can follow the remedy. Failed starts also cannot be cleared from Home.

Why it matters: This is a request for action with no way to act. The owner must work out the path alone, on the state that most needs a short path.

Recommendation: Give the row two buttons, "Sign in on Buildbox" and "Resume". The first should open the sign-in dialog with the machine and harness already filled in, and create the subscription if none exists. Name the machine in the thread as well.

### Screen 16. Home, expanded merge approval and its dialog

#### MERGE-1. Must fix. The merge to main is approved without evidence.

Part or screen: Merge dialog, reached from Home and Git.

What I see: The dialog "Review merge to main" shows `feat/workspace → main`, the text "1 commits ready for review", and one bullet, "Ready for owner review". It has one large filled button, "Approve merge to main". It has no file list, no line counts, no test or review result, no diff link, and no Cancel. The Home row behind it shows more, because it lists the files and has "Review in Git".

Why it matters: This is the owner's most consequential action, and the rule of the project is that merges into the base branch require the owner's approval. A review with no evidence teaches the owner to press the button unread.

Recommendation: Replace the dialog with a full review view that reuses Git's diff pane. Above it, show commits, files changed with added and removed line counts, test results, and the review agent's verdict with a link to the review thread. Offer Approve and Cancel, with Approve disabled until the evidence has loaded.

#### MERGE-2. Should fix. "1 commits" and "1 changed files" are wrong.

Part or screen: Merge dialog, Home, Git, and the branch picker.

What I see: The source builds `${pending} commits ready for review` and `files.length+' changed files'`, and both appear as "1 commits" and "1 changed files" on screen.

Why it matters: A plural error in the most serious dialog of the product makes everything around it feel unchecked.

Recommendation: Use one pluralizing helper for all counts.

#### HOME-9. Should fix. The merge row has a truncated kind and no wait time.

Part or screen: Home, Approvals.

What I see: The kind reads "Merge appr…", and the age column says "Open" in place of a time. `DESIGN.md` says requests state how long they have waited.

Why it matters: The most important row is the one with the least legible label and no age.

Recommendation: Use the kind "Merge", and show the wait time as on every other row.

### Screen 17. Home, filters that match nothing

This state holds up. "No matching requests" with a Clear filters action is correct here.

### Screen 18. Home, truly empty queue

#### HOME-1. Must fix. The empty queue says that filters are hiding things.

Part or screen: Home, empty queue.

What I see: With no filter set and nothing waiting, the page says "No matching requests. Clear the filters to see requests across all projects."

Why it matters: This is false, and it is the state the owner works toward all day. It sends the owner off to clear filters that are not set, with the doubt that something may be hidden.

Recommendation: Show "Nothing needs you" with one line about what is running, such as "12 agents are working across 4 projects", linked to All projects. Keep the current text for filtered results only.

### Screen 19. Bell popover

#### BELL-1. Should fix. The bell is a slower copy of Home.

Part or screen: Bell popover.

What I see: Each entry is 95 pixels tall, with no age. The order differs from Home. With 10 items, the popover is 630 pixels tall. It uses Decision and Permission where Home says Question and Approval. On an empty queue, it still offers "View all attention".

Why it matters: A popover should be a quick glance. It shows less than Home and takes more space per item.

Recommendation: Use Home's sort and kinds, in rows of 44 pixels with the age. Show at most 6 rows and a "View all 10" link. Hide the link when the queue is empty.

### Screen 20. Quick switcher

#### QUICK-1. Should fix. The quick switcher ranks the wrong result first.

Part or screen: Quick switcher.

What I see: Typing "ro" lists Agent console first and Rowan second, because matching includes the kind label and "Project" contains "ro". Rows are 64 pixels tall, and a dialog header takes 60 pixels. Rows show no attention state.

Why it matters: This control is used by muscle memory, so Enter opens the wrong thing. Cursor's equivalent ranks prefix matches on names.

Recommendation: Match names only, with prefix matches ranked first. Use rows of 36 pixels with an attention count. Remove the header and the ×, and let Escape close it.

### Screen 21. Sidebar

See SIDE-1 through SIDE-6.

#### SIDE-6. Should fix. The selected row can sit under the footer's fade.

Part or screen: Sidebar.

What I see: Opening Ash leaves Ash's row half hidden under the fade at the bottom of the tree, at y=667, while it is the selected row.

Why it matters: The owner just went to the failed agent, and the sidebar does not show it. The fade also dims the row's status.

Recommendation: Scroll the selected row into view after every navigation, with 8 pixels of margin above the fade.

### Screen 22. Only projects needing you

The filter works and holds up, and its result will be right once SIDE-1 fixes the rollup. It also correctly keeps Agent recovery, which is how I found the disagreement with the missing dot.

### Screen 23. Repository page

#### REPO-1. Should fix. The repository page is a sparser copy of All projects.

Part or screen: Repository page.

What I see: Rows are 86 pixels tall. Filler copy appears twice, as "One lead per project" and "Each has its own lead…". A project with a failed agent says "Next step: Work in progress".

Why it matters: The same records have a second layout, and it shows less per row. The "Next step" line claims that all is well on a project that is not.

Recommendation: Reuse the All projects table with the repository filter applied. Delete the filler. Replace "Next step" with the same attention label as All projects.

#### REPO-2. Polish. The selected repository's pill is too tight.

Part or screen: Sidebar and repository page.

What I see: The selected repository label gets a highlight only 14 pixels tall, tight around its text.

Why it matters: It does not match the row selection anywhere else.

Recommendation: Use the same selection fill as a project row.

### Screen 24. Board with the lead panel open

#### BOARD-1. Should fix. Cards emphasize prose over state.

Part or screen: Board.

What I see: The card's description has the largest block of text, while its status and owner are small and low on the card. "Needs your decision" is a small amber line, and the card has no other emphasis. In some columns, a card shows "0/1 tasks" with an empty bar.

Why it matters: A board is read in a glance for what is stuck and who holds it. The owner has to read each card to learn that.

Recommendation: Put the identifier, the title, the owner, and the progress on the card. Limit the description to one line. Give a card that needs attention an amber left rule, and put its needs-attention line first.

#### BOARD-2. Should fix. The lead panel has too many redundant routes.

Part or screen: Board.

What I see: The same conversation is reached through the lead panel, the lead toggle, the Chat tab, and an ↗ button. The panel also has an ×. The ↗ button has no label, and the empty board adds "Talk to Nico" while Nico's panel is already open beside it.

Why it matters: Five routes to one place suggest that they lead to different places. The unlabeled ↗ is the hidden affordance that the owner disliked in T3 Code.

Recommendation: Remove the ↗ button, because the Chat tab does the same thing. Keep the toggle as the single open and close control. Hide the × when the toggle is visible.

#### BOARD-3. Polish. The column dots carry no meaning.

Part or screen: Board.

What I see: Every column heading has a small dot, and the dots do not encode anything that the word beside them does not.

Why it matters: A dot means status everywhere else in the product.

Recommendation: Remove the dots.

The default sample and the heavy sample both leave the board lightly filled, so I could not judge it under load.

### Screen 25. Board with the lead panel closed

This state holds up. Four columns fit, and closing the panel gives real width to the board.

### Screen 26. Board with the lead panel as a drawer

The drawer holds up at 900 pixels: it is 420 pixels wide, it dims the board, and it makes the board inert. At 390 pixels, see PHONE-2.

### Screen 27. Empty board, Desktop companion

This is a good empty state, with one sentence and one action. BOARD-2 covers the redundant "Talk to Nico".

#### BOARD-4. Should fix. Stop agent is offered on an idle lead.

Part or screen: Empty board and every thread.

What I see: Nico has "Ready for your direction" and "No teams started", and the composer still shows "Stop agent".

Why it matters: With nothing running, Stop is one more way to break things and adds noise to a clean state.

Recommendation: Show Stop only while the agent is working or waiting on a tool.

### Screen 28. Sprint page

#### SPRINT-1. Should fix. The sprint page hides its status and its blocker.

Part or screen: Sprint page.

What I see: The page shows "SP-02 · Build", with no sprint status anywhere. The decision is below the tasks under "Needs your direction" and cannot be answered there. SH-15 says "In progress", although Home says that a pending approval blocks it. "Plan: Agent console / SP-02" adds nothing. At 2560 pixels, the content stops about 1400 pixels from the left edge, leaving the rest empty.

Why it matters: A sprint page exists to answer "is it moving, and what is stopping it?"

Recommendation: Put status and blockers at the top of the page, and allow an inline answer as on Home. Mark blocked tasks as "Blocked by an approval". Remove the Plan line.

Add task sits lower than its heading, at y=295 against y=287 at 2560 pixels. SPACE-2 covers this.

### Screen 29. Task page

#### TASK-1. Should fix. The task's main action is below the fold.

Part or screen: Task page.

What I see: The primary "Talk to Iris" button sits at about y=875 on a 900 pixel window. The metadata repeats the subtitle. A folder path breaks in the middle of a word, as ".worktre" and "es". The owner is not a link, although the sprint's owner is. Activity has no timestamps.

Why it matters: The owner comes to a task to act on it or to see what happened. The one action is nearly off screen, and the history cannot be dated.

Recommendation: Move the action to the top right of the page. Add timestamps to activity. Link the owner. Truncate paths from the start in monospace, with the full path on hover.

### Screen 30. Add Task dialog

This dialog holds up. It has the Cancel gap in DLG-1 and the mismatched heights in BTN-2.

### Screen 31. Lead in full chat

The heavy lead chat, with its collapsed activity, is the closest thing in the mock to Cursor, and it holds up.

#### THREAD-2. Must fix. The newest request can be hidden when a thread opens or returns.

Part or screen: Lead panel, Chat tab, and thread view.

What I see: The lead panel opens with a scroll top of 80, a client height of 597, and a scroll height of 711, so it stops 34 pixels short of the end and clips the Finch request. Closing and reopening the panel resets the scroll to 0 in both the panel and the Chat tab, so the newest requests are hidden on return. `DESIGN.md` says that threads open at the latest message.

Why it matters: A hidden request is one the owner does not answer. The owner has no signal that newer content lies below.

Recommendation: Open at the true end when no saved position exists. Save and restore the position when the panel closes. Show a "Latest" button with a count of unread items whenever the view is not at the end.

### Screen 32. Team chat

The team chat holds up, apart from the shared findings on the composer and the phone avatars in PHONE-1.

### Screen 33. Team tasks

#### TEAMTASKS-1. Should fix. Team tasks use the chat frame and two-line rows.

Part or screen: Team tasks.

What I see: The rows start at x=444, centered like a conversation, while the title and the tabs start at x=272. Rows are about 67 pixels tall, on two lines. A dot, a sentence, and a status line all say the same thing.

Why it matters: A task list is a table, and a table should use the same frame as Board and All projects. The extra height limits how many tasks fit.

Recommendation: Use the wide frame and one-line rows of at most 46 pixels, with columns for identifier, title, status, and owner.

### Screen 34. Iris, with permission, tool call, large item, and delivery history

#### THREAD-3. Should fix. The thread shows engine vocabulary at conversation weight.

Part or screen: Iris's thread.

What I see: "Large thread item · 192,000 bytes · Review trace · Item 184" and "Delivery history · delivery-iris" sit in the thread at the same type size as the messages. The tool call and the permission below it show the same command twice.

Why it matters: A thread is read for what the agent did and needs. Delivery plumbing competes with those at the same volume.

Recommendation: Show delivery only when something failed. Render it otherwise in a Details disclosure in the muted color at 12 pixels. Name the large item by its content, such as "Review trace (192 kilobytes)". Join a tool call and its permission into one block.

#### THREAD-4. Should fix. A loaded large item is a small nested scroller.

Part or screen: Iris's thread.

What I see: The loaded item shows 12 lines in its own scroller inside the thread. It has no search, no copy, and no way to open it in full.

Why it matters: A person who loads a 192 kilobyte trace wants to read it. Twelve lines at a time is not reading.

Recommendation: Add Copy and Open in full, where Open in full fills the main area. Enable the browser's find by rendering the text in a plain block.

### Screen 35. Rowan, with a decision

This is the best request in the product, because it states the question, gives a recommendation with a reason, and offers one obvious action. Use it as the pattern in STATUS-3.

One small mismatch: the request says "SP-02" while the composer says "SH-17". Name the same thing in both.

### Screen 36. Finch, with redacted input

See PERM-1.

#### THREAD-1. Must fix. The status line contradicts the state of the thread.

Part or screen: Finch's and Iris's threads.

What I see: Finch's thread says "Reviewing · No owner action needed" directly above that agent's permission request. Iris's says "Working on SH-15" above Iris's request. The composer below says "Waiting for permission". Three lines disagree on one screen.

Why it matters: "No owner action needed" is the one sentence that sends the owner away. It sits next to a waiting request, where the owner has to choose which one to believe.

Recommendation: Remove the message-level status once a request is pending, and show one status per thread, in one place. When a request is open, that status is the request.

### Screen 37. Ash, failed start

The state is correctly red in the thread. See HOME-2 for the path, COMP-5 for the composer, and STATUS-1 for the sidebar. The composer's status line uses an amber dot, while the heading above it is red, which should match. "Resume starts a new session and loses its previous context" is useful, and it should stay.

### Screen 38. Stopped agent with Resume

#### PERM-2. Must fix. A cancelled request says that an answer was recorded.

Part or screen: Stopped agent's thread.

What I see: Iris's permission now reads "Cancelled because the agent stopped · Answer recorded for Iris. This request is closed." It is in the success green. No one answered.

Why it matters: The record of what the owner approved must be exact. A later reader would believe that an answer exists.

Recommendation: Use "Cancelled because Iris stopped. No answer was sent." in the muted color.

#### STOP-1. Must fix. Stop agent is a one-click link that silently cancels permissions.

Part or screen: Composer and thread status line.

What I see: "Stop agent" is a plain link in the primary color beside the status, with no confirmation. Pressing it stops the agent and cancels its pending permission, and the bell drops from 4 to 3 with no message.

Why it matters: It looks like a harmless navigation link, it sits close to the input, and it discards work in progress.

Recommendation: Render it as a neutral button. Ask for confirmation when the agent has pending requests or running work, and name them, such as "Stop Iris and cancel 1 permission request?" Offer an Undo where the engine allows it.

#### THREAD-5. Should fix. A stopped agent's Resume has too little weight, and its row hides waiting questions.

Part or screen: Stopped agent's thread and sidebar.

What I see: "Resume agent" is a link rather than a button, while it is the main action on the page. The thread's framing does not otherwise change. Rowan's sidebar row says only "Stopped" in amber, although Rowan's question is still open and answerable.

Why it matters: The owner must not miss that a stopped agent still needs a response, and "Stopped" alone does not say that.

Recommendation: Make Resume a primary button that replaces the composer's input, as in COMP-5. Show "Stopped · Needs answer" on a row that has both states.

### Screen 39. Thread failure states

#### THREAD-6. Should fix. Failure messages name remedies that have no controls.

Part or screen: Unconfirmed answer and held request.

What I see: The unconfirmed answer says "Reopen the thread" with no control to do so, and the message is clipped against the status line in the capture. "This request is held elsewhere" does not name the holder, although the data has it, which is the lead. In that state, the sidebar says Reviewing while the composer says Waiting. A failed large item reads "Could not load this item. Try again." with "Load full item →" as the retry.

Why it matters: An owner reading a failure message needs the next step to be in reach. Each of these sends them hunting.

Recommendation: Add a "Refresh this request" button. Say "Held by Sage, the project lead", with a link. Use a "Retry" button for the large item, with no arrow.

#### THREAD-7. Must fix. The refused-model failure tells the owner to use a control that does not exist.

Part or screen: Failed start with a refused model.

What I see: The copy says "Adapter refused the model. Set the model and effort separately". No screen in the mock has a model or effort control. The same text appears in the heading and in the composer status. It also says "assigned host" instead of Buildbox, and "Adapter" is an engine word.

Why it matters: The owner is stopped with no path forward. The instruction cannot be followed anywhere in the product.

Recommendation: Add the controls from COMP-3, and link to them from the message. Reword it as "Codex rejected this model on Buildbox. Choose another model", with the selector placed right there. Show the message only once.

### Screen 40. Terminal, normal

The Terminal concept holds up and is the closest screen to right. The prompt sits in the grid, with no input box, as `DESIGN.md` asks.

#### TERM-1. Should fix. A terminal session cannot be closed or renamed.

Part or screen: Terminal.

What I see: The plus button starts another session, and nothing closes or renames one.

Why it matters: Sessions accumulate with no way to clean up.

Recommendation: Add an × on hover on each session tab and rename on double click. Show the × all the time on a phone.

### Screen 41. Terminal, vim

#### TERM-2. Polish. The vim view misaligns its status bar.

Part or screen: Terminal, vim.

What I see: The vim status bar starts at x=258, while output starts at x=272, and it leaves a gap of 22 pixels at the bottom. Vim rows are about 19.5 pixels here, against the 34.7 pixels of the same app's diff.

Why it matters: A grid must look like a grid. The vim row height also proves that the diff can be much denser.

Recommendation: Align the bar to the grid and extend the grid to the window's bottom.

### Screen 42. Terminal, multiple sessions

This state holds up, apart from TERM-1. At 390 pixels, the session names are readable.

### Screen 43. Terminal, paused when reconnecting

#### TERM-3. Should fix. The reconnect notice changes the terminal's size.

Part or screen: Terminal, reconnecting.

What I see: The notice is inserted into the grid area and changes the row count from 38 to 36.

Why it matters: A change of terminal size redraws a full-screen program such as vim during a network problem, which is the worst moment for it.

Recommendation: Overlay the notice on the top bar, and keep the grid size unchanged.

#### TERM-4. Should fix. The phone terminal has no special keys.

Part or screen: Terminal at 390 pixels.

What I see: The prompt wraps in the middle of a word. There is no row of Escape, Control, Tab, and arrow keys.

Why it matters: Vim cannot be left on a phone keyboard with no Escape key, and `DESIGN.md` explicitly wants the page to host such programs.

Recommendation: Add a row of special keys above the phone keyboard. Wrap the prompt only at the column limit, as a terminal does.

### Screen 44. Git, one file

The Git layout is the right idea and matches the Visual Studio Code model. Its density is the problem.

#### GIT-2. Should fix. The diff is too sparse and too narrow.

Part or screen: Git.

What I see: Diff rows are 34.7 pixels tall, from 13 pixel text with a line height of 24.7 and 5 pixels of padding on each side. About 21 rows fit on a screen. The panes are 216, 280, and 696 pixels wide, so the diff text gets 656 pixels at 1440, and only 316 pixels at 1100. Vim rows in this same application are about 19.5 pixels.

Why it matters: Reviewing code is what this screen is for. Visual Studio Code shows nearly twice as many lines in the same height.

Recommendation: Use rows of 20 pixels with no row padding. Make Worktrees collapse to a 40 pixel rail, and collapse it by default when the window is under 1600 pixels wide. Allow the Commit pane to resize.

#### GIT-3. Should fix. Git lacks everyday actions and hides its sync controls low in the pane.

Part or screen: Git.

What I see: There is no Stage all and no Discard. Sync and Integrate sit below the file list and will scroll out of view when many files change. The "2" in the Worktrees list has no label. "Working tree" is a link that reads as status. The worktree list shows no machine. At 1100 pixels, the History section's top border shows as a stray partial curve. The heavy sample still has only 2 files, so the long-list case is not shown.

Why it matters: Stage all and Discard are the two most-used Git actions after Commit. A real change touches more than 2 files.

Recommendation: Add Stage all and Discard to the Changes header. Pin sync to the top of the pane, in the header. Pin Integrate at the bottom of the pane. Show the machine beside each worktree, and label the count, such as "2 changes".

### Screen 45. Git, all files

This state holds up. The sticky file names work, and it inherits GIT-2.

### Screen 46. Git, split diff

#### GIT-1. Must fix. The split diff lines up the wrong lines.

Part or screen: Git, split diff.

What I see: At y=448, the left side shows line 60 `const thread` and the right side shows line 60 `const position`. At y=483, the left shows a blank line 61 and the right shows line 61 `const thread`. At y=518, the left shows line 62 `useEffect` and the right shows a blank line 62. There are no filler rows, so matching lines do not sit side by side. The columns are 327 pixels wide with scroll widths of 637 and 661, and scrolling one does not scroll the other (left at 100, right at 0).

Why it matters: A split diff exists to compare lines across the two sides. This one puts different statements side by side, which can make a reviewer accept the wrong change.

Recommendation: Align with filler rows, as Visual Studio Code does. Use one scroller for both sides. Offer Split only when each side can show at least 80 columns, and otherwise fall back to Unified with a short note.

### Screen 47. Git, history, staged, and committed

These states hold up. Selecting a commit opens its diff in the same pane, which is right.

### Screen 48. Git, conflict and its dialog

#### CONFLICT-1. Should fix. Conflict resolution offers two lines and a whole-file choice.

Part or screen: Git, conflict dialog.

What I see: The dialog shows two one-line snippets with no surrounding code and no surface behind the `pre` blocks. The choice applies to the whole file. It has no Cancel.

Why it matters: A real conflict cannot be judged from one line. Whole-file choices will throw away the other side's work.

Recommendation: Open the conflict in the diff pane with a choice per hunk (Ours, Theirs, or Both) and the base visible. Add Open in Terminal for hard cases.

#### CONFLICT-2. Should fix. A conflict is barely marked.

Part or screen: Git, conflict.

What I see: The file's "!" mark is tiny, and the diff shows no conflict markers. The worktree row shows no conflict. The integrate message cites the destination branch and not the conflict.

Why it matters: A conflict blocks integration. It should be the loudest thing in the pane.

Recommendation: Add a "Conflicts" section above Changes with a count. Mark the worktree row. Have the integrate message say "Resolve 1 conflict in this file first", with a link.

### Screen 49. Git, merge and its review

See MERGE-1 for the review. The team-to-project merge flow itself holds up, and blocking on dirty worktrees is the right behavior. Its message states the reason, which is good.

### Screen 50. Git, team worktree

This state holds up. Team worktrees show the end of the branch name, as `DESIGN.md` asks.

### Screen 51. Project settings

#### PSET-1. Should fix. Project settings has one real setting and no lifecycle actions.

Part or screen: Project settings.

What I see: The page has one real setting, the shell, with a large primary Save button. Read-only facts look like editable fields. There is no link to placement, no rename, no archive, and no delete. Filler sentences appear twice.

Why it matters: A person with many projects needs a way to end a project. Read-only values shown as fields invite useless clicks.

Recommendation: Show facts as a plain label-and-value list. Add a Machine row linked to placement. Add Rename and Archive, with Archive confirmed in a dialog. Save the shell on change.

### Screen 52. Branch picker

#### PICKER-1. Should fix. The branch picker is a long, unsorted, ambiguous list.

Part or screen: Branch picker.

What I see: "main" is listed twice with no machine label. Items take three lines each, and the popover reaches 780 pixels tall. It is not grouped, unlike Git's list of worktrees, and it needs a footer to explain itself.

Why it matters: Two identical rows force a guess about which one is right. A footer that explains the concept suggests the concept needs a clearer name.

Recommendation: Group by project, with teams indented, as in Git. Use one line per item of 32 pixels, with the machine at the right. Add a search field at the top. Remove the footer, and label the control "Inspecting".

### Screen 53. Alerts

#### ALERT-1. Should fix. The name and icon of Alerts collide with the bell.

Part or screen: Alerts, sidebar.

What I see: The page is called Alerts and has a paper plane icon, while the bell is called Needs attention. A first reader expects alerts behind the bell.

Why it matters: Two nearby words mean nearly the same thing and refer to different things.

Recommendation: Rename the page "Phone notifications" with a phone icon, and update the names table in `DESIGN.md`.

#### ALERT-2. Should fix. The Alerts table cannot be used to diagnose a failure.

Part or screen: Alerts.

What I see: The table has no time column. Subjects are raw identifiers such as `perm-iris` and `nav-decision`, and kinds are lowercase. "Still failing · Attempt 3" is plain text while "Failed · Attempt 1" is amber. The badge says "1 failed" when two failing items are shown. State says "Open" on every row. No action retries a delivery or fixes the token. At 390 pixels, the Delivery column clips.

Why it matters: The page exists to answer "are my phone notifications working, and if not, what do I do?"

Recommendation: Add a Time column. Replace the Subject with the agent's and project's names. Make all failures the same color. Make the badge count match. Remove State. Add "Retry" per row and "Fix in Service settings" when the token is missing.

### Screen 54. Machines as master

#### MACH-1. Must fix. Changing a machine's role is one silent click.

Part or screen: Machines.

What I see: "This computer" is a plain select with Master and Worker. Changing it immediately replaces the page and hides the fleet tables, with no confirmation. It clips its own label at 218 pixels as "Master — coordinate project…".

Why it matters: Changing a master into a worker changes what the whole fleet depends on. A stray scroll wheel or keystroke on a focused select could do it.

Recommendation: Show the role as text with a "Change role" button. Open a dialog that states the consequences, including which projects and workers are affected, and require confirmation.

#### MACH-2. Should fix. Machines hides overload, last-seen, and row actions.

Part or screen: Machines.

What I see: The heavy sample shows "15 of 8" and "16 of 8" agent slots beside a green Online, with no warning. Offline machines give no last-seen time. There is no Rename or Remove. Filler subtitles sit above the tables. At 390 pixels, Projects, New project here, and Next run on are off screen with no sign that more exists.

Why it matters: A machine running twice its slots is a problem the owner should see here. Machines come and go, so they must be removable.

Recommendation: Render overloaded slots in amber with "Over limit". Add "Last seen 2 hours ago". Add a row menu with Rename and Remove. On a phone, stack each row as a two-line list.

### Screen 55. Machines as worker

#### WORKER-1. Should fix. The worker page does not change after pairing.

Part or screen: Machines as worker.

What I see: After pairing, the same empty "Join a master" form remains, with small "Paired to…" text at the far right. Its submit button touches the input with no gap.

Why it matters: The owner cannot tell at a glance that pairing worked, and has no way to undo it.

Recommendation: Replace the form with a status panel naming the master, the connection state, and a Disconnect button. Add 8 pixels between the input and the button.

### Screen 56. Machines, connect dialog

#### PAIR-1. Must fix. Neither side of pairing shows the code.

Part or screen: Machines, connect dialog and worker form.

What I see: The master's "Connect a worker" dialog asks for a pairing code. The worker's "Join a master" form also asks for a pairing code. Neither screen displays one.

Why it matters: Pairing cannot be completed by following what the screens say. The golden mock would be built with this dead end.

Recommendation: Have the master show a generated code with its expiry and a Copy button, and the address the worker should use. Have only the worker's form ask for the code. Show the pending worker live in the table once the code is entered.

### Screen 57. Subscriptions

This is a good table, and it meets the row rule.

#### SUB-1. Should fix. Subscriptions shows no usage and offers no removal.

Part or screen: Subscriptions.

What I see: There is no usage or limit column and no Remove. "Use for new work" saves silently. At 390 pixels, Sign-in and Connect are clipped. The heavy sample still lists 5 agents while the fleet has 31.

Why it matters: Several accounts on one harness are usually there to spread limits, so the limit is likely the fact that matters most here.

Recommendation: Add a Usage column showing the percentage of the current limit and the reset time. Add Remove in a row menu. Show a short saved confirmation. Stack rows on a phone.

### Screen 58. Add subscription dialog

#### ADDSUB-1. Polish. The Add subscription dialog is tight.

Part or screen: Add subscription dialog.

What I see: A paragraph touches the select below it, and the dialog has no Cancel button.

Why it matters: This is small, but it is noticeable next to New project.

Recommendation: Add 16 pixels between them and a Cancel button, as in DLG-1.

### Screen 59. Subscription sign-in dialog

#### SIGN-1. Must fix. The sign-in dialog has nothing to sign in with.

Part or screen: Subscription sign-in dialog.

What I see: The dialog has a "Complete sign-in" button with no address, no code, and no status. It exposes the identifier `codex-extra-1`.

Why it matters: The mock is golden, so this would be built as a button that claims completion without any sign-in happening. It is also the remedy for the failed-start path in HOME-2.

Recommendation: Show an "Open sign-in page" button, the device code with a Copy button, and a live status of "Waiting for sign-in", which changes automatically when sign-in succeeds. Remove the Complete button and the identifier.

### Screen 60. Service settings

#### SET-1. Should fix. Service settings is one long page with mixed saving.

Part or screen: Service settings.

What I see: The page is 1447 pixels tall and has no section navigation. Some checkboxes save instantly, and three other sections have their own Save buttons. At 390 pixels, 12 checkboxes stack. The port field is 371 pixels wide. The right 400 pixels are empty at 1440.

Why it matters: The owner cannot tell what has been saved, and no one wants to scroll through 1447 pixels to find one setting.

Recommendation: Add a left section list that follows scrolling. Save everything on change, with a small "Saved" mark per field. Make numeric fields 96 pixels wide.

#### SET-2. Should fix. Settings use engine jargon and offer no test.

Part or screen: Service settings.

What I see: Labels include "Alert carrier", "Carrier token", "Heartbeat seconds", and "First permission-rule use". There is no way to send a test notification.

Why it matters: The owner set these up once and must remember them later from the label alone. The only proof that notifications work is waiting for a failure.

Recommendation: Rename them "Notification service", "Notification service token", and "Check-in interval, in seconds". Explain the permission rule in one sentence. Add a "Send test notification" button beside the token.

### Screen 61. New project, existing repository

This has a good preview of the branch and folder, and that preview is what makes the dialog work.

#### NEW-1. Should fix. New project's labels and preview need tightening.

Part or screen: New project.

What I see: "Start work tree" is cryptic and breaks the names table. "What are you building?" conflates the project's name with its goal, although the name sets the branch and folder. The preview is a single run-on line. The dialog has no way to choose the lead's subscription.

Why it matters: The owner will start many projects, and the name decides the branch.

Recommendation: Label the fields "Project name" and "Goal". Label the checkbox "Create a worktree". Show the preview as two labeled lines, Branch and Folder. Add a Lead subscription select.

### Screen 62. New project, new repository

This state holds up. Create project is correctly disabled until a valid path is given.

### Screen 63. New project, unavailable host

#### NEW-2. Polish. An unavailable host gets two similar messages.

Part or screen: New project.

What I see: "No available machine has this repository." appears alongside red text that says nearly the same thing.

Why it matters: Two messages suggest two problems.

Recommendation: Show one message, and add a link to connect the repository on a machine.

### Screen 64. Add context dialog

#### CTX-1. Should fix. Add context is a flat list with no search.

Part or screen: Add context dialog.

What I see: The dialog is a flat list of checkboxes in rows of 58 pixels, with no search and no grouping. The composer has no `@` route to the same list.

Why it matters: In a real project, this list would be hundreds of files. Cursor's `@` menu is the benchmark that the owner uses.

Recommendation: Add a search field and group by Tasks and Files. Use rows of 32 pixels. Open the same list when the owner types `@` in the composer.

### Screen 65. Design notes dialog

#### NOTES-1. Polish. The Design notes dialog has a leftover title and no grouping.

Part or screen: Design notes dialog, which will not ship.

What I see: Its title is "A project, with room to work", which is left over, and its 12 preview buttons are not grouped.

Why it matters: It is only a preview tool, but a person using it could work faster with groups.

Recommendation: Title it "Design notes" and group the buttons as Session, Connection, and Requests.

### Screen 66. Phone navigation

#### PHONE-1. Should fix. Phone views overflow in several small ways.

Part or screen: Phone, at 390 pixels.

What I see: Avatar initials wrap vertically as "R" and "W" in the team chat. The Approvals tab clips on Home with no sign that it can be scrolled.

Why it matters: These are the first things the owner sees when picking up the phone to answer a request.

Recommendation: Prevent wrapping in avatars. Fit the Home tabs on the phone by shortening them to "Attention", "Projects", "Questions", and "Approvals", and show a fade at the edge if they still overflow.

#### PHONE-2. Should fix. The phone navigation drawer leaves a slit for the tree.

Part or screen: Phone navigation.

What I see: The drawer holds the brand, Home, Find, Projects, and a 200 pixel footer, which leaves a scrolling tree of about 290 pixels showing about one project. The lead panel fills the screen as a drawer, with the five-row composer.

Why it matters: A person on a phone is trying to reach one agent quickly, and the drawer shows the footer more than the fleet.

Recommendation: On a phone, make the tree the drawer, and move service pages to the end of the scroll. Show agents needing attention at the top of the drawer.

#### PHONE-3. Should fix. Tables and the board do not adapt to the phone.

Part or screen: Phone, at 390 pixels.

What I see: The All projects Status column clips as "Needs a". The board shows a jump strip, the text "Scroll to see all sprint columns →", a column heading, and one card, with "Needs your decision" clipped off the right edge. A thread's header and composer leave about 520 of 844 pixels and hide the newest request. In a phone diff, the two line-number gutters use the first 126 pixels of the row.

Why it matters: A phone is used to answer one thing quickly. The most important words are the ones being clipped.

Recommendation: Show the board as a stacked list with items needing attention first. Show the status first in every phone row. Use one line-number gutter on a phone diff.

## Part 5. All findings ranked, most severe first

The critique has 114 findings: 15 are Must fix, 76 are Should fix, and 23 are Polish.

| Rank | ID | Severity | Screen or part | Summary |
|---|---|---|---|---|
| 1 | SIDE-1 | Must fix | Sidebar | The sidebar hides attention that exists. |
| 2 | STATUS-1 | Must fix | Status indicators | Failed and stopped agents wear the success color. |
| 3 | MERGE-1 | Must fix | Merge dialog, reached from Home and Git | The merge to main is approved without evidence. |
| 4 | PERM-1 | Must fix | Home, expanded approval, and Finch's thread | A blind approval looks the same as an informed one. |
| 5 | THREAD-1 | Must fix | Finch's and Iris's threads | The status line contradicts the state of the thread. |
| 6 | THREAD-2 | Must fix | Lead panel, Chat tab, and thread view | The newest request can be hidden when a thread opens or returns. |
| 7 | PERM-2 | Must fix | Stopped agent's thread | A cancelled request says that an answer was recorded. |
| 8 | GIT-1 | Must fix | Git, split diff | The split diff lines up the wrong lines. |
| 9 | STOP-1 | Must fix | Composer and thread status line | Stop agent is a one-click link that silently cancels permissions. |
| 10 | HOME-1 | Must fix | Home, empty queue | The empty queue says that filters are hiding things. |
| 11 | HOME-2 | Must fix | Home, failed start, and Ash's thread | A failed start has no action, and its remedy dead-ends. |
| 12 | THREAD-7 | Must fix | Failed start with a refused model | The refused-model failure tells the owner to use a control that does not exist. |
| 13 | PAIR-1 | Must fix | Machines, connect dialog and worker form | Neither side of pairing shows the code. |
| 14 | MACH-1 | Must fix | Machines | Changing a machine's role is one silent click. |
| 15 | SIGN-1 | Must fix | Subscription sign-in dialog | The sign-in dialog has nothing to sign in with. |
| 16 | WHOLE-1 | Should fix | Whole application | The chrome outweighs the work on every screen. |
| 17 | GIT-2 | Should fix | Git | The diff is too sparse and too narrow. |
| 18 | SIDE-2 | Should fix | Sidebar | Sidebar rows are too tall and the tree is starved. |
| 19 | HOME-3 | Should fix | Home, Needs attention | Requests are sorted by kind, so the oldest are not first. |
| 20 | TAB-1 | Should fix | Tab row | The Tasks tab moves every tab after it. |
| 21 | COMP-1 | Should fix | Composer | The composer is five rows tall. |
| 22 | COMP-2 | Should fix | Composer | Enter inserts a newline and does not send. |
| 23 | COMP-3 | Should fix | Composer | The composer has no model, effort, or context controls. |
| 24 | WHOLE-3 | Should fix | Whole application | Attention has at least seven different names. |
| 25 | WHOLE-4 | Should fix | Whole application | The worktree concept has eight names. |
| 26 | BTN-1 | Should fix | Buttons | A disabled filled button still looks like the main action. |
| 27 | STATUS-2 | Should fix | Status indicators | Failed start uses the same amber as a question. |
| 28 | STATUS-3 | Should fix | Status indicators | One idea has three visual treatments. |
| 29 | DISC-1 | Should fix | Discoverability | Essential actions do not exist, so they cannot be discovered. |
| 30 | GIT-3 | Should fix | Git | Git lacks everyday actions and hides its sync controls low in the pane. |
| 31 | CONFLICT-1 | Should fix | Git, conflict dialog | Conflict resolution offers two lines and a whole-file choice. |
| 32 | CONFLICT-2 | Should fix | Git, conflict | A conflict is barely marked. |
| 33 | CONN-1 | Should fix | Connecting and Reconnecting banners | The connection banner moves the page and hides Allow and Deny. |
| 34 | CONN-2 | Should fix | Reconnecting banner | The banner does not say how stale the page is. |
| 35 | CONN-4 | Should fix | Offline state, not reached because it does not exist | No offline state exists. |
| 36 | HOME-4 | Should fix | Home, filters | The filter band is larger than the list it filters. |
| 37 | HOME-5 | Should fix | Home, Needs attention and Approvals | A request's row title hides the actual action. |
| 38 | HOME-6 | Should fix | Home, Questions and Approvals | Tab counts include answered items. |
| 39 | HOME-7 | Should fix | Home, expanded rows | The expanded row repeats its own row. |
| 40 | HOME-8 | Should fix | Home, expanded approval, and the thread permission | Approvals show engine vocabulary and raw data. |
| 41 | TOP-1 | Should fix | Top bar | The breadcrumb looks like navigation but cannot be clicked. |
| 42 | TYPE-1 | Should fix | Typography | The final font should be Inter with JetBrains Mono. |
| 43 | TYPE-2 | Should fix | Typography | The type scale is defined and not used. |
| 44 | BELL-1 | Should fix | Bell popover | The bell is a slower copy of Home. |
| 45 | QUICK-1 | Should fix | Quick switcher | The quick switcher ranks the wrong result first. |
| 46 | SIDE-6 | Should fix | Sidebar | The selected row can sit under the footer's fade. |
| 47 | COMP-5 | Should fix | Composer | A failed or stopped agent still invites a message. |
| 48 | THREAD-5 | Should fix | Stopped agent's thread and sidebar | A stopped agent's Resume has too little weight, and its row hides waiting questions. |
| 49 | THREAD-6 | Should fix | Unconfirmed answer and held request | Failure messages name remedies that have no controls. |
| 50 | THREAD-3 | Should fix | Iris's thread | The thread shows engine vocabulary at conversation weight. |
| 51 | WHOLE-2 | Should fix | Whole application at 2560 pixels | The application does not use a wide monitor. |
| 52 | SIDE-3 | Should fix | Sidebar | The theme control takes a permanent row and shows the palette names. |
| 53 | TOP-3 | Should fix | Top bar at 390 pixels | The phone top bar is overcrowded. |
| 54 | TAB-2 | Should fix | Tab row | Selecting a tab makes the other tabs jump. |
| 55 | TAB-4 | Should fix | Tab row and page title | The title above the tabs behaves differently on each tab. |
| 56 | ROW-1 | Should fix | Tables and rows | Record rows break the 46 pixel rule. |
| 57 | BTN-2 | Should fix | Buttons and controls | Control heights do not follow a scale. |
| 58 | DLG-1 | Should fix | Dialogs | Dialogs do not close in the same way. |
| 59 | TYPE-3 | Should fix | Typography | Page titles are the loudest thing on the page and the least useful. |
| 60 | SPACE-1 | Should fix | Spacing and shape | The spacing has no visible grid, and the shape has too many radii. |
| 61 | SPACE-2 | Should fix | Spacing and alignment | Content edges change between pages under the same tabs. |
| 62 | COLOR-1 | Should fix | Color use | The primary peach is doing four jobs. |
| 63 | EMPTY-1 | Should fix | Empty states | Empty states explain the product rather than say what to do. |
| 64 | LOGIN-1 | Should fix | Login | The login form blocks password managers. |
| 65 | MERGE-2 | Should fix | Merge dialog, Home, Git, and the branch picker | "1 commits" and "1 changed files" are wrong. |
| 66 | HOME-9 | Should fix | Home, Approvals | The merge row has a truncated kind and no wait time. |
| 67 | REPO-1 | Should fix | Repository page | The repository page is a sparser copy of All projects. |
| 68 | BOARD-1 | Should fix | Board | Cards emphasize prose over state. |
| 69 | BOARD-2 | Should fix | Board | The lead panel has too many redundant routes. |
| 70 | BOARD-4 | Should fix | Empty board and every thread | Stop agent is offered on an idle lead. |
| 71 | SPRINT-1 | Should fix | Sprint page | The sprint page hides its status and its blocker. |
| 72 | TASK-1 | Should fix | Task page | The task's main action is below the fold. |
| 73 | TEAMTASKS-1 | Should fix | Team tasks | Team tasks use the chat frame and two-line rows. |
| 74 | THREAD-4 | Should fix | Iris's thread | A loaded large item is a small nested scroller. |
| 75 | TERM-1 | Should fix | Terminal | A terminal session cannot be closed or renamed. |
| 76 | TERM-3 | Should fix | Terminal, reconnecting | The reconnect notice changes the terminal's size. |
| 77 | TERM-4 | Should fix | Terminal at 390 pixels | The phone terminal has no special keys. |
| 78 | PSET-1 | Should fix | Project settings | Project settings has one real setting and no lifecycle actions. |
| 79 | PICKER-1 | Should fix | Branch picker | The branch picker is a long, unsorted, ambiguous list. |
| 80 | ALERT-1 | Should fix | Alerts, sidebar | The name and icon of Alerts collide with the bell. |
| 81 | ALERT-2 | Should fix | Alerts | The Alerts table cannot be used to diagnose a failure. |
| 82 | MACH-2 | Should fix | Machines | Machines hides overload, last-seen, and row actions. |
| 83 | WORKER-1 | Should fix | Machines as worker | The worker page does not change after pairing. |
| 84 | SUB-1 | Should fix | Subscriptions | Subscriptions shows no usage and offers no removal. |
| 85 | SET-1 | Should fix | Service settings | Service settings is one long page with mixed saving. |
| 86 | SET-2 | Should fix | Service settings | Settings use engine jargon and offer no test. |
| 87 | NEW-1 | Should fix | New project | New project's labels and preview need tightening. |
| 88 | CTX-1 | Should fix | Add context dialog | Add context is a flat list with no search. |
| 89 | PHONE-1 | Should fix | Phone, at 390 pixels | Phone views overflow in several small ways. |
| 90 | PHONE-2 | Should fix | Phone navigation | The phone navigation drawer leaves a slit for the tree. |
| 91 | PHONE-3 | Should fix | Phone, at 390 pixels | Tables and the board do not adapt to the phone. |
| 92 | WHOLE-5 | Polish | Whole application | Compared with Cursor, the product feels like a set of pages rather than one workspace. |
| 93 | SIDE-4 | Polish | Sidebar | Selecting a team highlights two rows equally. |
| 94 | SIDE-5 | Polish | Sidebar | A stray tree line sits under an expanded project with no teams. |
| 95 | TOP-2 | Polish | Top bar | The Viewing control's chevron points the wrong way. |
| 96 | TAB-3 | Polish | Tab row | The tab hover block has no padding. |
| 97 | COMP-4 | Polish | Composer | Thread text clips against the composer in Chat. |
| 98 | COMP-6 | Polish | Composer | The subscription select leaves a gap before its chevron. |
| 99 | BTN-3 | Polish | Buttons and controls | Actions and links are mixed without a rule. |
| 100 | COLOR-2 | Polish | Toast | The toast looks like a button. |
| 101 | ICON-1 | Polish | Icons | Icons mix drawn vectors with text characters. |
| 102 | MOTION-1 | Polish | Motion, judged from the source | The application has one transition and no feedback for change. |
| 103 | FOCUS-1 | Polish | Hover and focus | The focus ring is clipped on tree disclosures. |
| 104 | DISC-2 | Polish | Discoverability | The sidebar and lead panel resize handles are invisible at rest. |
| 105 | LOGIN-2 | Polish | Login | The login greets a first visitor as a returning one. |
| 106 | LOGIN-3 | Polish | Login | Login messages have no hierarchy of severity. |
| 107 | LOGIN-4 | Polish | Login | The only action on the unavailable page is a secondary button. |
| 108 | CONN-3 | Polish | Reconnecting banner | "Try reconnecting" is styled as navigation. |
| 109 | REPO-2 | Polish | Sidebar and repository page | The selected repository's pill is too tight. |
| 110 | BOARD-3 | Polish | Board | The column dots carry no meaning. |
| 111 | TERM-2 | Polish | Terminal, vim | The vim view misaligns its status bar. |
| 112 | ADDSUB-1 | Polish | Add subscription dialog | The Add subscription dialog is tight. |
| 113 | NEW-2 | Polish | New project | An unavailable host gets two similar messages. |
| 114 | NOTES-1 | Polish | Design notes dialog, which will not ship | The Design notes dialog has a leftover title and no grouping. |
