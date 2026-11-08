// Task 8a.2: the replay player reads T3's newline-delimited JSON (NDJSON) transcript format and
// replays it as the agent end of a stdio conversation.
//
//   `parseReplay(text)` (module `packages/testing/src/replay.ts`) decodes a transcript. A bad
//   line fails with an error that has a numeric `lineNumber` and a message naming the line. The
//   error never keeps the raw line, because a recorded line can hold a secret.
//
//   `node packages/testing/src/replay.ts <fixture.ndjson> --workspace <folder>` is the player.
//   It reads one JSON frame per line on standard input. At each `expect_outbound` entry it
//   compares the next client frame with the entry; at each `emit_inbound` entry it writes the
//   frame as one line on standard output; `runtime_exit` ends it (success exits 0, error exits
//   non-zero). A mismatch, an early end of input or a malformed file exits non-zero with a
//   message on standard error that names the entry (as `entry N`, where N is the entry's line
//   number in the file; a file error says `line N`) and never prints frame contents. The `<workspace>` placeholder in a frame becomes the --workspace folder.
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { assert, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { afterEach, beforeEach } from "vitest"

import { parseReplay } from "../src/replay.ts"

const playerPath = fileURLToPath(new URL("../src/replay.ts", import.meta.url))
const secret = "sk-ant-api03-PLANTEDSECRETVALUE0123456789"

const header = {
  type: "transcript_start",
  provider: "claude",
  protocol: "acp",
  version: "0.99.1",
  scenario: "greeting",
  metadata: { protocolVersion: 2 }
}
const lines = (...records: ReadonlyArray<unknown>) => records.map((record) => typeof record === "string" ? record : JSON.stringify(record)).join("\n") + "\n"

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 2 } }
const initialized = { jsonrpc: "2.0", id: 1, result: { protocolVersion: 2, info: { name: "a", version: "1" } } }

let folder: string
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "lgcode-replay-"))
})
afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

const play = async (fixture: string, clientFrames: ReadonlyArray<unknown>) => {
  const file = join(folder, "fixture.ndjson")
  await writeFile(file, fixture)
  const child = spawn(process.execPath, [playerPath, file, "--workspace", folder], {
    cwd: folder,
    env: { PATH: "/usr/bin:/bin", HOME: folder, TMPDIR: folder },
    stdio: ["pipe", "pipe", "pipe"]
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => void (stdout += chunk))
  child.stderr.on("data", (chunk) => void (stderr += chunk))
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve))
  for (const frame of clientFrames) child.stdin.write(JSON.stringify(frame) + "\n")
  child.stdin.end()
  const code = await exited
  return { code, stdout: stdout.split("\n").filter((line) => line.length > 0), stderr }
}

it.effect("decodes the header and every entry in order (breaks if the player drops entries, reorders them or loses header fields)", () =>
  Effect.gen(function*() {
    const transcript = yield* parseReplay(lines(
      header,
      { type: "expect_outbound", label: "initialize", frame: initialize },
      { type: "emit_inbound", frame: initialized, afterMs: 0 },
      { type: "runtime_exit", status: "success" }
    ))
    assert.equal(transcript.provider, "claude")
    assert.equal(transcript.version, "0.99.1")
    assert.equal(transcript.scenario, "greeting")
    assert.deepEqual(transcript.metadata, { protocolVersion: 2 })
    assert.deepEqual(transcript.entries.map((entry) => entry.type), ["expect_outbound", "emit_inbound", "runtime_exit"])
  }))

it.effect("a malformed line fails with its line number, counting blank lines (breaks if the failure is silent, has no line number, or counts only non-blank lines)", () =>
  Effect.gen(function*() {
    const text = [
      JSON.stringify(header),
      JSON.stringify({ type: "emit_inbound", frame: initialized }),
      "",
      "{this is not json"
    ].join("\n")
    const failure = yield* parseReplay(text).pipe(Effect.flip)
    assert.equal((failure as unknown as { lineNumber: number }).lineNumber, 4)
    assert.include(failure.message, "line 4")
  }))

it.effect("a well-formed line of an unknown entry type fails with its line number (breaks if unknown entries are skipped without a word)", () =>
  Effect.gen(function*() {
    const failure = yield* parseReplay(lines(header, { type: "emit_inbound", frame: {} }, { type: "mystery", frame: {} })).pipe(Effect.flip)
    assert.equal((failure as unknown as { lineNumber: number }).lineNumber, 3)
  }))

it.effect("a second transcript_start fails with its line number (breaks if a header is accepted in the middle of a transcript)", () =>
  Effect.gen(function*() {
    const failure = yield* parseReplay(lines(header, { type: "runtime_exit", status: "success" }, header)).pipe(Effect.flip)
    assert.equal((failure as unknown as { lineNumber: number }).lineNumber, 3)
  }))

it.effect("empty input fails instead of returning an empty transcript (breaks if an empty file replays as a session with no steps)", () =>
  Effect.gen(function*() {
    const exit = yield* parseReplay("\n  \n").pipe(Effect.exit)
    assert.isTrue(Exit.isFailure(exit))
  }))

it.effect("the parse error does not keep or print the raw line (breaks if the failure carries the line text, which can hold a recorded secret)", () =>
  Effect.gen(function*() {
    const text = lines(header) + `{"type": "emit_inbound", "frame": {"token": "${secret}"` // truncated line
    const failure = yield* parseReplay(text).pipe(Effect.flip)
    assert.equal((failure as unknown as { lineNumber: number }).lineNumber, 2)
    const shown = [
      failure.message,
      String(failure),
      JSON.stringify(failure),
      JSON.stringify(Object.fromEntries(Object.entries(failure)))
    ]
    for (const text of shown) assert.notInclude(text, secret)
  }))

it("replays inbound frames in order after each matching outbound frame and exits 0 (breaks if the player reorders frames, writes extra output on stdout, or exits non-zero on success)", async () => {
  const second = { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "<workspace>", mcpServers: [] } }
  const secondReply = { jsonrpc: "2.0", id: 2, result: { sessionId: "s-1" } }
  const { code, stdout, stderr } = await play(
    lines(
      header,
      { type: "expect_outbound", label: "initialize", frame: initialize },
      { type: "emit_inbound", frame: initialized },
      { type: "expect_outbound", label: "new session", frame: second },
      { type: "emit_inbound", frame: secondReply },
      { type: "runtime_exit", status: "success" }
    ),
    [initialize, { ...second, params: { cwd: folder, mcpServers: [] } }]
  )
  assert.equal(stderr, "")
  assert.equal(code, 0)
  assert.deepEqual(stdout.map((line) => JSON.parse(line)), [initialized, secondReply])
})

it("replaces the workspace placeholder in expected client frames with the --workspace folder (breaks if the placeholder is matched literally, so a real client frame never matches)", async () => {
  const { code } = await play(
    lines(
      header,
      { type: "expect_outbound", frame: { method: "session/new", params: { cwd: "<workspace>" } } },
      { type: "runtime_exit", status: "success" }
    ),
    [{ method: "session/new", params: { cwd: folder } }]
  )
  assert.equal(code, 0)
})

it("replaces the workspace placeholder in emitted frames too, so recorded paths point at the real folder (breaks if inbound frames keep a literal <workspace> path that does not exist)", async () => {
  const { stdout } = await play(
    lines(
      header,
      { type: "emit_inbound", frame: { method: "session/update", params: { locations: [{ path: "<workspace>/a.txt" }] } } },
      { type: "runtime_exit", status: "success" }
    ),
    []
  )
  assert.deepEqual(JSON.parse(stdout[0]!).params.locations, [{ path: `${folder}/a.txt` }])
})

it("a client frame that differs from the expected one stops the replay, names the entry and prints no frame contents (breaks if a mismatch is ignored, later frames are still sent, or the stderr message echoes the frame and its secret)", async () => {
  const { code, stdout, stderr } = await play(
    lines(
      header,
      { type: "expect_outbound", label: "initialize", frame: initialize },
      { type: "emit_inbound", frame: initialized },
      { type: "expect_outbound", label: "new session", frame: { method: "session/new" } },
      { type: "emit_inbound", frame: { jsonrpc: "2.0", id: 2, result: {} } },
      { type: "runtime_exit", status: "success" }
    ),
    [initialize, { method: "session/other", params: { apiKey: secret } }]
  )
  assert.notEqual(code, 0)
  assert.include(stderr, "entry 4")
  assert.include(stderr, "new session")
  assert.notInclude(stderr, secret)
  assert.deepEqual(stdout.map((line) => JSON.parse(line)), [initialized])
})

it("input that ends before the expected frame exits non-zero and names the entry (breaks if the player exits 0 when the client stopped early)", async () => {
  const { code, stderr } = await play(
    lines(header, { type: "expect_outbound", label: "initialize", frame: initialize }, { type: "runtime_exit", status: "success" }),
    []
  )
  assert.notEqual(code, 0)
  assert.include(stderr, "entry 2")
})

it("a runtime_exit with status error exits non-zero (breaks if recorded adapter crashes replay as clean exits)", async () => {
  const { code } = await play(lines(header, { type: "runtime_exit", status: "error", error: "adapter died" }), [])
  assert.notEqual(code, 0)
})

it("a malformed file exits non-zero before replaying anything, names the line and prints no line text (breaks if the player starts on a bad file, loses the line number, or echoes a recorded secret)", async () => {
  const { code, stdout, stderr } = await play(
    lines(header, { type: "emit_inbound", frame: initialized }, `{"type": "emit_inbound", "frame": {"token": "${secret}"`),
    []
  )
  assert.notEqual(code, 0)
  assert.deepEqual(stdout, [])
  assert.include(stderr, "line 3")
  assert.notInclude(stderr, secret)
})
