# Round-12 Fix Notes — for the Test Team

**Build:** AI Catalyst v2 · **Date:** 2026-08-10
**Source report:** *AI Catalyst — Round 12 QA Report v2* (HTML)
**Prepared by:** Engineering

> This supersedes the earlier draft that only covered DEF-12/DEF-03/DEF-13.
> The v2 report re-tested those three AND surfaced a critical data-loss bug plus
> four new defects and an unfit CSV template. Everything below reflects the
> **actual** post-fix state.

---

## ⚠️ Read this first — deploy-time manual step

Two fixes need action **at deploy**, not just in code:

1. **DEF-13 data cleanup** — the code now blocks *new* junk departments, but the
   one pre-existing junk row must be purged from the live DB so facets revert
   **15 → 14**. Run the guarded migration **`scripts/cleanup-round12.sql`**
   against the v2 database during deploy. It is idempotent and aborts unless it
   matches exactly the known junk row (`NotARealDept` / `66fceda0…`).
2. **Test against a clean workspace** — if you re-test DEF-13 before that SQL is
   run, you will still see the 15th facet from the old row. That is expected;
   it is stale data, not a code regression.

---

## Summary table

| ID | Sev | Area | Status | Re-test |
|----|-----|------|--------|---------|
| **R12-N4** | 🔴 CRITICAL | Partial `PUT` wiped 23 detail fields | ✅ Fixed | §1 |
| **R12-N3** | 🟠 HIGH | No DELETE route existed | ✅ Fixed (soft-delete) | §2 |
| **DEF-13** | 🟠 HIGH | Bulk-import dept validation + aliases | ✅ Fixed (code) · migration = deploy step | §3 |
| **R12-N5** | 🟡 MED | Archived records leaked into portfolio map | ✅ Fixed | §4 |
| **R12-N2** | 🟡 MED | `GET /api/use-cases?limit` ignored | ✅ Fixed | §5 |
| **R12-N1** | 🟡 MED | Stale "Show more" button at full expansion | ✅ Fixed | §6 |
| **CSV template** | 🟡 MED | Template imported 0 rows | ✅ Fixed | §7 |
| **DEF-12** | 🟢 LOW | Row-count label + pluralisation | ✅ Fixed (v2-confirmed) | §8 |
| **DEF-03** | 🟢 LOW | `.selpill` overflow clamp | ✅ Fixed (v2-confirmed) | §8 |

---

## 1. R12-N4 (CRITICAL) — partial PUT silently wiped detail blobs

**What was wrong.** A partial `PUT /api/use-cases/:id` with e.g. `{"stage":"archived"}`
returned `200 OK` but **erased all four JSON detail blobs (23 fields)** —
business_context, current_state, technical_context, risk_compliance.

**Root cause.** The update helper returned `null` (not `undefined`) for any
context group absent from the request body; the handler's field loop only
skipped `undefined`, so those `null`s were written over the existing data.

**What changed.** `server.js` — the PUT handler now builds its `SET` list from
**only the fields the request body actually carried**. A jsonb group is touched
only when its grouped key OR at least one of its flat intake keys is present.
Scalars likewise are written only when present. An explicitly-provided empty
value (e.g. `{"business_context":null}`) is still honored as an intentional write.

**How to re-test.**
1. Create/pick a use case with all four detail sections populated.
2. `PUT /api/use-cases/:id` with body `{"stage":"archived"}` only.
3. `GET` the record → **all 23 detail fields are intact**; only `stage` changed.
4. Now `PUT {"business_context":null}` → business_context clears (explicit write honored), the other three sections remain.

**Automated coverage.** `put-merge.test.js` — pass 1 suite / 41 assertions, 0 fail.

---

## 2. R12-N3 (HIGH) — no DELETE route

**What was wrong.** There was no way to remove a use case; no DELETE route existed.

**What changed.** Added `DELETE /api/use-cases/:id` as a **soft delete** (preserves
audit trail): sets `stage='archived'` and `status='archived'`.
- `200` + updated row on success; `404` JSON when no row matches.
- **Idempotent** — deleting an already-archived row still returns `200`.
- Child rows are intentionally left in place under soft-delete.

**How to re-test.**
1. `DELETE /api/use-cases/:id` on an existing row → `200`, row now archived.
2. `GET /api/portfolio` (no params) → the deleted row **no longer appears** (see §4).
3. `DELETE` the same id again → still `200` (idempotent).
4. `DELETE` a non-existent id → `404 {error:"use case not found"}`.

**Automated coverage.** `delete-route.test.js` — 5/0.

---

## 3. DEF-13 (HIGH) — bulk-import department validation + aliases

**What was wrong.** Bulk import didn't validate `department`, so junk values
(e.g. `NotARealDept`) were stored, appeared in `/facets` (14 → 15), and then leaked
into the intake authoring dropdown via the dynamic merge. Common abbreviations
like `HR` were also dropped because only exact/case matches resolved.

**What changed.**
- `departments.js` is the single source of truth for the canonical **14**
  departments. `resolveDepartment()` normalizes case/whitespace, then consults an
  **alias map** (`HR → Human Resources`, `R&D` variants, `IT`, `InfoSec → Security`,
  etc.). Canonical/aliased values pass through; genuinely unknown values coerce to
  `null` (excluded from facets — never a new dropdown option).
- The bulk-import loop runs every row's department through `resolveDepartment()`.
- **`scripts/cleanup-round12.sql`** — guarded, idempotent purge of the existing
  junk row (see the deploy note at the top).

**How to re-test** *(against a clean workspace, or after the cleanup SQL runs)*.
1. Bulk-import a row with `department = NotARealDept` → stored as null/excluded; **facets stay at 14**; intake dropdown stays 14.
2. Bulk-import a row with `department = HR` → resolves to **Human Resources**.
3. Bulk-import mixed-case `human resources` → resolves to **Human Resources**.

**Automated coverage.** `bulk-upload-departments.test.js` 9/0 · `intake-dept.test.js` (dept + alias assertions) pass.

---

## 4. R12-N5 (MED) — archived records leaked into the portfolio map

**What was wrong.** `GET /api/portfolio` returned archived rows; ~16 archived
records showed on the map with no way to filter them out.

**What changed.** `server.js` — `/api/portfolio` now **excludes archived by
default** (`stage <> 'archived' AND status <> 'archived'`). Opt back in via
`?include_archived=1` or `?status=archived`. The **facets endpoint still lists
`archived`** (with its count) as a selectable filter — only the default result set
excludes it.

**How to re-test.**
1. `GET /api/portfolio` (no params) → **no archived rows**.
2. `GET /api/portfolio?include_archived=1` → archived rows return alongside active.
3. `GET /api/portfolio?status=archived` → only archived rows.
4. Facet list still offers **archived** as an option with its count.

**Automated coverage.** `portfolio-archived.test.js` 6/0.

---

## 5. R12-N2 (MED) — `GET /api/use-cases?limit` ignored

**What was wrong.** The `?limit` param was ignored (`?limit=6` returned all rows).

**What changed.** `server.js` — `GET /api/use-cases` now honors opt-in
parameterized `?limit` and `?offset` (limit clamped to 500; non-numeric/negative/zero
ignored). No params → unchanged (returns all).

**How to re-test.**
1. `GET /api/use-cases?limit=6` → exactly 6 rows.
2. `GET /api/use-cases?limit=6&offset=6` → next page.
3. `GET /api/use-cases` (no param) → all rows (unchanged).

**Automated coverage.** `use-cases-limit.test.js` 7/0.

---

## 6. R12-N1 (MED) — stale "Show more" button at full expansion

**What was wrong.** After expanding a list fully (`15 of 15`), a "Show 3 more"
button still lingered. (Previously masked by the junk 15th department.)

**What changed.** `assets/lazy-list.js` — the "Show more" control is hidden once
the rendered count reaches the total. (Complements the DEF-12 label fix.)

**How to re-test.** Expand any lazy list (portfolio map / kanban) to the end →
the "Show more" button disappears at `N of N`; label reads the correct total.

**Automated coverage.** `lazy-list.test.js` 29/0.

---

## 7. CSV template — imported 0 rows ("not fit for purpose")

**What was wrong.** The downloadable template imported **zero rows**: every row
had a blank `workspace_id` column, and two sample rows used department strings
that silently resolved to null.

**What changed.** `use-case-template.js` (the template data; `server.js` only
serves it via `buildTemplateCsv()`):
- Removed the dead blank `workspace_id` column (supplied out-of-band by the import
  modal / bulk endpoint).
- Fixed the two sample departments to canonical values (`Manufacturing`, `Quality`)
  so all 6 sample rows round-trip cleanly.
- Import UI (Bulk-upload button + Download-template link) was already wired in
  `dashboard.html`.

**How to re-test.**
1. Download the template from the dashboard.
2. Import it unmodified → **all 6 sample rows import**, each with a valid department.
3. Edit a row's department to `HR` → imports as **Human Resources** (see §3).

**Automated coverage.** `use-case-template.test.js` 7/0 · `bulk-upload-departments.test.js` 9/0 · frontend/DOM bulk-upload suites pass.

---

## 8. DEF-12 & DEF-03 (LOW) — confirmed fixed in the v2 report

- **DEF-12** — portfolio row-count label updates after Show-more and pluralises
  (`showing 307 of 307 use cases`; `1 use case`). `lazy-list.test.js`. **v2 report: FIXED.**
- **DEF-03** — `.selpill` container clamped (max-width + ellipsis) as defence-in-depth
  over the existing `.selpill__name` clamp + ingest clip. `compare.test.js` 113/0.
  **v2 report: FIXED.**

---

## Not defects — please do not re-file

Per the reconciled triage, these were confirmed **by design / out of scope for v2**
and should not be reopened:
- **DEF-08** — department enforcement scope (by design).
- **DEF-09** — dual API response shape (by design).
- **ROI magnitude / build-cost basis** — unchanged for v2 per client decision;
  advisory footnote only.

---

## Regression / smoke checklist

- [ ] Run `scripts/cleanup-round12.sql` on the target DB (facets 15 → 14).
- [ ] PUT partial update preserves detail blobs (§1).
- [ ] DELETE archives + is idempotent + 404s on missing (§2).
- [ ] Bulk import: junk dept excluded, `HR` → Human Resources, facets = 14 (§3).
- [ ] Portfolio hides archived by default; facet still lists archived (§4).
- [ ] `?limit`/`?offset` honored on `/api/use-cases`; no-param unchanged (§5).
- [ ] "Show more" disappears at full expansion; label correct (§6).
- [ ] Template imports all 6 sample rows with valid departments (§7).
- [ ] Compare pills clamp; portfolio label pluralises (§8).
