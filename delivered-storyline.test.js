/*
 * 2026 Delivered storyline test (dashboard.html #deliveredSec).
 *
 * Covers task v2-storyline:
 *   - deliveredStory(rows) pure model: count, avgRealized, byDept, realizedVals
 *   - isCompleted() only matches status === 'completed' (case-insensitive)
 *   - renderDelivered(): section HIDDEN when nothing delivered; SHOWN with
 *     3 KPIs + per-department bars when >=1 completed row exists.
 *
 * jsdom, no network. Fed via the __DASH_TEST_ROWS hook.
 *   node delivered-storyline.test.js   # exit 0 = all green
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function ok(msg, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}
function approx(a, b) { return Math.abs(a - b) < 0.01; }

function loadDash(rows) {
  const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://example.com/dashboard.html',
    beforeParse(w) { w.__DASH_TEST_ROWS = rows; }
  });
}
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

// Mixed portfolio: 3 completed (2 HR, 1 Finance), 2 not-completed.
const ROWS = [
  { id: 'a', name: 'AskHR',        department: 'Human Resources', roi_p50: 300, verdict: 'GO',  status: 'completed' },
  { id: 'b', name: 'HR Onboard',   department: 'Human Resources', roi_p50: 100, verdict: 'GO',  status: 'Completed' }, // case-insensitive
  { id: 'c', name: 'Fin Close',    department: 'Finance',         roi_p50: 200, verdict: 'GO',  status: 'completed' },
  { id: 'd', name: 'Pilot X',      department: 'Finance',         roi_p50: 900, verdict: 'COND',status: 'in_progress' },
  { id: 'e', name: 'Idea Y',       department: 'Legal',           roi_p50: 50,  verdict: 'NO',  status: 'proposed' },
];

(async function () {
console.log('\n=== 2026 Delivered storyline ===\n');

// ---------- model ----------
const dom = loadDash(ROWS);
const D = dom.window.__dash;
const doc = dom.window.document;
await tick();

console.log('== deliveredStory() model ==');
const s = D.deliveredStory(ROWS);
ok('counts only completed rows (3, not 5)', s.count === 3);
ok('isCompleted is case-insensitive (Completed matches)', D.isCompleted({ status: 'Completed' }) === true);
ok('isCompleted rejects non-completed', D.isCompleted({ status: 'in_progress' }) === false && D.isCompleted({}) === false);
ok('realizedVals = the 3 delivered roi_p50s', s.realizedVals.length === 3);
ok('avgRealized = mean(300,100,200) = 200', approx(s.avgRealized, 200));
ok('byDept has 2 groups (HR, Finance) — not Legal/Finance-pilot', s.byDept.length === 2);
ok('byDept sorted by count desc (HR=2 first)', s.byDept[0].dept === 'Human Resources' && s.byDept[0].count === 2);
ok('HR avg P50 = mean(300,100) = 200', approx(s.byDept[0].avg, 200));
ok('Finance group count=1 avg=200', s.byDept[1].dept === 'Finance' && s.byDept[1].count === 1 && approx(s.byDept[1].avg, 200));

console.log('\n== renderDelivered() DOM (with delivered rows) ==');
const sec = doc.getElementById('deliveredSec');
ok('section exists', !!sec);
ok('section is VISIBLE when there are delivered rows', !sec.classList.contains('hidden'));
const dkpis = doc.querySelectorAll('#deliveredKpis .kpi');
ok('renders 3 delivered KPIs', dkpis.length === 3);
const kText = Array.prototype.map.call(dkpis, function (n) { return n.textContent; }).join(' | ');
ok('KPI shows delivered count 3', /(^|\D)3(\D|$)/.test(doc.querySelector('#deliveredKpis .kpi .kpi__v').textContent));
ok('a KPI mentions realized P50 return', /realized P50 return/i.test(kText));
ok('a KPI mentions delivering departments', /Delivering departments/i.test(kText));
const bars = doc.querySelectorAll('#deliveredByDept .dvd__row');
ok('renders one dept bar per delivering department (2)', bars.length === 2);
ok('top bar labelled Human Resources', /Human Resources/.test(bars[0].querySelector('.dvd__label').textContent));
ok('top bar fill is 100% (max count)', /width:\s*100/.test(bars[0].querySelector('.dvd__fill').getAttribute('style')));
ok('finance bar fill is 50% (1 of 2)', /width:\s*50/.test(bars[1].querySelector('.dvd__fill').getAttribute('style')));
ok('dept meta shows the count', /\b1\b/.test(bars[1].querySelector('.dvd__meta').textContent));

// ---------- hidden when nothing delivered ----------
console.log('\n== renderDelivered() with NO delivered rows -> hidden ==');
const none = [
  { id: 'x', name: 'A', department: 'Ops', roi_p50: 100, verdict: 'GO', status: 'in_progress' },
  { id: 'y', name: 'B', department: 'Ops', roi_p50: 100, verdict: 'COND' }, // no status
];
const dom2 = loadDash(none);
await tick();
const D2 = dom2.window.__dash;
const doc2 = dom2.window.document;
const s2 = D2.deliveredStory(none);
ok('deliveredStory count is 0 when none completed', s2.count === 0);
const sec2 = doc2.getElementById('deliveredSec');
ok('section is HIDDEN when nothing delivered', sec2.classList.contains('hidden'));
ok('no dept bars rendered', doc2.querySelectorAll('#deliveredByDept .dvd__row').length === 0);

console.log('\n' + (fail === 0
  ? '\u2705 ALL DELIVERED-STORYLINE TESTS PASSED (' + pass + ')'
  : '\u274c ' + fail + ' failed, ' + pass + ' passed'));
process.exit(fail === 0 ? 0 : 1);
})();
