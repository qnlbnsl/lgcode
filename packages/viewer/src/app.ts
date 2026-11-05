import { createElement as h, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, usePaste, useStdout } from "ink";
import type { ViewerClient } from "./connection.ts";
import { answerRequest, promptAgent, readRequestContext, type PermissionRequest } from "./actions.ts";
import { ViewerSession, type RequestRow } from "./session.ts";
import { eventText, linesFor, oneLine, record, safeText } from "./text.ts";

type Mode = "thread" | "prompt" | "request" | "question";
interface ReviewedRequest {
  readonly row: RequestRow;
  readonly context: string;
  readonly permission?: PermissionRequest;
}

export function ViewerApp({ client }: { readonly client: ViewerClient }) {
  const [, redraw] = useState(0);
  const [session] = useState(() => new ViewerSession(client, () => redraw((n) => n + 1)));
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminal = stdout as NodeJS.WritableStream & Partial<Pick<NodeJS.WriteStream, "rows" | "columns">>;
  const [dimensions, setDimensions] = useState({ rows: terminal.rows || 24, columns: terminal.columns || 80 });
  const [mode, setMode] = useState<Mode>("thread");
  const [draft, setDraft] = useState("");
  const [draftTarget, setDraftTarget] = useState<string>();
  const [message, setMessage] = useState("Connecting…");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [review, setReview] = useState<ReviewedRequest>();
  const [requestIndex, setRequestIndex] = useState(0);
  const [optionIndex, setOptionIndex] = useState(0);
  const [scroll, setScroll] = useState<number | undefined>();
  const [contextScroll, setContextScroll] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void session.start().then(() => { if (mounted.current) setMessage(""); }, () => {
      if (mounted.current) setMessage("The viewer could not connect. Press r to retry.");
    });
    const resize = () => setDimensions({ rows: terminal.rows || 24, columns: terminal.columns || 80 });
    stdout.on("resize", resize);
    return () => { mounted.current = false; stdout.off("resize", resize); void session.close(); };
  }, [session, stdout]);

  const agents = session.snapshot?.agents ?? [];
  const selected = agents.findIndex((agent) => agent.agentId === session.selectedAgentId);
  const agent = agents[selected];
  const requests = session.requests;
  const pending = requests[requestIndex % Math.max(1, requests.length)];
  const height = Math.max(1, dimensions.rows - 13);
  const threadLines = session.items.flatMap((item) => linesFor(`[${item.sequence}] ${eventText(item.event)}`, dimensions.columns));
  const threadStart = Math.min(scroll ?? Math.max(0, threadLines.length - height), Math.max(0, threadLines.length - height));
  const contextLines = linesFor(review?.context ?? "Loading request context…", dimensions.columns);
  const contextStart = Math.min(contextScroll, Math.max(0, contextLines.length - height));
  const contextRead = review !== undefined && contextStart + height >= contextLines.length;
  const stillOpen = review !== undefined && requests.some((row) => row.id === review.row.id && row.kind === review.row.kind);

  const perform = (operation: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    void operation().catch(() => {
      if (mounted.current) setMessage("The operation failed or was refused. Refresh and inspect the request before retrying.");
    }).finally(() => { locked.current = false; if (mounted.current) setBusy(false); });
  };

  const finishSend = async (confirmation: string) => {
    // The write is acknowledged. Retire it before any fallible read so Enter
    // cannot turn a failed roster refresh into a second write.
    if (mounted.current) { setDraft(""); setMode("thread"); setReview(undefined); setMessage(confirmation); }
    try { await session.refresh(); }
    catch {
      if (mounted.current) setMessage(`${confirmation} The roster could not be refreshed. Press r to reload.`);
    }
  };

  const openRequest = (row: RequestRow) => {
    setReview(undefined);
    setOptionIndex(0);
    setContextScroll(0);
    setMode("request");
    setMessage("");
    perform(async () => {
      const reply = await client.event({ sequence: row.sourceSequence });
      const event = record(reply.envelope.event);
      if (event.agentId !== row.agentId || (row.kind === "permission"
        ? event._tag !== "PermissionRequested" || event.permissionRequestId !== row.id
        : event._tag !== "QuestionAsked" || event.questionId !== row.id)) throw new Error("Request identity mismatch");
      if (row.kind === "permission") {
        if (typeof event.toolCallId !== "string" || !Array.isArray(event.options)) throw new Error("Invalid permission request");
        const options = event.options.map((value: unknown) => {
          const option = record(value);
          if (typeof option.id !== "string") throw new Error("Invalid option");
          return { id: option.id, name: typeof option.name === "string" ? option.name : option.id };
        });
        const context = await readRequestContext({ ...client, event: async () => reply }, {
          agentId: row.agentId, sequence: row.sourceSequence, toolCallId: event.toolCallId,
        });
        if (mounted.current) setReview({ row, context: `${context}\n\nAgent title (data):\n${safeText(String(event.description ?? ""))}\n\nOptions (agent data):\n${options.map((option, i) => `${i + 1}. ${safeText(option.name)}`).join("\n")}`,
          permission: { permissionRequestId: row.id, options } });
      } else if (mounted.current) setReview({ row, context: `Question from agent (data):\n${safeText(String(event.text ?? ""))}` });
    });
  };

  const appendDraft = (text: string) => setDraft((value) => value + text);
  // Bracketed paste is data, including when it contains Enter or action keys.
  usePaste((text) => { if (mode === "prompt" || mode === "question") appendDraft(text); });
  useInput((input, key) => {
    if (locked.current) return;
    if (key.escape) { setMode("thread"); setReview(undefined); setDraft(""); setMessage(""); return; }
    if (mode === "prompt" || mode === "question") {
      if (key.return) {
        if (draft.length === 0) return;
        perform(async () => {
          if (mode === "prompt" && draftTarget !== undefined) await promptAgent(client, draftTarget, draft);
          else if (mode === "question" && review !== undefined && stillOpen) await client.answer({ kind: "question", id: review.row.id, text: draft });
          else throw new Error("The question is closed");
          await finishSend("Sent.");
        });
      } else if (key.backspace || key.delete) setDraft((value) => Array.from(value).slice(0, -1).join(""));
      else if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) appendDraft(input);
      return;
    }
    if (input === "q") { exit(); return; }
    if (mode === "request") {
      if (key.pageDown || key.downArrow || input === " ") setContextScroll(Math.min(contextStart + height, Math.max(0, contextLines.length - height)));
      else if (key.pageUp || key.upArrow) setContextScroll(Math.max(0, contextStart - height));
      else if (key.home) setContextScroll(0);
      else if (key.end) setContextScroll(Math.max(0, contextLines.length - height));
      else if (contextRead && stillOpen && review !== undefined) {
        const options = review.permission?.options ?? [];
        if (key.leftArrow) setOptionIndex((value) => Math.max(0, value - 1));
        else if (key.rightArrow) setOptionIndex((value) => Math.min(options.length - 1, value + 1));
        else if (key.return) {
          if (review.row.kind === "question") { setDraft(""); setMode("question"); }
          else if (review.permission !== undefined && options[optionIndex] !== undefined) perform(async () => {
            await answerRequest(client, review.permission!, options[optionIndex]!.id);
            await finishSend("Answered.");
          });
        }
      }
      return;
    }
    if (key.upArrow || key.downArrow) {
      const next = agents[(Math.max(0, selected) + (key.upArrow ? -1 : 1) + agents.length) % agents.length];
      if (next !== undefined) { setScroll(undefined); setRequestIndex(0); void session.select(next.agentId); }
    } else if (key.pageUp) setScroll(Math.max(0, threadStart - height));
    else if (key.pageDown) setScroll(Math.min(Math.max(0, threadLines.length - height), threadStart + height));
    else if (key.home) setScroll(0);
    else if (key.end) setScroll(undefined);
    else if (key.tab) setRequestIndex((value) => (value + 1) % Math.max(1, requests.length));
    else if (input === "a" && pending !== undefined) openRequest(pending);
    else if (input === "p" && agent !== undefined) { setDraftTarget(agent.agentId); setDraft(""); setMode("prompt"); }
    else if (input === "r") perform(async () => { await session.start(); setMessage(""); });
  });

  const reviewMode = mode === "request" || mode === "question";
  const visible = reviewMode ? contextLines.slice(contextStart, contextStart + height) : threadLines.slice(threadStart, threadStart + height);
  const status = busy ? "Working…" : session.error ?? message;
  const warning = ["Part of the action's input is hidden, because redaction changed it.", "The action's input is cut at 8 KiB.", "The action's input is not visible."]
    .filter((text) => review?.context.includes(text)).join(" ");
  const instructions = mode === "request"
    ? !stillOpen && review !== undefined ? "This request is closed or moved. Esc: back"
      : !contextRead ? "Read the context with PgUp/PgDn. Esc: back"
      : review?.row.kind === "question" ? "Enter: write answer. Esc: back"
      : `Option ${optionIndex + 1}/${review?.permission?.options.length ?? 0}. Left/Right: choose. Enter: submit. Esc: back`
    : mode === "thread" ? "Up/Down: agents; PgUp/PgDn: thread; End: live; p: prompt; a: request; Tab: next; r: reload; q: quit"
    : "Enter: send; Esc: cancel. Pasted text is added to the draft.";

  return h(Box, { flexDirection: "column", width: dimensions.columns },
    h(Text, { bold: true }, "Shephrd viewer — owner"),
    h(Text, null, `Agents ${agents.length === 0 ? "(none)" : `${selected + 1}/${agents.length}`} — Up/Down to select`),
    ...agents.slice(Math.max(0, selected - 1), Math.max(0, selected - 1) + 3).map((entry) => h(Text, { key: entry.agentId, wrap: "truncate" },
      `${entry.agentId === session.selectedAgentId ? ">" : " "} ${oneLine(entry.name)} (${oneLine(entry.displayedState)})`)),
    h(Text, null, reviewMode ? "Request context — agent data follows" : `Thread — agent data${session.loading ? " (loading…)" : ""}`),
    h(Box, { flexDirection: "column", height }, ...visible.map((line, index) => h(Text, { key: index }, `| ${line}`))),
    h(Text, null, reviewMode ? `Context lines ${contextStart + 1}–${Math.min(contextStart + height, contextLines.length)}/${contextLines.length}`
      : `Requests held by owner: ${requests.length}${pending === undefined ? "" : `; selected ${requestIndex % requests.length + 1}: ${pending.kind} ${oneLine(pending.id)}`}`),
    ...(reviewMode && warning !== "" ? [h(Text, { key: "warning", bold: true }, `Shephrd warning: ${warning}`)] : []),
    h(Text, null, status),
    ...(mode === "prompt" || mode === "question" ? [h(Text, { key: "draft" },
      `Owner draft${mode === "prompt" ? ` to ${oneLine(draftTarget ?? "")}` : ""}: ${linesFor(draft, dimensions.columns - 20).slice(-2).join("\n")}`)] : []),
    h(Text, null, instructions),
  );
}
