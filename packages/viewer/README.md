# The terminal thread viewer

Run `sheprd view` in the owner's terminal.
The viewer uses the owner credential and the engine's Unix socket.
The engine checks the calling process's ancestry.
The viewer refuses inherited agent credentials.

The Herdr plugin action named `view` opens the viewer in a split pane.
The action authenticates its own process before asking Herdr to open the pane.
The pane authenticates again when the viewer starts.

Use the following keys.

| Key | Action |
| --- | --- |
| Up or Down | Select an agent and open its thread. |
| Page Up or Page Down | Scroll the thread or the request context. |
| Home or End | Jump to the beginning or the end. End resumes following the live thread. |
| p | Compose a prompt for the selected agent. |
| a | Read the selected request. |
| Tab | Select the next request held by the owner for this agent. |
| Left or Right | Choose a permission option after reaching the end of its context. |
| Enter | Submit the chosen option, open a question's answer field, or send a draft. |
| Escape | Cancel a draft or return from a request. |
| r | Reload the thread and reconnect. |
| q | Quit, outside a draft. |

Agent text is prefixed with a vertical bar.
Terminal control sequences and their payloads are removed before rendering.
Request context is read from the original event before an answer is enabled.
When the event has no input, the viewer searches all thread pages for the matching tool call.
Hidden, truncated, and unavailable input produce fixed warnings.
Long context can be scrolled before choosing an answer.
Pasted text enters a draft and does not submit it.
