/* DEF-06: canonical 14 static departments + dynamic facet merge.
 * Verifies the intake Department dropdown ships the fixed canonical list
 * and that JS parses the /api/portfolio/facets response, merging any extra
 * (real/custom) departments while deduping against the canonical set.
 * Run with: node intake-dept.test.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { resolveDepartment } = require('./departments');

const html = fs.readFileSync(path.join(__dirname, 'intake.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond){ if(cond){ pass++; console.log('  \u2713 '+name); } else { fail++; console.log('  \u2717 '+name); } }

// Canonical department taxonomy (DEF-06). Membership asserted, not order.
const CANONICAL = [
  'Human Resources','Finance','Procurement','Supply Chain','Data Center Group',
  'Manufacturing','Quality','Sales','Marketing','Legal','IT','Customer Support',
  'R&D','Security'
];

function realOptions(sel){
  // exclude the empty placeholder ("Select…")
  return Array.from(sel.options).map(o => o.textContent.trim()).filter(t => t && t !== 'Select\u2026');
}

// wait N ms without keeping refs to JSDOM timers
const wait = ms => new Promise(res => setTimeout(res, ms));

function makeDom(fetchImpl){
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/intake.html',
    beforeParse(w){ w.fetch = fetchImpl; }
  });
}

// Facet payload: canonical dup (exact + case), two genuinely new depts,
// a whitespace-padded duplicate of a new one, and an empty value to ignore.
function facetFetch(url){
  if (/\/api\/portfolio\/facets/.test(url)) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        departments: [
          { value: 'Finance', count: 12 },
          { value: 'finance', count: 1 },
          { value: 'Aerospace', count: 4 },
          { value: 'Public Sector', count: 2 },
          { value: '  Aerospace  ', count: 1 },
          { value: '', count: 9 }
        ]
      })
    });
  }
  return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
}

const noFetch = () => Promise.resolve({ ok:false, json:()=>Promise.resolve(null) });

(async () => {
  // ---- Test A: static canonical list, no network merge ----
  console.log('\n== A. Canonical 14 static departments (no network) ==');
  const domStatic = makeDom(noFetch);
  await wait(150);
  const selS = domStatic.window.document.getElementById('f_dept');
  ok('f_dept select exists', !!selS);
  const optsS = realOptions(selS);
  ok('exactly 14 canonical departments render', optsS.length === 14);
  CANONICAL.forEach(d => ok('canonical present: '+d, optsS.includes(d)));
  ok('placeholder option "Select…" present', selS.options[0].textContent.trim() === 'Select\u2026');
  ok('no duplicate entries (case-insensitive)',
     new Set(optsS.map(s=>s.toLowerCase())).size === optsS.length);
  domStatic.window.close();

  // ---- Test B: dynamic facet merge + dedup ----
  console.log('\n== B. Dynamic facet merge + dedup (JS parses /facets) ==');
  const domMerge = makeDom(facetFetch);
  await wait(250); // allow fetch promise chain + append to settle
  const selM = domMerge.window.document.getElementById('f_dept');
  const optsM = realOptions(selM);
  ok('new dept "Aerospace" merged in', optsM.includes('Aerospace'));
  ok('new dept "Public Sector" merged in', optsM.includes('Public Sector'));
  ok('canonical "Finance" not duplicated (exact)', optsM.filter(o => o === 'Finance').length === 1);
  ok('no case-variant "finance" added', !optsM.some(o => o === 'finance'));
  ok('padded "  Aerospace  " trimmed + deduped (appears once)',
     optsM.filter(o => o === 'Aerospace').length === 1);
  ok('empty facet value ignored', !optsM.some(o => o === ''));
  ok('total = 14 canonical + 2 new = 16', optsM.length === 16);
  ok('all entries unique (case-insensitive)',
     new Set(optsM.map(s=>s.toLowerCase())).size === optsM.length);
  domMerge.window.close();

  // ---- Test C: DEF-08 — Department is now ENFORCED as required ----
  console.log('\n== C. DEF-08 required-Department enforcement ==');
  const domReq = makeDom(noFetch);
  await wait(150);
  const w = domReq.window, g = w.__gaic;
  ok('__gaic.validateRequired exposed', g && typeof g.validateRequired === 'function');
  // Seed the other required fields (name, desc) but leave dept empty.
  var st = g.getState();
  st.name = 'Test Case'; st.desc = 'A sufficiently long description for validation.'; st.dept = '';
  var missing = g.missingRequired().map(function(r){ return r.key; });
  ok('dept flagged missing when empty', missing.indexOf('dept') !== -1);
  ok('validateRequired(true) blocks with empty dept', g.validateRequired(true) === false);
  ok('err_dept element exists', !!w.document.getElementById('err_dept'));
  ok('f_dept marked is-invalid after failed validate (reveal)',
     w.document.getElementById('f_dept').classList.contains('is-invalid'));
  // Now set a department and re-validate.
  st.dept = 'Finance';
  ok('dept no longer missing once set', g.missingRequired().map(function(r){return r.key;}).indexOf('dept') === -1);
  ok('validateRequired() passes with all required set', g.validateRequired() === true);
  domReq.window.close();

  // ---- Test D: DEF-13 — server-side alias resolution for bulk import ----
  // resolveDepartment() is the single source of truth the bulk-import path uses
  // to coerce incoming department strings. Common abbreviations must resolve to
  // a canonical value (so legitimate rows aren't silently dropped), canonical
  // values must still pass through, and genuine junk must still become null.
  console.log('\n== D. DEF-13 resolveDepartment alias resolution ==');
  ok("'HR' resolves to 'Human Resources' (QA must-have)",
     resolveDepartment('HR') === 'Human Resources');
  ok("'  hr ' trims + folds case to 'Human Resources'",
     resolveDepartment('  hr ') === 'Human Resources');
  ok("'research and development' resolves to 'R&D'",
     resolveDepartment('research and development') === 'R&D');
  ok("'Information Technology' resolves to 'IT'",
     resolveDepartment('Information Technology') === 'IT');
  ok("'InfoSec' resolves to 'Security'",
     resolveDepartment('InfoSec') === 'Security');
  ok("'Purchasing' resolves to 'Procurement'",
     resolveDepartment('Purchasing') === 'Procurement');
  ok("canonical 'Finance' still resolves to itself",
     resolveDepartment('Finance') === 'Finance');
  ok("canonical 'R&D' still resolves to itself",
     resolveDepartment('R&D') === 'R&D');
  ok("junk 'NotARealDept' still resolves to null",
     resolveDepartment('NotARealDept') === null);
  ok("unknown 'Ops' still resolves to null",
     resolveDepartment('Ops') === null);
  ok('blank string still resolves to null', resolveDepartment('   ') === null);

  console.log('\n---------------------------------------------');
  console.log('  RESULT: '+pass+' passed, '+fail+' failed');
  console.log('---------------------------------------------');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('FATAL', err); process.exit(2); });
