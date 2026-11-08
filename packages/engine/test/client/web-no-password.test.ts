import * as Effect from "effect/Effect";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ancestryHeaders, authorization, ownerBearer, upgrade as hostUpgrade, upgradeStatus } from "../support/socketClient.ts";
import { makeServiceRoot, stopAllServices, waitServing } from "../support/serviceProcess.ts";
import { startCheckedWebService } from "../support/checkedWebService.ts";
import { freshSecret, rpc } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });
afterEach(stopAllServices);

for (const kind of ["unset", "empty", "short"] as const) {
  it(`5.7 ${kind} password: catches binding without a usable password, stopping the Unix socket or treating configuration as an outage`, async () => {
    const root = makeServiceRoot();
    const password = kind === "unset" ? undefined : kind === "empty" ? "" : freshSecret().slice(0, 7);
    const observer = "import net from 'node:net';const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(typeof args[0]==='number'||(typeof args[0]==='object'&&args[0]?.port!==undefined))process.stdout.write('web-tcp-bind-attempt\\n');return listen.apply(this,args)}";
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const service = yield* startCheckedWebService(root, { LGCODE_WEB_PASSWORD: password, NODE_OPTIONS: `--import=data:text/javascript;base64,${Buffer.from(observer).toString("base64")}` });
      yield* waitServing(root, service);
      const outcome = yield* Effect.promise(() => hostUpgrade(root.socket, { ...authorization(ownerBearer(root.state)), ...ancestryHeaders() }));
      expect(outcome.status).toBe(101);
      const socket = outcome.socket!;
      yield* Effect.addFinalizer(() => Effect.sync(() => socket.terminate()));
      const settings = yield* rpc(socket, "client.web.settings", { requestId: `no-password-${kind}` });
      expect(settings).toMatchObject({ _tag: "Success", value: { serverState: "no-password", enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false } });
      const database = new DatabaseSync(join(root.state, "events.sqlite"), { readOnly: true });
      try {
        const events = database.prepare("SELECT payload_json FROM events").all().map((row) => JSON.parse(row.payload_json as string));
        expect(events.some((event) => event._tag === "client.WebServerDown" || (event._tag === "client.AlertRaised" && event.kind === "client.web-down"))).toBe(false);
      } finally { database.close(); }
      expect((yield* Effect.promise(() => upgradeStatus(root.socket, ancestryHeaders()))).status).toBe(401);
      expect(service.exited()).toBe(false);
      yield* service.stop;
      expect(service.output().includes("web-tcp-bind-attempt"), "a service with no usable password attempted a TCP bind").toBe(false);
      expect(/web[^\n]*password|password[^\n]*web/i.test(service.output()), "service did not explain why the web listener is off").toBe(true);
    })));
  });
}
