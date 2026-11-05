# Codex accounts and startup failures

The default Codex account has the id `codex`.
It uses the machine's default Codex login unless the account explicitly sets
its home or the `CODEX_HOME` environment variable.
An additional account with another id receives a private account folder.
That folder starts without the default account's login.
Sign in to that account's private folder before starting an agent with it.
The private folder is `providers/codex/<account-id>/shadow` under the engine's
state folder. For an extra account, an explicit home or `CODEX_HOME` selects
the shared settings and sessions. Its authentication still stays private.
Shephrd does not copy the default account's credentials into extra accounts.

Set the model and the effort separately.
For example, use model `gpt-6.1-sol` and effort `high`.
The model string `gpt-6.1-sol[high]` is sent as a model name and is refused.
Shephrd does not silently switch a refused model.

A failed start appears in the situation page's stopped section.
Its thread shows a fixed explanation.
The explanations distinguish a missing sign-in, a private login without a sign-in,
a refused model, a refused effort, a refused mode, a startup failure and a timeout.
The engine never exposes the adapter's original error text.
Prompting the stopped agent repeats the safe explanation.
After correcting its settings or login, resume it from its thread.
A failed start without a session resumes with a fresh session.
An existing session that cannot be reloaded also resumes with a fresh session.
The page explains before that action that the old session's context is lost.

# The real browser check

Run `pnpm live-check:web` with Codex signed in on this machine.
It uses the `codex` account, model `gpt-6.1-sol` and effort `high`.
It consumes a small amount of the account's allowance.
It is separate from the normal check suite.

The check builds the page and creates a private temporary engine and work folder.
It chooses an unused loopback port and a random password.
It configures that port through the application programming interface before
starting the password-protected listener.
It then opens Chromium, signs in, checks the roster and opens the thread.
It verifies a unique prompt, a reply that occupies one growing block, a shell
permission answered in the page and the resulting file on disk.
It reloads the page, stops and resumes the agent, and verifies the explanation
for an additional account with an empty private login.
It prints a pass or fail line for each step without printing the password.
It stops its agents and engine and removes its temporary folders.
It never connects to an existing engine.
