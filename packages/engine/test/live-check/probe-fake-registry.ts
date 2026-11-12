// The agent-token side of the fake engine in probe-fake-engine.ts. It is kept
// in its own module, with no import of @lgtm/client, so the test's mock of
// `connect` can load it without an import cycle.
import * as Effect from "effect/Effect";

export interface AgentConnector {
  // A client for a token the fake engine accepts, or a 401 failure.
  readonly connect: (token: string) => Effect.Effect<unknown, unknown>;
}

export const registry: { current: AgentConnector | undefined } = { current: undefined };

// Only token connections are faked. Any other connection falls through to the
// real client (the probes connect the owner through openOwner, not here).
export const fakeConnect = (options: { readonly environment?: Readonly<Record<string, string | undefined>> }): Effect.Effect<unknown, unknown> | undefined => {
  const token = options.environment?.LGTM_TOKEN;
  if (token === undefined || registry.current === undefined) return undefined;
  return registry.current.connect(token);
};
