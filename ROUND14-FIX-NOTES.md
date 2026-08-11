# AI Catalyst v2 — Round-14 Fix Notes (for the Test Team)

**Build:** round-14 · **Ref:** QA Report Round 14 (md + html) · **Scope:** the 2 new medium defects only (cosmetics + data-model normalization deferred by decision)

Round 14 was the cleanest round yet: every prior fix (DEF-13, DEF-03, DELETE, DEF-12, and R12-N1/N2/N4/N5) verified holding with no regressions, and the highest-risk interaction — R13 department coercion sharing the PUT code path with the R12-N4 blob-preservation — was explicitly tested and **holds**. This build fixes the two genuinely new items.

---

## R14-N2 (MED) — Malformed UUID → 500 + raw Postgres leak — ✅ FIXED

**Was:** `GET`/`PUT`/`DELETE` on `/api/use-cases/not-a-uuid` returned **500** with the raw driver message `{"error":"invalid input syntax for type uuid: \"not-a-uuid\""}` — wrong status class (client error reported as server fault → pollutes alerting) and internal disclosure of the DB type system.

**Fix:** added a shared `isValidUuid(id)` helper (RFC-4122-ish regex, also rejects non-strings) and guarded **every** `:id` route so a malformed id returns **`400 {error:'invalid use case id'}` before any DB query**. A well-formed-but-unknown UUID still returns the proper **404**.

**Routes guarded (8):** `GET /:id`, `PUT /:id`, `DELETE /:id`, and the **5** sub-resource PUTs `/:id/bxt`, `/:id/feasibility`, `/:id/advisory`, `/:id/summary`, `/:id/verdict`. (The report said "4 sub-resource PUTs" — there are actually 5; `/verdict` is included.)

**How to re-test:**
1. `GET /api/use-cases/not-a-uuid` → **400** `{"error":"invalid use case id"}` (no `invalid input syntax` string anywhere).
2. Same for `PUT` and `DELETE` on `not-a-uuid`, and for each sub-resource PUT (e.g. `PUT /api/use-cases/not-a-uuid/bxt`).
3. A real UUID that doesn't exist → still **404** `use case not found`.
4. A valid existing id → unchanged behaviour.

---

## R14-N3 (MED) — Bulk import silently nulled departments under a success banner — ✅ FIXED

**Was:** importing the template returned `inserted:3, failed:0` while 2 rows lost their department (coerced to `null`). Coercion-to-null is correct for security, but it was invisible — this is the mechanism that produced the 11 orphaned "Unassigned" records.

**Fix:** coercion behaviour is **unchanged**; it is now **surfaced**. The bulk loop captures the raw submitted department *before* `resolveDepartment()` and, when a non-empty value is coerced or remapped, attaches a per-row `warnings` array. A new top-level `coerced` count is also returned.

**Response shape:**
```jsonc
{
  "inserted": 3,
  "failed": 0,
  "coerced": 2,
  "results": [
    { "row": 0, "ok": true, "id": "...", "name": "...",
      "warnings": ["department \"Assets Maintenance\" not canonical → null"] },
    { "row": 1, "ok": true, "id": "...", "name": "..." },          // no warnings key = clean
    { "row": 2, "ok": true, "id": "...", "name": "...",
      "warnings": ["department \"hr\" normalized → \"Human Resources\""] }
  ]
}
```
- Non-canonical → dropped:  `department "<raw>" not canonical → null`
- Alias / case / whitespace remap: `department "<raw>" normalized → "<canonical>"`
- Blank / absent department → **no** warning (a legitimate null).

**How to re-test:** bulk-import a batch mixing a junk dept (`Assets Maintenance`), an alias (`hr`), a canonical value (`Finance`), and a blank. Expect: all `ok:true`; `coerced:2`; row-0 warns "not canonical → null"; alias row warns "normalized → Human Resources"; canonical + blank rows carry **no** `warnings` key.

---

## CSV template — already canonical (no fix needed, please re-test the SHIPPED template)

The report imported the **original** template's three non-canonical departments. The **currently shipped** template (`use-case-template.js` → `TEMPLATE_ROWS`, fixed in round-12) already uses canonical values only: **HR** (aliases → Human Resources), **Procurement, Supply Chain, Manufacturing, Quality, Finance** — no `Assets Maintenance` / `Manufacturing / Quality`. Downloading and importing the shipped `GET /api/use-cases/template.csv` verbatim imports every row with its department intact. Please re-test against the shipped template rather than the archived original.

Also confirmed by the report itself: the "23 headers won't bind / rich content lost" critique is **WRONG** — all terse aliases bind and auto-nest into the four JSON blobs. No change needed.

---

## Confirmed holding (verified by R14, no action)
DEF-13 (API dept coercion, all 6 injection cases) · DEF-03 (kanban 2-line clamp) · DELETE (live, idempotent soft-delete) · DEF-12 (count label + plural) · DEF-01/06/07/08 · R12-N1 (stale "Show more" gone) · R12-N2 (`?limit` honoured) · R12-N4 (partial PUT preserves blobs — re-verified 5/5/5/8 intact) · R12-N5 (archived excluded from portfolio) · dual-shape API · theme persistence · gates coherence · no console errors.

## Deferred by decision (not in this build)
- **Cosmetic:** kanban `text-overflow: clip` → `ellipsis` (visible "…" marker); archived resources return `200` on GET-by-id rather than `404/410` (our soft-delete is intentional).
- **Secondary (data-model):** normalize `pii`/`audit` to real booleans; split `value`/`spend`/`volume` into numeric + label columns. Larger ingest/schema change — its own round if ROI math is planned.
- **Data (not code):** the 11 `department: null` "Unassigned" records; legacy `ZZ-QA-%` scratch rows — cleanup descoped per Prasad (can be done via the live DELETE API).

---

## Test coverage this round
`node --test uuid-guard.test.js bulk-import-warnings.test.js` → **tests 20 · pass 20 · fail 0**.
- `uuid-guard.test.js` (12): validator unit checks + all 8 routes return 400 with no DB query on a malformed id + valid-id passthrough.
- `bulk-import-warnings.test.js` (8): null-coercion warning, alias/case normalization warning, clean row has no `warnings` key, blank = no warning, `dept` alias column, `coerced` count, and unchanged INSERT binding (department still stored as the coerced value).

`node -c server.js` → parses clean.
