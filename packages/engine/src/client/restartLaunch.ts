import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'

export interface RestartLaunch { readonly execPath: string; readonly scriptPath: string }
export const restartLaunchReason = 'The service launch files are unavailable. Restart was refused before stopping agents.'
export async function checkRestartLaunch(launch: RestartLaunch): Promise<boolean> {
  try {
    for (const [path, mode] of [[launch.execPath, constants.R_OK | constants.X_OK], [launch.scriptPath, constants.R_OK]] as const) {
      if (!(await stat(path)).isFile()) return false
      await access(path, mode)
    }
    return true
  } catch { return false }
}
// Teardown has already finished. Never serialize the exception or environment.
export function restartAfterShutdown(exec: () => never, write = (line: string) => { process.stderr.write(line) }, fail = (code: number) => { process.exitCode = code }) {
  try { exec() }
  catch { write('Service restart failed after shutdown. Start the service again from the terminal.\n'); fail(78) }
}
