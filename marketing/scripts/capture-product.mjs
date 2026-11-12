import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const output = new URL('../public/assets/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
  await page.goto('http://127.0.0.1:4178/workbench.html');
  await page.waitForFunction(() => window.lgcodeReady);
  await page.locator('[data-project="workspace"]').first().click();
  await page.evaluate(() => setTheme('dark', false));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL('product-desktop.png', output).pathname });
  await page.locator('#tab-project-chat').click();
  await page.screenshot({ path: new URL('product-chat.png', output).pathname });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => setTheme('light', false));
  await page.screenshot({ path: new URL('product-mobile.png', output).pathname });
  console.log('Captured the current mock: desktop board, desktop conversation, and mobile conversation.');
} finally {
  await browser.close();
}
