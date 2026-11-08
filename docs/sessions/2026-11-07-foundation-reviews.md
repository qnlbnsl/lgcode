# Session Report: the foundation reviews and the freeze, 2026-11-07

- Harness: claude (Claude Code)
- Session: the manager, run `foundation-plans-1`
- Lead model: Claude Opus 5.5 (`claude-opus-5-5`)
- Updated: 2026-11-07

## Session summary

Three independent reviews ran on the foundation snapshot at the tag
`foundation-pre-review`, on Codex, Claude and Grok. An advisory board of three
seats then compared the reviews. The owner froze development on 2026-11-07
until the website mocks are ready, and this report closes the run's review
work.

## The results of the three reviews

| Review | Raw findings | Confirmed | Not adjudicated | Security deferred | Time | List price |
|---|---|---|---|---|---|---|
| Codex | 188 | 122, of which 43 are functional and 65 are test gaps | see its register | see its register | 3 hours 8 minutes | $136.15 |
| Claude | 794 | 51, of which 25 concern the product and 26 concern tests | 526 | 203 | about 5 hours 33 minutes | $395.34 |
| Grok | 179 | 23, of which 18 are distinct | 139 | 10 | about 6 hours 17 minutes | not measured |

The Codex review's repairs are on `master`, apart from the items that issue 519
names. The Claude and Grok findings have not been checked against `master`.

## What the advisory board concluded

All three board seats agreed that no single model should hold a review seat
alone. Sol showed the most usable process and led best. Opus was strongest on
whole-flow review and hard disputes. Sonnet suits focused review, but only if
its labels do not decide what gets adjudicated. Grok is useful as an extra
voice from a second vendor. The largest fault in the process is that labels
route findings to adjudication.

The owner has not yet turned these conclusions into changes to the model list.

## Where the evidence lives

The registers, scores, costs and board arguments stay outside git, in
`.scratch/foundry-runs/foundation-plans-1/`. Security findings stay there too,
and the attack list stays at `.scratch/security/attack-todo.md`.

## Open items

- Issue 519 records the unchecked Claude and Grok findings.
- Issue 520 records finding K-368, which needs the owner's ruling.
- Issue 516 records that Sheprd cannot run Grok without Fast through Cursor's
  Agent Client Protocol.
- Issue 521 records that finished review seats filled the file limit on `/tmp`.
- The owner runs the hostile review, and the sandbox is not built.
