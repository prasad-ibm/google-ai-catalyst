# Portfolio API Contract — canonical per-case row

`GET /api/portfolio` (optionally `?workspace_id=<uuid>`) returns a JSON **array**
of use-case rows. Every row has exactly this shape and is the **single source of
truth** consumed identically by Dashboard, Kanban, and Summary. No consumer
recomputes verdict or ROI; no other endpoint emits a different verdict/ROI.

```jsonc
{
  "id":                    "uuid",          // use_cases.id
  "name":                  "string|null",   // use_cases.name
  "department":            "string|null",   // use_cases.department
  "stage":                 "string",        // canonical pipeline stage (see below)
  "feasibility_composite": "number|null",   // feasibility_scores.composite
  "quadrant":              "string|null",   // feasibility_scores.quadrant
  "advisory_tier":         "string|null",   // advisory_results.tier
  "recommended_platform":  "string|null",   // advisory_results.recommended_platform
  "roi_p10":               "number|null",   // NULL unless ROI-eligible (see rule)
  "roi_p50":               "number|null",   // NULL unless ROI-eligible (see rule)
  "roi_p90":               "number|null",   // NULL unless ROI-eligible (see rule)
  "verdict":               "string|null"    // committed Executive Panel verdict, or null
}
```

## Canonical stage vocabulary

Ordered pipeline (rank ascending), defined once in `stage.js` (`STAGES`):

```
intake -> bxt -> feasibility -> advisory -> summary -> panel -> approved
```

`stage.js` normalizes casing/label variants (e.g. `"Evaluation Summary"` →
`summary`, `"Executive Panel"` → `panel`) to these canonical keys.

## ROI rule (fixes bug #6)

`roi_p10 / roi_p50 / roi_p90` are **`null`** unless the case has reached the
**Evaluation Summary** gate (`stage = summary`) or beyond (`panel`, `approved`).
Eligibility is `stage.roiEligible(stage)` — i.e. `stageRank(stage) >=
stageRank('summary')`. Enforced in two places that share the same helper:

- **Read guard** — `GET /api/portfolio` nulls ROI for non-eligible cases even if
  a stale `evaluation_summaries` row exists (defends against pre-existing bad data,
  e.g. an Intake case showing +407%).
- **Write guard** — `PUT /api/use-cases/:id/summary` never persists ROI for a
  case below the summary stage. Saving that gate also advances the case to
  `summary` (if it was below), so a legitimate summary save both advances the
  stage and records ROI atomically.

Non-ROI summary fields (`frameworks`, `governance`, `readiness`) are always
persisted regardless of stage.

## Verdict rule (fixes bug #4)

`verdict` is the **single committed Executive Panel verdict** from
`panel_verdicts.verdict`, or `null` if no verdict has been committed. It is never
derived from advisory/feasibility per-endpoint — all pages read this one value.
