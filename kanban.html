/**
 * Deep-link integration test: proves summary.html and panel.html, when opened
 * with ?id=<use_case_id>, fetch that case via GAIC_API and render its REAL
 * persisted data (not the demo/localStorage default).
 *
 * jsdom does not fetch external <script src>, so we inline the real
 * assets/deep-link.js and a MOCK GAIC_API ahead of each page's inline IIFE by
 * rewriting the two <script src> tags. The page's own compute/render code is
 * exercised unmodified.
 *
 *   node deep-link-integration.test.js
 */
const fs = require('fs');
const path = require('path');
function requireJsdom() {
  const candidates = ['/tmp/node_modules/jsdom',
    path.join(process.env.HOME || '', 'node_modules/jsdom'), 'jsdom'];
  for (const c of candidates) {
    try { const m = require(c); if (m && m.JSDOM) return m; } catch (e) { /* next */ }
  }
  throw new Error('jsdom not found');
}
const { JSDOM } = requireJsdom();

const DEEPLINK_JS = fs.readFileSync(path.join(__dirname, 'assets', 'deep-link.js'), 'utf8');

let pass = 0, fail = 0;
process.on('uncaughtException', e => { console.error('UNCAUGHT:', e && e.stack || e); process.exit(2); });
const GUARD = setTimeout(() => { console.error('GUARD TIMEOUT pass=' + pass + ' fail=' + fail); process.exit(3); }, 20000);
function ok(msg, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}

// A distinctive use case whose name/values won't collide with any demo defaults.
const API_ROW = {
  id: 'uc-deep-77',
  name: 'Deeplinked Claims Auditor',
  department: 'Finance Operations',
  executive_sponsor: 'R. Okafor',
  description: 'Audits claims for anomalies.',
  business_context: { driver: 'Risk reduction', value: '$1M–$5M', users: '200–1000' },
  current_state: { maturity: 'Piloting' },
  technical_context: { sources: ['Data Warehouse', 'CRM'] },
  risk_compliance: { pii: true, audit: true, autonomy: 'Supervised', sensitivity: 'High' },
  bxt: {
    business_score: 82, experience_score: 70, technology_score: 76, verdict: 'PASS',
    detail: { weakKey: 'X', weakName: 'Experience', weakScore: 70, factors: { B: {}, X: {}, T: {} } }
  },
  feasibility: {
    composite: 3.9, quadrant: 'Quick Win', risk_tier: 'Low', citizen_dev_pct: 55,
    criteria: { data_avail: 4, integ_effort: 3, strat_align: 4, safety: 4, compliance: 4,
                biz_value: 4, strat_align2: 4 },
    pillars: { strategic: 4.1, technical: 3.6, org: 3.8 }
  },
  advisory: {
    tier: 'Extend', verdict_name: 'Scale Smart', recommended_platform: 'AppSheet / Agentspace',
    gate_resolved: 'Gate 4', reasoning: { compliance: { label: 'COMPLIANT', ok: true }, riskTier: 'Low' }
  },
  summary: {
    roi_p10: 55, roi_p50: 140, roi_p90: 300, readiness: 'CONDITIONAL',
    frameworks: [{ key: 'gadf', name: 'GADF', score: 76 }, { key: 'caf', name: 'CAF', score: 70 },
                 { key: 'strategic', name: 'Strategic', score: 80 }, { key: 'gartner', name: 'Gartner', score: 66 }],
    governance: [{ key: 'pii', status: 'pass' }]
  }
};

// Inline mock API + the real deep-link module in place of the two <script src> tags.
function inlineScripts(html) {
  const mock =
    'window.GAIC_API = { getUseCase: function(id){ window.__lastFetchId = id; ' +
    'return Promise.resolve(' + JSON.stringify(API_ROW) + '); }, ' +
    'saveGate: function(){ return Promise.resolve({}); } };';
  return html
    .replace('<script src="assets/api-client.js"></script>', '<script>' + mock + '<\/script>')
    .replace('<script src="assets/deep-link.js"></script>', '<script>' + DEEPLINK_JS + '<\/script>');
}

function loadPage(file, url) {
  const raw = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const html = inlineScripts(raw);
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: url
  });
}

(async function () {
  console.log('\n=== Deep-link integration (summary.html + panel.html ?id=) ===\n');

  console.log('== summary.html?id=uc-deep-77 ==');
  const sDom = loadPage('summary.html', 'https://example.com/summary.html?id=uc-deep-77');
  // init() renders demo synchronously, then re-renders after the fetch promise.
  await new Promise(r => setTimeout(r, 60));
  const sDoc = sDom.window.document;
  ok('fetched with the deep-link id', sDom.window.__lastFetchId === 'uc-deep-77');
  ok('deep-link opts exposed on __sum', !!(sDom.window.__sum && sDom.window.__sum.deepLink));
  // #roiName holds the ROI headline; the use case name lives in #wsEval (asserted below).
  ok('ROI headline rendered from fetched data',
     /ROI over 24 months/.test(sDoc.getElementById('roiName').textContent));
  ok('workspace eval line names the fetched case',
     /Deeplinked Claims Auditor/.test(sDoc.getElementById('wsEval').textContent));
  ok('model.useCase is the fetched case', sDom.window.__sum.model.useCase === 'Deeplinked Claims Auditor');
  ok('gaic_use_case_id stored for downstream saves',
     sDom.window.localStorage.getItem('gaic_use_case_id') === 'uc-deep-77');
  ok('GADF framework score derives from fetched BXT (82,70,76 -> 76)',
     sDom.window.__sum.model.frameworks[0].score === Math.round((82 + 70 + 76) / 3));

  console.log('\n== panel.html?id=uc-deep-77 ==');
  const pDom = loadPage('panel.html', 'https://example.com/panel.html?id=uc-deep-77');
  await new Promise(r => setTimeout(r, 80));
  const pDoc = pDom.window.document;
  ok('fetched with the deep-link id', pDom.window.__lastFetchId === 'uc-deep-77');
  ok('panel names the fetched use case somewhere in the brief',
     /Deeplinked Claims Auditor/.test(pDoc.body.textContent));
  ok('gaic_use_case_id stored', pDom.window.localStorage.getItem('gaic_use_case_id') === 'uc-deep-77');

  console.log('\n== fallback: no ?id renders demo (regression guard) ==');
  const fDom = loadPage('summary.html', 'https://example.com/summary.html');
  await new Promise(r => setTimeout(r, 60));
  ok('no fetch performed without ?id', fDom.window.__lastFetchId === undefined);
  ok('demo use case still renders', !!fDom.window.__sum.model.useCase);

  console.log('\n---------------------------------------------');
  console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('---------------------------------------------');
  clearTimeout(GUARD);
  process.exit(fail ? 1 : 0);
})();
