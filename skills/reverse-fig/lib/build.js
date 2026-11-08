// Step 2b: runs inside `openpencil eval` on the imported document. The runner puts
// `const INPUT = {...};` above this file. Written against the plugin API of OpenPencil 0.16.0,
// where variables live on `figma` and modes on `figma.graph`.
//
// INPUT.variants: [{ index, component, name, hug }] in the order of the imported frames.
// INPUT.tokens:   { collection, modes: [{ name, values: [{ css, name, rgb }] }] } or null.
const page = figma.currentPage;
page.name = 'Components';
const log = [];
const parse = (s) => {
  const hex = s.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const n = s.match(/[\d.]+/g).map(Number);
  return { r: n[0] / 255, g: n[1] / 255, b: n[2] / 255, a: n.length > 3 ? n[3] : 1 };
};
const key = (c, a = 1) => [c.r, c.g, c.b].map((x) => Math.round(x * 255)).concat(Math.round(a * 100)).join(',');

// 1. Color variables: one collection, one mode per profile mode.
const byColor = {};
if (INPUT.tokens && INPUT.tokens.modes.length) {
  const [first, ...rest] = INPUT.tokens.modes;
  const coll = figma.createVariableCollection(INPUT.tokens.collection);
  figma.graph.renameMode(coll.id, coll.defaultModeId, first.name);
  const modeIds = [coll.defaultModeId, ...rest.map((m) => figma.graph.createMode(coll.id, m.name))];
  for (const token of first.values) {
    const value = parse(token.rgb);
    const variable = figma.createVariable(token.name, 'COLOR', coll.id, value);
    INPUT.tokens.modes.forEach((mode, i) => {
      const same = mode.values.find((t) => t.css === token.css);
      if (same) figma.setVariableValue(variable.id, modeIds[i], parse(same.rgb));
    });
    variable.description = `var(${token.css})`;
    byColor[key(value, value.a)] ??= variable;
  }
  log.push(`variables: ${first.values.length} in ${INPUT.tokens.modes.length} modes`);
}

// Bind each solid paint whose color equals a token's first-mode value. Two tokens with the same
// value bind to the first one, so the profile's token order decides.
let bound = 0;
const bindPaints = (node) => {
  for (const prop of ['fills', 'strokes']) {
    const paints = node[prop];
    if (!Array.isArray(paints)) continue;
    paints.forEach((p, i) => {
      const v = p.type === 'SOLID' && byColor[key(p.color, p.opacity ?? 1)];
      if (v) { figma.bindVariable(node.id, `${prop}/${i}/color`, v.id); bound++; }
    });
  }
  if ('children' in node) node.children.forEach(bindPaints);
};

// OpenPencil 0.16.0 cannot measure some bundled weights from the command line (Inter Medium and
// SemiBold fall back to a rough estimate), so a label can wrap that fit in the browser. Each
// element that holds only text kept the browser's size, so its text gets exactly that box.
let pinned = 0;
const pinText = (node) => {
  const p = node.parent;
  if (node.type === 'TEXT' && p && p.type !== 'PAGE' && p.children.length === 1 && 'paddingLeft' in p) {
    const w = p.width - p.paddingLeft - p.paddingRight, h = p.height - p.paddingTop - p.paddingBottom;
    // A whole pixel of room, because a box cut to the browser's fractional width drops the last
    // letter. The frame grows with it, or its layout would stretch the text back.
    if (w > 0 && h > 0) {
      const room = Math.ceil(w) + 1 - w;
      p.resize(p.width + room, p.height);
      node.textAutoResize = 'NONE'; node.resize(w + room, h); pinned++;
    }
  }
  if ('children' in node) node.children.forEach(pinText);
};

// 2. Components: each imported wrapper frame holds one rendered variant.
const wrappers = [...page.children];
if (wrappers.length !== INPUT.variants.length) throw new Error(`imported ${wrappers.length} frames for ${INPUT.variants.length} variants`);
const groups = {};
const made = [];
wrappers.forEach((w, i) => {
  const v = INPUT.variants[i];
  const comp = figma.createComponentFromNode(w.children[0]);
  comp.name = v.name;
  page.appendChild(comp);
  w.remove();
  pinText(comp);
  // Hug the content only along an axis where hugging gives the browser's size. A button with a
  // fixed height or a minimum width keeps that size instead.
  if (v.hug && comp.layoutMode && comp.layoutMode !== 'NONE') {
    comp.primaryAxisSizingMode = 'AUTO'; comp.counterAxisSizingMode = 'AUTO';
    if (v.width && v.height) {
      const horizontal = comp.layoutMode === 'HORIZONTAL';
      const wrongW = Math.abs(comp.width - v.width) > 1.5, wrongH = Math.abs(comp.height - v.height) > 1.5;
      if (wrongW) horizontal ? (comp.primaryAxisSizingMode = 'FIXED') : (comp.counterAxisSizingMode = 'FIXED');
      if (wrongH) horizontal ? (comp.counterAxisSizingMode = 'FIXED') : (comp.primaryAxisSizingMode = 'FIXED');
      if (wrongW || wrongH) comp.resize(wrongW ? v.width : comp.width, wrongH ? v.height : comp.height);
    }
  }
  bindPaints(comp);
  (groups[v.component] ??= []).push(comp);
  made.push({ index: v.index, component: v.component, name: v.name, id: comp.id });
});
log.push(`bound paints: ${bound}`, `labels given the browser's size: ${pinned}`);

// 3. Component sets, with variants laid out in rows by their first property.
let y = 0;
const sets = [];
for (const [name, comps] of Object.entries(groups)) {
  const set = comps.length > 1 || comps[0].name.includes('=') ? figma.combineAsVariants(comps, page) : comps[0];
  set.name = name;
  if (set.type === 'COMPONENT_SET') {
    let cx = 0, cy = 0, rowKey = null, maxW = 0, rowH = 0;
    for (const v of set.children) {
      const k = v.name.split(',')[0];
      if (rowKey !== null && k !== rowKey) { cx = 0; cy += rowH + 16; rowH = 0; }
      rowKey = k; v.x = 16 + cx; v.y = 16 + cy; cx += v.width + 16; maxW = Math.max(maxW, cx); rowH = Math.max(rowH, v.height);
    }
    set.resize(maxW + 16, cy + rowH + 32);
  }
  set.x = 0; set.y = y; y += set.height + 80;
  sets.push({ name: set.name, type: set.type, variants: set.type === 'COMPONENT_SET' ? set.children.length : 1 });
}

// 4. A Screens page with one instance of each component, ready for screens to be drawn from them.
const screens = figma.createPage();
screens.name = 'Screens';
let sy = 0;
for (const node of page.children) {
  const main = node.type === 'COMPONENT_SET' ? node.children[0] : node.type === 'COMPONENT' ? node : null;
  if (!main) continue;
  const inst = main.createInstance();
  inst.name = node.name;
  screens.appendChild(inst);
  inst.x = 0; inst.y = sy; sy += inst.height + 24;
}
return { log, sets, variants: made };
