import { spawn } from 'node:child_process'
import { chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as SqliteClient from '@lgtm/t3-node-sqlite/nodeSqliteClient'
import { expect, test } from 'vitest'
import { buildServices } from '../../src/service.ts'
import { layer as redactor } from '../../src/log/Redactor.ts'
import { makeFakeRunner } from '../support/fakeRunner.ts'
import { makeRig, removeRig, provideRig, call, ownerCredential, makeFakeSecrets } from '../support/handlerRig.ts'
import { registerRebuildCheck } from '../support/rebuildCheck.ts'
import { connect, ownerBearer } from '../support/socketClient.ts'
import { unusedPort } from '../support/browserWeb.ts'

const poll = async <T>(probe: () => Promise<T>, accept: (value: T) => boolean) => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try { const value = await probe(); if (accept(value)) return value } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('The isolated service did not return in time.')
}
test('the executable restarts with the same arguments and environment and invalidates every signed-in page', { timeout: 60_000 }, async () => {
  const rig = makeRig(), port = await unusedPort(), password = 'synthetic-restart-password'
  let child: ReturnType<typeof spawn> | undefined
  try {
    chmodSync(rig.stateFolder, 0o700)
    const runner = await Effect.runPromise(makeFakeRunner())
    await Effect.runPromise(provideRig({ ...rig, database: join(rig.stateFolder, 'events.sqlite') }, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
      yield* registerRebuildCheck()
      expect((yield* call(ownerCredential, 'client.web.settings.set', { settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } }))._tag).toBe('Success')
    })))
    child = spawn(process.execPath, ['--trace-warnings', fileURLToPath(new URL('../../src/service.ts', import.meta.url))], {
      env: { PATH: '/usr/bin:/bin', HOME: rig.home, LGTM_HOME: rig.stateFolder, LGTM_WEB_PASSWORD: password, LGTM_RESTART_MARKER: 'preserved-value' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let diagnostics = ''; child.stdout!.on('data', (part) => { diagnostics += String(part) }); child.stderr!.on('data', (part) => { diagnostics += String(part) });
    const reported = await poll(() => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const client = yield* connect(join(rig.stateFolder, 'engine.sock'), ownerBearer(rig.stateFolder))
      return yield* client['client.web.settings']({ requestId: 'startup-settings' })
    }))), () => true)
    expect(reported).toMatchObject({ port, serverState: 'running' })
    let lastStatus = 0
    const origin = `http://127.0.0.1:${port}`
    const login = () => fetch(origin + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ password }) })
    const response = await poll(async () => { if (child!.exitCode !== null) throw new Error(diagnostics); const reply = await login(); lastStatus = reply.status; return reply }, (reply) => reply.status === 204).catch(() => { throw new Error('Startup diagnostics, last HTTP status ' + lastStatus + ': ' + diagnostics.slice(-3000)) })
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!
    const session = () => fetch(origin + '/api/session', { method: 'POST', headers: { Cookie: cookie, Origin: origin } })
    expect((await session()).status).toBe(204)
    expect((await login()).headers.get('set-cookie')!.split(';')[0]).toBe(cookie)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const client = yield* connect(join(rig.stateFolder, 'engine.sock'), ownerBearer(rig.stateFolder))
      expect(yield* client['client.service.restart']({ requestId: 'restart-process', confirmed: true })).toMatchObject({ restarting: true })
    })))
    await poll(session, (reply) => reply.status === 401)
    expect(child.exitCode).toBeNull()
    expect(readFileSync(`/proc/${child.pid}/cmdline`, 'utf8')).toContain('--trace-warnings\0')
    expect(readFileSync(`/proc/${child.pid}/environ`, 'utf8').includes('LGTM_RESTART_MARKER=preserved-value\0')).toBe(true)
    expect((await login()).status).toBe(204)
    expect((await session()).status).toBe(401)
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child!.once('exit', resolve))
      child.kill('SIGTERM')
      const timer = setTimeout(() => child!.kill('SIGKILL'), 5000)
      await exited; clearTimeout(timer)
    }
    removeRig(rig)
  }
})
