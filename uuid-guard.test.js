'use strict';

/*
 * R14-N2 isolated test — malformed-:id UUID guard on every /api/use-cases/:id
 * route (GET, PUT, DELETE + the 4 sub-resource PUTs).
 *
 * BUG: a malformed :id (e.g. 'not-a-uuid') was bound straight into a
 * `WHERE id = $1` against a uuid column, so Postgres threw
 * `invalid input syntax for type uuid`, which the catch-blocks returned
 * VERBATIM as a 500 body — a raw DB-engine/column-type leak AND a client
 * error mis-reported as a server error.
 *
 * FIX: a shared isValidUuid(id) helper guards each route, returning a GENERIC
 * 400 {error:'invalid use case id'} BEFORE any DB query runs.
 *
 * Like delete-route.test.js, this NEVER touches a real DB: we stub
 * `pool.query` on the exported app's shared pool and assert it is NEVER called
 * for a malformed id (proving the 400 precedes the query), then confirm it IS
 * called once the id is well-formed (proving we didn't over-block).
 *
 * Run ONLY this file:  node --test uuid-guard.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Prevent the pg Pool from ever opening a socket during import/use.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://stub:stub@127.0.0.1:5432/stub';

// Neuter the /api auth guard BEFORE requiring server.js so requests pass
// through without a real session/DB (mirrors delete-route.test.js).
const auth = require('./auth');
auth.requireAuthApi = (req, _res, next) => { req.user = { id: 'test', username: 'test' }; next(); };

const app = require('./server');
const { isValidUuid } = app;
const pool = app.pool;

// --- stub the shared pool.query -------------------------------------------
let calls = [];
let nextResult = { rows: [], rowCount: 0 };
pool.query = async (text, params) => {
  calls.push({ text, params });
  return nextResult;
};
function reset(result) {
  calls = [];
  nextResult = result || { rows: [], rowCount: 0 };
}

// --- tiny HTTP driver (no supertest dependency) ---------------------------
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

const VALID = '11111111-1111-1111-1111-111111111111';
const MALFORMED = ['not-a-uuid', '123', '', 'DROP TABLE use_cases', VALID + 'x', VALID.slice(0, -1)];

/* -------------------------------------------------------------------------- */
/* 1. Pure helper unit tests                                                  */
/* -------------------------------------------------------------------------- */

test('isValidUuid: accepts canonical 8-4-4-4-12 hex (both cases)', () => {
  assert.equal(isValidUuid(VALID), true);
  assert.equal(isValidUuid('AABBCCDD-EEFF-0011-2233-445566778899'), true);
});

test('isValidUuid: rejects malformed / wrong-length / non-string ids', () => {
  for (const bad of ['not-a-uuid', '123', '', VALID + 'x', VALID.slice(0, -1), 'g'.repeat(8) + '-1111-1111-1111-111111111111']) {
    assert.equal(isValidUuid(bad), false, `${JSON.stringify(bad)} should be invalid`);
  }
  assert.equal(isValidUuid(undefined), false);
  assert.equal(isValidUuid(null), false);
  assert.equal(isValidUuid(12345), false);
});

/* -------------------------------------------------------------------------- */
/* 2. Route guard — malformed id => 400 generic, ZERO queries                 */
/* -------------------------------------------------------------------------- */

// Each guarded route: [method, pathBuilder(id), body?]
const ROUTES = [
  ['GET', (id) => `/api/use-cases/${id}`, undefined],
  ['PUT', (id) => `/api/use-cases/${id}`, { name: 'x' }],
  ['DELETE', (id) => `/api/use-cases/${id}`, undefined],
  ['PUT', (id) => `/api/use-cases/${id}/bxt`, { business: 1 }],
  ['PUT', (id) => `/api/use-cases/${id}/feasibility`, { data: 1 }],
  ['PUT', (id) => `/api/use-cases/${id}/advisory`, { verdict: 'go' }],
  ['PUT', (id) => `/api/use-cases/${id}/summary`, { summary: 'x' }],
  ['PUT', (id) => `/api/use-cases/${id}/verdict`, { verdict: 'go' }],
];

for (const [method, build, body] of ROUTES) {
  const sample = build(':id');
  test(`${method} ${sample}: malformed id -> 400 generic, NO db query`, async () => {
    for (const bad of MALFORMED) {
      if (bad === '') continue; // empty segment => a different route / 404, not :id
      reset();
      const res = await request(method, build(encodeURIComponent(bad)), body);
      assert.equal(res.status, 400, `${method} ${bad} should be 400`);
      assert.deepEqual(res.body, { error: 'invalid use case id' }, 'generic error body');
      assert.equal(calls.length, 0, `NO query may run for malformed id (${bad})`);
      // Guarantee the raw Postgres leak string never appears.
      assert.doesNotMatch(res.raw, /invalid input syntax for type uuid/i, 'no Postgres leak');
    }
  });
}

/* -------------------------------------------------------------------------- */
/* 3. Well-formed id is NOT over-blocked — the query DOES run                  */
/* -------------------------------------------------------------------------- */

test('GET with a well-formed id passes the guard and queries the DB', async () => {
  reset({ rows: [{ id: VALID, name: 'ok' }], rowCount: 1 });
  const res = await request('GET', `/api/use-cases/${VALID}`);
  assert.ok(calls.length >= 1, 'a query runs for a valid id (guard did not block)');
  assert.notEqual(res.status, 400, 'valid id is never a 400');
});

test('DELETE with a well-formed id passes the guard and queries the DB', async () => {
  reset({ rows: [{ id: VALID, stage: 'archived', status: 'archived' }], rowCount: 1 });
  const res = await request('DELETE', `/api/use-cases/${VALID}`);
  assert.equal(calls.length, 1, 'the soft-delete UPDATE runs for a valid id');
  assert.equal(res.status, 200);
});
