/* M6 regression parity (Round 10): the Executive Brief's ROI band must equal the
   Summary hero's ROI band for the SAME use case — for BOTH seeded and freshly
   created cases.

   History:
     R9  fix: Brief recomputed benefit FRESH (vs a stale ~$900K persisted basis).
     R10 bug: that "always recompute fresh" rule BROKE newly-created cases. The
              Summary persisted its roi from feas.biz_value=4  -> $4.2M basis,
              while the Brief's live path recomputed against a loaded feas that
              defaulted to biz_value=3 -> $3.6M. annualValue = base*(0.6+0.2*bv),
              so 1.2/1.4 = 0.857 => the exact ~14% ($4.2M vs $3.6M) divergence.

   Permanent contract asserted here (numeric, end-to-end — not code-shape):
     1. annualValue / implCost model math is identical between the two files.
     2. Summary.monteCarloROI and Panel.liveROI, given the SAME basis, return the
        SAME P10/P50/P90 triple (same seed + same math).
     3. NEW-CASE scenario: when the Summary persisted a value/cost basis, the Brief
        adopts that basis so briefP50 === summaryP50 even if the Brief's loaded
        feas would otherwise recompute a different (lower) benefit.
     4. NEVER-EVALUATED scenario: with no persisted basis, both recompute from the
        same feas and still agree.
*/
const fs = require('fs'), path = require('path');
function read(f){ return fs.readFileSync(path.join(__dirname, f), 'utf8'); }
function extractFn(src, n){
  const s = src.indexOf('function ' + n);
  if (s < 0) throw new Error(n + ' not found');
  let i = src.indexOf('{', s), d = 0;
  for (; i < src.length; i++){ if (src[i] === '{') d++; else if (src[i] === '}'){ d--; if (d === 0) return src.slice(s, i + 1); } }
  throw new Error('unbalanced ' + n);
}
function extractVar(src, name){
  const m = new RegExp('var\\s+' + name + '\\s*=').exec(src);
  if (!m) return '';
  let i = src.indexOf('=', m.index), j = i + 1;
  while (/\s/.test(src[j])) j++;
  if (src[j] === '{'){ let d = 0; for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (d === 0){ j++; break; } } } while (src[j] && src[j] !== ';') j++; return src.slice(m.index, j + 1); }
  while (src[j] && src[j] !== ';') j++;
  return src.slice(m.index, j + 1);
}

const S = read('summary.html'), P = read('panel.html');
const consts = ['VALUE_MID', 'TIER_COST'].map(n => extractVar(S, n)).join('\n');
const clampDef = 'function clamp(v,a,b){return Math.max(a,Math.min(b,v));}';

// --- shared RNG/seed helpers (identical in both files) ---
const rngHelpers = [
  extractFn(S, 'mulberry32') || '',
  extractFn(S, 'hashSeed') || '',
  extractFn(S, 'gauss') || ''
].join('\n');

// summary.monteCarloROI expects mulberry32/hashSeed/gauss + annualValue/implCost
const summary = new Function(
  'localStorage',
  clampDef + '\n' + consts + '\n' + rngHelpers + '\n' +
  extractFn(S, 'annualValue') + '\n' + extractFn(S, 'implCost') + '\n' +
  extractFn(S, 'monteCarloROI') + '\n' +
  'return { annualValue, implCost, monteCarloROI };'
)({ getItem: () => 'UC-NEW-001' });

// panel.liveROI expects _mulberry32/_hashSeed/_gauss + annualValueOf/implCostOf
const panelHelpers = [
  extractFn(P, '_mulberry32'), extractFn(P, '_hashSeed'), extractFn(P, '_gauss')
].join('\n');
const panel = new Function(
  'localStorage',
  clampDef + '\n' + consts + '\n' + panelHelpers + '\n' +
  extractFn(P, 'annualValueOf') + '\n' + extractFn(P, 'implCostOf') + '\n' +
  extractFn(P, 'liveROI') + '\n' +
  'return { annualValueOf, implCostOf, liveROI };'
)({ getItem: () => 'UC-NEW-001' });

let pass = 0, fail = 0;
function ok(n, c){ if (c){ pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n); } }

// ---- 1. model math identical ----
const intake = { name: 'ZZ-QA-DELETE-ME R10', value: '$1M–$5M', users: '200–1000' };
const feasHi = { composite: 3.7, scores: { biz_value: 4 } };   // what Summary used
const feasLo = { composite: 3.7, scores: { biz_value: 3 } };   // what Brief loaded (default)
const advisory = { tier: 'Build' };

ok('annualValue math identical (biz_value=4)  [' +
   Math.round(summary.annualValue(intake, feasHi)) + ' == ' + Math.round(panel.annualValueOf(intake, feasHi)) + ']',
   summary.annualValue(intake, feasHi) === panel.annualValueOf(intake, feasHi));
ok('implCost math identical  [' + summary.implCost(advisory) + ' == ' + panel.implCostOf(advisory) + ']',
   summary.implCost(advisory) === panel.implCostOf(advisory));

// ---- 2. same basis => identical Monte Carlo triple ----
const sSame = summary.monteCarloROI(intake, feasHi, advisory, 10000);
const pSame = panel.liveROI(intake, feasHi, advisory, null);   // no persisted basis, same feas
ok('Same inputs => identical P50  [S ' + sSame.p50 + ' == B ' + pSame.p50 + ']', sSame.p50 === pSame.p50);
ok('Same inputs => identical P10/P90  [' + sSame.p10 + '/' + sSame.p90 + ' == ' + pSame.p10 + '/' + pSame.p90 + ']',
   sSame.p10 === pSame.p10 && sSame.p90 === pSame.p90);

// ---- 3. NEW-CASE: Summary used biz_value=4 ($4.2M-ish); Brief loaded biz_value=3.
//         Without the basis fix the Brief would understate (~14% low). With the fix
//         the Brief adopts the Summary's persisted value/cost basis and matches. ----
const heroSummary = summary.monteCarloROI(intake, feasHi, advisory, 10000); // Summary hero (bv=4)
const persistedBasis = { value: heroSummary.value, cost: heroSummary.cost, p50: null };
const briefFixed = panel.liveROI(intake, feasLo, advisory, persistedBasis);  // Brief loads bv=3 BUT gets basis
ok('NEW-CASE basis carried: Brief value == Summary value  [' +
   Math.round(briefFixed.value) + ' == ' + Math.round(heroSummary.value) + ']',
   Math.round(briefFixed.value) === Math.round(heroSummary.value));
ok('NEW-CASE parity: briefP50 === summaryP50  [B ' + briefFixed.p50 + ' == S ' + heroSummary.p50 + ']',
   briefFixed.p50 === heroSummary.p50);

// prove the bug WOULD exist without the basis (regression guard): recompute w/ bv=3, no basis
const briefBroken = panel.liveROI(intake, feasLo, advisory, null);
ok('Regression guard: fresh-recompute w/o basis DOES differ (proves fix is load-bearing)  [' +
   briefBroken.p50 + ' != ' + heroSummary.p50 + ']',
   briefBroken.p50 !== heroSummary.p50);
ok('Regression guard: the divergence is ~14% on value (1.2/1.4)  [' +
   Math.round(briefBroken.value) + ' vs ' + Math.round(heroSummary.value) + ']',
   Math.abs((briefBroken.value / heroSummary.value) - (1.2 / 1.4)) < 0.001);

// ---- 4. NEVER-EVALUATED: no basis, same feas => agree ----
const sNever = summary.monteCarloROI(intake, feasLo, advisory, 10000);
const bNever = panel.liveROI(intake, feasLo, advisory, null);
ok('NEVER-EVALUATED parity (same feas, no basis): briefP50 === summaryP50  [' +
   bNever.p50 + ' == ' + sNever.p50 + ']', bNever.p50 === sNever.p50);

// ---- 5. buildBrief wires the persisted basis through to liveROI ----
const bb = extractFn(P, 'buildBrief');
ok('buildBrief passes persisted roi basis into liveROI (4th arg)', /liveROI\(intake,\s*liveFeas,\s*liveAdv,\s*roi\)/.test(bb));
ok('buildBrief still uses persisted summary.roi triple verbatim when present', /roi\.p50\s*==\s*null/.test(bb));

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
