# Shephrd

Shephrd is a plugin for [Herdr](https://github.com/herdrdev/herdr) that runs
teams of coding agents as a small company: an orchestrator at the top, team
leads under it, and workers under each lead. They coordinate through a strict
message board that is built for efficiency, so no agent is woken, and no turn
is spent, without a reason.

Shephrd also exposes its state through a network API. The goal is that a
person can start a Herdr server, install Shephrd, and then set up and steer
their teams from a web page, a desktop app, or a phone, with every agent
conversation available as a thread.

> [!WARNING]
> Shephrd is at the very start. Nothing is built yet. This README describes
> the direction, not working software.

## Where Shephrd came from

Shephrd is inspired by [Herdr Synapse](https://github.com/vitalysim/herdr-synapse),
created by [Vitaly Simonovich](https://github.com/vitalysim). Synapse showed
that agents inside one Herdr session can work as a team: a shared board, a
human-owned charter, and a notifier that only speaks to an agent when it can
listen. Shephrd started as a fork of that idea and then took a different
direction, so it is a separate project with its own codebase.

Thank you, Vitaly, for building Synapse and for releasing it under the
Apache License 2.0.

Shephrd also depends on Herdr itself, which hosts the agents and provides the
terminal and session APIs that Shephrd uses.

Shephrd borrows ideas, and some code, from
[T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools Inc., released
under the MIT License. The code Shephrd uses from it is in
`third_party/t3code/`, and the [NOTICE](NOTICE) file lists every piece of
code taken from another project.

## What Shephrd is meant to provide

These are the intended pieces. Each one is tracked in more detail in
[docs/features.md](docs/features.md).

- **The foundry.** The backend that knows about orchestrators, team leads, and
  the different kinds of worker, and that starts, stops, and reassigns them.
- **A strict message board.** Channels per team, direct messages, and clear
  rules for who gets woken by which post. The board's first job is to save
  turns and tokens.
- **Threads.** Every agent's conversation is visible and steerable as a
  thread, in the spirit of [T3 Code](https://github.com/pingdotgg/t3code).
- **A client API.** One authenticated API that the web page, a future desktop
  app, and a future mobile app all use. Nothing a client can do is reserved
  for the terminal.

The team shapes and workflows themselves (which teams exist, what each role is
told to do) are not part of Shephrd. Shephrd is the machinery; the workflows
live elsewhere and are loaded into it.

## Documents

- [AGENTS.md](AGENTS.md): rules for coding agents working in this repository.
- [SECURITY.md](SECURITY.md): how to report a vulnerability, and the security
  rules the design must keep.
- [docs/features.md](docs/features.md): the feature list.
- [docs/issues.md](docs/issues.md): the running list of problems found.
- [docs/specs/2026-11-01-engine-design.md](docs/specs/2026-11-01-engine-design.md):
  the design of the engine, the first of Shephrd's four pieces.
- [docs/research/acp.md](docs/research/acp.md): what the Agent Client
  Protocol is and how it relates to Herdr and to Shephrd's client API.
- [docs/research/t3-code.md](docs/research/t3-code.md): how T3 Code compares
  with Herdr and Synapse, and what Shephrd should borrow from it.
- [docs/research/herdr-and-synapse.md](docs/research/herdr-and-synapse.md):
  what Shephrd keeps from Herdr and Herdr Synapse, and the failures it must
  prevent.

## Licence

A licence has not been chosen yet.
