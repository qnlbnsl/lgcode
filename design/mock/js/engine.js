// The website's connection to the engine.
//
// In the real product, every change the owner makes is a client API call: an Effect RPC
// request named by its tag in @lgtm/contracts, such as "prompt" or "answer". Every update
// the engine pushes arrives on the "subscribe" stream. The mock has no engine, so it applies
// each change in the browser, and it reports the call here as well.
//
// A page that loads the mock as the package `lgtm` can pass its own connection to mount().
// That connection receives every call and every pushed update, so it can show them, or carry
// them over a different route, without the screens changing. The default connection is the
// service on this computer, and it does nothing.
//
// Live mode. A page that passes { mode: 'live' } to mount() gives a connection that also has:
//   open(write)        starts reading the engine. It calls write(patch) with whole store keys
//                      in the store's shape, such as { session }, { conn } or { repos, projects,
//                      teams, agents, requests, machines, owner }. Only this route changes them.
//   signIn(password)   resolves to the session's new status: 'in', 'rejected' or 'unavailable'
//   signOut()          ends the session for every browser
//   reconnect()        tries the engine again at once
//   close()            stops reading, when the website is unmounted
// The live connection is written in TypeScript in packages/studio. No file here knows which
// transport it uses.

const local = { kind: 'local', label: 'the service on this computer', call() {}, push() {} };
let current = local;

export function setConnection(connection) { current = connection || local; }
export function connection() { return current; }

// A request from the website to the engine. `tag` is the RPC's tag in @lgtm/contracts.
export function call(tag, payload) {
  try { current.call(tag, payload); } catch (e) { console.error('The connection failed to send', tag, e); }
}

// An update from the engine to the website, as an item on the "subscribe" stream.
export function push(kind, payload) {
  try { current.push(kind, payload); } catch (e) { console.error('The connection failed to deliver', kind, e); }
}
