// Step 1: render every component variant in a real browser, photograph it, and write it out as
// plain HTML with the browser's computed styles inlined, for OpenPencil to import.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fontsDir } from './openpencil.mjs';

// The computed properties copied onto each element. A profile can add more with `styles`.
export const defaultStyles = ['display', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'row-gap', 'column-gap',
  'flex-grow', 'flex-shrink', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'width', 'height', 'box-sizing',
  'background-color', 'color', 'opacity', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius',
  'border-bottom-left-radius', 'box-shadow', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'overflow'];

// Inter ships with OpenPencil, so it is the default design font. The keys are CSS weights.
const interFiles = { 100: 'Inter-Thin.ttf', 200: 'Inter-ExtraLight.ttf', 300: 'Inter-Light.ttf', 400: 'Inter-Regular.ttf', 500: 'Inter-Medium.ttf',
  600: 'Inter-SemiBold.ttf', 700: 'Inter-Bold.ttf', 800: 'Inter-ExtraBold.ttf', 900: 'Inter-Black.ttf' };

export function designFont(profile) {
  const font = { family: 'Inter', dir: fontsDir, files: interFiles, ...profile.font };
  let present = [];
  try { present = readdirSync(font.dir); } catch {}
  font.files = Object.fromEntries(Object.entries(font.files).filter(([, file]) => present.includes(file)));
  font.weights = Object.keys(font.files).map(Number).sort((a, b) => a - b);
  if (!font.weights.length) throw new Error(`No ${font.family} font files found in ${font.dir}`);
  return font;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const variantName = (props) => Object.entries(props).map(([k, v]) => `${k}=${v}`).join(', ') || 'Default';

// Runs in the page. Places the HTML variants in a host and marks every variant with its index.
function stageInPage({ jobs, background }) {
  let host = document.getElementById('reverse-fig-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'reverse-fig-host';
    host.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-start;gap:24px;padding:24px;max-height:none;background:${background}`;
    document.body.appendChild(host);
  }
  const missing = [];
  for (const job of jobs) {
    let el;
    if (job.html != null) {
      const holder = document.createElement('div');
      holder.innerHTML = (job.context || '{slot}').replace('{slot}', `<template-slot></template-slot>`);
      const slot = holder.querySelector('template-slot');
      const piece = document.createElement('div');
      piece.innerHTML = job.html.trim();
      el = piece.firstElementChild;
      slot.replaceWith(el);
      host.appendChild(holder.firstElementChild || holder);
    } else {
      el = [...document.querySelectorAll(job.selector)][job.nth || 0];
      if (!el) { missing.push(job.index); continue; }
      el.scrollIntoView({ block: 'center' });
    }
    el.dataset.rfIndex = job.index;
    if (job.force?.length) el.dataset.rfForce = job.force.join(' ');
    if (job.disabled) el.disabled = true;
  }
  // Stack the staged pieces at whole pixels, so a photograph does not start halfway into a pixel.
  let y = 24;
  for (const piece of host.children) {
    if (piece.style.position !== 'absolute') { piece.style.position = 'absolute'; piece.style.left = '24px'; }
    piece.style.top = `${y}px`;
    y += Math.ceil(piece.getBoundingClientRect().height) + 24;
  }
  host.style.height = `${y}px`; host.style.width = '100vw';
  return { missing, height: y };
}

// Runs in the page. Serializes one marked element with its computed styles inlined.
function serializeInPage({ index, styles, family, weights }) {
  const nearestWeight = (w) => {
    if (weights.includes(w)) return w;
    const up = weights.filter((x) => x >= w), down = weights.filter((x) => x <= w).reverse();
    if (w > 500) return up[0] ?? down[0];
    if (w < 400) return down[0] ?? up[0];
    return up.find((x) => x <= 500) ?? down[0] ?? up[0];
  };
  const textTags = new Set(['button', 'small', 'strong', 'kbd', 'a', 'label', 'em', 'b', 'i', 'code', 'abbr', 'time']);
  const ser = (el, isRoot) => {
    if (el.nodeType === 3) return el.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (el.nodeType !== 1) return '';
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return '';
    if (el instanceof SVGElement) {
      if (el.tagName.toLowerCase() !== 'svg') return '';
      const copy = el.cloneNode(true);
      copy.setAttribute('width', cs.width); copy.setAttribute('height', cs.height);
      if (!copy.getAttribute('stroke')) copy.setAttribute('stroke', cs.color);
      if (!copy.getAttribute('fill')) copy.setAttribute('fill', 'none');
      return copy.outerHTML;
    }
    const st = [];
    // Text the browser set on one line stays on one line, because OpenPencil's text metrics
    // differ slightly and would otherwise wrap a label that only just fits.
    const texts = [...el.childNodes].filter((c) => c.nodeType === 3 && c.textContent.trim());
    const oneLine = texts.length && texts.every((c) => { const r = document.createRange(); r.selectNodeContents(c); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size === 1; });
    for (const k of styles) {
      let v = cs.getPropertyValue(k);
      if (!v) continue;
      if (k === 'font-family') v = family;
      if (k === 'white-space' && oneLine) v = 'nowrap';
      if (k === 'font-weight') v = String(nearestWeight(Number(v)));
      // Containers hug their content. An element holding text keeps the browser's size, which the
      // build step gives to its text.
      if ((k === 'width' || k === 'height') && !isRoot && el.childNodes.length && !texts.length) continue;
      if (k === 'display' && (v === 'inline-block' || v === 'inline')) v = 'block';
      if (k === 'display' && v === 'inline-flex') v = 'flex';
      if (k.endsWith('radius') && v.endsWith('%')) v = `${parseFloat(v) / 100 * Math.min(parseFloat(cs.width), parseFloat(cs.height))}px`;
      st.push(`${k}:${v}`);
    }
    const tag = textTags.has(el.tagName.toLowerCase()) ? 'div' : el.tagName.toLowerCase();
    const name = el.dataset.rfName || (typeof el.className === 'string' && el.className.trim()) || el.tagName.toLowerCase();
    return `<${tag} data-name="${name.replace(/"/g, '')}" style="${st.join(';')}">${[...el.childNodes].map((c) => ser(c, false)).join('')}</${tag}>`;
  };
  return ser(document.querySelector(`[data-rf-index="${index}"]`), true);
}

// Runs in the page. Reads color custom properties as rgb() through a probe element, skipping any
// property that is not a color.
function readTokensInPage({ prefix }) {
  const names = new Set();
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => { for (const r of list) { if (r.style) for (const k of r.style) if (k.startsWith(prefix)) names.add(k); if (r.cssRules) walk(r.cssRules); } };
    walk(rules);
  }
  const parent = document.createElement('div'); parent.style.color = 'rgb(1, 2, 3)';
  const probe = document.createElement('span'); parent.appendChild(probe); document.body.appendChild(parent);
  const out = {};
  for (const k of names) { probe.style.color = `var(${k})`; const v = getComputedStyle(probe).color; if (v !== 'rgb(1, 2, 3)') out[k] = v; }
  parent.remove();
  return out;
}

async function forceStates(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-rf-force]' });
  for (const nodeId of nodeIds) {
    const { attributes } = await cdp.send('DOM.getAttributes', { nodeId });
    const value = attributes[attributes.indexOf('data-rf-force') + 1];
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: value.split(' ') });
  }
  return cdp; // keep the session open, or the forced states are dropped
}

export async function extract(profile, { chromium, work, log }) {
  const font = designFont(profile);
  const styles = [...defaultStyles, ...(profile.styles || [])];
  mkdirSync(join(work, 'browser'), { recursive: true });
  mkdirSync(join(work, 'browser-shown'), { recursive: true });

  // Flatten components into numbered jobs, grouped by the page they render on.
  const jobs = [];
  for (const component of profile.components) {
    for (const v of component.variants) {
      const job = { index: jobs.length, component: component.name, name: variantName(v.props || {}), hug: component.hug !== false,
        url: v.url || component.url || profile.url, html: v.html, selector: v.selector, nth: v.nth, force: v.force, disabled: v.disabled,
        context: v.context ?? component.context };
      job.file = `${String(job.index).padStart(3, '0')}-${slug(job.component)}-${slug(job.name)}.png`;
      if (job.html == null && !job.selector) throw new Error(`${job.component} / ${job.name} needs html or selector`);
      jobs.push(job);
    }
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.scale, colorScheme: profile.colorScheme });
  const fontFace = Object.entries(font.files).map(([w, file]) => `@font-face{font-family:'${font.family}';font-weight:${w};src:url(/__reverse-fig/fonts/${file})}`).join('');
  await ctx.route('**/__reverse-fig/fonts/*', (route) => route.fulfill({ path: join(font.dir, route.request().url().split('/').pop()) }));
  const out = [];
  let tokens = null;
  for (const url of [...new Set(jobs.map((j) => j.url))]) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log(`page error on ${url}: ${e.message}`));
    await page.goto(url);
    if (profile.ready) await profile.ready(page);
    if (!tokens && profile.tokens !== false) tokens = await readTokens(page, profile);
    if (profile.prepare) await profile.prepare(page);
    const here = jobs.filter((j) => j.url === url);
    const staged = await page.evaluate(stageInPage, { jobs: here, background: profile.background });
    const missing = staged.missing;
    // The staging area is fixed to the window, so the window must be tall enough to show all of it.
    if (staged.height > profile.viewport.height) await page.setViewportSize({ width: profile.viewport.width, height: staged.height });
    for (const i of missing) log(`not found: ${jobs[i].component} / ${jobs[i].name} (${jobs[i].selector})`);
    const cdp = await forceStates(page);
    // The look as shipped, before the design font replaces the page's own.
    for (const j of here) if (!missing.includes(j.index)) await page.locator(`[data-rf-index="${j.index}"]`).screenshot({ path: join(work, 'browser-shown', j.file), animations: 'disabled' });
    await page.addStyleTag({ content: `${fontFace}[data-rf-index],[data-rf-index] *{font-family:'${font.family}'!important}` });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    for (const j of here) {
      if (missing.includes(j.index)) continue;
      await page.locator(`[data-rf-index="${j.index}"]`).screenshot({ path: join(work, 'browser', j.file), animations: 'disabled' });
      out.push({ ...j, html: await page.evaluate(serializeInPage, { index: j.index, styles, family: font.family, weights: font.weights }) });
    }
    await cdp.detach();
    await page.close();
  }
  await browser.close();

  out.sort((a, b) => a.index - b.index);
  const body = out.map((v) => `<div data-name="${v.component} / ${v.name}" style="display:flex;padding:0">${v.html}</div>`).join('\n');
  const bg = tokens?.modes[0]?.values.find((t) => t.css === profile.tokens?.background)?.rgb || '#ffffff';
  writeFileSync(join(work, 'import.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;display:flex;flex-direction:column;align-items:flex-start;gap:16px;padding:16px;background-color:${bg}">\n${body}\n</body></html>\n`);
  const result = { font: { family: font.family, weights: font.weights }, background: bg, variants: out, tokens };
  writeFileSync(join(work, 'extract.json'), JSON.stringify(result, null, 1));
  log(`extracted ${out.length} variants of ${new Set(out.map((v) => v.component)).size} components, ${tokens ? tokens.modes[0].values.length : 0} color tokens`);
  return result;
}

async function readTokens(page, profile) {
  const t = { prefix: '--color-', collection: 'Color', modes: [{ name: 'Default' }], name: (k) => k.replace(/^--/, '').replace(/-/, '/'), ...profile.tokens };
  const modes = [];
  for (const mode of t.modes) {
    if (mode.apply) await page.evaluate(mode.apply);
    const values = await page.evaluate(readTokensInPage, { prefix: t.prefix });
    modes.push({ name: mode.name, values: Object.entries(values).map(([css, rgb]) => ({ css, name: t.name(css), rgb })) });
  }
  if (t.modes.at(-1)?.apply && t.modes[0].apply) await page.evaluate(t.modes[0].apply);
  return { collection: t.collection, modes };
}
