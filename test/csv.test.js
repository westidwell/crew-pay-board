'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

function base() {
  const s = E.emptyState();
  s.rates = [
    { id: 'post', name: 'Set post', unit: 'post', rate: 6 },
    { id: 'panel', name: 'Hang panel', unit: 'panel', rate: 9.5 },
    { id: 'fab', name: 'Chain link fabric', unit: 'ft', rate: 0.85 }
  ];
  return s;
}

function totalsByName(state, date) {
  return Object.fromEntries(
    E.computeWeek(state, date).people.map((p) => [p.name, [p.workCents, p.extraCents, p.backchargeCents, p.netCents, p.jobCount]])
  );
}

test('CSV reader handles quotes, commas, line breaks inside quotes, CRLF and a BOM', () => {
  const text = '﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\nlast,,\n';
  assert.deepEqual(E.parseCsv(text), [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', 'two\nlines'],
    ['last', '', '']
  ]);
  assert.deepEqual(E.parseCsv('a;b\n1,5;2'), [['a', 'b'], ['1,5', '2']]); // semicolon files
  assert.deepEqual(E.parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]); // tab files
  assert.throws(() => E.parseCsv('a,"b\n1,2'), /never closed/);
});

test('CSV writer quotes only when it must, and reads back the same', () => {
  const rows = [['plain', 'has,comma', 'has "quote"', 'two\nlines', ' padded ', '']];
  const csv = E.toCsv(rows);
  assert.equal(csv, 'plain,"has,comma","has ""quote""","two\nlines"," padded ",\r\n');
  assert.deepEqual(E.parseCsv(csv), rows);
});

test('importing jobs: grouping, rate card lookup, splits, extras, back-charges and notes', () => {
  const csv = [
    'date,job,kind,person,task,unit,qty,rate,amount,note',
    '2026-11-24,Lot 7,work,Ana+Bo,Set post,,18,,,',
    '2026-11-24,Lot 7,work,Teo,hang PANEL,,16,,152.00,',
    '2026-11-24,Lot 7,extra,Ana,,,,,25,Hand dug',
    '2026-11-24,Lot 7,backcharge,Teo,,,,,$15.00,Gate',
    '2026-11-24,Lot 7,note,,,,,,,Back run tomorrow',
    '11/25/2026,Pool fence,,Ana+Teo,Chain link fabric,ft,212.5,,,'
  ].join('\n');
  const before = base();
  const r = E.importJobsCsv(before, csv);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.jobsAdded, 2);
  assert.equal(r.linesAdded, 5); // 3 task lines + 2 extras/back-charges; notes aren't lines
  assert.deepEqual(r.peopleAdded, ['Ana', 'Bo', 'Teo']);
  assert.equal(before.jobs.length, 0, 'the state passed in is not changed');

  const lot7 = r.state.jobs.find((j) => j.name === 'Lot 7');
  assert.equal(lot7.lines.length, 2);
  assert.equal(lot7.lines[1].task, 'Hang panel', 'task name taken from the rate card');
  assert.equal(lot7.lines[1].rate, 9.5);
  assert.equal(lot7.notes, 'Back run tomorrow');
  assert.equal(lot7.adjustments[1].cents, 1500);

  const t = totalsByName(r.state, '2026-11-24');
  assert.deepEqual(t.Ana, [5400 + 9032, 2500, 0, 5400 + 9032 + 2500, 2]);
  assert.deepEqual(t.Bo, [5400, 0, 0, 5400, 1]);
  assert.deepEqual(t.Teo, [15200 + 9031, 0, 1500, 15200 + 9031 - 1500, 2]);
});

test('import column names are forgiving', () => {
  const csv = 'Date,Lot,Type,Who,Item,Quantity,Price,Notes\n2026-11-24,Lot 9,work,Ana,Fence stain,40,0.5,first coat\n';
  const r = E.importJobsCsv(base(), csv);
  assert.equal(r.jobsAdded, 1);
  assert.match(r.warnings[0], /not on the rate card; used the rate in the file/);
  const job = r.state.jobs[0];
  assert.equal(job.lines[0].rate, 0.5);
  assert.equal(job.notes, 'first coat');
  assert.equal(E.computeWeek(r.state, '2026-11-24').totalCents, 2000);
});

test('a job with any bad row is skipped whole, with the row number', () => {
  const csv = [
    'date,job,kind,person,task,qty,amount',
    '2026-11-24,Lot 1,work,Ana,Set post,10,',
    '2026-11-24,Lot 1,work,Ana,Mystery task,3,', // no rate anywhere
    '2026-11-24,Lot 2,work,Bo,Set post,two,', // bad qty
    '2026-11-24,Lot 3,work,,Set post,1,', // nobody
    '2026-11-24,Lot 4,extra,Ana+Bo,,,10', // extra for two people
    '2026-11-24,Lot 5,backcharge,Bo,,,0', // zero amount
    'someday,Lot 6,work,Ana,Set post,1,', // bad date
    '2026-11-24,Lot 7,weird,Ana,Set post,1,', // bad kind
    '2026-11-24,Lot 8,work,Ana,Set post,1,'
  ].join('\n');
  const r = E.importJobsCsv(base(), csv);
  assert.equal(r.jobsAdded, 1);
  assert.equal(r.state.jobs[0].name, 'Lot 8');
  assert.equal(r.errors.length, 7);
  assert.match(r.errors.join('\n'), /Row 3: task "Mystery task" is not on the rate card and the row has no rate/);
  assert.match(r.errors.join('\n'), /Row 4: quantity "two"/);
  assert.match(r.errors.join('\n'), /Row 8: date "someday"/);
  assert.match(r.warnings.join('\n'), /Skipped "Lot 1" on 2026-11-24 because of the problem in row 3/);
  assert.deepEqual(r.peopleAdded, ['Ana'], 'skipped jobs add nobody to the crew');
});

test('importing the same file twice never pays twice', () => {
  const csv = 'date,job,person,task,qty\n2026-11-24,Lot 1,Ana,Set post,10\n';
  const once = E.importJobsCsv(base(), csv);
  const twice = E.importJobsCsv(once.state, csv);
  assert.equal(twice.jobsAdded, 0);
  assert.match(twice.warnings[0], /already logged/);
  assert.equal(E.computeWeek(twice.state, '2026-11-24').totalCents, 6000);
});

test('an amount that does not match qty x rate is flagged and qty x rate wins', () => {
  const r = E.importJobsCsv(base(), 'date,job,person,task,qty,amount\n2026-11-24,Lot 1,Ana,Set post,10,65.00\n');
  assert.match(r.warnings[0], /amount \$65.00 does not match qty x rate \(\$60.00\)/);
  assert.equal(E.computeWeek(r.state, '2026-11-24').totalCents, 6000);
});

test('import refuses files without date and job columns', () => {
  assert.throws(() => E.importJobsCsv(base(), 'who,what\nAna,posts\n'), /at least "date" and "job"/);
  assert.throws(() => E.importJobsCsv(base(), ''), /empty/);
});

test('week CSV export then import gives back the same pay (round trip)', () => {
  const s = E.sampleState('2026-11-26');
  s.jobs[0].name = '=SUM(A1) Lot'; // text that looks like a spreadsheet formula
  s.jobs[1].adjustments[0].note = '+ hand dug, "two" posts';
  const week = E.exportWeekCsv(s, '2026-11-26');
  assert.match(week, /'=SUM\(A1\) Lot/, 'formula-looking text is defused for spreadsheets');

  const fresh = E.emptyState();
  fresh.rates = E.clone(s.rates);
  const r = E.importJobsCsv(fresh, week);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.jobsAdded, E.computeWeek(s, '2026-11-26').jobs.length);
  assert.deepEqual(totalsByName(r.state, '2026-11-26'), totalsByName(s, '2026-11-26'));
  assert.ok(r.state.jobs.some((j) => j.name === '=SUM(A1) Lot'), 'the name comes back as typed');
  assert.ok(r.state.jobs.some((j) => j.adjustments.some((a) => a.note === '+ hand dug, "two" posts')));
  assert.ok(r.state.jobs.some((j) => j.notes === 'Side yard done; back run tomorrow'));

  // and exporting the imported week gives the same file
  assert.equal(E.exportWeekCsv(r.state, '2026-11-26'), week);
});

test('the week CSV only holds that week; the all-jobs CSV holds everything', () => {
  const s = E.sampleState('2026-11-26');
  const weekRows = E.parseCsv(E.exportWeekCsv(s, '2026-11-26')).slice(1);
  const wk = E.weekOf('2026-11-26', 'mon');
  assert.ok(weekRows.length > 0);
  for (const row of weekRows) assert.ok(row[0] >= wk.start && row[0] <= wk.end, row[0]);
  const allDates = new Set(E.parseCsv(E.exportAllJobsCsv(s)).slice(1).map((r) => r[0]));
  assert.equal(allDates.size, new Set(s.jobs.map((j) => j.date)).size);
});

test('totals CSV has one row per person plus a crew total that adds up', () => {
  const s = E.sampleState('2026-11-26');
  const rows = E.parseCsv(E.exportWeekTotalsCsv(s, '2026-11-26'));
  assert.deepEqual(rows[0], ['person', 'week_start', 'week_end', 'jobs', 'piece_work', 'extras', 'backcharges', 'net_pay']);
  const people = rows.slice(1, -1);
  const total = rows[rows.length - 1];
  assert.equal(total[0], 'CREW TOTAL');
  const sum = people.reduce((t, r) => t + E.toCents(r[7]), 0);
  assert.equal(sum, E.toCents(total[7]));
  assert.equal(E.toCents(total[7]), E.computeWeek(s, '2026-11-26').totalCents);
});

test('the CSV template imports cleanly', () => {
  const r = E.importJobsCsv(base(), E.csvTemplate());
  assert.deepEqual(r.errors, []);
  assert.equal(r.jobsAdded, 1);
  const w = E.computeWeek(r.state, '2026-03-02');
  assert.equal(w.totalCents, 8400 + 11400 + 2500 - 1500);
});
