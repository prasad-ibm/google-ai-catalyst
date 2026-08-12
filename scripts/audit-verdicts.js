#!/usr/bin/env node
/* ==========================================================================
 * audit-verdicts.js  --  READ-ONLY diagnosis of why evaluated cases don't
 * show a verdict on the dashboard. Writes NOTHING.
 *
 * The dashboard's Verdict Mix reads `verdict` from GET /api/portfolio, which
 * is a LEFT JOIN to the panel_verdicts table. A case only shows GO / NO-GO /
 * CONDITIONAL if it owns a COMMITTED row in panel_verdicts. ROI/quadrant/tier
 * tiles additionally require an evaluation_summaries row with roi_p50 != null
 * AND an roi-eligible stage. This script reports coverage of both tables.
 *
 * USAGE (from repo root, e.g. C:\google-ai-catalyst):
 *   node scripts/audit-verdicts.js "postgresql://user:PASS@host:port/db"
 *   node scripts/audit-verdicts.js "postgres://..." --workspace <uuid>
 *   node scripts/audit-verdicts.js "postgres://..." --id <use_case_uuid>
 * ========================================================================== */
'use strict';
const { Client } = require('pg');

function flag(name) { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] || '') : undefined; }
const CONN = (process.argv[2] && /^postgres/i.test(process.argv[2])) ? process.argv[2] : process.env.DATABASE_URL;
const WS = flag('--workspace');
const ONE_ID = flag('--id');

if (!CONN) { console.error('ERROR: no connection string. Pass one as arg 1 or set DATABASE_URL.'); process.exit(1); }

(async () => {
  const c = new Client({ connectionString: CONN });
  await c.connect();

  // Optional single-case deep dive
  if (ONE_ID) {
    const uc = (await c.query('SELECT id, name, stage, status, workspace_id FROM use_cases WHERE id=$1', [ONE_ID])).rows[0];
    console.log('\n=== SINGLE CASE ===');
    console.log('use_case          :', uc || '(not found)');
    if (uc) {
      const pv = (await c.query('SELECT verdict, binding_condition FROM panel_verdicts WHERE use_case_id=$1', [ONE_ID])).rows;
      const es = (await c.query('SELECT roi_p50, roi_p10, roi_p90 FROM evaluation_summaries WHERE use_case_id=$1', [ONE_ID])).rows;
      const fs = (await c.query('SELECT composite FROM feasibility_scores WHERE use_case_id=$1', [ONE_ID])).rows;
      console.log('panel_verdicts    :', pv.length ? pv[0] : '(NONE - no committed verdict -> dashboard shows "Not evaluated")');
      console.log('evaluation_summary:', es.length ? es[0] : '(NONE - ROI/quadrant suppressed)');
      console.log('feasibility_scores:', fs.length ? fs[0] : '(none)');
    }
  }

  // Workspace-scoped coverage (or all workspaces)
  const wsClause = WS ? 'WHERE uc.workspace_id = $1' : '';
  const wsParams = WS ? [WS] : [];

  const agg = (await c.query(`
    SELECT
      COUNT(*)                               AS total_use_cases,
      COUNT(pv.use_case_id)                  AS with_committed_verdict,
      COUNT(es.use_case_id)                  AS with_evaluation_summary,
      COUNT(es.use_case_id) FILTER (WHERE es.roi_p50 IS NOT NULL) AS with_real_roi_p50,
      COUNT(fs.use_case_id)                  AS with_feasibility
    FROM use_cases uc
    LEFT JOIN panel_verdicts       pv ON pv.use_case_id = uc.id
    LEFT JOIN evaluation_summaries es ON es.use_case_id = uc.id
    LEFT JOIN feasibility_scores   fs ON fs.use_case_id = uc.id
    ${wsClause}`, wsParams)).rows[0];

  console.log('\n=== COVERAGE ' + (WS ? '(workspace ' + WS + ')' : '(ALL workspaces)') + ' ===');
  console.log('total use cases            :', agg.total_use_cases);
  console.log('with COMMITTED verdict     :', agg.with_committed_verdict, '  <-- dashboard Verdict Mix counts THESE');
  console.log('with evaluation_summary    :', agg.with_evaluation_summary);
  console.log('with real roi_p50          :', agg.with_real_roi_p50, '  <-- ROI/quadrant tiles need THIS + roi-eligible stage');
  console.log('with feasibility_scores    :', agg.with_feasibility);

  const stages = (await c.query(`SELECT stage, COUNT(*) FROM use_cases uc ${wsClause} GROUP BY stage ORDER BY 2 DESC`, wsParams)).rows;
  console.log('\nSTAGE DISTRIBUTION:');
  stages.forEach(s => console.log('   ' + String(s.stage).padEnd(14) + s.count));

  const verd = (await c.query(`
    SELECT COALESCE(pv.verdict,'(none)') AS verdict, COUNT(*)
    FROM use_cases uc LEFT JOIN panel_verdicts pv ON pv.use_case_id = uc.id
    ${wsClause} GROUP BY 1 ORDER BY 2 DESC`, wsParams)).rows;
  console.log('\nCOMMITTED VERDICT DISTRIBUTION:');
  verd.forEach(v => console.log('   ' + String(v.verdict).padEnd(18) + v.count));

  console.log('\n=== DIAGNOSIS ===');
  if (Number(agg.with_committed_verdict) === 0) {
    console.log('  No committed panel_verdicts rows exist. The dashboard is behaving as designed:');
    console.log('  it only counts verdicts written via the Executive Panel (PUT /:id/verdict).');
    console.log('  The GO/NO-GO/Conditional you see on summary.html is computed client-side and');
    console.log('  was never committed. FIX = backfill panel_verdicts (and evaluation_summaries');
    console.log('  for ROI) from your source data.');
  } else {
    console.log('  Some committed verdicts exist. Compare with_committed_verdict vs total to see');
    console.log('  how many cases are missing a committed verdict.');
  }
  console.log('  (No changes were made - this was read-only.)');

  await c.end();
})().catch(e => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
