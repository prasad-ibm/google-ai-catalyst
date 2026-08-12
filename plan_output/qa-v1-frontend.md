# QA v1 — Frontend Bug Fixes (Google AI Catalyst)

Independent QA remediation of 4 frontend bugs + hardening on the live-reskin static site under `/workspace/google-ai-catalyst/`. All changes are defensive and non-destructive (no scoring, no demo-fallback removed).

---

## BUG-2 / BUG-6 — Hardcoded org name in workspace chip (HIGHEST PRIORITY)

**Problem:** Three pages hardcoded the org as *"Acme Financial Services"* in the workspace chip, while BXT / Advisory / Panel correctly show the real workspace (**Intel**).

**Fix:** Replaced the hardcoded `<b>Acme Financial Services</b>` with a dynamic `<b id="wsName">Intel</b>` on all three pages, and added a small defensive resolver that runs on load, resolves the REAL workspace name, and sets `#wsName.textContent`. Falls back to **`Intel`** (never `Acme`) when unresolved/offline.

**Resolver logic (identical, defensive on all 3 pages):**
1. Guard for missing `#wsName` element → no-op.
2. If `localStorage 'gaic_workspace_name'` is cached → use it, done.
3. Else if `localStorage 'gaic_workspace_id'` is cached → leave the `Intel` default (avoids a redundant `listWorkspaces()` round-trip — this also preserves the `intake-submit.test.js` assertion that `listWorkspaces` is NOT called when an id is cached).
4. Else if `window.GAIC_API.listWorkspaces` exists → call it, pick the Intel workspace via an `/intel/i` name match (`_findIntel`-style), fall back to the first workspace, set `#wsName` and cache both `gaic_workspace_name` + `gaic_workspace_id`.
5. All wrapped in `try/catch` + `.catch()` for offline safety.

**Files / lines changed:**
| File | Line | Change |
|------|------|--------|
| `intake.html` | ~310 | `<b>Acme Financial Services</b>` → `<b id="wsName">Intel</b>` |
| `intake.html` | init block (~1150) | Added `resolveWorkspaceName()` IIFE |
| `feasibility.html` | 279 | `<b>Acme Financial Services</b>` → `<b id="wsName">Intel</b>` |
| `feasibility.html` | before `window.__feas` expose | Added `resolveWorkspaceName()` IIFE |
| `summary.html` | 254 | `<b>Acme Financial Services</b>` → `<b id="wsName">Intel</b>` |
| `summary.html` | before test-expose | Added `resolveWorkspaceName()` IIFE |

**Scan of ALL `*.html` for other `Acme Financial Services`:** none beyond the 3 above.
- `setup.html:297` placeholder `e.g. Acme Corporation` — **left as-is** (example placeholder, not displayed data).
- `panel.html:443` code COMMENT — **left as-is** per instruction.
- `bxt.html:249`, `advisory.html:286`, `panel.html:292` already show `<b>Intel</b>` correctly — unchanged.

---

## BUG-3 — Email format not validated in wizard step-advance (`intake.html`)

**Problem:** `#f_email` is `type="email"` but the wizard's custom Next-step validation (`validateRequired`) only checked required name/description, so an invalid email advanced the step.

**Fix (in `intake.html`):**
- Added a standard email regex `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
- Added `emailValid()` — returns `true` when the field is **empty** (optional) OR matches the regex.
- Added `showEmailError(show)` — toggles `is-invalid` on `#f_email` and `is-shown` on a new inline error `#err_email`, consistent with the existing required-field error mechanism (`showFieldError`).
- Extended `validateRequired(reveal)`: now also blocks advancing when the email is non-empty and malformed, reveals the inline error + red border, and focuses `#f_email` (only when no required field is missing, so required errors take precedence).
- Added markup: `<div class="field__err" id="err_email">Enter a valid email address.</div>` after the email input.

**Empty email still advances** (optional field) — verified by existing `intake.test.js` required-field tests (they never set `f_email`, so email validation is skipped).

**Files changed:** `intake.html` (email `err_email` div; `EMAIL_RE`, `emailValid`, `showEmailError`, extended `validateRequired`).

---

## BUG-4 — Demo-data fallback not labeled (LOW priority, done last, minimal)

**Problem:** On gate pages, when there is no real intake data and no `?id=`, the page falls back to a hardcoded demo use case (e.g. *"Automated invoice reconciliation (demo)"*) with no clear label, so users could mistake demo data for real data.

**Fix:** Added a small non-destructive banner at the top of the content on all 5 gate pages, shown ONLY when the existing `fromDemo` flag is true (reusing each page's own demo detection — no scoring or fallback logic changed):

> ⚠️ Demo data — this is a sample use case. **Start a real use case from Intake →** (links to `intake.html`)

The banner is a hidden `<div id="demoBanner" style="display:none;...">`; each page's render path toggles `display:block` when `fromDemo`.

**Files / hooks changed:**
| File | Demo flag used | Toggle location |
|------|----------------|-----------------|
| `bxt.html` | `loaded.fromDemo` | `render()` |
| `feasibility.html` | `loaded.intake.fromDemo` | `boot()` (also keeps existing `(demo)` suffix on `wsEval`) |
| `advisory.html` | `intake.fromDemo` | `renderAll()` |
| `summary.html` | `loadIntake().fromDemo` (when not deep-linked) | `boot(opts)` |
| `panel.html` | `summary.fromDemo && intake.fromDemo` | `run()` |

`wsEval` textContent (asserted by `summary.test.js`) was NOT touched — the demo label lives entirely in the separate `#demoBanner`.

---

## HARDENING (info) — quick wins

**(a) Textarea maxlength (`intake.html`):** Added `maxlength="4000"` to all 5 large intake textareas: `#f_desc`, `#f_justif`, `#f_pain`, `#f_technotes`, `#f_addnotes`.

**(b) aria-label on icon-only buttons (`index.html`):** Audited all icon-only controls — **already labeled**, no change needed:
- Gear / onboard link → `aria-label="Onboard New Organisation"` ✓
- Theme toggle → `aria-label="Toggle theme"` ✓
- Carousel prev / next arrows → `aria-label="Previous"` / `"Next"` ✓
- Carousel dots → `aria-label` set dynamically in JS ✓
- No unlabeled "bulk upload" icon button exists on `index.html`.

---

## Test Results (RESULT lines)

Run with `node <suite>.test.js`. Note: jsdom loads slowly in this environment (~15–20 s per suite due to `cssstyle` cold-load), so suites were run in parallel to files — all completed.

| Suite | RESULT |
|-------|--------|
| `intake.test.js` | **58 passed, 0 failed** ✅ |
| `intake-submit.test.js` | **18 passed, 0 failed** ✅ |
| `summary.test.js` | **73 passed, 0 failed** ✅ |
| `feasibility.test.js` | **99 passed, 0 failed** ✅ |
| `advisory.test.js` | **109 passed, 0 failed** ✅ |
| `panel.test.js` | **123 passed, 0 failed** ✅ |
| `bxt.test.js` | **105 passed, 1 failed** ⚠️ (pre-existing — see below) |
| `cross-page-consistency.test.js` | **13 passed, 0 failed** ✅ |

**Totals: 598 passed, 1 failed.**

### ⚠️ The single `bxt.test.js` failure is PRE-EXISTING and NOT caused by this QA work

- Failing assertion (`bxt.test.js:242`): `intake submit sets window.location to bxt.html` — a regex check that `intake.html` source contains `window.location.href = 'bxt.html'`.
- At **HEAD**, `intake.html` had `function _go(){ ...; window.location.href = 'bxt.html'; }` → test passed.
- The **prior uncommitted H3 fix** (the workspace-resolution refactor referenced in the task brief) rewrote this into `_go(id)` that navigates to `feasibility.html?id=…` dynamically — this is what breaks the stale regex.
- Confirmed via `git diff HEAD`: the `_go` navigation change is part of the pre-existing uncommitted work, **not** in any of my edits (my `intake.html` diff is exclusively `wsName` / `EMAIL_RE` / `resolveWorkspaceName` / `maxlength` / `err_email`).
- Recommendation: either update `bxt.test.js:242` to match the new `feasibility.html?id=` routing, or land the H3 fix formally. Out of scope for these 4 QA bugs.

**No test that passed at HEAD was broken by this QA work.**
