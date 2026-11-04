import { expect, it, vi } from "vitest";
import * as viewer from "../src/index.ts";

type Actions = {
  readonly answerRequest: (client: {
    readonly answer: (input: { readonly kind: "permission"; readonly id: string; readonly optionId: string }) => Promise<unknown>;
  }, request: { readonly permissionRequestId: string; readonly options: ReadonlyArray<{ readonly id: string }> }, optionId: string) => Promise<void>;
  readonly promptAgent: (client: {
    readonly prompt: (input: { readonly agentId: string; readonly text: string }) => Promise<unknown>;
  }, agentId: string, text: string) => Promise<void>;
};

const actions = viewer as unknown as Actions;

it("A81 catches an answer action that does not submit the selected request option", async () => {
  expect(typeof actions.answerRequest, "viewer must expose its request answer action").toBe("function");
  const answer = vi.fn(async () => undefined);

  await actions.answerRequest({ answer }, {
    permissionRequestId: "permission-1",
    options: [{ id: "allow-once" }, { id: "reject" }],
  }, "allow-once");

  expect(answer).toHaveBeenCalledWith({ kind: "permission", id: "permission-1", optionId: "allow-once" });
});

it("A82 catches a prompt action that targets the wrong agent or changes the owner's text", async () => {
  expect(typeof actions.promptAgent, "viewer must expose its agent prompt action").toBe("function");
  const prompt = vi.fn(async () => undefined);

  await actions.promptAgent({ prompt }, "worker-1", "Please inspect the failing build.");

  expect(prompt).toHaveBeenCalledWith({ agentId: "worker-1", text: "Please inspect the failing build." });
});
