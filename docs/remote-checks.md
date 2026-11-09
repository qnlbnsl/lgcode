# Running the tests on another computer

The owner's development computer also runs other projects, and a full
`pnpm check` uses many processors for several minutes.
The `remote-` targets in the root `Makefile` copy a working tree to another
computer over Secure Shell (SSH) and run the tests there.
The owner's Arch Linux computer at `192.168.141.18` is the default.

## What the other computer needs

The other computer needs these programs:

- SSH access by key, without a password prompt;
- `rsync`, `git`, `flock` and `bash`;
- Node.js at the version in `.nvmrc`, either through nvm or installed directly;
- pnpm, for example from `npm install -g pnpm`.

Run `make remote-doctor` to see what is present and what is missing.
Run `make remote-install` once per working tree to install the dependencies
and the Chromium browser that the browser tests use.
Playwright does not install system libraries on Arch Linux.
If Chromium fails to start, install the `nss`, `alsa-lib` and `gtk3` packages with pacman.

## Using it

Run each target from the working tree that should be tested:

- `make remote-check` runs `pnpm check`.
- `make remote-test FILES="packages/engine/test/x.test.ts"` runs Vitest on
  some files; leave `FILES` empty to run every Vitest test.
- `make remote-browser` runs only the browser tests.
- `make remote-run CMD="pnpm -r typecheck"` runs any command.
- `make remote-clean` deletes the copy.

Each target first copies the working tree, including uncommitted changes.
It prints the commit and the number of changed paths, so a result can be tied
to the source it tested.
Each working tree gets its own copy, named after its folder, under
`~/lgcode-remote` on the other computer.
The exit status is the remote command's.

## Settings

Set these on the `make` command line:

- `REMOTE_HOST`: the SSH host or alias.
- `REMOTE_USER`: the user on that host.
- `REMOTE_ROOT`: the folder that holds the copies.
- `REMOTE_NAME`: the copy's name.
- `REMOTE_SLOTS`: how many `remote-check` and `remote-browser` runs may use the
  other computer at once, 2 by default.

Later runs wait for a free slot.

## What is never copied

Only files that Git would see are copied: tracked files, and new files that
no ignore rule covers.
Rules in `.git/info/exclude` count, so `.scratch`, `.worktrees`, `.foundry`
and the Herdr Synapse state stay on this computer.
The test setup already removes the harnesses' credential variables before any
test runs.

The live checks (`pnpm live-check` and `pnpm live-check:web`) are not offered.
They use the owner's harness accounts on this computer.
