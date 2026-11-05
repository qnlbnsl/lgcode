import { afterEach, expect, it } from "vitest";
import {
  cleanupUnit7b, fakeEngine, finishCli, prepareRoot, serviceEnvironment, startCli, succeed,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

it("FR-017 the owner CLI retains the delivery failure diagnostic in its list output", async () => {
  const root = prepareRoot();
  const delivery = { status: "failed", generation: 7, attempt: 5, reason: "token missing", final: true };
  await fakeEngine(root, { onRequest: (frame, socket) => succeed(socket, frame, {
    requestId: frame.payload.requestId, items: [{
      alertId: "alert-1", alertKey: "question:question-1", kind: "question",
      title: "A question needs your answer", sourceSequence: 4, status: "open", raisedAt: 1_800_000_000_000, delivery,
    }],
  }) });
  const child = startCli(root, ["client.alerts.list", "--input", JSON.stringify({ requestId: "failure-read", after: 0, limit: 100 })], serviceEnvironment(root));
  expect(await finishCli(child)).toEqual({ code: 0, signal: null });
  expect(JSON.parse(child.stdout()).items[0]).toMatchObject({ status: "open", delivery });
});
