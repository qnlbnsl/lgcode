// Unit 8c, fix round 1, finding F5: the live-view step proves a second owner
// connection sees the worker's work while the permission is open. A request
// with no thread item before it shows no work, so the step must fail. This is
// a separate case from a turn that ended early (adversarial-flow.test.ts).
import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../scripts/live/run.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { scriptedApi } from "./scripted-api.ts";

registerRebuildCheck({ noLog: true });
const fixtures: Array<ReturnType<typeof scriptedApi>> = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.dispose(); });

describe("the live-view step", () => {
  it("fails when no worker thread item reached the second connection before the permission request, and no permission is answered (breaks if the step passes on the request alone; finding F5)", async () => {
    const fixture = scriptedApi({ noThreadItem: true });
    fixtures.push(fixture);
    expect(await main([], fixture.deps)).toBe(1);
    const failure = fixture.lines.find((line) => line.startsWith("FAIL live-view:"));
    expect(failure, fixture.lines.join("\n")).toBeDefined();
    expect(failure).toMatch(/thread item/i);
    expect(fixture.answers).toEqual([]);
    expect(fixture.lines.filter((line) => line.startsWith("SKIP ")).length).toBeGreaterThan(0);
  });

  it("passes when a worker thread item arrives before the permission request (the case above and this one differ only in that item)", async () => {
    const fixture = scriptedApi();
    fixtures.push(fixture);
    expect(await main([], fixture.deps)).toBe(0);
    expect(fixture.lines.find((line) => line.startsWith("PASS live-view:"))).toBeDefined();
  });
});
