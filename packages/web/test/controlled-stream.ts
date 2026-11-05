import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"

// Drive the real watcher after mounting, without timer-dependent emissions.
export async function controlledStream() {
  const queue = await Effect.runPromise(Queue.make<unknown, Error>())
  return {
    stream: Stream.fromQueue(queue),
    emit: (item: unknown) => Effect.runPromise(Queue.offer(queue, item)),
    fail: () => Effect.runPromise(Queue.fail(queue, new Error("connection dropped")))
  }
}
