# AI Catalyst v2 — Round-13 Fix Notes (for Test Team)

**Build:** round-13 (supersedes round-12)
**Scope:** the round-13 QA report re-tested the three round-12 fixes and found DEF-13 only *half*-closed. This build closes the remaining HIGH attack path, adds one defence-in-depth clamp, and ships a QA-cleanup script.

---

## TL;DR

| Finding | Sev | Round-13 verdict | This build |
|---|---|---|---|
| **DEF-13** — invalid department via **API** | 🔴 HIGH | ⚠️ still open at API layer | ✅ **CLOSED at the API boundary** |
| **DEF-12** — count label / pluralization | 🟡 Low | ✅ pass | no change needed |
| **DEF-03** — long-name overflow | 🟡 Low | ✅ pass (+1 advisory) | ✅ advisory addressed (kanban clamp) |
| Regression sweep | — | ✅ pass | no change |
| **DELETE endpoint** 404 | — | reported missing | ⚠️ **code present — needs redeploy** (see note) |
| QA scratch records | — | cleanup requested | ✅ guarded cleanup SQL shipped |

---

## 1. DEF-13 (HIGH) — invalid department injection — NOW CLOSED at the API boundary

**What round-13 found:** round-12 hardened the **client** `<select>` and the **bulk-import** loop, but the general `POST /api/use-cases` (and `PUT /api/use-cases/:id`) still stored `department` **verbatim** — so `NotARealDept`, `""`, case-variants like `finance`, and even an `<img onerror>` payload were accepted (201) and polluted the facet (15→19).

**Fix:** the same `resolveDepartment()` allowlist coercion now runs at the API boundary:
- **`POST /api/use-cases`** — `body.department = resolveDepartment(body.dept ?? body.department)` before insert.
- **`PUT /api/use-cases/:id`** — coercion applied **only when the body actually carried `department`** (presence-gated), so the round-12 R12-N4 partial-PUT protection is preserved — a PUT that omits `department` still never touches the stored value.

**Observed behavior (verified this build):**

| Sent `department` | Stored as |
|---|---|
| `NotARealDept` | `null` |
| `""` (empty) | `null` |
| `finance` (case) | `Finance` (normalized) |
| `<img src=x onerror=alert(1)>` | `null` (non-canonical → dropped; also kills the latent stored-markup risk) |
| `Finance` | `Finance` |
| `HR` (alias) | `Human Resources` |

**Net:** invalid/junk/case-variant/injection departments can no longer enter the system or grow the facet via the API. The facet vocabulary stays canonical.

**How to re-test:**
1. `POST /api/use-cases` with a valid `workspace_id` and `department:"NotARealDept"` → 201, then GET it back → `department` is `null`.
2. Repeat with `department:"finance"` → stored `Finance`.
3. Repeat with the `<img onerror>` string → stored `null`.
4. Check the department facet count — it should NOT grow with bogus values.

**Automated coverage:** `api-department-coercion.test.js` — **14/0**. Related: `put-merge.test.js` 41/0 (partial-PUT preservation intact), `intake-dept.test.js` 44/0, `bulk-upload-departments.test.js` 9/0.

---

## 2. DEF-12 (Low) — count label / pluralization — PASS (no change)

Verified live in round-13 (`50→…→331 of 331 use cases`; `1 of 1 use case` singular). The round-12 `assets/lazy-list.js` fix is confirmed. No further work.

---

## 3. DEF-03 (Low) — long-name overflow — advisory addressed

The round-12 200-char server clamp and primary-list ellipsis are confirmed working. Round-13 raised one **defence-in-depth advisory**: the kanban `.card__name` wrapped with no ellipsis clamp.

**Fix:** `.card__name` in `kanban.html` now clamps to 2 lines with an ellipsis (`-webkit-line-clamp:2` + `overflow-wrap:anywhere`). Belt-and-suspenders on top of the server `NAME_MAX` cap and HTML escaping.

**Re-test:** create a use case with a 200-char name → the kanban card title truncates with `…` and the card keeps its height. **Coverage:** `kanban.test.js` 47/0.

---

## 4. DELETE endpoint — CODE PRESENT, needs redeploy ⚠️

Round-13 reported `DELETE /api/use-cases/:id` returning 404. **This is a deployment/host issue, not a code gap.** The route was added in round-12 and is present in this build (`server.js`, `app.delete('/api/use-cases/:id', …)`, soft-delete → `stage='archived'`, idempotent, 404 only when the id doesn't exist). The round-13 test ran against the older `ai-catalyst-v2` host.

**Action:** deploy this build to the host under test, then re-verify DELETE returns 200/idempotent. **Coverage:** `delete-route.test.js` 5/0.

---

## 5. QA record cleanup — guarded SQL shipped

`scripts/cleanup-round13.sql` hard-deletes QA scratch rows by prefix (`name LIKE 'ZZ-QA-%' OR name LIKE 'ZZ-ARCHIVED-QA%'`). It is a **manual, deploy-time step** (not part of boot migration):
- Single transaction: preview → guard → delete → post-count.
- Idempotent: 0 matches = safe no-op; re-runnable.
- Safety ceiling `MAX_QA_ROWS=1000` — aborts if the predicate would match more than expected (guards against an over-broad delete).
- Gate/child tables cascade via existing `ON DELETE CASCADE`.

Reviewer inspects the preview + counts, then COMMIT/ROLLBACK by hand. Also clear the intake draft `ZZ-QA-R12-DELETE-ME` from `localStorage` on the intake form.

---

## Verification performed this build
- `node -e "require('./server')"` → loads clean.
- Coercion proof (direct call): `NotARealDept→null`, `""→null`, `finance→Finance`, `<img onerror>→null`, `Finance→Finance`, `HR→Human Resources`.
- Suites: `api-department-coercion` 14/0, `put-merge` 41 assertions/0, `delete-route` 5/0, plus round-12 suites still green.
- Cleanup script: balanced `BEGIN/COMMIT`, `DO $$` guard block, `MAX_QA_ROWS` ceiling present.

## Files changed this round
- `server.js` — POST + PUT department coercion (API boundary)
- `kanban.html` — `.card__name` ellipsis clamp
- `api-department-coercion.test.js` — **new**, 14 tests
- `scripts/cleanup-round13.sql` — **new**, guarded QA cleanup

## Not defects / no action
- DEF-12, regression sweep (theme, gates, wizard, dual-shape API, mobile) — all pass.
- DELETE 404 is a redeploy, not a code fix.
