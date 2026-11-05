# Review round 4 findings and how each was folded

This file lists every finding of review round 4, the owner's Codex-only final round, on
commit `8a34e59`. Four reviewers found 0 blockers, 1 major and 5 minors, with no refusals.
Logic found nothing new. By the manager's rule, only the major and the lead's re-anchor
item are folded, as contract version 13, with rows 179 to 181 of `decisions.md`.

## The one major, for the owner

### R4-A1. The read connection's ping timeout defeats the slow recovery

- **What can go wrong:** On a slow phone link, a large reply takes longer than the RPC
  (Remote Procedure Call) client's built-in 5-second watchdog allows, so the connection
  drops and the same read repeats for ever, even with the two connections from round 3.
- **The fix:** The web page's read connection now allows 50 seconds of silence, which
  matches the server's own heartbeat rule, and the stream connection keeps the short
  watchdog.

## The re-anchor to engine `9e386b0`

The plan's recorded engine commit and its line anchors moved from `8ff4c9b` to `9e386b0`,
which is 73 commits later. No mismatch changes a design (row 181).

## Every finding

| Finding | Severity | What was wrong | What happened | Row | Criterion |
|---|---|---|---|---|---|
| R4-A1 | major | The default ping timeout prevents the promised slow recovery. | Folded in section 5 and edit E32. | 179 | 7.14 |
| C4-03 | minor | E12 needs one more credential branch on the newer engine. | Folded as the re-anchor item. | 180 | 1.34 |
| R4-TM-1 | minor | E12 must also adapt the new stop preflight. | Folded with C4-03. | 180 | 1.34 |
| R4-A2 | minor | The Codex diff join has no persisted tool-call id. | Not folded. In the known gaps. | none | none |
| C4-01 | minor | The same as R4-A2. | Not folded. In the known gaps. | none | none |
| C4-02 | minor | Device attribution does not name start's later writes. | Not folded. In the known gaps. | none | none |
