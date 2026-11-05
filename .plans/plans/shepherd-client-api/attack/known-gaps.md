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
  48 launches in the sizing section.
- **`docs/issues.md` and `docs/features.md` are not updated here.** They
  go through the lead. The wanted entries are in the planner's result
  file.

## Gaps the owner accepted

- **An agent on the same user can read the password.** Agents run as the owner's
  Unix user, so an agent can read the engine's first environment through
  `/proc/<pid>/environ`, and then log in. The password protects against the network.
  It is not a boundary against an agent until the own-user setup exists (rows 78, 188,
  SECURITY.md).
- **There are no rate limits or lockouts.** The owner chose this (row 184). The setup
  document asks for a long string.
- **A logout signs out every client,** because there is one token. So does a restart
  (row 186).
- **Shephrd has no Unix user of its own.** Any agent can read Shephrd's
  state folder, including the stored account keys (row 78).
- **A logged-in session can change the alert carrier's server and topic,** and so
  redirect or silence alerts. A session is the owner. The token does not follow a
  change of server (rows 88, 93).

## Gaps the plan names and leaves open

- **A dashboard can lock itself out.** Turning the web server off, or changing the
  public address, closes its own connection, and only the owner's terminal can set it
  back (row 195).
- **A cookie is not scoped to a port.** Two engines on one host replace each other's
  cookie, and any local program that the browser visits on `127.0.0.1` receives it.
  The first costs a login. The second is the local-program limit that rule 2 of
  SECURITY.md already states.
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
- **The owner supplies HTTPS for the public page.** Shephrd serves HTTP on
  loopback and requires an HTTPS public address (row 204). The owner configures
  the proxy certificate and device trust. Interim remote access uses an SSH local
  forward at `http://127.0.0.1:<port>`, with identical device and server ports.
- **ntfy's own settings cannot be enforced.** The owner's server decides its
  access rules. `docs/remote-access.md` advises deny-all, and Shephrd cannot
  check it (row 115).
- **A question from a stopped asker stays open in the engine.** Answering it
  queues a reply to a stopped agent. The alert closes, by the level table, but
  the question row remains. The wanted issue is in the planner's result file
  (row 107). A permission request no longer has this gap, because `stop` closes it
  (row 163). A row left open by an older log stays until a restart closes it.
- **A very large reply cannot reach a very slow link.** Two connections stop a
  large reply from costing the stream its acknowledgement. But a WebSocket sends a
  message whole, and a heartbeat waits behind it. So an event or a snapshot large
  enough to miss two heartbeats on the read connection is still unreadable on that
  link. The shortest effective timeout is the server's two missed 25-second heartbeats,
  50 seconds. The browser's read connection has a 50-second ping timeout of its own,
  checked on a 25-second tick, so it is no shorter. At 500 kilobits per second, 50
  seconds is about 3 mebibytes. A shorter `heartbeatSeconds` setting lowers this, and the
  client's fixed ping values do not follow it. The reconnect retries with a growing
  pause, and PB-15 measures it on the owner's phone (rows 160, 179).
- **The connection cap serves 16 subscribing pages.** Each page holds two connections
  out of 32. With more than 16 pages open, each new connection closes the oldest, so
  the pages keep displacing one another (row 160).
- **A slow recovery can cost one reconnect.** A recovery read that outlasts the
  stream's queue lets the stream connection close. That costs a reconnect, and never
  the read (row 160).
- **The wait helper's gate costs a read at each candidate result.** On a busy log
  with several pieces, the lists may keep arriving at different sequences, so a wait
  can take several reads to agree. It never ends wrongly (row 159).
- **A throwing alert source loses that event's alert.** The engine keeps running, and
  the error log shows it, with no text. A level scan finds an open matter only at the
  first start (row 161).
- **An agent's command-line stream is not wrapped.** A stream is never an MCP tool,
  and the wrapping covers `client.thread`, `client.event` and the tools. An agent that
  runs `shephrd client subscribe` reads the events as the engine's own `subscribe`
  gives them today (row 166).
- **A squatter on the loopback port.** While the web server is down, or never started
  because the variable is not set, another local user can bind `127.0.0.1` at its port.
  It can then show a fake login form and capture the password. In proxy mode, it can also
  serve the phone a page with a long cache lifetime under the real public address. SECURITY.md
  states this. The setup document says that a `client.web-down` alert means the page must
  not be opened, and a missing variable raises no alert. **The lead tells the owner** (rows
  167, 187).

## Round minors, not folded

By the manager's rule for the final round, only the majors and the re-anchor item were
folded. These minors of round 4 stay open.

- **R4-A2, architect, and C4-01, critic.** The Codex diff join has no persisted tool-call
  id, because `runner/translate.ts` drops it from file-change content. So edit E29's join
  by `toolCallId` cannot find a Codex diff, and criterion 7.12's Codex-shaped case can show
  only the locations and the fixed warning until an optional id is added to file-change
  content.
## Facts the planner could not verify

- **The owner's real proxy.** It does not exist yet, and the owner said "a caddy or
  something". Post-build check PB-2 tests it once it does (row 198).
- **The owner's ntfy server.** Post-build check PB-5 confirms that it honours
  the sequence id and the delete by it.
