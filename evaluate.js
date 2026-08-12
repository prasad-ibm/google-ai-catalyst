'use strict';
/* ==========================================================================
 * evaluate.js  --  Shared deterministic evaluation derivation.
 *
 * Single source of truth for turning a use case's intake context into
 * feasibility scores, advisory tier, governance readiness, Monte Carlo ROI,
 * and a GO / CONDITIONAL GO / NO-GO verdict. Mirrors the client-side logic in
 * feasibility.html / advisory.html / summary.html so persisted numbers match
 * what those pages compute.
 *
 * Used by:
 *   - server.js  (auto-evaluate bulk-imported cases on insert)
 *   - scripts/backfill-evaluations.js (batch backfill of existing rows)
 *
 * Pure functions only — NO database access here. Callers persist the result.
 * ========================================================================== */

const clamp = (n,lo,hi) => Math.max(lo, Math.min(hi, n));
const round1 = n => Math.round(n*10)/10;
function bandTo5(map, v, def){ return (v != null && map[v] !== undefined) ? map[v] : def; }
function hashSeed(str){ let h = 2166136261>>>0; for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h,16777619);} return h>>>0; }
function mulberry32(a){ return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
function gauss(rng){ let u=0,v=0; while(u===0)u=rng(); while(v===0)v=rng(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

function toBool(v){ if (v === true) return true; const s = String(v==null?'':v).trim().toLowerCase(); return s==='true'||s==='yes'||s==='y'||s==='1'; }
function toArr(v){ if (Array.isArray(v)) return v; if (v==null||v==='') return []; return String(v).split(/[;,|]/).map(s=>s.trim()).filter(Boolean); }
function obj(x){ if (x==null) return {}; if (typeof x==='string'){ try{return JSON.parse(x);}catch{return {};} } return x; }

// Accepts either a DB row (with JSONB blob columns) OR a flat intake body.
function flatIntake(src){
  const bc = obj(src.business_context), cs = obj(src.current_state),
        tc = obj(src.technical_context), rc = obj(src.risk_compliance);
  const pick = (flat, blob) => (src[flat] !== undefined ? src[flat] : blob);
  return {
    value: pick('value', bc.value), users: pick('users', bc.users), align: pick('align', bc.align), driver: pick('driver', bc.driver),
    maturity: pick('maturity', cs.maturity),
    sources: toArr(pick('sources', tc.sources)), integrations: toArr(pick('integrations', tc.integrations)),
    dataavail: pick('dataavail', tc.dataavail), realtime: toBool(pick('realtime', tc.realtime)),
    sensitivity: pick('sensitivity', rc.sensitivity), autonomy: pick('autonomy', rc.autonomy),
    pii: toBool(pick('pii', rc.pii)), audit: toBool(pick('audit', rc.audit)),
    adoption: pick('adoption', rc.adoption), change: toBool(pick('change', rc.change)),
  };
}

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

function readinessOf(intake, scores, riskTierStr){
  let pass=0,warn=0,fail=0;
  const add = st => { if(st==='pass')pass++; else if(st==='warn')warn++; else fail++; };
  add(intake.pii ? (intake.audit?'warn':'fail') : 'pass');
  add(intake.audit ? 'pass' : 'warn');
  const safety=Number(scores.safety)||3; add(safety>=4?'pass':safety>=3?'warn':'fail');
  const compliance=Number(scores.compliance)||3; add(compliance>=4?'pass':compliance>=3?'warn':'fail');
  const autonomy = intake.autonomy||'Supervised'; add(autonomy==='Autonomous'?'warn':'pass');
  add(riskTierStr==='Low'?'pass':riskTierStr==='Medium'?'warn':'fail');
  return fail>0?'BLOCKED':warn>0?'CONDITIONAL':'READY';
}

const VALUE_MID = { '<$100K':60000,'$100K–$500K':300000,'$500K–$1M':750000,'$1M–$5M':3000000,'>$5M':8000000 };
const TIER_COST = { Adopt:120000, Extend:380000, Build:950000 };
function annualValue(intake, scores){ const base=VALUE_MID[intake&&intake.value]||750000; const bv=Number(scores.biz_value)||3; return base*(0.6+0.2*clamp(bv,1,5)); }
function implCost(tier){ return TIER_COST[tier]||380000; }
function monteCarloRoi(caseId, value, cost){
  const rng = mulberry32(hashSeed(String(caseId)));
  const N = 2000; const rois = [];
  for (let i=0;i<N;i++){
    const v = value * (1 + 0.25*gauss(rng));
    const c = cost   * (1 + 0.20*gauss(rng));
    rois.push(((v - c) / c) * 100);
  }
  rois.sort((a,b)=>a-b);
  const pctile = p => rois[clamp(Math.floor(p/100*N),0,N-1)];
  return { p10: Math.round(pctile(10)), p50: Math.round(pctile(50)), p90: Math.round(pctile(90)) };
}

function pct5(v){ return Math.round(clamp((Number(v)||3)/5*100,0,100)); }
function buildFrameworks(scores, tier, comp){
  const strat = pillarScore(scores,'strategic'), tech = pillarScore(scores,'technical'), org = pillarScore(scores,'org');
  return {
    caf: { learn: pct5(scores.user_value||3), lead: pct5(strat), scale: pct5(tech), secure: pct5(org) },
    bxt: { business: pct5(strat), experience: pct5(scores.user_value||3), technology: pct5(tech) },
    advisoryTier: tier, composite: comp,
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

/**
 * Derive the full evaluation for one case.
 * @param {string} caseId  the use_cases.id (seeds the deterministic ROI).
 * @param {object} src     DB row (with JSONB blobs) OR flat intake body.
 * @returns {object} { feasibility, summary, verdict } ready to persist.
 */
function deriveEvaluation(caseId, src){
  const intake = flatIntake(src || {});
  const scores = seedScores(intake);
  const comp = round1(composite(scores));
  const strat = pillarScore(scores,'strategic'), tech = pillarScore(scores,'technical');
  const quad = quadrantName(strat, tech);
  const rtier = riskTier(scores);
  const cdev = citizenDevPct(scores);
  const tier = resolveTier(scores, intake);
  const readiness = readinessOf(intake, scores, rtier);
  const value = Math.round(annualValue(intake, scores));
  const cost = implCost(tier);
  const roi = monteCarloRoi(caseId, value, cost);
  const { verdict, binding_condition } = deriveVerdict(readiness);
  return {
    feasibility: {
      composite: comp, quadrant: quad, risk_tier: rtier, citizen_dev_pct: cdev,
      criteria: scores,
      pillars: { strategic: round1(strat), technical: round1(tech), org: round1(pillarScore(scores,'org')) },
    },
    summary: {
      roi_p10: roi.p10, roi_p50: roi.p50, roi_p90: roi.p90,
      frameworks: buildFrameworks(scores, tier, comp),
      governance: buildGovernance(intake, scores, rtier, readiness),
      readiness,
    },
    verdict: { verdict, binding_condition },
    meta: { value, cost, tier },
  };
}

module.exports = { deriveEvaluation, flatIntake, seedScores };
