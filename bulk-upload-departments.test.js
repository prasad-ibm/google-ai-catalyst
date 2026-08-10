'use strict';

/*
 * DEF-13 (HIGH): the bulk-import path must validate `department` against the
 * canonical 14-item taxonomy and coerce anything unrecognized to null, exactly
 * as the intake authoring dropdown constrains it. This closes the self-polluting
 * facet loop (bulk junk -> facets 14->15 -> DEF-06 dynamic merge -> intake
 * dropdown option 15).
 *
 * These are PURE tests (no DB, no server boot) so they run fast and offline:
 *   (A) resolveDepartment() coerces / normalizes / rejects correctly.
 *   (B) buildUseCaseValues() — the single mapping shared by single-create and
 *       bulk — is exercised the way the bulk loop calls it (dept pre-resolved),
 *       proving a junk department lands as NULL in the INSERT values.
 *   (C) Parity guard: the canonical list in departments.js matches the 14
 *       <option> values shipped in intake.html #f_dept, so the two can never
 *       drift into a second hardcoded copy.
 *
 * Run with:  node --test bulk-upload-departments.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  CANONICAL_DEPARTMENTS,
  resolveDepartment,
  isCanonicalDepartment,
} = require('./departments');

/* -------------------------------------------------------------------------- */
/* (A) resolveDepartment: the coerce-or-null rule.                            */
/* -------------------------------------------------------------------------- */

test('resolveDepartment: exact canonical values pass through unchanged', () => {
  for (const d of CANONICAL_DEPARTMENTS) {
    assert.strictEqual(resolveDepartment(d), d, `${d} resolves to itself`);
    assert.strictEqual(isCanonicalDepartment(d), true);
  }
  assert.strictEqual(CANONICAL_DEPARTMENTS.length, 14, 'exactly 14 canonical departments');
});

test('resolveDepartment: case-insensitive and whitespace-trimmed match', () => {
  assert.strictEqual(resolveDepartment('  finance  '), 'Finance');
  assert.strictEqual(resolveDepartment('HUMAN RESOURCES'), 'Human Resources');
  assert.strictEqual(resolveDepartment('r&d'), 'R&D');
});

test('resolveDepartment: unknown department is coerced to null (DEF-13 core)', () => {
  // The exact junk value that polluted /facets (14->15) in the QA report.
  assert.strictEqual(resolveDepartment('NotARealDept'), null);
  assert.strictEqual(isCanonicalDepartment('NotARealDept'), false);
  // Near-misses that are NOT canonical must also be rejected.
  assert.strictEqual(resolveDepartment('HR'), null);
  assert.strictEqual(resolveDepartment('Ops'), null);
  assert.strictEqual(resolveDepartment('Engineering'), null);
});

test('resolveDepartment: blank / null / undefined coerce to null', () => {
  assert.strictEqual(resolveDepartment(''), null);
  assert.strictEqual(resolveDepartment('   '), null);
  assert.strictEqual(resolveDepartment(null), null);
  assert.strictEqual(resolveDepartment(undefined), null);
});

/* -------------------------------------------------------------------------- */
/* (B) buildUseCaseValues: a junk dept lands as NULL, a good dept survives.   */
/*     Mirrors how the bulk loop calls it (row.department pre-resolved).       */
/* -------------------------------------------------------------------------- */

test('buildUseCaseValues: canonical department is stored, junk stored as null', () => {
  const { buildUseCaseValues } = require('./server');
  const DEPT_IDX = 2; // 3rd INSERT column is `department` (see USE_CASE_INSERT_COLS)

  // Good row: department preserved verbatim.
  const good = buildUseCaseValues(
    { name: 'Good', department: resolveDepartment('Finance') },
    'ws-1',
  );
  assert.strictEqual(good[DEPT_IDX], 'Finance');

  // Junk row: the bulk loop resolves 'NotARealDept' -> null BEFORE mapping, so
  // the INSERT stores NULL and the value can never become a facet.
  const junk = buildUseCaseValues(
    { name: 'Junk', department: resolveDepartment('NotARealDept') },
    'ws-1',
  );
  assert.strictEqual(junk[DEPT_IDX], null);
});

/* -------------------------------------------------------------------------- */
/* (C) Parity guard: departments.js === intake.html #f_dept options.          */
/* -------------------------------------------------------------------------- */

test('canonical list matches the 14 options in intake.html #f_dept', () => {
  const html = fs.readFileSync(path.join(__dirname, 'intake.html'), 'utf8');

  // Isolate the #f_dept <select> block, then pull every option's TEXT content
  // (the options carry no value attribute — the label IS the value) and decode
  // the HTML entity in 'R&amp;D'. The leading 'Select…' placeholder is blank
  // and filtered out. Comments inside the block never match the option regex.
  const sel = html.match(/<select[^>]*id=["']f_dept["'][\s\S]*?<\/select>/i);
  assert.ok(sel, 'found #f_dept select in intake.html');

  const opts = [];
  const re = /<option([^>]*)>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = re.exec(sel[0])) !== null) {
    const attrs = m[1];
    const label = m[2].replace(/&amp;/g, '&').trim();
    // Skip the placeholder <option value="">Select…</option>.
    if (/value\s*=\s*["']\s*["']/.test(attrs)) continue;
    if (label !== '') opts.push(label);
  }

  assert.deepStrictEqual(
    opts.slice().sort(),
    CANONICAL_DEPARTMENTS.slice().sort(),
    'intake.html #f_dept options and departments.js must be identical (no drift)',
  );
});
