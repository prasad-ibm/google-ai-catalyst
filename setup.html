/**
 * Seed the "Intel" enterprise workspace + 5 top use cases, fully populated
 * across all 5 gate modules (BXT, Feasibility, Advisory, Summary, Verdict)
 * so every module in the app can be visualized end-to-end.
 *
 * Deterministic — safe to re-run (idempotent upserts on workspace name + gate FKs).
 * Business descriptions are faithful to the uploaded Top 5.xlsx; platform/technical
 * fields are mapped to Google Cloud (Vertex AI / Gemini / BigQuery / Agentspace / AppSheet).
 *
 *   node scripts/seed-intel.js
 */
const { pool, query } = require('../db');

const WS = {
  name: 'Intel',
  industry: 'Semiconductors / Manufacturing',
  company_size: '100,000+',
  annual_revenue: '$50B+',
  region: 'Global (Americas, EMEA, APAC)',
  data_residency: 'US + EU (Assured Workloads)',
  cloud_provider: 'Google Cloud',
  workspace_edition: 'Enterprise Plus',
  gemini_seats: 25000,
  monthly_gcp_consumption: '$2.5M-$5M',
  appsheet_plan: 'Enterprise Plus',
  vertex_approved: true,
  gartner_level: 4,
  ai_engineers: 320,
  mlops_maturity: 'Advanced (Vertex AI Pipelines, model registry, CI/CD)',
  citizen_dev_program: true,
  compliance_frameworks: ['SOC 2', 'ISO 27001', 'GDPR', 'ITAR', 'CCPA'],
  eu_ai_act_tier: 'Limited / High risk (mixed portfolio)',
  ai_priorities: 'Enterprise self-service, margin recovery, supply-chain resilience, asset uptime, yield/quality',
  ai_budget: '$40M-$60M FY26',
  delivery_model: 'Hybrid (COE-led build + citizen dev on AppSheet/Agentspace)',
  ai_goal: 'Deploy 25+ production AI agents across corporate functions and factories within 18 months, governed by the Google AI Decision Framework.',
};

// 5 use cases. Each carries: intake fields + all 5 gate payloads.
const USE_CASES = [
  {
    name: 'AskHR',
    department: 'HR',
    executive_sponsor: 'CHRO',
    submitted_by: 'HR Digital Team',
    contact_email: 'askhr@intel.com',
    description: 'Conversational AI self-service for HR queries — policies, benefits, leave, payroll — integrated with the HCM system. Reduces HR helpdesk volume 60–70%; employees get instant answers without raising a ticket.',
    business_context: { driver: 'Employee experience + cost-to-serve', expected_value: '60–70% helpdesk deflection', users_affected: '110,000 employees', value_usd: 8_500_000 },
    current_state: { process: 'Manual HR helpdesk + ticketing', monthly_tickets: 42000, current_spend_usd: 12_000_000, effort: 'High' },
    technical_context: { data_sources: 'HCM, policy docs, benefits KB', platform: 'Gemini for Google Workspace + Agentspace', integration: 'Native connectors', complexity: 'Low' },
    risk_compliance: { data_sensitivity: 'Medium', pii: true, autonomy: 'Advisory', audit_trail: true, adoption_readiness: 'High' },
    bxt: { business_score: 92, experience_score: 88, technology_score: 84, verdict: 'PASS',
      detail: { business: ['Clear ROI', 'Exec sponsor', 'High volume'], experience: ['Employees want self-service', 'Low friction'], technology: ['Off-the-shelf Gemini + Agentspace', 'Clean KB'] } },
    feasibility: { composite: 4.4, quadrant: 'Quick Win', risk_tier: 'Low', citizen_dev_pct: 82,
      criteria: { business_value: 5, strategic_alignment: 4, data_value: 4, data_availability: 5, technical_complexity: 5, integration_effort: 4, time_to_value: 5, safety: 4, compliance: 4, user_value: 5 },
      pillars: { strategic: 4.5, technical: 4.6, org: 4.1 } },
    advisory: { tier: 'Adopt', verdict_name: 'Start Simple', recommended_platform: 'Gemini for Google Workspace + Agentspace', gate_resolved: 'gate1_adopt',
      reasoning: { workspace_coverage: 'High — Gemini + Agentspace cover conversational self-service natively', custom_workflow: 'Low', ai_complexity: 'Low' },
      journey: [{ phase: 'Adopt', platform: 'Gemini for Workspace', mandate: 'Deploy now' }, { phase: 'Extend', platform: 'Agentspace', mandate: 'Add HCM actions' }, { phase: 'Scale', platform: 'Vertex AI Agent Builder', mandate: 'If custom logic grows' }] },
    summary: { roi_p10: 210, roi_p50: 480, roi_p90: 920, readiness: 'Ready',
      frameworks: { gadf: 88, google_caf: 84, mckinsey_mit: 90, gartner: 86 },
      governance: [{ item: 'DLP / VPC-SC', status: 'PASS' }, { item: 'Cloud Audit Logs', status: 'PASS' }, { item: 'Responsible AI review', status: 'PASS' }, { item: 'PII handling', status: 'WARN' }] },
    verdict: { verdict: 'GO', binding_condition: 'PII redaction layer verified before GA.',
      stances: { business_sponsor: 'Strong Support', risk_assurance: 'Support', cio: 'Support', chair: 'GO' },
      deliberation: [{ turn: 1, persona: 'BS', text: 'Highest-volume, lowest-risk win — greenlight.' }, { turn: 2, persona: 'RA', text: 'Acceptable with PII redaction verified.' }] },
  },
  {
    name: 'Contract Leakage',
    department: 'Procurement',
    executive_sponsor: 'CPO',
    submitted_by: 'Procurement Analytics',
    contact_email: 'procurement@intel.com',
    description: 'AI identifies where contracted terms — pricing, rebates, SLAs, payment terms — are not being enforced in actual POs and invoices. Recovers 2–5% of contract value that leaks silently through non-compliance.',
    business_context: { driver: 'Margin recovery', expected_value: '2–5% contract value recovered', users_affected: 'Procurement + AP', value_usd: 22_000_000 },
    current_state: { process: 'Manual spot-audit of contracts vs POs', current_spend_usd: 4_000_000, effort: 'Very High', coverage: '<5% of contracts' },
    technical_context: { data_sources: 'ERP POs/invoices, contract repository', platform: 'Vertex AI + BigQuery + Document AI', integration: 'Batch + API', complexity: 'Medium' },
    risk_compliance: { data_sensitivity: 'High', pii: false, autonomy: 'Supervised', audit_trail: true, adoption_readiness: 'Medium' },
    bxt: { business_score: 95, experience_score: 66, technology_score: 74, verdict: 'PASS',
      detail: { business: ['Direct $ recovery', 'CPO sponsor'], experience: ['Analyst workflow change needed'], technology: ['Document AI + BigQuery viable', 'Data across systems'] } },
    feasibility: { composite: 3.9, quadrant: 'Big Bet', risk_tier: 'Medium', citizen_dev_pct: 38,
      criteria: { business_value: 5, strategic_alignment: 5, data_value: 5, data_availability: 4, technical_complexity: 3, integration_effort: 3, time_to_value: 3, safety: 4, compliance: 4, user_value: 4 },
      pillars: { strategic: 4.7, technical: 3.3, org: 3.7 } },
    advisory: { tier: 'Extend', verdict_name: 'Scale Smart', recommended_platform: 'AppSheet / Agentspace + Vertex AI', gate_resolved: 'gate2_lowcode',
      reasoning: { workspace_coverage: 'Partial', custom_workflow: 'High — cross-system reconciliation logic', ai_complexity: 'Medium — Document AI extraction' },
      journey: [{ phase: 'Adopt', platform: 'Gemini for Workspace', mandate: 'Analyst assist' }, { phase: 'Extend', platform: 'AppSheet / Agentspace', mandate: 'Reconciliation app (current tier)' }, { phase: 'Scale', platform: 'Vertex AI Agent Builder', mandate: 'Autonomous recovery agent' }] },
    summary: { roi_p10: 340, roi_p50: 780, roi_p90: 1650, readiness: 'Conditional',
      frameworks: { gadf: 76, google_caf: 72, mckinsey_mit: 84, gartner: 80 },
      governance: [{ item: 'DLP / VPC-SC', status: 'PASS' }, { item: 'Cloud Audit Logs', status: 'PASS' }, { item: 'Financial controls (SOX)', status: 'WARN' }, { item: 'Human-in-the-loop approval', status: 'WARN' }] },
    verdict: { verdict: 'CONDITIONAL GO', binding_condition: 'All recovery actions require human approval; SOX control mapping signed off by Finance.',
      stances: { business_sponsor: 'Strong Support', risk_assurance: 'Conditional', cio: 'Conditional', chair: 'CONDITIONAL GO' },
      deliberation: [{ turn: 1, persona: 'BS', text: '$22M recoverable — pursue aggressively.' }, { turn: 2, persona: 'RA', text: 'Supervised only, SOX sign-off required.' }] },
  },
  {
    name: 'Demand Forecasting & Supply Chain Planning',
    department: 'Supply Chain',
    executive_sponsor: 'COO',
    submitted_by: 'Supply Chain Planning',
    contact_email: 'supplychain@intel.com',
    description: 'Enriches integrated business planning with external signals — weather, macro, competitor pricing. 15–25% inventory reduction; 10–15% service level improvement over static statistical models.',
    business_context: { driver: 'Working capital + service level', expected_value: '15–25% inventory reduction', users_affected: 'Planning org', value_usd: 35_000_000 },
    current_state: { process: 'Statistical forecast in planning suite', current_spend_usd: 6_000_000, effort: 'High', accuracy: 'Baseline MAPE ~28%' },
    technical_context: { data_sources: 'IBP demand history, external signals, BigQuery', platform: 'Vertex AI Forecasting + BigQuery ML', integration: 'API + streaming', complexity: 'High' },
    risk_compliance: { data_sensitivity: 'Medium', pii: false, autonomy: 'Supervised', audit_trail: true, adoption_readiness: 'Medium' },
    bxt: { business_score: 90, experience_score: 62, technology_score: 70, verdict: 'CONDITIONAL',
      detail: { business: ['Large working-capital impact'], experience: ['Planner trust in ML forecasts'], technology: ['Vertex Forecasting mature', 'External data ingestion effort'] } },
    feasibility: { composite: 3.7, quadrant: 'Big Bet', risk_tier: 'Medium', citizen_dev_pct: 22,
      criteria: { business_value: 5, strategic_alignment: 5, data_value: 5, data_availability: 4, technical_complexity: 3, integration_effort: 2, time_to_value: 3, safety: 4, compliance: 4, user_value: 4 },
      pillars: { strategic: 4.7, technical: 3.0, org: 3.6 } },
    advisory: { tier: 'Build', verdict_name: 'Engineer It', recommended_platform: 'Vertex AI Forecasting + BigQuery ML', gate_resolved: 'gate3_build',
      reasoning: { workspace_coverage: 'None', custom_workflow: 'High', ai_complexity: 'High — custom forecasting models' },
      journey: [{ phase: 'Adopt', platform: 'Gemini for Workspace', mandate: 'Planner copilot' }, { phase: 'Extend', platform: 'Agentspace', mandate: 'Scenario UI' }, { phase: 'Scale', platform: 'Vertex AI Forecasting', mandate: 'Production models (current tier)' }] },
    summary: { roi_p10: 260, roi_p50: 610, roi_p90: 1280, readiness: 'Conditional',
      frameworks: { gadf: 71, google_caf: 74, mckinsey_mit: 85, gartner: 82 },
      governance: [{ item: 'DLP / VPC-SC', status: 'PASS' }, { item: 'Model monitoring (drift)', status: 'WARN' }, { item: 'Cloud Audit Logs', status: 'PASS' }, { item: 'Change management', status: 'WARN' }] },
    verdict: { verdict: 'CONDITIONAL GO', binding_condition: 'Phase-1 pilot on two product lines; go/no-go on measured MAPE improvement before scale.',
      stances: { business_sponsor: 'Support', risk_assurance: 'Conditional', cio: 'Conditional', chair: 'CONDITIONAL GO' },
      deliberation: [{ turn: 1, persona: 'BS', text: '$35M working-capital prize justifies the build.' }, { turn: 2, persona: 'CI', text: 'Prove MAPE lift in a bounded pilot first.' }] },
  },
  {
    name: 'Predictive Asset Maintenance',
    department: 'Assets Maintenance',
    executive_sponsor: 'VP Manufacturing',
    submitted_by: 'Reliability Engineering',
    contact_email: 'reliability@intel.com',
    description: 'Fuses IoT sensor data with maintenance history to predict failure windows and auto-generate work orders with parts and resource plans. 25–40% unplanned downtime reduction.',
    business_context: { driver: 'Uptime + OEE', expected_value: '25–40% unplanned downtime reduction', users_affected: 'Maintenance + Ops', value_usd: 48_000_000 },
    current_state: { process: 'Time-based preventive maintenance', current_spend_usd: 9_000_000, effort: 'High', downtime: 'Baseline 6.2% unplanned' },
    technical_context: { data_sources: 'IoT sensors (Pub/Sub), maintenance history', platform: 'Vertex AI + BigQuery + Pub/Sub + Cloud Functions', integration: 'Streaming', complexity: 'High' },
    risk_compliance: { data_sensitivity: 'Medium', pii: false, autonomy: 'Supervised', audit_trail: true, adoption_readiness: 'Medium' },
    bxt: { business_score: 93, experience_score: 64, technology_score: 68, verdict: 'CONDITIONAL',
      detail: { business: ['Massive downtime savings'], experience: ['Technician adoption of AI work orders'], technology: ['Sensor data quality', 'Streaming pipeline effort'] } },
    feasibility: { composite: 3.6, quadrant: 'Big Bet', risk_tier: 'Medium-High', citizen_dev_pct: 18,
      criteria: { business_value: 5, strategic_alignment: 5, data_value: 5, data_availability: 3, technical_complexity: 2, integration_effort: 2, time_to_value: 3, safety: 4, compliance: 4, user_value: 4 },
      pillars: { strategic: 4.8, technical: 2.7, org: 3.6 } },
    advisory: { tier: 'Build', verdict_name: 'Engineer It', recommended_platform: 'Vertex AI + Pub/Sub + BigQuery', gate_resolved: 'gate3_build',
      reasoning: { workspace_coverage: 'None', custom_workflow: 'High', ai_complexity: 'High — predictive models on streaming IoT' },
      journey: [{ phase: 'Adopt', platform: 'Gemini for Workspace', mandate: 'Report copilot' }, { phase: 'Extend', platform: 'AppSheet', mandate: 'Work-order app' }, { phase: 'Scale', platform: 'Vertex AI', mandate: 'Predictive models (current tier)' }] },
    summary: { roi_p10: 300, roi_p50: 720, roi_p90: 1520, readiness: 'Conditional',
      frameworks: { gadf: 69, google_caf: 70, mckinsey_mit: 86, gartner: 81 },
      governance: [{ item: 'DLP / VPC-SC', status: 'PASS' }, { item: 'Data quality (sensors)', status: 'WARN' }, { item: 'Safety review (auto work orders)', status: 'WARN' }, { item: 'Cloud Audit Logs', status: 'PASS' }] },
    verdict: { verdict: 'CONDITIONAL GO', binding_condition: 'Auto-generated work orders require supervisor approval until model precision >90% on the pilot line.',
      stances: { business_sponsor: 'Strong Support', risk_assurance: 'Conditional', cio: 'Conditional', chair: 'CONDITIONAL GO' },
      deliberation: [{ turn: 1, persona: 'BS', text: '$48M uptime upside — top priority.' }, { turn: 2, persona: 'RA', text: 'Safety: supervised work orders until precision proven.' }] },
  },
  {
    name: 'Quality Defect Prediction & Root Cause Analysis',
    department: 'Manufacturing / Quality',
    executive_sponsor: 'VP Quality',
    submitted_by: 'Quality Engineering',
    contact_email: 'quality@intel.com',
    description: 'Correlates QM inspection results with production parameters to predict defect batches before completion. 20–35% reduction in quality-related scrap and rework cost.',
    business_context: { driver: 'Yield + scrap cost', expected_value: '20–35% scrap/rework reduction', users_affected: 'Quality + Production', value_usd: 40_000_000 },
    current_state: { process: 'Post-hoc inspection + manual RCA', current_spend_usd: 7_500_000, effort: 'High', scrap: 'Baseline scrap 3.8%' },
    technical_context: { data_sources: 'QM inspection, MES process params, BigQuery', platform: 'Vertex AI + BigQuery ML + Looker', integration: 'Batch + streaming', complexity: 'High' },
    risk_compliance: { data_sensitivity: 'Medium', pii: false, autonomy: 'Advisory', audit_trail: true, adoption_readiness: 'Medium' },
    bxt: { business_score: 89, experience_score: 68, technology_score: 66, verdict: 'CONDITIONAL',
      detail: { business: ['High scrap-cost reduction'], experience: ['Quality engineer trust in predictions'], technology: ['Model on process params', 'MES integration effort'] } },
    feasibility: { composite: 3.5, quadrant: 'Big Bet', risk_tier: 'Medium', citizen_dev_pct: 26,
      criteria: { business_value: 5, strategic_alignment: 4, data_value: 5, data_availability: 3, technical_complexity: 3, integration_effort: 2, time_to_value: 3, safety: 4, compliance: 4, user_value: 4 },
      pillars: { strategic: 4.4, technical: 2.9, org: 3.7 } },
    advisory: { tier: 'Build', verdict_name: 'Engineer It', recommended_platform: 'Vertex AI + BigQuery ML', gate_resolved: 'gate3_build',
      reasoning: { workspace_coverage: 'None', custom_workflow: 'High', ai_complexity: 'High — defect prediction + RCA models' },
      journey: [{ phase: 'Adopt', platform: 'Gemini for Workspace', mandate: 'RCA copilot' }, { phase: 'Extend', platform: 'Looker + Agentspace', mandate: 'Quality dashboards' }, { phase: 'Scale', platform: 'Vertex AI', mandate: 'Predictive models (current tier)' }] },
    summary: { roi_p10: 240, roi_p50: 560, roi_p90: 1180, readiness: 'Conditional',
      frameworks: { gadf: 68, google_caf: 71, mckinsey_mit: 82, gartner: 79 },
      governance: [{ item: 'DLP / VPC-SC', status: 'PASS' }, { item: 'Data quality (MES)', status: 'WARN' }, { item: 'Model monitoring', status: 'WARN' }, { item: 'Cloud Audit Logs', status: 'PASS' }] },
    verdict: { verdict: 'CONDITIONAL GO', binding_condition: 'Advisory-only predictions in phase 1; no automated batch holds until validated against 3 months of ground truth.',
      stances: { business_sponsor: 'Support', risk_assurance: 'Conditional', cio: 'Conditional', chair: 'CONDITIONAL GO' },
      deliberation: [{ turn: 1, persona: 'BS', text: '$40M scrap reduction — strong case.' }, { turn: 2, persona: 'CI', text: 'Advisory first; validate before automated holds.' }] },
  },
];

async function upsertWorkspace() {
  // Idempotent by name: delete existing Intel (cascades to use cases + gates) then re-insert.
  await query('DELETE FROM workspaces WHERE name = $1', [WS.name]);
  const cols = Object.keys(WS);
  const vals = cols.map((c) => (c === 'compliance_frameworks' ? WS[c] : WS[c]));
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const jsonify = (c, v) => v; // no jsonb cols in WS except arrays handled by pg
  const params = cols.map((c) => jsonify(c, WS[c]));
  const sql = `INSERT INTO workspaces (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`;
  const r = await query(sql, params);
  return r.rows[0].id;
}

async function insertUseCase(wsId, uc) {
  const sql = `INSERT INTO use_cases
    (workspace_id, name, department, executive_sponsor, submitted_by, contact_email, description,
     business_context, current_state, technical_context, risk_compliance, stage)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'panel') RETURNING id`;
  const r = await query(sql, [
    wsId, uc.name, uc.department, uc.executive_sponsor, uc.submitted_by, uc.contact_email, uc.description,
    JSON.stringify(uc.business_context), JSON.stringify(uc.current_state),
    JSON.stringify(uc.technical_context), JSON.stringify(uc.risk_compliance),
  ]);
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
    console.log('Seeding Intel workspace...');
    const wsId = await upsertWorkspace();
    console.log('  workspace id =', wsId);
    for (const uc of USE_CASES) {
      const ucId = await insertUseCase(wsId, uc);
      await insertGates(ucId, uc);
      console.log('  seeded use case:', uc.name, '->', ucId, '(all 5 gates)');
    }
    // Verify
    const check = await query(`
      SELECT u.name,
        (bxt.use_case_id IS NOT NULL) b, (fs.use_case_id IS NOT NULL) f,
        (ar.use_case_id IS NOT NULL) a, (es.use_case_id IS NOT NULL) s, (pv.use_case_id IS NOT NULL) v
      FROM use_cases u
      JOIN workspaces w ON w.id=u.workspace_id AND w.name='Intel'
      LEFT JOIN bxt_scores bxt ON bxt.use_case_id=u.id
      LEFT JOIN feasibility_scores fs ON fs.use_case_id=u.id
      LEFT JOIN advisory_results ar ON ar.use_case_id=u.id
      LEFT JOIN evaluation_summaries es ON es.use_case_id=u.id
      LEFT JOIN panel_verdicts pv ON pv.use_case_id=u.id
      ORDER BY u.created_at`);
    console.log('\nVerification (all should be true across b/f/a/s/v):');
    console.table(check.rows);
    console.log('DONE — Intel + 5 use cases seeded across all 5 modules.');
  } catch (e) {
    console.error('SEED FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
