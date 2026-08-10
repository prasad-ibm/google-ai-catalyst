-- ============================================================================
--  Google AI Catalyst — Round-9 data cleanup
--  Removes the Round-9 QA record(s); KEEPS the 5 legitimate seed cases.
--  Child rows cascade-delete (ON DELETE CASCADE), so delete only use_cases.
--  Idempotent & safe to re-run.
--  Run:  railway connect -> DB AI Catalyst -> \i scripts/cleanup-round9.sql
-- ============================================================================

BEGIN;

-- Round-9 QA record(s): the "ZZ-QA-DELETE-ME R9" case and any test domain rows
DELETE FROM use_cases WHERE name LIKE 'ZZ-QA-%';
DELETE FROM use_cases WHERE contact_email LIKE '%@intel.example.com';

-- Belt-and-braces: any leftover injection payloads from earlier rounds
DELETE FROM use_cases WHERE name LIKE 'ZZ-QA-R3-SEC-%' OR name = '{"$ne":null}';
DELETE FROM use_cases WHERE contact_email IN
  ('e2e@intel.com','regression@intel.com','regression2@intel.com');

COMMIT;

-- ---- VERIFY (expect exactly the 5 seeds) ----
SELECT COUNT(*) AS remaining_use_cases FROM use_cases;                 -- expect 5
SELECT name, contact_email, stage FROM use_cases ORDER BY name;
SELECT COUNT(*) AS should_be_zero FROM use_cases                       -- expect 0
 WHERE name LIKE 'ZZ-QA-%'
    OR contact_email LIKE '%@intel.example.com'
    OR name = '{"$ne":null}'
    OR contact_email IN ('e2e@intel.com','regression@intel.com','regression2@intel.com');
