/* DOM verification test for feasibility.html — run with: node feasibility.test.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'feasibility.html'), 'utf8');
const bxtHtml = fs.readFileSync(path.join(__dirname, 'bxt.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; console.log('  \u2713 '+name); } else { fail++; console.log('  \u2717 '+name); } }
function approx(a, b, eps){ return Math.abs(a-b) <= (eps||1e-9); }
function click(w, el){ el.dispatchEvent(new w.MouseEvent('click', {bubbles:true})); }

// A strong intake object → higher seeds
const HIGH_INTAKE = {
  name: 'Automated invoice reconciliation',
  sponsor: 'CFO', value: '>$5M', align: 'Core strategic priority', users: '>1000', driver: 'Cost Reduction',
  adoption: 'High', change: true, autonomy: 'Advisory', sensitivity: 'Low',
  dataavail: 'Readily available & clean', integrations: ['Google Workspace','BigQuery','Vertex AI'],
  maturity: 'Highly automated', sources: ['Structured DB'], realtime: false, pii: false, audit: true
};
const BXT_STATE = { scores: { B:{score:92}, X:{score:70}, T:{score:80} }, verdict:{verdict:'PASS'} };

function newDom(seedIntake, seedBxt){
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/feasibility.html',
    beforeParse(w){
      if (seedIntake !== undefined) w.localStorage.setItem('gaic_intake', JSON.stringify(seedIntake));
      if (seedBxt !== undefined) w.localStorage.setItem('gaic_bxt', JSON.stringify(seedBxt));
    }
  });
}

const dom = newDom(HIGH_INTAKE, BXT_STATE);
const { window } = dom;
const { document } = window;

setTimeout(() => {
  const api = window.__feas;

  console.log('\n== 1. Header / theme toggle present ==');
  ok('theme toggle button exists', !!document.getElementById('themeToggle'));
  ok('Google wordmark present', /Google/.test(document.querySelector('.gc-header__wordmark').textContent));
  click(window, document.getElementById('themeToggle'));
  ok('theme toggle sets data-theme=light', document.documentElement.getAttribute('data-theme') === 'light');
  ok('theme persisted to gaic_theme', window.localStorage.getItem('gaic_theme') === 'light');

  console.log('\n== 2. Six-gate stepper: Gates 1-2 done, Gate 3 active ==');
  const gates = document.querySelectorAll('.gates .gate');
  ok('exactly 6 gates', gates.length === 6);
  ok('Gate 1 (Intake) is-done', gates[0].classList.contains('is-done'));
  ok('Gate 1 has checkmark svg', !!gates[0].querySelector('svg'));
  ok('Gate 2 (BXT Gate) is-done', gates[1].classList.contains('is-done'));
  ok('Gate 2 has checkmark svg', !!gates[1].querySelector('svg'));
  ok('Gate 3 (Feasibility Scoring) is-active', gates[2].classList.contains('is-active'));
  ok('Gates 4-6 upcoming (not active/done)',
     [3,4,5].every(i => !gates[i].classList.contains('is-active') && !gates[i].classList.contains('is-done')));
  const labels = Array.from(gates).map(g => g.querySelector('.gate__label').textContent.trim());
  ok('gate labels in correct order',
     JSON.stringify(labels) === JSON.stringify(['Intake','BXT Gate','Feasibility Scoring','Platform Advisory','Evaluation Summary','Executive Review Panel']));

  console.log('\n== 3. Gate banner copy ==');
  ok('banner title "Feasibility Scoring"', /Feasibility Scoring/.test(document.querySelector('.banner__title').textContent));
  ok('banner mentions 10 criteria across 3 pillars', /10 criteria across 3 pillars/.test(document.querySelector('.banner__desc').textContent));
  ok('banner has a "Why:" bold', /Why:/.test(document.querySelector('.banner__desc').innerHTML));
  ok('"AI SCORED" pill present near tabs', /AI SCORED/i.test(document.body.innerHTML));
  ok('sub-line "changes update the composite in real time" present', /update the composite in real time/i.test(document.body.innerHTML));

  console.log('\n== 4. Three tabs present ==');
  const tabs = document.querySelectorAll('.tab');
  ok('exactly 3 tabs', tabs.length === 3);
  const tabKeys = Array.from(tabs).map(t => t.getAttribute('data-tab'));
  ok('tabs are strategic/technical/org', JSON.stringify(tabKeys) === JSON.stringify(['strategic','technical','org']));
  ok('Strategic Value tab label', /Strategic Value/.test(tabs[0].textContent));
  ok('Technical Feasibility tab label', /Technical Feasibility/.test(tabs[1].textContent));
  ok('Org Readiness tab label', /Org Readiness/.test(tabs[2].textContent));
  // tab switching works
  click(window, tabs[1]);
  ok('clicking Technical tab activates its panel', document.getElementById('panel-technical').classList.contains('is-active'));
  ok('Strategic panel deactivated', !document.getElementById('panel-strategic').classList.contains('is-active'));
  click(window, tabs[0]);

  console.log('\n== 5. Exactly 10 criteria cards, weights sum to 100 ==');
  const cards = document.querySelectorAll('.crit');
  ok('exactly 10 criteria cards', cards.length === 10);
  ok('API exposes 10 CRITERIA', api.CRITERIA.length === 10);
  ok('weights sum to 100', api.weightSum === 100);
  ok('weightSum recomputed = 100', api.CRITERIA.reduce((a,c)=>a+c.weight,0) === 100);
  // pillar weight sub-totals
  const sum = p => api.CRITERIA.filter(c=>c.pillar===p).reduce((a,c)=>a+c.weight,0);
  ok('Strategic pillar = 35', sum('strategic') === 35);
  ok('Technical pillar = 35', sum('technical') === 35);
  ok('Org pillar = 30', sum('org') === 30);
  // exact criteria set + weights
  const expect = {
    biz_value:22, strat_align:8, data_value:5,
    data_avail:12, tech_complex:10, integ_effort:8, ttv:5,
    safety:15, compliance:12, user_value:3
  };
  ok('all 10 expected criteria with exact weights',
     Object.keys(expect).every(id => { const c = api.CRITERIA.find(x=>x.id===id); return c && c.weight === expect[id]; })
     && api.CRITERIA.length === Object.keys(expect).length);
  ok('each card has a weight % badge', Array.from(cards).every(c => /%$/.test(c.querySelector('.crit__wt').textContent.trim())));
  ok('each card has a one-line rationale', Array.from(cards).every(c => c.querySelector('.crit__rat').textContent.trim().length > 5));

  console.log('\n== 6. Each criterion has a 1-5 slider ==');
  const sliders = document.querySelectorAll('input[type=range].slider');
  ok('exactly 10 sliders', sliders.length === 10);
  ok('all sliders min=1 max=5 step=1', Array.from(sliders).every(s =>
     s.getAttribute('min')==='1' && s.getAttribute('max')==='5' && s.getAttribute('step')==='1'));
  ok('all sliders seeded within 1-5', Array.from(sliders).every(s => { const v=Number(s.value); return v>=1 && v<=5; }));

  console.log('\n== 7. Composite = correct weighted average ==');
  const allFour = {}; api.CRITERIA.forEach(c => allFour[c.id] = 4);
  ok('all sliders=4 → composite 4.0', approx(api.composite(allFour), 4.0));
  const allFive = {}; api.CRITERIA.forEach(c => allFive[c.id] = 5);
  ok('all sliders=5 → composite 5.0', approx(api.composite(allFive), 5.0));
  const allOne = {}; api.CRITERIA.forEach(c => allOne[c.id] = 1);
  ok('all sliders=1 → composite 1.0', approx(api.composite(allOne), 1.0));
  // known mixed config: strategic pillar (35) all 5, everything else 1
  const mixed = {}; api.CRITERIA.forEach(c => mixed[c.id] = (c.pillar==='strategic') ? 5 : 1);
  // expected = 0.35*5 + 0.65*1 = 1.75 + 0.65 = 2.4
  ok('mixed config composite = 2.4', approx(api.composite(mixed), 2.4, 1e-9));
  // composite is pure/deterministic
  ok('composite deterministic', api.composite(allFour) === api.composite(allFour));

  console.log('\n== 8. Pillar scores (weighted avg within pillar) ==');
  ok('strategic pillar all-5 = 5.0', approx(api.pillarScore(allFive,'strategic'), 5.0));
  // strategic mixed: biz_value22=5, others... in "mixed" strategic are all 5 -> 5.0
  ok('technical pillar mixed(all 1) = 1.0', approx(api.pillarScore(mixed,'technical'), 1.0));
  const ps = api.pillarScores(allFour);
  ok('pillarScores returns 3 pillars each = 4.0', approx(ps.strategic,4) && approx(ps.technical,4) && approx(ps.org,4));

  console.log('\n== 9. Quadrant logic at thresholds ==');
  ok('high value + high feas → Quick Win', api.quadrant(4, 4).name === 'Quick Win');
  ok('high value + low feas → Strategic Bet', api.quadrant(4.5, 2).name === 'Strategic Bet');
  ok('low value + high feas → Fill-In', api.quadrant(2, 4).name === 'Fill-In');
  ok('low value + low feas → Money Pit', api.quadrant(2, 2).name === 'Money Pit');
  ok('threshold boundary: value=3,feas=3 → Quick Win', api.quadrant(3, 3).name === 'Quick Win');
  ok('just below: value=2.9,feas=2.9 → Money Pit', api.quadrant(2.9, 2.9).name === 'Money Pit');
  ok('value high, feas=2.99 → Strategic Bet', api.quadrant(4, 2.99).name === 'Strategic Bet');

  console.log('\n== 10. Risk tier compute (from Safety + Compliance) ==');
  ok('safety=5,compliance=5 → Low risk', api.riskTier({safety:5, compliance:5}).tier === 'Low');
  ok('safety=4,compliance=4 → Low risk', api.riskTier({safety:4, compliance:4}).tier === 'Low');
  ok('safety=3,compliance=3 → Medium risk', api.riskTier({safety:3, compliance:3}).tier === 'Medium');
  ok('safety=2,compliance=2 → High risk', api.riskTier({safety:2, compliance:2}).tier === 'High');
  ok('risk boundary avg>=4 → Low', api.riskTier({safety:4, compliance:4}).tier === 'Low');
  ok('risk boundary avg=2.5 → Medium', api.riskTier({safety:3, compliance:2}).score >= 2.4 && api.riskTier({safety:3, compliance:2}).tier === 'Medium');

  console.log('\n== 11. Citizen-dev suitability % + path ==');
  const cdHigh = api.citizenDev({tech_complex:5, integ_effort:5, compliance:5});
  ok('all-5 citizen-dev = 100%', cdHigh.pct === 100);
  ok('all-5 path = AppSheet / Agentspace', /AppSheet \/ Agentspace/.test(cdHigh.path));
  const cdMid = api.citizenDev({tech_complex:3, integ_effort:3, compliance:3});
  ok('all-3 citizen-dev = 50%', cdMid.pct === 50);
  ok('mid path = Hybrid team', /Hybrid team/.test(cdMid.path));
  const cdLow = api.citizenDev({tech_complex:1, integ_effort:1, compliance:1});
  ok('all-1 citizen-dev = 0%', cdLow.pct === 0);
  ok('low path = Vertex AI (pro engineering)', /Vertex AI \(pro engineering\)/.test(cdLow.path));

  console.log('\n== 12. Live DOM reflects composite/quadrant/risk ==');
  ok('composite readout rendered / 5.0', /\/\s*5\.0/.test(document.getElementById('compNum').textContent));
  ok('quadrant name rendered', document.getElementById('quadName').textContent.trim().length > 2);
  ok('risk chip rendered', /risk/i.test(document.getElementById('riskChip').textContent));
  ok('citizen-dev pct rendered', /%$/.test(document.getElementById('cdPct').textContent.trim()));
  ok('eval line shows use-case name', /Automated invoice reconciliation/.test(document.getElementById('wsEval').textContent));
  // move a slider and confirm composite updates
  const before = document.getElementById('compNum').textContent;
  const s0 = document.querySelector('input[type=range].slider');
  s0.value = (Number(s0.value) === 5) ? '1' : '5';
  s0.dispatchEvent(new window.Event('input', {bubbles:true}));
  ok('composite updates when a slider moves', document.getElementById('compNum').textContent !== before);

  console.log('\n== 13. Data flow: reads gaic_intake + gaic_bxt, seeds, writes gaic_feasibility ==');
  ok('page references gaic_intake key', /gaic_intake/.test(html));
  ok('page references gaic_bxt key', /gaic_bxt/.test(html));
  ok('page references gaic_feasibility key', /gaic_feasibility/.test(html));
  ok('loadIntake returns HIGH intake (not demo)', api.loadIntake().fromDemo === false);
  ok('loadBxt returns bxt state (not demo)', api.loadBxt().fromDemo === false);
  // seeding uses strong BXT Business → high biz_value seed
  const seeded = api.seedScores(HIGH_INTAKE, BXT_STATE);
  ok('strong BXT Business → biz_value seed >= 4', seeded.biz_value >= 4);
  ok('all 10 seeds within 1-5', api.CRITERIA.every(c => seeded[c.id] >= 1 && seeded[c.id] <= 5));
  // wrote gaic_feasibility on init
  const persisted = JSON.parse(window.localStorage.getItem('gaic_feasibility'));
  ok('gaic_feasibility persisted on load', persisted && typeof persisted.composite === 'number');
  ok('persisted payload has scores/quadrant/risk/citizenDev',
     persisted.scores && persisted.quadrant && persisted.risk && persisted.citizenDev);

  console.log('\n== 14. Continue targets advisory.html; Back targets bxt.html ==');
  ok('Continue button targets advisory.html', document.getElementById('btnContinue').getAttribute('href') === 'advisory.html');
  ok('Back button targets bxt.html', document.getElementById('btnBack').getAttribute('href') === 'bxt.html');

  console.log('\n== 15. Graceful demo fallback with no localStorage ==');
  const domD = newDom(undefined, undefined);
  setTimeout(() => {
    const apiD = domD.window.__feas;
    const dD = domD.window.document;
    ok('loadIntake falls back to demo', apiD.loadIntake().fromDemo === true);
    ok('loadBxt falls back (no bxt state)', apiD.loadBxt().fromDemo === true);
    ok('demo still produces valid 1-5 seeds', apiD.CRITERIA.every(c => apiD.STATE.scores[c.id] >= 1 && apiD.STATE.scores[c.id] <= 5));
    ok('demo eval line rendered', /Evaluating:/.test(dD.getElementById('wsEval').textContent));
    ok('demo writes gaic_feasibility', !!domD.window.localStorage.getItem('gaic_feasibility'));

    console.log('\n== 16. Zero Microsoft strings; Google framing present ==');
    ok('contains Google framing (Vertex AI / Gemini / Agentspace / AppSheet / BigQuery)',
       /(Vertex AI|Gemini|Agentspace|AppSheet|BigQuery|Google Workspace)/.test(html));
    const microsoft = ['Copilot','Power Platform','MAIDF','Azure','M365','Blob','CAF:','Microsoft','Dataverse','Dynamics'];
    microsoft.forEach(m => ok('NO Microsoft string "'+m+'"',
      !new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(html)));

    console.log('\n== 17. bxt.html Continue wires to feasibility.html ==');
    ok('bxt Continue targets feasibility.html', /href="feasibility\.html"[^>]*id="btnContinue"|id="btnContinue"[^>]*href="feasibility\.html"/.test(bxtHtml) || /getElementById\('btnContinue'\)/.test(bxtHtml));
    ok('bxt has a link to feasibility.html', /feasibility\.html/.test(bxtHtml));

    console.log('\n---------------------------------------------');
    console.log('  RESULT: '+pass+' passed, '+fail+' failed');
    console.log('---------------------------------------------');
    process.exit(fail ? 1 : 0);
  }, 60);
}, 60);
