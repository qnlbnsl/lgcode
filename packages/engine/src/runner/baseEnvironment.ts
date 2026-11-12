interface EnvironmentOptions {
  readonly parent: Readonly<Record<string, string | undefined>>
  readonly accountVariables?: Readonly<Record<string, string | undefined>>
  readonly lgtmSocket?: string
  readonly lgtmToken?: string
}

const baseNames = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TERM", "TMPDIR", "TZ"])

export function buildBaseEnvironment(options: EnvironmentOptions): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(options.parent)) {
    if (value !== undefined && (baseNames.has(name) || name.startsWith("LC_"))) environment[name] = value
  }
  for (const [name, value] of Object.entries(options.accountVariables ?? {})) {
    if (value !== undefined && !name.startsWith("HERDR_") && !name.startsWith("LGTM_")) environment[name] = value
  }
  if (options.lgtmSocket !== undefined) environment.LGTM_SOCKET = options.lgtmSocket
  if (options.lgtmToken !== undefined) environment.LGTM_TOKEN = options.lgtmToken
  return environment
}
