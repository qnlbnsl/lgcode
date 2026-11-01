# Shepherd: problems found

A running list of problems found while building or using Shepherd. Add a
problem here in the same change that finds it, even if it is not fixed yet.
Never delete an entry; mark it fixed and say where.

Each entry uses this shape:

```
## <number>. <what is wrong, in one line>

Found: <date>, while <doing what>.
State: open | fixed in <commit or pull request>.

What happens: <the observed behaviour>.
What should happen: <the expected behaviour>.
Why it matters: <the cost, such as wasted turns, lost messages, or a security risk>.
```

## 1. The engine's event log has no retention rule

Found: 2026-11-01, while writing the engine design
(`docs/specs/2026-11-01-engine-design.md`).
State: open.

What happens: the first version of the engine keeps every event forever,
including every streamed message and tool call of every agent.
What should happen: old events are summarised or archived by a rule the
owner can set, without breaking the rebuild of the views or a client's
catch-up from a sequence number.
Why it matters: the SQLite file grows without limit, and starting the
service gets slower as the log it rebuilds from gets longer.

## 2. Node.js 26 ships without pnpm or Corepack

Found: 2026-11-01, while installing Node.js 26.13.0 with nvm.
State: worked around on the owner's host on 2026-11-01: pnpm 12.16.1 is
installed with pnpm's standalone installer, in `~/.local/share/pnpm/bin`.
The README's setup steps still need to say this.

What happens: Node.js 26 installs only `node`, `npm` and `npx`. Corepack,
which older Node.js versions used to provide pnpm, is no longer bundled, so
`pnpm` is not available under Node.js 26.
What should happen: the build plan installs pnpm for Node.js 26 at the
version named in the root `package.json` before unit 1 runs
`pnpm install`.
Why it matters: every build step and `pnpm check` need pnpm; without it,
unit 1 fails at its first command.
