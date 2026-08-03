'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, query } = require('./db');
const auth = require('./auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Attach req.user from the signed Postgres-backed session cookie.
app.use(auth.sessionMiddleware());

/* -------------------------------------------------------------------------- */
/* Auth routes (public)                                                        */
/* -------------------------------------------------------------------------- */

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }
    const result = await auth.login(String(username), String(password));
    if (!result) return res.status(401).json({ error: 'invalid credentials' });
    auth.setSessionCookie(res, auth.signSid(result.sid), auth.SESSION_TTL_MS);
    return res.json({ ok: true, user: result.user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    if (req.user && req.user.sid) await auth.destroySession(req.user.sid);
  } catch (_) { /* ignore */ }
  auth.clearSessionCookie(res);
  return res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ authenticated: false });
  return res.json({ authenticated: true, user: { id: req.user.id, username: req.user.username } });
});

/* -------------------------------------------------------------------------- */
/* Page gate: unauthenticated requests for app pages -> /login.html            */
/* -------------------------------------------------------------------------- */

const PUBLIC_PATHS = new Set(['/login.html', '/favicon.ico']);

app.use((req, res, next) => {
  // Always allow API (APIs enforce their own 401), the login page, and assets.
  if (req.path.startsWith('/api/')) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (req.path.startsWith('/assets/')) return next();

  const isHtml = req.path === '/' || req.path.endsWith('.html');
  if (isHtml && !req.user) {
    return res.redirect('/login.html');
  }
  return next();
});

// Serve the static HTML pages + assets from the project root.
app.use(express.static(__dirname));

// Protect all data API routes. Runs AFTER the public auth/health routes above
// but BEFORE the data route handlers below, so every /api data call requires
// a valid session.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/health') return next();
  return auth.requireAuthApi(req, res, next);
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function toNumOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function toBool(v) {
  if (v === true || v === false) return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === null || v === undefined || v === '') return null;
  return Boolean(v);
}

function toTextArray(v) {
  if (Array.isArray(v)) return v.map(String);
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') return [v];
  return null;
}

// Accept an object/array for jsonb columns; null stays null.
function toJson(v) {
  if (v === null || v === undefined) return null;
  return v;
}

function joinPriorities(state) {
  const parts = [state.priority1, state.priority2, state.priority3]
    .filter((p) => p !== undefined && p !== null && p !== '');
  return parts.length ? parts.join(', ') : null;
}

/**
 * Normalize an incoming workspace payload into column values.
 * Accepts either the raw setup `{ state, current }` shape OR flat fields.
 */
function mapWorkspace(body) {
  // If wrapped as { state, current } from setup.html, unwrap state.
  const state = (body && body.state && typeof body.state === 'object') ? body.state : body || {};

  const residency = state.residency1 || state.residency5 || state.data_residency || null;

  return {
    name: state.company ?? state.name ?? null,
    industry: state.industry ?? null,
    company_size: state.size ?? state.company_size ?? null,
    annual_revenue: state.revenue ?? state.annual_revenue ?? null,
    region: state.region ?? null,
    data_residency: residency,
    cloud_provider: state.cloud ?? state.cloud_provider ?? 'Google Cloud',
    workspace_edition: state.edition ?? state.workspace_edition ?? null,
    gemini_seats: toIntOrNull(state.geminiSeats ?? state.gemini_seats),
    monthly_gcp_consumption: state.gcpSpend ?? state.monthly_gcp_consumption ?? null,
    appsheet_plan: state.appsheet ?? state.appsheet_plan ?? null,
    vertex_approved: toBool(state.vertexApproved ?? state.vertex_approved),
    gartner_level: state.devops ?? state.gartner_level ?? null,
    ai_engineers: toIntOrNull(state.engineers ?? state.ai_engineers),
    mlops_maturity: state.maturity ?? state.mlops_maturity ?? null,
    citizen_dev_program: toBool(state.citizenDev ?? state.citizen_dev_program),
    compliance_frameworks: toTextArray(state.frameworks ?? state.compliance_frameworks),
    eu_ai_act_tier: state.euAiTier ?? state.eu_ai_act_tier ?? null,
    ai_priorities: state.ai_priorities ?? joinPriorities(state),
    ai_budget: state.budget ?? state.ai_budget ?? null,
    delivery_model: state.delivery ?? state.delivery_model ?? null,
    ai_goal: state.goal ?? state.ai_goal ?? null,
    raw: body ?? null,
  };
}

// Build the four jsonb tab groups for a use case either from pre-grouped
// objects or from flat intake keys.
function mapUseCaseContexts(body) {
  const pick = (obj, keys) => {
    const out = {};
    for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
    return Object.keys(out).length ? out : null;
  };

  const business_context = body.business_context ?? pick(body, ['driver', 'value', 'users', 'align', 'justif']);
  const current_state = body.current_state ?? pick(body, ['maturity', 'spend', 'volume', 'pain', 'tools']);
  const technical_context = body.technical_context ?? pick(body, ['sources', 'dataavail', 'integrations', 'realtime', 'technotes']);
  const risk_compliance = body.risk_compliance ?? pick(body, ['sensitivity', 'autonomy', 'pii', 'audit', 'adoption', 'change', 'delivery', 'addnotes']);

  return { business_context, current_state, technical_context, risk_compliance };
}

/* -------------------------------------------------------------------------- */
/* Health                                                                     */
/* -------------------------------------------------------------------------- */

app.get('/api/health', async (req, res) => {
  let db = false;
  let version = 'node ' + process.version;
  try {
    await query('SELECT 1');
    db = true;
    try {
      const v = await query('SELECT version() AS v');
      version = v.rows[0].v;
    } catch (_) { /* keep node version */ }
  } catch (_) {
    db = false;
  }
  res.json({ ok: true, db, version });
});

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                 */
/* -------------------------------------------------------------------------- */

const WORKSPACE_COLS = [
  'name', 'industry', 'company_size', 'annual_revenue', 'region', 'data_residency',
  'cloud_provider', 'workspace_edition', 'gemini_seats', 'monthly_gcp_consumption',
  'appsheet_plan', 'vertex_approved', 'gartner_level', 'ai_engineers', 'mlops_maturity',
  'citizen_dev_program', 'compliance_frameworks', 'eu_ai_act_tier', 'ai_priorities',
  'ai_budget', 'delivery_model', 'ai_goal', 'raw',
];

app.post('/api/workspaces', async (req, res) => {
  try {
    const body = req.body || {};
    const m = mapWorkspace(body);
    const id = body.id || (body.state && body.state.id) || null;

    // jsonb columns must be JSON-stringified when passed as params.
    const valFor = (col) => {
      const v = m[col];
      if (col === 'raw') return v === null ? null : JSON.stringify(v);
      return v;
    };

    if (id) {
      const setClauses = WORKSPACE_COLS.map((c, i) => `${c} = $${i + 1}`);
      setClauses.push('updated_at = now()');
      const params = WORKSPACE_COLS.map(valFor);
      params.push(id);
      const sql = `UPDATE workspaces SET ${setClauses.join(', ')} WHERE id = $${WORKSPACE_COLS.length + 1} RETURNING *`;
      const r = await query(sql, params);
      if (!r.rows.length) return res.status(404).json({ error: 'workspace not found' });
      return res.json(r.rows[0]);
    }

    const placeholders = WORKSPACE_COLS.map((_, i) => `$${i + 1}`);
    const params = WORKSPACE_COLS.map(valFor);
    const sql = `INSERT INTO workspaces (${WORKSPACE_COLS.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const r = await query(sql, params);
    return res.status(201).json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspaces', async (req, res) => {
  try {
    const r = await query('SELECT * FROM workspaces ORDER BY created_at DESC');
    return res.json(r.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspaces/:id', async (req, res) => {
  try {
    const r = await query('SELECT * FROM workspaces WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'workspace not found' });
    return res.json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Use cases                                                                  */
/* -------------------------------------------------------------------------- */

app.post('/api/use-cases', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.workspace_id) return res.status(400).json({ error: 'workspace_id is required' });

    // Ensure the workspace exists.
    const ws = await query('SELECT id FROM workspaces WHERE id = $1', [body.workspace_id]);
    if (!ws.rows.length) return res.status(400).json({ error: 'workspace_id does not reference an existing workspace' });

    const ctx = mapUseCaseContexts(body);
    const cols = [
      'workspace_id', 'name', 'department', 'executive_sponsor', 'submitted_by',
      'contact_email', 'description', 'business_context', 'current_state',
      'technical_context', 'risk_compliance', 'stage',
    ];
    const values = [
      body.workspace_id,
      body.name ?? null,
      body.dept ?? body.department ?? null,
      body.sponsor ?? body.executive_sponsor ?? null,
      body.submitter ?? body.submitted_by ?? null,
      body.email ?? body.contact_email ?? null,
      body.desc ?? body.description ?? null,
      ctx.business_context === null ? null : JSON.stringify(ctx.business_context),
      ctx.current_state === null ? null : JSON.stringify(ctx.current_state),
      ctx.technical_context === null ? null : JSON.stringify(ctx.technical_context),
      ctx.risk_compliance === null ? null : JSON.stringify(ctx.risk_compliance),
      body.stage ?? 'intake',
    ];
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const sql = `INSERT INTO use_cases (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const r = await query(sql, values);
    return res.status(201).json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/use-cases', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    let r;
    if (workspace_id) {
      r = await query('SELECT * FROM use_cases WHERE workspace_id = $1 ORDER BY created_at DESC', [workspace_id]);
    } else {
      r = await query('SELECT * FROM use_cases ORDER BY created_at DESC');
    }
    return res.json(r.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/use-cases/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const uc = await query('SELECT * FROM use_cases WHERE id = $1', [id]);
    if (!uc.rows.length) return res.status(404).json({ error: 'use case not found' });

    const [bxt, feas, adv, summ, verdict] = await Promise.all([
      query('SELECT * FROM bxt_scores WHERE use_case_id = $1', [id]),
      query('SELECT * FROM feasibility_scores WHERE use_case_id = $1', [id]),
      query('SELECT * FROM advisory_results WHERE use_case_id = $1', [id]),
      query('SELECT * FROM evaluation_summaries WHERE use_case_id = $1', [id]),
      query('SELECT * FROM panel_verdicts WHERE use_case_id = $1', [id]),
    ]);

    const row = uc.rows[0];
    row.bxt = bxt.rows[0] || null;
    row.feasibility = feas.rows[0] || null;
    row.advisory = adv.rows[0] || null;
    row.summary = summ.rows[0] || null;
    row.verdict = verdict.rows[0] || null;
    return res.json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/use-cases/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const exists = await query('SELECT id FROM use_cases WHERE id = $1', [id]);
    if (!exists.rows.length) return res.status(404).json({ error: 'use case not found' });

    const body = req.body || {};
    const ctx = mapUseCaseContexts(body);

    const fieldMap = {
      name: body.name,
      department: body.dept ?? body.department,
      executive_sponsor: body.sponsor ?? body.executive_sponsor,
      submitted_by: body.submitter ?? body.submitted_by,
      contact_email: body.email ?? body.contact_email,
      description: body.desc ?? body.description,
      business_context: ctx.business_context,
      current_state: ctx.current_state,
      technical_context: ctx.technical_context,
      risk_compliance: ctx.risk_compliance,
      stage: body.stage,
    };
    const jsonbCols = new Set(['business_context', 'current_state', 'technical_context', 'risk_compliance']);

    const setClauses = [];
    const params = [];
    let i = 1;
    for (const [col, val] of Object.entries(fieldMap)) {
      if (val === undefined) continue;
      setClauses.push(`${col} = $${i}`);
      params.push(jsonbCols.has(col) && val !== null ? JSON.stringify(val) : val);
      i++;
    }

    if (!setClauses.length) {
      // Nothing to update; just return the current row.
      const cur = await query('SELECT * FROM use_cases WHERE id = $1', [id]);
      return res.json(cur.rows[0]);
    }

    setClauses.push('updated_at = now()');
    params.push(id);
    const sql = `UPDATE use_cases SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`;
    const r = await query(sql, params);
    return res.json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Gate upserts                                                               */
/* -------------------------------------------------------------------------- */

async function ensureUseCase(id, res) {
  const uc = await query('SELECT id FROM use_cases WHERE id = $1', [id]);
  if (!uc.rows.length) {
    res.status(404).json({ error: 'use case not found' });
    return false;
  }
  return true;
}

app.put('/api/use-cases/:id/bxt', async (req, res) => {
  try {
    const id = req.params.id;
    if (!(await ensureUseCase(id, res))) return;
    const b = req.body || {};
    const sql = `
      INSERT INTO bxt_scores (use_case_id, business_score, experience_score, technology_score, verdict, detail)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (use_case_id) DO UPDATE SET
        business_score = EXCLUDED.business_score,
        experience_score = EXCLUDED.experience_score,
        technology_score = EXCLUDED.technology_score,
        verdict = EXCLUDED.verdict,
        detail = EXCLUDED.detail
      RETURNING *`;
    const params = [
      id,
      toNumOrNull(b.business_score),
      toNumOrNull(b.experience_score),
      toNumOrNull(b.technology_score),
      b.verdict ?? null,
      b.detail === undefined || b.detail === null ? null : JSON.stringify(b.detail),
    ];
    const r = await query(sql, params);
    return res.json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/use-cases/:id/feasibility', async (req, res) => {
  try {
    const id = req.params.id;
    if (!(await ensureUseCase(id, res))) return;
    const b = req.body || {};
    const sql = `
      INSERT INTO feasibility_scores (use_case_id, composite, quadrant, risk_tier, citizen_dev_pct, criteria, pillars)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (use_case_id) DO UPDATE SET
        composite = EXCLUDED.composite,
        quadrant = EXCLUDED.quadrant,
        risk_tier = EXCLUDED.risk_tier,
        citizen_dev_pct = EXCLUDED.citizen_dev_pct,
        criteria = EXCLUDED.criteria,
        pillars = EXCLUDED.pillars
      RETURNING *`;
    const params = [
      id,
      toNumOrNull(b.composite),
      b.quadrant ?? null,
      b.risk_tier ?? null,
      toNumOrNull(b.citizen_dev_pct),
      b.criteria === undefined || b.criteria === null ? null : JSON.stringify(b.criteria),
      b.pillars === undefined || b.pillars === null ? null : JSON.stringify(b.pillars),
    ];
    const r = await query(sql, params);
    return res.json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/use-cases/:id/advisory', async (req, res) => {
  try {
    const id = req.params.id;
    if (!(await ensureUseCase(id, res))) return;
    const b = req.body || {};
    const sql = `
      INSERT INTO advisory_results (use_case_id, tier, verdict_name, recommended_platform, gate_resolved, reasoning, journey)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (use_case_id) DO UPDATE SET
        tier = EXCLUDED.tier,
        verdict_name = EXCLUDED.verdict_name,
        recommended_platform = EXCLUDED.recommended_platform,
        gate_resolved = EXCLUDED.gate_resolved,
        reasoning = EXCLUDED.reasoning,
        journey = EXCLUDED.journey
      RETURNING *`;
    const params = [
      id,
      b.tier ?? null,
      b.verdict_name ?? null,
      b.recommended_platform ?? null,
      b.gate_resolved ?? null,
      b.reasoning === undefined || b.reasoning === null ? null : JSON.stringify(b.reasoning),
      b.journey === undefined || b.journey === null ? null : JSON.stringify(b.journey),
    ];
    const r = await query(sql, params);
    return res.json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/use-cases/:id/summary', async (req, res) => {
  try {
    const id = req.params.id;
    if (!(await ensureUseCase(id, res))) return;
    const b = req.body || {};
    const sql = `
      INSERT INTO evaluation_summaries (use_case_id, roi_p10, roi_p50, roi_p90, frameworks, governance, readiness)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (use_case_id) DO UPDATE SET
        roi_p10 = EXCLUDED.roi_p10,
        roi_p50 = EXCLUDED.roi_p50,
        roi_p90 = EXCLUDED.roi_p90,
        frameworks = EXCLUDED.frameworks,
        governance = EXCLUDED.governance,
        readiness = EXCLUDED.readiness
      RETURNING *`;
    const params = [
      id,
      toNumOrNull(b.roi_p10),
      toNumOrNull(b.roi_p50),
      toNumOrNull(b.roi_p90),
      b.frameworks === undefined || b.frameworks === null ? null : JSON.stringify(b.frameworks),
      b.governance === undefined || b.governance === null ? null : JSON.stringify(b.governance),
      b.readiness ?? null,
    ];
    const r = await query(sql, params);
    return res.json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/use-cases/:id/verdict', async (req, res) => {
  try {
    const id = req.params.id;
    if (!(await ensureUseCase(id, res))) return;
    const b = req.body || {};
    const sql = `
      INSERT INTO panel_verdicts (use_case_id, verdict, binding_condition, stances, deliberation)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (use_case_id) DO UPDATE SET
        verdict = EXCLUDED.verdict,
        binding_condition = EXCLUDED.binding_condition,
        stances = EXCLUDED.stances,
        deliberation = EXCLUDED.deliberation
      RETURNING *`;
    const params = [
      id,
      b.verdict ?? null,
      b.binding_condition ?? null,
      b.stances === undefined || b.stances === null ? null : JSON.stringify(b.stances),
      b.deliberation === undefined || b.deliberation === null ? null : JSON.stringify(b.deliberation),
    ];
    const r = await query(sql, params);
    return res.json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Portfolio                                                                  */
/* -------------------------------------------------------------------------- */

app.get('/api/portfolio', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    const base = `
      SELECT uc.id,
             uc.name,
             uc.stage,
             uc.department,
             f.composite       AS feasibility_composite,
             f.quadrant        AS quadrant,
             f.risk_tier       AS risk_tier,
             f.citizen_dev_pct AS citizen_dev_pct,
             a.tier            AS advisory_tier,
             a.recommended_platform AS recommended_platform,
             a.verdict_name    AS advisory_verdict,
             s.roi_p10         AS roi_p10,
             s.roi_p50         AS roi_p50,
             s.roi_p90         AS roi_p90,
             p.verdict         AS verdict,
             p.binding_condition AS binding_condition
        FROM use_cases uc
        LEFT JOIN feasibility_scores f  ON f.use_case_id = uc.id
        LEFT JOIN advisory_results a    ON a.use_case_id = uc.id
        LEFT JOIN evaluation_summaries s ON s.use_case_id = uc.id
        LEFT JOIN panel_verdicts p      ON p.use_case_id = uc.id`;
    let r;
    if (workspace_id) {
      r = await query(base + ' WHERE uc.workspace_id = $1 ORDER BY uc.created_at DESC', [workspace_id]);
    } else {
      r = await query(base + ' ORDER BY uc.created_at DESC');
    }
    return res.json(r.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

// Apply the data schema (schema.sql) on boot. Idempotent — every statement is
// CREATE TABLE IF NOT EXISTS — so a fresh Railway database self-provisions with
// no manual migration step. Safe to run on every restart.
async function bootstrapSchema() {
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Data schema ready (schema.sql applied).');
}

async function bootstrapAuth() {
  await auth.ensureAuthSchema();
  const seedUser = process.env.SEED_USER || 'sandboxuser';
  const seedPass = process.env.SEED_PASSWORD || 'IntelUser1!';
  await auth.seedUser(seedUser, seedPass);
  console.log(`Auth ready — seeded user "${seedUser}".`);
}

function start(port) {
  const p = port || process.env.PORT || 3000;
  return app.listen(p, () => {
    console.log(`Google AI Catalyst backend listening on port ${p}`);
  });
}

if (require.main === module) {
  // Provision the full database (data schema + auth tables + seed user) before
  // accepting traffic, then listen. Startup is resilient: if provisioning
  // fails we still boot so /api/health can report db:false rather than crash-loop.
  bootstrapSchema()
    .then(bootstrapAuth)
    .catch((e) => console.error('Startup provisioning failed:', e.message))
    .finally(() => start());
}

module.exports = app;
module.exports.start = start;
module.exports.pool = pool;
