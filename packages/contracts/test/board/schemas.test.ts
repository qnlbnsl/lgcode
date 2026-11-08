import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Contracts from "../../src/index.ts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { agent, codec, commandNames, exported, post, samples } from "./fixtures.ts";

const fieldsFor = (schema: Schema.Codec<unknown>, tag: string): string[] => {
  const members = schema.ast._tag === "Union" ? schema.ast.types : [schema.ast];
  const member = members.find((ast) => ast._tag === "Objects" && ast.propertySignatures.some((p) =>
    p.name === "_tag" && p.type._tag === "Literal" && p.type.literal === tag));
  expect(member, `${tag} must be a declared event struct`).toBeDefined();
  expect(member!._tag).toBe("Objects");
  return member!._tag === "Objects" ? member.propertySignatures.map((p) => String(p.name)) : [];
};

describe("ids, modes, authors, outcomes", () => {
  it.each(["ChannelId", "PostId", "WakeId"])("1.1 %s refuses empty and non-string ids while preserving an opaque id", (name) => {
    const decode = Schema.decodeUnknownSync(codec(name));
    expect(decode("opaque-1")).toBe("opaque-1");
    for (const bad of ["", 1, null, undefined]) expect(() => decode(bad)).toThrow();
  });
  it("1.1 brands keep channel, post, wake and agent ids distinct at compile time", () => {
    for (const name of ["ChannelId", "PostId", "WakeId"]) codec(name);
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const home = mkdtempSync("/tmp/lgcode-board-brands-");
    try {
      const file = join(home, "brands.mts");
      writeFileSync(file, `
import { ChannelId, PostId, WakeId } from ${JSON.stringify(join(root, "packages/contracts/src/board/ids.ts"))};
import { AgentId } from ${JSON.stringify(join(root, "packages/contracts/src/ids.ts"))};
const channel: typeof ChannelId.Type = ChannelId.make("c");
const post: typeof PostId.Type = PostId.make("p");
const wake: typeof WakeId.Type = WakeId.make("w");
const agent: typeof AgentId.Type = AgentId.make("a");
// @ts-expect-error An unvalidated string is not a channel id.
const plain: typeof ChannelId.Type = "c";
// @ts-expect-error A post cannot select a channel.
const postAsChannel: typeof ChannelId.Type = post;
// @ts-expect-error A channel cannot select a wake.
const channelAsWake: typeof WakeId.Type = channel;
// @ts-expect-error A wake cannot select a post.
const wakeAsPost: typeof PostId.Type = wake;
// @ts-expect-error An agent cannot select a post.
const agentAsPost: typeof PostId.Type = agent;
void [plain, postAsChannel, channelAsWake, wakeAsPost, agentAsPost];
`);
      let status = 0, output = "";
      try {
        output = execFileSync(join(root, "node_modules/.bin/tsc"), ["--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "ESNext", "--module", "NodeNext", "--allowImportingTsExtensions", file], { cwd: root, encoding: "utf8", stdio: "pipe", timeout: 60_000 });
      } catch (error) {
        const failure = error as { status?: number; stdout?: unknown; stderr?: unknown };
        status = failure.status ?? -1;
        output = String(failure.stdout ?? "") + String(failure.stderr ?? "");
      }
      expect({ status, output }).toEqual({ status: 0, output: "" });
    } finally { rmSync(home, { force: true, recursive: true }); }
  });
  it.each([
    ["ReplyMode", ["none", "any", "all"]],
    ["Disposition", ["replied", "gone", "removed", "undeliverable", "no-answer"]],
    ["CloseOutcome", ["answered", "unanswerable", "withdrawn"]],
  ] as const)("1.1 %s accepts all contract cases and refuses invented cases", (name, values) => {
    const decode = Schema.decodeUnknownSync(codec(name));
    for (const value of values) expect(decode(value)).toBe(value);
    for (const bad of ["unknown", "", null, 0]) expect(() => decode(bad)).toThrow();
  });
  it("1.1 BoardAuthor distinguishes owner, agent and service without admitting a piece caller", () => {
    const decode = Schema.decodeUnknownSync(codec("BoardAuthor"));
    for (const author of [{ _tag: "owner" }, agent("a"), { _tag: "service", service: "roles.sheepdog" }]) expect(decode(author)).toEqual(author);
    for (const bad of [{ _tag: "agent" }, agent(""), { _tag: "service", service: "" }, { _tag: "piece", namespace: "board" }]) expect(() => decode(bad)).toThrow();
  });
  it("1.1 a group channel requires and retains its anchor agent id", () => {
    const schema = codec("BoardEvent");
    const decode = Schema.decodeUnknownSync(schema);
    expect(decode(samples[0])).toEqual(samples[0]);
    const { anchorAgentId: _anchor, ...noAnchor } = samples[0]!;
    expect(() => decode(noAnchor)).toThrow();
  });
});

describe("events round-trip", () => {
  it("requires the captured completion text manifest rather than inferring it from replies", () => {
    const { completionReplyText: _manifest, ...missing } = samples[7]!;
    for (const schema of [codec("BoardEvent"), Contracts.Event]) {
      const decode = Schema.decodeUnknownSync(schema);
      expect(() => decode(missing)).toThrow();
      expect(decode({ ...missing, completionReplyText: [] })).toEqual({ ...missing, completionReplyText: [] });
      expect(decode({ ...missing, completionReplyText: ["post-0"] })).toEqual(samples[7]);
    }
  });
  it.each(samples.map((event) => [event._tag, event] as const))("1.2 %s survives BoardEvent, Event and JSON without stripping fields", (_tag, wire) => {
    for (const schema of [codec("BoardEvent"), Contracts.Event]) {
      const decoded = Schema.decodeUnknownSync(schema)(wire);
      expect(decoded).toEqual(wire);
      expect(Schema.decodeUnknownSync(schema)(JSON.parse(JSON.stringify(Schema.encodeSync(schema)(decoded))))).toEqual(wire);
    }
  });
  it("1.2 WakeBuilt indexes the source wake before a delivery id exists", () => {
    const schema = codec("BoardEvent");
    const decoded = Schema.decodeUnknownSync(schema)(samples[7]) as Record<string, unknown>;
    expect(decoded).toMatchObject({ wakeId: "wake-1", targetAgentId: "target", reminders: ["post-reminder"], noAnswers: [{ postId: "post-no-answer", addressee: agent("silent") }] });
    expect(Object.keys(decoded)).not.toContain("deliveryId");
    expect(fieldsFor(schema, "board.WakeBuilt")).not.toContain("deliveryId");
  });
  it.each(["no-answer", "gone", "removed", "undeliverable"])("1.2 resolves %s without a deciding reply", (disposition) => {
    const wire = { _tag: "board.AddresseeResolved", postId: "post-1", addressee: agent("target"), disposition, authorIsOwner: true };
    expect(Schema.decodeUnknownSync(codec("BoardEvent"))(wire)).toEqual(wire);
  });
});

describe("hidden from agents", () => {
  it.each(samples.map((event) => event._tag))("1.3 %s is explicitly owner-only in both visibility tables and has no agentId field", (tag) => {
    const visibility = exported<Record<string, string>>("boardVisibility");
    expect(visibility[tag]).toBe("owner-only");
    expect((Contracts.eventVisibility as Record<string, string>)[tag]).toBe("owner-only");
    const schema = codec("BoardEvent");
    expect(fieldsFor(schema, tag)).not.toContain("agentId");
  });
});

describe("access table", () => {
  const expected = {
    "board.open": ["owner", "agent"], "board.members": ["owner", "agent"],
    "board.post": ["owner", "agent", "service"], "board.close": ["owner", "agent", "service"],
    "board.acknowledge": ["owner", "agent"], "board.read": ["owner", "agent"],
    "board.channels": ["owner", "agent"], "board.status": ["owner", "agent", "service"],
    "board.flush": ["owner", "service"],
  };
  it.each(Object.entries(expected))("1.4 %s grants only its contract caller kinds", (name, kinds) => {
    expect(exported<Record<string, unknown>>("boardAccess")[name]).toEqual(kinds);
    expect((Contracts.commandAccess as Record<string, unknown>)[name]).toEqual(kinds);
  });
  it("1.4 all nine commands are in the served group, with no unprefixed or extra board commands", () => {
    const group = exported<{ requests: ReadonlyMap<string, unknown> }>("BoardRpcGroup");
    expect([...group.requests.keys()].sort()).toEqual([...commandNames].sort());
    for (const name of commandNames) expect(Contracts.ServiceRpcGroup.requests.has(name)).toBe(true);
  });
});

const rpc = (name: string) => {
  const command = Contracts.CommandsRpcGroup.requests.get(name);
  expect(command, `${name} must join CommandsRpcGroup`).toBeDefined();
  return command!;
};
describe("limits", () => {
  it("1.5 post payload accepts 16,384 characters and rejects one more", () => {
    const decode = Schema.decodeUnknownSync(rpc("board.post").payloadSchema);
    const payload = { requestId: "request", channelId: "channel-1", text: "x".repeat(16_384), to: [agent("target")], reply: "all" };
    expect(decode(payload)).toEqual(payload);
    expect(() => decode({ ...payload, text: "x".repeat(16_385) })).toThrow();
  });
  it("1.5 post payload accepts sixteen addressees and refuses seventeen", () => {
    const decode = Schema.decodeUnknownSync(rpc("board.post").payloadSchema);
    const payload = { requestId: "request", channelId: "channel-1", text: "Question", to: Array.from({ length: 16 }, (_, i) => agent(`a-${i}`)), reply: "all" };
    expect(decode(payload)).toEqual(payload);
    expect(() => decode({ ...payload, to: [...payload.to, agent("seventeenth")] })).toThrow();
  });
  it("1.5 channel names use the complete anchored slug pattern at both boundaries", () => {
    const decode = Schema.decodeUnknownSync(rpc("board.open").payloadSchema);
    for (const name of ["A", "a".repeat(64), "Team_1-2"]) expect(decode({ requestId: "r", name })).toEqual({ requestId: "r", name });
    for (const name of ["", "a".repeat(65), "1team", " team", "team ", "a/b", "a.b", "a\nb", "équipe"]) expect(() => decode({ requestId: "r", name })).toThrow();
  });
  it("1.5 status summary is a fixed set of scalar fields, without post text or lists", () => {
    const schema = codec("BoardStatusSummary");
    const wire = { requestId: "r", agentId: "target", unread: 4, incomingOpen: 2, ownOpen: 1, owed: 3, failedCompletions: 1, wakeQueued: true, wakeSent: false, holdsUnsettled: true, holdsIncoming: true, sequence: 10, disabled: false };
    expect(Schema.decodeUnknownSync(schema)(wire)).toEqual(wire);
    const decoded = Schema.decodeUnknownSync(rpc("board.status").successSchema)(wire);
    expect(decoded).toEqual(wire);
    expect(schema.ast._tag).toBe("Objects");
    if (schema.ast._tag !== "Objects") return;
    expect(schema.ast.propertySignatures.map((p) => String(p.name)).sort()).toEqual(Object.keys(wire).sort());
    for (const key of ["unread", "incomingOpen", "ownOpen", "owed", "failedCompletions"]) {
      expect(() => Schema.decodeUnknownSync(schema)({ ...wire, [key]: -1 })).toThrow();
      expect(() => Schema.decodeUnknownSync(schema)({ ...wire, [key]: ["post-1"] })).toThrow();
    }
  });
  it("1.5 completion holds seventeen deciding reply ids even when total replies are much larger", () => {
    const decode = Schema.decodeUnknownSync(codec("BoardCompletion"));
    const wire = { postId: "post-1", outcome: "answered", dispositions: Array.from({ length: 16 }, (_, i) => ({ addressee: agent(`a-${i}`), disposition: "replied", replyId: `reply-${i}` })), replyIds: Array.from({ length: 17 }, (_, i) => `reply-${i}`), totalReplies: 100_000, replies: [] };
    expect(decode(wire)).toEqual(wire);
    expect(() => decode({ ...wire, replyIds: [...wire.replyIds, "reply-18"] })).toThrow();
  });
  it("1.5 event schema independently enforces post bounds before log decode", () => {
    const decode = Schema.decodeUnknownSync(codec("BoardEvent"));
    expect(decode({ ...post, text: "x".repeat(16_384) })).toEqual({ ...post, text: "x".repeat(16_384) });
    expect(() => decode({ ...post, text: "x".repeat(16_385) })).toThrow();
    expect(() => decode({ ...post, to: Array.from({ length: 17 }, (_, i) => agent(`a-${i}`)) })).toThrow();
  });
});
