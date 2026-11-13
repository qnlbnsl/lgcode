import { randomUUID } from 'node:crypto'
import { CommandHandler } from '../commands/CommandHandler.ts'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import * as Effect from 'effect/Effect'
import { refused } from '../commands/internal.ts'
import type { ReadHandler } from '../api/reads.ts'

// Installed only by the executable service, never by importing its module.
let pending = false
export const serviceRestartPending = () => pending
let restarter: (() => void) | undefined
export function installRestarter(value: (() => void) | undefined) { restarter = value; pending = false }
export const updateCommands = [
  'git status --short', 'git fetch origin HEAD', 'git log --oneline HEAD..FETCH_HEAD',
  'git merge --ff-only FETCH_HEAD', 'pnpm install --frozen-lockfile',
  'pnpm --filter @lgtm/web build', 'pnpm --filter @lgtm/studio build',
  `./bin/lgtm client service restart --input '{"confirmed":true}'`,
]
// The request supplies no command, remote, reference, environment, or path.
// Refuse every transport except HTTPS; disable hooks, credential helpers,
// askpass, redirection, and inherited Git command/configuration overrides.
export const gitVersion = (cwd: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'core.askPass=',
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'http.followRedirects=false',
    '-c', 'http.sslVerify=true', ...args], {
    cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 16_384,
    env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_EXEC_PATH: '/usr/lib/git-core', GIT_ALLOW_PROTOCOL: 'https' },
  }, (error, stdout) => error ? reject(new Error('The Git version check is unavailable.')) : resolve(stdout.trim()))
})
const running = new Map<string, Promise<{ version: string; commit: string }>>()
export function captureRunningVersion(checkout: string) {
  let known = running.get(checkout)
  if (!known) {
    known = (async () => {
      let version = 'unknown', commit = ''
      try { const value = JSON.parse(await readFile(`${checkout}/package.json`, 'utf8')).version; if (typeof value === 'string') version = value } catch {}
      try { commit = await gitVersion(checkout, ['rev-parse', '--verify', 'HEAD']) } catch {}
      return { version, commit }
    })()
    running.set(checkout, known)
  }
  return known
}
export async function serviceVersion(checkout: string, check = false, git = gitVersion) {
  const { version, commit } = await captureRunningVersion(checkout)
  const base = { version, commit, checkout, updateCommands }
  if (!check) return { ...base, comparison: 'unchecked' as const }
  try {
    const remote = await git(checkout, ['config', '--get', 'remote.origin.url'])
    const url = new URL(remote)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname || /[\s\x00-\x1f]/.test(remote)) throw new Error()
    const answer = await git(checkout, ['ls-remote', '--exit-code', '--', remote, 'HEAD'])
    const remoteCommit = /^([a-f0-9]{40,64})\s+HEAD$/.exec(answer)?.[1]
    if (!remoteCommit) throw new Error()
    return { ...base, remoteCommit, comparison: remoteCommit === commit ? 'same' as const : 'different' as const }
  } catch { return { ...base, comparison: 'unavailable' as const, reason: 'A safe HTTPS check of origin is unavailable. Only the running version is shown.' } }
}
export const serviceControlReads: Record<string, ReadHandler> = {
  'client.service.version': (input, payload) => Effect.gen(function* () {
    if (input.actor._tag !== 'owner') return yield* refused()
    const result = yield* Effect.promise(() => serviceVersion(input.runtime.pluginRoot, payload.check === true))
    const fields = yield* Effect.forEach(Object.entries({ ...result, dataFolder: input.runtime.stateFolder }), ([key, value]) => Effect.gen(function* () {
      let clean: unknown = value
      if (typeof value === 'string' && !['comparison', 'reason'].includes(key)) clean = yield* input.runtime.log.redactText(value)
      else if (Array.isArray(value)) clean = yield* Effect.forEach(value, input.runtime.log.redactText)
      return [key, clean] as const
    }))
    return { reply: { requestId: payload.requestId, ...Object.fromEntries(fields) } }
  }),
  'client.service.restart': (input, payload) => Effect.gen(function* () {
    if (input.actor._tag !== 'owner') return yield* refused()
    if (payload.confirmed !== true) return yield* refused('Confirm that every signed-in page is signed out and running agents are stopped.')
    if (!restarter) return yield* refused('This service cannot restart itself on this platform.')
    if (!pending) {
      pending = true
      const handler = yield* CommandHandler
      yield* Effect.uninterruptible(Effect.gen(function* () {
        // The mutation gate prevents new starts while the existing agents stop.
        // Each stop keeps its normal durable cancellation and token revocation.
        for (const agent of Object.values((yield* handler.input({ _tag: 'owner' })).snapshot.agents)) {
          if (agent.state._tag === 'stopped') continue
          yield* handler.execute({ _tag: 'owner' }, 'stop', { requestId: randomUUID(), agentId: agent.agentId })
        }
        yield* Effect.sync(restarter!)
      })).pipe(Effect.onError(() => Effect.sync(() => { pending = false })))
    }
    return { reply: { requestId: payload.requestId, restarting: true } }
  }),
}
