# AGENTS.md

Instructions for any coding agent working in this repository: Claude Code,
Codex, OpenCode, Pi, or another. `CLAUDE.md` imports this file, so there is
one set of rules.

## What this project is

LGcode is a standalone program with a web page and an optional
[Herdr plugin](plugins/herdr/README.md). It runs
teams of coding agents (an orchestrator, team leads, and workers), connects
them through a strict message board, and exposes everything through an
authenticated client API for web, desktop, and mobile apps. Read
[README.md](README.md) before starting any task.
Start it without Herdr through `./bin/lgcode serve --detach`.
Set `LGCODE_WEB_PASSWORD` on the service to enable the web page.
The core must not import the optional plugin.

LGcode is a separate project from
[Herdr Synapse](https://github.com/vitalysim/herdr-synapse), which inspired
it. It is not a fork in the git sense and does not track Synapse's history.

## Status

The foundation is merged into `master`: the engine, the client API with the
current web page, the message board, and the foundry roles. The standing
permission rules remain unbuilt, pending the owner's harness recordings.

Development is frozen. The owner froze it on 2026-11-07, until the website
mocks are ready, and only the owner lifts the freeze. While it holds, do not
add application code unless the owner asks for it in the current task. Work on
the mocks under `design/` continues, as do the documents that record them.

## Language

LGcode is written in TypeScript, decided by the owner on 2026-10-30. The
backend, the web page, and the future desktop and mobile apps share one
language, so the client API's types are defined once and used by every
client. Code borrowed from TypeScript projects such as T3 Code is copied, not
ported.

LGcode is written with the [Effect](https://effect.website) library,
version 4, decided by the owner on 2026-11-01, so that T3 Code's Effect code
can be copied. Effect 4 is newer than most agents' training, so look up its
current documentation before writing Effect code; do not write it from
memory.

LGcode runs as a Node.js program on Node.js 26, the current long-term
support line, decided by the owner on 2026-11-01. The `.nvmrc` file says
`26`; run `nvm use` before working in this repository.

## How agents are run

Every harness has two run modes, chosen per harness in its settings,
decided by the owner on 2026-10-30:

- **ACP mode** is built first. LGcode runs the agent as a child process and
  drives it through the Agent Client Protocol.
- **Interactive mode** is built second. LGcode opens the harness's normal
  terminal program in a Herdr pane through the optional plugin.

The board, the roster, and the thread view must not depend on which mode an
agent uses. Keep the mode-specific code behind one delivery interface, so an
ACP agent and an interactive agent can sit on the same team.

## Rules

1. **Never push to, or open a pull request against,
   `vitalysim/herdr-synapse`.** The only remote for this repository is
   `qnlbnsl/lgcode`.
2. **Credit every piece of copied open-source code.** Ideas and designs can
   be reused freely, but copied code carries its licence's obligations. When
   code is copied or ported from another project, such as Herdr Synapse
   (Apache License 2.0) or T3 Code (MIT License):
   - Put it under `third_party/<project>/`, with the project's licence file
     next to it and a `README.md` naming the source commit, each source file,
     and what was changed.
   - Add an entry to the root [NOTICE](NOTICE) file.
   - Name the source project and file in the commit message.
   - Keep the original copyright lines. If the code is later moved into
     LGcode's own source tree, the moved file starts with a comment naming
     where it came from and its licence.
3. **Keep the lists current.** A new feature idea goes into
   [docs/features.md](docs/features.md). A problem found while working goes
   into [docs/issues.md](docs/issues.md) in the same change that finds it,
   even if it is not fixed.
4. **Follow [SECURITY.md](SECURITY.md).** Its "Security rules the design
   keeps" section is binding. A change that weakens one of those rules needs
   the owner's explicit approval in the current task.
5. **The client API is the product's surface.** Anything the owner can do
   from the terminal must also be possible through the API, so a web or
   mobile client is never a second-class citizen.
6. **Only the default workflow belongs here.** LGcode provides roles, the
   board, the API, and one default workflow, the
   [build loop](docs/specs/2026-11-05-build-loop-design.md). Anyone who wants a
   different workflow overrides it in `~/.lgcode`, or for one repository in
   that repository's `.lgcode`. The definitions of particular teams live
   outside this repository.
7. **Agents have full authority inside a team.** They commit, push and merge
   on their team's branches and worktrees without asking, using the git
   commands LGcode allows them. Moving finished work into the base branch is
   done by a pull request, and the owner approves it. There is one exception,
   decided by the owner on 2026-11-05: a build loop fix sprint that users would
   not notice merges on its own after a full test run passes. Anything users
   would notice keeps the owner's approval.

## Writing style for documents

Documents in this repository are read by a person with ADHD on a
black-and-white terminal. Write in full sentences with articles and commas.
Make headings name their content. Put one claim in each sentence. Expand
every acronym the first time it appears in a document.
