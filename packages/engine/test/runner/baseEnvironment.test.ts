// Task 8a.3, decision rows 33 and 57, issue 14: the base environment of a child process.
//
//   `buildBaseEnvironment({ parent, accountVariables?, sheprdSocket?, sheprdToken? })`
//   (module `packages/engine/src/runner/baseEnvironment.ts`) returns a new
//   `Record<string, string>` that is the whole environment of the child. It takes `parent` as an
//   argument and never reads `process.env`. Names are matched exactly and case-sensitively.
//
//   Allow-list (row 33): PATH, HOME, USER, LOGNAME, SHELL, LANG, LC_* (the prefix `LC_`), TERM,
//   TMPDIR and TZ, copied from `parent` when set. Then the account's variables, which win over the
//   parent's values. Never HERDR_* (parent or account). Never a provider key the account did not
//   set. The only SHEPRD_* names are SHEPRD_SOCKET and SHEPRD_TOKEN (row 57), and they come
//   only from the `sheprdSocket` and `sheprdToken` arguments, never from `parent` or from the
//   account's variables.
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"

import { assert, it } from "@effect/vitest"
import { afterEach, vi } from "vitest"

import { buildBaseEnvironment } from "../../src/runner/baseEnvironment.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"

registerRebuildCheck({ noLog: true })

it("5.17/E34 drops the web password from the parent and from account variables before a child is started", () => {
  const password = randomBytes(32).toString("base64url")
  const environment = buildBaseEnvironment({
    parent: { PATH: process.env.PATH ?? "/usr/bin", SHEPRD_WEB_PASSWORD: password },
    accountVariables: { SHEPRD_WEB_PASSWORD: password },
  })
  assert.isFalse(Object.hasOwn(environment, "SHEPRD_WEB_PASSWORD"), "the web password variable reached the child environment")
  assert.isFalse(Object.values(environment).some((value) => value.includes(password)), "the web password value reached the child environment")
  const child = spawnSync(process.execPath, ["-e", "process.stdout.write(String(Object.hasOwn(process.env, 'SHEPRD_WEB_PASSWORD')))"], { env: environment, encoding: "utf8" })
  assert.equal(child.status, 0)
  assert.equal(child.stdout, "false")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const allowListed = {
  PATH: "/usr/local/bin:/usr/bin",
  HOME: "/home/someone",
  USER: "someone",
  LOGNAME: "someone",
  SHELL: "/bin/zsh",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  LC_CTYPE: "en_US.UTF-8",
  TERM: "xterm-256color",
  TMPDIR: "/tmp",
  TZ: "UTC"
}
const secrets = {
  ANTHROPIC_API_KEY: "sk-ant-planted-parent-0123456789",
  OPENAI_API_KEY: "sk-planted-parent-0123456789",
  GITHUB_TOKEN: "ghp_plantedparent0123456789",
  AWS_SECRET_ACCESS_KEY: "planted-aws-secret",
  MY_SERVICE_TOKEN: "planted-service-token",
  STRIPE_KEY: "planted-stripe-key",
  SSH_AUTH_SOCK: "/tmp/ssh-planted/agent.1",
  HERDR_SOCKET_PATH: "/tmp/herdr-planted.sock",
  HERDR_PANE_ID: "p_1",
  SHEPRD_SOCKET: "/tmp/parent-planted.sock",
  SHEPRD_TOKEN: "shp_a_PLANTEDPARENTTOKEN0123456789",
  SHEPRD_HOME: "/tmp/parent-planted-home",
  LCX_FOO: "looks-like-lc-but-is-not",
  XLC_ALL: "also-not",
  NODE_OPTIONS: "--require=/tmp/planted.js"
}

const keys = (environment: Record<string, string>) => Object.keys(environment).sort()

it("passes every allow-listed name with its value and nothing else (breaks if a name on the list is dropped or a value is rewritten; row 33)", () => {
  const environment = buildBaseEnvironment({ parent: { ...allowListed, ...secrets } })
  assert.deepEqual(environment, allowListed)
})

it("never passes HERDR_*, provider keys, other tokens or look-alike names from the parent (breaks if the filter is a deny-list, so an unlisted *_TOKEN or *_KEY reaches the child; rows 33 and 57)", () => {
  const environment = buildBaseEnvironment({ parent: { ...allowListed, ...secrets } })
  for (const name of Object.keys(secrets)) assert.notProperty(environment, name)
  assert.deepEqual(keys(environment), keys(allowListed))
})

it("anchors the LC_ prefix at the start of the name (breaks if any name containing LC_ passes)", () => {
  const environment = buildBaseEnvironment({ parent: { LC_MESSAGES: "C", XLC_ALL: "x", LCX_FOO: "y", FOO_LC_ALL: "z" } })
  assert.deepEqual(environment, { LC_MESSAGES: "C" })
})

it("matches names exactly and case-sensitively (breaks if a lower-case or prefixed look-alike of an allowed name passes)", () => {
  const environment = buildBaseEnvironment({ parent: { path: "/x", Home: "/x", PATHEXT: ".EXE", HOMEPAGE: "http://planted", TERMCAP: "planted" } })
  assert.deepEqual(environment, {})
})

it("adds the account's variables, including a provider key the account set, and they win over the parent (breaks if account variables are dropped, a key the account chose is filtered, or the parent's value wins)", () => {
  const environment = buildBaseEnvironment({
    parent: { PATH: "/usr/bin", LANG: "en_US.UTF-8", ANTHROPIC_API_KEY: "parent-key-must-not-pass" },
    accountVariables: { ANTHROPIC_API_KEY: "account-key-0123456789", LANG: "C.UTF-8", FAKE_AGENT_SCRIPT: "{}" }
  })
  assert.deepEqual(environment, {
    PATH: "/usr/bin",
    LANG: "C.UTF-8",
    ANTHROPIC_API_KEY: "account-key-0123456789",
    FAKE_AGENT_SCRIPT: "{}"
  })
})

it("drops account variables named HERDR_*, SHEPRD_SOCKET or SHEPRD_TOKEN (breaks if an account can set the agent's socket or token, or reach the Herdr socket; rows 33 and 57)", () => {
  const environment = buildBaseEnvironment({
    parent: { PATH: "/usr/bin" },
    accountVariables: {
      HERDR_SOCKET_PATH: "/tmp/herdr-planted.sock",
      HERDR_ENV: "1",
      SHEPRD_SOCKET: "/tmp/account-planted.sock",
      SHEPRD_TOKEN: "shp_a_PLANTEDACCOUNTTOKEN0123456789",
      KEEP_ME: "yes"
    }
  })
  assert.deepEqual(environment, { PATH: "/usr/bin", KEEP_ME: "yes" })
})

it("sets SHEPRD_SOCKET and SHEPRD_TOKEN from the arguments, and no other SHEPRD_* name (breaks if the wildcard comes back, or the values are taken from the parent; row 57)", () => {
  const environment = buildBaseEnvironment({
    parent: { PATH: "/usr/bin", SHEPRD_SOCKET: "/tmp/parent.sock", SHEPRD_HOME: "/tmp/home" },
    sheprdSocket: "/tmp/run/engine.sock",
    sheprdToken: "shp_a_GIVENTOKEN0123456789"
  })
  assert.deepEqual(environment, {
    PATH: "/usr/bin",
    SHEPRD_SOCKET: "/tmp/run/engine.sock",
    SHEPRD_TOKEN: "shp_a_GIVENTOKEN0123456789"
  })
})

it("adds no SHEPRD_* name when no socket and token are given (breaks if the parent's values are used as a fallback)", () => {
  const environment = buildBaseEnvironment({ parent: { PATH: "/usr/bin", SHEPRD_SOCKET: "/tmp/p.sock", SHEPRD_TOKEN: "shp_a_PARENTPLANTED0123456789" } })
  assert.deepEqual(environment, { PATH: "/usr/bin" })
})

it("never reads process.env: a parent of only PATH gives only PATH, whatever the process holds (breaks if the builder copies process.env wholesale or falls back to it; issue 14)", () => {
  vi.stubEnv("SOME_PLANTED_TOKEN", "planted-process-token")
  vi.stubEnv("HOME", "/home/process-planted")
  vi.stubEnv("LANG", "process-planted-lang")
  assert.deepEqual(buildBaseEnvironment({ parent: { PATH: "/usr/bin" } }), { PATH: "/usr/bin" })
  assert.deepEqual(buildBaseEnvironment({ parent: {} }), {})
})

it("skips parent entries whose value is undefined instead of writing the text 'undefined' (breaks if an unset variable reaches the child as a string)", () => {
  const environment = buildBaseEnvironment({ parent: { PATH: "/usr/bin", LANG: undefined } as Record<string, string | undefined> })
  assert.deepEqual(environment, { PATH: "/usr/bin" })
})

it("returns a new object and leaves the parent untouched (breaks if the builder edits or returns the parent, so a later change leaks across children)", () => {
  const parent = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "planted-parent-key" }
  const environment = buildBaseEnvironment({ parent, accountVariables: { EXTRA: "1" } })
  assert.notStrictEqual(environment, parent)
  assert.deepEqual(parent, { PATH: "/usr/bin", ANTHROPIC_API_KEY: "planted-parent-key" })
})

it("a real child started with the built environment sees exactly those names and no planted secret (breaks if the result is not a complete replacement environment when handed to a spawn)", () => {
  const environment = buildBaseEnvironment({
    parent: { ...allowListed, ...secrets, PATH: `${process.env.PATH ?? "/usr/bin"}` },
    accountVariables: { ACCOUNT_VAR: "from-account" },
    sheprdSocket: "/tmp/run/engine.sock",
    sheprdToken: "shp_a_GIVENTOKEN0123456789"
  })
  const child = spawnSync(process.execPath, ["-e", "console.log(JSON.stringify(Object.keys(process.env).sort()))"], {
    env: environment,
    encoding: "utf8"
  })
  assert.equal(child.status, 0)
  const seen = JSON.parse(child.stdout) as string[]
  assert.deepEqual(seen, [...Object.keys(allowListed), "ACCOUNT_VAR", "SHEPRD_SOCKET", "SHEPRD_TOKEN"].sort())
  assert.notInclude(child.stdout, "planted")
})

it("passes exactly the allow-listed names from a parent that holds every one of them and many more, and not one name beyond the list (breaks if the allow-list gains a name such as EDITOR, PAGER, NODE_OPTIONS or SSH_AUTH_SOCK; rows 33 and 57)", () => {
  // The expected names are written out here on purpose: they are the allow-list of row 33, and
  // they must not be derived from the code under test.
  const allowedNames = [
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "LC_TIME",
    "TERM", "TMPDIR", "TZ"
  ]
  const others = {
    EDITOR: "vim",
    VISUAL: "vim",
    PAGER: "less",
    NODE_OPTIONS: "--require=/tmp/planted.js",
    SSH_AUTH_SOCK: "/tmp/ssh-planted/agent.1",
    DISPLAY: ":0",
    XDG_RUNTIME_DIR: "/run/user/1000",
    XDG_CONFIG_HOME: "/home/someone/.config",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "planted-terminal",
    NO_COLOR: "1",
    FORCE_COLOR: "1",
    LD_PRELOAD: "/tmp/planted.so",
    PWD: "/home/someone/work",
    OLDPWD: "/home/someone",
    SHLVL: "2",
    _: "/usr/bin/planted",
    CI: "true",
    GIT_AUTHOR_NAME: "Planted",
    HTTP_PROXY: "http://planted:8080"
  }
  const parent: Record<string, string> = { ...others }
  for (const name of allowedNames) parent[name] = `value-of-${name}`
  const environment = buildBaseEnvironment({ parent })
  assert.deepEqual(keys(environment), [...allowedNames].sort())
  for (const name of allowedNames) assert.equal(environment[name], `value-of-${name}`)
  for (const name of Object.keys(others)) assert.notProperty(environment, name)
})
