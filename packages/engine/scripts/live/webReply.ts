import { expect, type Locator } from "@playwright/test";

export const replySentence = "Across the quiet valley, a small river carries fallen leaves past the old wooden bridge while morning sunlight slowly warms the fields and the village prepares for another ordinary day of work and conversation.";

export async function assertReply(messages: Locator, before: number, text: string) {
  await expect(messages).toHaveCount(before + 1);
  await expect(messages.nth(before)).toHaveText(`Agent data${text}`);
}
