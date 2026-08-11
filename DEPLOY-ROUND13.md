# Deploy Runbook — Round-13

This release closes **DEF-13 (HIGH)** at the API layer and adds two defence-in-depth
items. It contains **no schema change**, so deploying is a code push + (optionally)
one guarded cleanup script.

> **Why redeploy matters:** the round-13 QA report saw `DELETE /api/use-cases/:id`
> return **404**. That route already exists in this build (added round-12) — the
> 404 was a **stale host running an older build**. Deploying this zip resolves it.
> There is nothing to fix in code for DELETE.

---

## What's in this build (code — already done, no action)

| Item | Change |
|------|--------|
| **DEF-13 (HIGH)** | `POST /api/use-cases` and `PUT /api/use-cases/:id` now coerce `department` through the canonical allowlist (`resolveDepartment()`). Invalid → `null`, case-variant → canonical (`finance`→`Finance`), alias → canonical (`HR`→`Human Resources`), injection strings → `null`. |
| **XSS-in-department** | Neutralized by the same coercion — a non-canonical string can never persist. |
| **DEF-03 (advisory)** | Kanban `.card__name` got a 2-line ellipsis clamp. |
| **DELETE 404** | Route already present — resolved simply by deploying this build. |

---

## Deploy steps

### Option A — automated (recommended)

From the unzipped repo root:

```bash
# macOS / Linux / WSL / Git-Bash
scripts/deploy-new.sh
```
```cmd
REM Windows
scripts\deploy-new.cmd
```

This pushes to GitHub, provisions/points at Railway + Postgres, sets env vars,
deploys, and runs `npm run migrate`. Steps 7 and 8 are **optional guarded DB
cleanups, OFF by default** (see below).

### Option B — manual push to an existing host

```bash
git add -A && git commit -m "v2 round-13: API dept coercion + kanban clamp"
git push origin main          # triggers your host's auto-deploy
railway run npm run migrate   # no-op if schema unchanged; safe to run
```

---

## Optional DB cleanups (guarded, idempotent — run only if needed)

These purge **throwaway QA scratch rows**. They never touch real data and are
safe to run twice. A brand-new Postgres has neither, so both default to **OFF**.

| Env flag | Script | Removes |
|----------|--------|---------|
| `RUN_CLEANUP_ROUND12=1` | `scripts/cleanup-round12.sql` | the one `NotARealDept` junk row (facets 15→14) |
| `RUN_CLEANUP_ROUND13=1` | `scripts/cleanup-round13.sql` | QA scratch rows named `ZZ-QA-%` / `ZZ-ARCHIVED-QA%` |

Enable when running the deploy script:

```bash
RUN_CLEANUP_ROUND13=1 scripts/deploy-new.sh
```
```cmd
set RUN_CLEANUP_ROUND13=1 && scripts\deploy-new.cmd
```

Or run standalone against the DB:

```bash
railway run psql "$DATABASE_URL" -f scripts/cleanup-round13.sql
```

`cleanup-round13.sql` is transaction-wrapped and aborts if the match count
exceeds `MAX_QA_ROWS` (1000) — a guard against an accidentally over-broad delete.

---

## Post-deploy smoke check (2 min)

```bash
BASE=https://YOUR-APP.up.railway.app

# 1. Health
curl -s "$BASE/api/health"

# 2. DEF-13 — invalid dept must be coerced to null (NOT stored verbatim)
curl -s -X POST "$BASE/api/use-cases" -H 'Content-Type: application/json' \
  -d '{"name":"ZZ-QA-deploycheck","department":"NotARealDept"}'
#    → returned record should show department: null  (then delete it, below)

# 3. DELETE route must NOT 404 (the whole point of redeploying)
#    grab the id from step 2's response, then:
curl -s -X DELETE "$BASE/api/use-cases/<id-from-step-2>" -i | head -1
#    → expect 200 (soft-archived), NOT 404

# 4. Facets still list 14 departments (once round-13 cleanup has run)
curl -s "$BASE/api/portfolio/facets" | grep -o '"department"' | head
```

If step 2 shows `department: null` and step 3 returns 200, DEF-13 and the DELETE
route are confirmed live. Remember to run `cleanup-round13.sql` so the `ZZ-QA-*`
smoke-test rows (and any left by QA) are removed.

---

## Rollback

No schema change → rollback is a git revert + redeploy of the prior commit.
The cleanup SQL is not reversible (it deletes scratch rows) but only ever
matches `ZZ-`/`NotARealDept` sentinel data, never business records.
