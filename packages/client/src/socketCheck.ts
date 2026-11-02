import { lstatSync, realpathSync } from "node:fs"
import { dirname } from "node:path"
import { ClientError } from "./errors.ts"

export interface StatFacts {
  readonly uid: number
  readonly mode: number
  readonly isDirectory: () => boolean
  readonly isSocket: () => boolean
  readonly isSymbolicLink: () => boolean
}

// The facts the checks read, injectable so a test can supply the ownership an
// unprivileged process cannot create. The defaults read the real filesystem.
export interface SocketSecurity {
  readonly uid: number
  readonly realpath: (path: string) => string
  readonly lstat: (path: string) => StatFacts
}

export const defaultSocketSecurity = (): SocketSecurity => ({
  uid: process.getuid?.() ?? -1,
  realpath: (path) => realpathSync(path),
  lstat: (path) => lstatSync(path)
})

const refuse = (message: string): never => { throw new ClientError({ message }) }

// Rows 54 and 64, amended by the lead's ruling on issue 174. Returns the
// socket's real path, which is the path to connect to, so the path that was
// checked is the path that is dialled.
export const checkSocket = (socketPath: string, security: SocketSecurity): string => {
  let real: string
  let socket: StatFacts
  try {
    real = security.realpath(socketPath)
    socket = security.lstat(real)
  } catch {
    return refuse(`the engine socket at ${socketPath} cannot be inspected; is the engine running?`)
  }
  if (!socket.isSocket()) return refuse(`${socketPath} is not a socket`)
  if (socket.uid !== security.uid) return refuse(`the socket at ${socketPath} is not owned by this user`)

  const folder = dirname(real)
  let own: StatFacts
  try { own = security.lstat(folder) } catch { return refuse("the socket's folder cannot be inspected") }
  if (!own.isDirectory()) return refuse("the socket's folder is not a directory")
  if (own.uid !== security.uid) return refuse("the socket's folder is not owned by this user")
  if ((own.mode & 0o7777) !== 0o700) return refuse("the socket's folder must have mode 0700")

  // Every parent of the real path: user or root owned, not writable by the
  // group or others, except a root-owned folder with the sticky bit.
  for (let path = dirname(folder); ; path = dirname(path)) {
    let facts: StatFacts
    try { facts = security.lstat(path) } catch { return refuse(`the folder ${path} above the socket cannot be inspected`) }
    if (facts.isSymbolicLink() || !facts.isDirectory()) return refuse(`${path} above the socket is not a plain folder`)
    if (facts.uid !== security.uid && facts.uid !== 0) return refuse(`the folder ${path} above the socket is owned by another user`)
    if ((facts.mode & 0o022) !== 0 && !(facts.uid === 0 && (facts.mode & 0o1000) !== 0)) {
      return refuse(`the folder ${path} above the socket is writable by its group or others`)
    }
    if (dirname(path) === path) break
  }
  return real
}
