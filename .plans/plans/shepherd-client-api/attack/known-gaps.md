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
  47 launches in the sizing section.
- **The epic's second "done when" names a paired phone.** It reads "a
  phone that was paired with a one-time code". The owner deferred pairing
  (rows 80, 86), so unit 11 proves the flow without pairing. The lead
  rewords the epic.
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
- **A caller of the open web server can change the alert carrier's
  settings,** and so redirect or silence alerts. Such a caller could
  already answer requests, so this adds no new power (row 88).

## Where the same-machine guard fails

The guard of row 84 is a guard, not a security boundary. SECURITY.md says
so. A deliberate agent gets past it in these ways:

- It starts a process that leaves its process tree, for example with
  `setsid` and a double fork, so the process has no agent ancestor.
- It asks a program that is not its descendant to connect for it, such as
  a user service manager, a scheduled job, or a terminal outside its tree.
- It reaches the web server through the proxy from another machine or
  network namespace whose address is not one of the host's own.
- It runs a container as another user, whose connection then looks like a
  non-agent's.

If the host hides other processes' `/proc/<pid>/fd` links, the guard
refuses every same-user peer, including the owner's own browser on the
host. Post-build check PB-4 confirms this on the owner's host.

## Facts the planner could not verify

- **Caddy's forwarded-header behaviour.** Whether Caddy's reverse proxy
  appends to or replaces a client-sent `X-Forwarded-For` is not checked
  here. Post-build check PB-2 checks it before criterion 10.2 is written
  (row 89).
