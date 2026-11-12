# Round 1 findings and outcomes

Four isolated lenses reviewed `plan-v1.md` on 2026-11-01. All four returned
REVISE. Full reports: `round-1-critic.md`, `round-1-architect.md`,
`round-1-logic.md`, `round-1-security.md`.

Counts: 2 BLOCKER, 31 MAJOR, 13 MINOR (some duplicated across lenses).

## Independent convergence (strong signals)

- Receipts keyed by request id alone: logic 9, architect 6, security 11. Fixed by decision 30.
- No way for clients to find the engine: critic 6, architect 1. Fixed by decision 21.
- Tokens outliving agents and not revoked: logic 12, security 6, architect 7. Fixed by decisions 32 and 36.

## Outcomes

| Finding | Severity | Outcome |
|---|---|---|
| critic 1: no commits exist; worktrees cannot carry uncommitted work | MAJOR | Owner decision (row 17), now with two options in the plan overview. |
| critic 2: scope boundaries | MAJOR | Fixed, decision 46; scopes widened. |
| critic 3: fixtures only from the last step | MAJOR | Fixed, decision 42 (owner-run recording before 6a). |
| critic 4: failure rules 1 and 5 unchecked | MAJOR | Fixed, criteria 6.6 and 6.10. |
| critic 5: `harnesses` and start parameters unchecked | MAJOR | Fixed, criterion 6.11. |
| critic 6: no endpoint | MAJOR | Fixed, decision 21. |
| critic 7: dependencies | MAJOR | Fixed, decision 46. |
| critic 8: rebuild check unprovable in acceptance | MAJOR | Fixed, decision 43. |
| critic 9-12 | MINOR | Fixed in plan v2 (credits wired into `pnpm check`, exact commands, consistent claims, plain-language overview). |
| architect 1-2: endpoint, Node path | MAJOR | Fixed, decisions 21, 22. |
| architect 3: package cycle | MAJOR | Fixed, decision 23. |
| architect 4: account contract vs decision 19 | MAJOR | Fixed, decision 33. |
| architect 5: no writer for secrets | MAJOR | Fixed, decision 40. |
| architect 6: receipts | MAJOR | Fixed, decision 30. |
| architect 7: side tables | MAJOR | Fixed, decision 32. |
| architect 8: auth on the connection | MAJOR | Fixed, decision 21 (credential checked on the WebSocket upgrade over the Unix socket; the 0700 folder is the user check, row 48) and criterion 7.2 (revocation closes live connections). |
| architect 9-12 | MINOR | Fixed, decisions 44, 45. |
| logic 1-3: waits | MAJOR | Fixed, decision 25. |
| logic 4: blocking wait deadlock | MAJOR | Fixed, decision 26. |
| logic 5, 11, 12: routing and rights | MAJOR / MINOR | Fixed, decision 27. |
| logic 6: paused has no exit | MAJOR | Fixed, decision 28. |
| logic 7: no state machine | MAJOR | Fixed, decision 24. |
| logic 8: delivered before accepted | MAJOR | Fixed, decision 29. |
| logic 9: receipts | MAJOR | Fixed, decision 30. |
| logic 10: recovery order | MAJOR | Fixed, decision 31. |
| security 1: agents can read the owner's files | BLOCKER | Owner ruling, decision 47; assumption and cheap hardening written. |
| security 2: ceiling ignores folder, answer options, mode changes | BLOCKER | Fixed, decision 35. |
| security 3: client capabilities | MAJOR | Fixed, decision 34. |
| security 4: inherited environment | MAJOR | Fixed, decision 33. |
| security 5-6: secrets in text, token transport | MAJOR | Fixed, decision 36. |
| security 7: file modes | MAJOR | Fixed, decision 37. |
| security 8: TCP loopback squatting, no Origin check | MAJOR | Fixed, decision 21 (Unix socket; TCP moves to piece 2). |
| security 9: agent text in engine prompts | MAJOR | Fixed, decision 38. |
| security 10: adapter paths, install scripts, live repo | MAJOR | Fixed, decision 39; the live-repo part folds into decision 47's owner ruling. |
| security 11-12 | MINOR | Fixed, decisions 41, 31. |

## Post-build checks proposed by reviewers

Carried into the plan's "Post-build checks" section: architect PB-A1 to PB-A7, security SEC-PB-1 to SEC-PB-3.

## New mechanisms introduced while folding (UNREVIEWED MECHANISM, for round 2)

- The lifetime lock as a separate SQLite file in exclusive locking mode (decision 31).
- The Unix-socket endpoint, HTTP upgraded to WebSocket over the socket, folder mode as the user check, replacing the loopback WebSocket (decisions 21, 48).
- "Settled" as the wait condition (decision 25).
- Three-step deliveries (decision 29).
- Rights passing to the nearest idle-or-working ancestor (decision 27).
- The folder rule for children (decision 35a).
- The "account available" timer event (decision 28).
- `debug.compare-views` (decision 43).
