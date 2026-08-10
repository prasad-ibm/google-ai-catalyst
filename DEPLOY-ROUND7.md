# Round-7 Deploy & Verify

Fixes in this build: **M6** (Brief KPI mirrors the live sim triple — no more
synthetic +206/+374/+598 fallback), **M5** (Monte Carlo seed now includes the
use-case id so two cases can't share an identical triple), **L3** (workspace
chip fallback label = INTEL). L2 (setup validation) and L7 (GADF tier labels)
were already correct in source — the tester saw them on a stale build.

M3 avg-ROI skew + the M5 duplicate SYMPTOM are cleared by the data cleanup SQL.

---

## 1. Ship the code

```powershell
# extract the new zip into C:\gac-clean first, then:
robocopy C:\gac-clean C:\google-ai-catalyst /MIR /XD ".git" "node_modules" /XF ".gitignore"
cd C:\google-ai-catalyst
railway up
```

Wait for the deploy log to show `Healthcheck succeeded` + `listening on port 8080`.

## 2. Run the data cleanup ONCE (clears M3 skew + M5 symptom)

```powershell
railway connect          # pick "DB AI Catalyst"
# at the psql=# prompt:
\i scripts/cleanup-round7.sql
\q
```
(Or paste the statements into the Railway DB Query editor, one at a time,
omitting BEGIN/COMMIT.)

Expected after cleanup: `SELECT COUNT(*) FROM use_cases;` returns **5** (seeds only).

## 3. Post-deploy smoke test (LOGGED IN — anonymous hits the 6.7 KB login stub)

In a browser:
1. https://ai-catalyst-production.up.railway.app/login.html  → sandboxuser / IntelUser1!
2. **Dashboard** → TOTAL should read **5**; Avg P50 ROI back in a realistic band
   (~+300 to +900%), NOT +2985%.
3. Open a seed case → **Evaluation Summary**: note the hero P10/P50/P90.
4. **Executive Review Panel** → generate the Executive Brief. The KPI band's
   P10/P50/P90 **must match the Summary hero exactly** (no +206/+374/+598).
5. Open two different cases' Summaries → their Monte Carlo triples must **differ**.

If step 4 still shows +206/+374/+598, the deploy is stale — re-check `railway up`
landed (compare the active deployment id in `railway status`).
