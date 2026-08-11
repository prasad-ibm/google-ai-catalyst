-- cleanup-round13.sql
-- Hard-deletes throwaway QA use_cases created during v2 round-13 testing.
-- Unlike round-11/12 (which targeted a known, fixed row count), round-13 QA
-- left an INDETERMINATE number of records behind, all tagged with one of two
-- sentinel name prefixes:
--
--     name LIKE 'ZZ-QA-%'          -- live QA scratch records
--  OR name LIKE 'ZZ-ARCHIVED-QA%'  -- QA records that were soft-archived
--
-- No real, business-authored use case uses the "ZZ-" sentinel prefix, so this
-- predicate cannot match production data.
--
-- WHY prefix-based (not id/count-based): round-13 QA generated an unknown and
-- varying number of scratch rows across intake + bulk-import + archive paths.
-- A fixed-count guard (as in round-11's "expected exactly 3") would be brittle
-- and fail spuriously. Instead we guard against the one thing that is actually
-- dangerous — an over-broad predicate — by capping the match at a sane ceiling.
--
-- SAFETY:
--   * Scoped strictly to the "ZZ-" sentinel prefixes — no real use case matches.
--   * Gate tables (bxt_scores, feasibility_scores, advisory_results,
--     evaluation_summaries, panel_verdicts) cascade via ON DELETE CASCADE, so
--     deleting a use_case removes all of its dependent gate rows automatically.
--   * Wrapped in a single transaction with a pre-delete preview, a guard, and a
--     post-delete count so you can confirm the outcome before committing.
--   * IDEMPOTENT / SAFE TO RE-RUN: the guard treats 0 matches as "already
--     clean" (a committing no-op, not an error). Any positive count up to the
--     ceiling is deleted. Re-running after a successful purge simply matches 0
--     rows and does nothing.
--   * A ceiling guard (MAX_QA_ROWS) aborts the whole transaction if the match
--     is implausibly large, which would signal the predicate has gone wrong
--     (e.g. a schema/data change) rather than a genuine QA-cleanup situation.
--
-- !!! MANUAL DEPLOY STEP — DO NOT run blindly against the live Railway DB.
-- !!! This is NOT part of the automatic boot migration (schema.sql). Run it by
-- !!! hand, review the preview + counts, and COMMIT only if the deleted set is
-- !!! entirely "ZZ-QA-…" / "ZZ-ARCHIVED-QA…" sentinel rows and
-- !!! remaining_qa_rows = 0. Otherwise ROLLBACK.
--
-- USAGE (psql against the v2 DB — public proxy or internal):
--   \i scripts/cleanup-round13.sql
-- or:  psql "$DATABASE_URL" -f scripts/cleanup-round13.sql

BEGIN;

-- 1. Preview: every row that will be deleted (all should carry a ZZ- sentinel).
SELECT id, name, department, stage, status, workspace_id, created_at
FROM use_cases
WHERE name LIKE 'ZZ-QA-%'
   OR name LIKE 'ZZ-ARCHIVED-QA%'
ORDER BY created_at;

-- 2. Guard: idempotent + over-broad-predicate protection.
--    * n = 0            -> already clean; emit a notice and proceed (no-op delete).
--    * 0 < n <= ceiling -> expected QA-cleanup case; proceed.
--    * n > ceiling      -> the predicate matched implausibly many rows; ABORT so
--                          a mistaken/over-broad match can never nuke real data.
DO $$
DECLARE
  n int;
  MAX_QA_ROWS constant int := 1000;  -- sanity ceiling for a single QA round
BEGIN
  SELECT count(*) INTO n
  FROM use_cases
  WHERE name LIKE 'ZZ-QA-%'
     OR name LIKE 'ZZ-ARCHIVED-QA%';

  IF n = 0 THEN
    RAISE NOTICE 'No ZZ-QA-* / ZZ-ARCHIVED-QA* rows match — already clean, nothing to do.';
  ELSIF n > MAX_QA_ROWS THEN
    RAISE EXCEPTION
      'Matched % QA rows, which exceeds the safety ceiling of %. Predicate looks over-broad — aborting. Review before running.',
      n, MAX_QA_ROWS;
  ELSE
    RAISE NOTICE 'Matched % QA row(s) tagged with a ZZ- sentinel prefix — deleting.', n;
  END IF;
END $$;

-- 3. Delete (dependent gate rows cascade automatically via ON DELETE CASCADE).
DELETE FROM use_cases
WHERE name LIKE 'ZZ-QA-%'
   OR name LIKE 'ZZ-ARCHIVED-QA%';

-- 4. Post-check: confirm none remain.
SELECT count(*) AS remaining_qa_rows
FROM use_cases
WHERE name LIKE 'ZZ-QA-%'
   OR name LIKE 'ZZ-ARCHIVED-QA%';

-- Review the output above. If remaining_qa_rows = 0 and the deleted set was
-- entirely ZZ- sentinel QA rows, COMMIT. Otherwise ROLLBACK.
COMMIT;
-- ROLLBACK;  -- uncomment instead of COMMIT to back out
