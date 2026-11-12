// These links point to the adapter/provider's own installation documentation.
// They are guidance only. Scanning never runs installation or login commands.
export const setupHarnessGuidance = {
  claude: { documentation: "https://github.com/agentclientprotocol/claude-agent-acp", guidance: "LGTM Studio supplies the Claude ACP adapter. Configure its executable, then sign in to Claude separately or configure your Anthropic API key." },
  codex: { documentation: "https://github.com/agentclientprotocol/codex-acp", guidance: "LGTM Studio supplies the Codex ACP adapter. Configure its executable and sign in using the account's effective Codex home, or configure your OpenAI API key." },
  gemini: { documentation: "https://geminicli.com/docs/get-started/installation/", guidance: "Install Gemini CLI, make gemini available on the service PATH, then sign in separately or configure your Gemini API key." },
  cursor: { documentation: "https://cursor.com/docs/cli/overview", guidance: "Install Cursor CLI, make agent available on the service PATH, then sign in separately or configure your Cursor API key." }
} as const satisfies Readonly<Record<"claude" | "codex" | "gemini" | "cursor", { readonly documentation: string; readonly guidance: string }>>
