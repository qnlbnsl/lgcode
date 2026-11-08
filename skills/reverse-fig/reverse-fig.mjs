#!/usr/bin/env node
// Reverse Fig: renders a project's components in a browser and turns them into an OpenPencil
// design file with component sets, variants and color variables, then checks the result
// against the browser. Everything specific to a project lives in its profile.
//
//   node reverse-fig.mjs <profile.mjs> [--steps extract,build,verify] [--storybook]
//
// See SKILL.md for the profile format and the tuning loop.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extract } from './lib/extract.mjs';
import { openpencil, skillDir } from './lib/openpencil.mjs';
import { verify } from './lib/verify.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const storybook = args.includes('--storybook') && args.splice(args.indexOf('--storybook'), 1);
const steps = (flag('--steps') || 'extract,build,verify').split(',');
const profilePath = args[0];
if (!profilePath) {
  console.error('Usage: node reverse-fig.mjs <profile.mjs> [--steps extract,build,verify] [--storybook]');
  process.exit(2);
}

const defaults = {
  viewport: { width: 1400, height: 900 },
  scale: 2,               // device pixels per CSS pixel, for photographs and design renders alike
  colorScheme: 'light',
  background: 'transparent',
  threshold: 0.1,         // how far a channel may drift before a pixel counts as different
  passRatio: 0.03,        // how many pixels of a variant may differ before it fails
};
const loaded = (await import(pathToFileURL(resolve(profilePath)).href)).default;
const profile = { ...defaults, ...loaded };
for (const k of ['name', 'url', 'components']) if (!profile[k]) throw new Error(`The profile needs ${k}`);
const work = resolve(profile.work || join('.reverse-fig', profile.name));
const output = resolve(profile.output || join(work, `${profile.name}.fig`));
mkdirSync(work, { recursive: true });
mkdirSync(dirname(output), { recursive: true });
const log = (line) => console.log(line);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

if (steps.includes('extract')) await extract(profile, { chromium, work, log });

let built;
if (steps.includes('build')) {
  const extracted = JSON.parse(readFileSync(join(work, 'extract.json'), 'utf8'));
  const imported = join(work, 'imported.fig');
  openpencil(['import', join(work, 'import.html'), '-o', imported, '--pageName', 'Components']);
  const input = { variants: extracted.variants.map(({ index, component, name, hug }) => ({ index, component, name, hug })), tokens: extracted.tokens };
  const code = `const INPUT = ${JSON.stringify(input)};\n${readFileSync(join(skillDir, 'lib', 'build.js'), 'utf8')}`;
  const raw = openpencil(['eval', imported, '--stdin', '-o', output, '--json'], { input: code });
  built = JSON.parse(raw.slice(raw.indexOf('{')));
  writeFileSync(join(work, 'build.json'), JSON.stringify(built, null, 1));
  for (const line of built.log) log(`build: ${line}`);
  log(`build: ${built.sets.length} components in ${output}`);
}

if (steps.includes('verify')) {
  built ??= JSON.parse(readFileSync(join(work, 'build.json'), 'utf8'));
  const report = await verify(profile, { chromium, work, output, built, log });
  log(`report: ${join(work, 'report.html')}`);
  process.exitCode = report.passed === report.total ? 0 : 1;
}

if (storybook) {
  openpencil(['export', output, '-f', 'storybook', '-o', join(work, 'stories')]);
  log(`storybook: ${join(work, 'stories')}`);
}
