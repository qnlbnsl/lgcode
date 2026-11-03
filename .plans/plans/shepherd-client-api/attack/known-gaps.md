# Known gaps in the client API plan

This file lists what the planner knows the plan does not close, so the
review panel does not report it as a new finding. Each gap names who can
close it. "Rows" are rows of `decisions.md` in this folder.

## Gaps the planner cannot close from the plan folder

- **The new scopes are not written.** Units 2 to 11 use the scopes
  `client-api/contracts`, `client-api/backend` and `client-api/mobile-ui`.
  The planner writes only its plan folder, so the lead writes them with the
  scoping skill before the build (row 53). The `client-api/infra` scope
  that row 53 names is no longer needed, because unit 9 is removed
  (row 78).
- **Each vendor's remaining weekly allowance is unknown.** The planner
  cannot read it. The lead checks each vendor's limit before launching the
  51 launches in the sizing section.
- **The owner's question 6 is pending.** The plan folds the recommended
  answer: from a device caller, the engine refuses a persistent or
  always-allow option (row 95, edit E28, criterion 1.41). The other answer
  removes that one edit and that one criterion. AGENTS.md rule 5 changes only
  after the owner answers.
- **Row 51 is widened.** No owner quote backs the exclusion of the VS Code
  extension, so the row stays open until the lead cites one or the owner
  confirms it. The plan builds no extension (row 121).
- **`docs/issues.md` and `docs/features.md` are not updated here.** They
  go through the lead. The wanted entries are in the planner's result
  file.

## Gaps the owner accepted

- **The web server is open.** Until authentication is added, any agent on
  the machine that gets past the guard, and anyone who reaches the owner's
  proxy, can act with the owner's control through the web server
  (row 80, SECURITY.md rule 2, suspended). That includes answering
  permission requests and starting agents with full access.
- **Shephrd has no Unix user of its own.** Any agent can read Shephrd's
  state folder, including the stored account keys (row 78).
- **A caller of the open web server can change the alert carrier's server
  and topic,** and so redirect or silence alerts. Such a caller could already
  answer requests, so this adds no new power (row 88). The token does not
  follow a change of server (row 93). The alert about the change also goes to
  the old carrier as a best effort, and a restart can remove the old token
  first, so on a deny-all server that send can fail (row 139).

## Gaps the plan names and leaves open

- **Lasting settings stay open to the web.** A harness's adapter path and
  arguments, an account's environment and secrets, the carrier's server and
  topic, and the roles' role file and settings can all be changed by a web
  caller, and they outlast the moment's access. None grants more than the open
  server already gives, so none moved to the computer-only list. A change
  raises a `client.lasting-setting` alert, whose push a device caller cannot
  switch off, and nothing prevents the change. A web caller can still dismiss
  the alert, and the computer's list still shows it (rows 98, 139).
- **A same-user proxy can look like a local browser.** With proxy mode on, a
  proxy running as the owner's user that adds no forwarded address and rewrites
  `Host` cannot be told from a browser on the host. The setup document requires
  both forwarded headers and recommends the proxy's own user, and PB-2 fails on
  a missing header. Nothing stops an owner running such a proxy (row 133).
- **A failing alert writes to the log.** An open alert keeps retrying at the
  10-minute cap for as long as it stays open, so it adds one small event every 10
  minutes while the carrier is down (row 131).
- **A plain account value reaches every web client.** A value under a name that
  does not look like a secret is stored in `AccountChanged`, and the stream and
  the `accounts` read carry it. The snapshot does not, and the setup document
  warns the owner (row 141).
- **The number of agents in a snapshot is not capped.** Its request and question
  rows are bounded by construction, and a fixture test covers the rest (row 137).
- **The owner still reads the input.** The page shows a tool's input before
  "Allow", and a prompt injection can still shape an input that looks ordinary
  (row 132).
- **A phone can get an alert twice.** Delivery is at least once. A crash
  after the carrier accepts and before the local record sends it again. ntfy's
  sequence id replaces the earlier one where the server honours it (row 106).
- **Plain HTTP inside WireGuard is refused.** A public request must carry
  `X-Forwarded-Proto: https`, so an owner who wants plain HTTP inside
  WireGuard cannot have it. This goes beyond the ruling. The owner can ask for
  the other choice (row 113).
- **ntfy's own settings cannot be enforced.** The owner's server decides its
  access rules. `docs/remote-access.md` advises deny-all, and Shephrd cannot
  check it (row 115).
- **A question from a stopped asker stays open in the engine.** Answering it
  queues a reply to a stopped agent. The alert closes, by the level table, but
  the question row remains. The wanted issue is in the planner's result file
  (row 107).

## Where the same-machine guard fails

The guard of row 84 is a guard, not a security boundary. SECURITY.md says
so. A deliberate agent gets past it in these ways:

- It starts a process that leaves its process tree, for example with
  `setsid` and a double fork, so the process has no agent ancestor.
- It asks a program that is not its descendant to connect for it, such as
  a user service manager, a scheduled job, or a terminal outside its tree.
- It reaches the web server through the proxy from another machine or
  network namespace whose address is inside the allowed client networks and
  is not one of the host's own.
- Its adapter dies, so an orphaned process no longer has a recorded ancestor
  (`packages/engine/src/api/ancestry.ts:33-36`).

If the host hides other processes' `/proc/<pid>/fd` links, the guard
refuses every same-user peer, including the owner's own browser on the
host. Post-build check PB-4 confirms this on the owner's host.

## Facts the planner could not verify

- **The owner's real proxy.** Caddy's documentation answers how its defaults
  treat `X-Forwarded-For`, `X-Forwarded-Proto` and `Host`, but the owner said
  "a caddy or something". Post-build check PB-2 tests the real one (rows 89,
  113).
- **The owner's ntfy server.** Post-build check PB-5 confirms that it honours
  the sequence id and the delete by it.
