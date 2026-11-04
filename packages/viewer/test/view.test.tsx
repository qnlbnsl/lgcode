import { renderToString } from "ink";
import { expect, it } from "vitest";
import { Viewer } from "../src/index.ts";

type ViewProps = {
  readonly agents: ReadonlyArray<{ readonly agentId: string; readonly name: string; readonly status: string }>;
  readonly selectedAgentId: string;
  readonly thread: ReadonlyArray<{ readonly sequence: number; readonly text: string }>;
};

const View = Viewer as unknown as (props: ViewProps) => React.ReactNode;

it("V81 catches a viewer that cannot list agents, open a thread, or display a later live item", () => {
  const first = renderToString(<View
    agents={[{ agentId: "lead-1", name: "Lead One", status: "working" }]}
    selectedAgentId="lead-1"
    thread={[{ sequence: 1, text: "First update" }]}
  />);
  const updated = renderToString(<View
    agents={[{ agentId: "lead-1", name: "Lead One", status: "working" }]}
    selectedAgentId="lead-1"
    thread={[{ sequence: 1, text: "First update" }, { sequence: 2, text: "Live update" }]}
  />);

  expect(first).toContain("Lead One");
  expect(first).toContain("First update");
  expect(updated).toContain("Live update");
});
