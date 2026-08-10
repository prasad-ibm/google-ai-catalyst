# Test Guide — Bulk Template: `status` + `delivered_at` (Completed Use Cases)

**Release:** v2 lifecycle — step 1 (bulk template columns)
**What changed:** the bulk-upload template now has **two new columns** so use cases can be imported as **completed / delivered**, not just active pipeline items.

| New column | Values | Meaning |
|---|---|---|
| `status` | `active` (default) or `completed` | `completed` = delivered/live; anything blank/unknown → `active` |
| `delivered_at` | `YYYY-MM-DD` (or blank) | Go-live / delivery date; only meaningful when `status=completed` |

> The template now has **33 columns** (was 31) and ships **6 example rows** — the 5 Intel examples (active) **plus one DELIVERED example** (`Automated Invoice Matching (DELIVERED EXAMPLE)`, `status=completed`, `delivered_at=2026-03-15`) so the format is self-documenting.

---

## Pre-req
- Deploy the new build (`railway up`).
- The schema auto-migrates on boot: watch the deploy log for `Data schema ready (schema.sql applied).` — that line means the `status` + `delivered_at` columns + indexes were added (idempotent; safe on the existing 130 rows).
- Log in at the live URL (**anonymous requests return the 6.7 KB login page — always test logged in**).

---

## Test 1 — The downloaded template has the new columns
1. Dashboard → **Download template CSV**.
2. Open it. **Expect:** header row ends with `…,stage,status,delivered_at` (33 columns total).
3. **Expect:** a row named `Automated Invoice Matching (DELIVERED EXAMPLE)` with `status=completed` and `delivered_at=2026-03-15`.

✅ Pass = both present.

---

## Test 2 — Import an ACTIVE use case (unchanged behavior / regression)
1. In the template, add a row: `name=QA Active Test`, `department=IT`, leave `status` **blank**.
2. Dashboard → **Bulk upload** → pick workspace → upload.
3. **Expect:** row inserts (✓), and the case appears in the **active pipeline** (Pipeline Board / not marked delivered).

✅ Pass = imported as active (blank status defaults to active).

---

## Test 3 — Import a COMPLETED use case (the new capability)
1. Add a row: `name=QA Delivered Test`, `department=Finance`, `executive_sponsor=CFO`, `status=completed`, `delivered_at=2026-02-01`. Leave `stage` **blank**.
2. Bulk upload it.
3. **Expect:**
   - Row inserts (✓).
   - Its **stage auto-defaults to `panel`** (fully progressed) because it's completed and stage was blank.
   - `/api/portfolio` returns it with `status:"completed"` and `delivered_at:"2026-02-01"`.

**Quick API check (logged in, browser console or authenticated curl):**
```
GET /api/portfolio
```
Find `QA Delivered Test` → confirm `"status":"completed"`, `"delivered_at":"2026-02-01"`, `"executive_sponsor":"CFO"`.

✅ Pass = stored as completed with the delivery date + sponsor exposed.

---

## Test 4 — Bad / edge inputs don't break the row
| Input | Expected |
|---|---|
| `status=Delivered` (capitalized) | normalized → `completed` |
| `status=done` | normalized → `completed` |
| `status=foobar` | falls back → `active` |
| `delivered_at=not-a-date` | imports with `delivered_at=null` (row NOT rejected) |
| `delivered_at` blank on a completed row | imports; delivered date just empty |

✅ Pass = no row is rejected solely due to status/date; values normalize as above.

---

## Test 5 — The +60 completed cases (client's real scenario)
1. Fill the template with the 60 delivered cases: set `status=completed` and a real `delivered_at` for each. (Only `name` is strictly required; `department` + `executive_sponsor` recommended for the exec story.)
2. Bulk upload (500-row cap — 60 is fine).
3. **Expect:** all 60 insert; each returns `status:"completed"` from `/api/portfolio`.

✅ Pass = 60 completed rows land, distinct from the 130 active.

---

## What is NOT in this step (coming in the next rollout)
Per the plan, this step only adds the **import columns + storage + API exposure**. The following are the **next** v2 phases (still gated on sign-off) and are **not** expected to work yet:
- A **"2026 Delivered" storyline** section / KPIs on the Dashboard.
- **Department / Executive Sponsor filters** on Dashboard / Portfolio Map / Pipeline Board.
- **Compare** expansion beyond 4.
- Server-side **pagination** for 130–500+ rows.

So after import, completed cases are **stored and returned by the API** (verifiable via Test 3), but the dedicated exec-facing "delivered" views come next.

---

## Regression checklist (should still pass)
- [ ] Existing active bulk import works (Test 2)
- [ ] Template downloads (33 cols, 6 examples)
- [ ] Dashboard / Compare / Panel unaffected (spot-check one use case end-to-end)
- [ ] `.env` / secrets not exposed
