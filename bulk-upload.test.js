'use strict';

/*
 * Tests for the bulk use-case upload endpoint and its CSV parser.
 *
 * Run with:  node --test bulk-upload.test.js
 *
 * Coverage:
 *   (1) parseCsv() turns a CSV string with quoted commas/quotes/CRLF into the
 *       correct row objects (pure unit test, no DB).
 *   (4) >500 rows is rejected with 400 (guard test, exercised over HTTP but
 *       fails before any DB write).
 *   (2) rows-JSON insert path returns { inserted, results:[{id,name}] } against
 *       the LIVE DB using a throwaway workspace.
 *   (3) required-field validation (missing name / missing workspace_id) returns
 *       a per-row error while good rows in the same batch still insert.
 *
 * The live-DB tests create ONE temp workspace, insert under it, assert, then
 * cascade-delete it in an after() hook — plus a belt-and-braces delete by the
 * unique name prefix — so only the 5 seeded Intel use cases remain.
 */

require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { parseCsv } = require('./use-case-template');

// Unique marker so every row this suite inserts can be found & purged by name.
const NAME_PREFIX = 'BULKTEST_' + process.pid + '_';

/* -------------------------------------------------------------------------- */
/* (1) Pure CSV parser unit test — no server, no DB.                          */
/* -------------------------------------------------------------------------- */

test('parseCsv: quoted commas, escaped quotes, and CRLF newlines', () => {
  // Header + two data rows. The description column contains commas and an
  // embedded double-quote ("" -> "). Lines are separated by CRLF.
  const csv = [
    'name,department,description',
    '"AskHR","HR","Deflects tickets, fast, and cheap"',
    '"Contract Leakage","Procurement","Recovers 2""5% of ""contract"" value, silently"',
  ].join('\r\n');

  const rows = parseCsv(csv);

  assert.strictEqual(rows.length, 2, 'two data rows parsed');

  assert.strictEqual(rows[0].name, 'AskHR');
  assert.strictEqual(rows[0].department, 'HR');
  assert.strictEqual(
    rows[0].description,
    'Deflects tickets, fast, and cheap',
    'commas inside a quoted field are preserved',
  );

  assert.strictEqual(rows[1].name, 'Contract Leakage');
  assert.strictEqual(rows[1].department, 'Procurement');
  assert.strictEqual(
    rows[1].description,
    'Recovers 2"5% of "contract" value, silently',
    'escaped double-quotes ("") collapse to a single quote; commas preserved',
  );
});

test('parseCsv: trailing newline does not create a phantom row; ragged rows fill blanks', () => {
  const csv = 'name,department,description\r\nOnly Name,,\r\n';
  const rows = parseCsv(csv);
  assert.strictEqual(rows.length, 1, 'trailing CRLF is ignored');
  assert.strictEqual(rows[0].name, 'Only Name');
  assert.strictEqual(rows[0].department, '');
  assert.strictEqual(rows[0].description, '');
});

test('parseCsv: empty / null input yields empty array', () => {
  assert.deepStrictEqual(parseCsv(''), []);
  assert.deepStrictEqual(parseCsv(null), []);
  assert.deepStrictEqual(parseCsv(undefined), []);
});

/* -------------------------------------------------------------------------- */
/* HTTP harness for the live-DB tests.                                        */
/* -------------------------------------------------------------------------- */

let app;
let server;
let port;
let SESSION_COOKIE = null;
let tempWorkspaceId = null;

function call(method, apiPath, body, headers) {
  return new Promise((resolve, reject) => {
    const isString = typeof body === 'string';
    const data =
      body === undefined ? null : Buffer.from(isString ? body : JSON.stringify(body));
    const opts = {
      host: '127.0.0.1',
      port,
      method,
      path: apiPath,
      headers: Object.assign(
        { 'Content-Type': isString ? 'text/csv' : 'application/json' },
        headers || {},
      ),
    };
    if (SESSION_COOKIE) opts.headers['Cookie'] = SESSION_COOKIE;
    if (data) opts.headers['Content-Length'] = data.length;
    const req = http.request(opts, (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie && setCookie.length) {
        SESSION_COOKIE = setCookie.map((c) => c.split(';')[0]).join('; ');
      }
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch (_) { json = buf; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

before(async () => {
  app = require('./server');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  port = server.address().port;

  // Ensure the seed user exists (server bootstrap only runs when server.js is
  // the main module; here we import it, so seed explicitly). Idempotent.
  const auth = require('./auth');
  const seedUser = process.env.SEED_USERNAME || 'sandboxuser';
  const seedPass = process.env.SEED_PASSWORD || 'IntelUser1!';
  await auth.seedUser(seedUser, seedPass);

  // Authenticate — the /api guard requires a session cookie.
  const login = await call('POST', '/api/auth/login', {
    username: seedUser,
    password: seedPass,
  });
  assert.strictEqual(login.status, 200, 'login succeeded');
  assert.ok(SESSION_COOKIE, 'session cookie captured');

  // Create a throwaway workspace to insert use cases against.
  const { query } = require('./db');
  const ws = await query(
    "INSERT INTO workspaces (name) VALUES ($1) RETURNING id",
    [NAME_PREFIX + 'workspace'],
  );
  tempWorkspaceId = ws.rows[0].id;
  assert.ok(tempWorkspaceId, 'temp workspace created');
});

after(async () => {
  const { pool, query } = require('./db');
  try {
    // Purge by workspace (cascades to use_cases) AND by name prefix as a
    // belt-and-braces guard so the DB is left with only the 5 Intel use cases.
    if (tempWorkspaceId) {
      await query('DELETE FROM workspaces WHERE id = $1', [tempWorkspaceId]);
    }
    await query('DELETE FROM use_cases WHERE name LIKE $1', [NAME_PREFIX + '%']);
    await query('DELETE FROM workspaces WHERE name LIKE $1', [NAME_PREFIX + '%']);

    // Assert cleanliness.
    const leftover = await query(
      'SELECT count(*)::int AS n FROM use_cases WHERE name LIKE $1',
      [NAME_PREFIX + '%'],
    );
    assert.strictEqual(leftover.rows[0].n, 0, 'no test use_cases left behind');
  } finally {
    await new Promise((r) => server.close(r));
    try { await pool.end(); } catch (_) { /* noop */ }
  }
});

/* -------------------------------------------------------------------------- */
/* (4) Guard: >500 rows rejected. Fails before any DB write.                  */
/* -------------------------------------------------------------------------- */

test('bulk: >500 rows rejected with 400', async () => {
  const rows = [];
  for (let i = 0; i < 501; i++) rows.push({ name: NAME_PREFIX + 'overflow_' + i });
  const res = await call('POST', '/api/use-cases/bulk', {
    workspace_id: tempWorkspaceId,
    rows,
  });
  assert.strictEqual(res.status, 400, 'status 400');
  assert.match(res.body.error, /too many rows/i);
});

test('bulk: empty rows rejected with 400', async () => {
  const res = await call('POST', '/api/use-cases/bulk', {
    workspace_id: tempWorkspaceId,
    rows: [],
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /empty/i);
});

test('bulk: missing session cookie is rejected by the /api guard (401)', async () => {
  const saved = SESSION_COOKIE;
  SESSION_COOKIE = null;
  try {
    const res = await call('POST', '/api/use-cases/bulk', {
      workspace_id: tempWorkspaceId,
      rows: [{ name: NAME_PREFIX + 'noauth' }],
    });
    assert.strictEqual(res.status, 401, 'unauthenticated bulk call rejected');
  } finally {
    SESSION_COOKIE = saved;
  }
});

/* -------------------------------------------------------------------------- */
/* (2) rows-JSON insert path returns inserted count + ids against live DB.    */
/* -------------------------------------------------------------------------- */

test('bulk: rows-JSON insert returns inserted count and ids', async () => {
  const rows = [
    {
      name: NAME_PREFIX + 'AskHR',
      department: 'HR',
      executive_sponsor: 'CHRO',
      contact_email: 'askhr@intel.test',
      description: 'Deflects tickets, fast, and cheap',
      // flat intake keys -> grouped into jsonb by mapUseCaseContexts
      driver: 'Employee experience',
      value: '60-70% deflection',
      maturity: 'Manual helpdesk',
      sources: 'HCM',
      integrations: 'Agentspace',
      sensitivity: 'Medium',
      pii: 'true',
    },
    {
      // workspace_id omitted -> falls back to batch workspace_id
      name: NAME_PREFIX + 'Contract Leakage',
      department: 'Procurement',
      description: 'Recovers 2-5% of contract value, silently',
    },
  ];

  const res = await call('POST', '/api/use-cases/bulk', {
    workspace_id: tempWorkspaceId,
    rows,
  });

  assert.strictEqual(res.status, 200, 'status 200');
  assert.strictEqual(res.body.inserted, 2, 'both rows inserted');
  assert.strictEqual(res.body.failed, 0, 'no failures');
  assert.strictEqual(res.body.results.length, 2);

  assert.strictEqual(res.body.results[0].ok, true);
  assert.strictEqual(res.body.results[0].row, 0);
  assert.ok(res.body.results[0].id, 'row 0 has an id');
  assert.strictEqual(res.body.results[0].name, NAME_PREFIX + 'AskHR');
  assert.ok(res.body.results[1].id, 'row 1 has an id');

  // Confirm the jsonb grouping matches the single-create mapping and the
  // fallback workspace_id was applied.
  const { query } = require('./db');
  const check = await query(
    'SELECT workspace_id, business_context, technical_context, risk_compliance FROM use_cases WHERE id = $1',
    [res.body.results[0].id],
  );
  assert.strictEqual(check.rows[0].workspace_id, tempWorkspaceId);
  assert.strictEqual(check.rows[0].business_context.driver, 'Employee experience');
  assert.strictEqual(check.rows[0].technical_context.sources, 'HCM');
  assert.strictEqual(check.rows[0].risk_compliance.pii, 'true');

  const check2 = await query(
    'SELECT workspace_id FROM use_cases WHERE id = $1',
    [res.body.results[1].id],
  );
  assert.strictEqual(
    check2.rows[0].workspace_id,
    tempWorkspaceId,
    'batch workspace_id fallback applied to row missing workspace_id',
  );
});

test('bulk: text/csv body is parsed server-side and inserted', async () => {
  // workspace_id supplied via query string for the text/csv path.
  const csv = [
    'name,department,description',
    `"${NAME_PREFIX}CSVRow","Finance","Automate matching, fast, of ""invoices"" to POs"`,
  ].join('\r\n');

  const res = await call(
    'POST',
    '/api/use-cases/bulk?workspace_id=' + encodeURIComponent(tempWorkspaceId),
    csv,
  );

  assert.strictEqual(res.status, 200, 'status 200');
  assert.strictEqual(res.body.inserted, 1);
  assert.strictEqual(res.body.results[0].name, NAME_PREFIX + 'CSVRow');

  const { query } = require('./db');
  const row = await query('SELECT description FROM use_cases WHERE id = $1', [
    res.body.results[0].id,
  ]);
  assert.strictEqual(
    row.rows[0].description,
    'Automate matching, fast, of "invoices" to POs',
    'quoted commas + escaped quotes survived the CSV round-trip',
  );
});

/* -------------------------------------------------------------------------- */
/* (3) Per-row validation: bad rows fail individually; good rows still insert.*/
/* -------------------------------------------------------------------------- */

test('bulk: per-row validation errors do not abort the batch', async () => {
  const rows = [
    { name: NAME_PREFIX + 'Good1', department: 'Ops' },          // ok
    { department: 'NoName' },                                     // missing name
    { name: NAME_PREFIX + 'Good2' },                             // ok
    { name: NAME_PREFIX + 'BadWs', workspace_id: '00000000-0000-0000-0000-000000000000' }, // bad ws
  ];

  const res = await call('POST', '/api/use-cases/bulk', {
    workspace_id: tempWorkspaceId,
    rows,
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.inserted, 2, 'two good rows inserted');
  assert.strictEqual(res.body.failed, 2, 'two bad rows failed');

  assert.strictEqual(res.body.results[0].ok, true);
  assert.strictEqual(res.body.results[1].ok, false);
  assert.match(res.body.results[1].error, /name is required/i);
  assert.strictEqual(res.body.results[2].ok, true);
  assert.strictEqual(res.body.results[3].ok, false);
  assert.match(res.body.results[3].error, /workspace_id does not reference/i);
});
