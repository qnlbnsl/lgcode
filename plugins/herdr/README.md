# The optional Herdr plugin

LGcode runs independently of Herdr.
This plugin connects Herdr's startup hook, actions, and terminal viewer pane
to the standalone program.
Interactive agent sessions remain later work.

The manifest is `herdr-plugin.toml` in this directory.
Use this directory as the plugin root when installing it in Herdr.
Herdr's environment must find the `lgcode` command and Node.js 26 on `PATH`.
For a checkout, add the repository's `bin` directory and the selected Node.js
version's `bin` directory to that path before starting Herdr.
The installer is later work.

The startup hook and the Start LGcode action run `lgcode serve --detach`.
The thread pane runs `lgcode view`.
The View LGcode threads action runs the plugin's `src/openPane.ts` entry point.
It authenticates the owner through the core client before asking Herdr to
open the pane.
An agent identity, including an agent whose identity variables were removed,
cannot use this action to become the owner.

Set the web password only on the standalone service that starts LGcode.
Do not put it in Herdr's environment.
See [the startup instructions](../../README.md) and
[the remote access guide](../../docs/remote-access.md).

`pnpm live-check` checks the manifest's startup command twice in a private
state folder when Herdr is installed.
It checks that the second invocation reuses the same service.
It reports SKIP when Herdr is absent.
The check does not launch Herdr or change the owner's running engine.
