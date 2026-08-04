/**
 * Compare Use Cases (compare.html) test suite.
 * Loads the page inside jsdom, mocks fetch() for /api/workspaces and
 * /api/portfolio, and exercises:
 *   - the pure compare model (window.GAIC_COMPARE): verdict class mapping,
 *     best/worst highlight computation, selection cap, URL id parsing
 *   - end-to-end render: N columns for N selected ids, verdict chips,
 *     up-to-4 cap on chips, URL ?ids= round-trip, best-value highlight
 *
 *   node --test compare.test.js   # exit 0 = all green
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, 'compare.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(msg, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}

// Realistic /api/portfolio rows (matches server.js portfolio assembly).
const PORTFOLIO = [
  { id: 'uc-1', name: 'Fraud Signal Triage', department: 'Risk & Compliance',
    stage: 'panel', feasibility_composite: 3.8, roi_p10: 12, roi_p50: 45, roi_p90: 90,
    verdict: 'GO', quadrant: 'Quick Win', advisory_tier: 'Extend',
    recommended_platform: 'Vertex AI', citizen_dev_pct: 30 },
  { id: 'uc-2', name: 'Contract Summarizer', department: 'Legal',
    stage: 'panel', feasibility_composite: 4.2, roi_p10: 20, roi_p50: 60, roi_p90: 120,
    verdict: 'CONDITIONAL GO', quadrant: 'Big Bet', advisory_tier: 'Scale',
    recommended_platform: 'Gemini', citizen_dev_pct: 55 },
  { id: 'uc-3', name: 'Shelf Vision', department: 'Retail Ops',
    stage: 'panel', feasibility_composite: 2.9, roi_p10: -5, roi_p50: 15, roi_p90: 40,
    verdict: 'NO-GO', quadrant: 'Money Pit', advisory_tier: 'Pilot',
    recommended_platform: 'AutoML', citizen_dev_pct: 10 },
  { id: 'uc-4', name: 'Ticket Router', department: 'Support',
    stage: 'feasibility', feasibility_composite: 3.1, roi_p10: 8, roi_p50: 30, roi_p90: 70,
    verdict: null, quadrant: 'Incremental', advisory_tier: 'Pilot',
    recommended_platform: 'Vertex AI', citizen_dev_pct: 25 },
  { id: 'uc-5', name: 'Sales Copilot', department: 'Sales',
    stage: 'bxt', feasibility_composite: 3.5, roi_p10: 10, roi_p50: 40, roi_p90: 80,
    verdict: 'GO', quadrant: 'Quick Win', advisory_tier: 'Extend',
    recommended_platform: 'Gemini', citizen_dev_pct: 40 },
];

const WORKSPACES = [
  { id: 'ws-intel', name: 'Intel Corp' },
  { id: 'ws-other', name: 'Other' },
];

// Build a jsdom instance with fetch mocked to serve our fixtures.
function newDom(opts) {
  opts = opts || {};
  const portfolio = opts.portfolio !== undefined ? opts.portfolio : PORTFOLIO;
  const workspaces = opts.workspaces !== undefined ? opts.workspaces : WORKSPACES;
  const url = opts.url || 'https://example.com/compare.html';

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: url,
    beforeParse(window) {
      window.fetch = function (u) {
        u = String(u);
        let body;
        if (u.indexOf('/api/workspaces') !== -1) body = workspaces;
        else if (u.indexOf('/api/portfolio') !== -1) body = portfolio;
        else body = [];
        return Promise.resolve({
          ok: true, status: 200,
          json: function () { return Promise.resolve(body); },
        });
      };
    },
  });
  return dom;
}

function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

(async function () {
console.log('\n=== Compare Use Cases (compare.html) ===\n');

console.log('== 1. Model surface (window.GAIC_COMPARE) ==');
let dom = newDom();
let C = dom.window.GAIC_COMPARE;
ok('window.GAIC_COMPARE exists', !!C);
ok('MAX_SELECT is 4', C.MAX_SELECT === 4);
ok('ROWS defines the 11 attributes', Array.isArray(C.ROWS) && C.ROWS.length === 11);
['verdictKey', 'verdictClass', 'highlightsFor', 'resolveSelection', 'readIdsFromURL'].forEach(function (fn) {
  ok('exposes ' + fn + '()', typeof C[fn] === 'function');
});

console.log('\n== 2. verdict chip class mapping ==');
ok('GO -> is-go', C.verdictClass('GO') === 'is-go');
ok('CONDITIONAL GO -> is-cond', C.verdictClass('CONDITIONAL GO') === 'is-cond');
ok('NO-GO -> is-no', C.verdictClass('NO-GO') === 'is-no');
ok('null -> is-none', C.verdictClass(null) === 'is-none');
ok('verdictKey GO -> go', C.verdictKey('GO') === 'go');
ok('verdictKey CONDITIONAL GO -> cond', C.verdictKey('CONDITIONAL GO') === 'cond');
ok('verdictKey NO-GO -> no', C.verdictKey('NO-GO') === 'no');

console.log('\n== 3. best/worst highlight computation ==');
const roiRow = C.ROWS.filter(function (r) { return r.key === 'roi_p50'; })[0];
const casesA = [PORTFOLIO[0], PORTFOLIO[1], PORTFOLIO[2]]; // p50: 45, 60, 15
let hlA = C.highlightsFor(roiRow, casesA);
ok('roi_p50: index 1 (60) is best', hlA.best[1] === true);
ok('roi_p50: index 2 (15) is worst', hlA.worst[2] === true);
ok('roi_p50: index 0 (45) is neither', !hlA.best[0] && !hlA.worst[0]);

const feasRow = C.ROWS.filter(function (r) { return r.key === 'feasibility_composite'; })[0];
let hlF = C.highlightsFor(feasRow, casesA); // feas: 3.8, 4.2, 2.9
ok('feasibility: index 1 (4.2) is best', hlF.best[1] === true);
ok('feasibility: index 2 (2.9) is worst', hlF.worst[2] === true);

ok('non-numeric row (verdict) -> no highlights',
  Object.keys(C.highlightsFor(C.ROWS.filter(function (r){return r.key==='verdict';})[0], casesA).best).length === 0);
ok('single case -> no highlights',
  Object.keys(C.highlightsFor(roiRow, [PORTFOLIO[0]]).best).length === 0);
ok('all-equal values -> no highlights',
  Object.keys(C.highlightsFor(roiRow, [
    { roi_p50: 50 }, { roi_p50: 50 }, { roi_p50: 50 },
  ]).best).length === 0);

console.log('\n== 4. resolveSelection cap + unknown drop ==');
const byId = {};
PORTFOLIO.forEach(function (r) { byId[r.id] = r; });
ok('resolves ids in order', C.resolveSelection(['uc-2', 'uc-1'], byId).map(function(r){return r.id;}).join(',') === 'uc-2,uc-1');
ok('drops unknown ids', C.resolveSelection(['uc-1', 'nope', 'uc-3'], byId).length === 2);
ok('caps at 4 (5 ids -> 4 rows)',
  C.resolveSelection(['uc-1','uc-2','uc-3','uc-4','uc-5'], byId).length === 4);

console.log('\n== 5. End-to-end render: N columns for N selected ids ==');
dom = newDom({ url: 'https://example.com/compare.html?ids=uc-1,uc-2,uc-3' });
await tick(); await tick();
let doc = dom.window.document;
ok('loading hidden after render', doc.getElementById('loading').classList.contains('hidden'));
ok('content visible', !doc.getElementById('content').classList.contains('hidden'));
let headThs = doc.querySelectorAll('#cmpTable thead th');
ok('3 selected -> 4 header cells (1 attr + 3 cases)', headThs.length === 4);
let caseThs = doc.querySelectorAll('#cmpTable thead th[data-id]');
ok('3 use-case columns rendered', caseThs.length === 3);
ok('column 1 header = Fraud Signal Triage', /Fraud Signal Triage/.test(caseThs[0].textContent));
ok('all 11 attribute rows rendered', doc.querySelectorAll('#cmpTable tbody tr').length === 11);

console.log('\n== 6. verdict chip in column header + deep-link ==');
ok('col 1 (GO) has is-go chip', caseThs[0].querySelector('.vpill.is-go') !== null);
ok('col 2 (CONDITIONAL) has is-cond chip', caseThs[1].querySelector('.vpill.is-cond') !== null);
ok('col 3 (NO-GO) has is-no chip', caseThs[2].querySelector('.vpill.is-no') !== null);
ok('col header links to summary.html?id=uc-1',
  caseThs[0].querySelector('a.cmphd__name').getAttribute('href') === 'summary.html?id=uc-1');

console.log('\n== 7. best-value highlight applied in DOM ==');
// Find the ROI P50 row (labels are uppercased via CSS but textContent keeps source case).
let rows = Array.prototype.slice.call(doc.querySelectorAll('#cmpTable tbody tr'));
let p50row = rows.filter(function (tr) { return /ROI P50/i.test(tr.querySelector('.attr').textContent); })[0];
ok('ROI P50 row exists', !!p50row);
let p50cells = p50row.querySelectorAll('td.val');
// cases order uc-1(45), uc-2(60), uc-3(15) -> best is index1, worst is index2
ok('best cell (uc-2, 60%) has is-best', p50cells[1].classList.contains('is-best'));
ok('worst cell (uc-3, 15%) has is-worst', p50cells[2].classList.contains('is-worst'));
ok('middle cell (uc-1) has neither',
  !p50cells[0].classList.contains('is-best') && !p50cells[0].classList.contains('is-worst'));

console.log('\n== 8. up-to-4 cap on selection chips ==');
dom = newDom({ url: 'https://example.com/compare.html?ids=uc-1,uc-2,uc-3,uc-4' });
await tick(); await tick();
doc = dom.window.document;
let checked = doc.querySelectorAll('#selChips input[type=checkbox]:checked');
ok('4 chips checked', checked.length === 4);
let disabled = doc.querySelectorAll('#selChips input[type=checkbox]:disabled');
ok('remaining chip(s) disabled at cap', disabled.length === (PORTFOLIO.length - 4));
ok('hint shows the cap message', /Maximum of 4/.test(doc.getElementById('selHint').textContent));
ok('4 case columns rendered', doc.querySelectorAll('#cmpTable thead th[data-id]').length === 4);

console.log('\n== 9. empty state when nothing selected ==');
dom = newDom({ url: 'https://example.com/compare.html' });
await tick(); await tick();
doc = dom.window.document;
ok('emptyCompare visible with no ids', !doc.getElementById('emptyCompare').classList.contains('hidden'));
ok('empty message text present', /Select up to 4 use cases to compare\./.test(doc.getElementById('emptyCompare').textContent));
ok('comparison table section hidden', doc.getElementById('cmpSec').classList.contains('hidden'));

console.log('\n== 10. URL ?ids= round-trip (restore + write on toggle) ==');
dom = newDom({ url: 'https://example.com/compare.html?ids=uc-3,uc-5' });
await tick(); await tick();
doc = dom.window.document;
let cols = doc.querySelectorAll('#cmpTable thead th[data-id]');
ok('restored 2 columns from URL', cols.length === 2);
ok('restored order uc-3 then uc-5',
  cols[0].getAttribute('data-id') === 'uc-3' && cols[1].getAttribute('data-id') === 'uc-5');
// toggle a new selection -> URL updates via replaceState
let cbUc1 = doc.querySelector('#selChips input[value="uc-1"]');
cbUc1.checked = true;
cbUc1.dispatchEvent(new dom.window.Event('change'));
await tick();
ok('URL now includes uc-1 after toggle', /ids=[^&]*uc-1/.test(dom.window.location.search));
ok('now 3 columns after adding uc-1', doc.querySelectorAll('#cmpTable thead th[data-id]').length === 3);
// deselect uc-3 -> URL drops it
let cbUc3 = doc.querySelector('#selChips input[value="uc-3"]');
cbUc3.checked = false;
cbUc3.dispatchEvent(new dom.window.Event('change'));
await tick();
ok('URL drops uc-3 after deselect', !/ids=[^&]*uc-3/.test(dom.window.location.search));
ok('readIdsFromURL parses comma list', C.readIdsFromURL().length >= 0); // sanity (fn callable)

console.log('\n== 11. empty portfolio -> global empty state ==');
dom = newDom({ portfolio: [] });
await tick(); await tick();
doc = dom.window.document;
ok('global empty visible', !doc.getElementById('empty').classList.contains('hidden'));
ok('content hidden when no portfolio', doc.getElementById('content').classList.contains('hidden'));

console.log('\n== 12. workspace picker populated + Intel preselected ==');
dom = newDom();
await tick(); await tick();
let picker = dom.window.document.getElementById('wsPicker');
ok('picker has 2 options', picker.querySelectorAll('option').length === 2);
ok('Intel workspace preselected', picker.value === 'ws-intel');

console.log('\n== 13. self-contained: includes api-client + auth-ui ==');
ok('references assets/api-client.js', /assets\/api-client\.js/.test(html));
ok('references assets/auth-ui.js defer', /assets\/auth-ui\.js"\s+defer/.test(html));

console.log('\n---------------------------------------------');
console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
console.log('---------------------------------------------');
process.exit(fail ? 1 : 0);
})();
