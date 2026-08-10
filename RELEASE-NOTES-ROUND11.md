# Release Notes — Round 11 (v2 "Scale")

**Site:** https://ai-catalyst-v2.up.railway.app
**Date:** 2026-08-10
**Scope:** Fixes from the Round-11 v2 QA regression report + carried items.
**Result:** 11 of 13 items fixed & test-verified; 2 documented as by-design (per product decision).

> ⚠️ **Deploy note:** the live site had been running a **stale build** (predated most of the v2 work — `filter-bar.js` 404'd, no `/facets`, old Compare). A redeploy (`railway up`) shipped the entire v2 Scale release **plus** these round-11 fixes at once. The DB auto-migrates on boot.

---

## Fixed this round

| # | Sev | Area | What was wrong | Fix | Verified |
|---|-----|------|----------------|-----|----------|
| **DEF-01** | 🔴 HIGH | Filter bar | Filter dropdowns showed only "All" — the flagship v2 filtering feature was unusable. | Client read **singular** facet keys (`department`) while the server returns **plural** (`departments/sponsors/stages/statuses`). Mapped the keys; corrected the test mock that had hidden it. | filter-bar 32/32 |
| **DEF-02** | 🔴 HIGH | Panel verdict | A **GO / "Unanimous approval"** verdict contradicted a Conditional-GO chair decision, a binding condition, and non-unanimous stances. | GO verdicts now render a **coherent** narrative — unanimous Support stances, **no** binding condition — in both the verdict band and the Executive Brief. | panel 141/141, m6 11/11 |
| **DEF-03** | 🟡 MED | Compare | Long use-case names blew the table layout far past the viewport. | Clamped **3 surfaces** (header name, picker list row, selected pill) + clip names at ingest (200 chars). | compare 112/112 |
| **DEF-04/05** | 🟡 MED | Bulk upload | No client-side warning for rows missing a required name; server FAIL reasons not surfaced per row. | Client **warn-and-allow** pre-validation for blank names + per-row server FAIL reasons shown. | bulk 18/18 |
| **DEF-06** | 🟡 MED | Intake | Department dropdown listed only 9 stale options vs 14 real departments. | Canonical **14** departments (static) + **dynamic merge** from `/api/portfolio/facets`. | intake-dept 33/33 |
| **DEF-07** | 🟡 MED | Theme | Light/dark toggle did nothing on app pages (no light CSS existed). | One shared **light-theme token block** keyed on both `[data-theme="light"]` and `body.theme-light`, covering every page. | 3/3 |
| **DEF-08** | 🟢 LOW | Intake | Department marked required (\*) but not enforced. | Now enforced before submit (inline error + blocks advance). | intake-dept 33/33, intake-submit 18/18 |
| **DEF-10** | 🟢 LOW | Compare | "GO-only" preset serialized 139 IDs into a **5,473-char** URL. | Compact **`?preset=go-only`** token; boot rebuilds the set from the token. | 7/7 |
| **DEF-11 / nits** | 🟢 LOW | Various | Bulk modal hardcoded "5 example rows"; over-filtered empty state gave no way out; delivered-by-dept showed blank; QA guide hardcoded a stale password. | Removed the "5"; **filter-aware empty state + "Clear filters" button**; blank dept → "—"; QA guide password de-hardcoded. | delivered 23/23, cross-page 13/13 |

**Also delivered:** `scripts/cleanup-round11.sql` — a guarded, transactional DELETE of the 3 `ZZ-QA-R11-DELETE-ME` test rows (303 → 300). Aborts automatically unless exactly 3 rows match. **Run & confirmed: DELETE 3, remaining = 0.**

---

## Left as-is by design (product decision — documented, not changed)

| # | Item | Decision |
|---|------|----------|
| **DEF-09** | `GET /api/portfolio` returns a bare array with no params, but an enveloped `{rows,total,limit,offset}` when paginated. | **Kept** for back-compat; documented in QA-TEST-GUIDE §8 (dual shape is intentional). |
| **ROI magnitude** | Returns display very high (e.g. +19,525%) because the denominator is **build cost only** (excludes run/licence/opex). | **Model unchanged** — this is a financial-model choice, not a bug. Documented in QA-TEST-GUIDE §8 (build-cost basis). Needs finance sign-off before any change. |

---

## Post-deploy smoke (5 checks)

1. `/assets/filter-bar.js` → returns JS, **not 404** *(confirms the new build shipped)*
2. **Dashboard** → filter dropdowns are **populated** *(DEF-01)*
3. **Theme toggle** → page actually switches light/dark *(DEF-07)*
4. **Compare → GO-only preset** → URL stays short (`?preset=go-only`) *(DEF-10)*
5. **Panel** on a GO case → GO with **no** binding condition, unanimous stances *(DEF-02)*

---

## Test evidence (all green)

```
filter-bar            32/32
panel                141/141
m6-parity             11/11   (Brief ↔ Summary ROI parity holds)
intake-dept           33/33
intake-submit         18/18
bulk-upload-dom       18/18
compare              112/112
delivered-storyline   23/23
cross-page-consistency 13/13
```

## Files changed
- `assets/filter-bar.js` — facet key mapping (DEF-01)
- `assets/bulk-upload.js` — blank-name pre-validation + FAIL reasons (DEF-04/05); modal copy (DEF-11)
- `assets/theme.css` — shared light-theme tokens (DEF-07)
- `panel.html` — coherent GO narrative in band + brief (DEF-02)
- `intake.html` — 14 depts + facet merge (DEF-06); Department enforced (DEF-08)
- `compare.html` — name clamping (DEF-03); `?preset=go-only` token (DEF-10)
- `dashboard.html` — filter-aware empty state + Clear filters; delivered-by-dept "—" (DEF-11)
- `QA-TEST-GUIDE.md` — password de-hardcoded; §8 by-design notes (DEF-09, ROI)
- `scripts/cleanup-round11.sql` — guarded QA-row cleanup
- Tests updated: `filter-bar`, `panel`, `bulk-upload-dom`, `intake-dept`, `intake-submit`, `compare`
