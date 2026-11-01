import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

// Hermes copies the string on every `trim()`, even when nothing changes.
// Returning the original keeps repeated IDs shared after decode.
const trim = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length === value.length ? value : trimmed;
};

export const TrimmedString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformEffect({
      decode: (value) => Effect.succeed(trim(value)),
      encode: (value) => Effect.succeed(trim(value)),
    }),
  ),
);
// `make` and encode see untrimmed values; `isNonEmpty` would accept whitespace that encodes to an invalid empty string.
const isNonBlank = Schema.makeFilter((value: string) => value.trim().length > 0, {
  expected: "a non-blank string",
  toJsonSchema: () => [{ minLength: 1 }, true],
  arbitraryConstraint: { minLength: 1 },
});
export const TrimmedNonEmptyString = TrimmedString.check(isNonBlank);
