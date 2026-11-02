export interface Clock {
  readonly now: () => number
  readonly sleep: (milliseconds: number) => Promise<void>
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}

// Row 52: the service answers 503 while it recovers. Retry only that, for at
// most this long, so a tool call made at startup survives a restart.
export const recoveryDeadline = 60_000
const firstDelay = 250
const longestDelay = 5_000

const isRecovering = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { status?: unknown }).status === 503

export const retryRecovering = async <A>(attempt: () => Promise<A>, clock: Clock = realClock): Promise<A> => {
  const deadline = clock.now() + recoveryDeadline
  let delay = firstDelay
  for (;;) {
    try {
      return await attempt()
    } catch (error) {
      // Anything but "recovering" (an authentication refusal, say) is final.
      if (!isRecovering(error)) throw error
      const remaining = deadline - clock.now()
      if (remaining <= 0) {
        throw new Error("the Shepherd service was still recovering after 60 seconds; the retry deadline passed")
      }
      await clock.sleep(Math.min(delay, remaining))
      delay = Math.min(delay * 2, longestDelay)
    }
  }
}
