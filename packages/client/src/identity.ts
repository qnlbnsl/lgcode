import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { ClientError } from "./errors.ts"

export type Environment = Readonly<Record<string, string | undefined>>

export interface Identity {
  readonly kind: "agent" | "owner"
  readonly socketPath: string
  // Reads the credential. Called only after the socket checks pass, so a
  // credential is never read for a socket that is refused.
  readonly bearer: () => string
}

const present = (value: string | undefined): value is string => value !== undefined && value !== ""

// The state folder, resolved as the engine resolves it (engine/api/stateFolder.ts).
export const stateFolder = (environment: Environment): string => {
  if (present(environment.LGTM_HOME)) return resolve(environment.LGTM_HOME)
  if (present(environment.XDG_STATE_HOME)) return resolve(environment.XDG_STATE_HOME, "lgtm")
  if (!present(environment.HOME)) throw new ClientError({ message: "the home folder is unavailable; set LGTM_HOME" })
  return resolve(environment.HOME, ".local/state/lgtm")
}

// Both variables name an agent. Neither names the owner's terminal. One alone
// is refused, never answered with the owner credential or an unchecked socket.
// A variable that is set but empty counts as set (rows 54 and 64): the owner
// fallback applies only when both are unset.
export const resolveIdentity = (environment: Environment): Identity => {
  const socket = environment.LGTM_SOCKET
  const token = environment.LGTM_TOKEN
  if (socket !== undefined && token !== undefined) {
    if (socket === "" || token === "") {
      throw new ClientError({ message: "LGTM_SOCKET and LGTM_TOKEN must both hold a value, or both be left unset" })
    }
    if (!socket.startsWith("/")) throw new ClientError({ message: "LGTM_SOCKET must be an absolute path" })
    return { kind: "agent", socketPath: socket, bearer: () => token }
  }
  if (socket !== undefined || token !== undefined) {
    throw new ClientError({ message: "LGTM_SOCKET and LGTM_TOKEN must be set together, or both left unset" })
  }
  const folder = stateFolder(environment)
  return {
    kind: "owner",
    socketPath: join(folder, "engine.sock"),
    bearer: () => {
      let bytes: Buffer
      try { bytes = readFileSync(join(folder, "owner-credential")) } catch {
        throw new ClientError({ message: "the owner credential cannot be read; is the engine's state folder set up?" })
      }
      if (bytes.length !== 32) throw new ClientError({ message: "the owner credential file is malformed" })
      return bytes.toString("base64url")
    }
  }
}
