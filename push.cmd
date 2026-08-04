/**
 * Pipeline Board (kanban.html) test suite.
 * Loads the page inside jsdom, mocks fetch() for /api/workspaces and
 * /api/portfolio, and exercises:
 *   - the stage -> column bucketing model (window.GAIC_KANBAN)
 *   - the "panel + verdict=GO -> Approved" special rule
 *   - end-to-end render: 7 columns, cards, verdict chips, summary deep-links
 *
 *   node kanban.test.js      # exit 0 = all green
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, 'kanban.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(msg, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}

// Realistic /api/portfolio rows (matches server.js portfolio assembly).
const PORTFOLIO = [
  { id: 'uc-1', name: 'Fraud Signal Triage', department: 'Risk & Compliance',
    stage: 'panel', feasibility_composite: 3.8, advisory_tier: 'Extend', verdict: 'GO' },
  { id: 'uc-2', name: 'Contract Summarizer', department: 'Legal',
    stage: 'panel', feasibility_composite: 4.2, advisory_tier: 'Scale', verdict: 'CONDITIONAL GO' },
  { id: 'uc-3', name: 'Shelf Vision', department: 'Retail Ops',
    stage: 'panel', feasibility_composite: 2.9, advisory_tier: 'Pilot', verdict: 'NO-GO' },
  { id: 'uc-4', name: 'Ticket Router', department: 'Support',
    stage: 'feasibility', feasibility_composite: 3.1, advisory_tier: 'Pilot', verdict: null },
  { id: 'uc-5', name: 'New Idea', department: 'Marketing',
    stage: 'intake', feasibility_composite: null, advisory_tier: null, verdict: null },
  { id: 'uc-6', name: 'Sales Copilot', department: 'Sales',
    stage: 'bxt', feasibility_composite: 3.5, advisory_tier: 'Extend', verdict: null },
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

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/kanban.html',
    beforeParse(window) {
      window.fetch = function (url) {
        const u = String(url);
        let body;
        if (u.indexOf('/api/workspaces') !== -1) body = workspaces;
        else if (u.indexOf('/api/portfolio') !== -1) body = portfolio;
        else body = [];
        return Promise.resolve({
          ok: true, status: 200,
          json: function () { return Promise.resolve(body); },
        });
      };
      // localStorage is provided by jsdom; nothing else needed.
    },
  });
  return dom;
}

// Wait for the async boot chain (loadWorkspaces -> loadPortfolio -> render).
function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

(async function () {
console.log('\n=== Pipeline Board (kanban.html) ===\n');

console.log('== 1. Model surface (window.GAIC_KANBAN) ==');
let dom = newDom();
let K = dom.window.GAIC_KANBAN;
ok('window.GAIC_KANBAN exists', !!K);
ok('exposes COLUMNS (7 columns)', Array.isArray(K.COLUMNS) && K.COLUMNS.length === 7);
ok('columns in pipeline order',
  K.COLUMNS.map(function (c) { return c.key; }).join(',') ===
  'intake,bxt,feasibility,advisory,summary,panel,approved');
['stageKey', 'columnFor', 'verdictKey'].forEach(function (fn) {
  ok('exposes ' + fn + '()', typeof K[fn] === 'function');
});

console.log('\n== 2. stageKey() normalization ==');
ok('intake -> intake', K.stageKey('intake') === 'intake');
ok('BXT (case) -> bxt', K.stageKey('BXT') === 'bxt');
ok('feas prefix -> feasibility', K.stageKey('feas') === 'feasibility');
ok('advisory -> advisory', K.stageKey('advisory') === 'advisory');
ok('summary -> summary', K.stageKey('summary') === 'summary');
ok('panel -> panel', K.stageKey('panel') === 'panel');
ok('approved -> approved', K.stageKey('approved') === 'approved');
ok('null/unknown -> intake fallback', K.stageKey(null) === 'intake' && K.stageKey('???') === 'intake');

console.log('\n== 3. columnFor() — panel+GO becomes Approved ==');
ok('panel + GO -> approved',
  K.columnFor({ stage: 'panel', verdict: 'GO' }) === 'approved');
ok('panel + CONDITIONAL GO -> panel (stays)',
  K.columnFor({ stage: 'panel', verdict: 'CONDITIONAL GO' }) === 'panel');
ok('panel + NO-GO -> panel (stays)',
  K.columnFor({ stage: 'panel', verdict: 'NO-GO' }) === 'panel');
ok('panel + no verdict -> panel (stays)',
  K.columnFor({ stage: 'panel', verdict: null }) === 'panel');
ok('feasibility + GO -> feasibility (only panel promotes)',
  K.columnFor({ stage: 'feasibility', verdict: 'GO' }) === 'feasibility');
ok('intake -> intake', K.columnFor({ stage: 'intake' }) === 'intake');

console.log('\n== 4. verdictKey() classification ==');
ok('GO -> go', K.verdictKey('GO') === 'go');
ok('CONDITIONAL GO -> cond', K.verdictKey('CONDITIONAL GO') === 'cond');
ok('NO-GO -> no', K.verdictKey('NO-GO') === 'no');
ok('empty -> null', K.verdictKey('') === null && K.verdictKey(null) === null);

console.log('\n== 5. End-to-end render (mocked /api) ==');
dom = newDom();
await tick(); await tick();
const doc = dom.window.document;
const board = doc.getElementById('board');
ok('loading hidden after render', doc.getElementById('loading').classList.contains('hidden'));
ok('board visible', !board.classList.contains('hidden'));

const cols = board.querySelectorAll('.col');
ok('renders 7 columns', cols.length === 7);

function countFor(key) {
  const c = board.querySelector('.col[data-col="' + key + '"]');
  return c ? c.querySelectorAll('.card').length : -1;
}
ok('Approved column has 1 card (the GO panel case)', countFor('approved') === 1);
ok('Panel column has 2 cards (CONDITIONAL + NO-GO)', countFor('panel') === 2);
ok('Feasibility column has 1 card', countFor('feasibility') === 1);
ok('BXT column has 1 card', countFor('bxt') === 1);
ok('Intake column has 1 card', countFor('intake') === 1);
ok('Summary + Advisory columns empty', countFor('summary') === 0 && countFor('advisory') === 0);

const cardCount = board.querySelectorAll('.card').length;
ok('all 6 rows rendered as cards', cardCount === 6);

console.log('\n== 6. Card content: deep-link + verdict chip + dept + feasibility ==');
const goCard = board.querySelector('.col[data-col="approved"] .card');
ok('GO card deep-links to summary.html?id=<id>',
  goCard.getAttribute('href') === 'summary.html?id=uc-1');
ok('GO card has go-colored verdict chip',
  goCard.querySelector('.vchip.is-go') !== null);
ok('GO card left-border is-go class', goCard.classList.contains('is-go'));
ok('GO card shows department', /Risk & Compliance/.test(goCard.textContent));
ok('GO card shows feasibility /5', /3\.8\s*\/5/.test(goCard.textContent));
ok('GO card shows advisory tier', /Extend/.test(goCard.textContent));

const condCard = Array.prototype.find.call(
  board.querySelectorAll('.col[data-col="panel"] .card'),
  function (c) { return /Contract Summarizer/.test(c.textContent); });
ok('CONDITIONAL card has cond-colored chip', condCard.querySelector('.vchip.is-cond') !== null);
const noCard = Array.prototype.find.call(
  board.querySelectorAll('.col[data-col="panel"] .card'),
  function (c) { return /Shelf Vision/.test(c.textContent); });
ok('NO-GO card has no-colored chip', noCard.querySelector('.vchip.is-no') !== null);

console.log('\n== 7. Column counts shown in headers ==');
const approvedHead = board.querySelector('.col[data-col="approved"] .col__count');
ok('Approved header count = 1', approvedHead.textContent.trim() === '1');

console.log('\n== 8. Empty portfolio -> empty state ==');
const emptyDom = newDom({ portfolio: [] });
await tick(); await tick();
const edoc = emptyDom.window.document;
ok('empty state visible', !edoc.getElementById('empty').classList.contains('hidden'));
ok('board hidden when empty', edoc.getElementById('board').classList.contains('hidden'));

console.log('\n== 9. Workspace picker populated + Intel preselected ==');
dom = newDom();
await tick(); await tick();
const picker = dom.window.document.getElementById('wsPicker');
ok('picker has 2 options', picker.querySelectorAll('option').length === 2);
ok('Intel workspace preselected', picker.value === 'ws-intel');

console.log('\n---------------------------------------------');
console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
console.log('---------------------------------------------');
process.exit(fail ? 1 : 0);
})();
