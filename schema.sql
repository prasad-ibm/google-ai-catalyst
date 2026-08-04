/**
 * Portfolio Map (portfolio-map.html) test suite.
 * Mirrors summary.test.js / advisory.test.js: loads the inline IIFE inside
 * jsdom, injects test rows via window.__PFMAP_TEST_ROWS so the page renders
 * without any network, then exercises the pure window.__pfmap API + the DOM.
 *
 *   node portfolio-map.test.js      # exit 0 = all green
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, 'portfolio-map.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(msg, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}

// Representative portfolio (shape mirrors GET /api/portfolio in server.js).
const ROWS = [
  { id: 'uc-1', name: 'Fraud Signal Triage', department: 'Risk & Compliance', stage: 'gate5', quadrant: 'Quick Win',        advisory_tier: 'Extend',   roi_p50: 180, verdict: 'GO' },
  { id: 'uc-2', name: 'Claims Auto-Summary',  department: 'Risk & Compliance', stage: 'gate4', quadrant: 'Strategic Bet',    advisory_tier: 'Transform', roi_p50: 95,  verdict: 'CONDITIONAL GO' },
  { id: 'uc-3', name: 'Vendor Doc Extraction', department: 'Procurement',      stage: 'gate3', quadrant: 'Incremental',      advisory_tier: 'Adopt',    roi_p50: 40,  verdict: 'NO-GO' },
  { id: 'uc-4', name: 'Sales Email Assist',    department: 'Procurement',      stage: 'gate2', quadrant: null,               advisory_tier: null,       roi_p50: null, verdict: null },
  { id: 'uc-5', name: 'Orphan Case',           department: null,               stage: 'gate1', quadrant: 'Quick Win',        advisory_tier: 'Adopt',    roi_p50: 12,  verdict: 'GO' },
];

function newDom(rows) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://example.com/portfolio-map.html',
    beforeParse(w) {
      if (rows !== undefined) w.__PFMAP_TEST_ROWS = rows;
    }
  });
}

console.log('\n=== Portfolio Map (portfolio-map.html) ===\n');

const dom = newDom(ROWS);
const api = dom.window.__pfmap;
const d = dom.window.document;

console.log('== 1. Test API surface exposed ==');
ok('window.__pfmap exists', !!api);
['esc','num','fmtPct','verdictKey','verdictLabel','groupByDepartment','verdictCounts','cardHTML','deptSectionHTML','render']
  .forEach(fn => ok('exposes ' + fn + '()', typeof api[fn] === 'function'));

console.log('\n== 2. verdictKey normalization -> go/cond/no/null ==');
ok('GO -> go', api.verdictKey('GO') === 'go');
ok('CONDITIONAL GO -> cond', api.verdictKey('CONDITIONAL GO') === 'cond');
ok('NO-GO -> no', api.verdictKey('NO-GO') === 'no');
ok('null -> null', api.verdictKey(null) === null);

console.log('\n== 3. groupByDepartment groups + falls back to Unassigned ==');
const groups = api.groupByDepartment(ROWS);
ok('3 department groups (2 named + Unassigned)', groups.length === 3);
ok('first group is Risk & Compliance', groups[0].department === 'Risk & Compliance');
ok('Risk & Compliance has 2 cases', groups[0].rows.length === 2);
ok('null department bucketed as Unassigned', groups.some(g => g.department === 'Unassigned'));

console.log('\n== 4. verdictCounts tally ==');
const c = api.verdictCounts(ROWS);
ok('2 GO', c.go === 2);
ok('1 COND', c.cond === 1);
ok('1 NO-GO', c.no === 1);
ok('1 not-evaluated', c.none === 1);

console.log('\n== 5. cardHTML: verdict chip class + deep-link + ROI ==');
const goCard   = api.cardHTML(ROWS[0]);
const condCard = api.cardHTML(ROWS[1]);
const noCard   = api.cardHTML(ROWS[2]);
const naCard   = api.cardHTML(ROWS[3]);
ok('GO card has is-go class', /class="card is-go"/.test(goCard));
ok('COND card has is-cond class', /class="card is-cond"/.test(condCard));
ok('NO-GO card has is-no class', /class="card is-no"/.test(noCard));
ok('not-evaluated card has is-none class', /class="card is-none"/.test(naCard));
ok('card deep-links to summary.html?id=uc-1', goCard.indexOf('summary.html?id=uc-1') !== -1);
ok('GO chip label is "GO"', /vchip is-go[^>]*>.*?<\/span>GO</.test(goCard.replace(/\n/g, '')) || goCard.indexOf('>GO<') !== -1);
ok('COND chip label is "COND GO"', condCard.indexOf('COND GO') !== -1);
ok('ROI P50 formatted with %', goCard.indexOf('+180%') !== -1);
ok('missing ROI renders em-dash', naCard.indexOf('meta__v dim') !== -1);

console.log('\n== 6. DOM render on boot (via __PFMAP_TEST_ROWS) ==');
ok('loading hidden after render', d.getElementById('loading').classList.contains('hidden'));
ok('content visible', !d.getElementById('content').classList.contains('hidden'));
ok('renders 3 department sections', d.querySelectorAll('#content .dept').length === 3);
ok('renders 5 cards total', d.querySelectorAll('#content .card').length === 5);
ok('every card links to summary.html?id=', Array.from(d.querySelectorAll('#content .card')).every(a => /summary\.html\?id=/.test(a.getAttribute('href'))));
ok('renders green (GO) chips', d.querySelectorAll('#content .vchip.is-go').length === 2);
ok('renders yellow (COND) chip', d.querySelectorAll('#content .vchip.is-cond').length === 1);
ok('renders red (NO-GO) chip', d.querySelectorAll('#content .vchip.is-no').length === 1);
ok('department heading shows use-case count', /2 use cases/.test(d.querySelector('#content .dept .dept__count').textContent));

console.log('\n== 7. Empty state when no rows ==');
const emptyDom = newDom([]);
const ed = emptyDom.window.document;
ok('empty state shown for []', !ed.getElementById('empty').classList.contains('hidden'));
ok('content hidden for []', ed.getElementById('content').classList.contains('hidden'));
ok('empty state links to intake.html', /intake\.html/.test(ed.getElementById('empty').innerHTML));

console.log('\n== 8. Shared theme + header fidelity ==');
ok('links assets/theme.css', /href="assets\/theme\.css"/.test(html));
ok('loads assets/api-client.js', /src="assets\/api-client\.js"/.test(html));
ok('loads assets/auth-ui.js', /src="assets\/auth-ui\.js"/.test(html));
ok('gc-header present', /class="gc-header"/.test(html));
ok('workspace picker present', /id="wsPicker"/.test(html));
ok('product tag "Enterprise Advantage"', /Enterprise Advantage/.test(html));
ok('wordmark "Google AI Catalyst"', /Google <b>AI Catalyst<\/b>/.test(html));
ok('reads /api/portfolio', /\/portfolio/.test(html));

console.log('\n== 9. Zero Microsoft strings ==');
['Copilot','Azure','M365','watsonx','Agentforce','Salesforce','Microsoft','Dataverse','Dynamics']
  .forEach(m => ok('NO Microsoft string "' + m + '"',
    !new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(html)));

console.log('\n---------------------------------------------');
console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
console.log('---------------------------------------------');
process.exit(fail ? 1 : 0);
