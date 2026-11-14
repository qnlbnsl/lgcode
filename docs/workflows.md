# Workflow definitions and the editor

## What a workflow describes

A workflow is a version 1 JavaScript Object Notation (JSON) document.
The contracts package defines its schema in `packages/contracts/src/workflows.ts`.
A workflow has a name, settings, ordered phases, and moves.
Each phase has a stable identifier, a name, and ordered blocks.
Each block has a stable identifier, a name, and a role.
A role identifies a job, such as `builder`, rather than a person or a model.
The schema lists the supported roles.
The `owner` and `engine` roles describe human decisions and deterministic program work.

A move names its source block, destination block, and the condition that takes it.
Moves may cross phases or go backwards.
The phase and block order controls the picture, while moves describe the routes.
A block may declare `end: true` to mark the end of the current run.
The default ends at Next change until the owner starts another change.
Its outgoing owner action starts the next run at Change described.
The format permits unfinished blocks without an outgoing move while editing.
The shipped default requires every block to be reachable and every block without an outgoing move to declare an endpoint.
The format permits disconnected blocks while someone constructs a workflow.
Every move must reference two different existing blocks.
Duplicate moves are refused regardless of the order of their JSON keys.
Inner move sources, targets, and conditions must contain text.
Every phase and block identifier must be unique across the document.
Names and conditions have a limit of 200 characters.
A definition has at most 24 phases, 100 blocks per phase, and 1,000 moves.
The stored JSON must fit within 192 kibibytes.

A named inner block from the build-loop specification also has a `steps` list.
Each step records its source state, destination state, condition, and role.
This keeps the specification's inner decisions beside the block they explain.
The page shows these steps under the selected block's details.
The visual editor changes the outer graph.
It preserves the inner steps when saving.
The application programming interface (API) and terminal can also change inner steps.

## The shipped build loop

The canonical default is `packages/engine/src/workflows/build-loop.json`.
The engine reads this file without a dependency on the design folder.
The Studio build copies it into the live page and generates the sample copy.
The Studio build bundles the contracts validator for both page modes.
Run `pnpm --filter @lgtm/studio build` before opening the standalone sample.
The default has eight phases and every named inner block in the build-loop specification.
The default cannot be saved or deleted through the engine.
A clone becomes an independent user or repository file.

The settings record whether tests and agent review run.
The settings also record the full review rounds, the approval threshold, the optional maximum rounds, the stuck statement thresholds, and automatic merging for fixes users cannot see.
A null maximum means that review has no hard limit.
A finite maximum must be at least the approval threshold.
The default requires approval after round four.
The owner's decision of 2026-11-11 supersedes the older round-six exit in the specification's diagram text.
The corresponding inner move therefore repeats the approval request.

Projects still run the default workflow because choosing a workflow for a project is not built yet.
The definition editor does not execute a workflow.

## Where files live

User workflows live in `~/.lgtm/workflows/<id>.json`.
Repository workflows live in `<registered-repository>/.lgtm/workflows/<id>.json`.
The engine uses its configured home directory, so tests can use temporary homes.
The repository identifier must refer to a registered repository.
An API caller cannot supply a destination folder.
The identifier contains lowercase letters, numbers, and hyphens.
The identifier stays unchanged when the workflow's display name changes.
A clone derives its new identifier from the requested name.
A name without ASCII letters or digits receives a generated identifier.
The display name keeps its original text.
An existing destination is never overwritten by cloning.

The Linux file store performs asynchronous file operations.
It checks at most 100 directory entries per folder during a list.
The list reports when that limit is reached.
An unavailable folder reports its own error while other folders remain listed.
The list includes folder statuses with a limit, a truncation flag, and an optional error.
The store refuses to start an operation if `/proc/self/fd` is unavailable.
The store holds open directory descriptors while operating.
It refuses symbolic links at the repository or home folder, `.lgtm`, `workflows`, and file boundaries.
It refuses linked files, special files, and oversized files.
It writes a private temporary file inside the selected workflow folder.
It commits a save with an atomic rename.
It creates a clone exclusively.
An invalid JSON file is listed with an error and cannot be read as a definition.
A malformed regular workflow file may be repaired through a valid API save.
It may also be deleted after confirmation in the page.
The list marks unsafe or unaddressable entries with `canDelete: false`.
The page offers no Delete button for these entries.
Remove or replace these entries manually in the workflow folder.
Removing a symbolic link means removing the link itself.
Do not remove its target.
File writes are configuration operations and do not add stored engine events.
Concurrent saves use the last successful writer.

## The API and terminal commands

The six commands are `client.workflows.list`, `client.workflows.read`, `client.workflows.clone`, `client.workflows.save`, `client.workflows.validate`, and `client.workflows.delete`.
Every command requires the owner's authenticated session or credential.
Agents and internal services cannot change workflows.
Every request has a request identifier.
A repository request also has a registered `repoId`.
The read, save, and delete requests name a `scope` and an `id`.
The scope is `default`, `user`, or `repository`.
A clone adds a `target` scope and a `name`.
A save carries the complete `definition`.
Validation accepts a definition without saving it and returns a boolean and one error sentence.
A save can rename the workflow by changing `definition.name`.

The terminal uses the same typed API through the existing JSON input convention.
For example, `lgtm client workflows list --input '{}'` lists the user's workflows.
The command `lgtm client workflows clone --input '{"scope":"default","id":"build-loop","target":"user","name":"My loop"}'` creates a user copy.
The command `lgtm client workflows read --input '{"scope":"user","id":"my-loop"}'` reads that copy.
The command `lgtm client workflows delete --input '{"scope":"user","id":"my-loop"}'` deletes that copy.
The terminal does not ask for confirmation because the explicit delete command supplies that intent.

## How the editor works

The Workflows entry opens a list and the selected workflow's picture.
Phases appear from left to right.
Every block names its role.
A forward arrow and a return arrow distinguish the directions without relying on colour.
Selecting a block reveals its moves and inner steps.
Cloning asks for a name and a destination.
The repository selector makes repository workflows available.
The sample page stores its copies in the browser's local storage.

The editor uses ordinary buttons, labelled inputs, and select controls.
Earlier and Later buttons support keyboard reordering without dragging.
Removing a block or phase also removes its attached moves.
The editor validates every changed definition.
Save stays disabled while validation is pending or the definition is invalid.
Discard changes restores the last saved definition.
Delete requires confirmation.
The page uses the existing dialog, confirmation, button, field, and token system.
The picture uses ordinary document elements and arrow text.
No diagram or dragging library was added.
