import { afterEach, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { EventEnvelope, type EventSequence } from "@lgcode/contracts"
import { createRequestSources } from "../src/data/requestSources.ts"

const transport = vi.hoisted(() => ({ client: undefined as unknown }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(transport.client) }
})
const sessions: ReturnType<typeof createRequestSources>[] = []
const session = () => { const value = createRequestSources(); sessions.push(value); return value }
const question = (sequence: number, text = "Private request source") => Schema.decodeUnknownSync(EventEnvelope)({
  sequence, eventId: `question-${sequence}`, occurredAt: sequence, caller: { _tag: "owner" }, event: {
    _tag: "QuestionAsked", agentId: "worker", questionId: `question-${sequence}`, deliveryId: "delivery",
    holder: { _tag: "owner" }, text
  }
})
const sequence = (value: number) => value as EventSequence
const nextRead = () => {
  let release!: (value: { envelope: ReturnType<typeof question> }) => void
  const promise = new Promise<{ envelope: ReturnType<typeof question> }>((resolve) => { release = resolve })
  return { promise, release }
}
afterEach(() => { for (const value of sessions.splice(0)) value.close(); vi.restoreAllMocks() })

it("shares one pending full-source RPC across consumers and retains the actual request for later history recovery", async () => {
  const pending = nextRead()
  const entered = Promise.withResolvers<void>()
  const read = vi.fn(() => Effect.tryPromise(() => { entered.resolve(); return pending.promise }))
  transport.client = { "client.event": read }
  const sources = session()
  const first = sources.read(sequence(1))
  const second = sources.read(sequence(1))
  expect(second).toBe(first)
  await entered.promise
  expect(read).toHaveBeenCalledTimes(1)
  const source = question(1)
  pending.release({ envelope: source })
  expect(await first).toBe(source)
  expect(await second).toBe(source)
  expect(await sources.read(sequence(1))).toBe(source)
  expect(read).toHaveBeenCalledTimes(1)
})

it("retries transport failure, missing data and sequence mismatch without exposing a wrong source", async () => {
  const source = question(1)
  const read = vi.fn().mockReturnValueOnce(Effect.fail(new Error("transport lost")))
    .mockReturnValueOnce(Effect.succeed({}))
    .mockReturnValueOnce(Effect.succeed({ envelope: question(2) }))
    .mockReturnValueOnce(Effect.succeed({ envelope: source }))
  transport.client = { "client.event": read }
  const sources = session()
  await expect(sources.read(sequence(1))).rejects.toBeDefined()
  await expect(sources.read(sequence(1))).rejects.toThrow("Request source unavailable")
  await expect(sources.read(sequence(1))).rejects.toThrow("Request source unavailable")
  expect(await sources.read(sequence(1))).toBe(source)
  expect(read).toHaveBeenCalledTimes(4)
})

it("permits a fresh read after a consumer rejects the source identity", async () => {
  const wrong = question(1)
  const correct = Schema.decodeUnknownSync(EventEnvelope)({ ...wrong, event: { ...wrong.event, questionId: "actual-request" } })
  const read = vi.fn().mockReturnValueOnce(Effect.succeed({ envelope: wrong })).mockReturnValueOnce(Effect.succeed({ envelope: correct }))
  transport.client = { "client.event": read }
  const sources = session()
  const rejected = await sources.read(sequence(1))
  sources.discard(rejected)
  expect(await sources.read(sequence(1))).toBe(correct)
  expect(read).toHaveBeenCalledTimes(2)
})

it("does not retain unrelated conversation events", async () => {
  const source = Schema.decodeUnknownSync(EventEnvelope)({ sequence: 1, eventId: "text", occurredAt: 1, caller: { _tag: "owner" },
    event: { _tag: "ThreadItem", agentId: "worker", itemId: "text", replay: false, content: { _tag: "text", text: "Unrelated private history" } } })
  const read = vi.fn(() => Effect.succeed({ envelope: source }))
  transport.client = { "client.event": read }
  const sources = session()
  sources.remember(source)
  expect(await sources.read(sequence(1))).toBe(source)
  expect(await sources.read(sequence(1))).toBe(source)
  expect(read).toHaveBeenCalledTimes(2)
})

it("evicts older request history under count and byte pressure without truncating recovered input", async () => {
  const read = vi.fn(({ sequence }: { sequence: number }) => Effect.succeed({ envelope: question(sequence) }))
  transport.client = { "client.event": read }
  const sources = session()
  for (let value = 1; value <= 65; value++) sources.remember(question(value))
  await sources.read(sequence(65))
  expect(read).not.toHaveBeenCalled()
  await sources.read(sequence(1))
  expect(read).toHaveBeenCalledTimes(1)
  const large = question(100, "x".repeat(4_200_000))
  const later = question(101, "y".repeat(4_200_000))
  sources.remember(large); sources.remember(later)
  expect(await sources.read(sequence(101))).toBe(later)
  await sources.read(sequence(100))
  expect(read).toHaveBeenCalledTimes(2)
  const oversized = question(200, "z".repeat(8_400_000))
  read.mockImplementation(() => Effect.succeed({ envelope: oversized }))
  expect(await sources.read(sequence(200))).toBe(oversized)
  expect(await sources.read(sequence(200))).toBe(oversized)
  expect(read).toHaveBeenCalledTimes(4)
})

it("aborts pending reads and rejects retained or late source access when the owner session closes", async () => {
  const pending = nextRead()
  const entered = Promise.withResolvers<void>()
  const finalized = vi.fn()
  const read = vi.fn(() => Effect.tryPromise(() => { entered.resolve(); return pending.promise })
    .pipe(Effect.ensuring(Effect.sync(finalized))))
  transport.client = { "client.event": read }
  const sources = session()
  sources.remember(question(1))
  const result = sources.read(sequence(2))
  const rejected = expect(result).rejects.toBeDefined()
  await entered.promise
  sources.close()
  await rejected
  expect(finalized).toHaveBeenCalledTimes(1)
  pending.release({ envelope: question(2, "Late previous-owner source") })
  await expect(sources.read(sequence(1))).rejects.toThrow("Owner session ended")
  await expect(sources.read(sequence(2))).rejects.toThrow("Owner session ended")
  const next = session()
  const current = question(2, "New owner source")
  read.mockImplementation(() => Effect.succeed({ envelope: current }))
  expect(await next.read(sequence(2))).toBe(current)
  expect(read).toHaveBeenCalledTimes(2)
})
