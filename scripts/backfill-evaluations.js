#!/usr/bin/env node
/* ==========================================================================
 * backfill-evaluations.js  --  Populate feasibility_scores + evaluation_summaries
 * + panel_verdicts for use cases that have intake context but no committed
 * evaluation. Replicates the app's OWN deterministic derivation (feasibility
 * seedScores/composite/quadrant/riskTier/citizenDev, advisory resolveTier,
 * governance readiness, Monte Carlo ROI) so persisted numbers match what the
 * pages would compute.
 *
 * DRY RUN by default. Pass --apply to write (single transaction, rolls back on
 * error). Idempotent: skips cases that already have all three rows unless --force.
 *
 * USAGE (from repo root):
 *   node scripts/backfill-evaluations.js "postgres://user:PASS@host:port/db" --workspace <uuid>
 *   node scripts/backfill-evaluations.js "postgres://..." --workspace <uuid> --apply
 *
 * FLAGS:
 *   --workspace <uuid>   REQUIRED. Only touch this workspace.
 *   --apply              Write. Otherwise dry-run.
 *   --only-advanced      Only cases with stage in (bxt,feasibility,advisory,summary,panel)
 *                        i.e. leave stage='intake' cases untouched.
 *   --force              Re-derive even if evaluation rows already exist (upsert).
 * ========================================================================== */
'use strict';
const { Client } = require('pg');

function flag(n){ const i = process.argv.indexOf(n); return i >= 0 ? (process.argv[i+1]||'') : undefined; }
const has = n => process.argv.includes(n);
const CONN = (process.argv[2] && /^postgres/i.test(process.argv[2])) ? process.argv[2] : process.env.DATABASE_URL;
const WS = flag('--workspace');
const APPLY = has('--apply');
const ONLY_ADV = has('--only-advanced');
const FORCE = has('--force');
// Per user decision (Option 1): advance every case below 'summary' up to 'summary'
// so ROI/quadrant tiles surface (server gates ROI at stage>=summary). Cases already
// at panel/approved keep their higher stage. Pass --no-advance to disable.
const ADVANCE = !has('--no-advance');
const STAGE_ORDER = ['intake','bxt','feasibility','advisory','summary','panel','approved'];
const rankOf = s => { const i = STAGE_ORDER.indexOf(String(s||'').trim().toLowerCase()); return i<0?0:i; };
const SUMMARY_RANK = STAGE_ORDER.indexOf('summary');

if (!CONN) { console.error('ERROR: no connection string (arg 1 or DATABASE_URL).'); process.exit(1); }
if (!WS)   { console.error('ERROR: --workspace <uuid> is required.'); process.exit(1); }

/* ---------- helpers (verbatim from the app) ---------- */
const clamp = (n,lo,hi) => Math.max(lo, Math.min(hi, n));
const round1 = n => Math.round(n*10)/10;
function bandTo5(map, v, def){ return (v != null && map[v] !== undefined) ? map[v] : def; }
function hashSeed(str){ let h = 2166136261>>>0; for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h,16777619);} return h>>>0; }
function mulberry32(a){ return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
function gauss(rng){ let u=0,v=0; while(u===0)u=rng(); while(v===0)v=rng(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

/* ---------- normalize stored JSONB into a flat "intake" object ---------- */
// Booleans arrive as strings ("TRUE"/"Yes"/"No"); the derivation checks === true.
function toBool(v){ if (v === true) return true; const s = String(v==null?'':v).trim().toLowerCase(); return s==='true'||s==='yes'||s==='y'||s==='1'; }
function toArr(v){ if (Array.isArray(v)) return v; if (v==null||v==='') return []; return String(v).split(/[;,|]/).map(s=>s.trim()).filter(Boolean); }
function obj(x){ if (x==null) return {}; if (typeof x==='string'){ try{return JSON.parse(x);}catch{return {};} } return x; }

function flatIntake(row){
  const bc = obj(row.business_context), cs = obj(row.current_state),
        tc = obj(row.technical_context), rc = obj(row.risk_compliance);
  return {
    value: bc.value, users: bc.users, align: bc.align, driver: bc.driver,
    maturity: cs.maturity,
    sources: toArr(tc.sources), integrations: toArr(tc.integrations),
    dataavail: tc.dataavail, realtime: toBool(tc.realtime),
    sensitivity: rc.sensitivity, autonomy: rc.autonomy,
    pii: toBool(rc.pii), audit: toBool(rc.audit),
    adoption: rc.adoption, change: toBool(rc.change),
  };
}

/* ---------- feasibility (from feasibility.html) ---------- */
const CRITERIA = [
  { id:'biz_value',   pillar:'strategic', weight:22 }, { id:'strat_align', pillar:'strategic', weight:8 },
  { id:'data_value',  pillar:'strategic', weight:5 },  { id:'data_avail',  pillar:'technical', weight:12 },
  { id:'tech_complex',pillar:'technical', weight:10 }, { id:'integ_effort',pillar:'technical', weight:8 },
  { id:'ttv',         pillar:'technical', weight:5 },  { id:'safety',      pillar:'org',       weight:15 },
  { id:'compliance',  pillar:'org',       weight:12 }, { id:'user_value',  pillar:'org',       weight:3 },
];
const critById = id => CRITERIA.find(c=>c.id===id);
function seedScores(intake){
  intake = intake || {}; const s = {};
  s.biz_value = bandTo5({ '<$100K':2,'$100K–$500K':3,'$500K–$1M':3,'$1M–$5M':4,'>$5M':5 }, intake.value, 3);
  s.strat_align = bandTo5({ 'Core strategic priority':5,'Supporting initiative':3,'Experimental / exploratory':2 }, intake.align, 3);
  const srcs = Array.isArray(intake.sources)?intake.sources:[];
  s.data_value = srcs.indexOf('Structured DB')>-1 ? 4 : 3;
  s.data_avail = bandTo5({ 'Readily available & clean':5,'Available but needs cleaning':4,'Partially available':3,'Not yet available':2 }, intake.dataavail, 3);
  const complexSrc = srcs.filter(x=>['Audio/Video','Images','Chat/Tickets','Web'].indexOf(x)>-1).length;
  const complexBase = bandTo5({ 'Fully manual':3,'Partially automated':3,'Mostly automated':4,'Highly automated':4 }, intake.maturity, 3);
  s.tech_complex = clamp(complexBase - (complexSrc>=2?1:0) - (intake.realtime===true?1:0), 1, 5);
  const ints = Array.isArray(intake.integrations)?intake.integrations:[];
  const gNative = ints.filter(x=>['Google Workspace','BigQuery','Cloud Storage','Vertex AI'].indexOf(x)>-1).length;
  const hard = ints.filter(x=>['On-prem system','Third-party SaaS'].indexOf(x)>-1).length;
  s.integ_effort = clamp(3 + (gNative>=1?1:0) + (gNative>=2?1:0) - hard, 1, 5);
  s.ttv = clamp(Math.round((s.data_avail + s.tech_complex)/2), 1, 5);
  const sensPenalty = bandTo5({ 'Low':0,'Medium':-1,'High':-2 }, intake.sensitivity, -1);
  const autoPenalty = bandTo5({ 'Advisory':0,'Supervised':0,'Autonomous':-1 }, intake.autonomy, 0);
  s.safety = clamp(4 + sensPenalty + autoPenalty + (intake.audit===true?1:0), 1, 5);
  s.compliance = clamp(4 + (intake.audit===true?1:0) - (intake.pii===true?1:0) + sensPenalty, 1, 5);
  const adopt = bandTo5({ 'Low':2,'Medium':3,'High':5 }, intake.adoption, 3);
  s.user_value = clamp(adopt + (intake.change===true?1:0) - (intake.change===true?0:1), 1, 5);
  CRITERIA.forEach(c=>{ if (s[c.id]==null) s[c.id]=3; });
  return s;
}
function composite(scores){ let t=0; CRITERIA.forEach(c=>{ let v=Number(scores[c.id]); if(isNaN(v))v=3; t+=(c.weight/100)*v; }); return t; }
function pillarScore(scores, pillar){ let sum=0,w=0; CRITERIA.filter(c=>c.pillar===pillar).forEach(c=>{ let v=Number(scores[c.id]); if(isNaN(v))v=3; sum+=c.weight*v; w+=c.weight; }); return w?sum/w:0; }
function quadrantName(value, feas){ const hV=value>=3, hF=feas>=3; return hV&&hF?'Quick Win':hV&&!hF?'Strategic Bet':!hV&&hF?'Fill-In':'Money Pit'; }
function riskTier(scores){ let s=Number(scores.safety),c=Number(scores.compliance); if(isNaN(s))s=3; if(isNaN(c))c=3; const sw=critById('safety').weight, cw=critById('compliance').weight; const avg=(s*sw+c*cw)/(sw+cw); return avg>=4?'Low':avg>=2.5?'Medium':'High'; }
function citizenDevPct(scores){ let t=Number(scores.tech_complex),i=Number(scores.integ_effort),c=Number(scores.compliance); if(isNaN(t))t=3;if(isNaN(i))i=3;if(isNaN(c))c=3; const mean=(t+i+c)/3; return Math.round(clamp((mean-1)/4*100,0,100)); }

/* ---------- advisory tier (from advisory.html) ---------- */
function resolveTier(scores, intake){
  const sc = scores; const s=(id,def)=>{ const v=Number(sc[id]); return isNaN(v)?def:v; };
  const band=(map,v,def)=>(v!=null&&map[v]!==undefined)?map[v]:def;
  const sources = Array.isArray(intake.sources)?intake.sources:[];
  const unstructured = sources.filter(x=>['Documents/PDFs','Audio/Video','Images','Chat/Tickets','Web'].indexOf(x)>-1).length;
  const maturityBoost = band({ 'Fully manual':-1,'Partially automated':0,'Mostly automated':1,'Highly automated':1 }, intake.maturity, 0);
  const wc = clamp(Math.round((s('integ_effort',3)+s('tech_complex',3))/2)+maturityBoost-(unstructured>=2?1:0),1,5);
  const autonomyBoost = band({ 'Advisory':0,'Supervised':1,'Autonomous':2 }, intake.autonomy, 1);
  const ac = clamp(1 + unstructured + (intake.realtime===true?1:0) + (autonomyBoost>=2?1:0), 1, 5);
  const cw = clamp(3 + (maturityBoost<0?1:0) + (sources.length>=3?1:0) - (s('integ_effort',3)>=5?1:0), 1, 5);
  if (wc>=4 && cw<=2 && ac<=2) return 'Adopt';
  if (ac>=4) return 'Build';
  return 'Extend';
}

/* ---------- governance readiness (from summary.html) ---------- */
function readinessOf(intake, scores, riskTierStr){
  const s = scores; let pass=0,warn=0,fail=0;
  const add = st => { if(st==='pass')pass++; else if(st==='warn')warn++; else fail++; };
  add(intake.pii ? (intake.audit?'warn':'fail') : 'pass');           // 1 PII
  add(intake.audit ? 'pass' : 'warn');                               // 2 audit
  const safety=Number(s.safety)||3; add(safety>=4?'pass':safety>=3?'warn':'fail'); // 3 safety
  const compliance=Number(s.compliance)||3; add(compliance>=4?'pass':compliance>=3?'warn':'fail'); // 4 compliance (advOk defaults true)
  const autonomy = intake.autonomy||'Supervised'; add(autonomy==='Autonomous'?'warn':'pass'); // 5 autonomy
  add(riskTierStr==='Low'?'pass':riskTierStr==='Medium'?'warn':'fail'); // 6 risk tier
  return fail>0?'BLOCKED':warn>0?'CONDITIONAL':'READY';
}

/* ---------- ROI Monte Carlo (from summary.html) ---------- */
const VALUE_MID = { '<$100K':60000,'$100K–$500K':300000,'$500K–$1M':750000,'$1M–$5M':3000000,'>$5M':8000000 };
const TIER_COST = { Adopt:120000, Extend:380000, Build:950000 };
function annualValue(intake, scores){ const base=VALUE_MID[intake&&intake.value]||750000; const bv=Number(scores.biz_value)||3; return base*(0.6+0.2*clamp(bv,1,5)); }
function implCost(tier){ return TIER_COST[tier]||380000; }
function monteCarloRoi(caseId, value, cost){
  const rng = mulberry32(hashSeed(String(caseId)));
  const N = 2000; const rois = [];
  for (let i=0;i<N;i++){
    const v = value * (1 + 0.25*gauss(rng));     // ±25% benefit variance
    const c = cost   * (1 + 0.20*gauss(rng));     // ±20% cost variance
    const roi = ((v - c) / c) * 100;
    rois.push(roi);
  }
  rois.sort((a,b)=>a-b);
  const pctile = p => rois[clamp(Math.floor(p/100*N),0,N-1)];
  return { p10: Math.round(pctile(10)), p50: Math.round(pctile(50)), p90: Math.round(pctile(90)) };
}

// CAF framework rollup (Learn/Lead/Scale/Secure) + BXT + advisory tier for the frameworks blob.
function pct5(v){ return Math.round(clamp((Number(v)||3)/5*100,0,100)); }
function buildFrameworks(scores, tier, comp){
  const strat = pillarScore(scores,'strategic'), tech = pillarScore(scores,'technical'), org = pillarScore(scores,'org');
  return {
    caf: { learn: pct5(scores.user_value||3), lead: pct5(strat), scale: pct5(tech), secure: pct5(org) },
    bxt: { business: pct5(strat), experience: pct5(scores.user_value||3), technology: pct5(tech) },
    advisoryTier: tier,
    composite: comp,
  };
}
function buildGovernance(intake, scores, rtier, readiness){
  const items = [];
  const st = (label, status) => items.push({ label, status });
  st('PII handling', intake.pii ? (intake.audit?'warn':'fail') : 'pass');
  st('Audit trail', intake.audit ? 'pass' : 'warn');
  const safety=Number(scores.safety)||3; st('Safety controls', safety>=4?'pass':safety>=3?'warn':'fail');
  const compliance=Number(scores.compliance)||3; st('Compliance', compliance>=4?'pass':compliance>=3?'warn':'fail');
  st('Autonomy level', (intake.autonomy||'Supervised')==='Autonomous'?'warn':'pass');
  st('Risk tier', rtier==='Low'?'pass':rtier==='Medium'?'warn':'fail');
  return { readiness, items };
}

function deriveVerdict(readiness){
  const r = String(readiness||'').toUpperCase();
  if (r==='READY')   return { verdict:'GO', binding_condition:null };
  if (r==='BLOCKED') return { verdict:'NO-GO', binding_condition:'Deferred pending remediation of failed governance gates.' };
  return { verdict:'CONDITIONAL GO', binding_condition:'Approved with binding condition — resolve flagged governance warnings before launch.' };
}

/* ---------- main ---------- */
const ADV_STAGES = new Set(['bxt','feasibility','advisory','summary','panel']);

(async () => {
  const c = new Client({ connectionString: CONN });
  await c.connect();

  const rows = (await c.query(`
    SELECT uc.id, uc.name, uc.stage,
           uc.business_context, uc.current_state, uc.technical_context, uc.risk_compliance,
           (pv.use_case_id IS NOT NULL) AS has_verdict,
           (es.use_case_id IS NOT NULL) AS has_summary,
           (fs.use_case_id IS NOT NULL) AS has_feas
    FROM use_cases uc
    LEFT JOIN panel_verdicts pv ON pv.use_case_id=uc.id
    LEFT JOIN evaluation_summaries es ON es.use_case_id=uc.id
    LEFT JOIN feasibility_scores fs ON fs.use_case_id=uc.id
    WHERE uc.workspace_id=$1
    ORDER BY uc.name`, [WS])).rows;

  const plan = [];
  const skip = { alreadyDone:0, intakeOnly:0 };
  for (const r of rows) {
    if (ONLY_ADV && !ADV_STAGES.has(String(r.stage))) { skip.intakeOnly++; continue; }
    if (!FORCE && r.has_verdict && r.has_summary && r.has_feas) { skip.alreadyDone++; continue; }

    const intake = flatIntake(r);
    const scores = seedScores(intake);
    const comp = round1(composite(scores));
    const strat = pillarScore(scores,'strategic'), tech = pillarScore(scores,'technical');
    const quad = quadrantName(strat, tech);
    const rtier = riskTier(scores);
    const cdev = citizenDevPct(scores);
    const tier = resolveTier(scores, intake);
    const readiness = readinessOf(intake, scores, rtier);
    const value = annualValue(intake, scores);
    const cost = implCost(tier);
    const roi = monteCarloRoi(r.id, value, cost);
    const { verdict, binding_condition } = deriveVerdict(readiness);

    // Stage advancement (Option 1): bump anything below 'summary' up to 'summary'
    // so the server ROI gate (stage>=summary) surfaces the ROI/quadrant tiles.
    const curRank = rankOf(r.stage);
    const newStage = (ADVANCE && curRank < SUMMARY_RANK) ? 'summary' : null;

    plan.push({ id:r.id, name:r.name, comp, quad, rtier, cdev, scores,
                pillars:{ strategic:round1(strat), technical:round1(tech), org:round1(pillarScore(scores,'org')) },
                tier, readiness, value:Math.round(value), cost, roi, verdict, binding_condition,
                frameworks: buildFrameworks(scores, tier, comp),
                governance: buildGovernance(intake, scores, rtier, readiness),
                curStage:r.stage, newStage });
  }

  console.log('============================================================');
  console.log(' BACKFILL EVALUATIONS —', APPLY ? 'APPLY MODE (writes in a transaction)' : 'DRY RUN (no writes)');
  console.log('============================================================');
  console.log('Workspace          :', WS);
  console.log('Use cases in WS    :', rows.length);
  console.log('Skipped (done)     :', skip.alreadyDone);
  if (ONLY_ADV) console.log('Skipped (intake)   :', skip.intakeOnly);
  console.log('WILL BACKFILL      :', plan.length, 'cases');
  const advCount = plan.filter(p=>p.newStage).length;
  console.log('Stage -> summary   :', ADVANCE ? `${advCount} cases advanced (rest already >= summary)` : 'DISABLED (--no-advance)');
  const vmix = plan.reduce((m,p)=>{ m[p.verdict]=(m[p.verdict]||0)+1; return m; },{});
  console.log('Verdict mix        :', JSON.stringify(vmix));
  console.log('------------------------------------------------------------');
  plan.slice(0,3).forEach((p,i)=>{
    console.log(`Sample [${i+1}] ${String(p.name).slice(0,54)}`);
    console.log(`   composite=${p.comp}/5  quadrant=${p.quad}  risk=${p.rtier}  tier=${p.tier}`);
    console.log(`   readiness=${p.readiness} -> verdict=${p.verdict}`);
    console.log(`   ROI P10/P50/P90 = +${p.roi.p10}% / +${p.roi.p50}% / +${p.roi.p90}%   value=$${p.value} cost=$${p.cost}`);
  });
  console.log('------------------------------------------------------------');

  if (!APPLY) { console.log('DRY RUN complete — nothing changed. Re-run with --apply to execute.'); await c.end(); return; }

  await c.query('BEGIN');
  try {
    let n=0;
    for (const p of plan) {
      await c.query(
        `INSERT INTO feasibility_scores (use_case_id, composite, quadrant, risk_tier, citizen_dev_pct, criteria, pillars)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (use_case_id) DO UPDATE SET composite=EXCLUDED.composite, quadrant=EXCLUDED.quadrant,
           risk_tier=EXCLUDED.risk_tier, citizen_dev_pct=EXCLUDED.citizen_dev_pct, criteria=EXCLUDED.criteria, pillars=EXCLUDED.pillars`,
        [p.id, p.comp, p.quad, p.rtier, p.cdev, JSON.stringify(p.scores), JSON.stringify(p.pillars)]);
      await c.query(
        `INSERT INTO evaluation_summaries (use_case_id, roi_p10, roi_p50, roi_p90, frameworks, governance, readiness)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (use_case_id) DO UPDATE SET roi_p10=EXCLUDED.roi_p10, roi_p50=EXCLUDED.roi_p50,
           roi_p90=EXCLUDED.roi_p90, frameworks=EXCLUDED.frameworks, governance=EXCLUDED.governance, readiness=EXCLUDED.readiness`,
        [p.id, p.roi.p10, p.roi.p50, p.roi.p90, JSON.stringify(p.frameworks), JSON.stringify(p.governance), p.readiness]);
      await c.query(
        `INSERT INTO panel_verdicts (use_case_id, verdict, binding_condition)
         VALUES ($1,$2,$3)
         ON CONFLICT (use_case_id) DO UPDATE SET verdict=EXCLUDED.verdict, binding_condition=EXCLUDED.binding_condition`,
        [p.id, p.verdict, p.binding_condition]);
      if (p.newStage) {
        await c.query(`UPDATE use_cases SET stage=$2 WHERE id=$1`, [p.id, p.newStage]);
      }
      n++;
    }
    await c.query('COMMIT');
    console.log(`APPLIED: backfilled ${n} cases (feasibility + summary + verdict). Committed.`);
    const verify = (await c.query(
      `SELECT COUNT(pv.use_case_id) AS verdicts, COUNT(es.use_case_id) AS summaries
       FROM use_cases uc
       LEFT JOIN panel_verdicts pv ON pv.use_case_id=uc.id
       LEFT JOIN evaluation_summaries es ON es.use_case_id=uc.id
       WHERE uc.workspace_id=$1`, [WS])).rows[0];
    console.log(`Post-verify        : ${verify.verdicts} verdicts | ${verify.summaries} summaries now in workspace`);
  } catch(e) {
    await c.query('ROLLBACK');
    console.error('ERROR — ROLLED BACK, no changes made:', e.message);
    process.exitCode = 1;
  }
  await c.end();
})().catch(e => { console.error('BACKFILL FAILED:', e.message); process.exit(1); });
