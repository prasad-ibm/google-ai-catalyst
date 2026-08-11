'use strict';

/*
 * R12-N2 isolated test — GET /api/use-cases honours OPT-IN ?limit / ?offset.
 *
 * Same DB-free approach as delete-route.test.js (project memory: real DB-pool
 * suites hang). Stub pool.query, capture SQL + params, drive the real app.
 *
 * Run ONLY this file:  node --test use-cases-limit.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://stub:stub@127.0.0.1:5432/stub';

const auth = require('./auth');
auth.requireAuthApi = (req, _res, next) => { req.user = { id: 'test', username: 'test' }; next(); };

const app = require('./server');
const pool = app.pool;

let calls = [];
let nextResult = { rows: [], rowCount: 0 };
pool.query = async (text, params) => {
  calls.push({ text, params });
  return nextResult;
};
function reset() { calls = []; nextResult = { rows: [], rowCount: 0 }; }

function request(method, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request({ host: '127.0.0.1', port, method, path, headers: {} }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          server.close();
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch { /* non-JSON */ }
          resolve({ status: res.statusCode, body: json, raw: data });
        });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      req.end();
    });
    server.on('error', reject);
  });
}

// The single SELECT the /api/use-cases handler issues.
function ucCall() {
  const c = calls.find((x) => /from use_cases/i.test(x.text));
  assert.ok(c, 'a SELECT from use_cases was issued');
  return c;
}

test('?limit=6 issues a parameterized LIMIT with 6 bound', async () => {
  reset();
  await request('GET', '/api/use-cases?limit=6');
  const { text, params } = ucCall();
  const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
  assert.match(sql, /limit\s*\$\d+/, 'query contains a parameterized LIMIT');
  assert.ok(params.includes(6), 'limit value 6 bound as a parameter');
});

test('?limit=6&offset=12 issues LIMIT and OFFSET, both bound', async () => {
  reset();
  await request('GET', '/api/use-cases?limit=6&offset=12');
  const { text, params } = ucCall();
  const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
  assert.match(sql, /limit\s*\$\d+/, 'has LIMIT');
  assert.match(sql, /offset\s*\$\d+/, 'has OFFSET');
  assert.ok(params.includes(6), 'limit 6 bound');
  assert.ok(params.includes(12), 'offset 12 bound');
});

test('NO ?limit : behavior unchanged — no LIMIT/OFFSET in the SQL', async () => {
  reset();
  await request('GET', '/api/use-cases');
  const { text, params } = ucCall();
  const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
  assert.doesNotMatch(sql, /limit/, 'no LIMIT clause when ?limit absent');
  assert.doesNotMatch(sql, /offset/, 'no OFFSET clause when ?offset absent');
  assert.deepEqual(params, [], 'no params bound for a bare list');
});

test('limit clamps to a sane max of 500', async () => {
  reset();
  await request('GET', '/api/use-cases?limit=99999');
  const { params } = ucCall();
  assert.ok(params.includes(500), 'oversized limit clamped to 500');
  assert.ok(!params.includes(99999), 'raw oversized value never reaches the query');
});

test('non-numeric ?limit is ignored gracefully (no LIMIT)', async () => {
  reset();
  await request('GET', '/api/use-cases?limit=abc');
  const { text } = ucCall();
  assert.doesNotMatch(text.toLowerCase(), /limit/, 'garbage limit produces no LIMIT clause');
});

test('negative / zero ?limit is ignored gracefully (no LIMIT)', async () => {
  reset();
  await request('GET', '/api/use-cases?limit=-5');
  assert.doesNotMatch(ucCall().text.toLowerCase(), /limit/, 'negative limit produces no LIMIT');
  reset();
  await request('GET', '/api/use-cases?limit=0');
  assert.doesNotMatch(ucCall().text.toLowerCase(), /limit/, 'zero limit produces no LIMIT');
});

test('?offset without ?limit still appends OFFSET (opt-in)', async () => {
  reset();
  await request('GET', '/api/use-cases?offset=10');
  const { text, params } = ucCall();
  assert.match(text.toLowerCase(), /offset\s*\$\d+/, 'OFFSET honoured independently');
  assert.ok(params.includes(10), 'offset 10 bound');
});
