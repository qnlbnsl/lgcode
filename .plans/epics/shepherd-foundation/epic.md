---
topic: shepherd-foundation
kind: epic
status: active
parked: false
updated: 2026-11-03
---

# Shephrd runs the Foundry's teams on its own

## Outcome

Shephrd, a Herdr plugin, runs teams of coding agents over the Agent Client
Protocol: an orchestrator, team leads and workers, coordinated through a
strict message board, and visible and answerable from a web page, a phone,
or a pane in Herdr. The Foundry skill no longer needs Herdr commands or shell
scripts to start, watch, approve or wake its agents.

## Done when

- The Foundry skill's Steps 3 to 5 and 8 run through Shephrd alone, with no
  `herdr agent` command and no `collect.sh` or `board-waker.sh`.
- The owner answers a permission request and reads a thread from a phone
  that was paired with a one-time code.
- A message on the board wakes only the agent that needs to answer it.

## Plans

| Order | Plan slug | What it delivers | State |
|---|---|---|---|
| 1 | shepherd-engine | The engine: agents over ACP, the event log, commands, permissions, waits, accounts, and one authenticated API. | linked |
| 2 | shepherd-client-api | Device pairing, phone alerts, encrypted remote access, the web page, and a thread viewer in a Herdr pane. | planned |
| 3 | shepherd-message-board | Channels, direct messages and wake rules, behind one delivery interface. | planned |
| 4 | shepherd-foundry-roles | The orchestrator, team leads, workers, standing permission rules and the sheepdog. | planned |

`planned` — named slice, no `.plans/plans/<slug>/plan.md` yet.
`linked` — that plan exists and its `epic:` is this slug.

## Out of scope

- Team shapes and workflows. They live outside Shephrd (`AGENTS.md`, rule 6).
- Interactive mode, where an agent runs in a Herdr pane. It follows this epic.
- The desktop and phone apps themselves. Piece 2 gives them their API and a
  web page.

## Choices

- 2026-10-30: the owner split Shephrd into four pieces and chose to build the
  engine first, then the client API, the message board and the foundry roles.
  The engine comes first because the other three are built on its
  capabilities.
- 2026-11-01: the client API needs its own short design round, because the
  first design session designed only the engine.
- 2026-11-03: the three later plans edit the engine directly wherever they
  need to. The owner's words: "dude. change it. that is the whole point of a
  phased build. why do we want to work around something when we can edit
  it." This replaces the line of 2026-10-30 that the later pieces are built
  on the engine "without changing it". There is no extension-seam layer and
  no rule that existing behaviour stays the same. A plan may add commands,
  event kinds and a caller kind for services, and may change existing
  behaviour when it needs to. Each such change is recorded in that plan's
  decisions log, its tests are updated, and it is reviewed like an engine
  unit.
