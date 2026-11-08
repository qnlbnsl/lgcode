// Step 3: render every variant from the design file and compare it, pixel by pixel, with the
// browser's photograph of the same variant. Writes report.json and report.html.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openpencil } from './openpencil.mjs';

// Runs in a blank page. Compares two PNGs drawn at the top-left of one canvas and returns the
// share of pixels that differ, plus a picture of the differences in red.
async function compareInPage({ a, b, threshold, background, shift }) {
  const load = (src) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
  // Both pictures sit on the page background, because the design render is transparent.
  const draw = (img) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = background; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
  const da = draw(ia), db = draw(ib);
  const out = new OffscreenCanvas(w, h), ox = out.getContext('2d'), od = ox.createImageData(w, h);
  const limit = threshold * 255;
  const near = (p, q, i) => Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2])) <= limit;
  // A pixel matches when the other picture has the same color within `shift` pixels, so
  // anti-aliasing and a one-pixel nudge of the text do not count as differences.
  const found = (p, q, x, y) => {
    for (let dy = -shift; dy <= shift; dy++) for (let dx = -shift; dx <= shift; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = (ny * w + nx) * 4;
      if (Math.max(Math.abs(p[(y * w + x) * 4] - q[j]), Math.abs(p[(y * w + x) * 4 + 1] - q[j + 1]), Math.abs(p[(y * w + x) * 4 + 2] - q[j + 2])) <= limit) return true;
    }
    return false;
  };
  let diff = 0;
  for (let i = 0; i < da.length; i += 4) {
    const x = (i / 4) % w, y = Math.floor(i / 4 / w);
    if (!near(da, db, i) && !(found(da, db, x, y) && found(db, da, x, y))) { diff++; od.data.set([220, 30, 60, 255], i); } else { const g = 255 - (255 - (da[i] + da[i + 1] + da[i + 2]) / 3) * 0.25; od.data.set([g, g, g, 255], i); }
  }
  ox.putImageData(od, 0, 0);
  const blob = await out.convertToBlob({ type: 'image/png' });
  const png = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
  return { ratio: diff / (w * h), browser: [ia.width, ia.height], design: [ib.width, ib.height], png };
}

const dataUrl = (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export async function verify(profile, { chromium, work, output, built, log }) {
  mkdirSync(join(work, 'design'), { recursive: true });
  mkdirSync(join(work, 'diff'), { recursive: true });
  const extracted = JSON.parse(readFileSync(join(work, 'extract.json'), 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Node ids change when OpenPencil saves a file, so find each variant by name in the saved file.
  const listing = openpencil(['eval', output, '--json', '-c', `const page = figma.root.children.find((p) => p.name === 'Components');
return page.children.flatMap((n) => n.type === 'COMPONENT_SET' ? n.children.map((c) => ({ component: n.name, name: c.name, id: c.id }))
  : n.type === 'COMPONENT' ? [{ component: n.name, name: null, id: n.id }] : []);`]);
  const saved = JSON.parse(listing.slice(listing.indexOf('[')));
  const rows = [];
  for (const b of built.variants) {
    const found = saved.find((s) => s.component === b.component && (s.name === b.name || s.name === null));
    if (!found) { log(`verify: ${b.component} / ${b.name} is missing from ${output}`); continue; }
    const v = { ...b, id: found.id };
    const meta = extracted.variants.find((x) => x.index === v.index);
    const designPng = join(work, 'design', meta.file);
    openpencil(['export', output, '--node', v.id, '-f', 'png', '-s', String(profile.scale), '-o', designPng, '--font-policy', 'allow']);
    const r = await page.evaluate(compareInPage, { a: dataUrl(join(work, 'browser', meta.file)), b: dataUrl(designPng), threshold: profile.threshold, background: extracted.background, shift: Math.round((profile.shift ?? 1) * profile.scale) });
    writeFileSync(join(work, 'diff', meta.file), Buffer.from(r.png.split(',')[1], 'base64'));
    rows.push({ component: v.component, variant: v.name, id: v.id, file: meta.file, ratio: Number(r.ratio.toFixed(4)), browserSize: r.browser, designSize: r.design,
      pass: r.ratio <= profile.passRatio });
  }
  await browser.close();
  rows.sort((a, b) => b.ratio - a.ratio);
  const passed = rows.filter((r) => r.pass).length;
  const report = { profile: profile.name, output, threshold: profile.threshold, shift: profile.shift ?? 1, passRatio: profile.passRatio, passed, total: rows.length, rows };
  writeFileSync(join(work, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(work, 'report.html'), reportHtml(report));
  log(`verify: ${passed} of ${rows.length} variants within ${(profile.passRatio * 100).toFixed(1)}% of the browser`);
  for (const r of rows.filter((x) => !x.pass).slice(0, 10)) log(`  ${(r.ratio * 100).toFixed(1)}%  ${r.component} / ${r.variant}  browser ${r.browserSize.join('×')}, design ${r.designSize.join('×')}`);
  return report;
}

function reportHtml(report) {
  const row = (r) => `<tr class="${r.pass ? 'pass' : 'fail'}"><td><strong>${esc(r.component)}</strong><br>${esc(r.variant)}<br><code>${esc(r.id)}</code></td>
<td>${(r.ratio * 100).toFixed(1)}%</td><td>${r.browserSize.join('×')}<br>${r.designSize.join('×')}</td>
<td><img src="browser-shown/${r.file}"></td><td><img src="browser/${r.file}"></td><td><img src="design/${r.file}"></td><td><img src="diff/${r.file}"></td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Reverse Fig report</title><style>
body{font:14px system-ui,sans-serif;margin:24px;color:#222;background:#fafafa}table{border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left;vertical-align:top}
img{max-width:320px;background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/12px 12px}.fail td:nth-child(2){color:#b0203a;font-weight:600}code{font-size:12px;color:#666}</style></head><body>
<h1>${esc(report.profile)}: ${report.passed} of ${report.total} variants match</h1>
<p>A variant matches when no more than ${(report.passRatio * 100).toFixed(1)}% of its pixels differ by more than ${report.threshold * 100}% in any channel, after allowing each pixel to move by ${report.shift} pixel. Worst first.</p>
<table><tr><th>Variant</th><th>Differs</th><th>Browser<br>Design</th><th>As shipped</th><th>Browser, design font</th><th>Design file</th><th>Difference</th></tr>
${report.rows.map(row).join('\n')}</table></body></html>\n`;
}
