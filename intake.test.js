/* DOM verification test for intake.html — run with: node intake.test.js */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'intake.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; console.log('  \u2713 '+name); } else { fail++; console.log('  \u2717 '+name); } }

// Fresh localStorage-backed DOM
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/intake.html' });
const { window } = dom;
const { document } = window;

function fireInput(el){ el.dispatchEvent(new window.Event('input', {bubbles:true})); }
function fireChange(el){ el.dispatchEvent(new window.Event('change', {bubbles:true})); }
function click(el){ el.dispatchEvent(new window.MouseEvent('click', {bubbles:true})); }

// Wait for the IIFE to run (scripts run synchronously on parse for jsdom)
setTimeout(() => {
  console.log('\n== 1. Five tab panels exist ==');
  const panels = document.querySelectorAll('.panel');
  ok('exactly 5 panels', panels.length === 5);
  const tabs = document.querySelectorAll('.tab');
  ok('exactly 5 tabs in tab bar', tabs.length === 5);
  ok('window.__gaic.TABS has 5 entries', window.__gaic.TABS.length === 5);

  console.log('\n== 2. Tab switching shows/hides correctly ==');
  ok('panel 0 active on load', panels[0].classList.contains('is-active'));
  ok('panel 4 hidden on load', !panels[4].classList.contains('is-active'));
  window.__gaic.goTo(4);
  ok('after goTo(4): panel 4 active', panels[4].classList.contains('is-active'));
  ok('after goTo(4): panel 0 hidden', !panels[0].classList.contains('is-active'));
  ok('after goTo(4): only 1 panel visible', document.querySelectorAll('.panel.is-active').length === 1);
  ok('nav count reads Tab 5 of 5', document.getElementById('navCount').textContent === 'Tab 5 of 5');
  ok('Next button becomes Submit to BXT Gate', /Submit to BXT Gate/.test(document.getElementById('btnNext').textContent));
  window.__gaic.goTo(0);
  ok('back to tab 0: Next says Next', /Next/.test(document.getElementById('btnNext').textContent));
  ok('back to tab 0: Back disabled', document.getElementById('btnBack').disabled === true);

  console.log('\n== 3. Live score updates when a field changes ==');
  const before = document.getElementById('scoreNum').textContent;
  const valSel = document.getElementById('f_value');
  valSel.value = '>$5M'; fireChange(valSel);
  const align = document.getElementById('f_align');
  align.value = 'Core strategic priority'; fireChange(align);
  const after = document.getElementById('scoreNum').textContent;
  ok('score changed after setting high value + alignment', before !== after);
  ok('score climbed (after > before)', parseFloat(after) > parseFloat(before));
  ok('quadrant label rendered', /projected quadrant/.test(document.getElementById('scoreQuad').textContent));
  // 10 criterion bars
  ok('10 criterion mini-bars', document.querySelectorAll('.crit').length === 10);
  ok('citizen-dev % rendered as N%', /%$/.test(document.getElementById('cdPct').textContent));

  // High-value + easy path -> quadrant / platform sanity
  document.getElementById('f_maturity').value = 'Fully manual'; fireChange(document.getElementById('f_maturity'));
  const dataAvail = document.getElementById('f_dataavail'); dataAvail.value='Readily available & clean'; fireChange(dataAvail);
  // pick google-native integrations
  document.querySelectorAll('.chips[data-key="integrations"] .chip').forEach(c=>{ if(['Google Workspace','BigQuery'].includes(c.dataset.val)) click(c); });
  const platTextHigh = document.getElementById('cdPlatform').textContent;
  ok('platform line references a Google platform', /(AppSheet|Agentspace|Vertex AI)/.test(platTextHigh));

  console.log('\n== 4. localStorage save/restore ==');
  const raw = window.localStorage.getItem('gaic_intake');
  ok('gaic_intake key present', !!raw);
  const saved = JSON.parse(raw);
  ok('saved.value === ">$5M"', saved.value === '>$5M');
  ok('saved.align stored', saved.align === 'Core strategic priority');
  ok('saved.integrations is array with BigQuery', Array.isArray(saved.integrations) && saved.integrations.includes('BigQuery'));

  // set a text field + toggle + segmented, then reload into a NEW dom sharing the same storage
  const nameEl = document.getElementById('f_name'); nameEl.value='Invoice Recon'; fireInput(nameEl);
  window.__gaic.goTo(4);
  document.querySelectorAll('.seg[data-key="sensitivity"] button').forEach(b=>{ if(b.dataset.val==='High') click(b); });
  document.getElementById('f_pii').checked = true; fireChange(document.getElementById('f_pii'));

  const storage = window.localStorage.getItem('gaic_intake');
  const dom2 = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/intake.html',
    beforeParse(w){ w.localStorage.setItem('gaic_intake', storage); } });
  setTimeout(() => {
    const d2 = dom2.window.document;
    ok('restore: name field repopulated', d2.getElementById('f_name').value === 'Invoice Recon');
    ok('restore: value select repopulated', d2.getElementById('f_value').value === '>$5M');
    ok('restore: PII toggle checked', d2.getElementById('f_pii').checked === true);
    ok('restore: sensitivity=High segment active',
       Array.from(d2.querySelectorAll('.seg[data-key="sensitivity"] button')).some(b=>b.dataset.val==='High' && b.classList.contains('is-on')));
    ok('restore: BigQuery chip active',
       Array.from(d2.querySelectorAll('.chips[data-key="integrations"] .chip')).some(c=>c.dataset.val==='BigQuery' && c.classList.contains('is-on')));

    console.log('\n== 5. Google remap strings present, no Microsoft strings ==');
    const H = html; // check raw source for static strings
    ok('contains "AppSheet"', /AppSheet/.test(H));
    ok('contains "Agentspace"', /Agentspace/.test(H));
    ok('contains "Vertex AI"', /Vertex AI/.test(H));
    ok('contains "Google Cloud Adoption Framework"', /Google Cloud Adoption Framework/.test(H));
    ok('contains "GADF"', /GADF/.test(H));
    ok('contains "BigQuery" integration', /BigQuery/.test(H));
    const microsoft = ['Copilot','Power Platform','MAIDF','Azure','M365','Blob','CAF:'];
    microsoft.forEach(m => ok('NO Microsoft string "'+m+'"', !new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(H)));

    // ===================================================================
    // Bug #1 — empty/half-filled intake is rejected before Submit to BXT Gate
    // ===================================================================
    console.log('\n== 6. Required-field validation (Bug #1) ==');
    // Fresh, completely empty form.
    const domV = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/intake.html' });
    setTimeout(() => {
      const wV = domV.window, dV = wV.document, apiV = wV.__gaic;
      const clickV = el => el.dispatchEvent(new wV.MouseEvent('click', {bubbles:true}));
      const inputV = el => el.dispatchEvent(new wV.Event('input', {bubbles:true}));

      ok('empty form: validateRequired() is false', apiV.validateRequired(false) === false);
      ok('empty form: name + desc reported missing', apiV.missingRequired().length === 2);

      // Try to advance from tab 0 with everything blank — must stay on tab 0.
      clickV(dV.getElementById('btnNext'));
      ok('empty form: cannot advance past tab 0',
         dV.querySelectorAll('.panel')[0].classList.contains('is-active'));
      ok('empty form: name error shown inline', dV.getElementById('err_name').classList.contains('is-shown'));
      ok('empty form: desc error shown inline', dV.getElementById('err_desc').classList.contains('is-shown'));
      ok('empty form: name input flagged is-invalid', dV.getElementById('f_name').classList.contains('is-invalid'));

      // Jump to the last tab and attempt Submit — must be blocked and bounce to tab 0.
      apiV.goTo(4);
      clickV(dV.getElementById('btnNext'));
      ok('empty form: Submit blocked — no navigation to bxt.html',
         !/bxt\.html$/.test(wV.location.href));
      ok('empty form: Submit bounces back to tab 0 to show errors',
         dV.querySelectorAll('.panel')[0].classList.contains('is-active'));

      // Fill only the name — still invalid (desc missing).
      const nm = dV.getElementById('f_name'); nm.value = 'Just a name'; inputV(nm);
      ok('name-only: still invalid (desc required)', apiV.validateRequired(false) === false);
      ok('name-only: name error cleared as you type', !dV.getElementById('err_name').classList.contains('is-shown'));

      // Fill description too — now valid.
      const ds = dV.getElementById('f_desc'); ds.value = 'A real description of the use case.'; inputV(ds);
      ok('name+desc: validateRequired() true', apiV.validateRequired(false) === true);
      ok('name+desc: nothing missing', apiV.missingRequired().length === 0);

      // ===================================================================
      // Bug #2 — a fresh intake load clears stale downstream gate results
      // ===================================================================
      console.log('\n== 7. New-case load clears stale gate keys (Bug #2) ==');
      const domG = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://example.com/intake.html',
        beforeParse(w){
          // Simulate leftovers from a PRIOR, already-scored case.
          w.localStorage.setItem('gaic_bxt', JSON.stringify({verdict:'PASS'}));
          w.localStorage.setItem('gaic_feasibility', JSON.stringify({score:88}));
          w.localStorage.setItem('gaic_advisory', JSON.stringify({platform:'Vertex AI'}));
          w.localStorage.setItem('gaic_summary', JSON.stringify({done:true}));
        }});
      setTimeout(() => {
        const wG = domG.window;
        ok('gaic_bxt cleared on intake load', wG.localStorage.getItem('gaic_bxt') === null);
        ok('gaic_feasibility cleared on intake load', wG.localStorage.getItem('gaic_feasibility') === null);
        ok('gaic_advisory cleared on intake load', wG.localStorage.getItem('gaic_advisory') === null);
        ok('gaic_summary cleared on intake load', wG.localStorage.getItem('gaic_summary') === null);
        ok('clearGateState + GATE_KEYS exposed for reuse',
           typeof wG.__gaic.clearGateState === 'function' && Array.isArray(wG.__gaic.GATE_KEYS) && wG.__gaic.GATE_KEYS.length === 4);

        // '+ New Use Case' button on intake exists and wipes the draft too.
        console.log('\n== 8. ‘+ New Use Case’ entry point present ==');
        ok('intake has a wired ‘+ New Use Case’ button', !!domG.window.document.getElementById('btnNewUseCase'));

        console.log('\n---------------------------------------------');
        console.log('  RESULT: '+pass+' passed, '+fail+' failed');
        console.log('---------------------------------------------');
        process.exit(fail ? 1 : 0);
      }, 60);
    }, 60);
  }, 60);
}, 60);
