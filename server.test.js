'use strict';

/*
 * End-to-end API test against the LIVE Postgres DB. No external framework.
 * Runs migrate first, boots the app on an ephemeral port, exercises the full
 * flow, asserts nested gate rows, then cleans up (cascade delete).
 */

require('dotenv').config();
const assert = require('node:assert');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name); }
}

// Minimal JSON HTTP client against 127.0.0.1:<port>.
// Shared session cookie captured after login, sent on every subsequent call.
let SESSION_COOKIE = null;

function call(port, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const opts = {
      host: '127.0.0.1',
      port,
      method,
      path: apiPath,
      headers: { 'Content-Type': 'application/json' },
    };
    if (SESSION_COOKIE) opts.headers['Cookie'] = SESSION_COOKIE;
    if (data) opts.headers['Content-Length'] = data.length;
    const req = http.request(opts, (res) => {
      // Capture the session cookie from a login response.
      const setCookie = res.headers['set-cookie'];
      if (setCookie && setCookie.length) {
        SESSION_COOKIE = setCookie.map((c) => c.split(';')[0]).join('; ');
      }
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch (e) { json = buf; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  // 1. Migrate against live DB.
  console.log('== Running migration ==');
  const mig = spawnSync('node', [path.join(__dirname, 'scripts', 'migrate.js')], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  process.stdout.write(mig.stdout || '');
  if (mig.status !== 0) {
    console.error(mig.stderr || 'migrate failed');
    process.exit(1);
  }
  ok('migrate exited 0', mig.status === 0);
  ok('migrate listed workspaces table', /(^|\n)workspaces(\n|$)/.test(mig.stdout || ''));

  // 2. Boot app on ephemeral port. Require after migrate so env is loaded.
  const app = require('./server');
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  console.log('\n== Server listening on ephemeral port ' + port + ' ==');

  let createdWorkspaceId = null;

  try {
    // Health (public, no auth needed).
    const health = await call(port, 'GET', '/api/health');
    ok('health ok:true', health.body && health.body.ok === true);
    ok('health db:true (live DB reachable)', health.body && health.body.db === true);

    // Auth: protected route rejects without a session, then log in.
    const noAuth = await call(port, 'GET', '/api/portfolio');
    ok('protected route returns 401 without session', noAuth.status === 401);
    const login = await call(port, 'POST', '/api/auth/login', { username: 'sandboxuser', password: 'IntelUser1!' });
    ok('login sandboxuser status 200', login.status === 200);
    ok('login captured session cookie', SESSION_COOKIE !== null);

    // 3. Create workspace from raw setup { state, current } shape.
    console.log('\n== POST /api/workspaces ==');
    const setupPayload = {
      state: {
        company: 'Acme Robotics',
        industry: 'Manufacturing',
        size: '1000-5000',
        revenue: '$500M-$1B',
        region: 'North America',
        residency1: 'US',
        cloud: 'Google Cloud',
        dataPlatform: 'BigQuery',
        integration: 'Native',
        aiTools: ['Gemini'],
        edition: 'Enterprise Plus',
        geminiSeats: 250,
        gcpSpend: '$50k-$100k/mo',
        appsheet: 'Enterprise Plus',
        vertexApproved: true,
        maturity: 'Repeatable',
        engineers: '12',
        devops: 'Level 3',
        citizenDev: true,
        frameworks: ['SOC2', 'ISO27001'],
        residency5: 'US',
        security: 'High',
        euAiTier: 'Limited',
        priority1: 'Cost reduction',
        priority2: 'Speed',
        priority3: 'Quality',
        budget: '$1M-$5M',
        delivery: 'Hybrid',
        goal: 'Automate invoice reconciliation',
        files: [],
      },
      current: 5,
    };
    const wsRes = await call(port, 'POST', '/api/workspaces', setupPayload);
    ok('workspace created status 201', wsRes.status === 201);
    ok('workspace has id', wsRes.body && !!wsRes.body.id);
    ok('name mapped company->name', wsRes.body && wsRes.body.name === 'Acme Robotics');
    ok('gemini_seats parsed to int 250', wsRes.body && wsRes.body.gemini_seats === 250);
    ok('ai_engineers parsed to int 12', wsRes.body && wsRes.body.ai_engineers === 12);
    ok('vertex_approved true', wsRes.body && wsRes.body.vertex_approved === true);
    ok('compliance_frameworks is array', wsRes.body && Array.isArray(wsRes.body.compliance_frameworks) && wsRes.body.compliance_frameworks.length === 2);
    ok('ai_priorities joined', wsRes.body && wsRes.body.ai_priorities === 'Cost reduction, Speed, Quality');
    ok('cloud_provider defaulted to Google Cloud', wsRes.body && wsRes.body.cloud_provider === 'Google Cloud');
    createdWorkspaceId = wsRes.body.id;

    // 4. Create use case with flat intake fields.
    console.log('\n== POST /api/use-cases ==');
    const ucPayload = {
      workspace_id: createdWorkspaceId,
      name: 'Invoice Reconciliation',
      dept: 'Finance',
      sponsor: 'CFO',
      submitter: 'jane@acme.test',
      email: 'jane@acme.test',
      desc: 'Automate matching of invoices to POs.',
      // tab1 business context
      driver: 'Cost', value: '>$5M', users: '50', align: 'Core strategic priority', justif: 'High ROI',
      // tab2 current state
      maturity: 'Fully manual', spend: '$200k', volume: '10k/mo', pain: 'Slow', tools: 'Spreadsheets',
      // tab3 technical context
      sources: 'ERP', dataavail: 'Readily available & clean', integrations: ['Google Workspace', 'BigQuery'], realtime: 'No', technotes: 'n/a',
      // tab4 risk & compliance
      sensitivity: 'High', autonomy: 'Assistive', pii: true, audit: 'Yes', adoption: 'Medium', change: 'Low', delivery: 'Phased', addnotes: 'none',
    };
    const ucRes = await call(port, 'POST', '/api/use-cases', ucPayload);
    ok('use case created status 201', ucRes.status === 201);
    ok('use case has id', ucRes.body && !!ucRes.body.id);
    ok('department mapped', ucRes.body && ucRes.body.department === 'Finance');
    ok('business_context grouped jsonb', ucRes.body && ucRes.body.business_context && ucRes.body.business_context.value === '>$5M');
    ok('technical_context integrations array', ucRes.body && ucRes.body.technical_context && Array.isArray(ucRes.body.technical_context.integrations));
    ok('risk_compliance pii captured', ucRes.body && ucRes.body.risk_compliance && ucRes.body.risk_compliance.pii === true);
    const ucId = ucRes.body.id;

    // Validation: missing workspace_id -> 400.
    const badUc = await call(port, 'POST', '/api/use-cases', { name: 'no ws' });
    ok('use case without workspace_id -> 400', badUc.status === 400);

    // 5. PUT each gate.
    console.log('\n== PUT gates ==');
    const bxt = await call(port, 'PUT', `/api/use-cases/${ucId}/bxt`, {
      business_score: 8.2, experience_score: 7.5, technology_score: 6.9, verdict: 'PROCEED',
      detail: { notes: 'strong business case' },
    });
    ok('bxt upsert ok', bxt.status === 200 && bxt.body && bxt.body.verdict === 'PROCEED');

    // Upsert again (ON CONFLICT path).
    const bxt2 = await call(port, 'PUT', `/api/use-cases/${ucId}/bxt`, {
      business_score: 9.0, experience_score: 7.5, technology_score: 6.9, verdict: 'PROCEED',
      detail: { notes: 'updated' },
    });
    ok('bxt upsert conflict updates', bxt2.status === 200 && Number(bxt2.body.business_score) === 9);

    const feas = await call(port, 'PUT', `/api/use-cases/${ucId}/feasibility`, {
      composite: 7.4, quadrant: 'Quick Win', risk_tier: 'Low', citizen_dev_pct: 40,
      criteria: { data: 8, integration: 7 }, pillars: { people: 6 },
    });
    ok('feasibility upsert ok', feas.status === 200 && feas.body && feas.body.quadrant === 'Quick Win');

    const adv = await call(port, 'PUT', `/api/use-cases/${ucId}/advisory`, {
      tier: 'Tier 2', verdict_name: 'Advance', recommended_platform: 'Vertex AI',
      gate_resolved: 'feasibility', reasoning: { why: 'clean data' }, journey: { steps: ['pilot'] },
    });
    ok('advisory upsert ok', adv.status === 200 && adv.body && adv.body.recommended_platform === 'Vertex AI');

    const summ = await call(port, 'PUT', `/api/use-cases/${ucId}/summary`, {
      roi_p10: 1.2, roi_p50: 2.5, roi_p90: 4.8, frameworks: { gadf: true },
      governance: { owner: 'CFO' }, readiness: 'Ready',
    });
    ok('summary upsert ok', summ.status === 200 && summ.body && summ.body.readiness === 'Ready');

    const verdict = await call(port, 'PUT', `/api/use-cases/${ucId}/verdict`, {
      verdict: 'APPROVE', binding_condition: 'Human-in-the-loop for >$10k',
      stances: { cfo: 'yes' }, deliberation: { rounds: 2 },
    });
    ok('verdict upsert ok', verdict.status === 200 && verdict.body && verdict.body.verdict === 'APPROVE');

    // Gate on non-existent use case -> 404.
    const badGate = await call(port, 'PUT', '/api/use-cases/00000000-0000-0000-0000-000000000000/bxt', { business_score: 1 });
    ok('gate on missing use case -> 404', badGate.status === 404);

    // 6. GET use case with nested gates.
    console.log('\n== GET /api/use-cases/:id (nested) ==');
    const full = await call(port, 'GET', `/api/use-cases/${ucId}`);
    ok('get use case 200', full.status === 200);
    ok('nested bxt present & non-null', full.body && full.body.bxt && full.body.bxt.verdict === 'PROCEED');
    ok('nested feasibility present & non-null', full.body && full.body.feasibility && full.body.feasibility.quadrant === 'Quick Win');
    ok('nested advisory present & non-null', full.body && full.body.advisory && full.body.advisory.tier === 'Tier 2');
    ok('nested summary present & non-null', full.body && full.body.summary && full.body.summary.readiness === 'Ready');
    ok('nested verdict present & non-null', full.body && full.body.verdict && full.body.verdict.verdict === 'APPROVE');

    // Missing use case -> 404.
    const missing = await call(port, 'GET', '/api/use-cases/00000000-0000-0000-0000-000000000000');
    ok('missing use case -> 404', missing.status === 404);

    // 7. Portfolio.
    console.log('\n== GET /api/portfolio ==');
    const portfolio = await call(port, 'GET', `/api/portfolio?workspace_id=${createdWorkspaceId}`);
    ok('portfolio 200 array', portfolio.status === 200 && Array.isArray(portfolio.body));
    const found = portfolio.body.find((r) => r.id === ucId);
    ok('use case appears in portfolio', !!found);
    ok('portfolio has feasibility_composite', found && Number(found.feasibility_composite) === 7.4);
    ok('portfolio has verdict', found && found.verdict === 'APPROVE');

    // 8. Cleanup: delete workspace (cascade).
    console.log('\n== Cleanup (cascade delete) ==');
    const { pool } = require('./db');
    await pool.query('DELETE FROM workspaces WHERE id = $1', [createdWorkspaceId]);
    const gone = await call(port, 'GET', `/api/use-cases/${ucId}`);
    ok('use case cascade-deleted (404)', gone.status === 404);
    const wsGone = await pool.query('SELECT id FROM workspaces WHERE id = $1', [createdWorkspaceId]);
    ok('workspace deleted', wsGone.rows.length === 0);
    const childGone = await pool.query('SELECT id FROM bxt_scores WHERE use_case_id = $1', [ucId]);
    ok('bxt child cascade-deleted', childGone.rows.length === 0);
    createdWorkspaceId = null;
  } finally {
    // Best-effort cleanup if something threw mid-flight.
    if (createdWorkspaceId) {
      try {
        const { pool } = require('./db');
        await pool.query('DELETE FROM workspaces WHERE id = $1', [createdWorkspaceId]);
      } catch (_) { /* noop */ }
    }
    await new Promise((r) => server.close(r));
    try {
      const { pool } = require('./db');
      await pool.end();
    } catch (_) { /* noop */ }
  }

  console.log('\n---------------------------------------------');
  console.log('  RESULT: ' + pass + ' passed, ' + fail + ' failed');
  console.log('---------------------------------------------');
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
