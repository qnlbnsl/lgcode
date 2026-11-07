# Inline requests and grouped sidebar — cold verification

Completed 2026-11-06 at 22:49 UTC against the existing `http://127.0.0.1:4178/workbench.html` preview. Started with normal browser journeys and screenshots before reading implementation. Source inspection was limited to reproduced findings. No implementation/test edits, Git actions, submodule entry, server changes, or process changes.

**Final verdict: 53 assertions passed across three completed browser passes; zero browser JavaScript errors. Both confirmed counterexamples were fixed by the owner and independently rechecked. No confirmed finding remains in this bounded revision.**

## Confirmed counterexamples and rechecks

1. **Medium — answering a disappearing queue item lost keyboard focus.** Needs attention → expand the question → answer it removed the row and left `document.activeElement` on Body. The answer handler attempted to focus the now-removed question. Fresh recheck: answering a question focuses the next approval row; answering that approval focuses the next row. Answering the last filtered question or permission focuses the empty results region. An answered permission retained in history keeps focus in its inline detail. Cancelling merge review returns to its inline action, and approving a merge in Needs attention focuses the next remaining row after the modal closes. Relevant fix: `workbench.html:635`.
2. **Low — merge source action mislabeled its destination.** A merge approval offered “Open Sage’s conversation” but opened Source Control. Fresh recheck: the action reads “Review in Git” and opens Source Control for `feat/workspace`. Relevant fix: `workbench.html:626`.

## Observed functional behavior

- Needs attention, Questions, and Approvals start collapsed. Each summary is a compact single row. Expanded details are the next sibling directly under their own row, inside the same list item; opening another row closes the previous one.
- Mouse, Enter, and Space toggle disclosures. Row toggles and the detail close button preserve/restore row focus. Inline permission and question answers remain on Home; answered history expands in place.
- Question conversation navigation preserves the draft and focuses its blocking question. Discuss preserves the existing draft.
- Unconfirmed permissions retain disabled answer controls and remain searchable. Held requests expose no answer controls. Opening another request while reconnecting disables its answers, and reconnecting restores an available action. Filter changes collapse the previous disclosure.
- A pending project merge starts collapsed, requires explicit review, remains expanded after review cancellation, and records its approved result in Home history. Answered filtering retains the approved merge.
- Grouped-sidebar search opens the working quick switch; its filter hides and restores quiet projects; New project opens setup. The duplicate Repositories destination is absent, and repository labels still open their project lists. Mobile search and New project both open usable modals after navigation closes.
- Expanded questions fit at 390×844 and 1440×1000 in Field and Dusk without document overflow. Summary rows remain at most 48px high. Desktop and mobile screenshots were visually inspected.

## Evidence

- `inline-requests-cold-first-journeys.json`: 18 passed assertions, no errors.
- `inline-requests-cold-extended.json`: 25 passed assertions, no errors.
- `inline-requests-cold-focus-recheck.json`: 10 passed assertions, no errors.
- `inline-requests-cold-initial.png`, `inline-requests-cold-mobile-approval.png`, and `inline-requests-cold-{light,dark}-desktop.png`: layout evidence.

Two exploratory scripts needed locator/expectation corrections: queue source navigation shared a data attribute with the hidden attention popover, so the locator was scoped to Home; history focus correctly targets the entire inline detail rather than requiring its nested permission section. The completed runs above use the corrected probes.

These observations verify the interactive mock's behavior and layout. Real backend execution, persistence, Git integration, and machine transport remain outside this task.
