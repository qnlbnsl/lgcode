# Home cold verification

Completed 2026-11-06 at 18:02 UTC against the existing preview at `http://127.0.0.1:4178/workbench.html`. Fresh headless Chromium contexts, normal UI input/clicks and keyboard navigation. Read-only verification; no source/test edits, Git actions, submodule entry, server changes, or process changes.

**Final verdict: 42 successful checks across three passes, zero browser JavaScript errors. All admitted counterexamples were fixed by the implementation owner and independently rechecked; no confirmed issue remains in the bounded scope.**

## Counterexamples and successful rechecks

| Initial severity | Reproduction / original result | Fresh observed result |
| --- | --- | --- |
| Medium | Rowan working draft → Home → Questions → Discuss another approach replaced the draft with a canned prefix. | Existing draft survives exactly; an empty draft receives the prefix. `workbench.html:429`. |
| Medium | Machines allowed Docs refresh / atlas-docs placement on Buildbox even though its repository was unavailable, producing Home/Settings Buildbox versus Git Studio disagreement. | Unavailable repository option is disabled. Valid placement changes explicitly apply to future runs; current Settings and Git remain on Studio. `workbench.html:287`, `:293`. |
| Medium | Start project on Buildbox while last project was atlas-docs silently switched to Studio. A newly paired repository-free worker also silently switched to Studio. | Buildbox action selects lgtm on Buildbox. Repository-free worker remains selected, explains the missing repository, and disables Start. Changing repository to an unavailable one preserves the explicitly selected host and disables Start. `workbench.html:599`, `:602`. |
| Medium | Home tablist assigned inactive tabs `tabindex=-1` without arrow navigation; Tab skipped directly to search. Changing a filter dropped focus to Body. | ArrowRight, ArrowLeft wrap, Home, and End select and focus the expected tab. Repository and Machine changes restore focus to their filter. `workbench.html:596`, `:599`. |
| Low | Finch approval header showed project `feat/workspace` while its conversation showed `feat/workspace/review`; failures used the same project fallback. | Finch approval identifies its Review worktree; Ash failure identifies `fix/reconnect/engine` on Buildbox. `workbench.html:588`. |
| Low | Remote unchecked project preview correctly showed Main checkout, but Settings labelled `~/work/lgtm-studio` a Project worktree. | Buildbox unchecked creation shows `main`, `Main checkout`, `~/work/lgtm-studio`, and Buildbox consistently. `workbench.html:286`. |

## Other observed journeys

- Home is the default global page and hides the workspace composer.
- Questions and Allow/Deny approvals record their result in place. Answered questions/approvals remain discoverable with combined status, agent, machine, and project filters. Changing project clears an incompatible agent filter.
- Unconfirmed approval answers remain pending, prevent immediate retry, and remain discoverable through Open/search. Held requests remain visible and searchable without answer controls. Ordinary Open conversation preserves the existing Rowan draft.
- A Recovery commit appears as a Buildbox merge approval. Cancelling review keeps the request pending on Home; approval records the merge result in place.
- Checked remote creation starts its lead on Buildbox and retains its worktree folder. Returning through Home preserves the lead draft. Offline hosts remain unavailable.
- Machines use rows no taller than 48px at desktop. At 390px the table scrolls inside its container without document overflow. Selecting an approval on mobile scrolls its detail into view; the saved mobile approval image was visually inspected.

## Evidence and limits

- `home-cold-queue-probes.json`: 6 passing edge-state/draft observations, no JavaScript errors.
- `home-cold-functional.json`: 16 passing functional/responsive checks, no JavaScript errors.
- `home-cold-recheck.json`: 20 passing bounded fix checks, no JavaScript errors.
- `home-cold-approval-mobile.png` and `home-cold-machines-mobile.png`: responsive evidence.

This establishes the mock's displayed behavior. It does not establish real Git merges/worktree creation, terminal execution, provider sign-in, machine transport, or persistence. No additional formal review was performed.
