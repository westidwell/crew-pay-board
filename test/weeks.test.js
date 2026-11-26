'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

// 2026-11-23 is a Monday, 2026-11-29 a Sunday.

test('Monday-start weeks run Monday through Sunday', () => {
  assert.equal(E.weekStartOf('2026-11-23', 'mon'), '2026-11-23');
  assert.equal(E.weekStartOf('2026-11-26', 'mon'), '2026-11-23');
  assert.equal(E.weekStartOf('2026-11-29', 'mon'), '2026-11-23'); // Sunday belongs to the week before
  assert.equal(E.weekStartOf('2026-11-30', 'mon'), '2026-11-30');
  const w = E.weekOf('2026-11-29', 'mon');
  assert.deepEqual([w.start, w.end], ['2026-11-23', '2026-11-29']);
  assert.equal(w.days.length, 7);
});

test('Sunday-start weeks run Sunday through Saturday', () => {
  assert.equal(E.weekStartOf('2026-11-29', 'sun'), '2026-11-29');
  assert.equal(E.weekStartOf('2026-11-28', 'sun'), '2026-11-22');
  assert.equal(E.weekStartOf('2026-11-23', 'sun'), '2026-11-22');
  const w = E.weekOf('2026-11-28', 'sun');
  assert.deepEqual([w.start, w.end], ['2026-11-22', '2026-11-28']);
});

test('unknown week start falls back to Monday', () => {
  assert.equal(E.weekStartOf('2026-11-29', 'tuesday'), '2026-11-23');
});

test('weeks cross month and year ends, and leap days', () => {
  assert.deepEqual(E.weekOf('2026-01-01', 'mon').start, '2025-12-29');
  assert.deepEqual(E.weekOf('2025-12-31', 'sun').end, '2026-01-03');
  assert.equal(E.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(E.addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(E.addDays('2026-03-08', 1), '2026-03-09'); // US clocks change that weekend
  assert.equal(E.addDays('2026-11-01', -1), '2026-10-31');
});

test('a job on the boundary day lands in the right week for each setting', () => {
  const s = E.emptyState();
  s.people = [{ id: 'a', name: 'Ana', active: true }];
  E.saveJob(s, { date: '2026-11-29', name: 'Sunday job', lines: [{ task: 'Set post', unit: 'post', rate: 6, qty: 1, people: ['a'] }], adjustments: [] });

  s.settings.weekStart = 'mon';
  assert.equal(E.computeWeek(s, '2026-11-23').totalCents, 600);
  assert.equal(E.computeWeek(s, '2026-11-30').totalCents, 0);

  s.settings.weekStart = 'sun';
  assert.equal(E.computeWeek(s, '2026-11-23').totalCents, 0);
  assert.equal(E.computeWeek(s, '2026-11-30').totalCents, 600);
  assert.equal(E.computeWeek(s, '2026-11-29').start, '2026-11-29');
});

test('dates: strict checks, loose reading for CSV, and labels', () => {
  assert.equal(E.isISODate('2026-02-29'), false);
  assert.equal(E.isISODate('2028-02-29'), true);
  assert.equal(E.isISODate('2026-13-01'), false);
  assert.equal(E.parseLooseDate('2026-11-24'), '2026-11-24');
  assert.equal(E.parseLooseDate('2026/11/4'), '2026-11-04');
  assert.equal(E.parseLooseDate('11/24/2026'), '2026-11-24');
  assert.equal(E.parseLooseDate('3/2/26'), '2026-03-02');
  assert.equal(E.parseLooseDate('2/30/2026'), null);
  assert.equal(E.parseLooseDate('next tuesday'), null);
  assert.equal(E.dayOfWeek('2026-11-23'), 1);
  assert.equal(E.fmtDay('2026-11-24'), 'Tue Nov 24');
  assert.equal(E.fmtRange('2026-11-23', '2026-11-29'), 'Mon Nov 23 – Sun Nov 29, 2026');
  assert.equal(E.localISO(new Date(2026, 10, 5, 23, 59)), '2026-11-05');
  assert.throws(() => E.addDays('11/24/2026', 1), /use YYYY-MM-DD/);
});
