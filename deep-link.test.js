/**
 * Deep-link helper (assets/deep-link.js) test suite.
 * Loads the module inside jsdom, mocks GAIC_API, and exercises:
 *   - getId() query-param parsing
 *   - the DB-row -> compute-shape mappers (intake/bxt/feas/advisory/summary)
 *   - load() end-to-end (API row -> opts) incl. the offline fallback shape
 *
 *   node deep-link.test.js      # exit 0 = all green
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const JS_PATH = path.join(__dirname, 'assets', 'deep-link.js');
const src = fs.readFileSync(JS_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(msg, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}

// A realistic /api/use-cases/:id response row (matches server.js assembly).
const API_ROW = {
  id: 'uc-42',
  name: 'Fraud Signal Triage',
  department: 'Risk & Compliance',
  executive_sponsor: 'Dana Lee',
  description: 'Triage suspected fraud alerts.',
  business_context: { driver: 'Cost', value: '$1M–$5M', users: '200–1000' },
  current_state: { maturity: 'Piloting' },
  technical_context: { sources: ['CRM', 'Data Warehouse'] },
  risk_compliance: { pii: true, audit: true, autonomy: 'Supervised', sensitivity: 'High' },
  bxt: {
    business_score: 80, experience_score: 72, technology_score: 78, verdict: 'PASS',
    detail: { weakKey: 'X', weakName: 'Experience', weakScore: 72, factors: { B: {}, X: {}, T: {} } }
  },
  feasibility: {
    composite: 3.8, quadrant: 'Quick Win', risk_tier: 'Low', citizen_dev_pct: 60,
    criteria: { data_avail: 3, integ_effort: 3, strat_align: 4, safety: 4, compliance: 4 },
    pillars: { strategic: 4.0, technical: 3.5, org: 3.7 }
  },
  advisory: {
    tier: 'Extend', verdict_name: 'Scale Smart', recommended_platform: 'AppSheet / Agentspace',
    gate_resolved: 'Gate 4', reasoning: { compliance: { label: 'COMPLIANT', ok: true }, riskTier: 'Low' }
  },
  summary: {
    roi_p10: 40, roi_p50: 120, roi_p90: 260, readiness: 'CONDITIONAL',
    frameworks: [{ key: 'gadf', name: 'GADF', score: 77 }, { key: 'caf', name: 'CAF', score: 71 }],
    governance: [{ key: 'pii', status: 'pass' }]
  },
  verdict: { verdict: 'PROCEED', binding_condition: 'Add DLP' }
};

function newDom(url, api) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'dangerously', url: url || 'https://example.com/summary.html'
  });
  if (api !== undefined) dom.window.GAIC_API = api;
  const scriptEl = dom.window.document.createElement('script');
  scriptEl.textContent = src;
  dom.window.document.body.appendChild(scriptEl);
  return dom;
}

(async function () {
console.log('\n=== Deep-link helper (assets/deep-link.js) ===\n');

console.log('== 1. Module surface ==');
let dom = newDom('https://example.com/summary.html?id=uc-42');
let DL = dom.window.GAIC_DEEPLINK;
ok('window.GAIC_DEEPLINK exists', !!DL);
['getId','mapUseCase','mapIntake','mapBxt','mapFeasibility','mapAdvisory','mapPanelSummary','load']
  .forEach(fn => ok('exposes ' + fn + '()', typeof DL[fn] === 'function'));

console.log('\n== 2. getId() query parsing ==');
ok('reads ?id=uc-42', DL.getId() === 'uc-42');
ok('trims whitespace', newDom('https://x/summary.html?id=%20uc-9%20').window.GAIC_DEEPLINK.getId() === 'uc-9');
ok('no id -> null', newDom('https://x/summary.html').window.GAIC_DEEPLINK.getId() === null);
ok('empty id -> null', newDom('https://x/summary.html?id=').window.GAIC_DEEPLINK.getId() === null);

console.log('\n== 3. mapIntake() merges jsonb blobs + top-level fields ==');
const intake = DL.mapIntake(API_ROW);
ok('name flows through', intake.name === 'Fraud Signal Triage');
ok('department -> dept', intake.dept === 'Risk & Compliance');
ok('business_context merged (value)', intake.value === '$1M–$5M');
ok('technical_context merged (sources[])', Array.isArray(intake.sources) && intake.sources.length === 2);
ok('risk_compliance merged (pii)', intake.pii === true);
ok('risk_compliance merged (autonomy)', intake.autonomy === 'Supervised');
ok('null row -> null', DL.mapIntake(null) === null);

console.log('\n== 4. mapBxt() -> compute shape ==');
const bxt = DL.mapBxt(API_ROW.bxt);
ok('B/X/T scores present', bxt.scores.B.score === 80 && bxt.scores.X.score === 72 && bxt.scores.T.score === 78);
ok('verdict.verdict = PASS', bxt.verdict.verdict === 'PASS');
ok('weakKey carried', bxt.verdict.weakKey === 'X');
ok('null -> null', DL.mapBxt(null) === null);

console.log('\n== 5. mapFeasibility() -> compute shape ==');
const feas = DL.mapFeasibility(API_ROW.feasibility);
ok('composite numeric', feas.composite === 3.8);
ok('scores from criteria', feas.scores.safety === 4 && feas.scores.data_avail === 3);
ok('pillars carried', feas.pillars.strategic === 4.0);
ok('quadrant + risk mapped', feas.quadrant === 'Quick Win' && feas.risk === 'Low');
ok('citizenDev.pct mapped', feas.citizenDev.pct === 60);

console.log('\n== 6. mapAdvisory() -> compute shape ==');
const adv = DL.mapAdvisory(API_ROW.advisory);
ok('tier mapped', adv.tier === 'Extend');
ok('verdict_name -> verdictName', adv.verdictName === 'Scale Smart');
ok('recommended_platform -> platform', adv.platform === 'AppSheet / Agentspace');
ok('compliance object from reasoning', adv.compliance && adv.compliance.ok === true && adv.compliance.label === 'COMPLIANT');

console.log('\n== 7. mapPanelSummary() -> panel shape ==');
const ps = DL.mapPanelSummary(API_ROW.summary, intake);
ok('useCase from intake', ps.useCase === 'Fraud Signal Triage');
ok('roi p10/p50/p90 numeric', ps.roi.p10 === 40 && ps.roi.p50 === 120 && ps.roi.p90 === 260);
ok('readiness carried', ps.readiness === 'CONDITIONAL');
ok('frameworks carried', ps.frameworks.length === 2);
ok('composite recomputed from framework mean (77,71 -> 74)', ps.composite === Math.round((77 + 71) / 2));
ok('null summary -> null', DL.mapPanelSummary(null, intake) === null);

console.log('\n== 8. mapUseCase() rolls the full row into opts ==');
const opts = DL.mapUseCase(API_ROW);
ok('has intake/bxt/feas/advisory', !!(opts.intake && opts.bxt && opts.feas && opts.advisory));
ok('has panelSummary', !!opts.panelSummary);
ok('carries raw row', opts.raw === API_ROW);
ok('null row -> null', DL.mapUseCase(null) === null);

console.log('\n== 9. offline fallback shape passes through unchanged ==');
const offline = DL.mapUseCase({
  _offline: true,
  intake: { name: 'X' }, bxt: { scores: {} }, feasibility: { composite: 2 },
  advisory: { tier: 'Pilot' }, summary: { roi: { p50: 5 } }
});
ok('offline intake passthrough', offline.intake.name === 'X');
ok('offline feasibility -> feas', offline.feas.composite === 2);
ok('offline summary -> panelSummary', offline.panelSummary.roi.p50 === 5);

console.log('\n== 10. load() end-to-end (mocked API) ==');
let calledWith = null;
const mockApi = { getUseCase: function (id) { calledWith = id; return Promise.resolve(API_ROW); } };
const loadOpts = await newDom('https://x/summary.html?id=uc-42', mockApi).window.GAIC_DEEPLINK.load();
ok('called getUseCase with the id', calledWith === 'uc-42');
ok('load() resolves opts with intake', loadOpts && loadOpts.intake.name === 'Fraud Signal Triage');
ok('load() stamps opts.id', loadOpts.id === 'uc-42');

console.log('\n== 11. load() safety: no id / no API / API error -> null ==');
const noId = await newDom('https://x/summary.html', mockApi).window.GAIC_DEEPLINK.load();
ok('no ?id -> resolves null', noId === null);
const noApi = await newDom('https://x/summary.html?id=uc-42', undefined).window.GAIC_DEEPLINK.load();
ok('no GAIC_API -> resolves null', noApi === null);
const errApi = { getUseCase: function () { return Promise.reject(new Error('boom')); } };
const errRes = await newDom('https://x/summary.html?id=uc-42', errApi).window.GAIC_DEEPLINK.load();
ok('API error -> resolves null (never throws)', errRes === null);

console.log('\n== 12. getUcId() — URL ?id= first, then localStorage (M1) ==');
['getUcId','wireNav'].forEach(fn => ok('exposes ' + fn + '()', typeof DL[fn] === 'function'));
// URL id wins even when localStorage holds a different (stale) case.
let d = newDom('https://x/feasibility.html?id=uc-99');
d.window.localStorage.setItem('gaic_use_case_id', 'stale-1');
ok('URL ?id beats localStorage', d.window.GAIC_DEEPLINK.getUcId() === 'uc-99');
ok('URL id is persisted to localStorage', d.window.localStorage.getItem('gaic_use_case_id') === 'uc-99');
// No URL id -> fall back to localStorage.
d = newDom('https://x/advisory.html');
d.window.localStorage.setItem('gaic_use_case_id', 'ls-7');
ok('no ?id -> localStorage fallback', d.window.GAIC_DEEPLINK.getUcId() === 'ls-7');
// Neither -> null.
ok('no ?id + empty localStorage -> null', newDom('https://x/advisory.html').window.GAIC_DEEPLINK.getUcId() === null);

console.log('\n== 13. wireNav() — carries id through gate links (M2, no drift) ==');
d = newDom('https://x/feasibility.html?id=uc-77');
let doc = d.window.document;
doc.body.innerHTML =
  '<a id="back" href="bxt.html">Back</a>' +
  '<a id="cont" href="advisory.html">Continue</a>' +
  '<a id="crumb" href="summary.html?foo=1">Summary</a>' +
  '<a id="ext" href="https://google.com/help">Help</a>';
d.window.GAIC_DEEPLINK.wireNav('uc-77');
ok('Back link gets ?id', doc.getElementById('back').getAttribute('href') === 'bxt.html?id=uc-77');
ok('Continue link gets ?id', doc.getElementById('cont').getAttribute('href') === 'advisory.html?id=uc-77');
ok('existing query replaced with ?id', doc.getElementById('crumb').getAttribute('href') === 'summary.html?id=uc-77');
ok('non-gate/external link untouched', doc.getElementById('ext').getAttribute('href') === 'https://google.com/help');
ok('id is URL-encoded', (function(){
  var dd = newDom('https://x/feasibility.html');
  dd.window.document.body.innerHTML = '<a id="c" href="advisory.html">c</a>';
  dd.window.GAIC_DEEPLINK.wireNav('a b/c');
  return dd.window.document.getElementById('c').getAttribute('href') === 'advisory.html?id=a%20b%2Fc';
})());
ok('falsy id -> no-op (links unchanged)', (function(){
  var dd = newDom('https://x/feasibility.html');
  dd.window.document.body.innerHTML = '<a id="c" href="advisory.html">c</a>';
  dd.window.GAIC_DEEPLINK.wireNav(null);
  return dd.window.document.getElementById('c').getAttribute('href') === 'advisory.html';
})());

// End-to-end no-drift: feasibility?id=X -> Continue -> advisory resolves SAME X.
console.log('\n== 14. no-drift across consecutive gates ==');
let g1 = newDom('https://x/feasibility.html?id=CASE-X');
g1.window.document.body.innerHTML = '<a id="cont" href="advisory.html">Continue</a>';
g1.window.GAIC_DEEPLINK.wireNav(g1.window.GAIC_DEEPLINK.getUcId());
let nextHref = g1.window.document.getElementById('cont').getAttribute('href');
ok('feasibility Continue -> advisory.html?id=CASE-X', nextHref === 'advisory.html?id=CASE-X');
// Simulate landing on that next URL: the id resolves to the SAME case, not a demo.
let g2 = newDom('https://x/' + nextHref);
ok('advisory resolves the SAME id (no drift to demo)', g2.window.GAIC_DEEPLINK.getUcId() === 'CASE-X');

console.log('\n---------------------------------------------');
console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
console.log('---------------------------------------------');
process.exit(fail ? 1 : 0);
})();
