# Workspace redesign cold verification

Cold browser observations on 2026-11-06, completed at 17:03 UTC against `http://127.0.0.1:4178/workbench.html`. Fresh headless Chromium contexts; normal UI clicks, input, and keyboard navigation. No implementation, test, server, process, Git, or submodule changes.

**Final verdict: 32 assertions passed across the completed recheck and continuation; zero browser JavaScript errors. No outstanding confirmed finding in this task's scope.**

## Counterexamples found and independently rechecked

The first pass found these gaps, reported them to the implementing agent, and repeated each journey after the fixes:

1. **Terminal drafts crossed worktree boundaries.** Project terminal draft appeared in App shell's session; changing that text then overwrote the project draft on return. Recheck: project and team drafts each survive independent round trips; a second named terminal preserves separate input; switching through the Viewing picker also preserves the correct session. Context is now remembered before destination selection (`workbench.html`, `go`, `openTeam`, `openBoard`, `openGit`).
2. **Viewing picker retained the previous project/team/machine.** App shell → Git → Viewing `fix/reconnect` showed `App shell · fix/reconnect · Studio` even though Agent recovery belongs to Buildbox. Recheck: both Git and Terminal now show `Agent recovery · fix/reconnect · Buildbox`; returning to App shell restores its owning team and session. Quick-switching Sage from a team also resets Viewing to `feat/workspace`.
3. **Partial commit left no selected file.** Selecting and committing only `app/sidebar.tsx` showed the remaining `app/workspace.tsx` diff with zero current file rows. Recheck: the remaining file is selected and its diff matches.
4. **Team integration ignored dirty destination state.** A clean team could merge into the project with its two uncommitted files still present. Recheck: destination changes disable integration with “Destination has uncommitted changes”; committing the project's files enables integration and records the correct target.

## Additional observed behavior

- Team and project staging selections and commit-message drafts remain separate.
- Team merge records `feat/workspace/app-shell` → `feat/workspace`. Project → `main` requires explicit review; cancelling does not merge; approval records the expected merge.
- Rowan's draft, attached SH-17 task, and `claude-studio` subscription do not appear in Mira's conversation. Returning to Rowan restores all three. Mira's account choices use Buildbox's available profile. Sending retains SH-17 with the message and clears the composer attachment.
- Attention opens and focuses the exact permission request. Quick switch safely handles Enter on an empty result set, Escape, and a subsequent successful keyboard agent search.
- Team Chat, Git, Terminal, and Workspace Settings have no document overflow at 390×844 in either Field or Dusk (eight combinations).

## Evidence and limits

`redesign-cold-probe.json` records the 17 successful scope/integration checks followed by a probe-fixture exception: the initial continuation requested a Codex subscription for Claude-based Rowan. This was a verification script mistake, not a product failure. `redesign-composer-cold-probe.json` records the corrected continuation: 15 assertions passed, zero failures and zero JavaScript errors.

An exploratory nested merge-review/quick-switch test encountered Playwright's “element is inert” actionability result while browser keyboard typing still reached the quick search. A New Project/quick-switch comparison worked. This is not admitted as a UI defect; ordinary quick-switch and review journeys passed independently.

This pass verifies an interactive mock's displayed state transitions. It does not establish real shell execution, Git operations, persistence, provider sign-in, or distributed machine execution.
