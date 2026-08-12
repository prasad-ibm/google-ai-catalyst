# Google AI Catalyst — v2 "Scale" Release: Verification Record & Staging Smoke Checklist

_Last updated: 2026-08-09. Status: **code complete + verified by automated/DOM coverage.**
Live 300-row smoke intentionally deferred to your staging deploy (option 4)._

---

## 1. Automated test evidence (all green)

| Suite | Result | Covers |
|---|---|---|
| `portfolio-filter.test.js` | **12/12** | `/api/portfolio` server-side filter + pagination + back-compat |
| `filter-bar.test.js` | **27/27** | `GAIC_FILTERS` URL round-trip, `toQuery`, mount, onChange, Clear |
| `compare.test.js` | **106/106** | picker, presets (Top ROI / GO-only / by-dept), unlimited table, 4 pinned radars, long-name truncation |
| `delivered-storyline.test.js` | **23/23** | "2026 Delivered" KPIs + by-dept bars, hidden until a case ships |
| `cross-page-consistency.test.js` | **13/13** | dashboard KPI semantics consistent with portfolio map |
| `lazy-list.test.js` | **21/21** | chunked render, show-more, setItems reset, setRenderItem |
| `m6-parity.test.js` | **11/11** | Brief P50 === Summary P50 (numeric, incl. new-case regression guard) |
| `panel.test.js` | **123/123** | Executive Brief (no regression from M6 fix) |
| `summary.test.js` | **73/73** | Summary hero (no regression from M6 fix) |
| `portfolio-map.test.js` | **61/61** | grouped map + lazy dept sections |
| `kanban.test.js` | **47/47** | pipeline board + per-column lazy cards |

**Total: 523 assertions passing, 0 failing** across the affected surface.

### Sandbox note on running tests
- Run suites **individually** (e.g. `node compare.test.js`), not `npm test` — DB-backed suites
  (`server.test.js`, `deep-link-integration`) hang here because there is no local Postgres.
- jsdom cold-start is ~40-90s per suite in the sandbox; a "hang" is usually just boot. Each test
  file calls `process.exit()`.

---

## 2. DOM render smokes (beyond assertions — verified actual rendered output)

- **Compare**: Top ROI preset → 5 cols / 11 attribute rows, radars capped at "first 4 of 5" with
  the overflow note; GO-only → 4 cols, note hidden. 5000-char name contained (no horizontal blowout).
- **Delivered storyline**: 4 completed rows → count=4, avg realized +292%, 3 dept bars scaled to max;
  `in_progress` case correctly excluded; main KPI row intact.
- **Lazy lists**: dashboard table + ROI list render first 50 of 130, "Show 50 more (80 remaining)",
  load-all → 130; re-render with 20 rows resets cleanly (no stale nodes, scale re-applied).
- **Portfolio map**: 15 departments → 4 sections initial (as direct `<section>` children — layout
  preserved), load-all → 15.
- **Kanban**: 150-card column → header shows true 150, renders 30 initially, load-all → 150;
  20-card column renders all with no button.

---

## 3. Staging smoke checklist (run once after deploy, ~15 min)

Prereq: deploy v2 build; confirm `/api/portfolio/facets` returns 200 when authed.

**A. Data layer**
- [ ] `GET /api/portfolio` (no params) returns the full array (back-compat).
- [ ] `GET /api/portfolio?limit=25&offset=0` returns `{rows,total,limit,offset}` with `rows.length<=25`.
- [ ] `GET /api/portfolio?department=<one>&status=completed` returns only matching rows.
- [ ] `GET /api/portfolio/facets` counts match the filter dropdown counts in the UI.

**B. Filter bar (Dashboard, Portfolio Map, Pipeline Board)**
- [ ] Selecting a Department narrows all three views; the URL gains `?department=...`.
- [ ] Reloading the URL restores the filter state; counts in the dropdowns are correct.
- [ ] Search box filters by name; Clear resets filters + URL.
- [ ] Switching workspace refreshes facet counts.

**C. Compare**
- [ ] Search finds a case by name/department; clicking adds a removable pill.
- [ ] "Top ROI" selects the highest-ROI cases; table shows ALL selected; radars show only first 4
      with the "first N of M" note.
- [ ] "GO-only" and a "By department" pick populate correctly.
- [ ] A very long use-case name does NOT break the table layout (stays clipped/bounded).

**D. 2026 Delivered storyline (Dashboard)**
- [ ] Mark/seed at least one case `status=completed` (with `delivered_at`).
- [ ] "2026 Delivered" section appears with Delivered count, Avg realized P50, dept bars.
- [ ] With zero completed cases, the section is hidden.

**E. Render scale (needs ~150+ rows in one workspace)**
- [ ] Dashboard portfolio table + ROI list show ~50 then "Show more"; scrolling auto-loads.
- [ ] A large Kanban column shows the true count in its header but renders in chunks.
- [ ] Page stays responsive (no multi-second freeze) at ~300 rows.

**F. Brief ↔ Summary parity (M6 — do this on a NEWLY created case)**
- [ ] Create a brand-new use case, run it through the Summary (note the hero ROI P50 + the $ benefit).
- [ ] Open its Executive Brief — the ROI P50 band and the benefit $ MUST match the Summary
      (this was the $4.2M-vs-$3.6M bug; it must now agree).

---

## 4. One-time data hygiene (already delivered, run once in prod if not done)
- `scripts/normalize-dept-sponsor.sql` — normalizes the live ~130 rows
  (Operations → Data Center Group, COO → ET-DCG). Idempotent.

## 5. QA cleanup note (from round-10 report)
If you seeded any temporary QA rows for the long-name / parity checks, delete them by the tag/name
you used. No test fixtures are written to the DB by the automated suites (they run entirely in jsdom
with stubbed `fetch`).
