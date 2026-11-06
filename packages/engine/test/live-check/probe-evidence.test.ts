import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanTokens, receivedUserText, slashReceipt, exactCommand, authRefused } from "../../scripts/live/probeEvidence.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("probe evidence observes actual inputs instead of agent claims", () => {
  it("finds a planted agent token in a session file and reports its path without matched text", () => {
    const root = mkdtempSync('/tmp/lcp-evidence-'); roots.push(root);
    const file = join(root, 'session.jsonl');
    const token = 'shp_a_planted-token-1234567890123456';
    writeFileSync(file, JSON.stringify({ message: { role: 'assistant', content: token } }));
    const result = scanTokens([token], [file], [{ label: 'arguments of process 41', text: 'node adapter' }]);
    expect(result.leaks.join(' ')).toContain(file);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.files).toBe(1);
    expect(result.arguments).toBe(1);
  });
  it("fails closed on an empty token set, empty file set, or unreadable file", () => {
    expect(() => scanTokens([], ['x'], [])).toThrow(/token/);
    expect(() => scanTokens(['shp_a_planted-token-12345'], [], [])).toThrow(/session/);
    expect(() => scanTokens(['shp_a_planted-token-12345'], ['/tmp/absent-lcp-file'], [])).toThrow();
  });
  it("finds a token in arguments and records only the process label", () => {
    const root = mkdtempSync('/tmp/lcp-evidence-'); roots.push(root);
    const file = join(root, 's'); writeFileSync(file, '{}');
    const token = 'shp_a_only-in-arguments-123456';
    const result = scanTokens([token], [file], [{ label: 'arguments of process 42', text: `node --token=${token}` }]);
    expect(result.leaks).toEqual(['secret 1 (raw) in arguments of process 42']);
  });
  it.each(['claude', 'codex'])("accepts /compact only in received user content for %s, with the exact envelope marker and no compaction", (harness) => {
    const text = 'Data from another agent [M] (delivery d-1):\n\\/compact lcp-slash\nEnd data [M]';
    const record = harness === 'claude' ? { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
      : { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } };
    expect(slashReceipt(receivedUserText(JSON.stringify(record)), 'd-1', '/compact lcp-slash', false)).toBe('escaped; no command');
    expect(slashReceipt([text.replace('\\/compact', '/compact')], 'd-1', '/compact lcp-slash', false)).toBe('unescaped');
    expect(slashReceipt([text], 'd-1', '/compact lcp-slash', true)).toBe('command ran');
    expect(slashReceipt([text], 'other-id', '/compact lcp-slash', false)).toBe('not attempted');
    const assistant = harness === 'claude' ? { ...record, message: { role: 'assistant', content: text } }
      : { ...record, payload: { role: 'assistant', content: [{ type: 'output_text', text }] } };
    expect(receivedUserText(JSON.stringify(assistant))).toEqual([]);
  });
  it("does not approve a similar command or mistake missing executable and agent claims for ancestry refusal", () => {
    expect(exactCommand(JSON.stringify({ command: 'printf ok' }), 'printf ok')).toBe(true);
    expect(exactCommand(JSON.stringify({ command: 'printf ok; id' }), 'printf ok')).toBe(false);
    expect(exactCommand(JSON.stringify({ command: ['printf', 'ok'] }), 'printf ok')).toBe(false);
    expect(authRefused('the engine refused this identity (HTTP 403)', 1)).toBe(true);
    expect(authRefused('the engine refused this identity (HTTP 403)', 0)).toBe(false);
    expect(authRefused('command not found', 127)).toBe(false);
  });
});

it('ignores unrelated session files and symlinks when selecting only a run session id', async () => {
  const { sessionFiles } = await import('../../scripts/live/probeEvidence.ts');
  const { symlinkSync } = await import('node:fs');
  const root = mkdtempSync('/tmp/lcp-files-'); roots.push(root);
  mkdirSync(join(root, '2026'));
  const correct = join(root, '2026', 'rollout-time-session-a.jsonl');
  writeFileSync(correct, '{}');
  writeFileSync(join(root, 'session-a-other.jsonl'), 'unrelated');
  const decoy = join(root, 'other.jsonl'); writeFileSync(decoy, 'secret-looking decoy');
  symlinkSync(decoy, join(root, 'session-a.jsonl'));
  expect(sessionFiles(root, 'session-a')).toEqual([correct]);
  expect(() => sessionFiles(root, '../other')).toThrow('invalid session identifier');
});

it('never repeats malformed session content in a parser error', () => {
  const token = 'shp_a_bad-json-secret-12345678';
  expect(() => receivedUserText(`{"message":"${token}`)).toThrow('content is not printed');
  try { receivedUserText(`{"message":"${token}`); } catch (error) { expect(String(error)).not.toContain(token); }
});

it('matches the recorded adapter MCP argument shape and rejects the same payload aimed at another server', async () => {
  const { mcpAskInput } = await import('../../scripts/live/probeEvidence.ts');
  expect(mcpAskInput(JSON.stringify({ server: 'sheprd', tool: 'ask', arguments: { text: 'marker' } }), 'mcp.sheprd.ask', 'marker')).toBe(true);
  expect(mcpAskInput(JSON.stringify({ text: 'marker' }), 'mcp__sheprd__ask', 'marker')).toBe(true);
  expect(mcpAskInput(JSON.stringify({ server: 'other', tool: 'ask', arguments: { text: 'marker' } }), 'mcp.other.ask', 'marker')).toBe(false);
  expect(mcpAskInput(JSON.stringify({ text: 'marker' }), 'Write file', 'marker')).toBe(false);
});

it('matches a canonical shell wrapper only when its entire inner command is the exact requested string', () => {
  const command = "printf 'ok'";
  expect(exactCommand(JSON.stringify({command: "/bin/bash -lc 'printf '\\''ok'\\'''"}), command)).toBe(true);
  expect(exactCommand(JSON.stringify({command: "/bin/bash -lc 'printf '\\''ok'\\''; id'"}), command)).toBe(false);
});
