'use strict';

/*
 * R12-N3 isolated test — DELETE /api/use-cases/:id (SOFT DELETE).
 *
 * The DB-pool suites hang against a real Postgres (project memory), so this
 * suite NEVER touches a real DB. We stub `pool.query` on the exported app's
 * shared pool BEFORE any request, capture the SQL + params the handler issues,
 * and drive the real Express app over an ephemeral localhost HTTP server.
 *
 * Run ONLY this file:  node --test delete-route.test.js   (or: node delete-route.test.js)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Prevent the pg Pool from ever opening a socket during import/use.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://stub:stub@127.0.0.1:5432/stub';

// The /api guard (auth.requireAuthApi) only checks `req.user`. Neuter it BEFORE
// requiring server.js so the middleware bound at startup lets our requests
// through without a real session/DB. This keeps the test purely about the
// DELETE handler's DB behaviour.
const auth = require('./auth');
auth.requireAuthApi = (req, _res, next) => { req.user = { id: 'test', username: 'test' }; next(); };

const app = require('./server');
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
  nextResult = result;
}

// --- tiny HTTP driver (no supertest dependency) ---------------------------
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
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

const ID = '11111111-1111-1111-1111-111111111111';

test('DELETE issues UPDATE ... SET stage=archived ... WHERE id=$1', async () => {
  reset({ rows: [{ id: ID, stage: 'archived', status: 'archived' }], rowCount: 1 });
  await request('DELETE', `/api/use-cases/${ID}`);

  assert.equal(calls.length, 1, 'exactly one query issued (soft delete, no child cleanup)');
  const { text, params } = calls[0];
  const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();

  assert.match(sql, /^update use_cases/, 'is an UPDATE on use_cases (not a physical DELETE)');
  assert.match(sql, /set .*stage = 'archived'/, "sets stage = 'archived'");
  assert.match(sql, /status = 'archived'/, "sets status = 'archived'");
  assert.match(sql, /where id = \$1/, 'filters by id = $1');
  assert.deepEqual(params, [ID], 'id bound as the only parameter');
});

test('returns 200 + updated row when a row is archived (rowCount=1)', async () => {
  reset({ rows: [{ id: ID, stage: 'archived', status: 'archived' }], rowCount: 1 });
  const res = await request('DELETE', `/api/use-cases/${ID}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.id, ID);
  assert.equal(res.body.stage, 'archived');
  assert.equal(res.body.status, 'archived');
});

test('returns 404 JSON {error} when no row matches (rowCount=0)', async () => {
  reset({ rows: [], rowCount: 0 });
  const res = await request('DELETE', `/api/use-cases/${ID}`);

  assert.equal(res.status, 404);
  assert.ok(res.body && typeof res.body.error === 'string', 'JSON error payload present');
});

test('idempotent: archiving an ALREADY-archived row still succeeds (not 404)', async () => {
  // Simulate a row that is already archived — the UPDATE still matches by id,
  // so the DB reports rowCount=1 and the handler returns 200.
  reset({ rows: [{ id: ID, stage: 'archived', status: 'archived' }], rowCount: 1 });
  const res = await request('DELETE', `/api/use-cases/${ID}`);

  assert.equal(res.status, 200, 'second delete of same row is a success, never 404');
  assert.equal(res.body.stage, 'archived');
});

test('does NOT physically delete child rows (single UPDATE, no DELETE statements)', async () => {
  reset({ rows: [{ id: ID, stage: 'archived', status: 'archived' }], rowCount: 1 });
  await request('DELETE', `/api/use-cases/${ID}`);

  assert.equal(calls.length, 1, 'only the parent UPDATE runs — children left keyed to archived parent');
  assert.doesNotMatch(calls[0].text.toLowerCase(), /delete from/, 'no physical DELETE issued');
});
