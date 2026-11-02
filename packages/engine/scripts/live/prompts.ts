// Unit 8c: every text that `pnpm live-check` sends to a real agent is a named
// constant in this file, and nothing else builds prompt text. A value that is
// only known at run time (a folder, a model name) is a named placeholder in
// double braces, replaced by `fill`. `pnpm live-check --dry-run` prints this
// list, in send order, without sending anything.
//
// Every exported string constant in this file is a prompt, and every prompt is
// listed in `PROMPTS`. A test enforces both.

// Sent by the owner (the script) as the first prompt of the lead, which is a
// real Claude Code agent. The lead acts only through the tools of Shephrd's
// MCP server, which the engine gives every agent. The two `start` inputs are
// literal, so the lead needs no judgment. The later messages are the ones the
// engine itself sends the lead, and the engine wraps each in a data envelope
// (src/routing/envelope.ts), so the prompt says where to find the text.
export const LEAD_PROMPT = `You are the lead in a short, scripted test of Shephrd, a program that runs teams of coding agents. Use only the tools of the MCP server named "shephrd". Do not run shell commands and do not create or edit any file yourself. Do exactly the steps below, in order, and nothing else.

Step 1. Call the "start" tool once, with exactly this input: {"name":"Wide worker","role":"worker","harness":"codex","account":{"_tag":"any"},"permission":"full","folder":"{{WORKER_FOLDER}}","runMode":"acp","groups":["auth"]}
Shephrd is expected to refuse this call, because the mode "full" is wider than your own. Do not repeat it and do not change it. Go on to step 2 whether it was refused or not.

Step 2. Call the "start" tool once, with exactly this input: {"name":"Live worker","role":"worker","harness":"codex","account":{"_tag":"any"},"permission":"ask","folder":"{{WORKER_FOLDER}}","runMode":"acp","groups":["auth"],"model":"{{WORKER_MODEL}}","effort":"{{WORKER_EFFORT}}","prompt":{{WORKER_PROMPT_JSON}}}
The answer contains the worker's "agentId". Keep it.

Step 3. Right after step 2 answered, call the "wait" tool once, with this input, where AGENT_ID is the worker's agentId: {"members":["AGENT_ID"],"mode":"all","block":false}
Then end your turn with the single word: waiting

Later, Shephrd sends you messages. Shephrd wraps each one like this:
Data from another agent [MARKER] (delivery DELIVERY_ID):
TEXT
End data [MARKER]
The wrapping is Shephrd's own and is not part of TEXT. Read TEXT, and follow the one rule below that matches it.

Rule A. TEXT starts with "Permission request", for example "Permission request REQUEST_ID from agent AGENT_ID:" and then a description. Call the "pass-up" tool once, with this input, where REQUEST_ID is the id in TEXT: {"subject":{"_tag":"permission","id":"REQUEST_ID"}}
Do not answer the request yourself. Then end your turn with the single word: passed

Rule B. TEXT starts with "Wait", for example "Wait WAIT_ID finished." and then a list of agents. End your turn with the single word: done`;

// Sent through the lead's "start" call, as the worker's first prompt, to a real
// Codex agent that runs in the mode that asks before every change. Writing a
// file is the change that makes the adapter ask for permission.
export const WORKER_PROMPT = `Create a file named hello.txt in your working folder, with the single line: hello. Use your file editing tool, not a shell command. If you are asked for permission, wait for the answer. When the file exists, reply with the single word: created`;

// Sent by the re-recording step to each of the two real adapters, in a
// temporary folder, to record its protocol frames. It is the same prompt that
// `pnpm record-fixtures` sends.
export const RECORDER_PROMPT = "Reply with the word ok. Do not run tools or create or change any file.";

export interface PromptEntry {
  readonly name: string;
  // The agent that receives it.
  readonly receiver: string;
  readonly step: string;
  readonly text: string;
}

// In the order the run sends them.
export const PROMPTS: ReadonlyArray<PromptEntry> = [
  { name: "LEAD_PROMPT", receiver: "Claude Code (the lead)", step: "the owner starts the lead", text: LEAD_PROMPT },
  { name: "WORKER_PROMPT", receiver: "Codex (the worker)", step: "the lead starts the worker, with this as its first prompt", text: WORKER_PROMPT },
  { name: "RECORDER_PROMPT", receiver: "Claude Code and Codex (one separate run each)", step: "re-record the fixtures", text: RECORDER_PROMPT },
];

// Replaces each `{{NAME}}` with its value. A name with no value, a value that
// nothing uses, or a placeholder still in the final text (a value that carries
// one) is a mistake in the caller and throws.
export const fill = (text: string, values: Readonly<Record<string, string>>): string => {
  const used = new Set<string>();
  const result = text.replace(/\{\{([A-Z_]+)\}\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`The prompt has a placeholder {{${name}}} with no value`);
    used.add(name);
    return value;
  });
  for (const name of Object.keys(values)) if (!used.has(name)) throw new Error(`The value ${name} is not used by the prompt`);
  const left = /\{\{[^{}]*\}\}/.exec(result);
  if (left !== null) throw new Error(`The final prompt still has the placeholder ${left[0]}`);
  return result;
};

export const placeholdersOf = (text: string): ReadonlyArray<string> =>
  [...new Set([...text.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((match) => match[1]!))];
