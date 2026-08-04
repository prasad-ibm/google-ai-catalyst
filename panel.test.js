/**
 * Gate 6 — Executive Review Panel (panel.html) test suite.
 * Mirrors summary.test.js: loads the inline IIFE inside jsdom, exercises the
 * pure window.__panel API plus the rendered DOM.
 *
 *   node panel.test.js      # exit 0 = all green
 */
const fs = require('fs');
const path = require('path');
// Resolve jsdom robustly: some sandboxes have a broken/partial local
// node_modules/jsdom that hangs on load, while a working copy lives elsewhere
// (e.g. /tmp/node_modules). Try candidates in order and use the first that loads.
function requireJsdom() {
  // Prefer the known-good /tmp copy first: a broken local node_modules/jsdom
  // hangs on load (not a catchable throw), so we must avoid touching it.
  const candidates = ['/tmp/node_modules/jsdom',
    path.join(process.env.HOME || '', 'node_modules/jsdom'), 'jsdom'];
  for (const c of candidates) {
    try { const m = require(c); if (m && m.JSDOM) return m; } catch (e) { /* next */ }
  }
  throw new Error('jsdom not found in any candidate path');
}
const { JSDOM } = requireJsdom();

const HTML_PATH = path.join(__dirname, 'panel.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

let pass = 0, fail = 0;
process.on('uncaughtException', e => { console.error('UNCAUGHT:', e && e.stack || e); process.exit(2); });
const GUARD = setTimeout(() => { console.error('GUARD TIMEOUT — did not reach finish. pass=' + pass + ' fail=' + fail); process.exit(3); }, 20000);
function finish(){
  console.log('\n---------------------------------------------');
  console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('---------------------------------------------');
  clearTimeout(GUARD);
  process.exit(fail ? 1 : 0);
}
function ok(msg, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}

// Build a fresh jsdom for a given localStorage seed set (mirrors summary.test.js).
function newDom(summary, intake) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/panel.html',
    beforeParse(w) {
      if (summary !== undefined) w.localStorage.setItem('gaic_summary', JSON.stringify(summary));
      if (intake  !== undefined) w.localStorage.setItem('gaic_intake',  JSON.stringify(intake));
    }
  });
}

console.log('\n=== Gate 6 · Executive Review Panel (panel.html) ===\n');

// Representative persisted Gate 5 hand-off (CONDITIONAL readiness).
const SUMMARY = {
  useCase: 'Fraud Signal Triage',
  composite: 78,
  readiness: 'CONDITIONAL',
  roi: { p10: 62, p50: 141, p90: 233, annualValue: 4200000, cost: 1750000, payback: 11 },
  frameworks: [
    { key:'gadf',      name:'GADF v2 (Google AI Decision Framework)', score:77, band:'Strong' },
    { key:'caf',       name:'Google Cloud Adoption Framework',        score:72, band:'Ready' },
    { key:'strategic', name:'Strategic Value (McKinsey × MIT Sloan)', score:81, band:'High' },
    { key:'gartner',   name:'Gartner AI Maturity + ROI',             score:69, band:'Emerging' }
  ],
  governance: [], ts: 0
};
const INTAKE = { name: 'Fraud Signal Triage', value: '$1M–$5M', users: '200–1000', autonomy: 'Supervised', pii: true, audit: true };

const dom = newDom(SUMMARY, INTAKE);
const api = dom.window.__panel;
const d = dom.window.document;

console.log('== 1. Test API surface exposed ==');
ok('window.__panel exists', !!api);
['deriveVerdict','loadIntake','loadSummary','currentVerdict','buildBrief','run'].forEach(fn =>
  ok('exposes ' + fn + '()', typeof api[fn] === 'function'));
ok('storage keys use gaic_ prefix', api.SUMMARY_KEY === 'gaic_summary' && api.INTAKE_KEY === 'gaic_intake');

console.log('\n== 2. Four distinct personas defined ==');
const pk = Object.keys(api.PERSONAS);
ok('exactly 4 personas', pk.length === 4);
ok('persona codes BS/RA/CI/CC', pk.slice().sort().join(',') === 'BS,CC,CI,RA');
ok('BS = Business Sponsor / Executive Sponsor', api.PERSONAS.BS.name === 'Business Sponsor' && api.PERSONAS.BS.role === 'Executive Sponsor');
ok('RA = Risk & Assurance Officer / Chief Risk Officer', api.PERSONAS.RA.name === 'Risk & Assurance Officer' && api.PERSONAS.RA.role === 'Chief Risk Officer');
ok('CI = Chief Information Officer / CIO', api.PERSONAS.CI.name === 'Chief Information Officer' && api.PERSONAS.CI.role === 'CIO');
ok('CC = Committee Chair / IC Moderator', api.PERSONAS.CC.name === 'Committee Chair' && api.PERSONAS.CC.role === 'IC Moderator');
ok('distinct avatar colors', new Set(pk.map(k => api.PERSONAS[k].colorHex)).size === 4);

console.log('\n== 3. Seven-turn deliberation script ==');
ok('exactly 7 turns', api.DELIBERATION.length === 7);
const seq = api.DELIBERATION.map(t => t.p).join(',');
ok('turn order BS,RA,CI,BS,RA,CI,CC', seq === 'BS,RA,CI,BS,RA,CI,CC');
ok('every turn maps to a defined persona', api.DELIBERATION.every(t => !!api.PERSONAS[t.p]));
ok('T1 mentions $12M savings + 34% reduction', /\$12M/.test(api.DELIBERATION[0].say) && /34%/.test(api.DELIBERATION[0].say));
ok('T7 (Chair) issues CONDITIONAL GO', /CONDITIONAL GO/.test(api.DELIBERATION[6].say));

console.log('\n== 4. Verdict derivation from Gate 5 readiness ==');
ok('READY -> GO', api.deriveVerdict('READY').label === 'GO' && api.deriveVerdict('READY').klass === 'is-go');
ok('CONDITIONAL -> CONDITIONAL GO', api.deriveVerdict('CONDITIONAL').label === 'CONDITIONAL GO' && api.deriveVerdict('CONDITIONAL').klass === 'is-cond');
ok('BLOCKED -> NO-GO', api.deriveVerdict('BLOCKED').label === 'NO-GO' && api.deriveVerdict('BLOCKED').klass === 'is-nogo');
ok('unknown/empty defaults to CONDITIONAL GO', api.deriveVerdict('').label === 'CONDITIONAL GO' && api.deriveVerdict(undefined).label === 'CONDITIONAL GO');
ok('case-insensitive readiness', api.deriveVerdict('ready').label === 'GO');
ok('currentVerdict() reads persisted CONDITIONAL', api.currentVerdict().label === 'CONDITIONAL GO');

console.log('\n== 5. Binding condition text present ==');
ok('binding condition names data residency clause', /data residency clause/i.test(api.BINDING_CONDITION));
ok('binding condition names Change Freeze Protocol CF-7', /Change Freeze Protocol CF-7/.test(api.BINDING_CONDITION));
ok('condition precedent to contract signature', /condition precedent to contract signature/i.test(api.BINDING_CONDITION));

console.log('\n== 6. Per-persona stance chips ==');
ok('3 stance chips', api.STANCES.length === 3);
ok('stances Support / Conditional / Conditional', api.STANCES.map(s => s.value).join(',') === 'Support,Conditional,Conditional');

// DOM assertions: drive the synchronous (non-animated) render path so the
// suite is deterministic and exits immediately — no reliance on real timers.
api.run(false);
console.log('\n== 7. DOM: all 7 turns render with persona + role ==');
const turns = d.querySelectorAll('#delib .turn');
ok('renders 7 turn rows', turns.length === 7);
ok('each turn has avatar initials', Array.from(turns).every(t => t.querySelector('.turn__av').textContent.length === 2));
ok('turn 1 names Business Sponsor', turns[0].querySelector('.turn__who').textContent === 'Business Sponsor');
ok('turn 1 role Executive Sponsor', turns[0].querySelector('.turn__role').textContent === 'Executive Sponsor');
ok('turn 7 names Committee Chair', turns[6].querySelector('.turn__who').textContent === 'Committee Chair');
ok('turn 7 role IC Moderator', turns[6].querySelector('.turn__role').textContent === 'IC Moderator');
const personasInDom = new Set(Array.from(turns).map(t => t.getAttribute('data-persona')));
ok('4 distinct personas present in DOM', personasInDom.size === 4);
ok('all turns eventually revealed (is-in)', Array.from(turns).every(t => t.classList.contains('is-in')));

console.log('\n== 8. DOM: 4 thinking steps + collapsible ==');
ok('renders 4 thinking steps', d.querySelectorAll('#stepsBody .step').length === 4);
ok('step 1 text matches spec', /Retrieving framework evaluation scores/.test(d.querySelector('#stepsBody .step').textContent));
ok('"Completed 4 steps" label present', /Completed 4 steps/.test(d.getElementById('steps').textContent));

console.log('\n== 9. DOM: verdict banner + condition + stances ==');
ok('verdict label shows CONDITIONAL GO', d.getElementById('verdictLabel').textContent === 'CONDITIONAL GO');
ok('verdict band carries is-cond class', d.getElementById('verdictBand').className.indexOf('is-cond') > -1);
ok('condition text rendered in banner', /Change Freeze Protocol CF-7/.test(d.getElementById('verdictCond').textContent));
ok('3 stance chips rendered', d.querySelectorAll('#verdictStances .stance').length === 3);
ok('verdict banner revealed (is-in)', d.getElementById('verdictBand').classList.contains('is-in'));

console.log('\n== 10. Executive Brief: 3 sections + P50 ROI ==');
// Trigger via the exposed API (equivalent to clicking #btnBrief).
api.buildBrief();
const brief = d.getElementById('brief');
ok('brief opens (is-open)', brief.classList.contains('is-open'));
const secs = brief.querySelectorAll('.brief__sec');
ok('brief has 3 sections', secs.length === 3);
ok('section 1 = Recommendation & Verdict', /Recommendation/.test(secs[0].textContent));
ok('section 2 = Business Case & ROI', /Business Case/.test(secs[1].textContent));
ok('section 3 = Conditions & Next Steps', /Conditions/.test(secs[2].textContent));
ok('brief pulls P50 ROI (+141%)', d.getElementById('briefP50').textContent === '+141%');
ok('brief pulls P10 & P90 band', d.getElementById('briefP10').textContent === '+62%' && d.getElementById('briefP90').textContent === '+233%');
ok('brief verdict line matches derivation', /CONDITIONAL GO/.test(d.getElementById('briefVerdictLine').textContent));
ok('brief conditions name Assured Workloads', /Assured Workloads/.test(secs[2].textContent));
ok('brief names the use case (Fraud Signal Triage)', /Fraud Signal Triage/.test(brief.textContent));
ok('brief has a Print button', !!d.getElementById('briefPrint'));

console.log('\n== 11. Header / stepper fidelity ==');
ok('product tag "Enterprise Advantage"', /Enterprise Advantage/.test(html));
ok('wordmark "Google AI Catalyst"', /Google <b>AI Catalyst<\/b>/.test(html));
ok('6-gate stepper present', d.querySelectorAll('#gates .gate').length === 6);
ok('Gate 6 is active', d.querySelector('#gates .gate.is-active .gate__label').textContent === 'Executive Review Panel');
ok('Gates 1-5 all complete', d.querySelectorAll('#gates .gate.is-done').length === 5);
ok('committee sub-header shows 7 turns', /7 turns/i.test(d.querySelector('.subhead').textContent));

console.log('\n== 12. Workspace eval line names the use case ==');
ok('wsEval names Fraud Signal Triage', /Fraud Signal Triage/.test(d.getElementById('wsEval').textContent));

console.log('\n== 13. Replay re-runs deliberation without error ==');
d.getElementById('btnReplay').click();
ok('after replay, 7 turns still present', d.querySelectorAll('#delib .turn').length === 7);

console.log('\n== 14. Footer nav: Back -> summary, Finish -> index ==');
ok('Back button targets summary.html', d.getElementById('btnBack').getAttribute('href') === 'summary.html');
ok('Back label mentions Evaluation Summary', /Evaluation Summary/.test(d.getElementById('btnBack').textContent));
ok('Finish button targets index.html', d.getElementById('btnFinish').getAttribute('href') === 'index.html');

console.log('\n== 15. Verdict responds to READY and BLOCKED seeds ==');
const domGo = newDom(Object.assign({}, SUMMARY, { readiness:'READY' }), INTAKE);
const domNo = newDom(Object.assign({}, SUMMARY, { readiness:'BLOCKED' }), INTAKE);
domGo.window.__panel.run(false);
domNo.window.__panel.run(false);
ok('READY seed -> banner GO', domGo.window.document.getElementById('verdictLabel').textContent === 'GO');
ok('READY seed -> is-go class', domGo.window.document.getElementById('verdictBand').className.indexOf('is-go') > -1);
ok('BLOCKED seed -> banner NO-GO', domNo.window.document.getElementById('verdictLabel').textContent === 'NO-GO');
ok('BLOCKED seed -> is-nogo class', domNo.window.document.getElementById('verdictBand').className.indexOf('is-nogo') > -1);

console.log('\n== 16. Graceful demo fallback (no localStorage) ==');
const domD = newDom(undefined, undefined);
const apiD = domD.window.__panel;
const dD = domD.window.document;
ok('demo summary readiness is CONDITIONAL', apiD.DEMO_SUMMARY.readiness === 'CONDITIONAL');
ok('demo intake is Acme invoice reconciliation', apiD.DEMO_INTAKE.name === 'Automated invoice reconciliation');
ok('demo currentVerdict -> CONDITIONAL GO', apiD.currentVerdict().label === 'CONDITIONAL GO');
apiD.run(false);
ok('demo renders 7 turns', dD.querySelectorAll('#delib .turn').length === 7);
ok('demo verdict label CONDITIONAL GO', dD.getElementById('verdictLabel').textContent === 'CONDITIONAL GO');
ok('demo wsEval shows (demo) marker', /\(demo\)/.test(dD.getElementById('wsEval').textContent));
apiD.buildBrief();
ok('demo brief P50 present (+141%)', dD.getElementById('briefP50').textContent === '+141%');
ok('demo brief names invoice reconciliation', /Automated invoice reconciliation/.test(dD.getElementById('brief').textContent));

console.log('\n== 17. Zero Microsoft strings; Google framing present ==');
ok('contains Google framing (Assured Workloads / Vertex AI / Gemini / Google Cloud)',
   /(Assured Workloads|Vertex AI|Gemini|Google Cloud)/.test(html));
const microsoft = ['Microsoft','Azure','Copilot','M365','Power Platform','Dataverse','Dynamics','watsonx','IBM','Blob Storage','OpenAI','AWS','Bedrock'];
microsoft.forEach(m => ok('NO Microsoft/competitor string "'+m+'"',
  !new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(html)));

finish();
