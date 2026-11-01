import type { ReplayItem } from "../runner/Runner.ts";

// Rows 29, 51 and 66: while an agent's session reloads, the replayed history
// is scanned for delivery ids that were sent but not accepted. Only user
// message content counts, after joining consecutive user chunks: an agent
// chunk, a plan, a tool call or a file change ends the user's run.
//
// Issue 154: the runner returns the replay with the load result, in order,
// so the scan reads every replayed update of that load and never depends on
// when the command handler drains the event stream.
export const userRuns = (replay: ReadonlyArray<ReplayItem>): ReadonlyArray<string> => {
  const runs: Array<string> = [];
  let open = false;
  for (const item of replay) {
    if (item._tag !== "user") {
      open = false;
      continue;
    }
    if (open) runs[runs.length - 1] += item.text;
    else {
      runs.push(item.text);
      open = true;
    }
  }
  return runs;
};

// Ruling 2 of fix round 1: a run proves a delivery only by the exact form the
// engine writes into the prompt, `(delivery <id>)`, which both the envelope
// (routing/envelope.ts) and the carry-on (accounts/available.ts) use. A bare
// id elsewhere in the text proves nothing.
export const replayedDelivery = (runs: ReadonlyArray<string>, deliveryId: string): boolean => {
  const form = `(delivery ${deliveryId})`;
  return runs.some((text) => text.includes(form));
};
