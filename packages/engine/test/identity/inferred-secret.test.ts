import { expect, it } from "vitest";

import { isInferredSecretValue } from "../../src/identity/inferredSecret.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

it.each([
  ["seven non-numeric characters", "abcdefg", false],
  ["eight non-numeric characters", "abcdefgh", true],
  ["padded mixed-case boolean", "  True  ", false],
  ["exponent notation", "1e5", false],
  ["signed number above the length boundary", "-12345678", false],
  ["number with a non-numeric suffix", "12345678a", true],
  ["eight spaces", "        ", false],
  ["missing environment value", undefined, false],
] as const)("A4 inferred secret gate: %s", (_name, value, expected) => {
  expect(isInferredSecretValue(value)).toBe(expected);
});
