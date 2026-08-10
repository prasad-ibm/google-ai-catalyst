-- ============================================================================
--  delete-all-usecases.sql
--  Deletes ALL use cases (and their cascaded gate rows) from the target DB.
--  Workspaces and user accounts are PRESERVED.
--
--  SAFE BY DESIGN:
--    * Runs inside a transaction.
--    * Prints the count BEFORE deleting.
--    * Deletes; then prints the remaining count (should be 0).
--    * COMMIT only happens if the whole script runs without error.
--
--  >>> DRY RUN FIRST <<<  To preview only (no delete), run with:
--        psql "%DATABASE_URL%" -v dryrun=1 -f scripts\delete-all-usecases.sql
--  To actually delete, run WITHOUT the -v flag (or -v dryrun=0):
--        psql "%DATABASE_URL%" -f scripts\delete-all-usecases.sql
-- ============================================================================

\set ON_ERROR_STOP on
-- default dryrun to 0 if not supplied
\if :{?dryrun} \else \set dryrun 0 \endif

BEGIN;

-- 1) Show what exists now (per workspace) so you can eyeball the blast radius.
\echo '=== Use cases BEFORE (by workspace) ==='
SELECT w.name AS workspace, COUNT(u.id) AS use_cases
FROM workspaces w
LEFT JOIN use_cases u ON u.workspace_id = w.id
GROUP BY w.name
ORDER BY use_cases DESC, w.name;

\echo '=== TOTAL use cases about to be affected ==='
SELECT COUNT(*) AS total_use_cases FROM use_cases;

-- 2) Delete (skipped entirely in dry-run mode).
\if :dryrun
  \echo '*** DRY RUN: no rows deleted. Re-run without -v dryrun=1 to delete. ***'
\else
  \echo '=== Deleting ALL use cases (gate rows cascade automatically) ==='
  DELETE FROM use_cases;
  \echo '=== Remaining use cases after delete (should be 0) ==='
  SELECT COUNT(*) AS remaining_use_cases FROM use_cases;
\endif

-- 3) Commit. (In dry-run this commits nothing meaningful; the DELETE was skipped.)
COMMIT;

\echo 'Done. Workspaces and accounts were preserved; only use cases were removed.'
