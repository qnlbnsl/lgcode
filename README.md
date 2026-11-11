# LGcode

LGcode is a standalone program that runs teams of coding agents as a small
company. An orchestrator directs team leads, and each lead directs workers.
The agents coordinate through a strict message board.
The engine, board, authenticated application programming interface (API), and
web page are the core program.

An optional [Herdr plugin](plugins/herdr/README.md) connects the core program
to [Herdr](https://github.com/herdrdev/herdr) for terminal panes and future
interactive sessions.
The core runs without Herdr installed.
LGcode ships a default workflow that people can override.

> [!WARNING]
> LGcode is under development. The engine, authenticated client API, message
> board and foundry supervision code are merged. The owner lifted the development
> freeze on 2026-11-08 for the website build. The findings of two of the
> three foundation reviews are not yet checked against this code. Standing
> permission rules remain unbuilt, pending the owner's harness recordings.
> Real-account and physical phone checks remain separate owner-run work. This
> is not a released or cleared build, and the capabilities below still include
> planned work.

## Where LGcode came from

The project was called Sheprd until 2026-11-08.

LGcode is inspired by [Herdr Synapse](https://github.com/vitalysim/herdr-synapse),
created by [Vitaly Simonovich](https://github.com/vitalysim). Synapse showed
that agents inside one Herdr session can work as a team: a shared board, a
human-owned charter, and a notifier that only speaks to an agent when it can
listen. LGcode started as a fork of that idea and then took a different
direction, so it is a separate project with its own codebase.

Thank you, Vitaly, for building Synapse and for releasing it under the
Apache License 2.0.

The optional plugin uses Herdr to host terminal panes.

LGcode borrows ideas, and some code, from
[T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools Inc., released
under the MIT License. The code LGcode uses from it is in
`third_party/t3code/`, and the [NOTICE](NOTICE) file lists every piece of
code taken from another project.

## What LGcode is meant to provide

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

LGcode comes with one default workflow, the
[build loop](docs/specs/2026-11-05-build-loop-design.md). Anyone who wants a
different workflow overrides it in `~/.lgcode`, or for one repository in that
repository's `.lgcode`. Particular team shapes (which teams exist, what each
role is told to do) are not part of LGcode. They live elsewhere and are loaded
into it.

## Start LGcode without Herdr

This checkout needs Node.js 26 and pnpm.
From the repository root, select Node.js and install the dependencies:

```sh
nvm use
pnpm install --frozen-lockfile
pnpm --filter @lgcode/web build
```

Start the service with a web password in its environment:

```sh
read -rs LGCODE_WEB_PASSWORD
export LGCODE_WEB_PASSWORD
./bin/lgcode serve --detach
unset LGCODE_WEB_PASSWORD
```

The `read` command above works in Bash and Zsh.
Enter a long, random password at its prompt, then press Enter.
Open `http://127.0.0.1:8787` and log in with that password.
The web password must contain at least eight characters.
The engine's default state folder is `~/.local/state/lgcode`.
Set `LGCODE_HOME` on the service and command processes to use another folder.
The service continues running after the launching terminal closes.
The terminal thread viewer is available through `./bin/lgcode view`.

The service command also works without a web password.
In that case, the authenticated Unix socket is available and the web server
stays off.
See [remote access](docs/remote-access.md) before using a proxy or a phone.
An installer, startup at login, and loading project configuration from
`.lgcode` are the next piece of work.

## Documents

- [AGENTS.md](AGENTS.md): rules for coding agents working in this repository.
- [SECURITY.md](SECURITY.md): how to report a vulnerability, and the security
  rules the design must keep.
- [docs/features.md](docs/features.md): the feature list.
- [docs/issues.md](docs/issues.md): the running list of problems found.
- [docs/specs/2026-11-01-engine-design.md](docs/specs/2026-11-01-engine-design.md):
  the design of the engine, the first of LGcode's four pieces.
- [docs/research/acp.md](docs/research/acp.md): what the Agent Client
  Protocol is and how it relates to Herdr and to LGcode's client API.
- [docs/research/t3-code.md](docs/research/t3-code.md): how T3 Code compares
  with Herdr and Synapse, and what LGcode should borrow from it.
- [docs/research/herdr-and-synapse.md](docs/research/herdr-and-synapse.md):
  what LGcode keeps from Herdr and Herdr Synapse, and the failures it must
  prevent.

## Licence

A licence has not been chosen yet.
