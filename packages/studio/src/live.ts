// The live website's entry point. The build bundles this file, with the connection and the
// mapping, as live.js beside the website's own files. It loads the website's mount() at run
// time from js/app.js, so the screens stay plain JavaScript with no build step.
import { engineConnection, type LiveConnection } from "./connection.ts"

import * as chatMapping from "./chat.ts"

interface Website {
  mount(element: Element, options: { readonly connection: LiveConnection; readonly mode: "live" }): unknown
}

const app = new URL(/* @vite-ignore */ "./js/app.js", import.meta.url).href
const { mount } = await import(/* @vite-ignore */ app) as Website
const chatModule = new URL(/* @vite-ignore */ "./js/live/chat.js", import.meta.url).href
const chat = await import(/* @vite-ignore */ chatModule) as { setMapping(mapping: typeof chatMapping): void }
chat.setMapping(chatMapping)
const element = document.getElementById("app")
if (element !== null) mount(element, { connection: engineConnection(), mode: "live" })
