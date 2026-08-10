# AI Catalyst v2 — QA Test Guide

**Environment (demo):** https://ai-catalyst-v2.up.railway.app
**Login:** `sandboxuser` / *(current `SEED_PASSWORD` — ask your admin; the deploy default was rotated)*  
> The password is controlled by the `SEED_PASSWORD` env var on the Railway service and is re-applied on every deploy. It is **not** editable in-app. If login fails, confirm the current value in Railway → service → Variables.
**Demo data:** switch the workspace picker to **"Intel - Portfolio Demo"** (300 evaluated use cases across 14 departments, ~35 marked *Delivered* in 2026).
**Health check:** https://ai-catalyst-v2.up.railway.app/api/health → expect `{ ok:true, db:true }`.

> Test in **Chrome + Edge** at minimum; spot-check **Safari/Firefox**. Try one desktop (1440px) and one narrow/mobile (≈390px) width — the app is responsive.

---

## 1. What this app does (one-paragraph orientation)
AI Catalyst evaluates enterprise AI **use cases** through a 5-gate decision framework —
**BXT → Feasibility → Advisory → Summary → Verdict** — then rolls everything up into a
**portfolio** with a dashboard, a portfolio map, a pipeline (kanban) board, and a side-by-side
**compare** tool. v2 ("Scale") adds enterprise-volume features: shared filtering, faceted counts,
pagination/lazy rendering, an expanded compare, and a **"2026 Delivered"** storyline.

---

## 2. Pages / surfaces to cover
| Page | URL | Purpose |
|---|---|---|
| Login | `/login.html` | Auth gate |
| Setup / Workspace | `/setup.html` | Create/select a workspace (client profile) |
| Intake | `/intake.html` | Submit a new use case (single + bulk upload) |
| BXT | `/bxt.html` | Gate 1 — Business/Experience/Technology screen |
| Feasibility | `/feasibility.html` | Gate 2 — composite score, quadrant, risk |
| Advisory | `/advisory.html` | Gate 3 — platform tier & journey |
| Summary | `/summary.html` | Gate 4 — ROI (Monte Carlo P10/P50/P90), frameworks |
| Panel / Verdict | `/panel.html` | Gate 5 — GO / CONDITIONAL / NO-GO + executive brief |
| Dashboard | `/dashboard.html` | Portfolio KPIs + **2026 Delivered** storyline |
| Portfolio Map | `/portfolio-map.html` | Cases grouped by department |
| Pipeline Board | `/kanban.html` | Cases by stage (kanban columns) |
| Compare | `/compare.html` | Side-by-side comparison + radar breakdowns |

---

## 3. NEW in v2 — priority test areas (spend most time here)

### 3.1 Shared filter bar (Dashboard, Portfolio Map, Pipeline Board)
The same filter bar appears on all three views: **Department**, **Exec Sponsor**, **Stage/Status**, and a **search** box, plus a **Clear** button.
- [ ] Selecting a **Department** narrows the view AND the counts in the other dropdowns update (facet counts).
- [ ] Selecting **Exec Sponsor** and **Stage/Status** filter correctly (combine — filters are AND'd).
- [ ] **Search** filters by name/department (debounced — pause after typing).
- [ ] **Clear** resets all filters and the full set returns.
- [ ] **URL persistence:** after filtering, the URL shows query params (e.g. `?department=Finance&status=completed`). **Copy the URL into a new tab** → the same filters are pre-applied.
- [ ] **Cross-page carry:** apply a filter on Dashboard, navigate to Portfolio Map / Pipeline Board → the same filter is honored.
- [ ] Facet counts never show negative/blank; a filter that matches nothing shows an empty state (not an error).

### 3.2 "2026 Delivered" storyline (Dashboard)
Appears only when the workspace has cases with **status = completed**.
- [ ] With **"Intel - Portfolio Demo"** selected, the **"2026 Delivered"** section is visible.
- [ ] Three KPIs render: **Delivered count** (~35), **Avg realized P50 net return**, **# delivering departments**.
- [ ] **Delivered-by-department** bars render, sorted by count (widest = most delivered), each with a per-dept average.
- [ ] Filter **Status = Completed** → the main views show only delivered cases; the storyline numbers stay consistent with the count.
- [ ] Switch to a workspace with **no** completed cases → the storyline section is **hidden** (not empty/broken).

### 3.3 Compare v2 (`/compare.html`)
- [ ] **Searchable picker:** type in the search box → the candidate list filters live.
- [ ] Add several cases → they appear as removable **pills**; removing a pill drops it from the comparison.
- [ ] **Presets:**
  - **Top ROI** → selects the highest-ROI cases (5).
  - **GO-only** → selects all cases with a GO verdict.
  - **By department** dropdown → one-click compares all cases in the chosen department.
  - **Clear** → empties the selection + search.
- [ ] **Unlimited table:** select **more than 4** cases → the side-by-side **table shows ALL** of them (scroll horizontally); a hint appears ("All N shown · scroll…").
- [ ] **4 pinned radars:** the **Score Breakdown** shows at most **4** radar charts (the first 4 selected). When >4 are selected, a note reads *"Showing radar breakdowns for the first 4… all N appear in the table below."*
- [ ] **Long-name safety:** a very long use-case name does NOT blow out the layout — the header cell truncates with an ellipsis; the table stays within the viewport (no runaway horizontal scroll).

### 3.4 Scale / performance (300 rows)
- [ ] **Dashboard portfolio table** and **ROI list** render quickly, showing the first ~50 with a **"Show N more"** control that loads the rest (or auto-loads on scroll). All rows reachable.
- [ ] **Portfolio Map** paints the first few **department sections** immediately, the rest load on scroll / "Show more."
- [ ] **Pipeline Board** columns: a column with many cards shows the true total in its header count but renders the first ~30 cards, with **"Show N more"** per column.
- [ ] Scrolling/filtering with 300 rows stays smooth (no long freeze).

---

## 4. Core workflow regression (still must work)

### 4.1 Auth
- [ ] Login with valid creds succeeds; wrong password is rejected with a clear message.
- [ ] Visiting any page while logged out redirects to `/login.html`.
- [ ] **Logout** ends the session; protected pages/APIs then return unauthorized.

### 4.2 Use-case intake
- [ ] Create a single use case via **Intake** → it appears in the portfolio.
- [ ] **Bulk upload:** download the CSV template (`/api/use-cases/template.csv`), fill a few rows (include `status` and `delivered_at` columns), upload → rows import; a completed row shows in the Delivered storyline.
- [ ] Validation: a malformed row / missing required field is reported, not silently dropped.

### 4.3 The 5 gates (pick 1–2 fresh cases and walk them end-to-end)
- [ ] **BXT** scores save and display.
- [ ] **Feasibility** composite + quadrant + risk tier compute and persist.
- [ ] **Advisory** tier + platform journey render.
- [ ] **Summary** ROI band (P10/P50/P90) computes; frameworks + governance show.
- [ ] **Verdict** (GO/CONDITIONAL/NO-GO) saves; the **Executive Brief** renders.

### 4.4 ⭐ Brief ↔ Summary ROI parity (round-10 regression M6 — verify explicitly)
This was a repeat defect. **Test with a NEWLY created case**, not just seeded ones:
- [ ] Create a new use case, run it through **Summary** (note the ROI **P50** and the dollar value shown on the Summary hero).
- [ ] Open the **Panel / Executive Brief** for the same case.
- [ ] ✅ **The Brief's ROI P50 and dollar value must EQUAL the Summary's** (not ~14% lower). If the Brief shows a smaller number than the Summary, that's a FAIL — reopen the M6 issue.
- [ ] Repeat for a case whose business-value score is high (e.g. 4–5) — that's where the old divergence appeared.

---

## 5. API smoke (optional — for technically-minded testers)
Log in first (browser session cookie). Then in the browser console or with the session cookie:
- [ ] `GET /api/portfolio` → returns the case list.
- [ ] `GET /api/portfolio?department=Finance&status=completed` → filtered subset.
- [ ] `GET /api/portfolio?limit=50&offset=0` → returns `{ rows, total, limit, offset }` (pagination shape).
- [ ] `GET /api/portfolio/facets` → returns counts per department/sponsor/stage/status.
- [ ] `GET /api/health` → `{ ok:true, db:true }`.

---

## 6. Cross-cutting checks
- [ ] **Responsive:** filter bar, compare table, and dashboard reflow cleanly at ~390px width.
- [ ] **Theme:** light/dark toggle (where present) doesn't break layout.
- [ ] **Empty states:** a brand-new/empty workspace shows friendly empty messaging, not errors.
- [ ] **No console errors:** open DevTools console during a full walkthrough — flag any red errors.
- [ ] **Back/refresh:** browser Back and page refresh preserve filters (URL-driven) and don't crash.

---

## 7. How to log a defect (please include)
1. Page/URL (copy the full URL — it carries the filter state).
2. Workspace selected + login used.
3. Steps to reproduce, expected vs. actual.
4. Screenshot + any DevTools **Console** / **Network** error (status code).
5. Browser + version, and screen width (desktop/mobile).

---

## 7b. Round-12 closures (fixed & verified)
- **DEF-13 (HIGH) — self-polluting taxonomy via bulk import (CLOSED):** the bulk-import path did **not** validate `department`, so junk values (e.g. `NotARealDept`) inserted, appeared in `/facets` (14→15), and the DEF-06 dynamic merge then leaked them into the intake authoring dropdown. Fix: introduced `departments.js` as the single source of truth for the canonical **14** departments; the bulk-import loop now runs each row's department through `resolveDepartment()` — canonical values pass through, unknown/blank **coerce to `null`** (excluded from facets). Junk can no longer become a facet or dropdown option. Verify: bulk-import a bad department → it is coerced (not surfaced); facets stay at **14**; intake dropdown stays **14**. Guarded cleanup for the pre-existing junk row lives in `scripts/cleanup-round12.sql` (run manually against v2; aborts unless exactly one `66fceda0…`/`NotARealDept` row matches). Tests: `bulk-upload-departments.test.js` 6/6, `intake-dept.test.js` 33/33.
- **DEF-12 (LOW) — portfolio row-count label stale after Show-more (CLOSED):** the shared `assets/lazy-list.js` `updateStatus()` had a collapse branch that read `307 use case` on full expansion and never pluralised. Fix: always emit `showing N of M <noun>` (N tracks the rendered count) and pluralise on the total (singular only when count===1). Now: `showing 50 of 307 use case` → after expand `showing 307 of 307 use cases`; single item → `showing 1 of 1 use case`. Positive side effect: kanban (`card`) and portfolio-map (`department`) labels pluralise consistently too. Test: `lazy-list.test.js` 24/24.
- **DEF-03 (reduced, LOW) — Compare selection-pill overflow, defence-in-depth (CLOSED):** added a CSS clamp to the `.selpill` container itself (`max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap`) so long text reaching the pill unwrapped can never blow out the selected-pills row. Belt-and-suspenders on top of the round-11 `.selpill__name` clamp + 200-char ingest clip. Test: `compare.test.js` 113/113.

---

## 8. Known / by-design (not defects)
- The demo login (`sandboxuser`) and demo data are shared — multiple testers may see each other's edits in the same workspace. For isolated testing, create your own workspace via **Setup**.
- Radar **Score Breakdown** intentionally caps at **4** charts; the full comparison is always in the table below.
- AI narrative features run in **scripted** mode on the demo (no live Gemini) — deliberation text is deterministic, which is expected.
- A fresh workspace starts empty until you add or bulk-upload use cases.
- **API response shape (DEF-09):** `GET /api/portfolio` with **no** query params returns a bare JSON **array** (unchanged for backward compatibility). When you pass `limit`/`offset`/filter params it returns an **envelope** `{ rows, total, limit, offset }`. Two shapes by design — not a defect. Clients should branch on `Array.isArray(resp) ? resp : resp.rows`.
- **ROI magnitude basis (model UNCHANGED for v2 — per client decision):** The ROI Monte-Carlo model is **intentionally left as-is for this release**; no v2 change was made to how ROI is calculated. ROI percentages are computed on a **build-cost basis** — the denominator is the **implementation / build cost** (`Adopt ≈ $120K`, `Extend ≈ $380K`, `Build ≈ $950K`) and does **not** include ongoing run / licence / opex. Formula: `ROI% = (cumulative benefit − total cost) / total cost × 100`. Because a high-value case can pair with a low build cost, percentages can be **very large — e.g. a `>$5M`-value case on an `Adopt` build ≈ +19,000%+** — and this is **expected by design, not a calculation bug**. Interpret every ROI figure as *return relative to build investment*. A future change to a total-cost-of-ownership (run-inclusive) basis would require finance sign-off and is out of scope for v2.
- **Testing note:** Do **not** file large ROI percentages as defects. The only ROI regression to guard is **Brief ↔ Summary parity** (see §4.4) — the *magnitude* is by design; only a *mismatch between pages* for the same case is a defect.

---

### Quick reference — the v2 acceptance highlights
| Feature | Pass criteria |
|---|---|
| Filter bar | Filters + facet counts + URL persistence + cross-page carry |
| 2026 Delivered | Shows for completed cases; count/avg/by-dept correct; hidden when none |
| Compare presets | Top ROI / GO-only / by-dept / Clear all work |
| Compare table/radars | Table unlimited; radars capped at 4 with note; long names truncate |
| Scale | 300 rows load via "Show more"/lazy; smooth; all rows reachable |
| M6 parity | Brief ROI P50 == Summary ROI P50 for NEW cases |
