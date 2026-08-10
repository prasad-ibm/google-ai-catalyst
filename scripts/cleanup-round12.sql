-- cleanup-round12.sql
-- Removes the ONE junk use_cases row created during v2 round-12 QA that
-- carried an invalid department ("NotARealDept"). That row polluted
-- /api/portfolio/facets (departments 14 -> 15) and, via the DEF-06 dynamic
-- merge, leaked a spurious 15th option into the intake dropdown.
--
-- Running this reverts the facet department count from 15 back to 14. The
-- DEF-13 code fix (departments.js + server.js bulk-import validation) prevents
-- any *new* junk department from ever being persisted again.
--
-- SAFETY:
--   * Double-scoped: matches the known junk row id prefix "66fceda0" AND the
--     invalid department "NotARealDept" — no real use case matches either.
--   * Gate tables (bxt_scores, feasibility_scores, advisory_results,
--     evaluation_summaries, panel_verdicts) cascade via ON DELETE CASCADE.
--   * Wrapped in a transaction with a pre/post count and a guard that ABORTS
--     unless exactly 1 row matches, so a mistyped predicate can never wipe
--     real data.
--
-- !!! DO NOT run blindly against the live Railway DB. Review the preview
-- !!! output first; COMMIT only if remaining_junk_rows = 0 and the deleted
-- !!! row is the expected 66fceda0… / NotARealDept row. Otherwise ROLLBACK.
--
-- USAGE (psql against the v2 DB — public proxy or internal):
--   \i scripts/cleanup-round12.sql
-- or:  psql "$DATABASE_URL" -f scripts/cleanup-round12.sql

BEGIN;

-- 1. Preview: what will be deleted (should be exactly the 1 junk row).
SELECT id, name, department, workspace_id, created_at
FROM use_cases
WHERE id::text LIKE '66fceda0%'
  AND department = 'NotARealDept'
ORDER BY created_at;

-- 2. Guard: abort unless exactly 1 row matches (protects against a bad predicate).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM use_cases
  WHERE id::text LIKE '66fceda0%'
    AND department = 'NotARealDept';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 junk row to delete, found %. Aborting for safety.', n;
  END IF;
END $$;

-- 3. Delete (gate rows cascade automatically).
DELETE FROM use_cases
WHERE id::text LIKE '66fceda0%'
  AND department = 'NotARealDept';

-- 4. Post-check: confirm none remain.
SELECT count(*) AS remaining_junk_rows
FROM use_cases
WHERE id::text LIKE '66fceda0%'
  AND department = 'NotARealDept';

-- Review the output above. If remaining_junk_rows = 0 and the deleted row
-- looked right, COMMIT. Otherwise ROLLBACK.
COMMIT;
-- ROLLBACK;  -- uncomment instead of COMMIT to back out
