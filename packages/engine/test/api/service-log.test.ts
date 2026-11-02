// Criterion 7.11 (unit 7a; row 57; SECURITY.md rule 6; issue 13): the
// service's own log output contains no planted secret, token or credential.
// The test plants an account secret, the service's own SHEPHERD_TOKEN and
// provider keys in its environment, and uses the owner credential and an
// agent token; it runs a flow (start an agent, prompt it, answer a
// permission), drives the copied ACP code's logging paths with frames that
// carry the secrets (an extension notification, an unsupported request, a
// malformed frame, a notification that fails its schema, stderr and an RPC
// error), stops the service, and greps everything it wrote to stdout and
// stderr for each secret in its raw, base64, base64url, hex and URL-encoded
// forms. The service is a real child process.
import { randomBytes } from "node:crypto";

import { afterEach, expect, it } from "@effect/vitest";
import type { EventEnvelope } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";

import { mintAgentToken } from "../../src/identity/tokens.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { ownerBearer } from "../support/socketClient.ts";
import {
  agentToken, makeServiceRoot, ownerClient, requestId, startFakeAgent, startService, stopAllServices, waitServing,
} from "../support/serviceProcess.ts";

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps the missing
// production modules from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout: number) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, timeout);
afterEach(async () => { await stopAllServices(); });

const forms = (secret: string): Record<string, string> => ({
  raw: secret,
  base64: Buffer.from(secret).toString("base64").replace(/=+$/, ""),
  base64url: Buffer.from(secret).toString("base64url"),
  hex: Buffer.from(secret).toString("hex"),
  url: encodeURIComponent(secret),
});

const leaks = (output: string, secrets: Record<string, string>) => Object.entries(secrets).flatMap(([name, secret]) =>
  Object.entries(forms(secret)).filter(([, form]) => output.includes(form)).map(([form]) => `${name} (${form})`));

live("7.11 no planted secret, token or credential appears in the service's stdout or stderr after a full flow that pushes each through the ACP logging paths (breaks if the service logger bypasses the redactor, logs its environment, forwards adapter stderr, or turns on protocol logging outside tests)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const accountSecret = `planted-account-secret-${randomBytes(12).toString("hex")}`;
    const serviceToken = Redacted.value(mintAgentToken().token);
    const providerKey = `sk-ant-api03-${randomBytes(16).toString("hex")}`;
    const otherKey = `sk-proj-${randomBytes(16).toString("hex")}`;
    const service = startService(root, {
      env: { SHEPHERD_TOKEN: serviceToken, ANTHROPIC_API_KEY: providerKey, OPENAI_API_KEY: otherKey },
    });
    yield* waitServing(root, service);

    const options = [{ optionId: "allow-once", name: "Yes", kind: "allow_once" }, { optionId: "reject", name: "No", kind: "reject_once" }];
    const frames = [
      '{"jsonrpc":"2.0","method":"_planted/notice","params":{"leak":"${env:PLANTED_KEY}","token":"${env:SHEPHERD_TOKEN}"}}',
      '{"jsonrpc":"2.0","id":9001,"method":"_planted/request","params":{"leak":"${env:PLANTED_KEY}","token":"${env:SHEPHERD_TOKEN}"}}',
      'not json ${env:PLANTED_KEY} ${env:SHEPHERD_TOKEN}',
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${session}","update":{"sessionUpdate":"planted_kind","leak":"${env:PLANTED_KEY}"}}}',
      '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"${session}","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"escaped ${env-u:PLANTED_KEY}"}}}}',
    ];
    const agent = yield* Effect.scoped(Effect.gen(function* () {
      const owner = yield* ownerClient(root);
      const events = owner.subscribe({ requestId: requestId(), after: 0 } as never) as Stream.Stream<EventEnvelope, unknown>;
      const started = yield* startFakeAgent(root, owner, owner, {
        secrets: { PLANTED_KEY: accountSecret },
        script: { turns: [[
          { step: "stderr", text: "stderr ${env:PLANTED_KEY} ${env:SHEPHERD_TOKEN}" },
          ...frames.map((frame) => ({ step: "raw_frame", frame })),
          { step: "text", text: "text ${env:PLANTED_KEY}" },
          { step: "permission", toolCallId: "tool-planted", title: "Write the planted file", options },
          { step: "rpc_error", message: "failed with ${env:PLANTED_KEY} and ${env:SHEPHERD_TOKEN}" },
        ]] },
        prompt: "Run the planted flow.",
      });
      // Answer the permission as the owner, then wait for the turn to end.
      const requested = yield* events.pipe(
        Stream.filter((envelope) => envelope.event._tag === "PermissionRequested" && envelope.agentId === started.agentId),
        Stream.runHead, Effect.timeout(30_000),
      );
      const request = (requested as { _tag: string; value?: EventEnvelope }).value!.event as { permissionRequestId: string };
      yield* owner.answer({ requestId: requestId(), kind: "permission", id: request.permissionRequestId, optionId: "allow-once" } as never);
      const later = owner.subscribe({ requestId: requestId(), after: 0 } as never) as Stream.Stream<EventEnvelope, unknown>;
      yield* later.pipe(
        Stream.takeUntil((envelope) => envelope.event._tag === "TurnEnded" && envelope.agentId === started.agentId),
        Stream.runDrain, Effect.timeout(30_000),
      );
      return started;
    }));
    const token = (yield* agentToken(agent)).token;
    const owner = ownerBearer(root.state);

    // Stopping the service flushes every line it will ever write.
    service.child.kill("SIGTERM");
    yield* Effect.promise(() => service.exit);
    const output = service.output();
    // The flow really ran through the logger: the runner's fixed diagnostic for the malformed frame is there.
    expect(output).toContain("adapter frame dropped: malformed");
    expect(leaks(output, {
      "account secret": accountSecret, "agent token": token, "owner credential": owner,
      "service SHEPHERD_TOKEN": serviceToken, "inherited ANTHROPIC_API_KEY": providerKey, "inherited OPENAI_API_KEY": otherKey,
    })).toEqual([]);
  }), 120_000);
