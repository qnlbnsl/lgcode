revise
Grade: 6  B/M/m: 0/4/0  Flags: none

## Scope and disposition

This is a plan review at commit `8ff4c9b2e0e49b817b3b2102ae2ed01823a462c5`. Repository paths and line citations below refer to that commit. `plan.md`, `contract.md` and `decisions.md` refer to the frozen client API folder. `inputs/` refers to the supplied review inputs. I reread the refreshed material, including decisions row 90 and criteria 5.4 and 10.1. The revised Host and Origin rules are included in this assessment.

The checkout was clean. No application code was changed, no tests were executed, and no attack probes were performed. No reviewer scratch was created. This report is the sole output.

The verdict asks for corrections to the snapshot contract and verification gate, and records two problems in the alert credential design. Team rule 8 expressly defers security fixes. The lead should record the security findings in the issue list and notify the manager for the owner's attack to-do list. This review does not impose a security veto, reverse an accepted risk, or choose a fix or acceptance on the owner's behalf.

## Findings

### TM-1. A new alert credential will be removed during startup

**MAJOR. Category:** Design; Security (integrity). **Responsibilities:** integrity and secrets. **Evidence:** confirmed conflict between the planned consumer and the existing collector. **Builder:** client API backend, with the engine recovery owner.

An owner configures an ntfy token that is referenced by alert settings and by no account. The next recovery removes the stored value. Alerts that require authentication then fail until the owner enters the credential again.

Plan criterion 6.9 obtains the token from the existing store by reference (`plan.md:510`), and task 6b.1 expressly selects `secrets.json` (`plan.md:520`). Recovery retains only account secret references and account environment references (`packages/engine/src/recovery/restart.ts:139`). It runs that collector on startup (`packages/engine/src/recovery/restart.ts:282`). `retainOnly` physically replaces the secret file without other entries (`packages/engine/src/accounts/SecretStore.ts:51`). No alert reference participates in this ownership calculation.

The plan's promise that existing behaviour and changed tests are enumerated therefore needs one more engine edit. Name the collector change and extend existing test `6.7 R22 issue 119` at `packages/engine/test/recovery/restart.test.ts:606`. That test currently proves that only current account references survive. Keep its abandoned and replaced secret checks while adding live alert references. Specify how a carrier token is entered, replaced and removed without creating a dummy account. Include current alert references in collection only after the relevant settings have been rebuilt. This is loss of a replaceable credential, rather than permanent loss of the owner's project data.

### TM-2. A database read transaction does not make a live snapshot agree with its cursor

**MAJOR. Category:** Design; Bug (timing). **Responsibility:** integrity. **Evidence:** confirmed mismatch with the engine's publication model. **Builder:** client API engine integration.

E9 says to read the views and durable log head in one read transaction so they agree (`contract.md:947`). The live views are an in-memory reference (`packages/engine/src/views/Views.ts:15`, `packages/engine/src/views/Views.ts:41`). They are published after the database transaction commits (`packages/engine/src/log/EventLog.ts:261`, `packages/engine/src/log/EventLog.ts:133`). A database read transaction does not lock that reference.

A client can read views at sequence N, then read a head of N+1 after an append. It receives a snapshot missing the new event but subscribes after N+1. The missing transition is skipped for that client until a fresh snapshot repairs it. Reversing the reads can produce the opposite mismatch. Open permissions, alerts and delivery state are particularly consequential examples of stale client state.

Define one capture boundary before implementation. Either derive the cursor from the same immutable view used to construct every section, or briefly hold the writer permit while capturing the head and views. The repository already demonstrates the latter at `packages/engine/src/views/compare.ts:47` and `packages/engine/src/views/compare.ts:63`. Release the permit before formatting or network delivery. Require piece sections and the shared one-sequence wait inputs to use that captured view. Add a deterministic test that pauses an append between commit and publication and connects a client; every transition must occur in its snapshot or subsequent stream exactly once.

### TM-3. The outbound credential boundary is not specified for an editable ntfy destination

**MAJOR. Category:** Security (confidentiality); Design. **Responsibilities:** confidentiality and secrets. **Evidence:** unresolved pre-build policy. **Builder:** client API alert backend, with a lead decision on the credential contract.

The owner and web caller can change the ntfy server, topic and token reference (`contract.md:651`). The carrier resolves that reference and sends a token (`plan.md:510`). Criterion 6.12 protects events and logs only (`plan.md:513`). These requirements do not specify which secret references the carrier may resolve, whether a token is bound to a destination, whether changing the server preserves the previous token, or which remote transport schemes and redirects are permitted.

This matters even for an ordinary settings change. Replacing a server address while retaining its credential can disclose that credential to a different operator. A generic reference also leaves open whether an account credential may be selected and sent as an ntfy token: the existing resolver accepts any stored reference (`packages/engine/src/accounts/SecretStore.ts:65`). An unencrypted remote carrier connection would expose its authorization header and alert metadata in transit. The encrypted phone-to-Shephrd proxy leg does not establish encryption on the separate engine-to-ntfy leg.

The official [ntfy publishing documentation](https://docs.ntfy.sh/publish/#access-tokens), checked on 2026-11-03, documents bearer-token authorization. A token is therefore an outbound secret, even though it is correctly absent from the alert body. The [ntfy proxy configuration documentation](https://docs.ntfy.sh/config/#behind-a-proxy-tls-etc), checked on the same date, supports deployment behind a TLS proxy; the server setting alone does not establish that deployment.

Decide the reference scope and destination binding before the carrier is built. Use dedicated carrier credentials, or an equivalently enforced purpose restriction. Specify whether an origin change clears the credential or requires an explicit new credential association. Specify encrypted remote delivery, including any explicit encrypted-tunnel exception, and prevent credential forwarding across origins or an encryption downgrade during redirects. A local fake test server can remain an explicit test exception. Keep these controls in the carrier boundary; this suggestion does not add a fourth host-only action.

The accepted gap allows redirecting or silencing alerts. That acceptance is narrower than a policy allowing unrelated stored credentials to leave the host or allowing a previously configured credential to follow a new destination. If the lead considers those consequences accepted too, broaden the known gap explicitly and record the owner's decision. Do not silently infer that acceptance from the open-server ruling.

### TM-4. The proposed regression gate excludes the repository's test runner

**MAJOR. Category:** Design (verification). **Responsibility:** integrity of the shared engine change. **Evidence:** confirmed command and manifest mismatch. **Builder:** client API plan owner.

The common gate for edits to the engine, contracts, client, command-line client and Model Context Protocol server is `pnpm -r test` (`plan.md:245`). The root owns `test: vitest run` and the full `check` script (`package.json:10`). The engine package has only a typecheck script (`packages/engine/package.json:13`); the other existing affected package manifests likewise do not supply the root suite. There is no workspace-root inclusion setting in the supplied workspace configuration.

The [pnpm recursive command documentation](https://pnpm.io/cli/recursive), checked on 2026-11-03, states that recursive run and test exclude the root unless workspace-root inclusion is enabled. Thus this gate does not establish that the existing engine regression suite passes. Depending on matching scripts, it may fail for lack of a script or execute only future package tests.

Require the root `pnpm test` or `pnpm check` explicitly, with any targeted package checks added alongside it. Correct criterion 1.1 and every repeated use of this gate. Keep the existing changed-test allowlist check as a separate requirement. This finding concerns a proposed command; it does not allege that the author claimed a test run that did not occur.

## Risk register

Scores use severity × fallout × probability. Standard bands below are informational where team rule 8 supplies the owner's standing security deferral. No closing evidence exists at this plan stage. No individual risk acceptance is inferred.

| Id | Severity and reason | Fallout and reason | Probability and reason | Score and standard band | Evidence | Responsible builder | Decision and deadline |
|---|---|---|---|---|---|---|---|
| TM-3 | 6: a stored credential or private metadata may be disclosed | 7: disclosure cannot be recalled | 6: changing a server or configuring a remote carrier is an ordinary specific action; unresolved policy is scored at its worst plausible probability | 252; before release | Unresolved | Alert backend and lead | Security fixes deferred by team rule 8; lead records the scope decision and manager follow-up. No individual acceptance or expiry recorded. |
| TM-1 | 6: authenticated push fails until repaired by hand | 3: owner can re-enter the credential | 8: restart is a common operating path once alerts are configured | 144; schedule | Confirmed | Alert backend and recovery owner | Security fixes deferred by team rule 8; lead assigns the follow-up. No individual acceptance recorded. |
| TM-2 | 6: client state can miss a transition until manually refreshed | 3: a new snapshot repairs that client | 6: connecting while agents append is an ordinary specific action | 108; schedule | Confirmed | Engine integration | Owner or lead decision pending; standard deadline is this phase or an owned, dated follow-up. |
| TM-4 | Not scored: required verification gate | Not applicable | Not applicable | Correct the gate before relying on it for merge | Confirmed | Plan owner | Required gate must execute the root suite. |

## Six responsibilities and the data inventory

| Responsibility | Boundary traced and result |
|---|---|
| Isolation | This deployment represents one owner. Agent visibility is narrower than owner visibility. Current-holder checks on reads, live delivery and catch-up are stated, and board text is owner-only. Accepted same-user file access and the open web API preclude stronger isolation claims. |
| Identity and sessions | Unix authentication remains. Web access deliberately maps to device access with owner audit identity and a reserved open-web device id. Pairing, per-device authentication and provider sign-out are deferred. There is no current authenticated web sign-out or another-account sign-in flow to certify. |
| Access control | E2 checks credential kind before owner mapping and receipts; E4 reauthorizes reads. Services remain in process with per-service command lists. The three host-only actions remain pairing-code creation, listener/public-address settings and standing-rule creation. The refreshed Host/Origin requirements cover missing Origin on non-static requests and WebSocket upgrades. |
| Integrity | The shared append path, receipt rules, projected-batch checks and transactional withdrawals preserve the intended write boundary. TM-1 and TM-2 identify integration gaps; TM-4 weakens its verification. |
| Confidentiality | Account/device views are sanitized; thread pages are bounded; agent text is data in web and terminal rendering. Outbound alerts intentionally contain names and group labels. TM-3 concerns the separate carrier boundary. Browser and provider copies need the checks below. |
| Secrets and dependencies | Existing secret files use mode 0600 and directory mode 0700 (`packages/engine/src/accounts/SecretStore.ts:42`), rather than encryption at rest. Same-user readability is accepted. Secret reference retention is TM-1. Existing redaction reads stored values; no separate claim that ntfy is absent from redaction is filed. New RPC merging, socket limits and copied-code attribution remain implementation checks. |

The stored-copy inventory includes the SQLite event log, receipts, side tables and write-ahead log; rebuilt in-memory views; `secrets.json`; client snapshots, stream buffers and UI memory; local thread exports and harness session copies; and ntfy server storage and phone notifications. Durable event history and exported files do not disappear when a browser closes. Secret collection is reference-based. This plan does not promise complete historical deletion or remote erasure, and this review does not invent that promise.

The official [ntfy caching documentation](https://docs.ntfy.sh/publish/#message-caching), checked on 2026-11-03, describes server-side message caching. An alert clear or local dismissal is therefore not proof that a provider or phone copy is erased. Record the deployment's topic access, retention and subscriber transport assumptions. Provider credentials can be revoked externally; local retry state must not turn a revoked token into a logged secret. Browser persistence should be inventoried during implementation before any claim about clearing private data is made.

## Shared engine edits E1 to E23

I checked the listed edits against the recorded engine and the supplied board contract version 7 and roles plan version 8. Apart from the findings above, I found no additional confirmed consumer incompatibility or missing named existing-test change.

| Edits | Review result |
|---|---|
| E1–E4 | The command union, access table, planner dispatch and read dispatch are the necessary extension points. Access before receipt lookup is important because the current handler maps devices to owner at `packages/engine/src/CommandHandler.ts:205`. Read replies must remain outside durable receipts and be reauthorized. |
| E5–E7 | Event tags, piece state and owned side tables are enumerated. The state-machine and subscription sample updates are named. New piece state must survive rebuild and current-batch projection; a piece table does not replace core event handling. |
| E8–E10, E21–E22 | The new read ceiling, paged log column and exported helpers match the consumer direction. The changed subscription visibility expectation is named. E9 needs TM-2. Dotted command names need executable registry coverage. |
| E11–E14 | Caller/actor separation, caller columns and device audit identity address live versus replay consistency. Service identity must stay distinct even though its commands share the engine append path. |
| E15–E18 | Piece sender attribution, withdrawal defaults, ownership checks and transactional send-time reach meet the board's queue/revocation needs. Core agent return notices stay agent-specific. The existing delivery reservation transaction is at `packages/engine/src/routing/deliveries.ts:217`. |
| E19–E20 | Delivery-aware settlement and held requests are needed by board waits and role capacity. Their projection must include the pending batch, including a withdrawal and its subsequent wait completion. |
| E23 | The bounded piece batch builder keeps core events and direct writer access outside services. Its withdrawal, reach and wait checks are essential consumer requirements, rather than optional implementation details. |

Roles-plan wording still makes device access to `roles.rules.add` conditional on the client API's host-only ruling (`inputs/roles-plan.md:363`). That condition is resolved by this client API contract. Carry the resolved denial into its access-table test, including the device case; do not implement the stale conditional as a fresh permission choice. This is synchronization guidance, not a second finding that the boundary is absent.

## Proposed post-build checks

1. **PB-TM-1, engine/API builder:** Exercise every caller kind against the merged commands. Reject host-only commands from open-web and authenticated device credentials before owner mapping and receipt replay. Reject service identities at both external transports. Exercise each service's actual fixed command list. Evidence: matrix tests through the real handlers.
2. **PB-TM-2, engine/API builder:** Lose effective holding during a read, catch-up and live subscription. Verify current authorization, sanitized snapshots and paged logs, including actor/device/service decoding. Read marks must not disclose or store a forbidden reply. Evidence: interleaving and replay tests.
3. **PB-TM-3, board integration builder:** Revoke reach after queueing, withdraw an eligible delivery, and verify later eligible work progresses. Include projected-batch wait completion and held role requests. Evidence: delivery and wait tests through the shared handler, without direct log writes from a service.
4. **PB-TM-4, engine integration builder:** Test the snapshot/publication race in TM-2 and prove board sections and one-sequence condition lists use the same captured state. Evidence: deterministic barriers around commit and publication, with no skipped or duplicate client transition.
5. **PB-TM-5, alert/recovery builder:** Restart with account and carrier secrets, then replace and remove each reference. Retain every live reference and collect only unused ones. Evidence: an extension of recovery test 6.7 R22 plus a configured authenticated fake carrier after restart.
6. **PB-TM-6, alert builder:** After the policy decision in TM-3, test origin changes, unrelated references, redirects, downgrade attempts, revoked tokens and retry errors. Inspect events, receipts, logs and client responses for secret values. Evidence: fake endpoints and inspection assertions. These tests verify a decided boundary; they cannot substitute for deciding it.
7. **PB-TM-7, web/terminal builder:** Render hostile names, messages, links and terminal controls through real clients. Confirm the content security policy and no command-bearing alert links. Inventory HTTP caching, browser storage and exported copies. Evidence: browser and terminal tests plus a short copy/retention inventory.
8. **PB-TM-8, transport builder:** Execute the refreshed Host/Origin criteria using a real browser, then check the actual reverse proxy's forwarded headers and socket payload limits. Keep plan checks PB-1, PB-2 and PB-4. Evidence: deployment and library-version-specific results, without treating a fake process adapter as proof about the owner's host.

## Refused

None.

## Noted, not filed

- The open web API, deferred pairing, missing separate Unix user, process-guard escapes and the ability to redirect or silence alerts are disclosed owner decisions. An owner deliberately bypassing a self-imposed limit is not a new finding.
- Caddy header verification, vendor allowances, unwritten scopes, the paired-phone epic wording and lead-owned issue/feature updates are already known gaps. The refreshed public-address Host and Origin allowlist is not reported as missing.
- Standing-rule matching, agent-controlled strings and outbound metadata still warrant the planned implementation tests. No exploit or failing implementation is claimed from their existence alone.
- Persistent harness permission options and Shephrd standing rules must remain clearly distinguished in the mock review. I did not infer a new prohibition on existing permission answers from the host-only rule-creation decision.
