# Shared Filter Bar — build spec (task v2-filters)

## Goal
A single reusable filter bar shared across **dashboard.html**, **portfolio-map.html**, **kanban.html**.
Filters: **Department**, **Exec Sponsor**, **Stage/Status**, and a **search** box.
State is **URL-persisted** (query string) so a filtered view is shareable/reloadable.
Option **counts come from `/api/portfolio/facets`**.

## Backend already done (do NOT change server.js)
`/api/portfolio` accepts query params: `workspace_id`, `department`, `sponsor`, `stage`, `status`, `q`,
plus optional `limit`/`offset`. With no params it returns the full array (back-compat).
`/api/portfolio/facets` accepts the same filter params and returns:
```
{ department:[{value,count}], sponsor:[{value,count}], stage:[{value,count}], status:[{value,count}], total }
```
Facets reflect the CURRENT filter set (counts update as you narrow).

## Codebase conventions (MUST follow)
- ES5 / `var`, IIFE, no build step. Match existing style exactly.
- Additive global module pattern like `assets/api-client.js` / `assets/deep-link.js`:
  expose `window.GAIC_FILTERS`. Never throw to the page.
- Each view has: an `apiFetch(path)` helper (prepends `/api`, 401 -> `/login.html`),
  a `loadPortfolio(wsId)` fn, a `render(rows)` fn, an `el` refs object, and a BOOT block
  that calls `loadWorkspaces().then(... loadPortfolio(wsId).then(render))`.
- Tests use jsdom + a test hook (`window.__PFMAP_TEST_ROWS`, etc.) that renders injected
  rows and RETURNS before any network. The filter bar must not break that path.

## Module API: window.GAIC_FILTERS (assets/filter-bar.js)
```
GAIC_FILTERS.readURL()            -> { department, sponsor, stage, status, q }  (missing -> '')
GAIC_FILTERS.writeURL(state)      -> replaceState so back button isn't spammed; only sets non-empty keys
GAIC_FILTERS.toQuery(state, wsId) -> "?workspace_id=..&department=..&q=.." (skips empty; encodeURIComponent)
GAIC_FILTERS.mount(opts)          -> renders the bar. opts = { el, apiFetch, wsId, onChange, initial }
    - fetches /api/portfolio/facets (with current state+wsId) to populate selects with "Value (count)"
    - search input is debounced ~250ms
    - a "Clear" button resets all filters
    - on ANY change: writeURL(state) + onChange(state)  (view re-queries + re-renders)
GAIC_FILTERS.refreshFacets(wsId)  -> re-pull counts after wsId change
```
Selects: Department, Exec Sponsor, Stage, Status = native <select> (option label "Marketing (12)").
Search: <input type="search" placeholder="Search use cases…">. Keep markup minimal + themable
(reuse existing CSS vars; add a small scoped <style> block or classes the views already have).

## Per-view wiring (3 files)
1. Add `<script src="assets/filter-bar.js"></script>` AFTER api-client.js, BEFORE the page IIFE.
2. Add a mount point `<div id="filterBar" class="filterbar"></div>` just above `#loading`/content.
3. In the page IIFE:
   - add `el.filterBar = document.getElementById('filterBar')`.
   - change `loadPortfolio(wsId)` to append `GAIC_FILTERS.toQuery(state, wsId)` instead of only wsId.
     Keep the offline `GAIC_API.listPortfolio` fallback. Keep 401 handling.
   - In BOOT (after wsId resolved, before/with first load): call
     `GAIC_FILTERS.mount({ el: el.filterBar, apiFetch: apiFetch, wsId: wsId, initial: GAIC_FILTERS.readURL(), onChange: function(state){ /* reload+render */ } })`.
   - When workspace changes (selectAndLoad), call GAIC_FILTERS.refreshFacets(newWsId) too.
   - Guard: if `window.__*_TEST_ROWS` hook is present, skip mount (return happens before network anyway).
   - Guard: `if (!window.GAIC_FILTERS) { /* old behavior */ }` so the page still works if the script 404s.

## Tests (add assets or *.test.js)
- Unit test the pure helpers in jsdom: readURL/writeURL/toQuery (skips empty, encodes, round-trips).
- A DOM test: mount() with a fake apiFetch returning canned facets renders 4 selects + search + Clear,
  and that changing a select calls onChange with the new state and updates the URL.
- Run the FULL existing suite (`npm test`) — dashboard/portfolio-map/kanban tests must still pass
  (the test-hook render path must be untouched).

## Acceptance
- All 3 views show an identical filter bar; selecting Department=X (and/or sponsor/stage/status/search)
  re-queries /api/portfolio and re-renders; the URL reflects the filters; reloading the URL restores them.
- Counts in option labels come from /facets and update as filters narrow.
- `npm test` green (existing + new). `node -c` on any changed JS clean.
