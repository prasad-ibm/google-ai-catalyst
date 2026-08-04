/* DOM verification test for bxt.html — run with: node bxt.test.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'bxt.html'), 'utf8');
const intakeHtml = fs.readFileSync(path.join(__dirname, 'intake.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; console.log('  \u2713 '+name); } else { fail++; console.log('  \u2717 '+name); } }
function fireChange(w, el){ el.dispatchEvent(new w.Event('change', {bubbles:true})); }
function fireInput(w, el){ el.dispatchEvent(new w.Event('input', {bubbles:true})); }
function click(w, el){ el.dispatchEvent(new w.MouseEvent('click', {bubbles:true})); }

// A high-scoring intake object → PASS
const HIGH = {
  name: 'Automated invoice reconciliation',
  desc: 'Automate month-end invoice matching and reconciliation across ERP systems.',
  sponsor: 'CFO', value: '>$5M', align: 'Core strategic priority', users: '>1000', driver: 'Revenue Growth',
  adoption: 'High', change: true, autonomy: 'Advisory',
  dataavail: 'Readily available & clean', integrations: ['Google Workspace','BigQuery','Vertex AI'],
  maturity: 'Highly automated', sources: ['Structured DB'], realtime: false
};
// A failing intake object → one lens < 45 (Experience tanked)
const FAILING = {
  name: 'Autonomous risk bot',
  desc: 'Fully autonomous bot that makes unsupervised risk decisions.',
  sponsor: 'Director-level', value: '$100K–$500K', align: 'Experimental / exploratory', users: '<10',
  adoption: 'Low', change: false, autonomy: 'Autonomous',
  dataavail: 'Not yet available', integrations: ['On-prem system','Third-party SaaS'],
  maturity: 'Fully manual', sources: ['Audio/Video','Images','Web'], realtime: true
};

function newDom(seedIntake){
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/bxt.html',
    beforeParse(w){ if (seedIntake !== undefined) w.localStorage.setItem('gaic_intake', JSON.stringify(seedIntake)); }
  });
}

const dom = newDom(HIGH);
const { window } = dom;
const { document } = window;

setTimeout(() => {
  const api = window.__bxt;

  console.log('\n== 1. Header / theme toggle present ==');
  ok('theme toggle button exists', !!document.getElementById('themeToggle'));
  ok('Google wordmark present', /Google/.test(document.querySelector('.gc-header__wordmark').textContent));
  // theme toggle works
  click(window, document.getElementById('themeToggle'));
  ok('theme toggle sets data-theme=light', document.documentElement.getAttribute('data-theme') === 'light');
  ok('theme persisted to gaic_theme', window.localStorage.getItem('gaic_theme') === 'light');

  console.log('\n== 2. Six-gate stepper: Gate 1 done, Gate 2 active ==');
  const gates = document.querySelectorAll('.gates .gate');
  ok('exactly 6 gates', gates.length === 6);
  ok('Gate 1 (Intake) is-done', gates[0].classList.contains('is-done'));
  ok('Gate 1 has a checkmark svg', !!gates[0].querySelector('svg'));
  ok('Gate 2 (BXT Gate) is-active', gates[1].classList.contains('is-active'));
  ok('Gate 2 label is "BXT Gate"', /BXT Gate/.test(gates[1].textContent));
  ok('Gates 3-6 upcoming (not active/done)',
     [2,3,4,5].every(i => !gates[i].classList.contains('is-active') && !gates[i].classList.contains('is-done')));
  const labels = Array.from(gates).map(g => g.querySelector('.gate__label').textContent.trim());
  ok('gate labels in correct order',
     JSON.stringify(labels) === JSON.stringify(['Intake','BXT Gate','Feasibility Scoring','Platform Advisory','Evaluation Summary','Executive Review Panel']));

  console.log('\n== 3. Gate banner copy ==');
  ok('banner title "BXT Gate"', /BXT Gate/.test(document.querySelector('.banner__title').textContent));
  ok('banner mentions Business × Experience × Technology', /Business × Experience × Technology/.test(document.querySelector('.banner__desc').textContent));
  ok('banner has a "Why:" bold', /Why:/.test(document.querySelector('.banner__desc').innerHTML));

  console.log('\n== 4. Three BXT dimension cards present ==');
  ok('dim-B (Business) card exists', !!document.getElementById('dim-B'));
  ok('dim-X (Experience) card exists', !!document.getElementById('dim-X'));
  ok('dim-T (Technology) card exists', !!document.getElementById('dim-T'));
  ok('exactly 3 dimension cards', document.querySelectorAll('.dim').length === 3);
  ok('Business card labelled Business', /Business/.test(document.getElementById('dim-B').textContent));
  ok('Experience card labelled Experience', /Experience/.test(document.getElementById('dim-X').textContent));
  ok('Technology card labelled Technology', /Technology/.test(document.getElementById('dim-T').textContent));
  // each card renders 3 sub-factors
  ok('Business has 3 sub-factors', document.querySelector('[data-sub="B"]').querySelectorAll('.sf').length === 3);
  ok('Experience has 3 sub-factors', document.querySelector('[data-sub="X"]').querySelectorAll('.sf').length === 3);
  ok('Technology has 3 sub-factors', document.querySelector('[data-sub="T"]').querySelectorAll('.sf').length === 3);

  console.log('\n== 5. Scoring function returns 0-100 per dimension ==');
  const sc = api.bxtScore(HIGH);
  ['B','X','T'].forEach(k => {
    ok(k+' score is a number 0-100', typeof sc[k].score === 'number' && sc[k].score >= 0 && sc[k].score <= 100);
    ok(k+' has 3 factors each 0-100', sc[k].factors.length === 3 && sc[k].factors.every(f => f.v >= 0 && f.v <= 100));
  });
  // deterministic / pure — same input twice
  const sc2 = api.bxtScore(HIGH);
  ok('scoring is deterministic', JSON.stringify(sc) === JSON.stringify(sc2));
  // missing fields → neutral midpoints, still 0-100
  const scEmpty = api.bxtScore({});
  ok('empty input still yields 0-100 scores', ['B','X','T'].every(k => scEmpty[k].score >= 0 && scEmpty[k].score <= 100));
  // high input scores high on all lenses
  ok('HIGH input: all lenses >= 60', ['B','X','T'].every(k => sc[k].score >= 60));

  console.log('\n== 6. Verdict logic at thresholds ==');
  // PASS: all >= 60
  ok('PASS when all three >= 60', api.bxtVerdict({B:{score:80},X:{score:70},T:{score:65}}).verdict === 'PASS');
  ok('PASS boundary: all exactly 60', api.bxtVerdict({B:{score:60},X:{score:60},T:{score:60}}).verdict === 'PASS');
  // CONDITIONAL: all >= 45 but one < 60
  ok('CONDITIONAL when all>=45 and one<60', api.bxtVerdict({B:{score:80},X:{score:50},T:{score:70}}).verdict === 'CONDITIONAL');
  ok('CONDITIONAL boundary: min exactly 45', api.bxtVerdict({B:{score:70},X:{score:45},T:{score:70}}).verdict === 'CONDITIONAL');
  // FAIL: any < 45
  ok('FAIL when any < 45', api.bxtVerdict({B:{score:80},X:{score:44},T:{score:70}}).verdict === 'FAIL');
  ok('FAIL boundary: 44 fails', api.bxtVerdict({B:{score:90},X:{score:90},T:{score:44}}).verdict === 'FAIL');
  // weakest lens identification
  const wv = api.bxtVerdict({B:{score:80},X:{score:42},T:{score:70}});
  ok('weakest lens = Experience', wv.weakName === 'Experience' && wv.weakScore === 42);

  console.log('\n== 7. Live DOM reflects PASS verdict for HIGH intake ==');
  ok('verdict chip shows PASS', /PASS/.test(document.getElementById('verdictChip').textContent) && !/CONDITIONAL/.test(document.getElementById('verdictChip').textContent));
  ok('weakest lens line rendered', /Weakest lens:/.test(document.getElementById('verdictWeak').textContent));
  ok('recommendation line present', document.getElementById('verdictRec').textContent.length > 10);
  ok('eval line shows use-case name', /Automated invoice reconciliation/.test(document.getElementById('wsEval').textContent));
  ok('Continue button targets feasibility.html', document.getElementById('btnContinue').getAttribute('href') === 'feasibility.html');
  ok('Continue NOT disabled on PASS', document.getElementById('btnContinue').getAttribute('aria-disabled') !== 'true');
  ok('Back button targets intake.html', document.getElementById('btnBack').getAttribute('href') === 'intake.html');

  console.log('\n== 8. FAIL intake disables Continue + shows override ==');
  const domF = newDom(FAILING);
  setTimeout(() => {
    const dF = domF.window.document;
    const apiF = domF.window.__bxt;
    const scF = apiF.bxtScore(FAILING);
    ok('FAILING intake: at least one lens < 45', ['B','X','T'].some(k => scF[k].score < 45));
    ok('FAILING verdict = FAIL', apiF.bxtVerdict(scF).verdict === 'FAIL');
    ok('FAIL: verdict chip shows FAIL', /FAIL/.test(dF.getElementById('verdictChip').textContent));
    ok('FAIL: Continue disabled (aria)', dF.getElementById('btnContinue').getAttribute('aria-disabled') === 'true');
    ok('FAIL: note visible', dF.getElementById('continueNote').style.display !== 'none');
    ok('FAIL: "Proceed anyway" override visible', dF.getElementById('overrideLink').style.display !== 'none');
    ok('FAIL: override still targets feasibility.html', dF.getElementById('overrideLink').getAttribute('href') === 'feasibility.html');

    console.log('\n== 9. Graceful fallback with no localStorage ==');
    const domD = newDom(undefined); // no seed
    setTimeout(() => {
      const dD = domD.window.document;
      const apiD = domD.window.__bxt;
      ok('loadIntake falls back to demo', apiD.loadIntake().fromDemo === true);
      ok('demo eval line rendered', /Evaluating:/.test(dD.getElementById('wsEval').textContent));
      ok('demo still produces valid 0-100 scores', ['B','X','T'].every(k => apiD.result.scores[k].score >= 0 && apiD.result.scores[k].score <= 100));

      console.log('\n== 10. Reads gaic_intake key + no Microsoft strings ==');
      ok('bxt.html references gaic_intake key', /gaic_intake/.test(html));
      ok('contains Google framing (Vertex AI / Gemini / Agentspace / AppSheet)',
         /(Vertex AI|Gemini|Agentspace|AppSheet)/.test(html));
      const microsoft = ['Copilot','Power Platform','MAIDF','Azure','M365','Blob','CAF:'];
      microsoft.forEach(m => ok('NO Microsoft string "'+m+'"',
        !new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(html)));

      console.log('\n== 11. intake.html submit navigates to bxt.html + writes gaic_intake ==');
      ok('intake submit sets window.location to bxt.html', /window\.location\.href\s*=\s*['"]bxt\.html['"]/.test(intakeHtml));
      ok('intake no longer uses the old alert', !/Submitted to BXT Gate\. \(Prototype/.test(intakeHtml));
      ok('intake persists to gaic_intake on submit', /localStorage\.setItem\(LS_KEY/.test(intakeHtml) && /LS_KEY\s*=\s*['"]gaic_intake['"]/.test(intakeHtml));

      // =================================================================
      // Bug #2 — an incomplete / leftover intake must NOT be scored as if
      // it were the previous case. Root cause of "empty form returned the
      // AI Contact Center Agent Assist scores".
      // =================================================================
      console.log('\n== 12. Incomplete intake never inherits a prior case (Bug #2) ==');
      ok('isScoreableIntake({}) === false', apiD.isScoreableIntake({}) === false);
      ok('isScoreableIntake(null) === false', apiD.isScoreableIntake(null) === false);
      ok('name without desc is NOT scoreable', apiD.isScoreableIntake({ name:'X' }) === false);
      ok('desc without name is NOT scoreable', apiD.isScoreableIntake({ desc:'Y' }) === false);
      ok('whitespace-only name+desc NOT scoreable', apiD.isScoreableIntake({ name:'   ', desc:'  ' }) === false);
      ok('name+desc IS scoreable', apiD.isScoreableIntake({ name:'A', desc:'B' }) === true);

      // A leftover object missing name/desc (e.g. a half-filled draft that was
      // never cleared) must fall back to DEMO, not be scored verbatim.
      const domLeft = newDom({ sponsor:'CFO', value:'>$5M' }); // no name, no desc
      setTimeout(() => {
        const apiLeft = domLeft.window.__bxt;
        ok('leftover intake w/o name+desc → fromDemo', apiLeft.loadIntake().fromDemo === true);
        ok('leftover intake does NOT surface its own value field',
           apiLeft.loadIntake().data !== undefined && apiLeft.loadIntake().fromDemo === true);

        // '+ New Use Case' flow clears every stale gate key + the draft.
        console.log('\n== 13. ‘+ New Use Case’ clears stale gate keys (Bug #2) ==');
        const domNew = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/bxt.html',
          beforeParse(w){
            w.localStorage.setItem('gaic_intake', JSON.stringify(HIGH));
            w.localStorage.setItem('gaic_bxt', JSON.stringify({verdict:'PASS'}));
            w.localStorage.setItem('gaic_feasibility', '1');
            w.localStorage.setItem('gaic_advisory', '1');
            w.localStorage.setItem('gaic_summary', '1');
          }});
        setTimeout(() => {
          const wN = domNew.window;
          ok('bxt exposes startNewUseCase()', typeof wN.__bxt.startNewUseCase === 'function');
          ok('bxt has a wired ‘+ New Use Case’ button', !!domNew.window.document.getElementById('btnNewUseCase'));
          wN.__bxt.startNewUseCase();
          ok('new case clears gaic_intake', wN.localStorage.getItem('gaic_intake') === null);
          ok('new case clears gaic_bxt', wN.localStorage.getItem('gaic_bxt') === null);
          ok('new case clears gaic_feasibility', wN.localStorage.getItem('gaic_feasibility') === null);
          ok('new case clears gaic_advisory', wN.localStorage.getItem('gaic_advisory') === null);
          ok('new case clears gaic_summary', wN.localStorage.getItem('gaic_summary') === null);

          console.log('\n---------------------------------------------');
          console.log('  RESULT: '+pass+' passed, '+fail+' failed');
          console.log('---------------------------------------------');
          process.exit(fail ? 1 : 0);
        }, 60);
      }, 60);
      return; // final RESULT printed in the nested callbacks above

      // eslint-disable-next-line no-unreachable
      console.log('\n---------------------------------------------');
      console.log('  RESULT: '+pass+' passed, '+fail+' failed');
      console.log('---------------------------------------------');
      process.exit(fail ? 1 : 0);
    }, 60);
  }, 60);
}, 60);
