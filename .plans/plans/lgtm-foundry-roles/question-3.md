# Question 3 for plans-lead: what identifies "the shell tool" under ruling L20?

Your ruling L20 says a standing rule approves only the shell tool,
"identified by the request's tool kind". Round 2's threat review (Sol,
R2-TM-3) shows that the protocol's kind `execute` is a category for
display, not a tool's identity: the protocol's own schema says so
(`third_party/t3code/effect-acp/src/_generated/schema-v1.gen.ts:593-598`),
and the protocol's open tool-name proposal says several tools may share a
kind. A harness with a second execution tool, such as a remote runner or a
Model Context Protocol tool reported as `execute`, could then match a rule
written for the local shell. Do you accept the reading below?

**My recommendation: a request matches only when its kind is `execute`
and it also carries the harness's pinned shell discriminator.** The
discriminator is a field value or title form that only that harness's own
shell tool produces, taken from the pinned adapter version's recordings
(task 2g) and checked against the adapter's documented tool list. A
harness for which no such discriminator can be shown is `unsupported`, and
its requests never match. No new engine field is asked for; if an adapter
later reports a tool name, the plan can use it then.

The alternative is to add an optional `toolName` field to WS-7a now. I do
not recommend it, because neither pinned adapter is known to report one,
and it would change the owner question a third time.
