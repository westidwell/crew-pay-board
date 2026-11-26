/*
 * Crew Pay Board page logic.
 * Uses window.CrewPay (src/engine.js) for all math and window.CrewPayPro (src/pro.js) for the
 * locked Pro buttons. Data lives in this browser's localStorage only; nothing is sent anywhere.
 */
(function () {
  'use strict';
  var E = window.CrewPay;
  var P = window.CrewPayPro;
  var STORE_KEY = 'crew-pay-board:v1';

  var state;
  var storage = { ok: true, problem: '' };
  var ui = {
    tab: 'week',
    week: E.localISO(),
    open: {}, // people expanded on the Week tab
    draft: null, // the job being logged or edited
    lastWho: [], // who did the last line, reused for the next new line
    pending: null, // what "Yes" does in the open confirm box
    installEvent: null
  };

  var LOCK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var money = E.fmtMoney;
  function minus(cents) {
    return '−' + money(Math.abs(cents));
  }
  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  // ---------------------------------------------------------------------------
  // Saving (this device only)
  // ---------------------------------------------------------------------------

  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      storage.ok = false;
      storage.problem = 'This browser is blocking storage, so nothing is kept after you close the page. Download a backup in Setup before you leave.';
    }
    if (raw) {
      try {
        return E.normalizeState(JSON.parse(raw));
      } catch (e) {
        try {
          localStorage.setItem(STORE_KEY + ':unreadable:' + Date.now(), raw);
        } catch (e2) {
          /* nothing more we can do */
        }
        storage.problem =
          'Saved data on this device could not be read, so the sample crew was loaded instead. The unreadable copy was kept in this browser. Restore a backup in Setup if you have one.';
      }
    }
    return E.sampleState(E.localISO());
  }

  function save() {
    if (!storage.ok) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      storage.problem = 'Could not save on this device (storage may be full). Download a backup in Setup.';
    }
  }

  function commit(msg) {
    save();
    render();
    if (msg) toast(msg);
  }

  // ---------------------------------------------------------------------------
  // Small helpers: toast, modal, downloads, files
  // ---------------------------------------------------------------------------

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('on');
    }, 2800);
  }

  function modal(html) {
    var m = $('modal');
    m.innerHTML = '<div class="box">' + html + '</div>';
    m.classList.add('on');
    var first = m.querySelector('[data-act="confirm-yes"], [data-act="close"], button, a');
    if (first) first.focus();
  }
  function closeModal() {
    var m = $('modal');
    m.classList.remove('on');
    m.innerHTML = '';
    ui.pending = null;
  }
  function confirmBox(title, text, yesLabel, onYes, danger) {
    modal(
      '<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="btns">' +
        '<button class="btn" data-act="close">Cancel</button>' +
        '<button class="btn ' + (danger ? 'danger' : 'main') + '" data-act="confirm-yes">' + esc(yesLabel) + '</button></div>'
    );
    ui.pending = onYes;
  }
  function infoBox(title, html) {
    modal('<h3>' + esc(title) + '</h3>' + html + '<div class="btns"><button class="btn main" data-act="close">OK</button></div>');
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1500);
  }
  function downloadCsv(name, text) {
    download(name, '﻿' + text, 'text/csv'); // the mark helps Excel read accented names
  }

  function readFile(input, cb) {
    var f = input.files && input.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      input.value = '';
      cb(String(r.result));
    };
    r.onerror = function () {
      input.value = '';
      toast('Could not read that file.');
    };
    r.readAsText(f);
  }

  // ---------------------------------------------------------------------------
  // Pro: visible, locked, and honest. Each button calls the stub in src/pro.js.
  // ---------------------------------------------------------------------------

  var PRO_CALLS = {
    crewSignIn: function () {
      P.crewSignIn(null);
    },
    officeApproval: function () {
      P.approveWeek(ui.week, '');
    },
    multiCrew: function () {
      P.addCrew('');
    },
    photoProof: function () {
      P.attachPhoto(null, null);
    },
    payrollExport: function () {
      P.exportToPayroll(ui.week, '');
    },
    payHistory: function () {
      P.payHistory(null, null, null);
    }
  };

  function locked(key, label) {
    return '<button class="btn locked" data-act="pro" data-key="' + esc(key) + '">' + LOCK + esc(label) + '</button>';
  }

  function openPro(key) {
    try {
      (PRO_CALLS[key] ||
        function () {
          throw new P.ProFeatureError(key);
        })();
    } catch (err) {
      if (!(err instanceof P.ProFeatureError)) throw err;
      var f = P.feature(err.feature);
      modal(
        '<h3>' + LOCK + esc(f.name) + '</h3>' +
          '<p>' + esc(f.line) + '</p>' +
          '<p class="mut">' + esc(err.message) + '</p>' +
          '<p><a href="' + esc(err.url) + '" target="_blank" rel="noopener">Read PRO.md</a></p>' +
          '<div class="btns"><button class="btn main" data-act="close">OK</button></div>'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function render() {
    document.querySelectorAll('.tab').forEach(function (b) {
      var on = b.dataset.tab === ui.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('crewname').textContent = state.settings.crewName;
    var view = { week: viewWeek, log: viewLog, rates: viewRates, setup: viewSetup }[ui.tab] || viewWeek;
    $('main').innerHTML = banners() + view();
    if (ui.tab === 'log') updateDraftTotals();
  }

  function banners() {
    var h = '';
    if (storage.problem) h += '<div class="banner bad">' + esc(storage.problem) + '</div>';
    if (state.sample && (ui.tab === 'week' || ui.tab === 'log')) {
      h +=
        '<div class="banner">This is a made-up sample fence crew so you can see how it works. ' +
        'Start fresh when you are ready to add your own crew and rates.' +
        '<div class="row"><button class="btn slim main" data-act="start-fresh">Start fresh</button>' +
        '<button class="btn slim" data-act="keep-sample">Hide this note</button></div></div>';
    }
    return h;
  }

  function personName(pid) {
    for (var i = 0; i < state.people.length; i++) if (state.people[i].id === pid) return state.people[i].name;
    return '(removed)';
  }

  // ----- Week tab -----

  function viewWeek() {
    var w = E.computeWeek(state, ui.week);
    var thisWeek = E.weekStartOf(E.localISO(), state.settings.weekStart) === w.start;
    var h = '';
    h +=
      '<div class="weeknav"><button class="btn" data-act="week-prev" aria-label="Previous week">&#8249;</button>' +
      '<div class="wk">' + esc(E.fmtRange(w.start, w.end)) +
      (thisWeek ? '<div class="small mut">This week</div>' : '<div><button class="btn slim" data-act="week-now">Back to this week</button></div>') +
      '</div><button class="btn" data-act="week-next" aria-label="Next week">&#8250;</button></div>';

    h +=
      '<div class="card"><div class="spread"><div><div class="lbl">Crew total</div>' +
      '<div class="big' + (w.totalCents < 0 ? ' neg' : '') + '">' + money(w.totalCents) + '</div></div>' +
      '<div class="small mut" style="text-align:right">' + plural(w.jobs.length, 'job') +
      '<br>Pieces ' + money(w.workCents) + '<br>Extras +' + money(w.extraCents) + '<br>Back-charges ' + minus(w.backchargeCents) +
      '</div></div></div>';

    if (w.unassigned.length) {
      h += '<div class="banner bad">' + plural(w.unassigned.length, 'line') + ' this week ' + (w.unassigned.length === 1 ? 'has' : 'have') +
        ' nobody picked for it, so ' + (w.unassigned.length === 1 ? 'it is' : 'they are') + ' not in anyone’s pay. Edit the job to fix it.</div>';
    }

    h += '<h2>Pay by person <small>tap a name for details</small></h2>';
    if (!w.people.length) h += '<div class="empty">No crew yet. Add people on the Setup tab.</div>';
    w.people.forEach(function (p) {
      var open = !!ui.open[p.personId];
      h +=
        '<div class="card person"><div class="spread" data-act="toggle-person" data-id="' + esc(p.personId) + '" role="button" tabindex="0" aria-expanded="' + open + '">' +
        '<div><div class="nm">' + esc(p.name) + (p.active ? '' : ' <span class="small mut">(off)</span>') + '</div>' +
        '<div class="parts">Pieces ' + money(p.workCents) + (p.extraCents ? ' · Extras +' + money(p.extraCents) : '') +
        (p.backchargeCents ? ' · Back-charges ' + minus(p.backchargeCents) : '') + ' · ' + plural(p.jobCount, 'job') + '</div></div>' +
        '<div class="big' + (p.netCents < 0 ? ' neg' : '') + '">' + money(p.netCents) + '</div></div>';
      if (open) h += personDetail(p);
      h += '</div>';
    });

    h +=
      '<div class="btns"><button class="btn main" data-act="print-all">Print pay statements</button>' +
      '<button class="btn" data-act="csv-week">Export week CSV</button>' +
      '<button class="btn" data-act="csv-totals">Export totals CSV</button></div>';
    h += '<div class="btns">' + locked('officeApproval', 'Send for office approval') + locked('payrollExport', 'Send to payroll app') + locked('payHistory', 'Year-to-date totals') + '</div>';

    h += '<h2>Jobs this week <small>' + plural(w.jobs.length, 'job') + '</small></h2>';
    if (!w.jobs.length) h += '<div class="empty">No jobs logged this week.<div class="btns" style="justify-content:center"><button class="btn main" data-act="go-log">Log a job</button></div></div>';
    h += '<div class="joblist">' + w.jobs.slice().reverse().map(jobCard).join('') + '</div>';
    return h;
  }

  function personDetail(p) {
    var h = '<div class="detail">';
    if (!p.items.length && !p.adjustments.length) h += '<div class="mut">Nothing logged for ' + esc(p.name) + ' this week.</div>';
    p.items.forEach(function (it) {
      var split = it.splitWith > 1 ? ' · split ' + it.splitWith + ' ways of ' + money(it.lineCents) : '';
      h +=
        '<div class="d"><div class="what"><b>' + esc(it.task) + '</b> ' + esc(E.fmtQty(it.qty)) + ' ' + esc(it.unit) + ' × $' + esc(E.fmtRate(it.rate)) +
        '<div class="small mut">' + esc(E.fmtDay(it.date)) + ' · ' + esc(it.job) + split + '</div></div><div>' + money(it.cents) + '</div></div>';
    });
    p.adjustments.forEach(function (a) {
      var bc = a.kind === 'backcharge';
      h +=
        '<div class="d"><div class="what"><b>' + (bc ? 'Back-charge' : 'Extra') + '</b> ' + esc(a.note) +
        '<div class="small mut">' + esc(E.fmtDay(a.date)) + ' · ' + esc(a.job) + '</div></div>' +
        '<div class="' + (bc ? 'neg' : 'pos') + '">' + (bc ? minus(a.cents) : '+' + money(a.cents)) + '</div></div>';
    });
    h +=
      '<div class="btns"><button class="btn slim" data-act="print-one" data-id="' + esc(p.personId) + '">Print ' + esc(p.name) + '’s statement</button>' +
      locked('crewSignIn', 'Let ' + p.name + ' see this on their phone') + '</div></div>';
    return h;
  }

  function jobCard(job) {
    var b = E.jobBreakdown(job);
    var who = {};
    job.lines.forEach(function (l) {
      l.people.forEach(function (pid) {
        who[pid] = true;
      });
    });
    job.adjustments.forEach(function (a) {
      who[a.person] = true;
    });
    var tasks = job.lines
      .map(function (l) {
        return l.task + ' ' + E.fmtQty(l.qty);
      })
      .join(' · ');
    var adj = job.adjustments
      .map(function (a) {
        return (a.kind === 'backcharge' ? 'Back-charge ' + minus(a.cents) : 'Extra +' + money(a.cents)) + ' (' + personName(a.person) + ')';
      })
      .join(' · ');
    return (
      '<div class="card job"><div class="spread"><div class="when">' + esc(E.fmtDay(job.date)) + '</div><b>' + money(b.totalCents) + '</b></div>' +
      '<div class="nm">' + esc(job.name) + '</div>' +
      (tasks ? '<div class="ln">' + esc(tasks) + '</div>' : '') +
      (adj ? '<div class="ln">' + esc(adj) + '</div>' : '') +
      '<div class="ln">' + esc(Object.keys(who).map(personName).join(', ')) + '</div>' +
      (job.notes ? '<div class="ln">Note: ' + esc(job.notes) + '</div>' : '') +
      '<div class="btns"><button class="btn slim" data-act="job-edit" data-id="' + esc(job.id) + '">Edit</button>' +
      '<button class="btn slim" data-act="job-copy" data-id="' + esc(job.id) + '">Copy</button>' +
      '<button class="btn slim danger" data-act="job-del" data-id="' + esc(job.id) + '">Delete</button></div></div>'
    );
  }

  // ----- Log tab (the job form) -----

  function activePeople() {
    return state.people.filter(function (p) {
      return p.active;
    });
  }

  function blankLine() {
    var ids = {};
    activePeople().forEach(function (p) {
      ids[p.id] = true;
    });
    return {
      rateId: '',
      task: '',
      unit: '',
      rate: '',
      qty: '',
      people: ui.lastWho.filter(function (id) {
        return ids[id];
      })
    };
  }

  function newDraft(date) {
    return { id: null, date: date || E.localISO(), name: '', notes: '', lines: [blankLine()], adjustments: [], errors: [] };
  }

  function draftFromJob(job, asCopy) {
    return {
      id: asCopy ? null : job.id,
      date: asCopy ? E.localISO() : job.date,
      name: job.name,
      notes: asCopy ? '' : job.notes,
      lines: job.lines.map(function (l) {
        var card = E.findRate(state, l.task);
        return {
          rateId: card && card.name === l.task ? card.id : '',
          task: l.task,
          unit: l.unit,
          rate: E.fmtRate(asCopy && card ? card.rate : l.rate),
          qty: E.fmtQty(l.qty),
          people: l.people.slice()
        };
      }),
      adjustments: asCopy
        ? []
        : job.adjustments.map(function (a) {
            return { kind: a.kind, person: a.person, amount: E.centsToDecimal(a.cents), note: a.note };
          }),
      errors: []
    };
  }

  function draftToJob(d) {
    return {
      id: d.id || undefined,
      date: d.date,
      name: d.name.trim(),
      notes: d.notes.trim(),
      lines: d.lines
        .filter(function (l) {
          return l.task || String(l.qty).trim(); // a line left completely blank is ignored
        })
        .map(function (l) {
          return { task: l.task, unit: l.unit || 'each', rate: E.parseNumber(l.rate), qty: E.parseNumber(l.qty), people: l.people.slice() };
        }),
      adjustments: d.adjustments.map(function (a) {
        var c = E.parseCents(a.amount);
        return { kind: a.kind, person: a.person, cents: c === null ? 0 : Math.abs(c), note: a.note.trim() };
      })
    };
  }

  function viewLog() {
    if (!ui.draft) ui.draft = newDraft();
    var d = ui.draft;
    var editing = !!d.id;
    var people = activePeople();
    var h = '<h2>' + (editing ? 'Edit job' : 'Log a finished job') + (editing ? ' <small>changes replace the saved job</small>' : '') + '</h2>';
    if (!state.rates.length || !state.people.length) {
      h += '<div class="banner">Before logging jobs, add ' + (!state.rates.length ? 'your tasks and rates on the Rates tab' : '') +
        (!state.rates.length && !state.people.length ? ' and ' : '') + (!state.people.length ? 'your crew on the Setup tab' : '') + '.</div>';
    }
    if (d.errors.length) {
      h += '<div class="banner bad" id="form-errors"><b>Not saved yet:</b><ul class="plain">' + d.errors.map(function (e) {
        return '<li>' + esc(e) + '</li>';
      }).join('') + '</ul></div>';
    }
    h +=
      '<div class="card"><div class="row"><label class="f grow"><span>Date</span><input type="date" data-f="date" value="' + esc(d.date) + '"></label>' +
      '<label class="f grow"><span>Job name or lot</span><input type="text" data-f="name" value="' + esc(d.name) + '" placeholder="Lot 14 - Example Hills" autocomplete="off"></label></div></div>';

    h += '<h2>Work done <small>quantity × rate</small></h2>';
    d.lines.forEach(function (l, i) {
      h += '<div class="line"><div class="grid">' +
        '<label class="f"><span>Task</span><select data-f="task" data-i="' + i + '">' + taskOptions(l) + '</select></label>' +
        '<label class="f"><span>Qty' + (l.unit ? ' (' + esc(l.unit) + ')' : '') + '</span><input type="text" inputmode="decimal" data-f="qty" data-i="' + i + '" value="' + esc(l.qty) + '" placeholder="0"></label>' +
        '<label class="f"><span>Rate $' + (l.unit ? ' per ' + esc(l.unit) : '') + '</span><input type="text" inputmode="decimal" data-f="rate" data-i="' + i + '" value="' + esc(l.rate) + '" placeholder="0.00"></label>' +
        '</div><div class="lbl">Who did it</div><div class="who">';
      var shown = {};
      people.forEach(function (p) {
        shown[p.id] = true;
        h += chip(p.id, p.name, l.people.indexOf(p.id) >= 0, i);
      });
      l.people.forEach(function (pid) {
        if (!shown[pid]) h += chip(pid, personName(pid), true, i);
      });
      if (!people.length) h += '<span class="small mut">Add people on the Setup tab first.</span>';
      h += '</div><div class="spread"><span class="small mut" id="line-note-' + i + '"></span><span class="amt" id="line-amt-' + i + '">$0.00</span></div>' +
        '<div class="btns"><button class="btn slim danger" data-act="line-del" data-i="' + i + '">Remove line</button></div></div>';
    });
    h += '<div class="btns"><button class="btn" data-act="line-add">+ Add task line</button></div>';

    h += '<h2>Extras and back-charges <small>per person</small></h2>';
    d.adjustments.forEach(function (a, i) {
      h += '<div class="line"><div class="seg" role="group" aria-label="Kind">' +
        '<button data-act="adj-kind" data-i="' + i + '" data-kind="extra" class="' + (a.kind === 'extra' ? 'on' : '') + '">Extra (adds)</button>' +
        '<button data-act="adj-kind" data-i="' + i + '" data-kind="backcharge" class="' + (a.kind === 'backcharge' ? 'on' : '') + '">Back-charge (takes off)</button></div>' +
        '<div class="grid" style="margin-top:8px"><label class="f"><span>Person</span><select data-f="adj-person" data-i="' + i + '"><option value="">Who?</option>' +
        state.people.filter(function (p) {
          return p.active || p.id === a.person;
        }).map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === a.person ? ' selected' : '') + '>' + esc(p.name) + '</option>';
        }).join('') + '</select></label>' +
        '<label class="f"><span>Amount $</span><input type="text" inputmode="decimal" data-f="adj-amount" data-i="' + i + '" value="' + esc(a.amount) + '" placeholder="0.00"></label>' +
        '<label class="f"><span>Why</span><input type="text" data-f="adj-note" data-i="' + i + '" value="' + esc(a.note) + '" placeholder="Reason"></label></div>' +
        '<div class="btns"><button class="btn slim danger" data-act="adj-del" data-i="' + i + '">Remove</button></div></div>';
    });
    h += '<div class="btns"><button class="btn" data-act="adj-add">+ Add extra or back-charge</button></div>';

    h += '<h2>Notes</h2><div class="card"><textarea data-f="notes" placeholder="Anything the office should know">' + esc(d.notes) + '</textarea>' +
      '<div class="btns">' + locked('photoProof', 'Add photo proof') + '</div></div>';

    h += '<div class="total-bar"><div class="spread"><div><div class="lbl">Job total</div><div class="big" id="job-total">$0.00</div>' +
      '<div class="small mut" id="job-split"></div></div><div class="row">' +
      '<button class="btn" data-act="job-cancel">' + (editing ? 'Cancel' : 'Clear') + '</button>' +
      '<button class="btn main" data-act="job-save">' + (editing ? 'Save changes' : 'Save job') + '</button></div></div></div>';
    return h;
  }

  function chip(pid, name, on, i) {
    return '<button class="chip' + (on ? ' on' : '') + '" data-act="line-who" data-i="' + i + '" data-id="' + esc(pid) + '" aria-pressed="' + on + '">' + esc(name) + '</button>';
  }

  function taskOptions(l) {
    var h = '<option value="">' + (state.rates.length ? 'Pick a task…' : 'Add tasks on the Rates tab') + '</option>';
    var found = false;
    state.rates.forEach(function (r) {
      var sel = r.id === l.rateId;
      if (sel) found = true;
      h += '<option value="' + esc(r.id) + '"' + (sel ? ' selected' : '') + '>' + esc(r.name) + ' — $' + esc(E.fmtRate(r.rate)) + '/' + esc(r.unit) + '</option>';
    });
    if (!found && l.task) h += '<option value="__keep" selected>' + esc(l.task) + ' (not on rate card)</option>';
    return h;
  }

  function draftNumbers() {
    var d = ui.draft;
    var job = { lines: [], adjustments: [] };
    var amts = [];
    d.lines.forEach(function (l) {
      var q = E.parseNumber(l.qty);
      var r = E.parseNumber(l.rate);
      var ok = q !== null && q > 0 && r !== null && r >= 0;
      amts.push(ok ? E.lineCents(q, r) : 0);
      if (ok) job.lines.push({ qty: q, rate: r, people: l.people });
    });
    d.adjustments.forEach(function (a) {
      var c = E.parseCents(a.amount);
      if (c && a.person) job.adjustments.push({ kind: a.kind, person: a.person, cents: Math.abs(c) });
    });
    var b = E.jobBreakdown(job);
    return { amts: amts, total: b.totalCents, byPerson: b.byPerson };
  }

  function updateDraftTotals() {
    if (!ui.draft || !$('job-total')) return;
    var n = draftNumbers();
    ui.draft.lines.forEach(function (l, i) {
      var amt = $('line-amt-' + i);
      var note = $('line-note-' + i);
      if (amt) amt.textContent = money(n.amts[i]);
      if (note) {
        var k = l.people.length;
        note.textContent = k > 1 && n.amts[i] ? 'split ' + k + ' ways: ' + E.splitCents(n.amts[i], k).map(money).join(' + ') : k ? '' : 'pick who did it';
      }
    });
    $('job-total').textContent = money(n.total);
    $('job-total').classList.toggle('neg', n.total < 0);
    $('job-split').textContent = Object.keys(n.byPerson)
      .map(function (pid) {
        return personName(pid) + ' ' + money(n.byPerson[pid].net);
      })
      .join(' · ');
  }

  function saveDraft() {
    var job = draftToJob(ui.draft);
    var errs = E.validateJob(job, state);
    if (errs.length) {
      ui.draft.errors = errs;
      render();
      var box = $('form-errors');
      if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
      return;
    }
    var editing = !!ui.draft.id;
    var saved = E.saveJob(state, job);
    if (saved.lines.length) ui.lastWho = saved.lines[saved.lines.length - 1].people.slice();
    ui.week = saved.date;
    var total = money(E.jobBreakdown(saved).totalCents);
    if (editing) {
      ui.draft = null;
      ui.tab = 'week';
      commit('Saved changes to ' + saved.name + ' (' + total + ')');
    } else {
      ui.draft = newDraft(saved.date);
      commit('Saved ' + saved.name + ' (' + total + '). Ready for the next one.');
    }
    window.scrollTo(0, 0);
  }

  // ----- Rates tab -----

  function viewRates() {
    var h = '<h2>Rate card <small>what each task pays</small></h2><div class="card">';
    if (state.rates.length) {
      h += '<div class="rate lbl"><span>Task</span><span>Unit</span><span>$ Rate</span><span></span></div>';
    } else {
      h += '<div class="empty">No tasks yet. Add the work your crew gets paid for, like "Hang panel, per panel, $9.50".</div>';
    }
    state.rates.forEach(function (r) {
      h += '<div class="rate">' +
        '<input type="text" data-f="rate-name" data-id="' + esc(r.id) + '" value="' + esc(r.name) + '" aria-label="Task name">' +
        '<input type="text" data-f="rate-unit" data-id="' + esc(r.id) + '" value="' + esc(r.unit) + '" aria-label="Unit">' +
        '<input type="text" inputmode="decimal" data-f="rate-rate" data-id="' + esc(r.id) + '" value="' + esc(E.fmtRate(r.rate)) + '" aria-label="Rate in dollars">' +
        '<button class="x" data-act="rate-del" data-id="' + esc(r.id) + '" aria-label="Delete ' + esc(r.name) + '">×</button></div>';
    });
    h += '<div class="btns"><button class="btn" data-act="rate-add">+ Add task</button></div></div>';
    h += '<p class="small mut">Changes save as you type. Jobs already logged keep the rate they were logged with, so changing a rate never rewrites past pay.</p>';
    h += '<div class="btns">' + locked('multiCrew', 'Rate card per customer') + '</div>';
    return h;
  }

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // ----- Setup tab -----

  function viewSetup() {
    var ws = state.settings.weekStart;
    var h = '<h2>Crew</h2><div class="card">' +
      '<label class="f"><span>Crew name (shows on pay statements)</span><input type="text" data-f="crew-name" value="' + esc(state.settings.crewName) + '" placeholder="My crew"></label>' +
      '<div class="lbl">People</div>';
    if (!state.people.length) h += '<p class="small mut">No one yet. Add each person who gets paid.</p>';
    state.people.forEach(function (p) {
      h += '<div class="row" style="margin-bottom:6px"><input class="grow" type="text" data-f="person-name" data-id="' + esc(p.id) + '" value="' + esc(p.name) + '" aria-label="Name">' +
        '<button class="chip' + (p.active ? ' on' : '') + '" data-act="person-active" data-id="' + esc(p.id) + '" aria-pressed="' + p.active + '">' + (p.active ? 'Active' : 'Off') + '</button>' +
        '<button class="btn slim danger" data-act="person-del" data-id="' + esc(p.id) + '">Remove</button></div>';
    });
    h += '<div class="row"><input class="grow" type="text" id="new-person" placeholder="New person’s name" autocomplete="off">' +
      '<button class="btn" data-act="person-add">Add</button></div>' +
      '<div class="btns">' + locked('crewSignIn', 'Give each person their own sign-in') + locked('multiCrew', 'Add another crew') + '</div></div>';

    h += '<h2>Pay week</h2><div class="card"><div class="lbl">Week starts on</div><div class="seg" role="group" aria-label="Week starts on">' +
      '<button data-act="weekstart" data-v="mon" class="' + (ws === 'mon' ? 'on' : '') + '">Monday</button>' +
      '<button data-act="weekstart" data-v="sun" class="' + (ws === 'sun' ? 'on' : '') + '">Sunday</button></div></div>';

    h += '<h2>Your data</h2><div class="card"><p class="small mut" style="margin-top:0">Everything is saved in this browser on this device only. Nothing is sent anywhere. ' +
      'Download a backup now and then, and before you clear your browser or switch phones.</p>' +
      '<div class="btns"><button class="btn main" data-act="backup">Download backup</button><button class="btn" data-act="restore">Restore from backup</button></div>' +
      '<div class="btns"><button class="btn" data-act="csv-import">Import jobs from CSV</button><button class="btn" data-act="csv-template">CSV template</button>' +
      '<button class="btn" data-act="csv-all">Export all jobs CSV</button></div>' +
      '<div class="btns"><button class="btn" data-act="load-sample">Load sample crew</button><button class="btn danger" data-act="erase">Erase everything</button></div></div>';

    h += '<h2>Put it on your phone</h2><div class="card small">' +
      '<p style="margin-top:0"><b>iPhone:</b> open this page in Safari, tap Share, then Add to Home Screen.</p>' +
      '<p><b>Android:</b> open it in Chrome, tap the menu, then Install app (or Add to Home screen).</p>' +
      '<p class="mut" style="margin-bottom:0">After that it opens like an app and works with no signal.</p>' +
      (ui.installEvent ? '<div class="btns"><button class="btn main" data-act="install">Install now</button></div>' : '') + '</div>';

    h += '<h2>Pro <small>not open yet</small></h2><div class="card">';
    P.PRO_FEATURES.forEach(function (f) {
      h += '<div style="margin-bottom:10px">' + locked(f.key, f.name) + '<div class="small mut" style="margin-top:4px">' + esc(f.line) + '</div></div>';
    });
    h += '<p class="small mut" style="margin-bottom:0">Pro will be ' + esc(P.PRO_PRICE) + '. <a href="' + esc(P.PRO_URL) + '" target="_blank" rel="noopener" style="color:var(--blue)">Read PRO.md</a></p></div>';
    return h;
  }

  // ---------------------------------------------------------------------------
  // Printing
  // ---------------------------------------------------------------------------

  function statementHtml(w, p) {
    var crew = state.settings.crewName;
    var h = '<section class="stmt"><h2>Pay statement</h2><div class="meta">' +
      '<div><b>Name:</b> ' + esc(p.name) + '</div>' + (crew ? '<div><b>Crew:</b> ' + esc(crew) + '</div>' : '') +
      '<div><b>Week:</b> ' + esc(E.fmtRange(w.start, w.end)) + '</div></div>';
    if (p.items.length) {
      h += '<table><thead><tr><th>Date</th><th>Job</th><th>Task</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Pay</th></tr></thead><tbody>';
      p.items.forEach(function (it) {
        h += '<tr><td>' + esc(E.fmtDay(it.date)) + '</td><td>' + esc(it.job) + '</td><td>' + esc(it.task) +
          (it.splitWith > 1 ? '<div class="small">split ' + it.splitWith + ' ways of ' + money(it.lineCents) + '</div>' : '') + '</td>' +
          '<td class="n">' + esc(E.fmtQty(it.qty)) + ' ' + esc(it.unit) + '</td><td class="n">$' + esc(E.fmtRate(it.rate)) + '</td><td class="n">' + money(it.cents) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    if (p.adjustments.length) {
      h += '<table><thead><tr><th>Date</th><th>Job</th><th>Extra or back-charge</th><th class="n">Amount</th></tr></thead><tbody>';
      p.adjustments.forEach(function (a) {
        var bc = a.kind === 'backcharge';
        h += '<tr><td>' + esc(E.fmtDay(a.date)) + '</td><td>' + esc(a.job) + '</td><td>' + (bc ? 'Back-charge' : 'Extra') + (a.note ? ': ' + esc(a.note) : '') +
          '</td><td class="n">' + (bc ? minus(a.cents) : '+' + money(a.cents)) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '<table class="tot"><tr><td>Piece work</td><td class="n">' + money(p.workCents) + '</td></tr>' +
      '<tr><td>Extras</td><td class="n">+' + money(p.extraCents) + '</td></tr>' +
      '<tr><td>Back-charges</td><td class="n">' + minus(p.backchargeCents) + '</td></tr>' +
      '<tr class="net"><td>Net pay</td><td class="n">' + money(p.netCents) + '</td></tr></table>' +
      '<div class="sign"><div>Received by</div><div>Date</div></div>' +
      '<div class="foot">Printed ' + esc(E.fmtDay(E.localISO())) + ' with Crew Pay Board.</div></section>';
    return h;
  }

  function printStatements(personId) {
    var w = E.computeWeek(state, ui.week);
    var list = w.people.filter(function (p) {
      return personId ? p.personId === personId : p.items.length || p.adjustments.length;
    });
    if (!list.length) {
      toast('Nobody has pay logged this week.');
      return;
    }
    $('print').innerHTML = list
      .map(function (p) {
        return statementHtml(w, p);
      })
      .join('');
    document.body.classList.add('printing'); // only matters on paper; see @media print
    if (typeof window.print === 'function') window.print();
  }

  // ---------------------------------------------------------------------------
  // Actions (buttons)
  // ---------------------------------------------------------------------------

  function idx(el) {
    return +el.dataset.i;
  }

  var ACTIONS = {
    close: closeModal,
    'confirm-yes': function () {
      var f = ui.pending;
      closeModal();
      if (f) f();
    },
    pro: function (el) {
      openPro(el.dataset.key);
    },

    'start-fresh': function () {
      confirmBox('Start fresh?', 'This clears the sample crew, rates and jobs so you can add your own.', 'Start fresh', function () {
        state = E.emptyState();
        ui.draft = null;
        ui.open = {};
        ui.tab = 'rates';
        commit('Cleared. Add your tasks and rates first.');
      });
    },
    'keep-sample': function () {
      state.sample = false;
      commit();
    },

    'week-prev': function () {
      ui.week = E.addDays(E.weekStartOf(ui.week, state.settings.weekStart), -7);
      render();
    },
    'week-next': function () {
      ui.week = E.addDays(E.weekStartOf(ui.week, state.settings.weekStart), 7);
      render();
    },
    'week-now': function () {
      ui.week = E.localISO();
      render();
    },
    'toggle-person': function (el) {
      ui.open[el.dataset.id] = !ui.open[el.dataset.id];
      render();
    },
    'go-log': function () {
      ui.tab = 'log';
      render();
    },
    'print-all': function () {
      printStatements(null);
    },
    'print-one': function (el) {
      printStatements(el.dataset.id);
    },
    'csv-week': function () {
      var wk = E.weekOf(ui.week, state.settings.weekStart);
      downloadCsv('crew-pay-week-' + wk.start + '.csv', E.exportWeekCsv(state, ui.week));
    },
    'csv-totals': function () {
      var wk = E.weekOf(ui.week, state.settings.weekStart);
      downloadCsv('crew-pay-totals-' + wk.start + '.csv', E.exportWeekTotalsCsv(state, ui.week));
    },
    'job-edit': function (el) {
      var job = findById(state.jobs, el.dataset.id);
      if (!job) return;
      ui.draft = draftFromJob(job, false);
      ui.tab = 'log';
      render();
      window.scrollTo(0, 0);
    },
    'job-copy': function (el) {
      var job = findById(state.jobs, el.dataset.id);
      if (!job) return;
      ui.draft = draftFromJob(job, true);
      ui.tab = 'log';
      render();
      window.scrollTo(0, 0);
      toast('Copied with today’s date and current rates. Change what is different, then save.');
    },
    'job-del': function (el) {
      var job = findById(state.jobs, el.dataset.id);
      if (!job) return;
      confirmBox('Delete this job?', job.name + ' on ' + E.fmtDay(job.date) + ' (' + money(E.jobBreakdown(job).totalCents) + ') will be removed from everyone’s pay. This cannot be undone.', 'Delete job', function () {
        E.deleteJob(state, job.id);
        if (ui.draft && ui.draft.id === job.id) ui.draft = null;
        commit('Deleted ' + job.name);
      }, true);
    },

    'line-add': function () {
      ui.draft.lines.push(blankLine());
      render();
    },
    'line-del': function (el) {
      ui.draft.lines.splice(idx(el), 1);
      render();
    },
    'line-who': function (el) {
      var l = ui.draft.lines[idx(el)];
      var pid = el.dataset.id;
      var at = l.people.indexOf(pid);
      if (at >= 0) l.people.splice(at, 1);
      else l.people.push(pid);
      if (!ui.draft.id) ui.lastWho = l.people.slice();
      render();
    },
    'adj-add': function () {
      var people = activePeople();
      ui.draft.adjustments.push({ kind: 'extra', person: people.length === 1 ? people[0].id : '', amount: '', note: '' });
      render();
    },
    'adj-del': function (el) {
      ui.draft.adjustments.splice(idx(el), 1);
      render();
    },
    'adj-kind': function (el) {
      ui.draft.adjustments[idx(el)].kind = el.dataset.kind === 'backcharge' ? 'backcharge' : 'extra';
      render();
    },
    'job-save': saveDraft,
    'job-cancel': function () {
      var editing = !!ui.draft.id;
      ui.draft = editing ? null : newDraft(ui.draft.date);
      if (editing) ui.tab = 'week';
      render();
    },

    'rate-add': function () {
      state.rates.push({ id: E.makeId('r'), name: 'New task', unit: 'each', rate: 0 });
      commit();
      var inputs = document.querySelectorAll('[data-f="rate-name"]');
      var last = inputs[inputs.length - 1];
      if (last) {
        last.focus();
        last.select();
      }
    },
    'rate-del': function (el) {
      var r = findById(state.rates, el.dataset.id);
      if (!r) return;
      confirmBox('Delete ' + r.name + '?', 'It comes off the rate card. Jobs already logged with it keep their pay.', 'Delete task', function () {
        state.rates = state.rates.filter(function (x) {
          return x.id !== r.id;
        });
        commit('Deleted ' + r.name);
      }, true);
    },

    'person-add': function () {
      var input = $('new-person');
      try {
        var p = E.addPerson(state, input.value);
        commit('Added ' + p.name);
        var again = $('new-person');
        if (again) again.focus();
      } catch (e) {
        toast(e.message);
      }
    },
    'person-active': function (el) {
      var p = findById(state.people, el.dataset.id);
      if (!p) return;
      p.active = !p.active;
      commit(p.name + (p.active ? ' is active' : ' is off (hidden from new jobs, past pay kept)'));
    },
    'person-del': function (el) {
      var p = findById(state.people, el.dataset.id);
      if (!p) return;
      var n = E.jobsForPerson(state, p.id).length;
      if (n) {
        infoBox('Keep ' + p.name + ' on the books', '<p>' + esc(p.name) + ' is on ' + plural(n, 'logged job') + ', so removing them would break past pay. Tap Active to switch them Off instead; they disappear from new jobs and their past pay stays.</p>');
        return;
      }
      confirmBox('Remove ' + p.name + '?', 'They have no logged jobs, so nothing else changes.', 'Remove', function () {
        state.people = state.people.filter(function (x) {
          return x.id !== p.id;
        });
        commit('Removed ' + p.name);
      }, true);
    },
    weekstart: function (el) {
      state.settings.weekStart = el.dataset.v === 'sun' ? 'sun' : 'mon';
      commit('Pay weeks now start on ' + (state.settings.weekStart === 'sun' ? 'Sunday' : 'Monday'));
    },
    backup: function () {
      download('crew-pay-backup-' + E.localISO() + '.json', E.exportBackup(state), 'application/json');
      toast('Backup downloaded. Keep it somewhere safe.');
    },
    restore: function () {
      $('file-backup').click();
    },
    'csv-import': function () {
      $('file-csv').click();
    },
    'csv-template': function () {
      downloadCsv('crew-pay-template.csv', E.csvTemplate());
    },
    'csv-all': function () {
      downloadCsv('crew-pay-all-jobs-' + E.localISO() + '.csv', E.exportAllJobsCsv(state));
    },
    'load-sample': function () {
      confirmBox('Load the sample crew?', 'This replaces everything on this device with a made-up fence crew. Download a backup first if you want to keep what is here.', 'Load sample', function () {
        state = E.sampleState(E.localISO());
        ui.draft = null;
        ui.open = {};
        ui.week = E.localISO();
        ui.tab = 'week';
        commit('Sample crew loaded');
      }, true);
    },
    erase: function () {
      confirmBox('Erase everything?', 'All jobs, people and rates on this device will be deleted. This cannot be undone unless you have a backup.', 'Erase everything', function () {
        state = E.emptyState();
        ui.draft = null;
        ui.open = {};
        commit('Everything erased');
      }, true);
    },
    install: function () {
      var ev = ui.installEvent;
      ui.installEvent = null;
      if (ev && ev.prompt) ev.prompt();
      render();
    },
    'import-yes': function () {
      var f = ui.pending;
      closeModal();
      if (f) f();
    }
  };

  function onRestoreText(text) {
    var r;
    try {
      r = E.importBackup(text);
    } catch (e) {
      infoBox('Could not restore', '<p>' + esc(e.message) + '</p>');
      return;
    }
    var s = r.state;
    var when = r.exportedAt ? ' (saved ' + r.exportedAt.slice(0, 10) + ')' : '';
    confirmBox(
      'Replace everything with this backup?',
      'The backup' + when + ' has ' + plural(s.jobs.length, 'job') + ', ' + plural(s.people.length, 'person').replace('persons', 'people') + ' and ' +
        plural(s.rates.length, 'task') + ' on the rate card. What is on this device now will be replaced.',
      'Restore',
      function () {
        state = s;
        ui.draft = null;
        ui.open = {};
        ui.tab = 'week';
        commit('Backup restored');
      }
    );
  }

  function onCsvText(text) {
    var r;
    try {
      r = E.importJobsCsv(state, text);
    } catch (e) {
      infoBox('Could not import', '<p>' + esc(e.message) + '</p>');
      return;
    }
    function list(items, cls) {
      if (!items.length) return '';
      var shown = items.slice(0, 15).map(function (x) {
        return '<li>' + esc(x) + '</li>';
      });
      if (items.length > 15) shown.push('<li>…and ' + (items.length - 15) + ' more</li>');
      return '<ul class="plain small ' + (cls || '') + '">' + shown.join('') + '</ul>';
    }
    var h = '<p>' + (r.jobsAdded ? 'Ready to add <b>' + plural(r.jobsAdded, 'job') + '</b> (' + plural(r.linesAdded, 'line') + ').' : 'Nothing to add.') +
      (r.peopleAdded.length ? ' New people: ' + esc(r.peopleAdded.join(', ')) + '.' : '') + '</p>';
    if (r.errors.length) h += '<div class="lbl">Problems</div>' + list(r.errors, 'err');
    if (r.warnings.length) h += '<div class="lbl">Notes</div>' + list(r.warnings);
    h += '<div class="btns"><button class="btn" data-act="close">Cancel</button>' +
      (r.jobsAdded ? '<button class="btn main" data-act="import-yes">Add ' + plural(r.jobsAdded, 'job') + '</button>' : '') + '</div>';
    modal('<h3>Import jobs</h3>' + h);
    ui.pending = function () {
      state = r.state;
      ui.tab = 'week';
      if (r.state.jobs.length) {
        var last = r.state.jobs[r.state.jobs.length - 1];
        ui.week = last.date;
      }
      commit('Imported ' + plural(r.jobsAdded, 'job'));
    };
  }

  // ---------------------------------------------------------------------------
  // Typing in fields
  // ---------------------------------------------------------------------------

  function markInvalid(el, bad) {
    if (bad) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
    el.style.borderColor = bad ? 'var(--bad)' : '';
  }

  function onField(el) {
    var f = el.dataset.f;
    var d = ui.draft;
    var v = el.value;
    var i = idx(el);
    switch (f) {
      case 'date':
        d.date = v;
        break;
      case 'name':
        d.name = v;
        break;
      case 'notes':
        d.notes = v;
        break;
      case 'qty':
        d.lines[i].qty = v;
        updateDraftTotals();
        break;
      case 'rate':
        d.lines[i].rate = v;
        updateDraftTotals();
        break;
      case 'task': {
        var l = d.lines[i];
        var r = findById(state.rates, v);
        if (r) {
          l.rateId = r.id;
          l.task = r.name;
          l.unit = r.unit;
          l.rate = E.fmtRate(r.rate);
        } else if (v === '') {
          l.rateId = '';
          l.task = '';
          l.unit = '';
        }
        render();
        var qty = document.querySelector('[data-f="qty"][data-i="' + i + '"]');
        if (qty && r) qty.focus();
        break;
      }
      case 'adj-person':
        d.adjustments[i].person = v;
        updateDraftTotals();
        break;
      case 'adj-amount':
        d.adjustments[i].amount = v;
        updateDraftTotals();
        break;
      case 'adj-note':
        d.adjustments[i].note = v;
        break;
      case 'rate-name':
      case 'rate-unit':
      case 'rate-rate': {
        var rate = findById(state.rates, el.dataset.id);
        if (!rate) return;
        if (f === 'rate-name') {
          markInvalid(el, !v.trim());
          if (v.trim()) rate.name = v.trim().slice(0, 80);
        } else if (f === 'rate-unit') {
          rate.unit = v.trim().slice(0, 20) || 'each';
        } else {
          var n = E.parseNumber(v);
          markInvalid(el, n === null || n < 0);
          if (n !== null && n >= 0) rate.rate = n;
        }
        save();
        break;
      }
      case 'crew-name':
        state.settings.crewName = v.trim().slice(0, 80);
        $('crewname').textContent = state.settings.crewName;
        save();
        break;
      case 'person-name': {
        var p = findById(state.people, el.dataset.id);
        if (!p) return;
        var clean = E.cleanPersonName(v);
        var other = E.findPersonByName(state, clean);
        var bad = !clean || (other && other.id !== p.id);
        markInvalid(el, bad);
        if (!bad) {
          p.name = clean;
          save();
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act], [data-tab]');
    if (!t) {
      if (ev.target === $('modal')) closeModal();
      return;
    }
    if (t.dataset.tab) {
      ui.tab = t.dataset.tab;
      render();
      window.scrollTo(0, 0);
      return;
    }
    var fn = ACTIONS[t.dataset.act];
    if (fn) {
      ev.preventDefault();
      fn(t, ev);
    }
  });

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.tagName !== 'SELECT' && t.dataset && t.dataset.f) onField(t);
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.tagName === 'SELECT' && t.dataset.f) onField(t);
    if (t.id === 'file-backup') readFile(t, onRestoreText);
    if (t.id === 'file-csv') readFile(t, onCsvText);
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && $('modal').classList.contains('on')) closeModal();
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.getAttribute && ev.target.getAttribute('role') === 'button') {
      ev.preventDefault();
      ev.target.click();
    }
    if (ev.key === 'Enter' && ev.target.id === 'new-person') ACTIONS['person-add']();
  });

  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    ui.installEvent = ev;
    if (ui.tab === 'setup') render();
  });

  window.addEventListener('afterprint', function () {
    document.body.classList.remove('printing');
  });

  // Works offline once installed. Only on a real web address; opening the file directly skips it.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () {
      /* the page still works without it */
    });
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches && navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(function () {});
      }
    } catch (e) {
      /* optional */
    }
  }

  state = load();
  render();
})();
