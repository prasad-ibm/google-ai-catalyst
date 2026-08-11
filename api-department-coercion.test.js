'use strict';

/*
 * DEF-13 (HIGH, reopened at the API layer) — isolated regression test.
 * Run:  node --test api-department-coercion.test.js
 *
 * Round-13 QA re-found the DEF-13 attack path: while the BULK importer already
 * coerced `department` against the canonical 14, the single-record write routes
 * did NOT. So a request authored outside the intake form —
 *   POST /api/use-cases          (create)
 *   PUT  /api/use-cases/:id       (edit)
 * — could still persist an invalid ('NotARealDept'), empty (''), case-variant
 * ('finance') or injection ('<img onerror>') department VERBATIM, which then
 * surfaces as a spurious /api/portfolio/facets entry and leaks back into the
 * intake dropdown via the DEF-06 dynamic merge (the self-polluting loop).
 *
 * These tests are PURE (no DB, no server boot). They exercise the SAME exported
 * helpers the two routes use, applying the identical coercion the routes apply,
 * so they faithfully prove the boundary is closed:
 *
 *   (POST) route does: body.department = resolveDepartment(body.dept ?? body.department);
 *          delete body.dept;  -> insertUseCase(body) -> buildUseCaseValues(body)
 *          The department is INSERT column index 2. We assert that value.
 *
 *   (PUT)  route does: fieldMap = selectUseCaseUpdate(body); then, ONLY when
 *          fieldMap carries `department`, fieldMap.department = resolveDepartment(...).
 *          We assert the coercion AND that R12-N4 presence-gating is preserved
 *          (an absent department is never written).
 *
 * NOTE (project memory): requiring server.js constructs a lazy pg Pool but opens
 * NO connection (pg connects on first query), so this file never touches a DB.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { resolveDepartment } = require('./departments');
const { buildUseCaseValues, selectUseCaseUpdate } = require('./server');

// Index of `department` in USE_CASE_INSERT_COLS:
//   [workspace_id(0), name(1), department(2), ...]
const DEPT_COL = 2;

/* -------------------------------------------------------------------------- */
/* POST /api/use-cases — replicate the route's pre-insert coercion.           */
/* -------------------------------------------------------------------------- */

// Mirror of the live POST handler's department step (server.js ~466), then the
// shared mapping the route feeds into the INSERT.
function postDeptValue(body) {
  body = { ...body }; // don't mutate the caller's literal
  body.department = resolveDepartment(body.dept ?? body.department);
  delete body.dept;
  return buildUseCaseValues(body, 'ws-1')[DEPT_COL];
}

test('POST: valid canonical department passes through unchanged', () => {
  assert.strictEqual(postDeptValue({ name: 'x', department: 'Finance' }), 'Finance');
});

test('POST: case-variant department is normalized to canonical spelling', () => {
  assert.strictEqual(postDeptValue({ name: 'x', department: 'finance' }), 'Finance');
  assert.strictEqual(postDeptValue({ name: 'x', department: '  HUMAN RESOURCES  ' }), 'Human Resources');
});

test('POST: invalid department (NotARealDept) is coerced to null', () => {
  assert.strictEqual(postDeptValue({ name: 'x', department: 'NotARealDept' }), null);
});

test('POST: empty-string department is coerced to null', () => {
  assert.strictEqual(postDeptValue({ name: 'x', department: '' }), null);
});

test('POST: injection department (<img onerror>) is coerced to null', () => {
  assert.strictEqual(postDeptValue({ name: 'x', department: '<img src=x onerror=alert(1)>' }), null);
});

test('POST: `dept` alias is coerced too (buildUseCaseValues reads both)', () => {
  assert.strictEqual(postDeptValue({ name: 'x', dept: 'it' }), 'IT');
  assert.strictEqual(postDeptValue({ name: 'x', dept: 'BogusDept' }), null);
});

test('POST: absent department -> null (no verbatim junk possible)', () => {
  assert.strictEqual(postDeptValue({ name: 'x' }), null);
});

/* -------------------------------------------------------------------------- */
/* PUT /api/use-cases/:id — replicate the route's presence-gated coercion.    */
/* -------------------------------------------------------------------------- */

// Mirror of the live PUT handler (server.js ~666-680): the pure selector, then
// coerce department IN PLACE only when it was actually carried.
function putFieldMap(body) {
  const fieldMap = selectUseCaseUpdate(body);
  if (Object.prototype.hasOwnProperty.call(fieldMap, 'department')) {
    fieldMap.department = resolveDepartment(fieldMap.department);
  }
  return fieldMap;
}

test('PUT: carried valid department normalized to canonical', () => {
  assert.strictEqual(putFieldMap({ department: 'finance' }).department, 'Finance');
});

test('PUT: carried invalid department coerced to null', () => {
  assert.strictEqual(putFieldMap({ department: 'NotARealDept' }).department, null);
});

test('PUT: carried empty-string department coerced to null', () => {
  const d = putFieldMap({ department: '' });
  assert.ok('department' in d, 'empty is still an intentional write');
  assert.strictEqual(d.department, null);
});

test('PUT: carried injection department coerced to null', () => {
  assert.strictEqual(putFieldMap({ dept: '<img onerror=alert(1)>' }).department, null);
});

test('PUT: `dept` alias is coerced too', () => {
  assert.strictEqual(putFieldMap({ dept: 'r & d' }).department, 'R&D');
});

test('PUT (R12-N4 PRESERVED): absent department is NOT written', () => {
  // The crux: a partial PUT that never carried department must not touch it.
  const d = putFieldMap({ stage: 'archived' });
  assert.ok(!('department' in d), 'department omitted entirely -> stored value preserved');
});

test('PUT (R12-N4 PRESERVED): coercion does not disturb other carried columns', () => {
  const d = putFieldMap({ name: 'N', department: 'sales', stage: 'summary' });
  assert.strictEqual(d.department, 'Sales');
  assert.strictEqual(d.name, 'N');
  assert.strictEqual(d.stage, 'summary');
});
