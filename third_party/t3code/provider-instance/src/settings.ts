// Local stand-ins for T3 Code's `CodexSettings` and `ClaudeSettings`, which are large
// settings-form schemas in T3 Code's contracts package. The copied code reads only these fields.
export interface CodexSettings {
  readonly homePath: string;
  readonly shadowHomePath: string;
}

export interface ClaudeSettings {
  readonly homePath: string;
  readonly binaryPath: string;
}
