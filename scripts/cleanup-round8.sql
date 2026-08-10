-- ============================================================================
--  Google AI Catalyst — Round-8 data cleanup
--  Removes QA/security/dev test records; KEEPS the 5 legitimate seed cases.
--  Child rows (bxt_scores, feasibility_scores, advisory_results,
--  evaluation_summaries, panel_verdicts) delete automatically via
--  ON DELETE CASCADE, so we only delete from use_cases.
--
--  Safe & idempotent: re-running is a no-op once the rows are gone.
--  Run:  psql "<DATABASE_PUBLIC_URL>" -f scripts/cleanup-round8.sql
--    or: railway connect  ->  \i scripts/cleanup-round8.sql
-- ============================================================================

BEGIN;

-- ---- PREVIEW: what will be deleted (run these SELECTs first if cautious) ----
-- SELECT id, name, contact_email, stage FROM use_cases
--  WHERE contact_email LIKE '%@intel.example.com'
--     OR name LIKE 'ZZ-QA-R3-SEC-%'
--     OR name = '{"$ne":null}'
--     OR contact_email IN ('e2e@intel.com','regression@intel.com','regression2@intel.com');

-- 1) My QA rows (test domain intel.example.com — NOT the real intel.com)
DELETE FROM use_cases WHERE contact_email LIKE '%@intel.example.com';

-- 2) The three security payloads (100k-char name [H4], SQL & NoSQL injection)
DELETE FROM use_cases WHERE name LIKE 'ZZ-QA-R3-SEC-%' OR name = '{"$ne":null}';

-- 3) The three dev verification runs
DELETE FROM use_cases WHERE contact_email IN
  ('e2e@intel.com','regression@intel.com','regression2@intel.com');

COMMIT;

-- ---- VERIFY (expect exactly the 5 seeds, all @intel.com, all stage=panel) ----
--   Expected COUNT = 5
SELECT COUNT(*) AS remaining_use_cases FROM use_cases;

--   Expected: AskHR, Contract Leakage, Demand Forecasting…, Predictive Asset…, Quality Defect…
SELECT name, contact_email, stage FROM use_cases ORDER BY name;

--   Expected COUNT = 0 (no junk left)
SELECT COUNT(*) AS should_be_zero FROM use_cases
 WHERE contact_email LIKE '%@intel.example.com'
    OR name LIKE 'ZZ-QA-R3-SEC-%'
    OR name = '{"$ne":null}'
    OR contact_email IN ('e2e@intel.com','regression@intel.com','regression2@intel.com');
