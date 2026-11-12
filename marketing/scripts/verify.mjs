import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarketingServer } from '../server.ts';

const directory = await mkdtemp(join(tmpdir(), 'lgtm-browser-'));
const app = createMarketingServer({ databasePath: join(directory, 'waitlist.sqlite') });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const output = new URL('../verification/', import.meta.url);
await mkdir(output, { recursive: true });
const checks = [], errors = [];
const check = (condition, name) => { assert(condition, name); checks.push(name); };
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(base);
  check(await page.locator('html').getAttribute('data-theme') === 'dark', 'A first visit follows the dark device preference');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  check(await page.locator('html').getAttribute('data-theme') === 'light', 'The theme follows a device change until manually selected');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  check(await page.locator('html').getAttribute('data-theme') === 'dark', 'The visible theme switch enables dark mode');
  await page.reload();
  check(await page.locator('html').getAttribute('data-theme') === 'dark', 'A manual theme choice survives reload');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'Switch to light mode' }).focus();
  await page.keyboard.press('Enter');
  await page.reload();
  check(await page.locator('html').getAttribute('data-theme') === 'light', 'The keyboard switch remembers light mode over a dark device preference');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    check(await page.title() === 'LGTM Studio — A whole team behind your next idea.', `The page has the LGTM Studio title at ${width}px`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
    check(await page.locator('#hero-title').isVisible(), `The headline is visible at ${width}px`);
    const action = await page.locator('.hero-actions .primary').boundingBox();
    check(action.y + action.height < (width < 500 ? 844 : 1000), `The signup action is above the fold at ${width}px`);
    await page.screenshot({ path: new URL(`landing-${width}.png`, output).pathname, fullPage: true });
  }
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Dark mode has no horizontal overflow at ${width}px`);
    check(await page.getByRole('button', { name: 'Switch to light mode' }).isVisible(), `The theme switch stays visible at ${width}px`);
    if (width === 1440 || width === 390) await page.screenshot({ path: new URL(`landing-dark-${width}.png`, output).pathname, fullPage: true });
  }
  const contrast = await page.evaluate(() => {
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    const luminance = value => { const channels = rgb(value); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
    const samples = [
      ['body', 'body'], ['.hero-copy', 'body'], ['.hero-actions .primary', '.hero-actions .primary'],
      ['.header-cta', '.header-cta'], ['.preview-switch button[aria-pressed=true]', '.preview-switch button[aria-pressed=true]'],
      ['.mobile-copy>p', '.mobile-section'], ['.signup-status', '.signup-section'], ['.map-lead strong', '.map-lead'],
      ['.email-row input', '.email-row input'], ['.skip-link', '.skip-link'],
    ];
    return samples.map(([text, background]) => {
      const foreground = luminance(getComputedStyle(document.querySelector(text)).color);
      const surface = luminance(getComputedStyle(document.querySelector(background)).backgroundColor);
      return { text, ratio: (Math.max(foreground, surface) + .05) / (Math.min(foreground, surface) + .05) };
    });
  });
  for (const sample of contrast) check(sample.ratio >= 4.5, `Dark mode text contrast is at least 4.5:1 for ${sample.text}`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-preview="chat"]').click();
  check((await page.locator('#workspace-image').getAttribute('src')).includes('product-chat'), 'The conversation preview changes to the actual chat capture');
  check(await page.locator('[data-preview="chat"]').getAttribute('aria-pressed') === 'true', 'The active preview is announced');
  await page.locator('[data-preview="board"]').click();
  check((await page.locator('#workspace-image').getAttribute('src')).includes('product-desktop'), 'The board preview restores the desktop capture');
  await page.locator('summary').first().click();
  check(await page.locator('details').first().getAttribute('open') !== null, 'The frequently asked question expands');
  await page.locator('summary').first().focus();
  await page.keyboard.press('Enter');
  check(await page.locator('details').first().getAttribute('open') === null, 'The frequently asked question works from the keyboard');
  await page.locator('#email').fill('browser-check@example.com');
  await page.locator('#consent').check();
  await page.route('**/api/waitlist', route => route.abort());
  await page.locator('#signup-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#signup-status').dataset.state === 'error');
  check(await page.locator('#email').inputValue() === 'browser-check@example.com', 'A network failure keeps the entered email');
  check(await page.locator('#signup-status').textContent() === 'We couldn’t reach the server. Please try again.', 'A network failure explains how to recover');
  await page.unroute('**/api/waitlist');
  await page.locator('#signup-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#signup-status').dataset.state === 'success');
  check((await page.locator('#signup-status').textContent()).startsWith('You’re on the list.'), 'A real saved signup receives a visible confirmation');
  check(await page.locator('#email').inputValue() === '', 'Successful submission clears the email');
  check(await page.locator('#watch-video').isHidden(), 'An absent video leaves the actual screenshots available');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check(await page.locator('.hero').evaluate(element => getComputedStyle(element).animationName) === 'none', 'Reduced motion disables the entrance animation');
  check(errors.length === 0, 'No browser JavaScript errors');
  await writeFile(new URL('results.json', output), JSON.stringify({ checks, errors, note: 'Browser signups used a temporary database. The live waitlist was untouched.' }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors, screenshots: [1440, 768, 390, 320] }));
} finally {
  await browser.close();
  await new Promise(resolve => app.server.close(resolve));
  app.close();
  await rm(directory, { recursive: true, force: true });
}
