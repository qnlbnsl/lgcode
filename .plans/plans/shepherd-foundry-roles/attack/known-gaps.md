# Known gaps (acknowledged; reviewers hunt NEW problems only)

1. Gate 10 load line: the planner cannot read either vendor's remaining weekly allowance; launch counts are estimates, and the lead checks limits before launching.
2. Decision rows 11, 19, 30 and 53 are unanswered with the owner: the extension seam (built in the client API plan) and the three engine changes in WS-7, two of which round 1 reshaped (row 53). Each affected workstream states its fallback; if the seam itself is declined, both contracts and this plan return to DISCOVER.
3. Both contracts are frozen (client API `ed1755d`, board v3 `07b3386`), but neither is built; the roles depend on the seam's in-process service path accepting piece commands such as `board.post` (post-build check 3).
4. The scopes `roles/backend`, `roles/contracts` and `roles/docs-research` do not exist; the lead runs the scoping skill before launch.
5. Without WS-7c, timed compaction covers Claude agents only, and depends on the adapter writing a transcript where the reader can find it (post-build check 2).
6. Without WS-7b, the sheepdog re-sends only plain engine prompts, so the agent sees the sheepdog's fixed header naming the original sender, and the sender is still woken once by the engine's returned delivery. A board wake that meets a capacity error keeps the board's own rule (one immediate retry, then `undeliverable`), so without WS-7b a capacity outage can end that addressee's part of a post (row 49).
7. The Synapse list's stall minutes are still an open question there (its open question 2); this plan makes them settings with defaults and bounds (rows 16, 48).
8. Agents run as the owner's user and can read and write Shephrd's state folder, including its database (engine decision row 47, accepted by the owner on 2026-11-01). Standing rules live in the event log, so an agent able to write the database could add one; this is the same accepted risk, not a new one.
9. The Foundry skill lives in the Founder OS repository; rewriting its Steps 3 to 5 and 8 is rollout step 6, outside this plan's units.
10. `client.roster` gives counts of open requests and questions, not their contents, so `orient` shows counts only.
11. Whether `roles.rules.add` is host-only depends on the client API's open question Q2. Meanwhile a rule added by a device stops matching when that device is revoked (row 35).
12. Closed by lead ruling L17 (row 34): the sheepdog posts direct notices; the engine-prompt fallback is dropped.
13. Standing rules answer nothing without WS-7a, because only WS-7a records the tool kind and the request's own input that ruling L20 requires (rows 35, 53).
14. Claude Code's shell input names no working folder, so until a recording (2g) proves the command always runs in the session folder, Claude agents get no standing-rule matches. This is fail-closed by design.
15. The engine's own crash notice wakes the holder in the crash's transaction, before the sheepdog resumes the agent; a holder may still start a replacement. The sheepdog's notice says what it did (row 42).
16. Whether an adapter puts `kind` and `rawInput` on its permission request is unknown until 2g's recordings; a harness without them never matches (post-build check 1).
