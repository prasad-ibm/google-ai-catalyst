-- ============================================================================
-- v2 data normalization (one-time, idempotent)
-- Client rule:
--   department 'Operations' -> 'Data Center Group'
--   executive_sponsor 'COO' -> 'ET-DCG'
-- Safe to re-run: rows already normalized simply won't match the WHERE clause.
-- Run against the live DB (Railway: `railway connect` -> DB AI Catalyst ->
--   \i scripts/normalize-dept-sponsor.sql).
-- ============================================================================
BEGIN;

-- Show what will change (optional preview — comment out COMMIT to dry-run):
-- SELECT id, name, department, executive_sponsor FROM use_cases
--  WHERE department = 'Operations' OR executive_sponsor = 'COO';

UPDATE use_cases SET department = 'Data Center Group'
 WHERE department = 'Operations';

UPDATE use_cases SET executive_sponsor = 'ET-DCG'
 WHERE executive_sponsor = 'COO';

COMMIT;

-- Verify (expect 0 remaining):
-- SELECT COUNT(*) AS should_be_zero FROM use_cases
--  WHERE department = 'Operations' OR executive_sponsor = 'COO';
