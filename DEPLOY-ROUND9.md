# Round-9 Deploy — Google AI Catalyst (final round)

## What's in this round
| ID | Fix |
|----|-----|
| **M6** 🔴 (permanent) | Executive Brief no longer diverges from the Summary. Root cause: the Brief computed ROI off a **stale persisted benefit** (~$900K) while the Summary recomputed live (~$1.1M). Fix: (1) `liveROI` now computes its benefit/cost basis **fresh** via the same `annualValueOf`/`implCostOf` the Summary uses — never through the stale-preferring `caseEconomics()`; (2) `caseEconomics()` now uses the Summary's **persisted** `roi.value`/`roi.cost` when present (that IS the hero's number) and only recomputes fresh when absent. Result: Brief P10/P50/P90 == Summary by construction. Composite header also never shows `—` (neutral 3.0 default for unscored cases). |
| **H4** 🔴 (completion) | Compare page: `table-layout:fixed` + hard 220px column caps + truncation on `.cmphd`/`.cmphd__name` so a 40k-char name can't blow out the table (Round-8 CSS wasn't enough / hadn't deployed). Intake `name` field now has `maxlength="200"` (client) to match the existing server-side 200-char cap. |

**Verified:** panel suite **123/0**; new `m6-parity.test.js` **5/5** (proves Summary and Brief use an identical benefit/cost basis); `node --check` clean on all changed files.

## Deploy — 3 steps
### 1. Ship the code
```powershell
robocopy C:\gac-clean C:\google-ai-catalyst /MIR /XD ".git" "node_modules" /XF ".gitignore"
cd C:\google-ai-catalyst
railway up
```
### 2. Clean the QA record (once)
```
railway connect        (pick DB AI Catalyst)
\i scripts/cleanup-round9.sql
\q
```
Expected: `remaining_use_cases = 5`, `should_be_zero = 0`.

### 3. Logged-in smoke test (the ONLY reliable verification)
> Anonymous requests return the 6.7 KB login page — always test **logged in**.

1. Login → **sandboxuser / IntelUser1!**
2. Open a case → **Summary** (note P10/P50/P90 and the $ value) → **Executive Panel** → generate **Brief**: the KPI band and the persona-dialogue $ figures now **match the Summary** exactly (no $900K-vs-$1.1M split); composite shows a real number.
3. **Compare** → select 4 cases including any long name → table stays within the viewport (no horizontal overflow).
4. **Intake** → the "Use case name" field stops accepting input at 200 chars.
