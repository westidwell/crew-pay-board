'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../src/pro.js');

const ROOT = path.join(__dirname, '..');

test('price and link live in one place and point at this repo', () => {
  assert.equal(P.PRO_PRICE, '$1/month');
  assert.equal(P.PRO_URL, 'https://github.com/westidwell/crew-pay-board/blob/main/PRO.md');
});

test('every stub refuses with the same clear message and does nothing else', () => {
  const calls = {
    crewSignIn: () => P.crewSignIn('p1'),
    officeApproval: () => P.approveWeek('2026-11-23', 'Office'),
    multiCrew: () => P.addCrew('Second crew'),
    photoProof: () => P.attachPhoto('j1', null),
    payrollExport: () => P.exportToPayroll('2026-11-23', 'any'),
    payHistory: () => P.payHistory('p1', 2025, 2026)
  };
  assert.deepEqual(Object.keys(calls).sort(), P.PRO_FEATURES.map((f) => f.key).sort(), 'one stub per feature');
  for (const [key, call] of Object.entries(calls)) {
    assert.throws(call, (err) => {
      assert.ok(err instanceof P.ProFeatureError);
      assert.equal(err.feature, key);
      assert.equal(err.url, P.PRO_URL);
      assert.equal(err.message, `${P.feature(key).name} is part of Pro ($1/month, not open yet): see PRO.md`);
      return true;
    });
  }
  assert.throws(() => P.useCustomerRateCard('Example Customer'), (err) => err.feature === 'multiCrew');
  assert.throws(() => P.proMessage('nope'), /Unknown Pro feature/);
});

test('PRO.md lists every Pro feature and the launch line', () => {
  const md = fs.readFileSync(path.join(ROOT, 'PRO.md'), 'utf8');
  assert.match(md, /Pro is \$1\/month \(launch price\)\. It isn't open yet: star or watch this repo to hear when it opens\./);
  for (const f of P.PRO_FEATURES) {
    assert.ok(md.includes(f.name), `PRO.md is missing "${f.name}"`);
    assert.ok(md.includes(f.line), `PRO.md line for "${f.name}" does not match pro.js`);
  }
});

test('nothing claims Pro is built or available today', () => {
  const files = ['README.md', 'PRO.md', 'CONTRIBUTING.md', 'src/pro.js', 'src/app.js'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(text, /already built|ships (today|now|in Pro)|available (now|today) in Pro/i, f);
  }
});

test('the page shows every Pro feature as a locked button', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  for (const f of P.PRO_FEATURES) assert.ok(app.includes(`locked('${f.key}'`) || app.includes('locked(f.key'), f.key);
  assert.ok(app.includes('P.PRO_FEATURES.forEach'), 'Setup lists them all');
});

test('no phone-home: page code makes no network calls', () => {
  for (const f of ['src/app.js', 'src/pro.js', 'src/engine.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const word of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'navigator.connection']) {
      assert.ok(!src.includes(word), `${f} should not use ${word}`);
    }
  }
});
