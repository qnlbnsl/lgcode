import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { App } from "../src/index.ts";

it("renders the web placeholder in the document environment", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    flushSync(() => root.render(<App />));
    expect(container.querySelector("main")?.textContent).toBe("Shephrd web");
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
});
