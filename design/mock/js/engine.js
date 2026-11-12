// The website's connection to the engine.
//
// In the real product, every change the owner makes is a client API call: an Effect RPC
// request named by its tag in @lgcode/contracts, such as "prompt" or "answer". Every update
// the engine pushes arrives on the "subscribe" stream. The mock has no engine, so it applies
// each change in the browser, and it reports the call here as well.
//
// A page that loads the mock as the package `lgtm` can pass its own connection to mount().
// That connection receives every call and every pushed update, so it can show them, or carry
// them over a different route, without the screens changing. The default connection is the
// service on this computer, and it does nothing.

const local = { kind: 'local', label: 'the service on this computer', call() {}, push() {} };
let current = local;

export function setConnection(connection) { current = connection || local; }
export function connection() { return current; }

// A request from the website to the engine. `tag` is the RPC's tag in @lgcode/contracts.
export function call(tag, payload) {
  try { current.call(tag, payload); } catch (e) { console.error('The connection failed to send', tag, e); }
}

// An update from the engine to the website, as an item on the "subscribe" stream.
export function push(kind, payload) {
  try { current.push(kind, payload); } catch (e) { console.error('The connection failed to deliver', kind, e); }
}
