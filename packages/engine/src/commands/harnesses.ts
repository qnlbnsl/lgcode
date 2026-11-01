import type { Payload, Plan } from "./internal.ts";

export const harnesses = (payload: Payload<"harnesses">): Plan => ({
  events: payload.operation === "list" ? [] : [{ _tag: "HarnessChanged", harness: payload.harness }],
});
