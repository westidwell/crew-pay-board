#!/usr/bin/env node
/*
 * Folds src/ into the one self-contained index.html, and stamps sw.js with a hash of the app
 * files so phones pick up new versions.
 *
 *   node scripts/build.js          write index.html and sw.js
 *   node scripts/build.js --check  exit 1 if either is out of date with src/ (used by CI)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function inlineScript(name) {
  const code = read(`src/${name}`).trimEnd();
  if (/<\/script/i.test(code)) throw new Error(`src/${name} contains "</script", which would end the inline script early.`);
  return code;
}

function build() {
  const parts = {
    '/*@styles*/': read('src/styles.css').trimEnd(),
    '//@engine': inlineScript('engine.js'),
    '//@pro': inlineScript('pro.js'),
    '//@app': inlineScript('app.js')
  };
  let html = read('src/template.html');
  for (const [marker, content] of Object.entries(parts)) {
    if (html.split(marker).length !== 2) throw new Error(`src/template.html must contain ${marker} exactly once.`);
    html = html.replace(marker, () => content); // a function, so "$&" in code is left alone
  }
  // The cache version follows the page, the manifest and the worker. Icons are left out on purpose:
  // some file stores add metadata to images on save, which would make the build look stale.
  // A new icon reaches phones with the next change to the page.
  const hash = crypto.createHash('sha256');
  hash.update(html);
  hash.update(read('manifest.webmanifest'));
  hash.update(read('src/sw.js'));
  const version = hash.digest('hex').slice(0, 12);
  const sw = read('src/sw.js').replace('__CACHE_VERSION__', version);
  return { 'index.html': html, 'sw.js': sw };
}

function main() {
  const out = build();
  const check = process.argv.includes('--check');
  const stale = [];
  let written = 0;
  for (const [file, content] of Object.entries(out)) {
    const target = path.join(ROOT, file);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current === content) continue;
    if (check) stale.push(file);
    else {
      fs.writeFileSync(target, content);
      written++;
      console.log('wrote', file);
    }
  }
  if (check) {
    if (stale.length) {
      console.error(`${stale.join(' and ')} ${stale.length > 1 ? 'are' : 'is'} out of date with src/. Run: npm run build`);
      process.exit(1);
    }
    console.log('index.html and sw.js match src/');
  } else if (!written) {
    console.log('index.html and sw.js already up to date');
  }
}

if (require.main === module) main();
module.exports = { build };
