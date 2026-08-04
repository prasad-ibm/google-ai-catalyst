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

    console.log('\n---------------------------------------------');
    console.log('  RESULT: '+pass+' passed, '+fail+' failed');
    console.log('---------------------------------------------');
    process.exit(fail ? 1 : 0);
  }, 60);
}, 60);
