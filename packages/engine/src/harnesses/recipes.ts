// Repository-owned recipes, reviewed on 2026-11-13. These are never merged with
// client payloads, settings, environment variables or executable output.
// Automatic recipes use the committed npm v3 lockfiles and --ignore-scripts.
// No automatic package may run a lifecycle script. Gemini's optional native
// terminal integrations are not required by its stdio ACP mode.
// Claude Code needs @anthropic-ai/claude-code's postinstall native-binary link;
// it is manual until that step can be supplied without executing install scripts.
export interface RecipeDefinition {
  readonly harnessId: string
  readonly name: string
  readonly executable: string
  readonly automatic: boolean
  readonly packages: ReadonlyArray<string>
  readonly registry: string
  readonly source: string
  readonly signIn: ReadonlyArray<string>
  readonly manualCommand?: string
  readonly reason?: string
  readonly signInSource: string
  readonly version?: string

}

export const installRecipes: ReadonlyArray<RecipeDefinition> = [
  { harnessId: "claude", name: "Claude Code", executable: "claude", automatic: false,
    packages: ["@anthropic-ai/claude-code@2.1.325"], registry: "https://registry.npmjs.org",
    version: "2.1.325", source: "https://code.claude.com/docs/en/setup#install-with-npm",
    signInSource: "https://code.claude.com/docs/en/cli-reference", manualCommand: "npm install -g @anthropic-ai/claude-code@2.1.325",
    reason: "Claude Code's npm package needs its postinstall script to link a native binary. This automatic installer disables all scripts. The bundled Claude adapter can already run without a separate CLI install.", signIn: ["claude", "auth", "login"] },
  { harnessId: "codex", name: "Codex", executable: "codex", automatic: true,
    // Matches the CLI version pinned by this repository's ACP adapter.
    packages: ["@openai/codex@0.166.0"], registry: "https://registry.npmjs.org",
    version: "0.166.0", source: "https://learn.chatgpt.com/docs/changelog",
    signInSource: "https://learn.chatgpt.com/docs/developer-commands?surface=cli#codex-login", signIn: ["codex", "login"] },
  { harnessId: "gemini", name: "Gemini CLI", executable: "gemini", automatic: true,
    packages: ["@google/gemini-cli@0.68.0"], registry: "https://registry.npmjs.org",
    version: "0.68.0", source: "https://geminicli.com/docs/get-started/installation/",
    signInSource: "https://geminicli.com/docs/get-started/authentication/", signIn: ["gemini"] },
  { harnessId: "cursor", name: "Cursor", executable: "agent", automatic: false,
    packages: [], registry: "https://cursor.com", source: "https://cursor.com/docs/cli/installation",
    signInSource: "https://cursor.com/docs/cli/reference/authentication", signIn: ["agent", "login"], manualCommand: "curl https://cursor.com/install -fsS | bash",
    reason: "Cursor documents a download piped into a shell. Run its official installer yourself, then check again." }
]
