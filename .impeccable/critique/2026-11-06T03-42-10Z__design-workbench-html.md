---
target: LGTM Studio chat, project board, project leads and attention routing
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
timestamp: 2026-11-06T03-42-10Z
slug: design-workbench-html
---
Method: dual-agent (A: /root/project_chat_critique · B: /root/project_chat_evidence).

The calmer visual system is worth keeping. The mock now makes conversations
legible, but the project those conversations manage is still missing.
This critique inspected fresh desktop and phone pages and the actual Ananke
Cursor build-order canvas. It makes no UI changes.

The strengths are Field and Dusk, consistent alignment, named authors,
independent disclosure, and preserved drafts. The next revision should keep
those and replace the weak project and conversation structures.

| Heuristic | Score /4 | Main finding |
|---|---:|---|
| System status | 2 | Team status exists; project progress does not. |
| Real-world match | 2 | The branch-looking menu changes repositories. |
| User control | 3 | Drafts, cancel, and navigation work. |
| Consistency | 3 | Project entry has inconsistent destinations. |
| Error prevention | 2 | Repository rebinding is unexpectedly available. |
| Recognition | 2 | Sage does not surface pending team questions. |
| Efficiency | 2 | Too much stationary chat context. |
| Minimalism | 3 | Calmer composition; repeated metadata remains. |
| Recovery | 2 | Failed or stalled agent states are not demonstrated. |
| Help | 2 | Plan, sprint, and assignment relationships are absent. |
| **Total** | **23/40** | **Subjective assessment of the mock, not an engine test.** |

1. **P2 — Chat needs a better turn structure.** At 1440 by 900, only
   465 pixels remain for the scrollable conversation. At 390 by 844, only
   408 remain. Large user surfaces, distant timestamps, repeated metadata,
   header rows, and the fixed composer fragment the reading flow. Use one
   compact conversation header, restrained user turns, readable agent
   replies, grouped collapsible tool activity, and a composer that grows
   when needed. Put working, finished, failed, and awaiting-answer states
   with their turn. Preserve drafts, recipient identity, and scroll position.
   Source: design/workbench.html:49, :53, :57, :176. Suggested route:
   /impeccable distill, /impeccable layout, then /impeccable polish.

2. **P1 — Context selection changes the wrong object.** The branch icon
   opens repository setup and can rebind the existing project to notes-site.
   Keep the repository bound during setup. Show branches and working
   directories in the context selector, with their owner and activity.
   Distinguish viewing a workspace from redirecting a running agent.
   Source: design/workbench.html:228, :263, :279. Suggested route:
   /impeccable clarify and /impeccable harden.

3. **P1 — The project has no operating view.** Tasks belong only to the
   selected team. Add a project Board with sprint cards. Opening a sprint
   reveals its tasks, owners, teams, phase, dependencies, and completion
   evidence. The plan, board, and agent work should describe the same work,
   without independent copies of status. The Ananke reference has useful
   ownership, dependency, phase, and review structure; its implementation
   code was not copied. Source: design/workbench.html:97, :205.
   Suggested route: /impeccable shape and /impeccable layout.

4. **P1 — Selecting a project should open its lead.** A fresh project click
   opens the first team, and later clicks restore arbitrary prior views.
   Make the named project open its lead conversation consistently. Give it
   a stable Board destination and teams beneath it. Use distinct sample
   project names so LGTM Studio is clearly the app. Multiple leads need explicit
   ownership rather than several interchangeable orchestrators.
   Source: design/workbench.html:152, :169, :198. Suggested route:
   /impeccable clarify and /impeccable layout.

5. **P1 — Requests stop at the team boundary.** Sage's conversation has no
   escalation and hides the attention strip. Review decision from an agent
   opens the shared team thread even though Rowan has the question in his
   own conversation. Sage's link, Rowan's highlight, and the destination
   should refer to one request. Opening it focuses the actual question;
   answering resolves every indicator. Viewing alone should not mark it
   resolved. Source: design/workbench.html:198, :217, :243.
   Suggested route: /impeccable clarify and /impeccable harden.

The returning owner has to reconstruct overall progress from conversations.
The phone owner spends about half the screen on stationary context and
composition. A new owner encounters a team before the project lead. These
are the main cognitive costs. The reassuring peak is answering a concrete
question; the low point is opening Sage and finding a generic introduction
while Rowan is waiting elsewhere.

The proposal also needs dependencies and blocked reasons, explicit sprint
ownership, and a distinction between built, verified, merged, and released.
Board changes should reflect actual work; moving a card cannot stand in for
verification or merging.

The command-line detector returned no findings in degraded regex mode, which
could not check computed contrast. Browser injection found a 4.4:1 contrast
case on the selected project's small agent count (design/workbench.html:43),
below the design contract's 4.5:1. Small helper text is a secondary concern.
Closed-dialog border warnings and warnings about the detector's own labels
are not evidence about the visible chat. Temporary overlay servers were
stopped; no user-visible overlay remains. The application produced no
JavaScript errors or horizontal overflow in the inspected sizes.

Clarifications for the next revision:

- Multiple leads: one per named project, or several sharing one project?
- Branch/workspace selection: inspect that workspace, or also redirect work?
