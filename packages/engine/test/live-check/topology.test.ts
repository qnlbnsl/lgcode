// Unit 8c, fix round 1, finding F1: the folders `pnpm live-check` gives the
// lead and the worker must satisfy the engine's child-folder rule
// (src/identity/ceiling.ts), or the lead's valid `start` of the worker is
// refused and the owner's live run fails at once. These cases run the real
// service with fake agents in the exact topology that `main` builds (both
// folders come from `liveFolders`, the one function `main` and the driver use).
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { leadPromptFor, liveFolders } from "../../scripts/live/driver.ts";
import { main } from "../../scripts/live/run.ts";
import { refusal, requestId, scenario, stopAllServices, tagged, since } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { scriptedApi } from "./scripted-api.ts";

registerRebuildCheck({ noLog: true });
const fixtures: Array<ReturnType<typeof scriptedApi>> = [];
afterEach(async () => {
  await stopAllServices();
  for (const fixture of fixtures.splice(0)) fixture.dispose();
});

scenario("the lead started in the live lead folder can start a worker in the live worker folder, and the engine accepts it (breaks if the live check puts the worker outside the lead's folder; finding F1)", (w) => Effect.gen(function* () {
  const folders = liveFolders(realpathSync(w.root.work));
  mkdirSync(folders.worker, { recursive: true });
  const lead = yield* w.start(w.owner, { name: "Live lead", role: "lead", permission: "edit", folder: folders.lead, prompt: "Wait.", script: { turns: [[]] } });
  const client = yield* w.asAgent((yield* w.token(lead)).token);
  const started = yield* w.start(client, { name: "Live worker", role: "worker", permission: "ask", groups: ["auth"], folder: folders.worker, anyAccount: true, prompt: "Write.", script: { turns: [[]] } });
  const events = yield* since(w.owner, 0);
  expect(tagged(events, "AgentStarted", started.agentId), "the engine did not accept the worker start in the live topology").toHaveLength(1);
}));

scenario("a worker folder that is a sibling of the lead's folder is refused (shows the case above can fail; the live check used to build exactly this)", (w) => Effect.gen(function* () {
  const work = realpathSync(w.root.work);
  const lead = join(work, "lead");
  const sibling = join(work, "project");
  mkdirSync(lead, { recursive: true });
  mkdirSync(sibling, { recursive: true });
  const started = yield* w.start(w.owner, { name: "Live lead", role: "lead", permission: "edit", folder: lead, prompt: "Wait.", script: { turns: [[]] } });
  const client = yield* w.asAgent((yield* w.token(started)).token);
  const prepared = yield* w.prepare({ name: "Live worker", role: "worker", permission: "ask", groups: ["auth"], folder: sibling, anyAccount: true, prompt: "Write.", script: { turns: [[]] } });
  expect(yield* refusal(client.start({ ...prepared.request, requestId: requestId() } as never)), "a sibling folder was accepted").toBeDefined();
}));

it("main starts the lead in the folder liveFolders names, writes the worker folder into the lead's prompt, and creates it (breaks if main builds its own folders instead of the shared function)", async () => {
  const fixture = scriptedApi();
  fixtures.push(fixture);
  const code = await main([], fixture.deps);
  const folders = liveFolders(fixture.work);
  expect(code, fixture.lines.join("\n")).toBe(0);
  expect(fixture.starts).toHaveLength(1);
  expect(fixture.starts[0]!.folder).toBe(folders.lead);
  expect(fixture.starts[0]!.prompt).toBe(leadPromptFor(fixture.deps.config, folders.worker));
  expect(existsSync(folders.worker), "the worker folder was not created before the lead was told about it").toBe(true);
});
