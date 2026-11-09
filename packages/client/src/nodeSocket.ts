import * as Effect from "effect/Effect"
import * as Socket from "effect/socket/Socket"

type Options = NonNullable<Parameters<typeof Socket.makeWebSocket>[1]>

// The Node transport owns its release as well as its acquisition. Effect's
// reader has already detached its error listener when release runs. Cancelling
// a pending ws handshake emits an asynchronous error, so retain its ownership
// through the close event without changing active reader error delivery.
export const makeNodeSocket = (url: string, options: Options = {}) => Socket.fromWebSocket(
  Effect.acquireRelease(
    Socket.WebSocketConstructor.use((construct) => Effect.sync(() => construct(url, options))),
    (socket) => Effect.sync(() => {
      if (socket.readyState === 0) {
        const closingError = () => {}
        socket.addEventListener("error", closingError, { once: true })
        socket.addEventListener("close", () => socket.removeEventListener("error", closingError), { once: true })
      }
      socket.close(1000)
    })
  ),
  options
)
