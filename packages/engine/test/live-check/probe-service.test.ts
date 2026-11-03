import { afterEach, expect, it } from 'vitest';
import * as Effect from 'effect/Effect';
import { connect } from '@shephrd/client';
import { startLiveService, type LiveService } from '../../scripts/live/service.ts';
import { registerRebuildCheck } from '../support/rebuildCheck.ts';
registerRebuildCheck({ noLog: true });
const services: LiveService[] = [];
afterEach(async () => { for (const service of services.splice(0)) { await service.stop(); service.remove(); } });
const serving = async (service: LiveService) => {
  const until = Date.now() + 30_000;
  for (;;) {
    const result = await Effect.runPromiseExit(Effect.scoped(connect({ environment: { SHEPHRD_HOME: service.state }, attempts: 1 })));
    if (result._tag === 'Success') return;
    if (service.exited() || Date.now() > until) throw new Error('service did not serve: ' + service.output());
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
it('the live wrapper SIGKILLs its own child and restarts on the same state folder, then the public client reconnects', async () => {
  const first = startLiveService({ HOME: process.env.HOME, PATH: process.env.PATH });
  services.push(first);
  await serving(first);
  const next = await first.restart!();
  services.push(next);
  await serving(next);
  expect(next.pid).not.toBe(first.pid);
  expect(next.state).toBe(first.state);
  expect(first.exited()).toBe(true);
}, 60_000);

it('cancelling a restart while the killed child closes cannot start a late replacement', async () => {
  const service = startLiveService({ HOME: process.env.HOME, PATH: process.env.PATH });
  services.push(service);
  await serving(service);
  const controller = new AbortController();
  const restarting = service.restart!(controller.signal);
  controller.abort();
  await expect(restarting).rejects.toThrow('restart cancelled');
  expect(service.exited()).toBe(true);
  await service.stop();
  const { processesNaming } = await import('../../scripts/live/service.ts');
  expect(processesNaming(service.root)).toEqual([]);
}, 60_000);
