# The redesign keeps the current page’s capabilities

The owner required these capabilities to stay on 2026-11-06. This document
maps the current page’s source to the interactive browser mock. It records
interface coverage. It does not claim that the mock connects to the engine. The stub functions
that stand in for the client API are mapped to their real commands in
[data/README.md](data/README.md).

## Existing behavior represented in the mock

| Capability | Current page source | Where to try it in the mock |
|---|---|---|
| Login, logout, and session expiry | `packages/web/src/app.tsx` | Log out in the navigation footer. Use a sample password to return. Design notes includes expired, rejected-login, and unavailable-session states. An unavailable session offers retry before login. Password and token inputs clear on session loss. |
| Connection status | `packages/web/src/watchSituation.ts`, `thread/watch.ts` | The top bar shows Live, Connecting, or Reconnecting. Reconnecting retains the last view and draft. Mutating controls are disabled until reconnection. Design notes supplies these preview states. |
| Permission requests | `packages/web/src/thread/request.tsx` | Sage links to Iris’s exact request. The request shows its identity, tool, and action input before Allow once and Deny. Finch demonstrates redacted input. Design notes demonstrates a held request and an unconfirmed answer. Held requests cannot be answered here. An unconfirmed answer requires reopening the request before another attempt. |
| Stop and resume | `packages/web/src/thread/lifecycle.tsx`, `packages/engine/src/commands/stop.ts` | Controls sit beside each agent composer, including the lead panel. Stopping cancels outstanding permissions. Questions remain answerable. Resume explains when it would start a fresh session without the old context. |
| Failed-start reasons | `packages/web/src/thread/index.tsx`, `packages/contracts/src/startFailure.ts` | Ash starts with the fixed Not signed in reason. Alerts links to his thread. Design notes offers every current safe failure category. A failed start cannot accept a prompt. An unresolved retry keeps its reason. |
| Large thread items | `packages/web/src/thread/index.tsx` | Iris has a 192,000-byte item with an explicit full-item loader. Design notes can fail the next load. Retry loads the complete sample into a bounded, scrollable text area. |
| Tool calls and delivery history | `packages/web/src/thread/content.tsx`, `thread/delivery.tsx` | Iris’s tool detail preserves its call identity, status, input, and output. Approval does not imply a successful tool result. Delivery details preserve sender, source, identity, and queued/sent/accepted/held/released/requeued states. New sample prompts add their own delivery history. |
| Alerts | `packages/web/src/admin/alerts.tsx` | A global page shows open and cleared requests, subject links, delivery attempts, and final failures. Refresh and Load more alerts work on the sample list. Links open the relevant question, permission, or agent. |
| Settings | `packages/web/src/admin/settings.tsx`, `packages/contracts/src/client/settings.ts` | A global page retains all twelve push categories, carrier destination, write-only token state, clear actions, and web enable/port/heartbeat/proxy/public-address controls. Canonical HTTPS origins are validated. The page states the live service’s connection and restart consequences. Sample values persist across navigation. |

All agent text and action data remain escaped data. The operational controls
are separate from the agent’s prose. Entered sample passwords and tokens
are never saved to browser storage. The token control retains only a
boolean saying whether a sample token is set.

## Development workspace and fleet views requested next

The owner also requested these views on 2026-11-06.

| View | Interactive preview | Live integration still required |
|---|---|---|
| Home | Default cross-project page with Needs attention, All projects, Questions, and Approvals. Search combines with repository, project, agent, machine, and status filters. Questions and permissions are answered in place. Merge approvals reuse explicit review. Answered history remains searchable. Source links preserve conversation drafts. | A durable global request index, authoritative answer results, concurrent-owner handling, access checks, pagination, and recovery across reconnects. Existing operational request states must be preserved. |
| Terminal | Fills the main area as a character grid with the prompt in the grid. A slim bar has named sessions, branch, machine, and size in columns and rows. `pwd`, `ls`, `git status`, `git branch`, and `git log --oneline` return in-memory fixture output. `vim <file>` shows a full-screen program. Unsupported input returns Command unavailable. | A real pseudo-terminal on the selected host, a terminal emulator in the page such as xterm.js, authenticated attachment, streamed input/output, resize in columns and rows, the alternate screen for full-screen programs, interruption, reconnection, and session ownership. The browser must not infer permission from agent messages. |
| Git / Source Control | Repository/project/team worktree hierarchy, staging and unstaging, commit message and commit, fetch/pull/push, conflict resolution, and team-to-project integration. Project-to-main integration opens an explicit review. Dirty destination worktrees block integration. Clicking a file directly opens its unified or split diff. Commit history uses the same diff pane. State stays scoped to each worktree. | Read real changes and Git history on the selected machine. Execute Git mutations with permissions, recoverable failures, branch ancestry and merge checks. Bound large-file rendering. Branch inspection remains distinct from a project’s assigned workspace. |
| Workspace Settings | A workspace tab shows the assigned repository, branch, checkout type, folder, and machine. A shell preference is saved per project within the preview. | Persist workspace preferences and apply the shell when starting a real terminal session. |
| New repository | New project offers New repository beside the repositories in the workspace folder. It asks for a name and previews the folder. | Create the folder and run `git init` on the selected machine, inside the workspace folder, with recoverable errors. |
| Project worktree | New project defaults to Start work tree. A safe project-name slug sets the branch and folder. Collisions get numeric suffixes. Opting out uses that repository’s main checkout. | Create the real worktree on the assigned machine with checked paths, collision handling, and recoverable Git errors. |
| Machines | Master and Worker modes, a pairing preview with confirmation, worker availability, and per-project placement. Offline or unconfirmed workers cannot receive new placement. Worker mode cannot assign projects. | One master coordinates paired workers. Pairing needs an authenticated, expiring exchange and confirmation of machine identity. Workers report capabilities, repository locations, and health. Dispatch needs durable identities, capacity checks, and recovery without duplicate execution. Moving a running project is separate from choosing a machine for a future run. |
| Subscriptions | Multiple named entries for the same harness, a machine for each entry, independent sign-in state, active-agent counts, and an enable toggle. Adding an entry starts signed out. Sample sign-in updates only that entry. | Wire account configuration and provider authorization to existing engine account support. `packages/contracts/src/accounts.ts` already gives accounts separate identities. `packages/engine/src/accounts/shadowHome.ts` already isolates additional Codex authentication profiles. Do not replace those with one shared login per harness. |

The question of implementing the live terminal and distributed backend was
asked separately during this pass. No answer had arrived when the mock was
built. Terminal execution, machine pairing, project movement, and provider
sign-in remain in-memory interactions. At the owner’s request, the interface
uses normal product copy. Prototype boundaries stay in this documentation. No shell command, remote
connection, provider authorization, or billing action is performed by them.

## Verification evidence

Serve `design/` on port 4178. From the repository root, run the browser
checks with Playwright and Chromium available. `revision-checks.mjs` passed 4 of 45
checks that could run on the mock before the 2026-11-06 review. The later findings of that
day's designer critique added more checks to it.

```sh
node design/checks.mjs
node design/operations-checks.mjs
node design/workspace-tools-checks.mjs
node design/workspace-redesign-checks.mjs
node design/home-checks.mjs
node design/revision-checks.mjs
node design/data-checks.mjs
node design/data/validate.mjs design/data/sample/events.json design/data/heavy/events.json
```

`data-checks.mjs` covers which data files load, what is derived from events, what each command
writes, and a real database built from the engine's migrations, exported, and loaded. It checks
every row the commands wrote against the engine's contracts.

The script checks accept `MOCK_URL`, `PLAYWRIGHT_MODULE`, and
`CHROMIUM_PATH`. They use independent browser pages and do not call a real
service. Results and screenshots are under `design/previews/`.
Independent verification and the reproduced issues are recorded in
`previews/operations-cold-verification.md`. The workspace refinement has
additional scope, integration, context, and mobile evidence in
`previews/workspace-redesign-cold-verification.md`.

The Home and machine-aware creation pass has additional independent evidence
in `previews/home-cold-verification.md`: 42 successful checks and zero browser
errors. Remote creation resolves the selected host's repository path and main
checkout. Hosts without that repository remain unavailable. Machine rows are
compact table records. Placement changes apply to future runs and do not
pretend that running work moved. Real host repository discovery, worktree
creation, dispatch, migration, and persistent queue history remain integration work.

The owner's next revision replaces split request details with collapsed
single-line rows. Each chevron expands the details immediately beneath its
own row. Keyboard focus stays on the toggle. Existing permission, question,
merge, reconnect, and answered-history controls remain inside that expansion.
The sidebar groups Home/search, Projects/new project/project filtering, and
service pages with visible borders. Repository labels remain destinations;
the duplicate global Repositories link is removed.
Independent verification is recorded in
`previews/inline-requests-cold-verification.md`: 53 passing assertions, zero
browser errors, and successful rechecks of focus handoff and the merge link.
