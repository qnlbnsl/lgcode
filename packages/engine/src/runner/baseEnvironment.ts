interface EnvironmentOptions {
  readonly parent: Readonly<Record<string, string | undefined>>
  readonly accountVariables?: Readonly<Record<string, string | undefined>>
  readonly lgcodeSocket?: string
  readonly lgcodeToken?: string
}

const baseNames = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TERM", "TMPDIR", "TZ"])

export function buildBaseEnvironment(options: EnvironmentOptions): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(options.parent)) {
    if (value !== undefined && (baseNames.has(name) || name.startsWith("LC_"))) environment[name] = value
  }
  for (const [name, value] of Object.entries(options.accountVariables ?? {})) {
    if (value !== undefined && !name.startsWith("HERDR_") && !name.startsWith("LGCODE_")) environment[name] = value
  }
  if (options.lgcodeSocket !== undefined) environment.LGCODE_SOCKET = options.lgcodeSocket
  if (options.lgcodeToken !== undefined) environment.LGCODE_TOKEN = options.lgcodeToken
  return environment
}
