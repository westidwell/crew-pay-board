/*
 * Crew Pay Board engine.
 * Pure functions shared by the page (index.html) and the Node tests.
 * No DOM, no storage, no network. Money is handled as whole cents.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrewPay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var APP_ID = 'crew-pay-board';
  var DATA_VERSION = 1;
  var RATE_DECIMALS = 4; // rates keep up to 4 decimals ($0.0850 per sq ft)
  var QTY_DECIMALS = 3; // quantities keep up to 3 decimals (12.125 ft)

  // ---------------------------------------------------------------------------
  // Exact decimal math (BigInt) so 0.1 + 0.2 style float errors never reach pay.
  // ---------------------------------------------------------------------------

  function decimalString(value) {
    if (typeof value === 'number') {
      if (!isFinite(value)) throw new Error('Not a number: ' + value);
      var s = String(value);
      if (/e/i.test(s)) s = value.toFixed(12);
      return s;
    }
    var t = String(value == null ? '' : value).trim().replace(/[$,\s]/g, '');
    var paren = /^\((.*)\)$/.exec(t); // accounting style (12.50) means negative
    if (paren) t = '-' + paren[1];
    return t;
  }

  /** Parse a number or numeric text into a BigInt scaled by 10^decimals, rounding half away from zero. */
  function toScaled(value, decimals) {
    var s = decimalString(value);
    var m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[2] === '' && !m[3])) throw new Error('Not a number: "' + value + '"');
    var neg = m[1] === '-';
    var frac = m[3] || '';
    var kept = (frac + '0'.repeat(decimals)).slice(0, decimals);
    var next = frac.length > decimals ? frac.charCodeAt(decimals) - 48 : 0;
    var n = BigInt((m[2] || '0') + kept);
    if (next >= 5) n += BigInt(1);
    return neg ? -n : n;
  }

  function divRoundHalfAway(n, d) {
    var q = n / d;
    var r = n % d;
    if (r < 0) r = -r;
    if (r * BigInt(2) >= d) q += n < 0 ? BigInt(-1) : BigInt(1);
    return q;
  }

  /** Read a number, or return null when it is blank or not a number. */
  function parseNumber(value) {
    if (value == null) return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    var s = decimalString(value);
    if (s === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    return Number(s);
  }

  /** Dollars (number or text like "$1,234.50") to whole cents. */
  function toCents(value) {
    return Number(toScaled(value, 2));
  }

  /** Same as toCents but returns null instead of throwing. */
  function parseCents(value) {
    if (parseNumber(value) === null) return null;
    return toCents(value);
  }

  /** Pay for one line: quantity x rate, rounded to the cent (half away from zero). */
  function lineCents(qty, rate) {
    var q = toScaled(qty, QTY_DECIMALS);
    var r = toScaled(rate, RATE_DECIMALS);
    var scale = BigInt(10) ** BigInt(QTY_DECIMALS + RATE_DECIMALS - 2);
    return Number(divRoundHalfAway(q * r, scale));
  }

  /** Split cents across n people so the parts add back up exactly. Extra pennies go to the first names. */
  function splitCents(cents, n) {
    if (!(n >= 1)) return [];
    var abs = Math.abs(cents);
    var base = Math.floor(abs / n);
    var rem = abs - base * n;
    var out = [];
    for (var i = 0; i < n; i++) {
      var v = base + (i < rem ? 1 : 0);
      out.push(cents < 0 && v ? -v : v);
    }
    return out;
  }

  function groupThousands(s) {
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** 123456 -> "$1,234.56", -1550 -> "-$15.50" */
  function fmtMoney(cents) {
    var c = Math.round(cents) || 0;
    var abs = Math.abs(c);
    var body = groupThousands(String(Math.floor(abs / 100))) + '.' + String(abs % 100).padStart(2, '0');
    return (c < 0 ? '-$' : '$') + body;
  }

  /** 123450 -> "1234.50" (for CSV files) */
  function centsToDecimal(cents) {
    var c = Math.round(cents) || 0;
    var abs = Math.abs(c);
    return (c < 0 ? '-' : '') + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
  }

  function scaledToText(n, decimals, minDecimals) {
    var neg = n < 0;
    if (neg) n = -n;
    var s = n.toString().padStart(decimals + 1, '0');
    var whole = s.slice(0, s.length - decimals);
    var frac = s.slice(s.length - decimals).replace(/0+$/, '');
    while (frac.length < minDecimals) frac += '0';
    return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
  }

  /** 6 -> "6.00", 0.085 -> "0.085" */
  function fmtRate(rate) {
    return scaledToText(toScaled(rate, RATE_DECIMALS), RATE_DECIMALS, 2);
  }

  /** 12 -> "12", 12.5 -> "12.5" */
  function fmtQty(qty) {
    return scaledToText(toScaled(qty, QTY_DECIMALS), QTY_DECIMALS, 0);
  }

  // ---------------------------------------------------------------------------
  // Dates. Everything is a plain "YYYY-MM-DD" string; math runs in UTC so
  // daylight-saving changes never shift a day.
  // ---------------------------------------------------------------------------

  var DAY_MS = 86400000;
  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEK_STARTS = { mon: 1, sun: 0 };

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function isISODate(s) {
    var m = ISO_RE.exec(String(s));
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  function toUTC(iso) {
    if (!isISODate(iso)) throw new Error('Bad date "' + iso + '" (use YYYY-MM-DD)');
    var m = ISO_RE.exec(iso);
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }

  function fromUTC(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function addDays(iso, n) {
    return fromUTC(toUTC(iso) + n * DAY_MS);
  }

  /** 0 = Sunday ... 6 = Saturday */
  function dayOfWeek(iso) {
    return new Date(toUTC(iso)).getUTCDay();
  }

  /** First day of the pay week holding iso. weekStart is "mon" or "sun". */
  function weekStartOf(iso, weekStart) {
    var first = WEEK_STARTS[weekStart] === undefined ? 1 : WEEK_STARTS[weekStart];
    return addDays(iso, -((dayOfWeek(iso) - first + 7) % 7));
  }

  function weekOf(iso, weekStart) {
    var start = weekStartOf(iso, weekStart);
    var days = [];
    for (var i = 0; i < 7; i++) days.push(addDays(start, i));
    return { start: start, end: days[6], days: days };
  }

  /** Today's date on this device, as YYYY-MM-DD. */
  function localISO(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** Accepts 2026-11-24, 2026/11/24, 11/24/2026 and 11/24/26 (US month first). Returns YYYY-MM-DD or null. */
  function parseLooseDate(text) {
    var s = String(text == null ? '' : text).trim();
    var m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(s);
    var iso = null;
    if (m) iso = m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (m) iso = (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2(+m[1]) + '-' + pad2(+m[2]);
    return iso && isISODate(iso) ? iso : null;
  }

  /** "Tue Nov 24" */
  function fmtDay(iso) {
    var m = ISO_RE.exec(iso);
    return DAY_NAMES[dayOfWeek(iso)] + ' ' + MONTH_NAMES[+m[2] - 1] + ' ' + +m[3];
  }

  /** "Mon Nov 23 - Sun Nov 29, 2026" */
  function fmtRange(start, end) {
    return fmtDay(start) + ' – ' + fmtDay(end) + ', ' + end.slice(0, 4);
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  var idCounter = 0;
  function makeId(prefix) {
    idCounter = (idCounter + 1) % 1679616;
    return (prefix || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + idCounter.toString(36);
  }

  function str(v) {
    return v == null ? '' : String(v);
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }
  function isObj(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }
  function num(v) {
    var n = parseNumber(v);
    return n === null ? 0 : n;
  }
  function uniq(list) {
    var seen = {};
    return list.filter(function (x) {
      if (seen[x]) return false;
      seen[x] = true;
      return true;
    });
  }
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function emptyState() {
    return {
      app: APP_ID,
      version: DATA_VERSION,
      sample: false,
      settings: { crewName: '', weekStart: 'mon' },
      rates: [],
      people: [],
      jobs: []
    };
  }

  /** Person names can't hold "+" because the CSV uses it to join names on a split line. */
  function cleanPersonName(name) {
    return str(name).replace(/\+/g, '&').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  /** Check and tidy anything that claims to be saved data. Throws on things that are clearly not ours. */
  function normalizeState(input) {
    if (!isObj(input)) throw new Error('That is not Crew Pay Board data.');
    var s = emptyState();
    var st = isObj(input.settings) ? input.settings : {};
    s.sample = input.sample === true;
    s.settings.crewName = str(st.crewName).trim().slice(0, 80);
    s.settings.weekStart = st.weekStart === 'sun' ? 'sun' : 'mon';
    s.rates = arr(input.rates)
      .filter(isObj)
      .map(function (r) {
        return {
          id: str(r.id) || makeId('r'),
          name: str(r.name).trim().slice(0, 80),
          unit: str(r.unit).trim().slice(0, 20) || 'each',
          rate: Math.max(0, num(r.rate))
        };
      })
      .filter(function (r) {
        return r.name;
      });
    s.people = arr(input.people)
      .filter(isObj)
      .map(function (p) {
        return { id: str(p.id) || makeId('p'), name: cleanPersonName(p.name), active: p.active !== false };
      })
      .filter(function (p) {
        return p.name;
      });
    s.jobs = arr(input.jobs)
      .filter(function (j) {
        return isObj(j) && isISODate(j.date);
      })
      .map(function (j) {
        return {
          id: str(j.id) || makeId('j'),
          date: j.date,
          name: str(j.name).trim().slice(0, 120),
          notes: str(j.notes),
          lines: arr(j.lines)
            .filter(isObj)
            .map(function (l) {
              return {
                id: str(l.id) || makeId('l'),
                task: str(l.task).trim(),
                unit: str(l.unit).trim() || 'each',
                rate: Math.max(0, num(l.rate)),
                qty: Math.max(0, num(l.qty)),
                people: uniq(arr(l.people).map(str).filter(Boolean))
              };
            }),
          adjustments: arr(j.adjustments)
            .filter(isObj)
            .map(function (a) {
              return {
                id: str(a.id) || makeId('a'),
                kind: a.kind === 'backcharge' ? 'backcharge' : 'extra',
                person: str(a.person),
                cents: Math.abs(Math.round(num(a.cents))),
                note: str(a.note)
              };
            })
        };
      });
    return s;
  }

  function indexById(list) {
    var out = {};
    list.forEach(function (x) {
      out[x.id] = x;
    });
    return out;
  }

  function findRate(state, nameOrId) {
    var key = str(nameOrId).trim().toLowerCase();
    if (!key) return null;
    for (var i = 0; i < state.rates.length; i++) {
      var r = state.rates[i];
      if (r.id === nameOrId || r.name.toLowerCase() === key) return r;
    }
    return null;
  }

  function findPersonByName(state, name) {
    var key = cleanPersonName(name).toLowerCase();
    for (var i = 0; i < state.people.length; i++) {
      if (state.people[i].name.toLowerCase() === key) return state.people[i];
    }
    return null;
  }

  function addPerson(state, name) {
    var clean = cleanPersonName(name);
    if (!clean) throw new Error('Type a name.');
    if (findPersonByName(state, clean)) throw new Error(clean + ' is already on the crew.');
    var p = { id: makeId('p'), name: clean, active: true };
    state.people.push(p);
    return p;
  }

  function jobsForPerson(state, personId) {
    return state.jobs.filter(function (j) {
      return (
        j.lines.some(function (l) {
          return l.people.indexOf(personId) >= 0;
        }) ||
        j.adjustments.some(function (a) {
          return a.person === personId;
        })
      );
    });
  }

  /** Problems that would stop a job from being saved, in plain words. Empty list means it's good. */
  function validateJob(job, state) {
    var errs = [];
    var people = indexById(state ? state.people : []);
    if (!isISODate(job.date)) errs.push('Pick a date.');
    if (!str(job.name).trim()) errs.push('Give the job a name or lot number.');
    if (!arr(job.lines).length && !arr(job.adjustments).length) errs.push('Add a task line, an extra or a back-charge.');
    arr(job.lines).forEach(function (l, i) {
      var tag = 'Line ' + (i + 1) + ': ';
      if (!str(l.task).trim()) errs.push(tag + 'pick a task.');
      var qty = parseNumber(l.qty);
      var rate = parseNumber(l.rate);
      if (qty === null || qty <= 0) errs.push(tag + 'enter a quantity above 0.');
      if (rate === null || rate < 0) errs.push(tag + 'enter a rate (0 or more).');
      if (!arr(l.people).length) errs.push(tag + 'pick who did it.');
      arr(l.people).forEach(function (pid) {
        if (state && !people[pid]) errs.push(tag + 'someone on this line is no longer on the crew.');
      });
    });
    arr(job.adjustments).forEach(function (a, i) {
      var tag = (a.kind === 'backcharge' ? 'Back-charge ' : 'Extra ') + (i + 1) + ': ';
      if (!a.person) errs.push(tag + 'pick who it is for.');
      else if (state && !people[a.person]) errs.push(tag + 'that person is no longer on the crew.');
      if (!(a.cents > 0)) errs.push(tag + 'enter an amount above 0.');
    });
    return errs;
  }

  /** Add or replace a job (matched by id). Returns the saved job. Throws with the problems if it isn't valid. */
  function saveJob(state, job) {
    var errs = validateJob(job, state);
    if (errs.length) throw new Error(errs.join('\n'));
    var clean = normalizeState({ jobs: [job] }).jobs[0];
    clean.id = job.id || clean.id;
    var at = -1;
    for (var i = 0; i < state.jobs.length; i++) if (state.jobs[i].id === clean.id) at = i;
    if (at >= 0) state.jobs[at] = clean;
    else state.jobs.push(clean);
    return clean;
  }

  function deleteJob(state, jobId) {
    state.jobs = state.jobs.filter(function (j) {
      return j.id !== jobId;
    });
  }

  function byDateThenName(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.name.localeCompare(b.name);
  }

  /** Money for one job: each line's pay, how it splits, and each person's share. */
  function jobBreakdown(job) {
    var byPerson = {};
    function bucket(pid) {
      if (!byPerson[pid]) byPerson[pid] = { work: 0, extra: 0, backcharge: 0, net: 0 };
      return byPerson[pid];
    }
    var lines = job.lines.map(function (l) {
      var cents = lineCents(l.qty, l.rate);
      var shares = splitCents(cents, l.people.length);
      l.people.forEach(function (pid, i) {
        bucket(pid).work += shares[i];
      });
      return { line: l, cents: cents, shares: shares };
    });
    var total = lines.reduce(function (sum, x) {
      return sum + x.cents;
    }, 0);
    job.adjustments.forEach(function (a) {
      var b = bucket(a.person);
      if (a.kind === 'backcharge') {
        b.backcharge += a.cents;
        total -= a.cents;
      } else {
        b.extra += a.cents;
        total += a.cents;
      }
    });
    Object.keys(byPerson).forEach(function (pid) {
      var b = byPerson[pid];
      b.net = b.work + b.extra - b.backcharge;
    });
    return { totalCents: total, lines: lines, byPerson: byPerson };
  }

  /**
   * Everything for one pay week: per-person lines, extras, back-charges and net pay.
   * anyDate can be any day inside the week.
   */
  function computeWeek(state, anyDate) {
    var wk = weekOf(anyDate, state.settings.weekStart);
    var people = indexById(state.people);
    var jobs = state.jobs
      .filter(function (j) {
        return j.date >= wk.start && j.date <= wk.end;
      })
      .sort(byDateThenName);
    var rows = {};
    var order = [];
    function row(pid) {
      if (!rows[pid]) {
        var p = people[pid];
        rows[pid] = {
          personId: pid,
          name: p ? p.name : '(removed)',
          active: p ? p.active : false,
          items: [],
          adjustments: [],
          workCents: 0,
          extraCents: 0,
          backchargeCents: 0,
          netCents: 0,
          jobCount: 0,
          _jobs: {}
        };
        order.push(pid);
      }
      return rows[pid];
    }
    state.people.forEach(function (p) {
      if (p.active) row(p.id);
    });
    var unassigned = [];
    jobs.forEach(function (job) {
      jobBreakdown(job).lines.forEach(function (x) {
        var l = x.line;
        if (!l.people.length) {
          unassigned.push({ date: job.date, jobId: job.id, job: job.name, task: l.task, cents: x.cents });
          return;
        }
        l.people.forEach(function (pid, i) {
          var r = row(pid);
          r.items.push({
            date: job.date,
            jobId: job.id,
            job: job.name,
            task: l.task,
            unit: l.unit,
            qty: l.qty,
            rate: l.rate,
            lineCents: x.cents,
            cents: x.shares[i],
            splitWith: l.people.length
          });
          r.workCents += x.shares[i];
          r._jobs[job.id] = true;
        });
      });
      job.adjustments.forEach(function (a) {
        var r = row(a.person);
        r.adjustments.push({ date: job.date, jobId: job.id, job: job.name, kind: a.kind, note: a.note, cents: a.cents });
        if (a.kind === 'backcharge') r.backchargeCents += a.cents;
        else r.extraCents += a.cents;
        r._jobs[job.id] = true;
      });
    });
    var list = order.map(function (pid) {
      var r = rows[pid];
      r.netCents = r.workCents + r.extraCents - r.backchargeCents;
      r.jobCount = Object.keys(r._jobs).length;
      delete r._jobs;
      return r;
    });
    function sum(key) {
      return list.reduce(function (s, r) {
        return s + r[key];
      }, 0);
    }
    return {
      start: wk.start,
      end: wk.end,
      days: wk.days,
      jobs: jobs,
      people: list,
      workCents: sum('workCents'),
      extraCents: sum('extraCents'),
      backchargeCents: sum('backchargeCents'),
      totalCents: sum('netCents'),
      unassigned: unassigned
    };
  }

  // ---------------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------------

  var CSV_HEADERS = ['date', 'job', 'kind', 'person', 'task', 'unit', 'qty', 'rate', 'amount', 'note'];
  var HEADER_ALIASES = {
    day: 'date',
    workdate: 'date',
    jobname: 'job',
    lot: 'job',
    site: 'job',
    type: 'kind',
    who: 'person',
    people: 'person',
    worker: 'person',
    name: 'person',
    item: 'task',
    quantity: 'qty',
    price: 'rate',
    total: 'amount',
    notes: 'note',
    memo: 'note'
  };

  function detectDelimiter(text) {
    var first = text.split(/\r?\n/, 1)[0] || '';
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var q = false;
    for (var i = 0; i < first.length; i++) {
      var c = first[i];
      if (c === '"') q = !q;
      else if (!q && counts[c] !== undefined) counts[c]++;
    }
    if (counts[','] === 0 && counts[';'] > 0) return ';';
    if (counts[','] === 0 && counts['\t'] > 0) return '\t';
    return ',';
  }

  /** RFC 4180 CSV reader: quotes, doubled quotes, commas and line breaks inside quotes, CRLF, BOM. */
  function parseCsv(text) {
    text = str(text);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var delim = detectDelimiter(text);
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var n = text.length;
    function endField() {
      row.push(field);
      field = '';
    }
    function endRow() {
      endField();
      rows.push(row);
      row = [];
    }
    while (i < n) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') inQuotes = true;
      else if (c === delim) endField();
      else if (c === '\n') endRow();
      else if (c === '\r') {
        if (text[i + 1] === '\n') i++;
        endRow();
      } else field += c;
      i++;
    }
    if (inQuotes) throw new Error('The CSV has a quote (") that is never closed.');
    if (field !== '' || row.length) endRow();
    return rows.filter(function (r) {
      return !(r.length === 1 && r[0].trim() === '');
    });
  }

  function csvCell(v) {
    var s = str(v);
    return /[",\r\n;]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows) {
    return (
      rows
        .map(function (r) {
          return r.map(csvCell).join(',');
        })
        .join('\r\n') + '\r\n'
    );
  }

  /** Stop spreadsheet apps from running text that starts like a formula. Undone on import. */
  function safeText(s) {
    s = str(s);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  function unsafeText(s) {
    s = str(s);
    return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
  }

  function personName(people, pid) {
    return people[pid] ? people[pid].name : '(removed)';
  }

  /** One row per task line, extra, back-charge and job note. Lines done by several people list them joined by "+". */
  function jobsToRows(state, jobs) {
    var people = indexById(state.people);
    var rows = [CSV_HEADERS.slice()];
    jobs
      .slice()
      .sort(byDateThenName)
      .forEach(function (job) {
        var name = safeText(job.name);
        job.lines.forEach(function (l) {
          rows.push([
            job.date,
            name,
            'work',
            safeText(
              l.people
                .map(function (pid) {
                  return personName(people, pid);
                })
                .join('+')
            ),
            safeText(l.task),
            safeText(l.unit),
            fmtQty(l.qty),
            fmtRate(l.rate),
            centsToDecimal(lineCents(l.qty, l.rate)),
            ''
          ]);
        });
        job.adjustments.forEach(function (a) {
          rows.push([job.date, name, a.kind, safeText(personName(people, a.person)), '', '', '', '', centsToDecimal(a.cents), safeText(a.note)]);
        });
        if (job.notes) rows.push([job.date, name, 'note', '', '', '', '', '', '', safeText(job.notes)]);
      });
    return rows;
  }

  function jobsInWeek(state, anyDate) {
    var wk = weekOf(anyDate, state.settings.weekStart);
    return state.jobs.filter(function (j) {
      return j.date >= wk.start && j.date <= wk.end;
    });
  }

  /** The week's jobs as CSV, in the same format importJobsCsv reads. */
  function exportWeekCsv(state, anyDate) {
    return toCsv(jobsToRows(state, jobsInWeek(state, anyDate)));
  }

  function exportAllJobsCsv(state) {
    return toCsv(jobsToRows(state, state.jobs));
  }

  /** One row per person with the week's totals, plus a crew total row. */
  function exportWeekTotalsCsv(state, anyDate) {
    var w = computeWeek(state, anyDate);
    var rows = [['person', 'week_start', 'week_end', 'jobs', 'piece_work', 'extras', 'backcharges', 'net_pay']];
    w.people.forEach(function (p) {
      rows.push([
        safeText(p.name),
        w.start,
        w.end,
        String(p.jobCount),
        centsToDecimal(p.workCents),
        centsToDecimal(p.extraCents),
        centsToDecimal(p.backchargeCents),
        centsToDecimal(p.netCents)
      ]);
    });
    rows.push([
      'CREW TOTAL',
      w.start,
      w.end,
      String(w.jobs.length),
      centsToDecimal(w.workCents),
      centsToDecimal(w.extraCents),
      centsToDecimal(w.backchargeCents),
      centsToDecimal(w.totalCents)
    ]);
    return toCsv(rows);
  }

  /** A starter file showing every kind of row. */
  function csvTemplate() {
    return toCsv([
      CSV_HEADERS,
      ['2026-03-02', 'Lot 5 - Example Acres', 'work', 'Ana+Bo', 'Set post', 'post', '14', '6.00', '', ''],
      ['2026-03-02', 'Lot 5 - Example Acres', 'work', 'Teo', 'Hang panel', 'panel', '12', '9.50', '', ''],
      ['2026-03-02', 'Lot 5 - Example Acres', 'extra', 'Teo', '', '', '', '', '25.00', 'Hand-dug two posts by the gas line'],
      ['2026-03-02', 'Lot 5 - Example Acres', 'backcharge', 'Bo', '', '', '', '', '15.00', 'Re-hung crooked gate'],
      ['2026-03-02', 'Lot 5 - Example Acres', 'note', '', '', '', '', '', '', 'Owner wants the gate latch on the left']
    ]);
  }

  function normalizeKind(kind, task) {
    var k = str(kind)
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    if (!k) return str(task).trim() ? 'work' : null;
    if (k === 'work' || k === 'task' || k === 'piece' || k === 'line') return 'work';
    if (k === 'extra' || k === 'extras' || k === 'bonus' || k === 'add') return 'extra';
    if (k === 'backcharge' || k === 'backcharges' || k === 'bc' || k === 'deduct' || k === 'deduction' || k === 'chargeback') return 'backcharge';
    if (k === 'note' || k === 'notes') return 'note';
    return null;
  }

  /**
   * Read jobs from CSV text and return a NEW state with them added (the input state is not changed),
   * plus counts, problems (rows that stop a job from importing) and warnings.
   * Rows with the same date and job name become one job. A job whose rows have any problem is skipped
   * whole, so nobody is paid for half a job. A job already logged with the same date and name is
   * skipped, so importing the same file twice never pays twice.
   */
  function importJobsCsv(state, text) {
    var rows = parseCsv(text);
    if (!rows.length) throw new Error('The file is empty.');
    var col = {};
    rows[0].forEach(function (h, i) {
      var key = unsafeText(h)
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, '');
      key = HEADER_ALIASES[key] || key;
      if (CSV_HEADERS.indexOf(key) >= 0 && col[key] === undefined) col[key] = i;
    });
    if (col.date === undefined || col.job === undefined) {
      throw new Error('The first row must be column names, with at least "date" and "job". Download the CSV template to see the format.');
    }
    var next = clone(state);
    var errors = [];
    var warnings = [];
    var groups = {};
    var order = [];

    rows.slice(1).forEach(function (r, idx) {
      var rowNo = idx + 2;
      function get(name) {
        return col[name] === undefined ? '' : unsafeText(str(r[col[name]]).trim());
      }
      if (
        r.every(function (c) {
          return !str(c).trim();
        })
      )
        return;
      var date = parseLooseDate(get('date'));
      if (!date) {
        errors.push('Row ' + rowNo + ': date "' + get('date') + '" not understood (use YYYY-MM-DD).');
        return;
      }
      var jobName = get('job');
      if (!jobName) {
        errors.push('Row ' + rowNo + ': the job name is empty.');
        return;
      }
      var key = date + '|' + jobName.toLowerCase();
      var g = groups[key];
      if (!g) {
        g = groups[key] = { date: date, name: jobName, notes: [], lines: [], adjustments: [], bad: [] };
        order.push(key);
      }
      function bad(msg) {
        var full = 'Row ' + rowNo + ': ' + msg;
        errors.push(full);
        g.bad.push(rowNo);
      }
      var kind = normalizeKind(get('kind'), get('task'));
      if (!kind) return bad('kind "' + get('kind') + '" should be work, extra, backcharge or note.');

      if (kind === 'note') {
        if (get('note')) g.notes.push(get('note'));
        return;
      }

      if (kind === 'work') {
        var task = get('task');
        if (!task) return bad('work rows need a task.');
        var qty = parseNumber(get('qty'));
        if (qty === null || qty <= 0) return bad('quantity "' + get('qty') + '" should be a number above 0.');
        var card = findRate(next, task);
        var rate;
        if (get('rate') !== '') {
          rate = parseNumber(get('rate'));
          if (rate === null || rate < 0) return bad('rate "' + get('rate') + '" should be a number.');
        } else if (card) rate = card.rate;
        else return bad('task "' + task + '" is not on the rate card and the row has no rate.');
        if (!card) warnings.push('Row ' + rowNo + ': task "' + task + '" is not on the rate card; used the rate in the file.');
        var names = get('person')
          .split('+')
          .map(cleanPersonName)
          .filter(Boolean);
        if (!names.length) return bad('who did it? The person column is empty.');
        var amount = get('amount');
        if (amount !== '') {
          var given = parseCents(amount);
          var calc = lineCents(qty, rate);
          if (given !== null && given !== calc) {
            warnings.push('Row ' + rowNo + ': amount ' + fmtMoney(given) + ' does not match qty x rate (' + fmtMoney(calc) + '); used qty x rate.');
          }
        }
        if (get('note')) g.notes.push(get('note'));
        g.lines.push({
          task: card ? card.name : task,
          unit: get('unit') || (card ? card.unit : 'each'),
          rate: rate,
          qty: qty,
          names: names
        });
        return;
      }

      var who = cleanPersonName(get('person'));
      if (!who) return bad('who is this ' + (kind === 'extra' ? 'extra' : 'back-charge') + ' for? The person column is empty.');
      if (get('person').indexOf('+') >= 0) return bad('an extra or back-charge is for one person; put each on its own row.');
      var cents = parseCents(get('amount'));
      if (cents === null || cents === 0) return bad('amount "' + get('amount') + '" should be a number above 0.');
      g.adjustments.push({ kind: kind, name: who, cents: Math.abs(cents), note: get('note') });
    });

    var added = [];
    var peopleAdded = [];
    var linesAdded = 0;
    function personId(name) {
      var p = findPersonByName(next, name);
      if (!p) {
        p = addPerson(next, name);
        peopleAdded.push(p.name);
      }
      return p.id;
    }
    order.forEach(function (key) {
      var g = groups[key];
      var label = '"' + g.name + '" on ' + g.date;
      if (g.bad.length) {
        warnings.push('Skipped ' + label + ' because of the problem' + (g.bad.length > 1 ? 's' : '') + ' in row ' + g.bad.join(', ') + '.');
        return;
      }
      if (!g.lines.length && !g.adjustments.length) {
        warnings.push('Skipped ' + label + ': it has no work, extra or back-charge rows.');
        return;
      }
      var dup = next.jobs.some(function (j) {
        return j.date === g.date && j.name.toLowerCase() === g.name.toLowerCase();
      });
      if (dup) {
        warnings.push('Skipped ' + label + ': a job with that name and date is already logged. Delete it first to import it again.');
        return;
      }
      var job = {
        id: makeId('j'),
        date: g.date,
        name: g.name,
        notes: g.notes.join('; '),
        lines: g.lines.map(function (l) {
          return { id: makeId('l'), task: l.task, unit: l.unit, rate: l.rate, qty: l.qty, people: uniq(l.names.map(personId)) };
        }),
        adjustments: g.adjustments.map(function (a) {
          return { id: makeId('a'), kind: a.kind, person: personId(a.name), cents: a.cents, note: a.note };
        })
      };
      next.jobs.push(job);
      added.push(job);
      linesAdded += job.lines.length + job.adjustments.length;
    });
    if (added.length) next.sample = false;
    return { state: next, jobsAdded: added.length, linesAdded: linesAdded, peopleAdded: peopleAdded, errors: errors, warnings: warnings };
  }

  // ---------------------------------------------------------------------------
  // Backup and restore
  // ---------------------------------------------------------------------------

  function exportBackup(state, now) {
    return JSON.stringify(
      { app: APP_ID, kind: 'backup', version: DATA_VERSION, exportedAt: (now || new Date()).toISOString(), data: state },
      null,
      2
    );
  }

  /** Read a backup file's text. Returns { state, exportedAt }. Throws a plain-words error if it isn't one. */
  function importBackup(text) {
    var obj;
    try {
      obj = JSON.parse(str(text).replace(/^﻿/, ''));
    } catch (e) {
      throw new Error('That file is not a Crew Pay Board backup (it is not JSON).');
    }
    var data = null;
    if (isObj(obj) && obj.app === APP_ID && isObj(obj.data)) data = obj.data;
    else if (isObj(obj) && Array.isArray(obj.jobs) && Array.isArray(obj.rates)) data = obj;
    if (!data) throw new Error('That file is not a Crew Pay Board backup.');
    if ((obj.version || data.version || 1) > DATA_VERSION) {
      throw new Error('This backup was made by a newer version of Crew Pay Board. Update the page, then restore again.');
    }
    return { state: normalizeState(data), exportedAt: str(obj.exportedAt) };
  }

  // ---------------------------------------------------------------------------
  // Sample data: a made-up fence crew so the board isn't empty on first open.
  // ---------------------------------------------------------------------------

  function sampleState(today) {
    today = today || localISO();
    var s = emptyState();
    s.sample = true;
    s.settings.crewName = 'Sample Fence Crew';
    s.rates = [
      { id: 'r_post', name: 'Set post', unit: 'post', rate: 6 },
      { id: 'r_panel', name: 'Hang panel', unit: 'panel', rate: 9.5 },
      { id: 'r_chain', name: 'Chain link fabric', unit: 'ft', rate: 0.85 },
      { id: 'r_gate', name: 'Gate install', unit: 'gate', rate: 35 },
      { id: 'r_tear', name: 'Tear-out old fence', unit: 'ft', rate: 1.25 },
      { id: 'r_haul', name: 'Haul-off load', unit: 'load', rate: 20 }
    ];
    s.people = [
      { id: 'p_ana', name: 'Ana', active: true },
      { id: 'p_bo', name: 'Bo', active: true },
      { id: 'p_teo', name: 'Teo', active: true }
    ];
    function line(rateId, qty, people) {
      var r = findRate(s, rateId);
      return { id: makeId('l'), task: r.name, unit: r.unit, rate: r.rate, qty: qty, people: people };
    }
    function job(offset, name, lines, adjustments, notes) {
      return {
        id: makeId('j'),
        date: addDays(today, -offset),
        name: name,
        notes: notes || '',
        lines: lines,
        adjustments: adjustments || []
      };
    }
    s.jobs = [
      job(0, 'Lot 7 - Sample Ridge', [line('r_post', 18, ['p_ana', 'p_bo']), line('r_panel', 16, ['p_teo'])], [], 'Side yard done; back run tomorrow'),
      job(1, 'Lot 12 - Sample Ridge', [line('r_tear', 140, ['p_bo']), line('r_haul', 2, ['p_bo']), line('r_post', 11, ['p_ana'])], [
        { id: makeId('a'), kind: 'extra', person: 'p_ana', cents: 2500, note: 'Hand-dug two posts by the gas line' }
      ]),
      job(2, 'Pool fence - Example Park', [line('r_chain', 212.5, ['p_ana', 'p_teo']), line('r_gate', 1, ['p_teo'])], [
        { id: makeId('a'), kind: 'backcharge', person: 'p_teo', cents: 1500, note: 'Re-hung gate that would not latch' }
      ]),
      job(3, 'Lot 3 - Sample Ridge', [line('r_post', 22, ['p_bo', 'p_teo']), line('r_panel', 20, ['p_ana', 'p_bo'])]),
      job(4, 'Lot 9 - Sample Ridge', [line('r_panel', 14, ['p_ana']), line('r_gate', 2, ['p_bo'])]),
      job(7, 'Dog run - Example Farm', [line('r_chain', 96, ['p_teo']), line('r_post', 9, ['p_teo'])]),
      job(8, 'Lot 2 - Sample Ridge', [line('r_tear', 80, ['p_ana', 'p_bo']), line('r_haul', 1, ['p_ana'])])
    ];
    return s;
  }

  return {
    APP_ID: APP_ID,
    DATA_VERSION: DATA_VERSION,
    CSV_HEADERS: CSV_HEADERS,
    // money
    toScaled: toScaled,
    parseNumber: parseNumber,
    toCents: toCents,
    parseCents: parseCents,
    lineCents: lineCents,
    splitCents: splitCents,
    fmtMoney: fmtMoney,
    centsToDecimal: centsToDecimal,
    fmtRate: fmtRate,
    fmtQty: fmtQty,
    // dates
    isISODate: isISODate,
    addDays: addDays,
    dayOfWeek: dayOfWeek,
    weekStartOf: weekStartOf,
    weekOf: weekOf,
    localISO: localISO,
    parseLooseDate: parseLooseDate,
    fmtDay: fmtDay,
    fmtRange: fmtRange,
    // data
    makeId: makeId,
    clone: clone,
    emptyState: emptyState,
    normalizeState: normalizeState,
    sampleState: sampleState,
    cleanPersonName: cleanPersonName,
    findRate: findRate,
    findPersonByName: findPersonByName,
    addPerson: addPerson,
    jobsForPerson: jobsForPerson,
    validateJob: validateJob,
    saveJob: saveJob,
    deleteJob: deleteJob,
    jobBreakdown: jobBreakdown,
    computeWeek: computeWeek,
    // csv
    parseCsv: parseCsv,
    toCsv: toCsv,
    jobsToRows: jobsToRows,
    exportWeekCsv: exportWeekCsv,
    exportAllJobsCsv: exportAllJobsCsv,
    exportWeekTotalsCsv: exportWeekTotalsCsv,
    csvTemplate: csvTemplate,
    importJobsCsv: importJobsCsv,
    // backup
    exportBackup: exportBackup,
    importBackup: importBackup
  };
});
