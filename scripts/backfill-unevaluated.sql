-- ============================================================================
-- M5 backfill: strip evaluation rows from cases that were never genuinely
-- evaluated, so the portfolio 'evaluated' guard (server.js) nulls their
-- ROI / quadrant / tier / feasibility instead of surfacing stale seed data.
--
-- WHY: legacy SEED rows shared a byte-identical Monte-Carlo triple
--   roi_p10=1920 / roi_p50=829 / roi_p90=3501
-- across "FE Test UC" (a test artifact) and "Quality Defect Prediction".
-- A case that is still at stage='intake' (or the FE Test UC placeholder) has
-- not run the gates, so it must NOT carry evaluation_summaries / advisory_results
-- / feasibility_scores / bxt_scores / panel_verdicts rows.
--
-- SAFE / IDEMPOTENT: pure DELETEs scoped to unevaluated cases. Running it more
-- than once is a no-op after the first pass. It never touches use_cases rows
-- themselves — only the derived evaluation artifacts. Genuinely evaluated cases
-- (stage in panel/approved/etc. and NOT named "FE Test UC") are untouched.
--
-- Run against the LIVE database:
--   psql "$DATABASE_URL" -f scripts/backfill-unevaluated.sql
-- ============================================================================

BEGIN;

-- Target set: cases that are not genuinely evaluated.
--   * stage = 'intake'  (never progressed past intake), OR
--   * name  ILIKE 'FE Test UC'  (test artifact)
-- Adjust the WHERE clause if your schema uses a different "unevaluated" marker.

DELETE FROM evaluation_summaries
 WHERE use_case_id IN (
   SELECT id FROM use_cases
    WHERE stage = 'intake' OR name ILIKE 'FE Test UC'
 );

DELETE FROM advisory_results
 WHERE use_case_id IN (
   SELECT id FROM use_cases
    WHERE stage = 'intake' OR name ILIKE 'FE Test UC'
 );

DELETE FROM feasibility_scores
 WHERE use_case_id IN (
   SELECT id FROM use_cases
    WHERE stage = 'intake' OR name ILIKE 'FE Test UC'
 );

DELETE FROM bxt_scores
 WHERE use_case_id IN (
   SELECT id FROM use_cases
    WHERE stage = 'intake' OR name ILIKE 'FE Test UC'
 );

DELETE FROM panel_verdicts
 WHERE use_case_id IN (
   SELECT id FROM use_cases
    WHERE stage = 'intake' OR name ILIKE 'FE Test UC'
 );

-- Verify: after this runs, no unevaluated case should retain eval rows.
--   SELECT u.id, u.name, u.stage,
--     (es.use_case_id IS NOT NULL) AS has_summary
--   FROM use_cases u
--   LEFT JOIN evaluation_summaries es ON es.use_case_id = u.id
--   WHERE u.stage = 'intake' OR u.name ILIKE 'FE Test UC';
-- Expected: has_summary = false for every row.

COMMIT;
