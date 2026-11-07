# Cold verification of the operational mock, 2026-11-06

This is a read-only verification of the browser prototype at port 4178.
No live service, terminal process, remote machine, or provider account was
changed. The browser probes used fresh Chromium contexts at 1440 × 900 and
390 × 844 pixels. Product files were not edited by the verifier.

## Confirmed live findings sent to the implementer

These findings describe the state when independently reproduced. The
implementer addressed them afterward. The independent recheck recorded
below confirms all six fixes. This list preserves the initial evidence.

1. **Medium — Git history has the wrong branch and project.** Selecting
   Agent recovery, Git, and History produces a header for Buildbox and
   fix/reconnect, but the history identifies feat/workspace as HEAD and
   shows Iris's workspace commits. The fixture is hard-coded in
   `design/workbench.html`, `treeView`, initially line 257. The diff fixture
   also defaults to Workspace code for a recovery file. Scope fixture
   data to the inspected workspace or show that its sample is unavailable.
2. **Medium — Subscription changes appear to work while reconnecting.**
   On Subscriptions, use Preview states to enter Reconnecting. Use for new
   work remains enabled. Unchecking it changes the visible checkbox, but
   reconnecting restores its prior value without explanation. The change
   handler ignores the input while offline, while `renderOperations`
   disables controls only for Settings. Initial anchors: lines 211 and
   266. Disable unsupported mutation controls before interaction.
3. **Medium — Stopping an agent leaves its permission actionable.** Open
   Iris's permission, then Stop agent. The lifecycle says Stopped while
   both permission answer buttons remain enabled. The real engine's
   `packages/engine/src/commands/stop.ts`, lines 10–12, cancels open
   permissions when their agent stops. Questions intentionally remain
   open. The mock stop handler initially at line 227 does not cancel its
   permission. Close the permission and show a cancelled record.
4. **Medium — Logout retains an unsaved carrier token in the hidden DOM.**
   Save a carrier through Settings, type an unsaved sample token, then Log
   out. The owner workspace hides, but `#carrier-token` retains its value.
   `endSampleSession`, initially line 206, should wipe sensitive controls
   on logout and expiry. The live app unmounts owner content on session
   loss. Only a sample-only string was used in the probe.
5. **Medium — Worker role is inconsistent across views.** In Machines,
   choose Worker. Terminal continues to label Studio as Master because
   changing `machineMode` does not update the machine record consumed by
   `terminalView`. Initial anchors: lines 249 and 262. Synchronize the
   displayed current-machine role.
6. **Low — Worker mode exposes a master-only pairing flow.** Machines in
   Worker mode still offers Connect machine, opening Connect a worker.
   Submission is silently ignored by the master-only guard. Hide or
   replace that action with Join a master. Initial anchor: line 258.

## Confirmed live behavior that held

- Terminal states Preview terminal, No process attached, and Nothing runs
  on your computer. Its sample pwd output uses the selected workspace.
  No real command execution was claimed or observed.
- Machines states Pairing preview, No computer is contacted, and No work
  is moved. Subscriptions states that no provider sign-in starts.
- Global Settings navigation works from Terminal.
- Logout hides the owner workspace and exposes the login form.
- Connecting the Work Codex subscription updates it independently of
  Personal and the Claude Code subscriptions. Its private profile is named
  in the sign-in preview.
- Mobile Machines has no page overflow at 390 pixels. The native pairing
  dialog opens, and Escape closes it.
- The independent probe contexts reported no JavaScript errors.

## Existing-page sources checked

The verifier read the live app's authentication routing, thread lifecycle,
permission controls, content rendering, delivery history, Alerts, Settings,
and lifecycle command table. The important semantic difference found was
that stopping an agent cancels permissions, while questions can remain
open. No backend implementation or production-parity claim is established
by these prototype probes.


## Independent recheck after the fixes

Confirmed live on 2026-11-06 at 14:30 UTC, using another fresh Chromium
context and normal controls. All six original findings were resolved:

1. Agent recovery's history identifies fix/reconnect and excludes Iris and
   feat/workspace. Its diff contains delivery.resume(receipt), with no
   Conversation component from the Workspace app fixture.
2. Subscription checkboxes, machine mode, and project-assignment selects
   are disabled while Reconnecting. The reconnect control remains usable.
3. Stopping Iris cancels her permission and removes its answer controls.
   Her Needs approval label clears. Stopping Rowan preserves the separate
   question's answer control, matching the engine's stop semantics.
4. Saving a carrier, typing an unsaved sample token, and logging out clears
   the token field. The owner workspace is hidden.
5. Selecting Worker changes Studio's role shown in Terminal to Worker.
6. Worker mode no longer contains the master-only Connect worker action.

Additional observed outcomes:

- Rejected-login preview keeps the login form and displays its reason.
- Session-unavailable preview hides both owner content and the login form,
  then exposes a retry control. Retry returns to the login form.
- An unconfirmed permission answer displays the uncertainty and disables
  immediate repeat answers. Reopening the permission checks the sample
  record, which remains open, and permits a deliberate retry. This is a
  preview of a refresh; no live server re-query is established by the mock.
- A permission held elsewhere has no owner answer controls.
- The loaded large-item text measures exactly 192000 UTF-8 bytes, matching
  its advertised size. It is scrollable within the thread.
- The permission view has no document overflow at 390 pixels.
- The fresh probe reported zero browser JavaScript errors.

There are no outstanding findings from these concrete verification
journeys. This is verification of the interactive prototype only. It does
not establish live command execution, real machine pairing, provider
sign-in, or production session security.
