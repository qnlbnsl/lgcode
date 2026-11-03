# Known gaps (acknowledged; reviewers hunt NEW problems only)

1. Gate 10 load line: the planner cannot read either vendor's remaining weekly allowance; launch counts are estimates, and the lead checks limits before launching.
2. Decision row 11 is open with the owner: the three engine changes in WS-7. Each affected workstream states its fallback.
3. The client API and message board contracts are not frozen yet. Every task marked "contract pending" is written against `requests.md`, not against a frozen contract.
4. The scopes `roles/backend`, `roles/contracts` and `roles/docs-research` do not exist; the lead runs the scoping skill before launch.
5. Without WS-7c, timed compaction covers Claude agents only, and depends on the adapter writing a transcript where the reader can find it (post-build check 2).
6. Without WS-7b, a capacity error is re-sent by the sheepdog, so the agent sees the sheepdog as the sender, and the parent is still woken once by the engine's returned delivery.
7. The Synapse list's stall minutes are still an open question there (its open question 2); this plan makes them settings with defaults (row 16).
8. Agents run as the owner's user and can write the role file and Shephrd's state folder (engine decision row 47, accepted by the owner on 2026-11-01). Post-build check 3.
9. The Foundry skill lives in the Founder OS repository; rewriting its Steps 3 to 5 and 8 is rollout step 7, outside this plan's units.
