'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

test('backup then restore gives back exactly the same data', () => {
  const s = E.sampleState('2026-11-26');
  s.settings.weekStart = 'sun';
  s.people[2].active = false;
  const text = E.exportBackup(s, new Date('2026-11-26T12:00:00Z'));
  const back = E.importBackup(text);
  assert.deepEqual(back.state, s);
  assert.equal(back.exportedAt, '2026-11-26T12:00:00.000Z');
  assert.deepEqual(E.computeWeek(back.state, '2026-11-26'), E.computeWeek(s, '2026-11-26'));
  const parsed = JSON.parse(text);
  assert.equal(parsed.app, 'crew-pay-board');
  assert.equal(parsed.version, 1);
});

test('restore accepts the bare saved data too', () => {
  const s = E.sampleState('2026-11-26');
  assert.deepEqual(E.importBackup(JSON.stringify(s)).state, s);
});

test('restore refuses files that are not backups, in plain words', () => {
  assert.throws(() => E.importBackup('date,job\n'), /not JSON/);
  assert.throws(() => E.importBackup('{"hello":"world"}'), /not a Crew Pay Board backup/);
  assert.throws(() => E.importBackup('[1,2,3]'), /not a Crew Pay Board backup/);
  assert.throws(() => E.importBackup(JSON.stringify({ app: 'crew-pay-board', version: 99, data: E.emptyState() })), /newer version/);
});

test('restore tidies damaged data instead of crashing', () => {
  const messy = {
    app: 'crew-pay-board',
    version: 1,
    data: {
      settings: { crewName: 'Test', weekStart: 'friday' },
      rates: [{ name: 'Set post', rate: '6.00' }, { name: '' }, null, 'junk'],
      people: [{ id: 'a', name: 'Ana' }, { name: '' }],
      jobs: [
        { id: 'j1', date: '2026-11-24', name: 'Lot 1', lines: [{ task: 'Set post', rate: '6', qty: '10', people: ['a', 'a'] }] },
        { id: 'j2', date: 'not a date', name: 'Lost' },
        { id: 'j3', date: '2026-11-24', name: 'Lot 3', adjustments: [{ kind: 'backcharge', person: 'a', cents: -500 }] }
      ]
    }
  };
  const s = E.importBackup(JSON.stringify(messy)).state;
  assert.equal(s.settings.weekStart, 'mon');
  assert.equal(s.rates.length, 1);
  assert.equal(s.rates[0].unit, 'each');
  assert.equal(s.people.length, 1);
  assert.equal(s.jobs.length, 2);
  assert.deepEqual(s.jobs[0].lines[0].people, ['a']);
  assert.equal(s.jobs[1].adjustments[0].cents, 500);
  assert.equal(E.computeWeek(s, '2026-11-24').totalCents, 6000 - 500);
});

test('the engine never touches the page, storage or the network', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'engine.js'), 'utf8');
  for (const word of ['document.', 'window.', 'localStorage', 'fetch(', 'XMLHttpRequest', 'sendBeacon']) {
    assert.ok(!src.includes(word), `engine.js should not use ${word}`);
  }
});
