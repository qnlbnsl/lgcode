# Workspace settings cold verification

Observed 2026-11-06 at 14:51 UTC against the existing preview at `http://127.0.0.1:4178/workbench.html`. Fresh Chromium context, real clicks/input through Playwright, no product or test edits. **27 assertions passed; zero browser JavaScript errors; no material finding in the requested scope.**

## Observed journeys

- **Unified Git:** opened `app/workspace.tsx` immediately; clicking `app/sidebar.tsx` showed its diff without an intermediate file-preview step. History commit `a62f019` opened inside the same diff pane. Inspecting `main` showed a clean working tree and its own `docs/README.md` commit sample; Recovery showed `engine/recovery.ts`, `fix/reconnect`, and `delivery.resume(receipt)`. Returning to Workspace restored the selected sidebar file. Relevant implementation: `workbench.html:249`, `:262`, `:263`, `:265`, `:280`, `:283`.
- **Assigned workspace Settings:** while the Viewing picker inspected `main`, Workspace Settings continued to show assigned `feat/workspace`, `~/projects/sheprd/.worktrees/workspace`, and Studio. Recovery independently showed `fix/reconnect`, its recovery folder, and Buildbox. Saving Zsh for Workspace and Bash for Recovery preserved each project's preference after navigation. Relevant implementation: `workbench.html:266`, `:270`.
- **Worktree default and safe names:** the new-project dialog opened with Start work tree checked. `Café / Tools !!` previewed and created `cafe-tools`; `Cafe---Tools` then received `cafe-tools-2`. `Main` received `main-2` because `main` already existed. An emoji-only name received the safe fallback `project-4`. Each Settings page matched its previewed branch and folder. Relevant implementation: `workbench.html:382`, `:429`, `:436`.
- **Unchecked worktree:** after inspecting Recovery, creating an unchecked project previewed and assigned `Main checkout · main · ~/projects/sheprd`, rather than using the inspected recovery worktree.
- **Alternate repository:** selecting `atlas-docs` and naming `Docs & Guides` previewed and assigned `docs-guides` under `~/projects/atlas-docs/.worktrees/docs-guides`. A second unchecked Atlas project used `Main checkout · main · ~/projects/atlas-docs`.
- **Responsive themes:** Git and Workspace Settings each fit at 1440×900 and 390×844 in both Field and Dusk. Document width matched viewport width in all eight combinations, and all five workspace tabs remained inside the viewport. At 390px, Settings ended at approximately x=268, leaving visible room for the whole tab row.

## Limits

These are interactive-mock observations. Git panes explicitly say “Sample diff”; shell settings explicitly say “Preview preference only.” Project creation updates the preview's in-memory workspace data; this pass does not establish real Git branch/worktree creation, shell execution, disk persistence, or backend integration. No existing server or external service was modified.
