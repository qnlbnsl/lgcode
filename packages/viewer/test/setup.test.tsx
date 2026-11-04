import { renderToString } from "ink";
import { expect, it } from "vitest";
import { Viewer } from "../src/index.ts";

it("renders the viewer placeholder with Ink in Node", () => {
  expect(typeof document).toBe("undefined");
  expect(renderToString(<Viewer />)).toBe("Shephrd viewer");
});
