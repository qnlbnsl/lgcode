import { expect, test } from "@playwright/test";
import { assertReply, replySentence } from "../../engine/scripts/live/webReply.ts";

const article = (text: string) => `<article aria-label="Agent message"><p>Agent data</p><pre>${text}</pre></article>`;

test("the live reply check accepts one complete new block after earlier messages", async ({ page }) => {
  await page.setContent(article("Earlier reply") + article(replySentence));
  await assertReply(page.getByRole("article", { name: "Agent message", exact: true }), 1, replySentence);
});

test("the live reply check rejects extra blocks even when one contains the whole sentence", async ({ page }) => {
  await page.setContent(article("Earlier reply") + article("extra fragment") + article(replySentence) + article("another fragment"));
  await expect(assertReply(page.getByRole("article", { name: "Agent message", exact: true }), 1, replySentence)).rejects.toThrow();
});
