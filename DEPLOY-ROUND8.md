# Round-8 Deploy — Google AI Catalyst

## What's in this round
| ID | Fix |
|----|-----|
| **H4** 🔴 | Long use-case names no longer break layout. CSS truncation (ellipsis) on Dashboard ROI rows + table and Compare column headers/cells; server caps `name` ≤200 chars (and other text fields) in `buildUseCaseValues` — covers single **and** bulk create. |
| **M11** 🟠 | Executive Brief no longer shows all "—" for freshly-created cases. When persisted gate scores are absent, the Brief now live-computes the same P10/P50/P90 band + composite as the Summary (identical seed incl. use-case id), so it matches the hero and never shows a verdict with blank numbers. |
| **M10** 🟠 | ROI figures relabelled honestly as **24-month benefit-to-cost (net % of implementation cost)** across Summary, Panel Brief, Dashboard, Compare, Portfolio Map. Math unchanged — labels only. |
| **L2** | Setup wizard now gates **per-step** advancement on required fields (was only gating the final Finish). |
| **L3** | Header workspace chip reads **INTEL** on setup.html + advisory.html (was static "WORKSPACE"). |
| **L7** | Advisory removed the "low-code covers it" line that could contradict a Build recommendation. |

## Deploy — 3 steps

### 1. Ship the code
```powershell
# extract the new zip into C:\gac-clean first, then:
robocopy C:\gac-clean C:\google-ai-catalyst /MIR /XD ".git" "node_modules" /XF ".gitignore"
cd C:\google-ai-catalyst
railway up
```

### 2. Clean the test data (once) — removes the H4 payload + QA/dev rows
```
railway connect
```
pick **DB AI Catalyst**, then at the `psql=#` prompt:
```
\i scripts/cleanup-round8.sql
\q
```
Expected after: `remaining_use_cases = 5`, `should_be_zero = 0`.

### 3. Logged-in smoke test (the ONLY reliable verification)
> Anonymous requests return the 6.7 KB login page — always test **logged in**.

1. https://ai-catalyst-production.up.railway.app/login.html → **sandboxuser / IntelUser1!**
2. **Dashboard** → TOTAL = **5**; no giant-name row; "Avg P50 net return" label; layout intact (no horizontal overflow).
3. **Compare** → select 3–4 cases → column headers truncate; radar + table fit the viewport.
4. Create a **new** use case via Intake → open its **Executive Panel** → generate Brief → KPI band is **populated** (not "—") and matches the Summary hero.
5. Open two different cases → Monte Carlo triples **differ** (M5 holds).
6. **Setup** wizard → try **Next** with empty required fields → it **blocks** with a message (L2). Header shows **INTEL**.
7. **Advisory** → header shows **INTEL**; a Build recommendation no longer says "low-code covers it".
