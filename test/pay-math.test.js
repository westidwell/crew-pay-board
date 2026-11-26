'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

function crew() {
  const s = E.emptyState();
  s.rates = [
    { id: 'post', name: 'Set post', unit: 'post', rate: 6 },
    { id: 'panel', name: 'Hang panel', unit: 'panel', rate: 9.5 },
    { id: 'fab', name: 'Chain link fabric', unit: 'ft', rate: 0.85 }
  ];
  s.people = [
    { id: 'a', name: 'Ana', active: true },
    { id: 'b', name: 'Bo', active: true },
    { id: 't', name: 'Teo', active: true }
  ];
  return s;
}

test('quantity x rate is exact to the cent, with no float drift', () => {
  assert.equal(E.lineCents(18, 6), 10800);
  assert.equal(E.lineCents(16, 9.5), 15200);
  assert.equal(E.lineCents(212.5, 0.85), 18063); // 180.625 rounds up to 180.63
  assert.equal(E.lineCents(3, 0.1), 30); // 0.1 * 3 is 0.30000000000000004 in floats
  assert.equal(E.lineCents('1.005', 1), 101); // 1.005 is 1.00499... as a float; text is exact
  assert.equal(E.lineCents(1.005, 1), 101); // numbers go through their shortest text form
  assert.equal(E.lineCents(0, 9.5), 0);
});

test('rounding is half away from zero and only the final line is rounded', () => {
  assert.equal(E.lineCents(1, 0.125), 13); // 12.5 cents -> 13
  assert.equal(E.lineCents(1, 0.1249), 12);
  assert.equal(E.lineCents(1, -0.125), -13);
  assert.equal(E.lineCents(7, 0.0833), 58); // 0.5831 -> 58
  assert.equal(E.lineCents(1000, 0.0855), 8550); // a 4-decimal rate keeps all 4 decimals
});

test('quantities keep 3 decimals and rates keep 4', () => {
  assert.equal(E.lineCents(12.0004, 100), 120000); // qty rounds to 12.000
  assert.equal(E.lineCents(12.0005, 100), 120010); // qty rounds to 12.001
  assert.equal(E.lineCents(1, 0.08555), 9); // rate rounds to 0.0856
});

test('big numbers stay exact', () => {
  assert.equal(E.lineCents(99999.999, 9999.9999), 99999998000); // $999,999,980.0000001
});

test('money text in and out', () => {
  assert.equal(E.toCents('$1,234.50'), 123450);
  assert.equal(E.toCents('(15.00)'), -1500);
  assert.equal(E.toCents('-0.005'), -1);
  assert.equal(E.toCents(19.995), 2000);
  assert.equal(E.parseCents('abc'), null);
  assert.equal(E.parseCents(''), null);
  assert.equal(E.fmtMoney(123456), '$1,234.56');
  assert.equal(E.fmtMoney(-1550), '-$15.50');
  assert.equal(E.fmtMoney(5), '$0.05');
  assert.equal(E.fmtMoney(0), '$0.00');
  assert.equal(E.centsToDecimal(123450), '1234.50');
  assert.equal(E.centsToDecimal(-7), '-0.07');
  assert.equal(E.fmtRate(6), '6.00');
  assert.equal(E.fmtRate(0.085), '0.085');
  assert.equal(E.fmtRate('9.5'), '9.50');
  assert.equal(E.fmtQty(12), '12');
  assert.equal(E.fmtQty(212.5), '212.5');
  assert.throws(() => E.toCents('twelve'), /Not a number/);
});

test('a split line adds back up exactly; extra pennies go to the first names', () => {
  assert.deepEqual(E.splitCents(10800, 2), [5400, 5400]);
  assert.deepEqual(E.splitCents(101, 2), [51, 50]);
  assert.deepEqual(E.splitCents(100, 3), [34, 33, 33]);
  assert.deepEqual(E.splitCents(-100, 3), [-34, -33, -33]);
  assert.deepEqual(E.splitCents(1, 3), [1, 0, 0]);
  assert.deepEqual(E.splitCents(500, 0), []);
  for (const [c, n] of [[18063, 2], [99999, 7], [1, 5]]) {
    assert.equal(E.splitCents(c, n).reduce((a, b) => a + b, 0), c);
  }
});

test('job breakdown: pieces, splits, extras and back-charges per person', () => {
  const job = {
    id: 'j1',
    date: '2026-11-24',
    name: 'Lot 7',
    notes: '',
    lines: [
      { task: 'Set post', unit: 'post', rate: 6, qty: 18, people: ['a', 'b'] }, // 108.00 -> 54/54
      { task: 'Chain link fabric', unit: 'ft', rate: 0.85, qty: 212.5, people: ['a', 't'] }, // 180.63 -> 90.32/90.31
      { task: 'Hang panel', unit: 'panel', rate: 9.5, qty: 16, people: ['t'] } // 152.00
    ],
    adjustments: [
      { kind: 'extra', person: 'a', cents: 2500, note: 'hand dig' },
      { kind: 'backcharge', person: 't', cents: 1500, note: 'gate' }
    ]
  };
  const b = E.jobBreakdown(job);
  assert.deepEqual(b.byPerson.a, { work: 5400 + 9032, extra: 2500, backcharge: 0, net: 16932 });
  assert.deepEqual(b.byPerson.b, { work: 5400, extra: 0, backcharge: 0, net: 5400 });
  assert.deepEqual(b.byPerson.t, { work: 9031 + 15200, extra: 0, backcharge: 1500, net: 22731 });
  assert.equal(b.totalCents, 10800 + 18063 + 15200 + 2500 - 1500);
  const sumNet = Object.values(b.byPerson).reduce((s, p) => s + p.net, 0);
  assert.equal(sumNet, b.totalCents);
});

test('week totals per person, and back-charges can take pay below zero', () => {
  const s = crew();
  E.saveJob(s, {
    date: '2026-11-23',
    name: 'Lot 1',
    lines: [{ task: 'Set post', unit: 'post', rate: 6, qty: 10, people: ['a'] }],
    adjustments: [{ kind: 'backcharge', person: 'b', cents: 4000, note: 'broken panel' }]
  });
  E.saveJob(s, {
    date: '2026-11-25',
    name: 'Lot 2',
    lines: [{ task: 'Hang panel', unit: 'panel', rate: 9.5, qty: 3, people: ['a', 'b'] }],
    adjustments: [{ kind: 'extra', person: 'a', cents: 1000, note: '' }]
  });
  const w = E.computeWeek(s, '2026-11-26');
  const by = Object.fromEntries(w.people.map((p) => [p.name, p]));
  assert.equal(by.Ana.workCents, 6000 + 1425);
  assert.equal(by.Ana.extraCents, 1000);
  assert.equal(by.Ana.netCents, 8425);
  assert.equal(by.Ana.jobCount, 2);
  assert.equal(by.Bo.workCents, 1425);
  assert.equal(by.Bo.backchargeCents, 4000);
  assert.equal(by.Bo.netCents, -2575);
  assert.equal(by.Teo.netCents, 0); // active people show even with no work
  assert.equal(w.totalCents, 8425 - 2575);
  assert.equal(w.workCents + w.extraCents - w.backchargeCents, w.totalCents);
  assert.equal(w.jobs.length, 2);
});

test('logged lines keep their rate when the rate card changes later', () => {
  const s = crew();
  E.saveJob(s, { date: '2026-11-24', name: 'Lot 3', lines: [{ task: 'Set post', unit: 'post', rate: 6, qty: 10, people: ['a'] }], adjustments: [] });
  s.rates[0].rate = 7;
  assert.equal(E.computeWeek(s, '2026-11-24').totalCents, 6000);
});

test('saving a job checks it and explains problems in plain words', () => {
  const s = crew();
  assert.throws(
    () => E.saveJob(s, { date: '2026-02-30', name: '', lines: [{ task: '', qty: '', rate: '', people: [] }], adjustments: [{ kind: 'extra', person: '', cents: 0 }] }),
    (err) => {
      for (const bit of ['Pick a date', 'Give the job a name', 'pick a task', 'quantity above 0', 'enter a rate', 'pick who did it', 'pick who it is for', 'amount above 0']) {
        assert.match(err.message, new RegExp(bit));
      }
      return true;
    }
  );
  assert.deepEqual(E.validateJob({ date: '2026-11-24', name: 'x', lines: [], adjustments: [] }, s), ['Add a task line, an extra or a back-charge.']);
  assert.match(E.validateJob({ date: '2026-11-24', name: 'x', lines: [{ task: 'Set post', qty: 1, rate: 6, people: ['ghost'] }], adjustments: [] }, s)[0], /no longer on the crew/);
  assert.equal(s.jobs.length, 0);
});

test('editing a job replaces it instead of adding a second copy', () => {
  const s = crew();
  const saved = E.saveJob(s, { date: '2026-11-24', name: 'Lot 4', lines: [{ task: 'Set post', unit: 'post', rate: 6, qty: 1, people: ['a'] }], adjustments: [] });
  E.saveJob(s, { ...saved, lines: [{ task: 'Set post', unit: 'post', rate: 6, qty: 2, people: ['a'] }] });
  assert.equal(s.jobs.length, 1);
  assert.equal(E.computeWeek(s, '2026-11-24').totalCents, 1200);
  E.deleteJob(s, saved.id);
  assert.equal(s.jobs.length, 0);
});

test('people: names are tidied, duplicates refused, "+" is reserved for splits', () => {
  const s = crew();
  assert.throws(() => E.addPerson(s, ' ana '), /already on the crew/);
  assert.throws(() => E.addPerson(s, '   '), /Type a name/);
  const p = E.addPerson(s, 'Lee  +  Kim');
  assert.equal(p.name, 'Lee & Kim');
  assert.equal(E.findPersonByName(s, 'LEE & KIM').id, p.id);
});

test('the sample crew is made up, adds up, and lands in the current week', () => {
  const s = E.sampleState('2026-11-26');
  assert.equal(s.sample, true);
  assert.equal(s.people.length, 3);
  for (const job of s.jobs) assert.deepEqual(E.validateJob(job, s), [], job.name);
  const w = E.computeWeek(s, '2026-11-26');
  assert.ok(w.jobs.length >= 3);
  assert.ok(w.totalCents > 0);
  assert.equal(w.people.reduce((t, p) => t + p.netCents, 0), w.totalCents);
});
