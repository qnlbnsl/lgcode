import { commandOutcome } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import { holderAbove, passUp } from "../routing/holders.ts";
import { answer } from "../routing/permissions.ts";
import { ask } from "../routing/questions.ts";
import { wait } from "../routing/waits.ts";
import { accounts, setSecret, markAvailable } from "./accounts.ts";
import { release } from "./release.ts";
import { compact } from "./compact.ts";
import { group } from "./group.ts";
import { harnesses } from "./harnesses.ts";
import { prompt } from "./prompt.ts";
import { resume } from "./resume.ts";
import { start } from "./start.ts";
import { stop } from "./stop.ts";
import { refused, type Input, type Payload, type Plan } from "./internal.ts";
import type { LogWriteFailed } from "../log/EventLog.ts";
import { setWebSettings } from "../client/settings.ts";
import { setRoleFile } from "../roles/roleFile.ts";

type Planner = (input: Input, payload: Record<string, unknown>) => Effect.Effect<Plan, ReturnType<typeof refused> | LogWriteFailed>;
const targeted = (name: "prompt" | "stop" | "resume" | "compact" | "group", plan: Planner): Planner => (input, payload) => Effect.gen(function* () {
  const { actor, snapshot } = input;
  const agentId = payload.agentId as string;
  const agent = snapshot.agents[agentId];
  if (agent === undefined || commandOutcome(agent.state._tag, name) === "refused") return yield* refused();
  const holder = holderAbove(snapshot, agentId);
  if (actor._tag === "agent" && (holder._tag !== "agent" || holder.agentId !== actor.agentId)) return yield* refused();
  return yield* plan(input, payload);
});
export const planners = {
  "client.web.settings.set": setWebSettings,
  "roles.role-file.set": (input, payload) => setRoleFile(input, payload as Payload<"roles.role-file.set">),
  // Their implementation units replace these refusals; each declared command
  // already has exactly one execution kind and cannot accidentally run elsewhere.
  "roles.settings.set": () => Effect.fail(refused()),
  "roles.snooze": () => Effect.fail(refused()),
  "roles.record": () => Effect.fail(refused()),
  release: (input, payload) => release(input, payload as Payload<"release">),
  start: (input, payload) => start(input, payload as Payload<"start">),
  prompt: targeted("prompt", (input, payload) => Effect.succeed(prompt(input, payload as Payload<"prompt">))),
  answer: (input, payload) => answer(input, payload as Payload<"answer">),
  "pass-up": (input, payload) => passUp(input, payload as Payload<"pass-up">),
  ask: (input, payload) => ask(input, payload as Payload<"ask">),
  wait: (input, payload) => wait(input, payload as Payload<"wait">),
  compact: targeted("compact", (input, payload) => Effect.succeed(compact(input, payload as Payload<"compact">))),
  stop: targeted("stop", (input, payload) => Effect.succeed(stop(input, input.snapshot.agents[payload.agentId as string]!))),
  resume: targeted("resume", (input, payload) => resume(input, input.snapshot.agents[payload.agentId as string]!, payload as Payload<"resume">)),
  group: targeted("group", (input, payload) => Effect.succeed(group(input.snapshot.agents[payload.agentId as string]!, payload as Payload<"group">))),
  accounts: (input, payload) => accounts(input, payload as Payload<"accounts">),
  "accounts set-secret": (input, payload) => setSecret(input, payload as Payload<"accounts set-secret">),
  "accounts mark-available": (input, payload) => markAvailable(input, payload as Payload<"accounts mark-available">),
  harnesses: (input, payload) => harnesses(input, payload as Payload<"harnesses">),
} satisfies Record<string, Planner>;
