-- Google AI Catalyst — relational schema
-- Idempotent: safe to run repeatedly.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Enterprise workspace profile (from setup.html)
CREATE TABLE IF NOT EXISTS workspaces (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text,
  industry                text,
  company_size            text,
  annual_revenue          text,
  region                  text,
  data_residency          text,
  cloud_provider          text DEFAULT 'Google Cloud',
  workspace_edition       text,
  gemini_seats            int,
  monthly_gcp_consumption text,
  appsheet_plan           text,
  vertex_approved         bool,
  gartner_level           text,
  ai_engineers            int,
  mlops_maturity          text,
  citizen_dev_program     bool,
  compliance_frameworks   text[],
  eu_ai_act_tier          text,
  ai_priorities           text,
  ai_budget               text,
  delivery_model          text,
  ai_goal                 text,
  raw                     jsonb,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- 2. Use cases (from intake.html)
CREATE TABLE IF NOT EXISTS use_cases (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  name               text,
  department         text,
  executive_sponsor  text,
  submitted_by       text,
  contact_email      text,
  description        text,
  business_context   jsonb,
  current_state      jsonb,
  technical_context  jsonb,
  risk_compliance    jsonb,
  stage              text DEFAULT 'intake',
  status             text DEFAULT 'active',
  delivered_at       date,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

-- v2 lifecycle migration (idempotent): existing databases created before the
-- Completed/Delivered lifecycle need these two columns added. ADD COLUMN IF
-- NOT EXISTS is a no-op when they already exist, so this is safe on every boot.
ALTER TABLE use_cases ADD COLUMN IF NOT EXISTS status       text DEFAULT 'active';
ALTER TABLE use_cases ADD COLUMN IF NOT EXISTS delivered_at date;

-- v2 scale indexes: filtering by department / executive sponsor / stage / status
-- stays fast at 130–500+ rows.
CREATE INDEX IF NOT EXISTS idx_use_cases_department  ON use_cases (department);
CREATE INDEX IF NOT EXISTS idx_use_cases_sponsor     ON use_cases (executive_sponsor);
CREATE INDEX IF NOT EXISTS idx_use_cases_stage       ON use_cases (stage);
CREATE INDEX IF NOT EXISTS idx_use_cases_status      ON use_cases (status);

-- 3. BXT gate scores
CREATE TABLE IF NOT EXISTS bxt_scores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  use_case_id      uuid UNIQUE REFERENCES use_cases(id) ON DELETE CASCADE,
  business_score   numeric,
  experience_score numeric,
  technology_score numeric,
  verdict          text,
  detail           jsonb,
  created_at       timestamptz DEFAULT now()
);

-- 4. Feasibility gate scores
CREATE TABLE IF NOT EXISTS feasibility_scores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  use_case_id     uuid UNIQUE REFERENCES use_cases(id) ON DELETE CASCADE,
  composite       numeric,
  quadrant        text,
  risk_tier       text,
  citizen_dev_pct numeric,
  criteria        jsonb,
  pillars         jsonb,
  created_at      timestamptz DEFAULT now()
);

-- 5. Advisory results
CREATE TABLE IF NOT EXISTS advisory_results (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  use_case_id          uuid UNIQUE REFERENCES use_cases(id) ON DELETE CASCADE,
  tier                 text,
  verdict_name         text,
  recommended_platform text,
  gate_resolved        text,
  reasoning            jsonb,
  journey              jsonb,
  created_at           timestamptz DEFAULT now()
);

-- 6. Evaluation summaries
CREATE TABLE IF NOT EXISTS evaluation_summaries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  use_case_id uuid UNIQUE REFERENCES use_cases(id) ON DELETE CASCADE,
  roi_p10     numeric,
  roi_p50     numeric,
  roi_p90     numeric,
  -- M7: committed econ BASIS pinned to the case at evaluation time. Panel/brief
  -- reload value & cost from here so displayed inputs are identical on every
  -- load, instead of re-deriving from ambient intake/feasibility/advisory state.
  roi_value   numeric,
  roi_cost    numeric,
  frameworks  jsonb,
  governance  jsonb,
  readiness   text,
  created_at  timestamptz DEFAULT now()
);

-- 7. Panel verdicts
CREATE TABLE IF NOT EXISTS panel_verdicts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  use_case_id       uuid UNIQUE REFERENCES use_cases(id) ON DELETE CASCADE,
  verdict           text,
  binding_condition text,
  stances           jsonb,
  deliberation      jsonb,
  created_at        timestamptz DEFAULT now()
);
