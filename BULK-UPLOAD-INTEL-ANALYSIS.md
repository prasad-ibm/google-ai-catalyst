# Intel Bulk Upload — "imports OK but data doesn't show up"

**Analysis of:** `use-cases-template - Intel Bulk Upload AI use cases Aug 10.csv` (135 data rows)
**Method:** parsed the real file bytes through the *actual* importer parser (`assets/bulk-upload.js parseCsv`) and traced the server insert + list/portfolio read paths in `server.js`. Every number below is measured, not estimated.

---

## TL;DR — the test team's verdict is directionally right but wrong on the mechanics, and it misses the actual "doesn't show up" cause

| Test-team claim | Reality (measured) |
|---|---|
| File is Latin-1/1252; em-dashes import as `â€"` | **Mixed encoding.** The file is *mostly* valid UTF-8 (101 proper `–` = `e2 80 93`) **plus** stray raw Windows-1252 bytes (`0xa0`×13, `0x92`×28, `0x97`×15…). Under the UI's UTF-8 `readAsText`, those bad bytes become **`�` (U+FFFD)**, not `â€"`. **21 of 135 rows** get a `�`. `â€"` only appears if you force a Windows-1252 read of the good UTF-8 dashes. Either single decode is lossy because the file itself is inconsistent. |
| 25 rows lose department → null | **43 rows** coerce to null. Real Intel org units not in the canonical 14: **Data Center Group (18), Client Computing (14), Foundry (11)**. HR (14) aliases fine. |
| workspace_id blank in all 135 → per-row failure | **Correct that all 135 are blank, but harmless via the UI.** The importer UI POSTs `{ workspace_id: <dropdown>, rows }` — the server uses the batch/dropdown workspace as the per-row fallback (`server.js:568`). The blank CSV column is ignored. It's only fatal on a **raw CSV-body POST** (no dropdown). |
| Booleans/types inconsistent (pii, audit, realtime) | Confirmed cosmetic — stored as free-text; no ROI math consumes them today. |

### Structure is FINE
Through the real RFC-4180 parser: **135 rows, 0 blank names, exactly 10 clean department values, no column desync.** All 135 **will insert** (`inserted:135, failed:0`). So "imports with no errors" is true.

---

## 🎯 THE ACTUAL "DATA DOESN'T SHOW UP" ROOT CAUSE (missed by the report)

It is **not** the encoding or the departments — those degrade data, they don't hide it. Two things make inserted rows invisible:

### A. Workspace scoping (most likely) — `server.js:653`
`GET /api/use-cases` filters `WHERE workspace_id = ?` **only when a `?workspace_id=` is supplied**. Every dashboard/portfolio view is scoped to the **currently-selected workspace**. If the rows were imported into workspace *X* but you're viewing workspace *Y* (or the default), **they're invisible even though they inserted perfectly.** This is the #1 suspect for "uploaded fine, can't see it."
→ **Check:** which workspace was selected in the bulk-upload dropdown vs. which workspace the portfolio/dashboard is showing.

### B. Stage routing — measured: **14 rows `stage:panel`, 1 row `status:completed`+`delivered_at`**
- 14 rows arrive **mid-pipeline at `panel`**, skipping intake — they won't appear in any "new intake" view.
- The 1 `completed` row auto-defaults `stage:panel` (`server.js:455`) and lands in the delivered/panel bucket.
- The remaining 121 land at `intake`.
So rows scatter across pipeline stages; a view filtered to one stage shows only its slice.

### C. (Not a factor here) archived filter
No imported row is `archived`, so the R12-N5 archived-exclusion is **not** hiding these.

---

## Recommended fixes (ranked)

### 1. 🔴 Confirm the workspace — likely a *usage* fix, not a code bug
Verify the upload's target workspace matches the view. If they differ, re-point the view (or re-upload to the right workspace). **This most likely explains the whole symptom.** No code change needed — but see #4 for a guardrail.

### 2. 🟠 Encoding — accept Windows-1252 / repair mixed bytes on ingest *(code fix)*
The UI reads UTF-8 only, so mixed/1252 files mojibake. Two options:
- **Quick (user-side):** re-save from Excel as **"CSV UTF-8 (Comma delimited)"** before upload. Fixes it for this file today.
- **Robust (code):** make the importer encoding-tolerant — detect a BOM / invalid-UTF-8 and fall back to a Windows-1252 decode (or run a mojibake-repair pass) before parsing. This stops every future Excel export from degrading. Recommended as a real fix.

### 3. 🟠 Departments — extend the allowlist OR remap *(decision needed)*
43 rows drop their department. Intel uses **Data Center Group, Client Computing, Foundry** (and others). Either:
- **Add** these to the canonical department list (`departments.js`) so they're first-class, **or**
- **Remap** to the nearest canonical (Foundry/Client Computing → Manufacturing or R&D; Data Center Group → IT/Operations).
The R14-N3 warnings already report each coercion in the bulk response — so this is visible, just needs a product decision on the vocabulary. **This is a data/config decision, not a bug.**

### 4. 🟡 Guardrail — surface encoding + coercion + target-workspace in the UI summary *(small code fix)*
After upload, the modal shows `inserted/failed` but buries the R14-N3 warnings. Add a visible roll-up: *"135 imported into workspace **Intel-Q3** · ⚠ 21 rows had unreadable characters · ⚠ 43 rows had a non-standard department (dropped)."* This would have made the workspace + degradation obvious immediately.

### 5. ⚪ Cosmetic (defer): normalize pii/audit booleans, split value/spend/volume numeric, clear the 14 pre-set `stage:panel` / 1 `completed` columns if unintended.

---

## What I did NOT find (ruling things out)
- ❌ No phantom/garbage rows — the RFC-4180 parser handles quoted newlines correctly (135 clean rows).
- ❌ No blank-name failures (0 rows would hard-fail on `name`).
- ❌ No archived rows hiding data.
- ❌ workspace_id blankness is **not** breaking the UI path.

## One-line answer for the user
> The rows **did** import — but they're almost certainly in a **different workspace than the one you're viewing** (the list is workspace-scoped), and 14 landed at `stage:panel` instead of intake. Separately, the file's **mixed UTF-8/Windows-1252 encoding** put `�` in 21 rows and **43 rows lost a non-canonical department** (Data Center Group / Client Computing / Foundry). Fix visibility first (workspace), then re-save as CSV-UTF-8 and decide the department vocabulary.
