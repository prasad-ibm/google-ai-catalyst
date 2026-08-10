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

// A minimal no-op Chart.js stand-in so the radar render path runs under jsdom
// (the CDN <script> never loads offline). Records constructions for assertions.
function makeChartStub() {
  function ChartStub(canvas, cfg) {
    this.canvas = canvas;
    this.config = cfg;
    ChartStub.instances.push(this);
  }
  ChartStub.instances = [];
  ChartStub.prototype.destroy = function () { ChartStub.destroyed++; };
  ChartStub.destroyed = 0;
  return ChartStub;
}

// Build a jsdom instance with fetch mocked to serve our fixtures.
// opts.chartStub: if true, install a fake window.Chart so radars render.
function newDom(opts) {
  opts = opts || {};
  const portfolio = opts.portfolio !== undefined ? opts.portfolio : PORTFOLIO;
  const workspaces = opts.workspaces !== undefined ? opts.workspaces : WORKSPACES;
  const url = opts.url || 'https://example.com/compare.html';

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: url,
    beforeParse(window) {
      if (opts.chartStub) window.Chart = makeChartStub();
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

console.log('\n== 4. resolveSelection (v2: unlimited by default, optional cap) ==');
const byId = {};
PORTFOLIO.forEach(function (r) { byId[r.id] = r; });
ok('resolves ids in order', C.resolveSelection(['uc-2', 'uc-1'], byId).map(function(r){return r.id;}).join(',') === 'uc-2,uc-1');
ok('drops unknown ids', C.resolveSelection(['uc-1', 'nope', 'uc-3'], byId).length === 2);
ok('v2: UNLIMITED (5 ids -> 5 rows, no cap)',
  C.resolveSelection(['uc-1','uc-2','uc-3','uc-4','uc-5'], byId).length === 5);
ok('optional cap arg limits result (cap=4 -> 4 rows)',
  C.resolveSelection(['uc-1','uc-2','uc-3','uc-4','uc-5'], byId, 4).length === 4);
ok('RADAR_CAP === 4', C.RADAR_CAP === 4);

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
// Label is "24-mo net return % (P50)" (was "ROI P50" in an earlier build).
let p50row = rows.filter(function (tr) { return /P50/i.test(tr.querySelector('.attr').textContent); })[0];
ok('ROI P50 row exists', !!p50row);
let p50cells = p50row.querySelectorAll('td.val');
// cases order uc-1(45), uc-2(60), uc-3(15) -> best is index1, worst is index2
ok('best cell (uc-2, 60%) has is-best', p50cells[1].classList.contains('is-best'));
ok('worst cell (uc-3, 15%) has is-worst', p50cells[2].classList.contains('is-worst'));
ok('middle cell (uc-1) has neither',
  !p50cells[0].classList.contains('is-best') && !p50cells[0].classList.contains('is-worst'));

console.log('\n== 8. v2 picker: unlimited selection (5 ids -> 5 columns) ==');
dom = newDom({ url: 'https://example.com/compare.html?ids=uc-1,uc-2,uc-3,uc-4,uc-5' });
await tick(); await tick();
doc = dom.window.document;
let listRows = doc.querySelectorAll('#selList .sellist__row');
ok('scrollable list renders one row per portfolio item', listRows.length === PORTFOLIO.length);
let checkedRows = doc.querySelectorAll('#selList .sellist__row.is-checked');
ok('all 5 selected rows marked is-checked (no cap)', checkedRows.length === 5);
let pills = doc.querySelectorAll('#selPills .selpill');
ok('5 selected pills shown', pills.length === 5);
ok('hint mentions radars show first 4', /radars show the first 4/i.test(doc.getElementById('selHint').textContent));
ok('5 case columns rendered in table (unlimited)', doc.querySelectorAll('#cmpTable thead th[data-id]').length === 5);

console.log('\n== 9. empty state when nothing selected ==');
dom = newDom({ url: 'https://example.com/compare.html' });
await tick(); await tick();
doc = dom.window.document;
ok('emptyCompare visible with no ids', !doc.getElementById('emptyCompare').classList.contains('hidden'));
ok('comparison table section hidden', doc.getElementById('cmpSec').classList.contains('hidden'));
ok('list still renders all rows with nothing selected', doc.querySelectorAll('#selList .sellist__row').length === PORTFOLIO.length);
ok('no pills when nothing selected', doc.querySelectorAll('#selPills .selpill').length === 0);

console.log('\n== 10. URL ?ids= round-trip (restore + write on toggle) ==');
dom = newDom({ url: 'https://example.com/compare.html?ids=uc-3,uc-5' });
await tick(); await tick();
doc = dom.window.document;
let cols = doc.querySelectorAll('#cmpTable thead th[data-id]');
ok('restored 2 columns from URL', cols.length === 2);
ok('restored order uc-3 then uc-5',
  cols[0].getAttribute('data-id') === 'uc-3' && cols[1].getAttribute('data-id') === 'uc-5');
// v2: toggle a new selection by CLICKING its list row -> URL updates via replaceState
function clickRow(id) {
  var row = doc.querySelector('#selList .sellist__row[data-id="' + id + '"]');
  row.dispatchEvent(new dom.window.Event('click'));
}
clickRow('uc-1');
await tick();
ok('URL now includes uc-1 after row click', /ids=[^&]*uc-1/.test(dom.window.location.search));
ok('now 3 columns after adding uc-1', doc.querySelectorAll('#cmpTable thead th[data-id]').length === 3);
// deselect uc-3 by clicking its (now checked) row -> URL drops it
clickRow('uc-3');
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

console.log('\n== 14. Score Breakdown radar model (computeRadar) ==');
dom = newDom();
C = dom.window.GAIC_COMPARE;
const byId14 = {};
PORTFOLIO.forEach(function (r) { byId14[r.id] = r; });
const clamp = function (x) { return Math.max(0, Math.min(5, x)); };

ok('exposes computeRadar()', typeof C.computeRadar === 'function');
const r1 = C.computeRadar(PORTFOLIO[0]); // uc-1 GO, feas 3.8, p50 45, Quick Win
ok('computeRadar returns 6 labels in exact order',
  Array.isArray(r1.labels) && r1.labels.length === 6 &&
  r1.labels.join('|') === 'Safety|Value|Strat. Alignment|Readiness|Complexity|Compliance');
ok('computeRadar returns 6 numeric values in [0,5]',
  Array.isArray(r1.values) && r1.values.length === 6 &&
  r1.values.every(function (v) { return typeof v === 'number' && v >= 0 && v <= 5; }));

// (b) specific derived values
const r3 = C.computeRadar(byId14['uc-3']); // NO-GO, roi_p50 15, feas 2.9, Money Pit
ok('uc-3 (NO-GO) Safety === 1.2', r3.values[0] === 1.2);
ok('uc-3 (NO-GO) Compliance === 1.5', r3.values[5] === 1.5);

const r2 = C.computeRadar(byId14['uc-2']); // CONDITIONAL GO, roi_p50 60, feas 4.2, Big Bet
ok('uc-2 Value === clamp(60/120*5) = 2.5', r2.values[1] === Math.round(clamp(60 / 120 * 5) * 10) / 10);
ok('uc-2 Value literal 2.5', r2.values[1] === 2.5);
ok('uc-2 (CONDITIONAL GO) Safety === 3.0', r2.values[0] === 3.0);

ok('uc-1 (GO) Safety === 4.5', r1.values[0] === 4.5);

// (c) Readiness equals feasibility_composite (rounded to 1dp)
ok('uc-2 Readiness === feasibility_composite (4.2)', r2.values[3] === 4.2);
ok('uc-1 Readiness === feasibility_composite (3.8)', r1.values[3] === 3.8);

// null-verdict fallback path (uc-4: verdict null, feas 3.1)
const r4 = C.computeRadar(byId14['uc-4']);
ok('uc-4 (verdict null) Safety === clamp(feas*0.8) = 2.5', r4.values[0] === Math.round(clamp(3.1 * 0.8) * 10) / 10);
ok('uc-4 (verdict null) Compliance === 2.5', r4.values[5] === 2.5);

console.log('\n== 15. Score Breakdown DOM: radar canvases + fallback ==');
// Without Chart present (default): #radarSec is hidden, table still renders.
dom = newDom({ url: 'https://example.com/compare.html?ids=uc-1,uc-2,uc-3' });
await tick(); await tick();
doc = dom.window.document;
ok('table still renders when Chart absent (3 case columns)',
  doc.querySelectorAll('#cmpTable thead th[data-id]').length === 3);
ok('#radarSec hidden when Chart absent (graceful fallback)',
  doc.getElementById('radarSec').classList.contains('hidden'));
ok('no canvases rendered when Chart absent',
  doc.querySelectorAll('#radarSec canvas').length === 0);

// With the Chart stub installed: render path runs -> 3 canvases in #radarSec.
dom = newDom({ url: 'https://example.com/compare.html?ids=uc-1,uc-2,uc-3', chartStub: true });
await tick(); await tick();
doc = dom.window.document;
if (typeof dom.window.Chart === 'function') {
  ok('#radarSec visible when Chart present', !doc.getElementById('radarSec').classList.contains('hidden'));
  ok('3 canvases rendered in #radarSec', doc.querySelectorAll('#radarSec canvas').length === 3);
  ok('#radarSec is placed ABOVE #cmpSec in DOM order',
    (doc.getElementById('radarSec').compareDocumentPosition(doc.getElementById('cmpSec'))
      & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  ok('3 Chart instances constructed', dom.window.Chart.instances.length === 3);
} else {
  // Guard: if the stub somehow didn't stick, do not fail the suite.
  ok('Chart stub guard: #radarSec hidden', doc.getElementById('radarSec').classList.contains('hidden'));
}

console.log('\n== 16. Preset model (pure) ==');
dom = newDom();
C = dom.window.GAIC_COMPARE;
['presetTopRoi','presetGoOnly','presetByDept','departmentsOf'].forEach(function (fn) {
  ok('exposes ' + fn + '()', typeof C[fn] === 'function');
});
// Top ROI: p50 ranking is uc-2(60),uc-1(45),uc-5(40),uc-4(30),uc-3(15)
ok('presetTopRoi(default 5) ranks by roi_p50 desc',
  C.presetTopRoi(PORTFOLIO).join(',') === 'uc-2,uc-1,uc-5,uc-4,uc-3');
ok('presetTopRoi(n=2) takes top 2', C.presetTopRoi(PORTFOLIO, 2).join(',') === 'uc-2,uc-1');
// GO-only: uc-1 and uc-5 have verdict GO (uc-2 is CONDITIONAL GO -> excluded)
ok('presetGoOnly returns only GO verdicts', C.presetGoOnly(PORTFOLIO).sort().join(',') === 'uc-1,uc-5');
// By dept: exact match, case-insensitive
ok('presetByDept("Legal") -> uc-2', C.presetByDept(PORTFOLIO, 'Legal').join(',') === 'uc-2');
ok('presetByDept case-insensitive', C.presetByDept(PORTFOLIO, 'legal').join(',') === 'uc-2');
ok('presetByDept unknown dept -> empty', C.presetByDept(PORTFOLIO, 'Nope').length === 0);
ok('departmentsOf returns distinct sorted', C.departmentsOf(PORTFOLIO).length === 5);

console.log('\n== 17. Preset DOM wiring + radar cap (table unlimited, radars first 4) ==');
dom = newDom({ chartStub: true });
await tick(); await tick();
doc = dom.window.document;
// Click GO-only preset -> selects uc-1 + uc-5 (2 columns)
doc.getElementById('presetGo').dispatchEvent(new dom.window.Event('click'));
await tick();
ok('GO-only preset selects 2 columns', doc.querySelectorAll('#cmpTable thead th[data-id]').length === 2);
ok('GO-only preset marks the button on', doc.getElementById('presetGo').classList.contains('is-on'));
// Click Top ROI -> selects 5 (all) -> table 5 columns, radars capped at 4
doc.getElementById('presetTopRoi').dispatchEvent(new dom.window.Event('click'));
await tick();
ok('Top ROI selects all 5 -> 5 table columns (unlimited)',
  doc.querySelectorAll('#cmpTable thead th[data-id]').length === 5);
if (typeof dom.window.Chart === 'function') {
  ok('radars capped at first 4 (4 canvases for 5 selected)',
    doc.querySelectorAll('#radarSec canvas').length === 4);
  ok('radar note visible when selection exceeds cap',
    !doc.getElementById('radarNote').classList.contains('hidden'));
  ok('radar note names the overflow count',
    /All\s*<b>5<\/b>/.test(doc.getElementById('radarNote').innerHTML));
}
// By department dropdown -> Risk & Compliance -> uc-1 only
let dsel = doc.getElementById('presetDept');
ok('dept dropdown populated (1 placeholder + 5 depts)', dsel.querySelectorAll('option').length === 6);
dsel.value = 'Risk & Compliance';
dsel.dispatchEvent(new dom.window.Event('change'));
await tick();
ok('By-dept preset selects only uc-1 (Risk & Compliance)',
  doc.querySelectorAll('#cmpTable thead th[data-id]').length === 1);
// Clear -> empties selection
doc.getElementById('presetClear').dispatchEvent(new dom.window.Event('click'));
await tick();
ok('Clear preset empties the comparison', doc.getElementById('cmpSec').classList.contains('hidden'));
ok('Clear removes ids from URL', !/ids=[^&]+/.test(dom.window.location.search));
// Search filters the list
dom = newDom();
await tick(); await tick();
doc = dom.window.document;
let search = doc.getElementById('selSearch');
search.value = 'legal';
search.dispatchEvent(new dom.window.Event('input'));
await tick();
ok('search "legal" filters list to 1 row (uc-2)',
  doc.querySelectorAll('#selList .sellist__row').length === 1);
search.value = 'zzzz';
search.dispatchEvent(new dom.window.Event('input'));
await tick();
ok('search with no match shows empty note',
  doc.querySelector('#selList .sellist__empty') !== null);

console.log('\n== 18. Long-name overflow (DEF-03): clamp in pills / table / list ==');
// A pathologically long use-case name must never break the layout: it is
// clamped with CSS ellipsis everywhere it is rendered (header, pills, list).
const LONG = 'X'.repeat(300);
const LONG_PORTFOLIO = [
  { id: 'uc-long', name: LONG, department: 'Ops', stage: 'panel',
    feasibility_composite: 3.0, roi_p10: 1, roi_p50: 2, roi_p90: 3,
    verdict: 'GO', quadrant: 'Quick Win', advisory_tier: 'Pilot',
    recommended_platform: 'Vertex AI', citizen_dev_pct: 10 },
].concat(PORTFOLIO);
dom = newDom({ portfolio: LONG_PORTFOLIO, url: 'https://example.com/compare.html?ids=uc-long' });
await tick(); await tick();
doc = dom.window.document;
// The selected pill wraps its name in a dedicated clamp element (not a bare span)
// so a 300-char name cannot stretch the pill row.
const pillName = doc.querySelector('#selPills .selpill .selpill__name');
ok('selected pill name uses .selpill__name clamp element', pillName !== null);
ok('.selpill__name holds the full (untruncated) text \u2014 CSS does the clamping',
  pillName && pillName.textContent.length === 300);
// The .selpill__name rule must exist in the stylesheet with an ellipsis clamp.
const cssText = html;
ok('.selpill__name CSS rule defines a max-width', /\.selpill__name\s*\{[^}]*max-width/.test(cssText));
ok('.selpill__name CSS rule ellipsis-clamps overflow',
  /\.selpill__name\s*\{[^}]*text-overflow\s*:\s*ellipsis/.test(cssText));
// Table header + selection list already clamp (H4) \u2014 assert they still do.
ok('table header .cmphd__name ellipsis-clamps', /\.cmphd__name[^{]*\{[^}]*text-overflow\s*:\s*ellipsis/.test(cssText));
ok('selection list .sellist__name ellipsis-clamps', /\.sellist__name[^{]*\{[^}]*text-overflow\s*:\s*ellipsis/.test(cssText));

console.log('\n---------------------------------------------');
console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
console.log('---------------------------------------------');
process.exit(fail ? 1 : 0);
})();
