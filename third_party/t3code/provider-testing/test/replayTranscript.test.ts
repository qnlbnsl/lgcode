// Written for Shepherd. T3 Code has no unit test for these helpers, so this file checks
// that replay transcripts decode (plan criterion 2.4) and that bad input is refused.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  decodeProviderReplayNdjson,
  materializeReplayTranscriptWorkspace,
  ProviderReplayNdjsonEmptyError,
  ProviderReplayNdjsonLineParseError,
  ProviderReplayNdjsonMissingHeaderError,
  readProviderReplayTranscript,
} from "../src/replayTranscript.ts";

const header = {
  type: "transcript_start",
  provider: "example",
  protocol: "acp",
  version: "1",
  scenario: "greeting",
};
const records = [
  header,
  { type: "expect_outbound", label: "initialize", frame: { method: "initialize", cwd: "<workspace>" } },
  { type: "emit_inbound", frame: { result: "ok" }, afterMs: 5 },
  { type: "runtime_exit", status: "success" },
];
const ndjson = (lines: ReadonlyArray<unknown>): string =>
  lines.map((line) => JSON.stringify(line)).join("\n") + "\n";

describe("provider replay transcripts", () => {
  it.effect("decodes a header followed by entries", () =>
    Effect.gen(function* () {
      const transcript = yield* decodeProviderReplayNdjson(ndjson(records));
      expect(transcript).toMatchObject({
        provider: "example",
        protocol: "acp",
        version: "1",
        scenario: "greeting",
      });
      expect(transcript.entries.map((entry) => entry.type)).toEqual([
        "expect_outbound",
        "emit_inbound",
        "runtime_exit",
      ]);
    }),
  );

  it.effect("accepts entries alone when fallback metadata is supplied", () =>
    Effect.gen(function* () {
      const transcript = yield* decodeProviderReplayNdjson(ndjson(records.slice(1)), {
        provider: "fallback",
        protocol: "acp",
        version: "2",
        scenario: "no-header",
      });
      expect(transcript.provider).toBe("fallback");
      expect(transcript.entries).toHaveLength(3);
    }),
  );

  it.effect("refuses empty input, a missing header, a bad line and a second header", () =>
    Effect.gen(function* () {
      const empty = yield* Effect.result(decodeProviderReplayNdjson("\n  \n"));
      expect(Result.isFailure(empty) && empty.failure).toBeInstanceOf(ProviderReplayNdjsonEmptyError);

      const headerless = yield* Effect.result(decodeProviderReplayNdjson(ndjson(records.slice(1))));
      expect(Result.isFailure(headerless) && headerless.failure).toBeInstanceOf(
        ProviderReplayNdjsonMissingHeaderError,
      );

      const bad = yield* Effect.result(decodeProviderReplayNdjson(`${JSON.stringify(header)}\nnot json\n`));
      expect(Result.isFailure(bad) && bad.failure).toBeInstanceOf(ProviderReplayNdjsonLineParseError);

      const second = yield* Effect.result(decodeProviderReplayNdjson(ndjson([header, header])));
      expect(Result.isFailure(second) && second.failure).toBeInstanceOf(ProviderReplayNdjsonLineParseError);
    }),
  );

  it.effect("replaces the workspace placeholder in expected outbound frames only", () =>
    Effect.gen(function* () {
      const transcript = yield* decodeProviderReplayNdjson(ndjson(records));
      const materialized = materializeReplayTranscriptWorkspace(transcript, "/work/space");
      expect(materialized.entries[0]).toMatchObject({ frame: { cwd: "/work/space" } });
      expect(materialized.entries[1]).toEqual(transcript.entries[1]);
    }),
  );

  it.layer(NodeServices.layer)("reads from a file URL", (it) => {
    it.effect("decodes a transcript file", () =>
      Effect.gen(function* () {
        const transcript = yield* readProviderReplayTranscript(
          new URL("./fixtures/greeting.ndjson", import.meta.url),
        );
        expect(transcript.scenario).toBe("greeting");
        expect(transcript.entries).toHaveLength(3);
      }),
    );
  });
});
