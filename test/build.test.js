'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { build } = require('../scripts/build.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('index.html and sw.js are rebuilt from src/ (run: npm run build)', () => {
  const out = build();
  assert.ok(out['index.html'] === read('index.html'), 'index.html is out of date. Run: npm run build');
  assert.ok(out['sw.js'] === read('sw.js'), 'sw.js is out of date. Run: npm run build');
});

test('index.html is self-contained: inline styles and scripts, no outside script or style links', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/i);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org|github\.com\/westidwell\/crew-pay-board)/, 'only the PRO.md link and the SVG namespace');
  assert.ok(!html.includes('//@engine') && !html.includes('/*@styles*/'), 'all markers replaced');
});

test('every inline script in index.html compiles', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 3);
  for (const code of scripts) new vm.Script(code); // throws on a syntax error
});

test('the engine inside index.html works on its own, as it does in the browser', () => {
  const html = read('index.html');
  const engine = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const sandbox = {};
  vm.runInNewContext(engine.replace('typeof globalThis', 'typeof notGlobalThis'), sandbox); // force the browser branch
  assert.equal(typeof sandbox.CrewPay.computeWeek, 'function');
  assert.equal(sandbox.CrewPay.lineCents(18, 6), 10800);
});

test('install files: manifest, service worker and icons are in place', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(ROOT, icon.src)), icon.src);
  const sw = read('sw.js');
  assert.match(sw, /var CACHE = 'crew-pay-board-[0-9a-f]{12}'/);
  for (const f of ['./index.html', './manifest.webmanifest', './icon-192.png']) assert.ok(sw.includes(`'${f}'`), f);
  new vm.Script(sw);
  const png = fs.readFileSync(path.join(ROOT, 'icon-192.png'));
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 192);
});
