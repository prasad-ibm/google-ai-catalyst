/**
 * Gate 5 — Evaluation Summary (summary.html) test suite.
 * Mirrors advisory.test.js: extracts the inline IIFE, runs it inside jsdom,
 * and exercises the pure window.__sum API plus the rendered DOM.
 *
 *   node summary.test.js      # exit 0 = all green
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, 'summary.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(msg, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}

// Build a fresh jsdom for a given localStorage seed set (mirrors advisory.test.js).
function newDom(intake, bxt, feas, advisory) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/summary.html',
    beforeParse(w) {
      if (intake   !== undefined) w.localStorage.setItem('gaic_intake',      JSON.stringify(intake));
      if (bxt      !== undefined) w.localStorage.setItem('gaic_bxt',         JSON.stringify(bxt));
      if (feas     !== undefined) w.localStorage.setItem('gaic_feasibility', JSON.stringify(feas));
      if (advisory !== undefined) w.localStorage.setItem('gaic_advisory',    JSON.stringify(advisory));
    }
  });
}

console.log('\n=== Gate 5 · Evaluation Summary (summary.html) ===\n');

// Representative "full pipeline" state.
const INTAKE = {
  name: 'Fraud Signal Triage', value: '$1M–$5M', users: '200–1000',
  autonomy: 'Supervised', pii: true, audit: true
};
const BXT  = { scores: { B:{score:80}, X:{score:72}, T:{score:78} }, verdict:{ verdict:'PASS' } };
const FEAS = {
  composite: 3.8,
  scores: { biz_value:4, strat_align:4, data_value:3, data_avail:3, tech_complex:3, integ_effort:3, ttv:3, safety:4, compliance:4, user_value:4 },
  pillars: { strategic:4.0, technical:3.5, org:3.7 },
  quadrant: 'Quick Win', risk: 'Low',
  citizenDev: { pct:60, path:'Hybrid team' }
};
const ADV  = { tier:'Extend', verdictName:'Scale Smart', platform:'AppSheet / Agentspace', compliance:{ label:'COMPLIANT', ok:true } };

const dom = newDom(INTAKE, BXT, FEAS, ADV);
const api = dom.window.__sum;
const d = dom.window.document;

console.log('== 1. Test API surface exposed ==');
ok('window.__sum exists', !!api);
['monteCarloROI','frameworkRollup','governanceChecklist','govTally','computeSummary'].forEach(fn =>
  ok('exposes ' + fn + '()', typeof api[fn] === 'function'));
ok('storage keys use gaic_ prefix', api.SUMMARY_KEY === 'gaic_summary');

console.log('\n== 2. Monte Carlo ROI: P10 <= P50 <= P90 (deterministic) ==');
const roi = api.monteCarloROI(INTAKE, FEAS, ADV, 10000);
ok('p10/p50/p90 are numbers', [roi.p10, roi.p50, roi.p90].every(n => typeof n === 'number' && !isNaN(n)));
ok('P10 <= P50', roi.p10 <= roi.p50);
ok('P50 <= P90', roi.p50 <= roi.p90);
ok('reports 10,000 trials', roi.trials === 10000);
ok('carries value & cost basis', roi.value > 0 && roi.cost > 0);
ok('usd band present at each percentile', typeof roi.usd.p10 === 'number' && typeof roi.usd.p50 === 'number' && typeof roi.usd.p90 === 'number');

console.log('\n== 3. Monte Carlo is deterministic (same inputs -> same result) ==');
const roiA = api.monteCarloROI(INTAKE, FEAS, ADV, 2000);
const roiB = api.monteCarloROI(INTAKE, FEAS, ADV, 2000);
ok('repeat run identical P10', roiA.p10 === roiB.p10);
ok('repeat run identical P50', roiA.p50 === roiB.p50);
ok('repeat run identical P90', roiA.p90 === roiB.p90);
ok('no Math.random() call in source (deterministic PRNG only)', !/Math\.random\s*\(/.test(html));

console.log('\n== 4. Higher feasibility composite tightens the band ==');
const tight = api.monteCarloROI(INTAKE, Object.assign({}, FEAS, { composite: 5.0 }), ADV, 4000);
const loose = api.monteCarloROI(INTAKE, Object.assign({}, FEAS, { composite: 1.5 }), ADV, 4000);
ok('low-composite band is wider than high-composite band', (loose.p90 - loose.p10) > (tight.p90 - tight.p10));

console.log('\n== 5. Framework rollup: 4 published frameworks, 0..100 scores ==');
const fws = api.frameworkRollup(BXT, FEAS, ADV, roi);
ok('exactly 4 frameworks', fws.length === 4);
ok('keys are gadf/caf/strategic/gartner', fws.map(f => f.key).join(',') === 'gadf,caf,strategic,gartner');
ok('all scores within 0..100', fws.every(f => f.score >= 0 && f.score <= 100));
ok('each framework has metrics', fws.every(f => Array.isArray(f.metrics) && f.metrics.length >= 3));
ok('GADF averages BXT B/X/T (80,72,78 -> ~77)', fws[0].score === Math.round((80+72+78)/3));

console.log('\n== 6. Governance checklist: derived, valid statuses ==');
const gov = api.governanceChecklist(INTAKE, FEAS, ADV);
ok('produces 6 checklist items', gov.length === 6);
ok('every status is pass/warn/fail', gov.every(g => ['pass','warn','fail'].includes(g.status)));
ok('PII item present (intake.pii=true)', gov.some(g => g.key === 'pii'));
const govTally = api.govTally(gov);
ok('tally readiness is READY/CONDITIONAL/BLOCKED', ['READY','CONDITIONAL','BLOCKED'].includes(govTally.readiness));

console.log('\n== 7. Governance responds to inputs (PII w/o audit => fail) ==');
const govNoAudit = api.governanceChecklist(Object.assign({}, INTAKE, { pii:true, audit:false }), FEAS, ADV);
ok('PII without audit trail => fail', govNoAudit.find(g => g.key === 'pii').status === 'fail');
const govLowSafety = api.governanceChecklist(INTAKE, Object.assign({}, FEAS, { scores: Object.assign({}, FEAS.scores, { safety:2 }) }), ADV);
ok('low safety score => fail', govLowSafety.find(g => g.key === 'safety').status === 'fail');
const govHighRisk = api.governanceChecklist(INTAKE, Object.assign({}, FEAS, { risk:'High' }), ADV);
ok('High risk tier => fail on risk gate', govHighRisk.find(g => g.key === 'risk').status === 'fail');

console.log('\n== 8. computeSummary() rolls everything into one model ==');
const model = api.computeSummary({ intake: INTAKE, bxt: BXT, feas: FEAS, advisory: ADV, trials: 3000 });
ok('model has roi/frameworks/governance/tally', !!(model.roi && model.frameworks && model.governance && model.tally));
ok('portfolio composite 0..100', model.composite >= 0 && model.composite <= 100);
ok('useCase name flows through', model.useCase === 'Fraud Signal Triage');

console.log('\n== 8b. #3: persisted ROI override is applied BEFORE frameworkRollup (hero == Gartner foot) ==');
// Simulate a deep-linked case whose committed Gate-5 P50 (e.g. +336%) differs from
// the raw Monte-Carlo recompute. The hero, the Gartner foot caption, and any other
// p50 reference must all show the SAME final roi.p50 — not the raw MC p50.
const COMMITTED_P50 = 336;
const modelDL = api.computeSummary({
  intake: INTAKE, bxt: BXT, feas: FEAS, advisory: ADV, trials: 3000,
  panelSummary: { roi: { p10: 120, p50: COMMITTED_P50, p90: 560 } }
});
ok('hero roi.p50 uses committed override (' + COMMITTED_P50 + ')', modelDL.roi.p50 === COMMITTED_P50);
const gartnerCard = modelDL.frameworks.find(f => f.key === 'gartner');
ok('Gartner card present', !!gartnerCard);
// Extract the P50 the Gartner foot renders and compare to the hero value.
const footMatch = /P50 ROI <b>([+\-]?[\d,]+)%<\/b>/.exec(gartnerCard.foot);
ok('Gartner foot exposes a P50 percentage', !!footMatch);
const gartnerFootP50 = footMatch ? Number(footMatch[1].replace(/[+,]/g, '')) : NaN;
ok('Gartner foot P50 (' + gartnerFootP50 + ') == hero P50 (' + modelDL.roi.p50 + ')', gartnerFootP50 === modelDL.roi.p50);
ok('Gartner foot P50 is NOT the raw Monte-Carlo p50', gartnerFootP50 !== api.monteCarloROI(INTAKE, FEAS, ADV, 3000).p50);

// Sections 9+ depend on init() which runs on DOMContentLoaded (async in jsdom).
setTimeout(() => {
console.log('\n== 9. DOM render: ROI hero + framework cards + governance rows ==');
ok('ROI name populated (not placeholder)', d.getElementById('roiName').textContent !== '\u2014');
ok('P50 value shows a percentage', /%$/.test(d.getElementById('p50Val').textContent));
ok('renders 4 framework cards', d.querySelectorAll('#fwgrid .fwcard').length === 4);
ok('renders 6 governance rows', d.querySelectorAll('#govList .gov__row').length === 6);
ok('workspace eval line names the use case', /Fraud Signal Triage/.test(d.getElementById('wsEval').textContent));

console.log('\n== 10. Persistence: writes gaic_summary for Gate 6 ==');
const stored = JSON.parse(dom.window.localStorage.getItem('gaic_summary'));
ok('gaic_summary persisted', !!stored);
ok('persists roi band', stored.roi && typeof stored.roi.p50 === 'number');
ok('persists 4 framework scores', stored.frameworks.length === 4);
ok('persists governance readiness', ['READY','CONDITIONAL','BLOCKED'].includes(stored.readiness));

console.log('\n== 11. Header / stepper fidelity ==');
ok('product tag "Enterprise Advantage"', /Enterprise Advantage/.test(html));
ok('wordmark "Google AI Catalyst"', /Google <b>AI Catalyst<\/b>/.test(html));
ok('6-gate stepper present', d.querySelectorAll('#gates .gate').length === 6);
ok('Gate 5 is active', d.querySelector('#gates .gate.is-active .gate__label').textContent === 'Evaluation Summary');

console.log('\n== 12. Re-run recomputes without error ==');
d.getElementById('btnRerun').click();
ok('re-run keeps gaic_summary valid', !!JSON.parse(dom.window.localStorage.getItem('gaic_summary')).roi);

console.log('\n== 13. Footer nav: Back -> advisory, Continue -> panel ==');
ok('Back button targets advisory.html', d.getElementById('btnBack').getAttribute('href') === 'advisory.html');
ok('Continue button targets panel.html', d.getElementById('btnContinue').getAttribute('href') === 'panel.html');
ok('Continue label mentions Executive Review Panel', /Executive Review Panel/.test(d.getElementById('btnContinue').textContent));

console.log('\n== 14. Graceful demo fallback (no localStorage) ==');
const domD = newDom(undefined, undefined, undefined, undefined);
const apiD = domD.window.__sum;
const dD = domD.window.document;
ok('loadIntake would fall back to demo', apiD.DEMO_INTAKE.name === 'Customer Sentiment Analysis');
const demoRoi = apiD.computeSummary().roi;
ok('demo ROI still ordered P10<=P50<=P90', demoRoi.p10 <= demoRoi.p50 && demoRoi.p50 <= demoRoi.p90);
// demo dom's own init() runs on its DOMContentLoaded — assert after a tick.
setTimeout(() => {
ok('demo model still renders 4 framework cards', dD.querySelectorAll('#fwgrid .fwcard').length === 4);
ok('demo model still renders 6 governance rows', dD.querySelectorAll('#govList .gov__row').length === 6);
ok('demo writes gaic_summary', !!domD.window.localStorage.getItem('gaic_summary'));

console.log('\n== 15. Zero Microsoft strings; Google framing present ==');
ok('contains Google framing (GADF / AppSheet / Agentspace / Cloud Adoption Framework)',
   /(GADF|AppSheet \/ Agentspace|Google Cloud Adoption Framework|Responsible-AI)/.test(html));
const microsoft = ['MAIDF','Copilot','Power Platform','Azure','M365','watsonx','Agentforce','Salesforce','Microsoft','Dataverse','Dynamics','Blob'];
microsoft.forEach(m => ok('NO Microsoft string "'+m+'"',
  !new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(html)));

console.log('\n---------------------------------------------');
console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
console.log('---------------------------------------------');
process.exit(fail ? 1 : 0);
}, 30);
}, 30);
