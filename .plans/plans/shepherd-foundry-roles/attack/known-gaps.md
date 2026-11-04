# Known gaps (acknowledged; reviewers hunt NEW problems only)

1. Gate 10 load line: the planner cannot read either vendor's remaining weekly allowance; launch counts are estimates, and the lead checks limits before launching.
2. Closed by the owner's answer of 2026-11-03 and lead rulings L26 and L27 (rows 80, 81): the plans edit the engine directly, WS-7 is no longer pending, and standing rules are built only for a qualifying harness.
3. Both contracts are written (client API v15 `668a341`, board v12 at `46d0fbb`, both reworked under L26), but neither is built; the roles depend on the engine's in-process service path (CAPI E13) accepting piece commands such as `board.post` (post-build check 3), and on the board's reach check allowing L17's service-and-agent direct pair. Round 4's four shared findings (post-id replies, reads versus rights, the lifecycle table for piece events, and the caller surviving a log read) are settled in the client API contract and folded (rows 95 to 101, 103 to 108). 
4. The scopes `roles/backend`, `roles/contracts` and `roles/docs-research` do not exist; the lead runs the scoping skill before launch.
5. A harness whose adapter reports no usage on `TurnEnded` (WS-7c) gets timed compaction only if it is Claude and its transcript can be found (post-build check 2).
6. Closed by row 80: WS-7b is built, so a capacity error with the sheepdog on holds the agent's queue. With the sheepdog off, it returns to its sender as before this plan.
7. The Synapse list's stall minutes are still an open question there (its open question 2); this plan makes them settings with defaults and bounds (rows 16, 48).
8. Agents run as the owner's user and can read and write Shephrd's state folder, including its database (engine decision row 47, accepted by the owner on 2026-11-01). Standing rules live in the event log, so an agent able to write the database could add one; this is the same accepted risk, not a new one.
9. The Foundry skill lives in the Founder OS repository; rewriting its Steps 3 to 5 and 8 is rollout step 6, outside this plan's units.
10. `client.roster` gives counts of open requests and questions, not their contents, so `orient` shows counts only.
11. Closed by row 139: there are no device credentials, so no device can add a rule. `roles.rules.add` has access `owner`, and a logged-in dashboard is the owner.
12. Closed by lead ruling L17 (row 34): the sheepdog posts direct notices; the engine-prompt fallback is dropped.
13. WS-7a is built only for a harness that qualifies (lead ruling L27, row 81); without a qualifying harness, standing rules are deferred.
14. Claude Code's shell input names no working folder, so Claude agents get no standing-rule matches in this version, with no exception. This is fail-closed by design (row 67); a launch setting that pins the shell's folder is a feature idea in the result file. Claude's adapter also reports Bash and PowerShell through one reporter, with the command as the title and no discriminator field, so Claude may stay `unsupported` even with its folder pinned (row 79).
15. The engine's own crash notice wakes the holder in the crash's transaction, before the sheepdog resumes the agent; a holder may still start a replacement. The sheepdog's notice says what it did (row 42). The alternative the lead did not take (board #109) was to leave every agent-held crash to its holder, so the sheepdog would resume only owner-held agents; it would remove the race but give every lead a crash to handle by hand.
16. Whether an adapter puts `kind` and `rawInput` on its permission request is unknown until 2g's recordings; a harness without them never matches (post-build check 1).
17. A standing rule needs each harness's shell discriminator (lead ruling L25, row 54), which must be a field the adapter sets, never a title (row 79); a harness whose 2g recordings show none is `unsupported`, so it gets no matches.
18. Codex is expected to be `unsupported` for standing rules: under its on-request approval policy an approved command runs outside the sandbox, and `sandbox_permissions` describes only what the model asked for (row 79). Only an approval event that itself says the approved command stays sandboxed would change this, perhaps under another approval policy set at launch, which question 4's option (b) tries.
19. The sheepdog's crash and give-up records rely on the client API's alert view to set `engineAlertOpen`; if that view lags the log within one transaction, an owner could get a second alert for one give-up (row 58). A test covers the transaction order (4.9).
20. WS-7a resolves paths, following symbolic links, before the request's transaction. A link created after that and before the command runs is not caught. This is narrower than the alias case it closes, and an agent able to create it at that moment could also edit the files the command runs (row 79).
21. Taken together, gaps 14, 17 and 18 and the unrecorded Gemini and Cursor harnesses mean that, on today's evidence, no harness qualifies for standing rules. Lead ruling L27 (row 81) makes the recordings decide: standing rules are built only for a harness that qualifies, and otherwise deferred.
22. The engine's settings test treats every path under a `.claude/`, `.codex/`, `.gemini/` or `.cursor/` folder as a settings path, so a team whose worktrees sit under `.claude/worktrees/` gets every file edit sent to the owner, and no standing-rule match. The plan fails closed there and tells teams to keep worktrees outside such folders (row 85); narrowing the engine's test is an issue for the lead, because it touches a settings rule.
23. The web password is a boundary against the network, and it is not a boundary against an agent on the owner's Unix user. Such an agent can read the password from the engine's environment through `/proc`, or the owner credential on disk, and so add a rule as the owner. SECURITY.md states this limit next to the existing own-user limit (row 139).

## Round minors, not folded

These are from round 5, under the manager's rule for the final fold.

- **R5-C1:** a delayed first-use record can reopen the alert of a rule that was disabled in between.
- **R5-C2:** the build table keeps unit 4 as an unconditional dependency of units 12 and 13, and leaves out unit 11c as a dependency of unit 9.
- **R5-C3:** a client has no read to recover snoozes that were cut from the bounded snapshot.
- **R5-L2:** criterion 4.3 says both that a lead asked a question while a sibling works is not stalled and that it is nudged; the exception in row 88 is the intended one.
