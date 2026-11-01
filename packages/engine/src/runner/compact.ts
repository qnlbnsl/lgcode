import * as Effect from "effect/Effect";
import { RunnerRejected } from "./Runner.ts";

export const compactPrompt = (commands: ReadonlyArray<{ readonly name: string }>) =>
  commands.some((command) => command.name === "compact") ? Effect.succeed("/compact")
    : Effect.fail(new RunnerRejected({ reason: "compact command is not advertised" }));
