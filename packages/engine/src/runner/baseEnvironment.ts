interface EnvironmentOptions {
  readonly parent: Readonly<Record<string, string | undefined>>
  readonly accountVariables?: Readonly<Record<string, string | undefined>>
  readonly shephrdSocket?: string
  readonly shephrdToken?: string
}

const baseNames = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TERM", "TMPDIR", "TZ"])

export function buildBaseEnvironment(options: EnvironmentOptions): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(options.parent)) {
    if (value !== undefined && (baseNames.has(name) || name.startsWith("LC_"))) environment[name] = value
  }
  for (const [name, value] of Object.entries(options.accountVariables ?? {})) {
    if (value !== undefined && !name.startsWith("HERDR_") && !name.startsWith("SHEPHRD_")) environment[name] = value
  }
  if (options.shephrdSocket !== undefined) environment.SHEPHRD_SOCKET = options.shephrdSocket
  if (options.shephrdToken !== undefined) environment.SHEPHRD_TOKEN = options.shephrdToken
  return environment
}
