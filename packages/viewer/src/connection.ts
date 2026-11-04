import { connect, resolveIdentity, type ClientEnvelope, type Environment } from "@shephrd/client";
import type { AgentId, EventSequence, PermissionRequestId, QuestionId, RequestId } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

const requestId = (): RequestId => crypto.randomUUID() as RequestId;

export const connectViewer = async (environment: Environment = process.env, signal?: AbortSignal) => {
  if (resolveIdentity(environment).kind !== "owner") throw new Error("The viewer requires the owner identity; an agent cannot open it.");
  const scope = await Effect.runPromise(Scope.make());
  const controller = new AbortController();
  const connectionSignal = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]);
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect, { signal: connectionSignal });
  try {
    const client = await run(connect({ environment }).pipe(Scope.provide(scope)));
    return {
      snapshot: () => run(client["client.snapshot"]({ requestId: requestId() })),
      event: async ({ sequence }: { sequence: number }) => {
        const reply = await run(client["client.event"]({ requestId: requestId(), sequence: sequence as EventSequence }));
        if (!("envelope" in reply)) throw new Error("The owner event read was refused.");
        return reply;
      },
      thread: async ({ agentId, after, limit }: { agentId: string; after: number; limit: number }) => {
        const reply = await run(client["client.thread"]({ requestId: requestId(), agentId: agentId as AgentId, after: after as EventSequence, limit }));
        if (!("items" in reply)) throw new Error("The owner thread read was refused.");
        return reply;
      },
      answer: (input: { kind: "permission"; id: string; optionId: string } | { kind: "question"; id: string; text: string }) => run(client.answer(input.kind === "permission"
        ? { ...input, id: input.id as PermissionRequestId, requestId: requestId() }
        : { ...input, id: input.id as QuestionId, requestId: requestId() })),
      prompt: (input: { agentId: string; text: string }) => run(client.prompt({ ...input, agentId: input.agentId as AgentId, requestId: requestId() })),
      subscribe: (after: number, onItem: (item: { readonly sequence: number; readonly event?: ClientEnvelope["event"] }) => void, signal: AbortSignal) =>
        Effect.runPromise(Stream.runForEach(client["client.subscribe"]({ requestId: requestId(), after: after as EventSequence }),
          (item) => Effect.sync(() => onItem(item))), { signal: AbortSignal.any([signal, connectionSignal]) }),
      close: async () => { controller.abort(); await Effect.runPromise(Scope.close(scope, Exit.void)); },
    };
  } catch (error) {
    controller.abort();
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw error;
  }
};

export type ViewerClient = Awaited<ReturnType<typeof connectViewer>>;
