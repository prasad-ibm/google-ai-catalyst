'use strict';

/*
 * R14-N3 isolated test — bulk-import department-coercion WARNINGS.
 *
 * BUG: POST /api/use-cases/bulk silently coerces each row's `department`
 * against the canonical 14 (unknown -> null; alias/case -> canonical). The
 * coercion is correct (DEF-13) but INVISIBLE: an importer whose spreadsheet
 * said "Assets Maintenance" got a row with department=null and NO indication
 * anything was dropped.
 *
 * FIX: capture the RAW submitted department BEFORE resolveDepartment(); when a
 * NON-EMPTY raw value was coerced to null OR normalized to a different
 * canonical spelling, attach a per-row `warnings:[...]` array to that row's
 * result. Coercion BEHAVIOR is unchanged. A top-level `coerced` count rolls up
 * how many rows carried a warning.
 *
 * Like delete-route.test.js / uuid-guard.test.js, this NEVER touches a real
 * DB: we stub `pool.query` on the exported app's shared pool. The bulk handler
 * issues (a) a workspace-exists SELECT and (b) an INSERT per row; we answer
 * both from the stub and drive the real Express app over localhost.
 *
 * Run ONLY this file:  node --test bulk-import-warnings.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://stub:stub@127.0.0.1:5432/stub';

const auth = require('./auth');
auth.requireAuthApi = (req, _res, next) => { req.user = { id: 'test', username: 'test' }; next(); };

const app = require('./server');
const pool = app.pool;

const WS = '99999999-9999-9999-9999-999999999999';

// --- stub the shared pool.query -------------------------------------------
// The bulk loop issues: SELECT id FROM workspaces WHERE id=$1 (exists check)
// and INSERT INTO use_cases ... RETURNING ... . We answer generically:
//   * workspace SELECT -> a matching row so validation passes
//   * INSERT           -> a fabricated row echoing the inserted name/department
let calls = [];
pool.query = async (text, params) => {
  calls.push({ text, params });
  const sql = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  if (sql.startsWith('select id from workspaces')) {
    return { rows: [{ id: params[0] }], rowCount: 1 };
  }
  if (sql.startsWith('insert into use_cases')) {
    // department is INSERT column index 2 (workspace_id, name, department, ...).
    return {
      rows: [{ id: '11111111-1111-1111-1111-111111111111', name: params[1], department: params[2] }],
      rowCount: 1,
    };
  }
  return { rows: [], rowCount: 0 };
};
function reset() { calls = []; }

// --- tiny HTTP driver ------------------------------------------------------
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          host: '127.0.0.1', port, method, path,
          headers: payload
            ? { 'content-type': 'application/json', 'content-length': payload.length }
            : {},
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            server.close();
            let json = null;
            try { json = data ? JSON.parse(data) : null; } catch { /* non-JSON */ }
            resolve({ status: res.statusCode, body: json, raw: data });
          });
        }
      );
      req.on('error', (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
    server.on('error', reject);
  });
}

function bulk(rows) {
  reset();
  return request('POST', '/api/use-cases/bulk', { workspace_id: WS, rows });
}

/* -------------------------------------------------------------------------- */
/* Non-canonical -> null : warns                                              */
/* -------------------------------------------------------------------------- */

test('non-canonical department -> null attaches a "not canonical → null" warning', async () => {
  const res = await bulk([{ name: 'A', department: 'Assets Maintenance' }]);
  assert.equal(res.status, 200);
  assert.equal(res.body.inserted, 1);
  const row = res.body.results[0];
  assert.equal(row.ok, true);
  assert.ok(Array.isArray(row.warnings), 'warnings is an array');
  assert.equal(row.warnings.length, 1);
  assert.equal(row.warnings[0], 'department "Assets Maintenance" not canonical → null');
});

test('top-level `coerced` count reflects rows carrying a warning', async () => {
  const res = await bulk([
    { name: 'A', department: 'Assets Maintenance' }, // null -> warn
    { name: 'B', department: 'Finance' },            // clean
    { name: 'C', department: 'hr' },                 // alias -> warn
  ]);
  assert.equal(res.body.inserted, 3);
  assert.equal(res.body.coerced, 2, 'two of three rows were coerced');
});

/* -------------------------------------------------------------------------- */
/* Alias / case normalization -> different canonical : warns                  */
/* -------------------------------------------------------------------------- */

test('alias department (hr) -> canonical attaches a "normalized" warning', async () => {
  const res = await bulk([{ name: 'A', department: 'hr' }]);
  const row = res.body.results[0];
  assert.ok(Array.isArray(row.warnings));
  assert.equal(row.warnings[0], 'department "hr" normalized → "Human Resources"');
});

test('case/whitespace-variant department -> canonical warns (value changed)', async () => {
  const res = await bulk([{ name: 'A', department: '  finance  ' }]);
  const row = res.body.results[0];
  assert.ok(Array.isArray(row.warnings), 'a changed spelling is reported');
  assert.match(row.warnings[0], /normalized → "Finance"/);
});

/* -------------------------------------------------------------------------- */
/* No warning when nothing was lost/changed                                   */
/* -------------------------------------------------------------------------- */

test('exact canonical department -> NO warnings key on the result', async () => {
  const res = await bulk([{ name: 'A', department: 'Finance' }]);
  const row = res.body.results[0];
  assert.equal(row.ok, true);
  assert.ok(!('warnings' in row), 'clean row keeps its minimal shape (no warnings key)');
  assert.equal(res.body.coerced, 0);
});

test('empty/absent department -> NO warning (blank is a legitimate null, not a loss)', async () => {
  const res = await bulk([
    { name: 'A', department: '' },
    { name: 'B' }, // department key absent entirely
    { name: 'C', department: '   ' },
  ]);
  assert.equal(res.body.inserted, 3);
  assert.equal(res.body.coerced, 0, 'blank departments are not warned about');
  for (const row of res.body.results) {
    assert.ok(!('warnings' in row), 'no warnings for blank department');
  }
});

/* -------------------------------------------------------------------------- */
/* `dept` alias column is captured too                                        */
/* -------------------------------------------------------------------------- */

test('the `dept` alias column is also subject to warnings', async () => {
  const res = await bulk([{ name: 'A', dept: 'BogusDept' }]);
  const row = res.body.results[0];
  assert.ok(Array.isArray(row.warnings));
  assert.equal(row.warnings[0], 'department "BogusDept" not canonical → null');
});

/* -------------------------------------------------------------------------- */
/* Behavior UNCHANGED: the stored department value is identical to before     */
/* -------------------------------------------------------------------------- */

test('coercion BEHAVIOR unchanged: INSERT still binds the coerced department', async () => {
  await bulk([{ name: 'A', department: 'Assets Maintenance' }]);
  const insert = calls.find((c) => String(c.text).toLowerCase().includes('insert into use_cases'));
  assert.ok(insert, 'an INSERT was issued');
  // department is bound column index 2 (workspace_id, name, department, ...).
  assert.equal(insert.params[2], null, 'non-canonical department still stored as null');
});
