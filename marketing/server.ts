import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('.', import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/tokens.css', ['tokens.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ...['product-desktop.png', 'product-chat.png', 'product-mobile.png'].map(name => [
    `/assets/${name}`, [`assets/${name}`, 'image/png'],
  ]),
] as [string, [string, string]][]);

export function createMarketingServer({
  databasePath = join(root, '.state', 'waitlist.sqlite'),
  publicDirectory = join(root, 'public'),
} = {}) {
  const publicRoot = publicDirectory;
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(databasePath);
  chmodSync(databasePath, 0o600);
  database.exec(`CREATE TABLE IF NOT EXISTS waitlist (
    email TEXT PRIMARY KEY, created_at TEXT NOT NULL, consent_version TEXT NOT NULL
  )`);
  const insert = database.prepare('INSERT OR IGNORE INTO waitlist VALUES (?, ?, ?)');
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    try {
      const pathname = new URL(req.url ?? '/', 'http://landing.local').pathname;
      if (pathname === '/api/waitlist' && req.method === 'POST') {
        // Only this public signup endpoint is exposed. The engine is never imported.
        const origin = req.headers.origin;
        if (!origin || !req.headers.host || new URL(origin).host !== req.headers.host ||
          req.headers['sec-fetch-site'] === 'cross-site') {
          json(403, { error: 'Please submit the form from this website.' }); return;
        }
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
          json(415, { error: 'Please reload the page and try again.' }); return;
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 4096) { json(413, { error: 'The form is too large.' }); return; }
        }
        let input: { email?: unknown; consent?: unknown; website?: unknown };
        try { input = JSON.parse(body); } catch { json(400, { error: 'Please reload the page and try again.' }); return; }
        if (!input || typeof input !== 'object') { json(400, { error: 'Please complete the form.' }); return; }
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) {
          json(400, { error: 'Enter a valid email address.' }); return;
        }
        if (input.consent !== true) { json(400, { error: 'Please agree to receive early-access updates.' }); return; }
        if (!input.website) insert.run(email, new Date().toISOString(), 'early-access-v1');
        // A duplicate gets the same response, without revealing membership.
        json(201, { message: 'You’re on the list. We’ll email you when early access opens.' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { json(405, { error: 'Method not allowed.' }); return; }
      if (pathname === '/api/media') {
        const available = await stat(join(publicRoot, 'assets/demo.mp4')).then(s => s.isFile()).catch(() => false);
        json(200, { available }); return;
      }
      if (pathname === '/app.js') {
        const source = await readFile(join(root, 'browser.ts'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : stripTypeScriptTypes(source)); return;
      }
      if (pathname === '/theme.js') {
        const source = await readFile(join(root, 'theme.ts'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : source); return;
      }
      if (pathname === '/fonts/inter.woff2') {
        const font = join(root, '../third_party/inter/InterVariable-latin.woff2');
        res.writeHead(200, { 'Content-Type': 'font/woff2' });
        if (req.method === 'HEAD') res.end(); else createReadStream(font).pipe(res);
        return;
      }
      if (pathname === '/assets/demo.mp4') {
        const video = join(publicRoot, 'assets/demo.mp4');
        const info = await stat(video).catch(() => null);
        if (!info?.isFile()) { json(404, { error: 'The video is not available yet.' }); return; }
        const range = req.headers.range;
        let start = 0, end = info.size - 1;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
          start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
          if (!Number.isSafeInteger(start) || start > end || start >= info.size) {
            res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return;
          }
        }
        res.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
        if (req.method === 'HEAD') res.end(); else createReadStream(video, { start, end }).pipe(res);
        return;
      }
      const asset = assets.get(pathname);
      if (!asset) { json(404, { error: 'Not found.' }); return; }
      const bytes = await readFile(join(publicRoot, asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': bytes.length });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      // Never log a submitted email address or the request body.
      if (!res.headersSent) json(500, { error: 'We couldn’t save your email. Please try again shortly.' });
      else res.destroy();
    }
  });
  return { server, close: () => database.close() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.LGTM_MARKETING_PORT ?? 9999);
  const host = process.env.LGTM_MARKETING_HOST ?? '0.0.0.0';
  const app = createMarketingServer();
  app.server.listen(port, host, () => console.log(`LGTM Studio marketing page: http://${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    app.server.close(() => { app.close(); process.exit(0); });
  });
}
