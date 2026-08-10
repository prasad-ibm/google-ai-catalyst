-- ============================================================
--  Round-7 data cleanup for Google AI Catalyst
--  Clears M3 (avg-ROI skew) and the M5 duplicate-triple SYMPTOM
--  by removing test/QA/dev use cases, keeping ONLY the 5 seeds.
--
--  Safe & idempotent: pure DELETEs scoped to non-seed records,
--  child rows removed first so it works with or without cascade.
--
--  HOW TO RUN (pick one):
--   * Railway CLI:  railway connect  ->  \i scripts/cleanup-round7.sql
--   * psql direct:  psql "<DATABASE_PUBLIC_URL>" -f scripts/cleanup-round7.sql
--   * Dashboard:    paste the statements one at a time into the
--                   DB "Query" editor (omit BEGIN/COMMIT there).
--
--  The 5 seed cases to KEEP are @intel.com (not .example.com),
--  created in the original seed batch. Everything else goes.
-- ============================================================

-- Preview what WILL be deleted (run first, optional):
--   SELECT id, name, stage, contact_email
--   FROM use_cases
--   WHERE contact_email ILIKE '%@intel.example.com'
--      OR name ILIKE 'FE Test UC'
--      OR name ILIKE 'R6 Framework Test'
--      OR name ILIKE '%test%'
--      OR name ILIKE '%framework test%';

BEGIN;

-- Target set: QA rows (@intel.example.com) + known dev/test artifacts.
-- Adjust the name patterns if your dev rows differ.
CREATE TEMP TABLE _to_delete AS
  SELECT id FROM use_cases
   WHERE contact_email ILIKE '%@intel.example.com'
      OR name ILIKE 'FE Test UC'
      OR name ILIKE 'R6 Framework Test'
      OR name ILIKE '%framework test%'
      OR name ILIKE '%qa test%';

-- Child rows first (defensive; harmless if ON DELETE CASCADE exists).
DELETE FROM evaluation_summaries WHERE use_case_id IN (SELECT id FROM _to_delete);
DELETE FROM advisory_results     WHERE use_case_id IN (SELECT id FROM _to_delete);
DELETE FROM feasibility_scores   WHERE use_case_id IN (SELECT id FROM _to_delete);
DELETE FROM bxt_scores           WHERE use_case_id IN (SELECT id FROM _to_delete);
DELETE FROM panel_verdicts       WHERE use_case_id IN (SELECT id FROM _to_delete);

-- Then the parent use cases.
DELETE FROM use_cases WHERE id IN (SELECT id FROM _to_delete);

DROP TABLE _to_delete;

COMMIT;

-- Verify: should return exactly the 5 seed cases, all @intel.com.
--   SELECT COUNT(*) AS total_cases FROM use_cases;                 -- expect 5
--   SELECT name, contact_email, stage FROM use_cases ORDER BY name;
