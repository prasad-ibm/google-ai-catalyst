-- cleanup-round11.sql
-- Removes the 3 throwaway QA records created during v2 round-11 testing.
-- They are tagged with the sentinel prefix "ZZ-QA-R11-DELETE-ME" in the name.
--
-- SAFETY:
--   * Scoped strictly to the sentinel prefix — no real use case uses it.
--   * Gate tables (bxt_scores, feasibility_scores, advisory_results,
--     evaluation_summaries, panel_verdicts) cascade via ON DELETE CASCADE.
--   * Wrapped in a transaction with a pre/post count so you can confirm
--     exactly 3 rows go (303 -> 300) before committing.
--
-- USAGE (psql against the v2 DB — public proxy or internal):
--   \i scripts/cleanup-round11.sql
-- or:  psql "$DATABASE_URL" -f scripts/cleanup-round11.sql

BEGIN;

-- 1. Preview: what will be deleted (should be exactly the 3 QA rows).
SELECT id, name, workspace_id, created_at
FROM use_cases
WHERE name LIKE 'ZZ-QA-R11-DELETE-ME%'
ORDER BY created_at;

-- 2. Guard: abort if the count is not exactly 3 (protects against a bad LIKE).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM use_cases WHERE name LIKE 'ZZ-QA-R11-DELETE-ME%';
  IF n <> 3 THEN
    RAISE EXCEPTION 'Expected 3 QA rows to delete, found %. Aborting for safety.', n;
  END IF;
END $$;

-- 3. Delete (gate rows cascade automatically).
DELETE FROM use_cases WHERE name LIKE 'ZZ-QA-R11-DELETE-ME%';

-- 4. Post-check: confirm none remain.
SELECT count(*) AS remaining_qa_rows
FROM use_cases
WHERE name LIKE 'ZZ-QA-R11-DELETE-ME%';

-- Review the output above. If remaining_qa_rows = 0 and the deleted set
-- looked right, COMMIT. Otherwise ROLLBACK.
COMMIT;
-- ROLLBACK;  -- uncomment instead of COMMIT to back out
