# Google AI Catalyst — Data Model (Product Manager's Guide)

*A plain-English tour of every table in the platform's database. No SQL knowledge required.*

**Last updated:** August 2026 · **Database:** PostgreSQL (auto-provisions on first run) · **Source of truth:** `schema.sql` + `auth.js`

---

## The big picture in one sentence

An **enterprise** (workspace) submits **use cases**; each use case travels through **six evaluation gates**, and every gate writes its result to its own table — so nothing is ever recomputed inconsistently. Two extra tables handle **login/sessions**.

```
Enterprise (workspaces)
        │  owns many
        ▼
   Use Case (use_cases)  ─────────────┐
        │  each has exactly one row in each gate table │
        ├─► BXT Gate            (bxt_scores)
        ├─► Feasibility Gate    (feasibility_scores)
        ├─► Platform Advisory   (advisory_results)
        ├─► Evaluation Summary  (evaluation_summaries)
        └─► Executive Panel     (panel_verdicts)

Login & security:  users  ──►  sessions
```

---

## Tables at a glance

| # | Table | What it holds | Created when… | One row per… |
|---|-------|---------------|---------------|--------------|
| 1 | **workspaces** | The enterprise profile (industry, size, cloud, licences, compliance, AI strategy) | Enterprise completes the 7-step Setup wizard | Enterprise |
| 2 | **use_cases** | A submitted AI idea and all its intake answers | User submits the Intake form | Use case |
| 3 | **bxt_scores** | Business × Experience × Technology pre-filter result | Use case passes the BXT gate | Use case |
| 4 | **feasibility_scores** | Feasibility composite, priority quadrant, risk tier | Use case passes the Feasibility gate | Use case |
| 5 | **advisory_results** | Recommended platform + advisory tier (Adopt / Low-code / Build) | Use case passes the Advisory gate | Use case |
| 6 | **evaluation_summaries** | ROI projection (P10/P50/P90), framework rollup, governance checklist | Evaluation Summary is generated | Use case |
| 7 | **panel_verdicts** | Final GO / CONDITIONAL / NO-GO decision + deliberation | Executive Panel deliberates | Use case |
| 8 | **users** | Login accounts (username + hashed password) | A user account is seeded/created | User |
| 9 | **sessions** | Active login sessions | A user signs in | Login session |

> **Key idea for PMs:** tables 3–7 are the **six-gate pipeline** made durable. Each use case has *at most one* row in each — that's why the dashboard, compare view, and executive brief always agree (the "single source of truth" we hardened after QA).

---

## 1. `workspaces` — the enterprise profile

Everything the platform knows about the customer organisation. Captured by the **Setup wizard** and used to tailor every scoring, ROI, and platform recommendation.

| Field | Plain-English meaning |
|-------|----------------------|
| `name` | Enterprise name (e.g. "Intel") |
| `industry` | Sector — drives benchmarks & compliance defaults |
| `company_size` | Employee band |
| `annual_revenue` | Revenue band — contextualises AI budget |
| `region` | Primary operating geography |
| `data_residency` | Where regulated data must physically live |
| `cloud_provider` | Primary cloud (defaults to **Google Cloud**) |
| `workspace_edition` | Google Workspace SKU — gates Gemini eligibility |
| `gemini_seats` | Gemini for Workspace licences purchased |
| `monthly_gcp_consumption` | Google Cloud spend band — infra maturity signal |
| `appsheet_plan` | Low-code / citizen-developer capability |
| `vertex_approved` | Vertex AI production access (prerequisite for Build tier) |
| `gartner_level` | Digital/AI maturity L1–L5 |
| `ai_engineers` | In-house ML/AI engineering headcount |
| `mlops_maturity` | Readiness to run AI in production |
| `citizen_dev_program` | Do business users build low-code apps today? |
| `compliance_frameworks` | List of frameworks (GDPR, HIPAA, SOC 2…) |
| `eu_ai_act_tier` | Highest EU AI Act risk tier — drives governance gating |
| `ai_priorities` | Top FY priorities |
| `ai_budget` | Committed annual AI budget band |
| `delivery_model` | Build / Buy / Hybrid / Partner-led |
| `ai_goal` | Narrative strategic ambition |
| `raw` | Full raw form payload (safety net for anything not broken out) |
| `created_at` / `updated_at` | Timestamps |

---

## 2. `use_cases` — the submitted AI idea

One row per idea entering the pipeline. The four `*_context` fields are flexible JSON buckets holding the detailed intake answers.

| Field | Plain-English meaning |
|-------|----------------------|
| `workspace_id` | Which enterprise this belongs to *(link to table 1)* |
| `name` | Use-case title |
| `department` | Owning department / line of business |
| `executive_sponsor` | Named sponsor |
| `submitted_by` / `contact_email` | Who submitted it |
| `description` | What the use case does |
| `business_context` | Business drivers, value, users, alignment *(JSON)* |
| `current_state` | Today's process, spend, volume, pain points *(JSON)* |
| `technical_context` | Data sources, integrations, real-time needs *(JSON)* |
| `risk_compliance` | Sensitivity, autonomy, PII, audit needs *(JSON)* |
| `stage` | Where it is in the pipeline (`intake` → `bxt` → `feasibility` → `advisory` → `summary` → `panel`). **Defaults to `intake`.** |
| `created_at` / `updated_at` | Timestamps |

> **Why `stage` matters:** it's the gate that decides whether a use case is "evaluated." ROI and quadrant are **suppressed** for cases still at `intake` — that's the fix behind the QA bug where an un-evaluated case showed a fake ROI.

---

## 3–7. The six-gate pipeline (one table per gate)

Each of these has a **unique** link to its use case (`use_case_id`), so a use case can have only one result per gate.

### 3. `bxt_scores` — BXT pre-filter
| Field | Meaning |
|-------|---------|
| `business_score`, `experience_score`, `technology_score` | The three BXT axis scores |
| `verdict` | Pre-filter outcome |
| `detail` | Sub-score breakdown *(JSON)* |

### 4. `feasibility_scores` — Feasibility gate
| Field | Meaning |
|-------|---------|
| `composite` | Overall feasibility score |
| `quadrant` | Priority quadrant (e.g. Quick Win, Accelerate, Deprioritise) |
| `risk_tier` | Risk classification |
| `citizen_dev_pct` | % achievable via low-code / citizen dev |
| `criteria`, `pillars` | Detailed inputs *(JSON)* |

### 5. `advisory_results` — Platform Advisory gate
| Field | Meaning |
|-------|---------|
| `tier` | Advisory tier — **Adopt / Low-code / Build** |
| `verdict_name` | Named recommendation |
| `recommended_platform` | Suggested Google platform/product |
| `gate_resolved` | Which gate resolved the recommendation |
| `reasoning`, `journey` | Rationale + adoption journey *(JSON)* |

### 6. `evaluation_summaries` — the consolidated evaluation
| Field | Meaning |
|-------|---------|
| `roi_p10`, `roi_p50`, `roi_p90` | ROI projection — conservative / expected / optimistic |
| `frameworks` | Rollup across the scoring frameworks *(JSON)* |
| `governance` | Responsible-AI / governance checklist *(JSON)* |
| `readiness` | Readiness status (e.g. Ready / Blocked) |

### 7. `panel_verdicts` — Executive Review Panel
| Field | Meaning |
|-------|---------|
| `verdict` | Final decision — **GO / CONDITIONAL / NO-GO** |
| `binding_condition` | Any condition attached to the verdict |
| `stances` | Each persona's position *(JSON)* |
| `deliberation` | The panel dialogue transcript *(JSON)* |

> **This table is the definitive verdict.** The dashboard, Kanban, and executive brief all read the verdict from here — no page derives its own, which is what keeps them consistent.

---

## 8–9. Login & security

### 8. `users`
| Field | Meaning |
|-------|---------|
| `username` | Unique login name |
| `password_hash` | Securely hashed password (never stored in plain text) |
| `created_at`, `last_login` | Timestamps |

### 9. `sessions`
| Field | Meaning |
|-------|---------|
| `sid` | Session ID |
| `user_id` | Which user *(link to table 8)* |
| `username` | Cached username |
| `created_at`, `expires_at` | Session lifetime |

---

## Things a PM should know

- **Cascade delete:** deleting a use case automatically removes all its gate rows (BXT, feasibility, advisory, summary, panel). Deleting an enterprise removes all its use cases. No orphans.
- **Self-provisioning:** on a fresh database, the platform creates all 9 tables automatically on first boot — no manual DB setup.
- **JSON buckets (`jsonb`):** the flexible fields (contexts, reasoning, deliberation) let the product evolve inputs without a schema migration each time.
- **Single source of truth:** verdict lives only in `panel_verdicts`; ROI only in `evaluation_summaries`. Every screen reads these — that's the architectural guarantee behind the "one number everywhere" fixes.
- **Not evaluated = no numbers:** a use case at `stage = intake` intentionally has **no ROI and no quadrant** until it clears the relevant gate.

---

*Generated from the live schema (`schema.sql`, `auth.js`). If the schema changes, regenerate this doc so it stays accurate.*
