# Round 3 findings and outcomes (final round, at the cap)

Four isolated lenses reviewed `plan-v3.md` on 2026-11-01, scoped to the
round-2 patches (rows 49-63). All four returned REVISE. Full reports:
`round-3-critic.md`, `round-3-logic.md`, `round-3-architect.md`,
`round-3-security.md`.

Counts: 1 BLOCKER (security 1), 18 MAJOR (critic 4, logic 6, architect 5,
security 3), about 30 MINOR.

## Where the findings cluster

| Mechanism | BLOCKER + MAJOR |
|---|---|
| Restart recovery, waits and deliveries (rows 50-53) | 6 (logic R3-1 to R3-6) |
| Owner identity and the tool server (row 54) | 2 (security 1, 2) |
| Ceiling and settings files (row 56) | 2 (security 3, 4) |
| ACP version 2 mode, start-time validation (row 60) | 2 (architect 1, 3) |
| Build order, checkouts, fixtures, lead tasks | 7 (architect 2, 4, 5; critic 1-4) |

Restart, waits and deliveries drew the largest cluster in all three rounds.
review-rounds.md rule 9 says to replace such a mechanism rather than patch
it; the owner already chose to keep it (row 49), so the round-3 fixes were
folded and the choice goes back to the owner with the plan marked not
cleared (rule 10).

## Outcomes

Every BLOCKER and MAJOR is folded into decision rows 64-75, each marked
UNREVIEWED FIX, and into plan v4's criteria, tasks and lead tasks.
Traceability maps each row. Minor findings are folded where the fix was
stated; the rest are accepted as written in the reports, to be checked by
each unit's focused review.

| Finding | Severity | Row |
|---|---|---|
| security 1: owner fallback with both variables stripped | BLOCKER | 64 |
| security 2: tool server could inherit the owner fallback | MAJOR | 64 |
| security 3, 4: refused folders by name; settings writes that never ask | MAJOR | 65 |
| logic R3-1, R3-3, R3-6: reloaded agents look settled; paused agents mishandled; resume without reload | MAJOR | 66 |
| logic R3-2, R3-5: stranded requests; crashed waiters lose their waits | MAJOR | 67 |
| logic R3-4: unclassified errors requeue forever | MAJOR | 68 |
| architect 1, 3: `session/set_mode` fails on ACP v2; start-time refusal impossible | MAJOR | 70 |
| architect 2, 4, 5; critic 1: fake agent cannot call LGTM Studio; 5.4 uses later units; lockfile after unit 2; owner checkout | MAJOR | 71 |
| critic 2: owner-only list | MAJOR | 55, 64 (list built in task 3e and asserted in 3.1) |
| critic 3: error fixtures | MAJOR | accepted: 8a.4 records error samples where the adapter yields them; 6.9 falls back to samples taken from the adapters' source, written in 8a.4 |
| critic 4; architect 10: SECURITY.md list has no writer | MAJOR / MINOR | 72, lead task L4 |
| security minors 5-10; architect minors 6-9; logic minors; critic minors | MINOR | 66, 69, 71, 73-75 |

## Post-build checks added

SEC-PB-5 (both variables), SEC-PB-6 (deny-read on real harnesses),
SEC-PB-7 (slash command from an agent to its child), SEC-PB-8 (Codex core
environment policy).
