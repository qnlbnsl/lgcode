import { createElement as h } from "react";
import { Box, Text } from "ink";
import { oneLine, safeText } from "./text.ts";

export interface ViewerProps {
  readonly agents?: ReadonlyArray<{ readonly agentId: string; readonly name: string; readonly status: string }>;
  readonly selectedAgentId?: string;
  readonly thread?: ReadonlyArray<{ readonly sequence: number; readonly text: string }>;
}

// This data-only view can also be rendered without a live terminal or socket.
export function Viewer({ agents, selectedAgentId, thread = [] }: ViewerProps = {}) {
  if (agents === undefined) return h(Text, null, "Sheprd viewer");
  return h(Box, { flexDirection: "column" },
    h(Text, { bold: true }, "Sheprd viewer — Agents"),
    ...agents.map((agent) => h(Text, { key: agent.agentId },
      `${selectedAgentId === agent.agentId ? ">" : " "} ${oneLine(agent.name)} (${oneLine(agent.status)})`)),
    h(Text, { bold: true }, "Thread — agent data"),
    ...thread.map((item) => h(Text, { key: item.sequence }, safeText(item.text).split("\n").map((line) => `| ${line}`).join("\n"))),
  );
}
