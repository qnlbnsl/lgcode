import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import { connect } from '@lgtm/client';
import { probeCommands } from '../../scripts/live/liveProbes.ts';
import { receivedUserText, slashReceipt, authRefused, exitCodeOf } from '../../scripts/live/probeEvidence.ts';
import { SLASH_DOWN_PROMPT, SLASH_UP_PROMPT } from '../../scripts/live/prompts.ts';
import { eventsUntil, isTag, peekEcho, promptsOf, requestId, scenario, since, stopAllServices, waitFor } from '../support/acceptance.ts';
import { registerRebuildCheck } from '../support/rebuildCheck.ts';
registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

scenario('the actual engine escapes /compact in both directions as received by the child process; neither delivery becomes a compact turn', (w) => Effect.gen(function* () {
  const lead = yield* w.start(w.owner, { role: 'lead', permission: 'edit', script: { turns: [[], []] } });
  const leadClient = yield* w.asAgent((yield* w.token(lead)).token);
  const child = yield* w.start(leadClient, { script: { turns: [[], []] } });
  const childClient = yield* w.asAgent((yield* w.token(child)).token);
  for (const [client, target, payload] of [[leadClient, child, SLASH_DOWN_PROMPT], [childClient, lead, SLASH_UP_PROMPT]] as const) {
    const mark = (yield* since(w.owner, 0)).at(-1)!.sequence;
    const reply = target.agentId === lead.agentId ? yield* Effect.gen(function* () {
      const asked = yield* client.ask({ requestId: requestId(), text: payload } as never);
      const seen = yield* eventsUntil(w.owner, mark, 'the child question', (row) => row.event._tag === 'QuestionAsked' && (row.event as {questionId: string}).questionId === asked.questionId);
      return { deliveryId: (seen.at(-1)!.event as {deliveryId: string}).deliveryId };
    }) : yield* client.prompt({ requestId: requestId(), agentId: target.agentId, text: payload } as never);
    yield* eventsUntil(w.owner, mark, 'the escaped turn to end', isTag('TurnEnded', target.agentId));
    const received = promptsOf(peekEcho(target.echo)!);
    expect(slashReceipt(received, reply.deliveryId, payload, false)).toBe('escaped; no command');
    expect(received.some((text) => text.startsWith('/compact'))).toBe(false);
    const rows = yield* since(w.owner, mark);
    expect(rows.filter((row) => row.event._tag === 'TurnEnded').every((row) => !(row.event as {compact: boolean}).compact)).toBe(true);
  }
}));

scenario('the named removed-variable shell command uses the real CLI: owner control succeeds, the adapter child with both variables removed is refused by ancestry', (w) => Effect.gen(function* () {
  const command = probeCommands(w.root.state).removedVariables;
  // This entry point can succeed outside the adapter tree with the identical
  // /tmp state path, so a refused child is not merely a missing executable.
  const control = spawnSync('/bin/sh', ['-c', command], { env: { HOME: w.root.home, PATH: process.env.PATH ?? '', TMPDIR: '/tmp' }, encoding: 'utf8' });
  expect(control.status, control.stderr).toBe(0);
  const helper = join(w.root.root, 'stripped.mjs');
  const report = join(w.root.root, 'stripped-result.json');
  writeFileSync(helper, `import {spawnSync} from 'node:child_process'; import {writeFileSync} from 'node:fs';\nconst result=spawnSync('/bin/sh',['-c',process.argv[2]],{env:process.env,encoding:'utf8'});\nwriteFileSync(process.argv[3],JSON.stringify({status:result.status,output:result.stdout+result.stderr,socket:process.env.LGTM_SOCKET??null,token:process.env.LGTM_TOKEN??null}));`);
  const child = yield* w.start(w.owner, { permission: 'ask', prompt: 'Run the removed-variable CLI probe.', script: { turns: [[
    { step: 'exec', argv: [helper, command, report], strip: ['LGTM_SOCKET', 'LGTM_TOKEN'] },
  ]] } });
  yield* eventsUntil(w.owner, 0, 'the fake adapter shell child to finish', isTag('TurnEnded', child.agentId));
  const result = JSON.parse(readFileSync(report, 'utf8'));
  expect([result.socket, result.token]).toEqual([null, null]);
  expect(result.status).toBe(1);
  expect(authRefused(result.output, exitCodeOf(result.output))).toBe(true);
}));

scenario('the actual public socket refuses an old token after SIGKILL and reload, while the new token still authenticates', (w) => Effect.gen(function* () {
  const child = yield* w.start(w.owner, { prompt: 'Wait.', script: { turns: [[]] } });
  yield* eventsUntil(w.owner, 0, 'initial turn', isTag('TurnEnded', child.agentId));
  const before = yield* w.token(child);
  yield* w.kill('SIGKILL');
  yield* w.boot();
  const after = yield* w.token(child, before.pid);
  expect(after.token).not.toBe(before.token);
  const old = yield* Effect.exit(Effect.scoped(connect({ environment: { LGTM_SOCKET: w.root.socket, LGTM_TOKEN: before.token }, attempts: 1 })));
  expect(old._tag).toBe('Failure');
  expect(String(old)).toContain('401');
  const fresh = yield* Effect.exit(Effect.scoped(connect({ environment: { LGTM_SOCKET: w.root.socket, LGTM_TOKEN: after.token }, attempts: 1 })));
  expect(fresh._tag).toBe('Success');
}));
