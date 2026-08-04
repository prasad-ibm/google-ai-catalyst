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

console.log('\n---------------------------------------------');
console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
console.log('---------------------------------------------');
process.exit(fail ? 1 : 0);
})();
