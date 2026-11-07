---
kind: roadmap
updated: 2026-11-07
---

# Roadmap

Sheprd is meant to make it possible for anyone to install Sheprd, and set up and steer teams of coding agents from a phone,
with every agent's conversation available as a thread.

## Now

Development is frozen from 2026-11-07 until the website mocks are ready. The
owner lifts the freeze.

| Kind | Name | Overview |
|---|---|---|
| other | Website mocks | The mock under `design/` is under construction, and it is the golden reference for the website. |

## Next, after the freeze

| Kind | Name | Overview |
|---|---|---|
| other | Website replacement | Five build steps that add what the mock needs to the engine and replace the web page. The list is `.plans/plans/website-replacement/todo.md`. |
| other | Review findings | Check the Claude and Grok foundation findings against `master`, as issue 519 records. |
| other | Default workflow | The build loop in `docs/specs/2026-11-05-build-loop-design.md`, with the hotfix, bisect and freeze additions still to be designed. |
| other | Sandbox and hostile review | Agents run in a sandbox, and the owner runs the hostile review. |

## Done

| Kind | Name | Overview |
|---|---|---|
| epic | shepherd-foundation | The engine, the client API, the message board and the foundry roles are merged, apart from the standing permission rules. The epic is parked. |

## Later

| Kind | Name | Overview |
|---|---|---|
| other | Interactive mode | Running a harness's normal terminal program in a Herdr pane, behind the same delivery interface, for harnesses where that is cheaper, such as Claude Code. |
| other | Desktop and phone apps | Native apps on the client API, after the web page and the Herdr-pane thread viewer. |
| other | A Visual Studio Code extension | Threads and approvals in a side panel of Cursor or Visual Studio Code, as a client of the same API. |
