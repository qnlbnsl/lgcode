import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as AcpClient from "@lgcode/t3-effect-acp/client";
import * as Effect from "effect/Effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { expect } from "vitest";

const fake = fileURLToPath(new URL("../src/fakeAgent.ts", import.meta.url));

for (const protocolVersion of [1, 2]) for (const reloadable of [true, false]) {
  it.live(`fake peer v${protocolVersion}: catches ignoring reloadable=${reloadable} in the initialized capabilities`, () => Effect.gen(function* () {
    const home = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp("/tmp/lgcode-reload-capabilities-")),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
    );
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [fake], {
      cwd: home, env: { PATH: "/usr/bin:/bin", HOME: home, LGCODE_HOME: home, CODEX_HOME: home,
        FAKE_AGENT_SCRIPT: JSON.stringify({ protocolVersion, reloadable, turns: [] }) },
    }));
    yield* Effect.gen(function* () {
      const client = yield* AcpClient.AcpClient;
      const result = yield* client.agent.initialize({ protocolVersion: 2, clientInfo: { name: "reload-capabilities-test", version: "0.0.0" } });
      expect(result.protocolVersion).toBe(protocolVersion);
      expect(result.agentCapabilities?.loadSession).toBe(reloadable);
    }).pipe(Effect.provide(AcpClient.layerChildProcess(child)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
}
