/* DOM verification test for advisory.html — run with: node advisory.test.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'advisory.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; console.log('  \u2713 '+name); } else { fail++; console.log('  \u2717 '+name); } }
function click(w, el){ el.dispatchEvent(new w.MouseEvent('click', {bubbles:true})); }

// A feasibility payload that pushes AI complexity high → Build tier when combined with rich intake
const FEAS_STATE = {
  composite: 3.8,
  scores: { biz_value:4, strat_align:4, data_value:3, data_avail:3, tech_complex:3, integ_effort:3, ttv:3, safety:4, compliance:4, user_value:3 },
  quadrant: { name:'Quick Win' },
  risk: 'Medium',
  citizenDev: { pct:50, path:'Hybrid team' }
};
const BXT_STATE   = { scores: { B:{score:80}, X:{score:70}, T:{score:75} }, verdict:{verdict:'PASS'} };
const INTAKE_STATE = {
  name: 'Automated invoice reconciliation', sponsor:'CFO', value:'>$5M', users:'>1000',
  align:'Core strategic priority', driver:'Cost Reduction', maturity:'Partially automated',
  sources:['Structured DB','Documents/PDFs','Chat/Tickets','Audio/Video'], integrations:['Google Workspace','BigQuery'],
  realtime:true, autonomy:'Autonomous', sensitivity:'Medium', pii:false, audit:true
};

function newDom(seedIntake, seedBxt, seedFeas){
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/advisory.html',
    beforeParse(w){
      if (seedIntake !== undefined) w.localStorage.setItem('gaic_intake', JSON.stringify(seedIntake));
      if (seedBxt !== undefined) w.localStorage.setItem('gaic_bxt', JSON.stringify(seedBxt));
      if (seedFeas !== undefined) w.localStorage.setItem('gaic_feasibility', JSON.stringify(seedFeas));
    }
  });
}

const dom = newDom(INTAKE_STATE, BXT_STATE, FEAS_STATE);
const { window } = dom;
const { document } = window;

setTimeout(() => {
  const api = window.__adv;

  console.log('\n== 1. Header / theme toggle present ==');
  ok('theme toggle button exists', !!document.getElementById('themeToggle'));
  ok('Google wordmark present', /Google/.test(document.querySelector('.gc-header__wordmark').textContent));
  ok('Enterprise Advantage tag present', /Enterprise Advantage/.test(document.querySelector('.gc-header__product').textContent));
  ok('+ New Use Case button present', /New Use Case/.test(document.body.innerHTML));
  ok('WORKSPACE select present', /WORKSPACE/.test(document.body.innerHTML));
  click(window, document.getElementById('themeToggle'));
  ok('theme toggle sets data-theme=light', document.documentElement.getAttribute('data-theme') === 'light');
  ok('theme persisted to gaic_theme', window.localStorage.getItem('gaic_theme') === 'light');

  console.log('\n== 2. Six-gate stepper: Gates 1-3 done, Gate 4 active ==');
  const gates = document.querySelectorAll('.gates .gate');
  ok('exactly 6 gates', gates.length === 6);
  ok('Gate 1 (Intake) is-done', gates[0].classList.contains('is-done'));
  ok('Gate 1 has checkmark svg', !!gates[0].querySelector('svg'));
  ok('Gate 2 (BXT Gate) is-done', gates[1].classList.contains('is-done'));
  ok('Gate 2 has checkmark svg', !!gates[1].querySelector('svg'));
  ok('Gate 3 (Feasibility Scoring) is-done', gates[2].classList.contains('is-done'));
  ok('Gate 3 has checkmark svg', !!gates[2].querySelector('svg'));
  ok('Gate 4 (Platform Advisory) is-active', gates[3].classList.contains('is-active'));
  ok('Gates 5-6 upcoming (not active/done)',
     [4,5].every(i => !gates[i].classList.contains('is-active') && !gates[i].classList.contains('is-done')));
  const labels = Array.from(gates).map(g => g.querySelector('.gate__label').textContent.trim());
  ok('gate labels in correct order',
     JSON.stringify(labels) === JSON.stringify(['Intake','BXT Gate','Feasibility Scoring','Platform Advisory','Evaluation Summary','Executive Review Panel']));

  console.log('\n== 3. Gate banner references GADF (and NOT MAIDF) ==');
  ok('banner title "Platform Advisory"', /Platform Advisory/.test(document.querySelector('.banner__title').textContent));
  ok('banner names Google AI Decision Framework (GADF)', /Google AI Decision Framework \(GADF\)/.test(document.querySelector('.banner__desc').innerHTML));
  ok('banner mentions 5 dimensions', /5 dimensions/.test(document.querySelector('.banner__desc').textContent));
  ok('banner has a "Why:" bold', /Why:/.test(document.querySelector('.banner__desc').innerHTML));
  ok('banner does NOT reference MAIDF', !/MAIDF/.test(document.body.innerHTML));
  ok('Re-run button present', !!document.getElementById('btnRerun'));

  console.log('\n== 4. resolveTier — sequential gate thresholds ==');
  // ADOPT: high coverage, low custom, low complexity
  const adopt = api.resolveTier({ workspace_coverage:5, custom_workflow:1, ai_complexity:1 });
  ok('Adopt tier', adopt.tier === 'Adopt');
  ok('Adopt verdict name "Start Simple"', adopt.verdictName === 'Start Simple');
  ok('Adopt platform "Gemini for Google Workspace"', adopt.platform === 'Gemini for Google Workspace');
  ok('Adopt gateId gate1_adopt', adopt.gateId === 'gate1_adopt');
  // EXTEND: custom workflow, moderate complexity
  const extend = api.resolveTier({ workspace_coverage:2, custom_workflow:4, ai_complexity:3 });
  ok('Extend tier', extend.tier === 'Extend');
  ok('Extend verdict name "Scale Smart"', extend.verdictName === 'Scale Smart');
  ok('Extend platform "AppSheet / Agentspace"', extend.platform === 'AppSheet / Agentspace');
  ok('Extend gateId gate2_lowcode', extend.gateId === 'gate2_lowcode');
  // BUILD: high AI complexity
  const build = api.resolveTier({ workspace_coverage:2, custom_workflow:4, ai_complexity:5 });
  ok('Build tier', build.tier === 'Build');
  ok('Build verdict name "Build Custom"', build.verdictName === 'Build Custom');
  ok('Build platform "Vertex AI Agent Builder"', build.platform === 'Vertex AI Agent Builder');
  ok('Build gateId gate3_build', build.gateId === 'gate3_build');
  // boundary: high complexity beats a would-be adopt
  ok('high AI complexity forces Build even w/ high coverage', api.resolveTier({workspace_coverage:5, custom_workflow:1, ai_complexity:4}).tier === 'Build');
  // boundary: coverage=4 custom=2 complexity=2 → Adopt (edge of gate 1)
  ok('edge coverage=4,custom=2,complexity=2 → Adopt', api.resolveTier({workspace_coverage:4, custom_workflow:2, ai_complexity:2}).tier === 'Adopt');
  // just past edge: custom=3 → Extend
  ok('custom=3 blocks Adopt → Extend', api.resolveTier({workspace_coverage:4, custom_workflow:3, ai_complexity:2}).tier === 'Extend');
  // determinism
  ok('resolveTier deterministic', api.resolveTier({workspace_coverage:2,custom_workflow:4,ai_complexity:3}).tier === api.resolveTier({workspace_coverage:2,custom_workflow:4,ai_complexity:3}).tier);

  console.log('\n== 5. Compliance chip derives from risk tier ==');
  ok('High risk → REVIEW NEEDED', api.compliance('High').label === 'REVIEW NEEDED' && api.compliance('High').ok === false);
  ok('Medium risk → COMPLIANT', api.compliance('Medium').label === 'COMPLIANT' && api.compliance('Medium').ok === true);
  ok('Low risk → COMPLIANT', api.compliance('Low').label === 'COMPLIANT' && api.compliance('Low').ok === true);

  console.log('\n== 6. Verdict hero band rendered ==');
  ok('verdict name rendered', document.getElementById('vName').textContent.trim().length > 2);
  ok('verdict tier rendered', ['Adopt','Extend','Build'].indexOf(document.getElementById('vTier').textContent.trim()) > -1);
  ok('compliance chip rendered', /(COMPLIANT|REVIEW NEEDED)/.test(document.getElementById('vCompliance').textContent));
  ok('platform name rendered', document.getElementById('vPlatform').textContent.trim().length > 2);
  ok('platform icon svg rendered', !!document.getElementById('vPlatIcon').querySelector('svg'));
  ok('gate-resolved line references gate id', /gate[123]_/.test(document.getElementById('vGateResolved').textContent));
  ok('gate sub-label rendered', /Gate [123]/.test(document.getElementById('vGateLabel').textContent));

  console.log('\n== 7. Three reasoning cards with expanders ==');
  const cards = document.querySelectorAll('.rcard');
  ok('exactly 3 reasoning cards', cards.length === 3);
  ok('api exposes 3 REASON_CARDS', api.REASON_CARDS.length === 3);
  const cardTitles = Array.from(cards).map(c => c.querySelector('.rcard__title').textContent.trim());
  ok('card titles: Workspace Coverage / Custom Workflow / AI Complexity',
     JSON.stringify(cardTitles) === JSON.stringify(['Workspace Coverage','Custom Workflow','AI Complexity']));
  ok('each card has a question', Array.from(cards).every(c => c.querySelector('.rcard__q').textContent.trim().length > 5));
  ok('each card has an answer', Array.from(cards).every(c => c.querySelector('.rcard__a').textContent.trim().length > 10));
  ok('each card has a tier chip', Array.from(cards).every(c => c.querySelector('.rcard__tier')));
  ok('each card has "See rationale" expander', Array.from(cards).every(c => /See rationale/.test(c.querySelector('.rcard__exp').textContent)));
  // expander toggles
  const c0 = cards[0];
  const wasOpen = c0.classList.contains('is-open');
  click(window, c0.querySelector('.rcard__exp'));
  ok('clicking expander toggles is-open', c0.classList.contains('is-open') !== wasOpen);

  console.log('\n== 8. Platform journey: 3 phases ==');
  const phases = document.querySelectorAll('.phase');
  ok('exactly 3 journey phases', phases.length === 3);
  ok('api exposes 3 PHASES', api.PHASES.length === 3);
  const phasePlats = Array.from(phases).map(p => p.querySelector('.phase__plat').textContent.trim());
  ok('phase platforms map correctly',
     JSON.stringify(phasePlats) === JSON.stringify(['Gemini for Google Workspace','AppSheet / Agentspace','Vertex AI Agent Builder']));
  ok('subtitle "Start where you are, scale when ready" present', /Start where you are, scale when ready/.test(document.body.innerHTML));
  ok('Phase 1 badge "Now" present', /Now/.test(phases[0].querySelector('.phase__badge').textContent));
  ok('a "Ready to move on when" box present', /Ready to move on when/i.test(document.body.innerHTML));
  ok('a "Scale trigger" box present', /Scale trigger/i.test(document.body.innerHTML));
  ok('exactly one phase is-current (matches verdict tier)', document.querySelectorAll('.phase.is-current').length === 1);
  const currentPhaseTier = document.querySelector('.phase.is-current').getAttribute('data-phase');
  ok('current phase matches verdict tier', currentPhaseTier === document.getElementById('vTier').textContent.trim());
  ok('journey arrows between phases (2)', document.querySelectorAll('.journey__arrow').length === 2);

  console.log('\n== 9. Advisor debate renders turns ==');
  const debate = document.getElementById('debate');
  const debTurns = document.querySelectorAll('#debateBody .turn');
  ok('debate renders at least 3 turns', debTurns.length >= 3);
  ok('debate has a consensus turn', document.querySelectorAll('#debateBody .turn.is-consensus').length === 1);
  ok('advisors are Google-flavored (Workspace Advocate / Platform Architect / Governance Lead)',
     /Workspace Advocate/.test(document.body.innerHTML) && /Platform Architect/.test(document.body.innerHTML) && /Governance Lead/.test(document.body.innerHTML));
  ok('consensus turn references the verdict name', new RegExp(document.getElementById('vName').textContent.trim()).test(document.querySelector('#debateBody .turn.is-consensus').textContent));
  // collapsible toggles
  const debOpenBefore = debate.classList.contains('is-open');
  click(window, document.getElementById('debateHead'));
  ok('debate head click toggles is-open', debate.classList.contains('is-open') !== debOpenBefore);
  ok('debateScript returns >= 3 turns for a tier', api.debateScript({tier:'Extend', verdictName:'Scale Smart', platform:'AppSheet / Agentspace'}).length >= 3);

  console.log('\n== 10. deriveDimensions produces 5 dims in 1-5 ==');
  const dims = api.deriveDimensions(FEAS_STATE, INTAKE_STATE);
  const dimKeys = ['workspace_coverage','custom_workflow','ai_complexity','data_sensitivity','scale_need'];
  ok('all 5 GADF dimensions present', dimKeys.every(k => typeof dims[k] === 'number'));
  ok('all dims within 1-5', dimKeys.every(k => dims[k] >= 1 && dims[k] <= 5));

  console.log('\n== 11. Data flow: reads keys + writes gaic_advisory ==');
  ok('page references gaic_feasibility key', /gaic_feasibility/.test(html));
  ok('page references gaic_bxt key', /gaic_bxt/.test(html));
  ok('page references gaic_intake key', /gaic_intake/.test(html));
  ok('page references gaic_advisory key', /gaic_advisory/.test(html));
  ok('loadIntake returns seeded intake (not demo)', api.loadIntake().fromDemo === false);
  const persisted = JSON.parse(window.localStorage.getItem('gaic_advisory'));
  ok('gaic_advisory persisted on load', persisted && typeof persisted.tier === 'string');
  ok('persisted payload has tier/verdictName/platform/dims/compliance',
     persisted.tier && persisted.verdictName && persisted.platform && persisted.dims && persisted.compliance);

  console.log('\n== 12. Re-run recomputes ==');
  window.localStorage.removeItem('gaic_advisory');
  click(window, document.getElementById('btnRerun'));
  ok('Re-run re-writes gaic_advisory', !!window.localStorage.getItem('gaic_advisory'));
  ok('Re-run keeps a valid tier', ['Adopt','Extend','Build'].indexOf(JSON.parse(window.localStorage.getItem('gaic_advisory')).tier) > -1);

  console.log('\n== 13. Footer nav: Back → feasibility, Continue → summary ==');
  ok('Back button targets feasibility.html', document.getElementById('btnBack').getAttribute('href') === 'feasibility.html');
  ok('Continue button targets summary.html', document.getElementById('btnContinue').getAttribute('href') === 'summary.html');
  ok('Continue label mentions Evaluation Summary', /Evaluation Summary/.test(document.getElementById('btnContinue').textContent));

  console.log('\n== 14. Graceful demo fallback (no localStorage) → Extend / Scale Smart ==');
  const domD = newDom(undefined, undefined, undefined);
  setTimeout(() => {
    const apiD = domD.window.__adv;
    const dD = domD.window.document;
    ok('loadIntake falls back to demo', apiD.loadIntake().fromDemo === true);
    ok('loadBxt falls back (no bxt state)', apiD.loadBxt().fromDemo === true);
    ok('loadFeasibility falls back (no feas state)', apiD.loadFeasibility().fromDemo === true);
    ok('demo eval line shows Customer Sentiment Analysis', /Customer Sentiment Analysis/.test(dD.getElementById('wsEval').textContent));
    ok('demo resolves to Extend tier', apiD.result.tier === 'Extend');
    ok('demo verdict name "Scale Smart"', apiD.result.verdictName === 'Scale Smart');
    ok('demo platform "AppSheet / Agentspace"', apiD.result.platform === 'AppSheet / Agentspace');
    ok('demo writes gaic_advisory', !!domD.window.localStorage.getItem('gaic_advisory'));

    console.log('\n== 15. Zero Microsoft strings; Google framing present ==');
    ok('contains Google framing (Gemini / AppSheet / Agentspace / Vertex AI / Workspace)',
       /(Gemini for Google Workspace|AppSheet \/ Agentspace|Vertex AI Agent Builder)/.test(html));
    const microsoft = ['MAIDF','Copilot','Power Platform','Azure','M365','watsonx','Agentforce','Salesforce','Microsoft','Dataverse','Dynamics','Blob','CAF:'];
    microsoft.forEach(m => ok('NO Microsoft string "'+m+'"',
      !new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(html)));

    console.log('\n---------------------------------------------');
    console.log('  RESULT: '+pass+' passed, '+fail+' failed');
    console.log('---------------------------------------------');
    process.exit(fail ? 1 : 0);
  }, 60);
}, 60);
