# Error samples and their sources

Each sample is a JavaScript Object Notation (JSON) object with `harness`,
`kind`, `text`, `source`, and `verified` fields. The filename is
`<harness>-<kind>.json`. The recorder refuses an empty source and scrubs every
field before writing a sample.

`verified: false` means that the text has not been observed in a live recording.
The initial samples name the installed adapter source, an upstream source read
on 2026-11-01, or an explicitly unverified placeholder. A source prefix or
structured error indicator is labelled as such. It is not a complete live error.
The Cursor samples are placeholders because its adapter source is not open.

The owner-run `pnpm record-fixtures` command replaces signed-out samples for
installed harnesses with authentication failures observed under fresh temporary
homes, without account variables. Those samples have `verified: true`. It
keeps unverified samples when no authentication failure is observed and reports
the harness under `signedOutNotObserved`, without failing the recording.
It drops inbound extension frames before retaining their contents, and reports
only their count as `droppedExtensionFrames` for each harness. It
records ordinary sessions in separate private temporary workspaces after the
adapter confirms read-only mode through a configuration option. It removes its
temporary folders when it ends. The command spends a small amount of real usage
and is not run by the test suite.

The first installed adapter reports protocol version 1 in its pinned source.
The fake agent reports version 2 by default, or version 1 when its script sets
`protocolVersion: 1`. The recorder offers version 2, accepts a
version 1 or 2 response, detects the response shape, and records the negotiated
version in the transcript header. A harness without a mode configuration option
is refused. In particular, a source snapshot that exposes modes only through
the older mode command will require a compatible harness update before it can
be recorded.
