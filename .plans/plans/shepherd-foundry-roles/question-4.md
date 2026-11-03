# Question 4 for the owner: build standing rules now, or after a harness qualifies?

This question goes to the owner through plans-lead. It is decision row 68.

## What the epic asks for

The epic's row 4 names "standing permission rules" as part of piece 4. A
standing rule is a rule the owner writes, such as "allow exactly
`pnpm test`". Shephrd answers a matching permission request by itself, so
the lead is not woken.

## What the third review found

A standing rule answers only when it is safe to do so. The plan refuses to
match unless several things hold. The request must come from the harness's
own shell tool. It must run inside the harness's sandbox. It must name the
folder it runs in.

The third review (threat model, Opus, R3-1 and R3-2) checked these
conditions against the two harnesses the owner uses. On today's evidence,
neither harness passes:

- **Claude Code.** Its shell request names no working folder, so it never
  matches (known gap 14). Its Bash and PowerShell tools also share one
  reporter in `claude-agent-acp` 0.99.1, so nothing marks a request as the
  shell's own.
- **Codex.** In every Shephrd mode that asks for approval, Codex runs an
  approved command outside its sandbox. Its documentation says: "Commands
  are run outside the sandbox if they are approved by the user." So
  approving a Codex request is always approving an escape from the
  sandbox, and a standing rule must never do that (known gap 18).
- **Gemini and Cursor.** Neither has recordings, so neither is supported.

So, as planned, standing rules would answer no real request in this
version. The plan still asks the owner to put the first engine change,
WS-7a, into the engine's permission path, which is its most sensitive
code. That change would carry risk and bring no benefit until a harness
qualifies.

## The options

**(a) Defer standing rules to a later version.** WS-2 (the rule commands
and the matcher) and WS-7a (the engine's rule check) are not built. The
lead keeps answering every permission request, as today. The epic's
"standing permission rules" are recorded as deferred. This removes three
build units, including two with attack passes, and the riskiest engine
change. Nothing is gained until a later version.

**(b) Record first, then decide on the evidence (recommended).** The owner
runs one short recording session per harness first, before any rule code
is built. It uses the recorder prepared by a small new unit. The session
also tries the launch settings that might make a harness qualify:

- for Codex, an approval policy whose approved commands stay inside the
  sandbox, if one exists (`untrusted` is the candidate);
- for Claude Code, a setting that keeps the shell in the session folder.

If the recordings show at least one harness that qualifies, WS-2 and WS-7a
are built as planned for that harness. If none qualifies, option (a)
applies automatically. A launch setting that a harness needs is itself a
small engine change. It would come back to the owner as its own question,
not ride along with this one.

**(c) Build it now, dormant.** WS-2 and WS-7a are built as planned. They
answer nothing until a later adapter version, or a later launch setting,
lets a harness qualify. The engine's permission path gets its new rule
check now, with nothing using it.

## The recommendation

The recommendation is option (b). It costs the owner one recording session
of a few minutes per harness, on the owner's accounts. It keeps the
engine's permission path unchanged unless the evidence shows a real
benefit. If a harness qualifies, the epic's words are delivered in this
version.

The rest of the plan does not depend on the answer. The roles, the
sheepdog, the hand-off, compaction timing and the engine changes WS-7b and
WS-7c are the same under every option.

## Two related changes to the pending engine question

The third review also changed two of the engine additions that the lead
already sent to the owner (row 53). The lead is asked to send both with
this question.

1. **WS-7a's rule check also resolves file paths** (row 79). Before it
   checks a request, the engine follows symbolic links for each path in
   the command, using the engine's own existing resolver. A rule then
   never matches a command that writes a settings file through a link,
   such as `cp template.json active-config` where `active-config` links
   to `.claude/settings.json`. This applies only if WS-7a is built. One
   gap remains: a link created after the check, and before the command
   runs, is not caught (known gap 20).
2. **WS-7b holds an agent's whole queue, not one message** (row 75). A
   message that meets a "model at capacity" error now pauses everything
   queued for that agent until the hold is released. Without this, the
   board could replace the held message with a new one, which would be
   sent at once and skip the five-minute wait. The `release` command now
   names the agent instead of the message. The engine counts the holds
   itself, so the retry limit holds even when the owner or a lead
   releases a hold by hand.
