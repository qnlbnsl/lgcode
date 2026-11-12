import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createMarketingServer } from './server.ts';

test('signups persist, deduplicate, validate consent, and remain private over HTTP', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lgtm-signup-'));
  const databasePath = join(directory, 'waitlist.sqlite');
  let app = createMarketingServer({ databasePath });
  const start = async () => {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    assert(address && typeof address !== 'string');
    return `http://127.0.0.1:${address.port}`;
  };
  const stop = async () => {
    await new Promise<void>((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
    app.close();
  };
  try {
    let base = await start();
    const post = (body: unknown, headers = {}) => fetch(`${base}/api/waitlist`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...headers }, body: JSON.stringify(body),
    });
    assert.equal((await post({ email: 'not-an-email', consent: true })).status, 400);
    assert.equal((await post({ email: 'reader@example.com' })).status, 400);
    assert.equal((await post({ email: 'reader@example.com', consent: true }, { origin: 'https://unrelated.example' })).status, 403);
    assert.equal((await post({ email: ' Reader@Example.com ', consent: true })).status, 201);
    assert.equal((await post({ email: 'reader@example.com', consent: true })).status, 201);
    assert.equal((await post({ email: 'bot@example.com', consent: true, website: 'spam' })).status, 201);
    assert.equal((await post({ email: 'x'.repeat(5000), consent: true })).status, 413);
    await stop();
    app = createMarketingServer({ databasePath });
    base = await start();
    const database = new DatabaseSync(databasePath);
    assert.deepEqual({ ...database.prepare('SELECT email, consent_version FROM waitlist').get() }, {
      email: 'reader@example.com', consent_version: 'early-access-v1',
    });
    assert.equal(database.prepare('SELECT count(*) AS n FROM waitlist').get()?.n, 1);
    database.close();
    for (const path of ['/waitlist.sqlite', '/server.ts', '/api/waitlist', '/assets/../../server.ts', '/.git/config']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /LGTM Studio/);
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  } finally {
    await stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a supplied video can be discovered and sought without exposing other files', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lgtm-media-'));
  const publicDirectory = join(directory, 'public');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(publicDirectory, 'assets'), { recursive: true });
  const bytes = Buffer.from('video-transport-fixture');
  writeFileSync(join(publicDirectory, 'assets/demo.mp4'), bytes);
  const app = createMarketingServer({ databasePath: join(directory, 'waitlist.sqlite'), publicDirectory });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await (await fetch(base + '/api/media')).json()).available, true);
    const full = await fetch(base + '/assets/demo.mp4');
    assert.equal(full.status, 200);
    assert.equal(await full.text(), bytes.toString());
    const partial = await fetch(base + '/assets/demo.mp4', { headers: { range: 'bytes=0-4' } });
    assert.equal(partial.status, 206);
    assert.equal(await partial.text(), 'video');
    assert.equal(partial.headers.get('content-range'), `bytes 0-4/${bytes.length}`);
    const suffix = await fetch(base + '/assets/demo.mp4', { headers: { range: 'bytes=-7' } });
    assert.equal(await suffix.text(), 'fixture');
    assert.equal((await fetch(base + '/assets/demo.mp4', { headers: { range: 'bytes=1000-' } })).status, 416);
    const head = await fetch(base + '/assets/demo.mp4', { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), String(bytes.length));
    assert.equal(await head.text(), '');
  } finally {
    await new Promise<void>(resolve => app.server.close(() => resolve()));
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
