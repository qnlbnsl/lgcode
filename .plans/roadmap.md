---
kind: roadmap
updated: 2026-11-10
---

# Roadmap

LGTM Studio is meant to make it possible for anyone to install LGTM Studio, and set up and steer teams of coding agents from a phone,
with every agent's conversation available as a thread.

## Now

The owner lifted the development freeze on 2026-11-08. On 2026-11-10 the owner
set the build loop as the next work, after a plan.

| Kind | Name | Overview |
|---|---|---|
| other | Mock, second round | The rebuilt mock in `design/mock/` gets the owner's walkthrough feedback. The brief is `design/mock/ROUND-2-BRIEF.md`. |
| plan | build-loop | The investigation of 2026-11-10 and the plan to reach the build loop. It is `.plans/plans/build-loop/plan.md`, and it awaits the owner's approval. |

## Next

| Kind | Name | Overview |
|---|---|---|
| other | Website replacement | Five build steps that add what the mock needs to the engine and replace the web page. The list is `.plans/plans/website-replacement/todo.md`. |
| other | Review findings | Fix the 20 Claude and Grok foundation findings still on `master`, which issue 519 lists. |
| other | Default workflow | The build loop in `docs/specs/2026-11-05-build-loop-design.md`, with the hotfix, bisect and freeze additions still to be designed. |
| other | Sandbox and hostile review | Agents run in a sandbox, and the owner runs the hostile review. |

## Done

| Kind | Name | Overview |
|---|---|---|
| epic | lgtm-foundation | The engine, the client API, the message board and the foundry roles are merged, apart from the standing permission rules. The epic is parked. |

## Later

| Kind | Name | Overview |
|---|---|---|
| other | Interactive mode | Running a harness's normal terminal program in a Herdr pane, behind the same delivery interface, for harnesses where that is cheaper, such as Claude Code. |
| other | Desktop and phone apps | Native apps on the client API, after the web page and the Herdr-pane thread viewer. |
| other | A Visual Studio Code extension | Threads and approvals in a side panel of Cursor or Visual Studio Code, as a client of the same API. |
