// Repository-owned recipes, reviewed on 2026-11-13. These are never merged with
// client payloads, settings, environment variables or executable output.
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
  // Only code constructing a test service supplies steps. Production recipes
  // always use the npm invocation constructed from the fixed packages below.
  readonly steps?: ReadonlyArray<{ readonly executable: string; readonly args: ReadonlyArray<string> }>
}

export const installRecipes: ReadonlyArray<RecipeDefinition> = [
  { harnessId: "claude", name: "Claude Code", executable: "claude", automatic: true,
    packages: ["@anthropic-ai/claude-code@2.1.325"], registry: "https://registry.npmjs.org",
    source: "https://code.claude.com/docs/en/setup#install-with-npm", signIn: ["claude", "auth", "login"] },
  { harnessId: "codex", name: "Codex", executable: "codex", automatic: true,
    // Matches the CLI version pinned by this repository's ACP adapter.
    packages: ["@openai/codex@0.166.0"], registry: "https://registry.npmjs.org",
    source: "https://learn.chatgpt.com/docs/codex/cli", signIn: ["codex", "login"] },
  { harnessId: "gemini", name: "Gemini CLI", executable: "gemini", automatic: true,
    packages: ["@google/gemini-cli@0.68.0"], registry: "https://registry.npmjs.org",
    source: "https://geminicli.com/docs/get-started/installation/", signIn: ["gemini"] },
  { harnessId: "cursor", name: "Cursor", executable: "agent", automatic: false,
    packages: [], registry: "https://cursor.com", source: "https://cursor.com/docs/cli/installation",
    signIn: ["agent", "login"], manualCommand: "curl https://cursor.com/install -fsS | bash",
    reason: "Cursor documents a download piped into a shell. Run its official installer yourself, then check again." }
]
