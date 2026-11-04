ship
Grade: 10  B/M/m: 0/0/0  Flags: none

## Scope and findings

No new finding within the four assigned changes. This is a plan verdict, not implementation clearance.

I started with `inputs/changes-since-last-review.diff`, checked the password rulings and the final-round rulings, and followed the changed requirements into contract version 15 and the recorded engine. The checkout is `9e386b0b0fef88a1951a1a088ed5ac78e6b711cc`. Repository citations below refer to that commit. Planning citations refer to this run's frozen files. `contract.md`, `plan.md` and `decisions.md` are in the parent folder of this report. Paths beginning `review/` are relative to `.scratch/foundry-runs/foundation-plans-1/`.

## The password login and the routes around it

The access decisions are sufficiently defined before the build.

| Entry point | Required boundary and result |
| --- | --- |
| `POST /api/login` | The Host and Origin checks apply before login. The body is bounded, and SHA-256 digests are compared with `timingSafeEqual`. A wrong password earns no cookie and writes no event. See `contract.md:317` and `contract.md:367`. |
| `POST /api/session` | A valid cookie earns HTTP 204. An absent or invalid cookie earns HTTP 401. This does not reveal account state. See `contract.md:340`. |
| `POST /api/logout` | Authentication is required by the rule for every API request. Logout rotates the token and closes every web connection. See `contract.md:327` and `contract.md:332`. |
| WebSocket upgrade and all other API routes | `webCaller` requires a valid session before any remote procedure call. It supplies the existing owner credential variant internally. No route manufactures its own caller. See `contract.md:332` and `plan.md:515`. |
| Static files | Only files containing no account data are exempt from the session check. Static GET and HEAD requests still receive the Host check. See `contract.md:336`, `contract.md:367` and `plan.md:523`. |
| The Unix socket | Its owner and agent authentication remain. Device credentials are removed, and no service credential becomes available on the wire. See `contract.md:347`, `contract.md:433` and edit E12 at `contract.md:1715`. |

The session has 32 random bytes and exists only in memory. The browser receives an HttpOnly, SameSite=Strict cookie with Path=/, and a public login sets Secure. Logout and restart invalidate every old cookie. These decisions meet the approved single-owner model without retaining a pairing or device path (`contract.md:317`, `contract.md:327`). Browser code no longer needs a credential header or access to the cookie value (`contract.md:340`, `contract.md:2158`).

Host and Origin checks remain independent of the password. Missing and foreign Origins are refused on login, session, logout and upgrades. The proxy table requires forwarded HTTPS for public requests and refuses a public Host combined with a loopback Origin. Outside proxy mode it refuses forwarded headers. See `contract.md:367` and `contract.md:1330`. Removing peer identification and client-network settings therefore leaves the password as the network authentication boundary, exactly as the owner ruled. The example proxy and the owner's negative connectivity checks remain additional deployment controls (`plan.md:740`).

Removing the computer-only list gives a valid session the owner's existing rights. It does not add a credential-free route to standing rules, settings or approvals. `debug.compare-views` remains absent from the web group (`contract.md:386`; `packages/contracts/src/commands.ts:139`). I found no command requiring a newly invented computer-only exception.

## Secrets, stored copies and the six responsibilities

1. **Isolation.** There is one owner. Anonymous network callers receive neither the owner's data nor authority. Agent and service access remains distinct from owner access. The removed peer guard is not treated as a replacement for authentication.
2. **Identity across sessions.** Logout rotates the shared token and closes connections. Restart creates a fresh token. There is no promise of several users or selective device revocation. The browser keeps no thread data in persistent application storage (`plan.md:645`). Clearing visible state and reacting to another client's logout need implementation verification below.
3. **Access.** The route inventory above accounts for the session exceptions. The Unix socket retains its independent boundary. Invalid credentials must still fail before stop preemption.
4. **Integrity.** Session state introduces no database table or migration. E12 removes the unused device table through a new migration and requires preservation of every other row (`plan.md:338`). The existing event and receipt model continues to carry durable owner actions.
5. **Confidentiality.** The remote hop requires HTTPS at the owner's proxy. Plaintext remains confined to the approved local hop. The existing unencrypted local secret store remains within the accepted operating-system boundary. The stored-copy inventory distinguishes database history, browser memory, static cache, exports, proxy logs and carrier copies (`contract.md:1373`). Logout does not claim to erase exported files, engine history or delivered notifications.
6. **Secrets and dependencies.** E34 captures and deletes the password before the service copies its environment, registers it explicitly, and supplies the current session token to the redactor (`contract.md:2380`). The corresponding existing sites are `packages/engine/src/service.ts:37`, `packages/engine/src/service.ts:82`, `packages/engine/src/service.ts:92` and `packages/engine/src/service.ts:104`. The redactor reads the registry on every call (`packages/engine/src/identity/redactor.ts:236`). The ACP runner filters reserved account variables, builds an allowed environment, and spawns without environment extension (`packages/engine/src/runner/AcpRunner.ts:324`, `packages/engine/src/runner/AcpRunner.ts:359`, `packages/engine/src/runner/AcpRunner.ts:379`; `packages/engine/src/runner/baseEnvironment.ts:13`). Interactive mode has no implemented spawn path in this build. E34 names the future pane requirement and requires the variable to be set on the service alone. No new dependency-security decision is needed for these changes.

## The last major and the engine re-anchor

R4-A1 is addressed at the plan level. E32 sets the browser read connection's ping interval to 25 seconds and timeout to 50 seconds, while retaining the stream connection's default (`contract.md:2332`). I checked the pinned Effect 4.0.5 source at `/home/qnlbnsl/projects/personal/herdr-synapse/sheprd/node_modules/.pnpm/effect@4.0.5/node_modules/effect/src/rpc/RpcClient.ts:1062` and `:1244`. The options exist, and the pinger checks time since its last decoded frame on a tick. Criterion 7.14 requires the production protocol and the throttled one-mebibyte case (`plan.md:648`). The larger-reply limit remains a named known gap.

The earlier stop-preflight concern is also addressed. At the recorded commit, the owner branch already exists in both `preemptStart` and ordinary execution (`packages/engine/src/commands/CommandHandler.ts:211`, `:243`). Returning that credential from `webCaller` uses both existing paths. E12 removes both device branches and retains invalid-agent refusal (`contract.md:1720`). The existing tests at `packages/engine/test/commands/start-setup.test.ts:55` and `:83` support the named preservation checks. Criterion 5.2 adds the real web-session stop case. There is no remaining open-web variant requiring a new handler branch.

E29 now names `cleanStructure` and its credential-coverage argument for arbitrary tool input (`contract.md:2219`). That matches `packages/engine/src/runner/AcpRunner.ts:173`, which cleans keys and string leaves. It avoids inheriting the schema discriminator exemption for an input field named `_tag`. The declaration is correct against the newer engine. I found no additional security defect caused by a named re-anchor change.

## The added redaction identities

The distinction between an identifier and text matches the recorded implementation. Event string exemptions are structural (`packages/engine/src/identity/redactor.ts:211`). Receipt strings use the same structure traversal (`packages/engine/src/log/EventLog.ts:220`). Array entries need `elements`, while object entries need `fields`.

- Client API E33 lists fixed service and namespace names, rule identifiers, generated alert identifiers and keys derived only from identifiers, sequences and fixed words. It uses `alertKey`, and leaves generic `key`, tool input and descriptive strings subject to redaction (`contract.md:2350`).
- Board B13 preserves `to`'s existing actor fields while adding array elements. It uses actor shapes for authors and other actors, element shapes for lists, and the event-specific `replyToPostId` field. This preserves the existing moved-request actor representation at `packages/engine/src/log/redactionStructure.ts:26`. See `review/board-r6/shepherd-message-board/plan.md:411` and its criterion 3.7 at `:653`.
- Roles task 1b exempts `roleFileHash`, `noticeRecipient`, `postId` and the rule's harness identifiers at their named positions. Rule words, notes, role names, group names and role-file content remain text. It relies on E33 for actor service fields. See `inputs/roles-plan.md:614` and `:621`.

I found no new exemption that is specified to hold free text. Implementation must preserve these shapes rather than exempting entire objects.

## Proposed post-build checks

- **TM5-PB-1, web server builder.** Exercise the route inventory through the real router, including malformed paths, GET and HEAD requests under `/api`, recovery, and invalid cookies. Require no private static fallback and no command dispatch before authentication. Extend criteria 5.2 through 5.5.
- **TM5-PB-2, web server and page builders.** Race logout with an upgrade and an active stream on both connections. Require the old token to authorize no surviving connection or later command. On another client's logout, require a return to login and removal of previously displayed private state. Check restart and settings changes too. Extend criteria 5.6 and 7.1.
- **TM5-PB-3, web server builder.** Verify password and session redaction with the real service logger, rejected login bodies, cookie headers, protocol diagnostics, receipts and adapter output. Check registration after token rotation. The Set-Cookie transport of a successful login is the necessary cookie delivery, not a general reply exposing the token. Extend criterion 5.17 and PB-10.
- **TM5-PB-4, engine and piece builders.** Run the identifier collision fixtures against the real event writer and receipt writer, then rebuild. Include `PermissionMoved.to`, board addressee arrays, rule harness arrays, ordinary strings under shared field names, and a secret in arbitrary tool-input keys and `_tag`. Require identifiers to retain their joins and all text to remain redacted. Use client criteria 1.46 and 2.10, board 3.7 and roles 1.8.
- **TM5-PB-5, client transport builder and owner acceptance.** Complete criterion 7.14 with the actual pinger, and PB-2 with the actual proxy. Include rewritten Host, missing forwarded HTTPS, cookie attributes and a phone-alert navigation from outside the site. These are existing checks, not new access decisions.

## Risk register

There are no new confirmed or unresolved findings to score. Owner-accepted limits and named known gaps remain in their existing register.

## Noted, not filed

The single password, lack of rate limits and lockouts, shared logout, same-user access through `/proc` and private files, deferred separate operating-system user, cookie sharing across ports, loopback-port squatting, dashboard self-lockout, existing account-value exposure, large-reply limit and deferred mobile login are accepted choices or named gaps. I did not re-file them. The unfolded Codex tool-call join minor remains outside this final fold.

An owner deliberately changing their own trusted proxy or bypassing a self-imposed limit is not a new finding.

## Verification record

This was a source and plan review. No application tests or attack probes were run. The review checkout remained clean, and no repository document was edited.

Documentation was checked on 2026-11-03. Context7 returned a quota error. I used the pinned Effect source and the official documentation instead. Initial guessed source URLs and dependency paths did not resolve; the recorded local 4.0.5 path resolved and supplied the version-specific evidence. No check remains blocked by those lookup failures.

The hash comparison matches the documented equal-buffer-length requirement in [Node.js crypto](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b). The cookie decisions agree with [Mozilla's Set-Cookie reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie). [Caddy's header defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults) support the setup assumptions, while the actual deployment still needs PB-2. The [Effect RPC client documentation](https://effect.website/docs/v4/api/effect/rpc/RpcClient/#makeprotocolsocket) agrees with the pinned pinger source used above.

The assigned scratch directory was empty and was removed before writing this result. This result is the only file written.

refused: none.
