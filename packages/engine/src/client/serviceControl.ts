import { checkRestartLaunch, restartLaunchReason, type RestartLaunch } from './restartLaunch.ts'
import { execFile } from 'node:child_process'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { refused, type Input, type PiecePlanner, type CommandRefused } from '../commands/internal.ts'
import type { LogWriteFailed } from '../log/EventLog.ts'
import type { ReadHandler } from '../api/reads.ts'

// Installed only by the executable service, never by importing its module.
let pending = false
export const serviceRestartPending = () => pending
let restarter: (() => void) | undefined
let launch: RestartLaunch = { execPath: process.execPath, scriptPath: process.argv[1] ?? '' }
export function installRestarter(value: (() => void) | undefined, files: RestartLaunch = { execPath: process.execPath, scriptPath: process.argv[1] ?? '' }) { restarter = value; launch = files; pending = false }
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
const updateCommands = (branch: string, remote: string, ref: string) => [
  'git status --short', `git switch -- ${quote(branch)}`, `git fetch -- ${quote(remote)} ${quote(ref)}`,
  'git log --oneline HEAD..FETCH_HEAD', 'git merge --ff-only FETCH_HEAD',
  'pnpm install --frozen-lockfile', 'pnpm --filter @lgtm/web build', 'pnpm --filter @lgtm/studio build',
  `./bin/lgtm client service restart --input '{"confirmed":true}'`,
]
// The request supplies no command, remote, reference, environment, or path.
// Refuse every transport except HTTPS; disable hooks, credential helpers,
// askpass, redirection, and inherited Git command/configuration overrides.
export const gitVersion = (cwd: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'core.askPass=',
    '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'http.followRedirects=false',
    '-c', 'http.sslVerify=true', ...args], {
    cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 16_384, killSignal: 'SIGKILL',
    env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_CEILING_DIRECTORIES: tmpdir(), GIT_ALLOW_PROTOCOL: 'https' },
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
  const base = { version, commit, checkout, updateCommands: [] as string[] }
  let branch: string, remoteName: string, ref: string
  try {
    const localRef = await git(checkout, ['symbolic-ref', '--quiet', 'HEAD'])
    if (!localRef.startsWith('refs/heads/')) throw new Error()
    branch = localRef.slice('refs/heads/'.length)
    const tracking = await git(checkout, ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', '--', localRef])
    const parts = tracking.split('\0')
    if (parts.length !== 2) throw new Error()
    remoteName = parts[0]!; ref = parts[1]!
    // Conservative service-owned Git metadata, also used in displayed commands.
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remoteName) || !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)
      || [branch, remoteName, ref].some((value) => value.includes('..') || value.endsWith('/') || value.includes('//'))) throw new Error()
  } catch { return { ...base, comparison: 'unavailable' as const, reason: 'This checkout has no tracked remote branch. No update commands are available.' } }
  try {
    const remote = await git(checkout, ['config', '--get', `remote.${remoteName}.url`])
    const url = new URL(remote)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname || /[\s\x00-\x1f]/.test(remote)) throw new Error()
    const tracked = { ...base, trackedBranch: `${remoteName}/${ref.slice('refs/heads/'.length)}`, updateCommands: updateCommands(branch, remoteName, ref) }
    if (!check) return { ...tracked, comparison: 'unchecked' as const }
    // Repository config can override a global sslVerify=true per URL. An empty
    // directory keeps *all* checkout settings away from the network operation.
    const directory = await mkdtemp(join(tmpdir(), 'lgtm-version-network-'))
    let answer: string
    try { answer = await git(directory, ['ls-remote', '--exit-code', '--', remote, ref]) }
    finally { await rm(directory, { recursive: true, force: true }) }
    const [remoteCommit, remoteRef, extra] = answer.split(/\s+/)
    if (!remoteCommit || !/^[a-f0-9]{40,64}$/.test(remoteCommit) || remoteRef !== ref || extra !== undefined) throw new Error()
    return { ...tracked, remoteCommit, comparison: remoteCommit === commit ? 'same' as const : 'different' as const }
  } catch { return { ...base, comparison: 'unavailable' as const, reason: 'A safe HTTPS check of the tracked remote branch is unavailable. Only the running version is shown.' } }
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
}
export const serviceControlPlanners = {
  'client.service.restart': (input, payload) => Effect.gen(function* () {
    if (input.actor._tag !== 'owner') return yield* refused()
    if (payload.confirmed !== true) return yield* refused('Confirm that every signed-in page is signed out and running agents are stopped.')
    if (pending) return yield* refused('service restarting')
    if (!restarter) return yield* refused('This service cannot restart itself on this platform.')
    if (!(yield* Effect.promise(() => checkRestartLaunch(launch)))) return yield* refused(restartLaunchReason)
    return { events: [{ _tag: 'client.ServiceRestartRequested' as const }], reply: () => ({ requestId: payload.requestId, restarting: true }) }
  }),
} satisfies Record<string, PiecePlanner>
// The command handler calls this only after the owner event and receipt commit.
// A replay reads that receipt and never enters this continuation again.
export const completeServiceRestart = (input: Input, stop: (agentId: string) => Effect.Effect<unknown, CommandRefused | LogWriteFailed>) => Effect.uninterruptible(Effect.gen(function* () {
  pending = true
  for (const agent of Object.values((yield* input.runtime.views.snapshot).agents)) {
    if (agent.state._tag !== 'stopped') yield* stop(agent.agentId)
  }
  yield* Effect.sync(() => restarter!())
})).pipe(Effect.onError(() => Effect.sync(() => { pending = false })))
