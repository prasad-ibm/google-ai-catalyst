/**
 * Seed a LARGE demo portfolio to show off the v2 "Scale" release:
 *   - shared filter bar + facet counts (many departments / sponsors / stages)
 *   - server-side pagination + lazy rendering (300 rows)
 *   - Compare presets (Top ROI / GO-only / by-dept)
 *   - the "2026 Delivered" storyline (a slice with status='completed')
 *
 * Creates a dedicated workspace ("Intel - Portfolio Demo") and N fully-evaluated
 * use cases across all 5 gate tables so every view renders end-to-end.
 *
 * Deterministic (seeded RNG) so re-runs produce the same portfolio. Idempotent:
 * it DELETEs and recreates its own workspace each run, so it never duplicates.
 * It does NOT touch any other workspace (e.g. the real "Intel" 5-case seed).
 *
 *   node scripts/seed-demo-300.js            # 300 rows (default)
 *   COUNT=150 node scripts/seed-demo-300.js  # custom size
 *   WS_NAME="Client Demo" node scripts/seed-demo-300.js
 */
'use strict';
const { pool, query } = require('../db');

const COUNT   = Math.max(1, parseInt(process.env.COUNT || '300', 10));
const WS_NAME = process.env.WS_NAME || 'Intel - Portfolio Demo';

// ---- deterministic RNG (mulberry32) so the demo is stable across runs -------
function rng(seed) { return function () {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}; }
const rnd = rng(1337);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => Math.round(lo + rnd() * (hi - lo));

// ---- canonical dimension values (match the v2 normalized taxonomy) ----------
const DEPARTMENTS = [
  ['Human Resources', 'CHRO'],
  ['Finance', 'CFO'],
  ['Procurement', 'CPO'],
  ['Supply Chain', 'COO'],
  ['Data Center Group', 'ET-DCG'],       // normalized (was Operations / COO)
  ['Manufacturing', 'EVP Manufacturing'],
  ['Quality', 'EVP Manufacturing'],
  ['Sales', 'CRO'],
  ['Marketing', 'CMO'],
  ['Legal', 'General Counsel'],
  ['IT', 'CIO'],
  ['Customer Support', 'CCO'],
  ['R&D', 'CTO'],
  ['Security', 'CISO'],
];
const STAGES = ['bxt', 'feasibility', 'advisory', 'summary', 'panel'];
const VERDICTS = ['GO', 'GO', 'GO', 'CONDITIONAL', 'CONDITIONAL', 'NO-GO']; // weighted
const TIERS = ['Adopt', 'Extend', 'Scale'];
const NOUNS = ['Assistant', 'Copilot', 'Agent', 'Optimizer', 'Analyzer', 'Advisor',
  'Forecaster', 'Classifier', 'Summarizer', 'Router', 'Planner', 'Auditor', 'Predictor', 'Recommender'];
const THEMES = ['Invoice', 'Contract', 'Onboarding', 'Ticket', 'Inventory', 'Demand', 'Yield',
  'Defect', 'Capacity', 'Knowledge', 'Compliance', 'Sourcing', 'Scheduling', 'Support', 'Reporting',
  'Fraud', 'Renewal', 'Escalation', 'Provisioning', 'Triage'];

function makeUseCase(i) {
  const [department, sponsor] = pick(DEPARTMENTS);
  const stage = pick(STAGES);
  const verdict = pick(VERDICTS);
  const name = `${pick(THEMES)} ${pick(NOUNS)} ${String(i + 1).padStart(3, '0')}`;
  const p50 = between(40, 520);                      // ROI P50 %
  const p10 = Math.max(5, Math.round(p50 * (0.45 + rnd() * 0.2)));
  const p90 = Math.round(p50 * (1.5 + rnd() * 0.8));
  const composite = +(2.4 + rnd() * 2.4).toFixed(1); // 2.4 - 4.8
  const biz = between(3, 5);
  const value_usd = between(1, 60) * 1_000_000;

  // "2026 Delivered" storyline: ~18% of GO cases are already completed this year.
  let status = 'active', delivered_at = null;
  if (verdict === 'GO' && rnd() < 0.22) {
    status = 'completed';
    const mm = String(between(1, 7)).padStart(2, '0');
    const dd = String(between(1, 28)).padStart(2, '0');
    delivered_at = `2026-${mm}-${dd}`;
  }

  return {
    name, department, executive_sponsor: sponsor, stage, status, delivered_at,
    submitted_by: `${department} Team`,
    contact_email: `${department.toLowerCase().replace(/[^a-z]+/g, '.')}@intel.com`,
    description: `${name}: AI use case in ${department} targeting measurable ROI and adoption.`,
    business_context: { driver: 'Efficiency + cost-to-serve', expected_value: `${p50}% ROI (P50)`, users_affected: `${between(200, 100000)} users`, value_usd },
    current_state: { process: 'Manual / semi-automated', effort: pick(['High', 'Medium', 'Low']) },
    technical_context: { platform: pick(['Gemini for Workspace', 'Agentspace', 'Vertex AI Agent Builder', 'AppSheet']), complexity: pick(['Low', 'Medium', 'High']) },
    risk_compliance: { data_sensitivity: pick(['Low', 'Medium', 'High']), pii: rnd() < 0.5, autonomy: pick(['Advisory', 'Assisted', 'Autonomous']) },
    bxt: { business_score: between(60, 96), experience_score: between(60, 95), technology_score: between(58, 94), verdict: verdict === 'NO-GO' ? 'FAIL' : 'PASS',
      detail: { business: ['ROI case'], experience: ['User demand'], technology: ['Platform fit'] } },
    feasibility: { composite, quadrant: composite >= 4 ? 'Quick Win' : composite >= 3 ? 'Strategic Bet' : 'Incremental', risk_tier: pick(['Low', 'Medium', 'High']), citizen_dev_pct: between(20, 90),
      criteria: { business_value: biz, strategic_alignment: between(3, 5), data_value: between(3, 5), data_availability: between(3, 5), technical_complexity: between(2, 5), integration_effort: between(2, 5), time_to_value: between(2, 5), safety: between(3, 5), compliance: between(3, 5), user_value: between(3, 5) },
      pillars: { strategic: +(3 + rnd() * 2).toFixed(1), technical: +(3 + rnd() * 2).toFixed(1), org: +(3 + rnd() * 2).toFixed(1) } },
    advisory: { tier: pick(TIERS), verdict_name: pick(['Start Simple', 'Build Custom', 'Scale Native']), recommended_platform: pick(['Gemini for Workspace', 'Agentspace', 'Vertex AI Agent Builder']), gate_resolved: 'gate1_adopt',
      reasoning: { workspace_coverage: pick(['High', 'Partial', 'None']), custom_workflow: pick(['Low', 'Medium', 'High']), ai_complexity: pick(['Low', 'Medium', 'High']) },
      journey: [{ phase: 'Adopt', platform: 'Gemini for Workspace', mandate: 'Deploy' }, { phase: 'Extend', platform: 'Agentspace', mandate: 'Add actions' }, { phase: 'Scale', platform: 'Vertex AI', mandate: 'If needed' }] },
    summary: { roi_p10: p10, roi_p50: p50, roi_p90: p90, readiness: pick(['Ready', 'Ready', 'Conditional']),
      frameworks: { gadf: between(70, 95), google_caf: between(70, 92), mckinsey_mit: between(72, 94), gartner: between(70, 90) },
      governance: [{ item: 'DLP / VPC-SC', status: 'PASS' }, { item: 'Cloud Audit Logs', status: 'PASS' }, { item: 'Responsible AI review', status: pick(['PASS', 'WARN']) }] },
    verdict: { verdict, binding_condition: verdict === 'CONDITIONAL' ? 'Pilot before GA.' : (verdict === 'NO-GO' ? 'Revisit next cycle.' : 'Proceed to build.'),
      stances: { business_sponsor: pick(['Strong Support', 'Support']), risk_assurance: pick(['Support', 'Neutral']), cio: pick(['Support', 'Neutral']), chair: verdict },
      deliberation: [{ turn: 1, persona: 'BS', text: 'ROI supports proceeding.' }, { turn: 2, persona: 'RA', text: 'Acceptable with conditions.' }] },
  };
}

// ---------------------------------------------------------------------------
//  INSERT PATH  (mirrors scripts/seed-intel.js, plus status/delivered_at)
// ---------------------------------------------------------------------------
async function recreateWorkspace() {
  // Idempotent: drop this demo workspace (cascades to its use_cases + gates) then recreate.
  await query(`DELETE FROM workspaces WHERE name = $1`, [WS_NAME]);
  const cols = ['name', 'industry', 'company_size', 'annual_revenue', 'cloud_provider', 'workspace_edition', 'ai_goal'];
  const vals = [WS_NAME, 'Semiconductors / Manufacturing', '100,000+', '$50B+', 'Google Cloud', 'Enterprise Plus',
    'Scale demo portfolio — ' + COUNT + ' evaluated AI use cases across the enterprise.'];
  const ph = vals.map((_, i) => '$' + (i + 1));
  const r = await query(`INSERT INTO workspaces (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING id`, vals);
  return r.rows[0].id;
}

async function insertUseCase(wsId, uc) {
  const r = await query(`INSERT INTO use_cases
    (workspace_id, name, department, executive_sponsor, submitted_by, contact_email, description,
     business_context, current_state, technical_context, risk_compliance, stage, status, delivered_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [wsId, uc.name, uc.department, uc.executive_sponsor, uc.submitted_by, uc.contact_email, uc.description,
      JSON.stringify(uc.business_context), JSON.stringify(uc.current_state),
      JSON.stringify(uc.technical_context), JSON.stringify(uc.risk_compliance),
      uc.stage, uc.status, uc.delivered_at]);
  return r.rows[0].id;
}

async function insertGates(ucId, uc) {
  const b = uc.bxt;
  await query(`INSERT INTO bxt_scores (use_case_id,business_score,experience_score,technology_score,verdict,detail)
    VALUES ($1,$2,$3,$4,$5,$6)`, [ucId, b.business_score, b.experience_score, b.technology_score, b.verdict, JSON.stringify(b.detail)]);
  const f = uc.feasibility;
  await query(`INSERT INTO feasibility_scores (use_case_id,composite,quadrant,risk_tier,citizen_dev_pct,criteria,pillars)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ucId, f.composite, f.quadrant, f.risk_tier, f.citizen_dev_pct, JSON.stringify(f.criteria), JSON.stringify(f.pillars)]);
  const a = uc.advisory;
  await query(`INSERT INTO advisory_results (use_case_id,tier,verdict_name,recommended_platform,gate_resolved,reasoning,journey)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ucId, a.tier, a.verdict_name, a.recommended_platform, a.gate_resolved, JSON.stringify(a.reasoning), JSON.stringify(a.journey)]);
  const s = uc.summary;
  await query(`INSERT INTO evaluation_summaries (use_case_id,roi_p10,roi_p50,roi_p90,frameworks,governance,readiness)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ucId, s.roi_p10, s.roi_p50, s.roi_p90, JSON.stringify(s.frameworks), JSON.stringify(s.governance), s.readiness]);
  const v = uc.verdict;
  await query(`INSERT INTO panel_verdicts (use_case_id,verdict,binding_condition,stances,deliberation)
    VALUES ($1,$2,$3,$4,$5)`, [ucId, v.verdict, v.binding_condition, JSON.stringify(v.stances), JSON.stringify(v.deliberation)]);
}

(async () => {
  try {
    console.log(`Seeding "${WS_NAME}" with ${COUNT} evaluated use cases...`);
    const wsId = await recreateWorkspace();
    console.log('  workspace id =', wsId);
    let delivered = 0, go = 0;
    for (let i = 0; i < COUNT; i++) {
      const uc = makeUseCase(i);
      if (uc.status === 'completed') delivered++;
      if (uc.verdict.verdict === 'GO') go++;
      const ucId = await insertUseCase(wsId, uc);
      await insertGates(ucId, uc);
      if ((i + 1) % 50 === 0) console.log(`  ...${i + 1}/${COUNT}`);
    }
    // Verification summary
    const counts = await query(`
      SELECT
        (SELECT count(*) FROM use_cases u JOIN workspaces w ON w.id=u.workspace_id WHERE w.name=$1) total,
        (SELECT count(*) FROM use_cases u JOIN workspaces w ON w.id=u.workspace_id WHERE w.name=$1 AND u.status='completed') completed,
        (SELECT count(DISTINCT u.department) FROM use_cases u JOIN workspaces w ON w.id=u.workspace_id WHERE w.name=$1) departments`,
      [WS_NAME]);
    console.log('\nVerification:', counts.rows[0]);
    console.log(`GO verdicts: ${go}, marked delivered (2026): ${delivered}`);
    console.log(`DONE — open the app, switch to workspace "${WS_NAME}".`);
  } catch (e) {
    console.error('SEED FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
