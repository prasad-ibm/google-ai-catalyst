'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, query } = require('./db');
const auth = require('./auth');
const ai = require('./ai-service');
const { buildTemplateCsv, parseCsv } = require('./use-case-template');
const { roiEligible, stageRank, ROI_MIN_STAGE } = require('./stage');
// DEF-13: canonical department taxonomy — the single source of truth shared by
// the bulk-import validation below and asserted against the intake dropdown.
const { resolveDepartment } = require('./departments');

// R14-N2: shared UUID validator. Every /api/use-cases/:id route binds `:id`
// straight into a `WHERE id = $1` on a uuid column. A malformed :id (e.g.
// 'not-a-uuid') made Postgres throw `invalid input syntax for type uuid`,
// which the catch-blocks returned VERBATIM as a 500 body — leaking the column
// type + DB engine and turning a client error into a server error. We now
// validate :id up front and return a GENERIC 400 BEFORE issuing any query, so
// no DB error text can ever reach the client. RFC-4122-ish: 8-4-4-4-12 hex,
// case-insensitive (Postgres accepts either case; we don't gate on version/
// variant nibbles since the DB is the ultimate authority for real rows).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));
// Capture a raw text/csv body (for POST /api/use-cases/bulk with a CSV payload)
// as a UTF-8 string on req.body. JSON bodies are handled by express.json above.
app.use(express.text({ type: 'text/csv', limit: '8mb' }));

// Body-parser error handler. A malformed JSON payload makes express.json throw
// a SyntaxError (type: 'entity.parse.failed'); an oversized body throws with
// type: 'entity.too.large'. Without this, Express serves its default HTML 400
// page, breaking the app-wide {"error":...} JSON contract (QA bug). Catch those
// body-parser errors here and respond in JSON; anything else is re-thrown.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err))) {
    return res.status(400).json({ error: 'invalid JSON body' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'request body too large' });
  }
  return next(err);
});

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
  if (req.path.startsWith('/auth/') || req.path === '/health' || req.path === '/ai/status') return next();
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

// Trim strings recursively at the top level of a row object. Non-strings pass
// through unchanged. Used so bulk rows behave like trimmed intake fields.
function trimRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
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

// R12-N4 fix: decide EXACTLY which use_cases columns a PUT body should update.
// Only a column whose value is explicitly carried by the request body is
// returned; anything absent is omitted so the existing DB value is preserved.
// A jsonb context group is carried when its grouped key OR any of its flat
// intake keys is present. An explicitly-provided value (including null or "")
// is honored as an intentional write.
// Exported for isolated unit testing (see put-merge.test.js) — takes no DB.
function selectUseCaseUpdate(body) {
  body = body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const anyHas = (keys) => keys.some(has);

  const CTX_GROUPS = {
    business_context: ['driver', 'value', 'users', 'align', 'justif'],
    current_state: ['maturity', 'spend', 'volume', 'pain', 'tools'],
    technical_context: ['sources', 'dataavail', 'integrations', 'realtime', 'technotes'],
    risk_compliance: ['sensitivity', 'autonomy', 'pii', 'audit', 'adoption', 'change', 'delivery', 'addnotes'],
  };

  // Scalar columns: [dbColumn, [aliasKeysInPreferenceOrder]]. The column is
  // updated only if at least one of its aliases is actually present in body.
  const SCALARS = [
    ['name', ['name']],
    ['department', ['dept', 'department']],
    ['executive_sponsor', ['sponsor', 'executive_sponsor']],
    ['submitted_by', ['submitter', 'submitted_by']],
    ['contact_email', ['email', 'contact_email']],
    ['description', ['desc', 'description']],
    ['stage', ['stage']],
    ['status', ['status']],
    ['delivered_at', ['delivered_at']],
  ];

  const out = {};

  for (const [col, aliases] of SCALARS) {
    if (!anyHas(aliases)) continue; // field not carried -> do not write
    // Use the first alias actually present so an explicit null/"" is honored.
    const key = aliases.find(has);
    out[col] = body[key];
  }

  for (const [col, flatKeys] of Object.entries(CTX_GROUPS)) {
    const carried = has(col) || anyHas(flatKeys);
    if (!carried) continue; // group not carried -> preserve existing blob
    const grouped = mapUseCaseContexts(body)[col];
    out[col] = grouped; // may be null if group present but empty (intentional)
  }

  return out;
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
/* AI (Gemini) — status is public; generation routes require auth (below the   */
/* /api auth guard). Every generation route degrades gracefully: on any error  */
/* it returns { source:'scripted' } so the client uses its built-in content.   */
/* -------------------------------------------------------------------------- */

// Public: lets the frontend decide whether to attempt a live call.
app.get('/api/ai/status', (req, res) => {
  res.json({ enabled: ai.isEnabled(), model: ai.MODEL });
});

// Live Executive Panel deliberation. Body = use-case context object.
app.post('/api/ai/deliberate', async (req, res) => {
  if (!ai.isEnabled()) return res.json({ source: 'scripted', reason: 'no_key' });
  try {
    const result = await ai.deliberate(req.body || {});
    res.json(result);
  } catch (e) {
    console.error('AI deliberate failed:', e.message);
    res.json({ source: 'scripted', reason: 'error', error: e.message });
  }
});

// Live AI Assist hint. Body = { step, name, department, notes }.
app.post('/api/ai/assist', async (req, res) => {
  if (!ai.isEnabled()) return res.json({ source: 'scripted', reason: 'no_key' });
  try {
    const result = await ai.assist(req.body || {});
    res.json(result);
  } catch (e) {
    console.error('AI assist failed:', e.message);
    res.json({ source: 'scripted', reason: 'error', error: e.message });
  }
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

const USE_CASE_INSERT_COLS = [
  'workspace_id', 'name', 'department', 'executive_sponsor', 'submitted_by',
  'contact_email', 'description', 'business_context', 'current_state',
  'technical_context', 'risk_compliance', 'stage', 'status', 'delivered_at',
];

// v2 lifecycle: normalize an incoming status. Only 'completed' (a.k.a.
// 'delivered') and 'active' are recognized; anything else falls back to active.
// When a row is marked completed we default the stage to 'panel' so it also
// surfaces as fully-progressed in the pipeline views.
function normalizeStatus(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === 'completed' || s === 'delivered' || s === 'done') return 'completed';
  return 'active';
}
// Accept common date inputs (YYYY-MM-DD, or blank). Returns null when unparseable
// so a bad date never blocks the row — it just imports without a delivered date.
function normalizeDeliveredAt(v) {
  if (v == null || String(v).trim() === '') return null;
  const d = new Date(String(v).trim());
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Map a flat intake body (single create OR one bulk row) into the ordered
// column values for an INSERT into use_cases. jsonb blobs are JSON-stringified.
// This is the SINGLE source of truth so bulk rows behave identically to single
// create. `workspaceId` overrides body.workspace_id when supplied (bulk fallback).
// Field length caps (H4): reject/clamp abusive input lengths so a single record
// cannot break the Dashboard/Compare layout or bloat the DB. Names are capped
// hard at 200 chars; other short text fields are clamped defensively.
const NAME_MAX = 200;
const SHORT_MAX = 400;
function capStr(v, max) {
  if (v == null) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

function buildUseCaseValues(body, workspaceId) {
  const ctx = mapUseCaseContexts(body);
  return [
    workspaceId ?? body.workspace_id,
    capStr(body.name ?? null, NAME_MAX),
    capStr(body.dept ?? body.department ?? null, SHORT_MAX),
    capStr(body.sponsor ?? body.executive_sponsor ?? null, SHORT_MAX),
    capStr(body.submitter ?? body.submitted_by ?? null, SHORT_MAX),
    capStr(body.email ?? body.contact_email ?? null, SHORT_MAX),
    capStr(body.desc ?? body.description ?? null, 8000),
    ctx.business_context === null ? null : JSON.stringify(ctx.business_context),
    ctx.current_state === null ? null : JSON.stringify(ctx.current_state),
    ctx.technical_context === null ? null : JSON.stringify(ctx.technical_context),
    ctx.risk_compliance === null ? null : JSON.stringify(ctx.risk_compliance),
    // Lifecycle: a 'completed' row defaults its stage to 'panel' (fully
    // progressed) unless an explicit stage was supplied.
    body.stage ?? (normalizeStatus(body.status) === 'completed' ? 'panel' : 'intake'),
    normalizeStatus(body.status),
    normalizeDeliveredAt(body.delivered_at ?? body.delivered ?? null),
  ];
}

// Insert one use case row and return the created record. Shared by single
// create and bulk upload so mapping/columns never drift between the two.
async function insertUseCase(body, workspaceId) {
  const values = buildUseCaseValues(body, workspaceId);
  const placeholders = USE_CASE_INSERT_COLS.map((_, i) => `$${i + 1}`);
  const sql = `INSERT INTO use_cases (${USE_CASE_INSERT_COLS.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
  const r = await query(sql, values);
  return r.rows[0];
}

app.post('/api/use-cases', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.workspace_id) return res.status(400).json({ error: 'workspace_id is required' });

    // Ensure the workspace exists.
    const ws = await query('SELECT id FROM workspaces WHERE id = $1', [body.workspace_id]);
    if (!ws.rows.length) return res.status(400).json({ error: 'workspace_id does not reference an existing workspace' });

    // DEF-13 (reopened at API layer): coerce the department against the canonical
    // 14 BEFORE insert, mirroring the bulk path (see /api/use-cases/bulk). A
    // single POST authored outside the intake form (curl, integration, a stale
    // client) could otherwise persist an invalid ('NotARealDept'), empty (''),
    // case-variant ('finance') or injection ('<img onerror>') department
    // verbatim — which then surfaces as a spurious /facets entry and leaks back
    // into the intake dropdown via the DEF-06 dynamic merge. resolveDepartment
    // normalizes recognized values to their canonical spelling and coerces
    // anything else to null (excluded from facets). Overwrite BOTH aliases
    // buildUseCaseValues reads (`dept`/`department`) so the coerced value wins.
    body.department = resolveDepartment(body.dept ?? body.department);
    delete body.dept;

    const row = await insertUseCase(body);
    return res.status(201).json(row);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/*
 * Bulk use-case upload.
 *
 *   POST /api/use-cases/bulk
 *
 * Accepts EITHER:
 *   - application/json  { workspace_id: "<uuid>", rows: [ {...cols...}, ... ] }
 *   - text/csv          the raw CSV string (template format). The body workspace_id
 *                       must then be supplied as a ?workspace_id=<uuid> query param.
 *
 * Each row is an object keyed by the template column names. Rows are inserted
 * ONE AT A TIME (no wrapping transaction) so a single bad row cannot abort the
 * batch; per-row results are collected and returned.
 *
 * Response: { inserted, failed, results: [ {row, ok, id, name} | {row, ok:false, error} ] }
 *
 * Guards: rows required, non-empty, <= 500. Strings trimmed. Unknown columns
 * are ignored gracefully (mapUseCaseContexts only picks known keys).
 */
const BULK_MAX_ROWS = 500;

app.post('/api/use-cases/bulk', async (req, res) => {
  try {
    let workspaceId = null;
    let rows = null;

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('text/csv')) {
      // Raw CSV string body; workspace_id comes from the query string.
      const csvText = typeof req.body === 'string' ? req.body : '';
      workspaceId = req.query.workspace_id || null;
      rows = parseCsv(csvText);
    } else {
      const body = req.body || {};
      workspaceId = body.workspace_id || null;
      rows = body.rows;
    }

    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'rows must be an array (or provide a text/csv body)' });
    }
    if (rows.length === 0) {
      return res.status(400).json({ error: 'rows is empty' });
    }
    if (rows.length > BULK_MAX_ROWS) {
      return res.status(400).json({ error: `too many rows: ${rows.length} (max ${BULK_MAX_ROWS})` });
    }

    // If a batch-level workspace_id was supplied, validate it exists up front so
    // rows relying on the fallback fail fast with a clear error.
    let batchWorkspaceValid = null; // null = not checked, true/false once known
    if (workspaceId) {
      const ws = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
      batchWorkspaceValid = ws.rows.length > 0;
    }

    const results = [];
    let inserted = 0;
    let failed = 0;
    // R14-N3: count rows whose submitted department was silently coerced
    // (dropped to null, or re-mapped via alias/case-normalization). The
    // per-row `warnings` array makes each one visible; this total is the
    // trivial roll-up so a caller can flag "N rows had department issues"
    // without scanning every result.
    let coerced = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = trimRow(rows[i] || {});
      const rowWorkspaceId = row.workspace_id ? String(row.workspace_id).trim() : (workspaceId || null);
      // R14-N3: capture the RAW submitted department BEFORE resolveDepartment()
      // coerces it, so we can report when a non-empty value was silently
      // dropped to null or rewritten to a canonical/alias spelling. Coercion
      // BEHAVIOR is unchanged — this only makes it VISIBLE.
      const rawDept = row.dept ?? row.department;
      const warnings = [];
      try {
        if (!row.name) {
          throw new Error('name is required');
        }
        if (!rowWorkspaceId) {
          throw new Error('workspace_id is required (row or body)');
        }
        // DEF-13: validate the department against the canonical 14, mirroring the
        // intake authoring rule. An unrecognized (or blank) value is coerced to
        // null rather than persisted verbatim — null is excluded from
        // /api/portfolio/facets, so junk like 'NotARealDept' can never surface
        // as a spurious facet and then leak back into the intake dropdown via
        // the DEF-06 dynamic merge. Overwrite BOTH aliases buildUseCaseValues
        // reads (`dept`/`department`) so the coerced value is what gets stored.
        row.department = resolveDepartment(row.dept ?? row.department);
        delete row.dept;
        // R14-N3: surface silent department coercion. Only meaningful when the
        // raw value was non-empty; a blank/absent department already resolves
        // to null legitimately and is not a "lost" value worth warning about.
        const rawDeptStr = rawDept == null ? '' : String(rawDept).trim();
        if (rawDeptStr !== '') {
          if (row.department === null) {
            warnings.push(`department "${rawDeptStr}" not canonical → null`);
          } else if (row.department !== rawDeptStr) {
            // Alias or case/whitespace normalization changed the stored value.
            warnings.push(`department "${rawDeptStr}" normalized → "${row.department}"`);
          }
        }
        // Validate the workspace exists. Reuse the cached batch check when the
        // row uses the batch-level workspace_id.
        if (rowWorkspaceId === workspaceId && batchWorkspaceValid !== null) {
          if (!batchWorkspaceValid) throw new Error('workspace_id does not reference an existing workspace');
        } else {
          const ws = await query('SELECT id FROM workspaces WHERE id = $1', [rowWorkspaceId]);
          if (!ws.rows.length) throw new Error('workspace_id does not reference an existing workspace');
        }

        const created = await insertUseCase(row, rowWorkspaceId);
        inserted++;
        if (warnings.length) coerced++;
        // Attach `warnings` only when there is something to report, so
        // clean rows keep their existing minimal shape.
        const result = { row: i, ok: true, id: created.id, name: created.name };
        if (warnings.length) result.warnings = warnings;
        results.push(result);
      } catch (err) {
        failed++;
        results.push({ row: i, ok: false, error: err.message });
      }
    }

    return res.status(200).json({ inserted, failed, coerced, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/use-cases', async (req, res) => {
  try {
    const { workspace_id } = req.query;

    // R12-N2: OPT-IN pagination, mirroring /api/portfolio. Parse ?limit and
    // ?offset as positive integers. When ?limit is present we clamp it to a
    // sane max (500) and append a parameterized LIMIT (and OFFSET when a valid
    // ?offset is supplied). Non-numeric / negative values are ignored
    // gracefully. When neither is present the behaviour is UNCHANGED: return
    // ALL rows (no LIMIT/OFFSET) so existing callers are unaffected.
    const USE_CASES_LIMIT_MAX = 500;
    const rawLimit = parseInt(req.query.limit, 10);
    const rawOffset = parseInt(req.query.offset, 10);
    const hasLimit = Number.isInteger(rawLimit) && rawLimit > 0;
    const hasOffset = Number.isInteger(rawOffset) && rawOffset > 0;
    const limit = hasLimit ? Math.min(rawLimit, USE_CASES_LIMIT_MAX) : null;
    const offset = hasOffset ? rawOffset : null;

    const where = [];
    const params = [];
    function add(clause, val) { params.push(val); where.push(clause.replace('?', '$' + params.length)); }
    if (workspace_id) add('workspace_id = ?', workspace_id);
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

    // Append LIMIT/OFFSET only when opted in. Parameterized (never interpolated)
    // so the values stay inert, matching the app-wide no-SQL-injection rule.
    let pageSql = '';
    if (limit != null) { params.push(limit); pageSql += ' LIMIT $' + params.length; }
    if (offset != null) { params.push(offset); pageSql += ' OFFSET $' + params.length; }

    const sql = 'SELECT * FROM use_cases' + whereSql + ' ORDER BY created_at DESC' + pageSql;
    const r = await query(sql, params);
    return res.json(r.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Downloadable CSV template for bulk use-case upload. Columns map to the
// use_cases / intake fields and the file ships with the 5 existing Intel use
// cases as example rows. Registered BEFORE `/api/use-cases/:id` so the literal
// path "template.csv" is not captured as an :id.
app.get('/api/use-cases/template.csv', (req, res) => {
  const csv = buildTemplateCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="use-cases-template.csv"');
  return res.send(csv);
});

app.get('/api/use-cases/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // R14-N2: reject a malformed id with a generic 400 BEFORE any query, so
    // Postgres' 'invalid input syntax for type uuid' can never leak as a 500.
    if (!isValidUuid(id)) return res.status(400).json({ error: 'invalid use case id' });
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
    // R14-N2: malformed id -> generic 400 before touching the DB.
    if (!isValidUuid(id)) return res.status(400).json({ error: 'invalid use case id' });
    const exists = await query('SELECT id FROM use_cases WHERE id = $1', [id]);
    if (!exists.rows.length) return res.status(404).json({ error: 'use case not found' });

    const body = req.body || {};

    // R12-N4: Build the UPDATE SET list from ONLY the columns the request body
    // actually carried. A jsonb context group is "carried" when its grouped key
    // is present OR at least one of its flat intake keys is present; otherwise
    // it is omitted entirely so the existing blob is preserved (a partial PUT
    // like {stage:'archived'} must never NULL the four detail blobs).
    // selectUseCaseUpdate is exported for isolated unit testing (put-merge.test.js).
    const jsonbCols = new Set(['business_context', 'current_state', 'technical_context', 'risk_compliance']);
    const fieldMap = selectUseCaseUpdate(body);

    // DEF-13 (reopened at API layer): coerce the department against the canonical
    // 14, but ONLY when it was actually carried by this PUT. selectUseCaseUpdate
    // already applies R12-N4 presence-gating — `department` appears in fieldMap
    // iff the body carried `dept` or `department` — so coercing in-place here
    // preserves that discipline exactly: a partial PUT that omits department
    // never touches the stored value. When present, an invalid/empty/case-variant
    // /injection value is normalized to canonical-or-null (mirroring POST + bulk)
    // instead of being written verbatim and leaking into /facets via DEF-06.
    if (Object.prototype.hasOwnProperty.call(fieldMap, 'department')) {
      fieldMap.department = resolveDepartment(fieldMap.department);
    }

    const setClauses = [];
    const params = [];
    let i = 1;
    for (const [col, val] of Object.entries(fieldMap)) {
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

// R12-N3 (HIGH): SOFT DELETE for use cases. There was previously no DELETE
// route, so records could never be removed. We archive rather than physically
// delete to preserve the audit trail, matching the app's existing 'archived'
// lifecycle concept (`stage` is the lifecycle column per schema.sql, default
// 'intake'; `status` mirrors the active/archived flag). We flip BOTH stage and
// status to 'archived' in one UPDATE.
//
// Idempotent: the WHERE clause matches the row by id REGARDLESS of its current
// stage, so archiving an already-archived row still updates (rowCount=1) and
// returns 200 — never a spurious 404. 404 is returned only when NO row has the
// given id.
//
// Child rows (bxt_scores, feasibility_scores, advisory_results,
// evaluation_summaries, panel_verdicts) are intentionally left in place under
// soft-delete: they remain keyed to the archived parent and require no physical
// cleanup. (A hard DELETE would cascade via ON DELETE CASCADE, but that is not
// what soft-delete does.)
app.delete('/api/use-cases/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // R14-N2: malformed id -> generic 400 before touching the DB.
    if (!isValidUuid(id)) return res.status(400).json({ error: 'invalid use case id' });
    const sql = `
      UPDATE use_cases
         SET stage = 'archived', status = 'archived', updated_at = now()
       WHERE id = $1
      RETURNING *`;
    const r = await query(sql, [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'use case not found' });
    return res.json(r.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Gate upserts                                                               */
/* -------------------------------------------------------------------------- */

async function ensureUseCase(id, res) {
  // R14-N2: guard the shared gate helper used by the 4 sub-resource PUTs
  // (/:id/bxt, /:id/feasibility, /:id/advisory, /:id/summary, /:id/verdict).
  // A malformed id short-circuits to a generic 400 before any query runs, so
  // no raw 'invalid input syntax for type uuid' Postgres error can surface.
  if (!isValidUuid(id)) {
    res.status(400).json({ error: 'invalid use case id' });
    return false;
  }
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

    // Reaching the Evaluation Summary gate == reaching the 'summary' stage.
    // Advance the case to 'summary' if it is currently below it, so ROI
    // becomes eligible to persist. Cases already at panel/approved keep their
    // (higher) stage. This is the ONLY place stage advances on a summary save,
    // which keeps the read guard (portfolio) and write guard below consistent.
    const cur = await query('SELECT stage FROM use_cases WHERE id = $1', [id]);
    let effectiveStage = cur.rows[0] ? cur.rows[0].stage : 'intake';
    if (stageRank(effectiveStage) < stageRank(ROI_MIN_STAGE)) {
      effectiveStage = ROI_MIN_STAGE;
      await query('UPDATE use_cases SET stage = $1, updated_at = now() WHERE id = $2', [effectiveStage, id]);
    }

    // Write guard: never record ROI for a case that has not reached the
    // Evaluation Summary gate. After the advance above this is always true on
    // this path, but the guard is explicit so ROI can never leak in for an
    // intake-only case (defends against future callers).
    const roiOk = roiEligible(effectiveStage);
    const sql = `
      INSERT INTO evaluation_summaries (use_case_id, roi_p10, roi_p50, roi_p90, roi_value, roi_cost, frameworks, governance, readiness)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (use_case_id) DO UPDATE SET
        roi_p10 = EXCLUDED.roi_p10,
        roi_p50 = EXCLUDED.roi_p50,
        roi_p90 = EXCLUDED.roi_p90,
        roi_value = EXCLUDED.roi_value,
        roi_cost = EXCLUDED.roi_cost,
        frameworks = EXCLUDED.frameworks,
        governance = EXCLUDED.governance,
        readiness = EXCLUDED.readiness
      RETURNING *`;
    const params = [
      id,
      roiOk ? toNumOrNull(b.roi_p10) : null,
      roiOk ? toNumOrNull(b.roi_p50) : null,
      roiOk ? toNumOrNull(b.roi_p90) : null,
      // M7: persist the committed econ basis alongside the percentiles so the
      // case's value & cost are pinned and reloaded identically on every view.
      roiOk ? toNumOrNull(b.roi_value) : null,
      roiOk ? toNumOrNull(b.roi_cost) : null,
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
    const { workspace_id, department, sponsor, stage, status, q } = req.query;
    // Pagination: opt-in. When neither limit nor offset is supplied the
    // endpoint behaves EXACTLY as before (returns a bare array of all rows) so
    // existing callers are unaffected (back-compat). When limit/offset ARE
    // supplied, the response becomes { rows, total, limit, offset } so the
    // client can page through 300+ use cases without shipping them all at once.
    const paged = req.query.limit != null || req.query.offset != null;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const base = `
      SELECT uc.id,
             uc.name,
             uc.stage,
             uc.status,
             uc.delivered_at,
             uc.department,
             uc.executive_sponsor,
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

    // Build WHERE from optional filters. Each is parameterized (no SQL
    // injection — payloads store/compare as inert text, per the QA security
    // findings). Filtering happens server-side so 300 rows never all ship.
    const where = [];
    const params = [];
    function add(clause, val) { params.push(val); where.push(clause.replace('?', '$' + params.length)); }
    if (workspace_id) add('uc.workspace_id = ?', workspace_id);
    if (department)    add('uc.department = ?', department);
    if (sponsor)       add('uc.executive_sponsor = ?', sponsor);
    if (stage)         add('uc.stage = ?', stage);
    if (status)        add('uc.status = ?', status);
    if (q)             add('uc.name ILIKE ?', '%' + String(q).trim() + '%');

    // R12-N5: by DEFAULT exclude archived rows (stage='archived' OR
    // status='archived') so soft-deleted records never leak onto the portfolio
    // map. Two opt-ins bypass the exclusion:
    //   - ?include_archived=1|true -> return archived alongside active (no guard)
    //   - an explicit ?status=archived request -> the caller is deliberately
    //     asking for archived rows, so don't fight the status filter with the
    //     default guard (the status='archived' filter above already narrows to
    //     archived; adding the exclusion would return nothing).
    // The facet vocabulary is computed by a SEPARATE, unfiltered query
    // (/api/portfolio/facets), so 'archived' remains a selectable filter value
    // with its count regardless of this default result-set exclusion.
    const includeArchivedRaw = String(req.query.include_archived == null ? '' : req.query.include_archived)
      .trim().toLowerCase();
    const includeArchived = includeArchivedRaw === '1' || includeArchivedRaw === 'true';
    const statusIsArchived = String(status == null ? '' : status).trim().toLowerCase() === 'archived';
    if (!includeArchived && !statusIsArchived) {
      where.push("uc.stage <> 'archived' AND uc.status <> 'archived'");
    }

    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

    let total = null;
    if (paged) {
      const countRes = await query('SELECT COUNT(*)::int AS n FROM use_cases uc' + whereSql, params);
      total = countRes.rows[0].n;
    }
    const pageSql = paged ? ` LIMIT ${limit} OFFSET ${offset}` : '';
    const r = await query(base + whereSql + ' ORDER BY uc.created_at DESC' + pageSql, params);

    // Canonical portfolio row shape (see CONTRACT.md). Enforced in ONE place so
    // Dashboard / Kanban / Summary all read identical values:
    //  - ROI is null unless the case reached the Evaluation Summary/Panel gate
    //    (fixes #6: an Intake-only case can never emit stale ROI like +407%).
    //  - quadrant is null for the same non-evaluated cases (fixes #M4: an
    //    unevaluated case must not display a feasibility quadrant like
    //    'Quick Win').
    //  - `verdict` is the single committed Executive Panel verdict, or null.
    const rows = r.rows.map((row) => {
      // A case is genuinely EVALUATED only when it has reached the Evaluation
      // Summary gate (or beyond) AND owns a committed evaluation_summaries row
      // carrying a real P50. Gating on the stage flag alone is not enough: a
      // stage can be bumped independently, and — as observed for 'FE Test UC'
      // (M5) — a case can end up with an evaluation_summaries row whose figures
      // were seeded/leaked from a sibling. Requiring roi_p50 != null here means
      // ROI *and* quadrant are only surfaced together with real committed
      // Monte-Carlo output; anything inconsistent is suppressed (emitted null),
      // never deleted. The LEFT JOIN is keyed correctly (s.use_case_id = uc.id),
      // so this guard is the defensive backstop against inherited figures.
      const evaluated = roiEligible(row.stage) && row.roi_p50 != null;
      return {
        id: row.id,
        // DEF-03: defensive read-side clip. Ingest already caps names at
        // NAME_MAX, but legacy rows (or writes from outside this app) may carry
        // an oversized name that would bloat the payload and break Compare /
        // Dashboard layout. Clip here so the API can never emit one.
        name: capStr(row.name, NAME_MAX),
        department: row.department,
        stage: row.stage,
        // Feasibility, quadrant and advisory tier are post-evaluation artifacts:
        // suppress ALL of them for un-evaluated cases so an intake-only case
        // (e.g. 'FE Test UC') never leaks a feasibility score (3.9), a quadrant
        // (Quick Win) or an advisory tier (Extend) copied/seeded from a sibling
        // (M3/M4/M5).
        feasibility_composite: evaluated ? row.feasibility_composite : null,
        quadrant: evaluated ? row.quadrant : null,
        advisory_tier: evaluated ? row.advisory_tier : null,
        recommended_platform: row.recommended_platform,
        roi_p10: evaluated ? row.roi_p10 : null,
        roi_p50: evaluated ? row.roi_p50 : null,
        roi_p90: evaluated ? row.roi_p90 : null,
        // Canonical verdict = committed panel verdict (null if never committed).
        verdict: row.verdict == null ? null : row.verdict,
        // v2 lifecycle: expose executive sponsor (for the Exec Sponsor filter),
        // the lifecycle status ('active' | 'completed'), and the delivery date
        // so the Dashboard can tell the 2026 'delivered' story.
        executive_sponsor: row.executive_sponsor == null ? null : row.executive_sponsor,
        status: row.status || 'active',
        delivered_at: row.delivered_at == null ? null : row.delivered_at,
      };
    });
    // Back-compat: unpaged callers get a bare array (unchanged). Paged callers
    // get an envelope with total/limit/offset for pagination controls.
    if (paged) return res.json({ rows, total, limit, offset });
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Filter facets: distinct departments, sponsors, stages, statuses with counts,
// so the shared filter bar can render options (e.g. "HR (12)") without pulling
// every row. Honors workspace_id if supplied. Scales to 300+ cases.
app.get('/api/portfolio/facets', async (req, res) => {
  try {
    const { workspace_id } = req.query;
    const wsSql = workspace_id ? ' WHERE workspace_id = $1' : '';
    const wsParams = workspace_id ? [workspace_id] : [];
    async function facet(col) {
      const r = await query(
        `SELECT ${col} AS value, COUNT(*)::int AS count FROM use_cases${wsSql}` +
        ` GROUP BY ${col} ORDER BY count DESC, ${col} ASC`, wsParams);
      return r.rows.filter((x) => x.value != null && String(x.value).trim() !== '');
    }
    const [departments, sponsors, stages, statuses] = await Promise.all([
      facet('department'), facet('executive_sponsor'), facet('stage'), facet('status'),
    ]);
    const totalRes = await query('SELECT COUNT(*)::int AS n FROM use_cases' + wsSql, wsParams);
    return res.json({ departments, sponsors, stages, statuses, total: totalRes.rows[0].n });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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
// Exported for unit tests (DEF-03 name-clip): the same helpers the API and
// bulk/CSV ingest use to cap oversized names.
module.exports.capStr = capStr;
module.exports.buildUseCaseValues = buildUseCaseValues;
module.exports.NAME_MAX = NAME_MAX;
// Exported for R12-N4 isolated unit test (put-merge.test.js): pure body->columns selector.
module.exports.selectUseCaseUpdate = selectUseCaseUpdate;
// Exported for R14-N2 isolated unit test (uuid-guard.test.js): the shared
// UUID validator every /api/use-cases/:id route uses to reject malformed ids.
module.exports.isValidUuid = isValidUuid;
