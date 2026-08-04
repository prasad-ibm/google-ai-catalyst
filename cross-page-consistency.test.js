/**
 * Cross-page consistency test (frontend single-source-of-truth).
 *
 * Verifies that ONE use case shows ONE identical P50 ROI and ONE identical
 * verdict across the pages that consume GET /api/portfolio:
 *   - Dashboard  (dashboard.html   -> Avg P50 ROI KPI, verdict tally)
 *   - Kanban     (kanban.html      -> card verdict chip)
 *   - Portfolio  (portfolio-map.html -> card verdict + P50)
 *
 * The Summary hero / Gartner foot / Executive Brief side is covered by
 * summary.test.js (section 8b) and panel.test.js. Together these assert the
 * fixes for #3 (summary ordering), #4 (canonical verdict) and #10 (avg P50).
 *
 * All pages are loaded in jsdom and fed the SAME canonical row, so any
 * independent derivation would surface as a mismatch. No network / DB needed.
 *
 *   node cross-page-consistency.test.js   # exit 0 = all green
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function ok(msg, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}

// A single canonical portfolio row exactly as GET /api/portfolio returns it
// (CONTRACT.md). +336% P50, committed GO verdict.
const CANON = {
  id: 'uc-askhr', name: 'AskHR Assistant', department: 'Human Resources',
  stage: 'panel', feasibility_composite: 4.1, quadrant: 'Quick Win',
  advisory_tier: 'Adopt', recommended_platform: 'Vertex AI',
  roi_p10: 120, roi_p50: 336, roi_p90: 560, verdict: 'GO',
};
const ROWS = [CANON];

// Load a page that reads a test-rows hook (dashboard / portfolio-map).
function loadHook(file, hookName, rows) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://example.com/' + file,
    beforeParse(w) { w[hookName] = rows; }
  });
}
// Load a page that fetches /api/portfolio (kanban) with fetch mocked.
function loadFetch(file, rows) {
  const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://example.com/' + file,
    beforeParse(w) {
      w.fetch = function (url) {
        var u = String(url), body = [];
        if (u.indexOf('/api/workspaces') !== -1) body = [{ id: 'ws-intel', name: 'Intel Corp' }];
        else if (u.indexOf('/api/portfolio') !== -1) body = rows;
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
      };
    }
  });
}
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

(async function () {
console.log('\n=== Cross-page consistency (single case, canonical /api/portfolio) ===\n');

// ---- Dashboard ----
console.log('== Dashboard (dashboard.html) ==');
const dashDom = loadHook('dashboard.html', '__DASH_TEST_ROWS', ROWS);
const dash = dashDom.window.__dash;
const dashDoc = dashDom.window.document;
ok('window.__dash exposed', !!dash);
const kpiEls = Array.from(dashDoc.querySelectorAll('.kpi'));
const avgKpi = kpiEls.find(function (n) {
  var k = n.querySelector('.kpi__k'); return k && /Avg P50 ROI/.test(k.textContent);
});
ok('KPI relabelled to "Avg P50 ROI" (not "Portfolio P50 ROI")', !!avgKpi);
const dashP50Text = avgKpi ? avgKpi.querySelector('.kpi__v').textContent.trim() : '';
// Single evaluated case -> average == that case's own P50 == +336%.
ok('Dashboard Avg P50 shows +336% (avg==single case p50): ' + dashP50Text, dashP50Text === '+336%');
const dashNote = avgKpi ? avgKpi.querySelector('.kpi__note').textContent : '';
ok('Dashboard note says "avg across", not "sum"', /avg across/.test(dashNote) && !/sum/.test(dashNote));
const goKpi = kpiEls.find(function (n) {
  var k = n.querySelector('.kpi__k'); return k && k.textContent.trim() === 'GO';
});
ok('Dashboard GO tally = 1 (from canonical verdict)', goKpi && goKpi.querySelector('.kpi__v').textContent.trim() === '1');
const dashVerdict = dash.verdictKey(CANON.verdict);

// ---- Kanban ----
console.log('\n== Kanban (kanban.html) ==');
const kanDom = loadFetch('kanban.html', ROWS);
await tick(); await tick();
const kan = kanDom.window.GAIC_KANBAN;
const kanDoc = kanDom.window.document;
ok('window.GAIC_KANBAN exposed', !!kan);
const kanChip = kanDoc.querySelector('.vchip');
const kanVerdictText = kanChip ? kanChip.textContent.trim() : '';
ok('Kanban renders verdict chip "GO" from canonical field: ' + kanVerdictText, kanVerdictText === 'GO');
const kanVerdict = kan.verdictKey(CANON.verdict);

// ---- Portfolio Map ----
console.log('\n== Portfolio Map (portfolio-map.html) ==');
const pfDom = loadHook('portfolio-map.html', '__PFMAP_TEST_ROWS', ROWS);
const pf = pfDom.window.__pfmap;
const pfDoc = pfDom.window.document;
ok('window.__pfmap exposed', !!pf);
const pfCardText = (pfDoc.querySelector('.pf-card, .card, [class*="card"]') || pfDoc.body).textContent;
ok('Portfolio Map card shows P50 +336%', /\+336%/.test(pfCardText));
const pfVerdict = pf.verdictKey(CANON.verdict);
// The visible short verdict on the map derives from the SAME canonical verdictKey.
ok('Portfolio Map verdict key = go', pfVerdict === 'go');

// ---- The single-source assertions ----
console.log('\n== Single source of truth ==');
ok('all three pages normalize the SAME verdict -> "go"',
   dashVerdict === 'go' && kanVerdict === 'go' && pfVerdict === 'go');
ok('Dashboard P50 (+336%) matches the canonical roi_p50 (336)', dashP50Text === '+' + CANON.roi_p50 + '%');
ok('P50 shown on Dashboard == P50 shown on Portfolio Map (both +336%)',
   dashP50Text === '+336%' && /\+336%/.test(pfCardText));

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
