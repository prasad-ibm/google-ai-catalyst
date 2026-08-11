'use strict';

/*
 * R12-N5 isolated test — GET /api/portfolio default-excludes archived rows,
 * with opt-ins (?include_archived, ?status=archived), while /api/portfolio/facets
 * STILL exposes 'archived' as a selectable vocabulary value.
 *
 * Same approach as delete-route.test.js: NEVER touch a real DB (the DB-pool
 * suites hang, per project memory). We stub `pool.query`, capture the SQL each
 * handler issues, and drive the real Express app over an ephemeral HTTP server.
 *
 * Run ONLY this file:  node --test portfolio-archived.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://stub:stub@127.0.0.1:5432/stub';

const auth = require('./auth');
auth.requireAuthApi = (req, _res, next) => { req.user = { id: 'test', username: 'test' }; next(); };

const app = require('./server');
const pool = app.pool;

// --- stub the shared pool.query -------------------------------------------
let calls = [];
let results = [];      // queued results, consumed FIFO (one per query call)
let defaultResult = { rows: [], rowCount: 0 };
pool.query = async (text, params) => {
  calls.push({ text, params });
  return results.length ? results.shift() : defaultResult;
};

function reset(queued) {
  calls = [];
  results = Array.isArray(queued) ? queued.slice() : [];
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

// Find the single SELECT the /api/portfolio handler runs to fetch rows (the
// one that selects from use_cases uc — not the COUNT). Normalized to lowercase.
function portfolioRowSql() {
  const rowCall = calls.find((c) => /from use_cases uc/i.test(c.text) && !/count\(\*\)/i.test(c.text));
  assert.ok(rowCall, 'a row-fetching SELECT from use_cases uc was issued');
  return rowCall.text.replace(/\s+/g, ' ').trim().toLowerCase();
}

const ARCHIVED_GUARD = /stage\s*<>\s*'archived'\s+and\s+.*status\s*<>\s*'archived'/;

test('DEFAULT (no params): portfolio SQL guards OUT archived rows', async () => {
  reset([{ rows: [], rowCount: 0 }]);
  await request('GET', '/api/portfolio');
  const sql = portfolioRowSql();
  assert.match(sql, ARCHIVED_GUARD,
    "default query contains a stage<>'archived' AND status<>'archived' guard");
});

test('?include_archived=1 : NO archived exclusion in the SQL', async () => {
  reset([{ rows: [], rowCount: 0 }]);
  await request('GET', '/api/portfolio?include_archived=1');
  const sql = portfolioRowSql();
  assert.doesNotMatch(sql, ARCHIVED_GUARD, 'include_archived=1 removes the exclusion guard');
});

test('?include_archived=true : NO archived exclusion in the SQL', async () => {
  reset([{ rows: [], rowCount: 0 }]);
  await request('GET', '/api/portfolio?include_archived=true');
  const sql = portfolioRowSql();
  assert.doesNotMatch(sql, ARCHIVED_GUARD, 'include_archived=true removes the exclusion guard');
});

test('?status=archived : NO exclusion guard, but DOES filter status=$n=archived', async () => {
  reset([{ rows: [], rowCount: 0 }]);
  await request('GET', '/api/portfolio?status=archived');
  const rowCall = calls.find((c) => /from use_cases uc/i.test(c.text) && !/count\(\*\)/i.test(c.text));
  const sql = rowCall.text.replace(/\s+/g, ' ').trim().toLowerCase();
  assert.doesNotMatch(sql, ARCHIVED_GUARD,
    'explicit status=archived must NOT add the guard (it would return nothing)');
  assert.match(sql, /uc\.status\s*=\s*\$\d+/, 'still applies the parameterized status filter');
  assert.ok(rowCall.params.includes('archived'), "'archived' bound as the status param value");
});

test('a NON-archived status filter STILL excludes archived by default', async () => {
  reset([{ rows: [], rowCount: 0 }]);
  await request('GET', '/api/portfolio?status=active');
  const sql = portfolioRowSql();
  assert.match(sql, ARCHIVED_GUARD,
    'status=active keeps the default archived exclusion (only status=archived opts out)');
});

test('facets vocabulary STILL includes archived (from an unfiltered GROUP BY)', async () => {
  // Queue results in the order the facets handler queries: department, sponsor,
  // stage, status (Promise.all order), then the total COUNT. The stage & status
  // facets include 'archived' with a count — proving archived stays selectable.
  reset([
    { rows: [{ value: 'HR', count: 12 }], rowCount: 1 },                                    // department
    { rows: [{ value: 'Jane Doe', count: 5 }], rowCount: 1 },                               // executive_sponsor
    { rows: [{ value: 'intake', count: 30 }, { value: 'archived', count: 16 }], rowCount: 2 }, // stage
    { rows: [{ value: 'active', count: 30 }, { value: 'archived', count: 16 }], rowCount: 2 }, // status
    { rows: [{ n: 46 }], rowCount: 1 },                                                      // total
  ]);
  const res = await request('GET', '/api/portfolio/facets');
  assert.equal(res.status, 200);

  const stageValues = res.body.stages.map((x) => x.value);
  const statusValues = res.body.statuses.map((x) => x.value);
  assert.ok(stageValues.includes('archived'), "'archived' present in stage facet vocabulary");
  assert.ok(statusValues.includes('archived'), "'archived' present in status facet vocabulary");

  const archivedStatus = res.body.statuses.find((x) => x.value === 'archived');
  assert.equal(archivedStatus.count, 16, "archived facet keeps its count (16) so users can view them");

  // And prove the facet SQL never applies the archived exclusion guard.
  const facetGroupBys = calls.filter((c) => /group by/i.test(c.text));
  assert.ok(facetGroupBys.length >= 1, 'facets computed via GROUP BY over use_cases');
  for (const c of facetGroupBys) {
    assert.doesNotMatch(c.text.toLowerCase(), ARCHIVED_GUARD,
      'facet vocabulary query does NOT exclude archived');
  }
});
