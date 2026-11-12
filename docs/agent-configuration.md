# Choose an agent's model and effort

The owner can change a running agent's model and effort for its next turn.
The current turn continues.
The engine uses the same live agent and waits for the harness to acknowledge the choice before sending the next prompt or compaction.

Read the authenticated application programming interface (API) method `client.agent.configuration` with an `agentId`.
Its response contains `configuration`, `models`, and `efforts`.
Each choice list identifies its source as `negotiated`, `configured`, or `unavailable`.
Use the exact `id` from an option.
A display label does not establish a supported identifier.
Each list contains at most 128 options.

Submit `configure` with an `agentId` and a `model`, an `effort`, or both.
The command acknowledgement means that the desired choice was stored.
Read `client.agent.configuration` again to learn whether the live harness applied it.
The command-line interface exposes the same operations:

```sh
lgtm client agent configuration --input '{"agentId":"<agent-id>"}'
lgtm configure --input '{"agentId":"<agent-id>","model":"<choice-id>","effort":"<choice-id>"}'
lgtm client agent context --input '{"agentId":"<agent-id>"}'
```

The `desired` fields survive service restarts and stopped agents.
The `applied` fields contain the latest acknowledged or reported live values.
The `revision` identifies the owner's latest choice request.
The status has these meanings:

| Status | Meaning |
| --- | --- |
| `pending` | The desired choice is stored and awaits a live acknowledgement. |
| `applied` | The live configuration satisfies the desired choice. |
| `refused` | The harness rejected the choice or did not acknowledge the requested value. |
| `unsupported` | The live harness did not advertise the required configuration selector. |
| `unavailable` | The live process or the outcome of a configuration call cannot be confirmed. |

A refusal holds queued work so it cannot run with a silently substituted choice.
The owner can submit a corrected available choice.
A timeout or a disconnected call can still complete late in the harness.
The engine therefore holds that uncertain process until the owner explicitly stops and resumes it.
It never restarts an agent to simulate a live configuration change.
An explicitly stopped agent follows the existing stop semantics for queued work.

# Read actual context occupancy

The authenticated `client.agent.context` method takes an `agentId`.
An `available` response contains `used`, `window`, `percent`, and `reportedAt`.
It also contains `model` when the live harness established that identifier.
Both token counts come from the latest compatible report from that live session.
The engine does not derive a window from a model name or treat per-turn input and output totals as context occupancy.

An `unavailable` response has a reason and no percentage.
The reasons are `not-reported`, `invalid-report`, `configuration-changed`, and `not-live`.
Counts must be safe nonnegative integers, the window must be positive, and the used count must not exceed the window.
A model or effort change clears old context evidence until a new turn supplies a report.
A reload also requires a new report from the new process.
The context read retains normalized numbers rather than raw protocol payloads.

These commands and reads accept owner credentials only.
They are omitted from generated agent tools.
