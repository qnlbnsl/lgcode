import * as Effect from "effect/Effect";
import { afterEach, expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agentToken, makeServiceRoot, ownerClient, startFakeAgent, stopAllServices, waitServing } from "../support/serviceProcess.ts";
import { startCheckedWebService } from "../support/checkedWebService.ts";
import { freshSecret } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });
afterEach(stopAllServices);

it("5.17/E34 service environment: catches relying only on the runner's allow-list instead of deleting the password before anything can spawn", async () => {
  const root = makeServiceRoot(); const password = freshSecret();
  // This preloader observes the real service at exit. It emits only a
  // boolean; /proc/environ cannot observe process.env deletion on Linux.
  const observer = "import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';let tooEarly=false;const spawn=cp.spawn;cp.spawn=function(...args){tooEarly ||= Object.hasOwn(process.env,'SHEPRD_WEB_PASSWORD');return spawn.apply(this,args)};syncBuiltinESMExports();process.once('exit',()=>process.stdout.write('\\nweb-variable-removed='+String(!Object.hasOwn(process.env,'SHEPRD_WEB_PASSWORD'))+'\\nweb-spawn-before-removal='+String(tooEarly)+'\\n'))";
  const preload = `--import=data:text/javascript;base64,${Buffer.from(observer).toString("base64")}`;
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const service = yield* startCheckedWebService(root, { SHEPRD_WEB_PASSWORD: password, NODE_OPTIONS: preload });
    yield* waitServing(root, service);
    const owner = yield* ownerClient(root);
    const agent = yield* startFakeAgent(root, owner, owner, { script: { turns: [[]] } });
    const recorded = yield* agentToken(agent);
    expect(Object.hasOwn(recorded.echo.env, "SHEPRD_WEB_PASSWORD"), "the fake adapter inherited the password variable").toBe(false);
    expect(Object.values(recorded.echo.env).some((value) => value.includes(password)), "the fake adapter inherited the password value").toBe(false);
    yield* service.stop;
    expect(service.output().includes("web-variable-removed=true"), "the service retained SHEPRD_WEB_PASSWORD in process.env").toBe(true);
    expect(service.output().includes("web-spawn-before-removal=false"), "a child was spawned before the service removed the password variable").toBe(true);
    expect(service.output().includes(password), "the service printed its password").toBe(false);
  })));
});
