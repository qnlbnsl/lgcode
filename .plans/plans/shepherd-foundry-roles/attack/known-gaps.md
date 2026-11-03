# Known gaps (acknowledged; reviewers hunt NEW problems only)

1. Gate 10 load line: the planner cannot read either vendor's remaining weekly allowance; launch counts are estimates, and the lead checks limits before launching.
2. Decision rows 11, 19 and 30 are unanswered with the owner: the extension seam (built in the client API plan) and the three engine changes in WS-7. Each affected workstream states its fallback; if the seam itself is declined, both contracts and this plan return to DISCOVER.
3. Both contracts are frozen (client API `235d4d6`, board v3 `07b3386`), but neither is built; the roles depend on the seam's in-process service path accepting piece commands such as `board.post` (post-build check 3).
4. The scopes `roles/backend`, `roles/contracts` and `roles/docs-research` do not exist; the lead runs the scoping skill before launch.
5. Without WS-7c, timed compaction covers Claude agents only, and depends on the adapter writing a transcript where the reader can find it (post-build check 2).
6. Without WS-7b, a capacity error is re-sent by the sheepdog, so the agent sees the sheepdog as the sender, and the parent is still woken once by the engine's returned delivery.
7. The Synapse list's stall minutes are still an open question there (its open question 2); this plan makes them settings with defaults (row 16).
8. Agents run as the owner's user and can read and write Shephrd's state folder, including its database (engine decision row 47, accepted by the owner on 2026-11-01). Standing rules live in the event log, so an agent able to write the database could add one; this is the same accepted risk, not a new one.
9. The Foundry skill lives in the Founder OS repository; rewriting its Steps 3 to 5 and 8 is rollout step 7, outside this plan's units.
10. `client.roster` gives counts of open requests and questions, not their contents, so `orient` shows counts only.
11. Whether `roles.rules.add` is host-only depends on the client API's open question Q2.
12. Decision row 34 (may a service post with a `direct` target to an agent) is unanswered; the plan carries a fallback (an engine `prompt` from the service).
