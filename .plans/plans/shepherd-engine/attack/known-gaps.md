# Known gaps (acknowledged; reviewers hunt NEW problems only)

1. Gate 10 load line: the planner cannot read each vendor's remaining weekly allowance; the launch counts are estimates, and the lead checks limits before launching.
2. Closed in round 3: `McpServer.layerStdio` exists in Effect 4.0.5 (round-3 architect).
3. Codex adapter reload: round 3 found both adapters replay through `session/resume`; the runner still reads capabilities at run time (row 66).
4. Decision 11 (Shepherd's licence) is open by assumption.
5. Herdr does not supervise plugin startup commands; restart after a service crash is manual or the next Herdr start (owned by piece 2 and later).
6. The event log has no retention rule (docs/issues.md problem 1).
